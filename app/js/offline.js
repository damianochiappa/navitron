'use strict';
/* =====================================================
   OFFLINE — cache tile sets for offline use
   Storage: Service Worker Cache API (navitron-tiles-v1)
===================================================== */

(function () {

  const AVG_TILE_KB    = 15;
  const MAX_SIZE_GB    = 4;
  const TOS_MAPS       = ['osm', 'osm_std', 'google_hybrid', 'google_maps'];
  const TILE_CACHE_NAME = 'navitron-tiles-v1';
  const DL_CONCURRENCY = 3;   // parallel tile fetches
  const DL_DELAY_MS    = 50;  // ms pause between batches (rate-limit)

  let _downloading      = false;
  let _cancelled        = false;
  let _batchAbort       = null;

  /* ===== TILE MATH ===== */
  function _lonToX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  }
  function _latToY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
  }
  function _range(bounds, z) {
    return {
      xMin: _lonToX(bounds.getWest(), z),  xMax: _lonToX(bounds.getEast(), z),
      yMin: _latToY(bounds.getNorth(), z), yMax: _latToY(bounds.getSouth(), z)
    };
  }
  function _countTiles(bounds, maxZ) {
    let n = 0;
    for (let z = 1; z <= maxZ; z++) {
      const r = _range(bounds, z);
      n += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
    }
    return n;
  }

  /* ===== KML → bounds ===== */
  function _kmlBounds(kmlText) {
    const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
    const pts = [];
    doc.querySelectorAll('coordinates').forEach(el => {
      el.textContent.trim().split(/\s+/).forEach(t => {
        const p = t.split(',');
        if (p.length >= 2) {
          const lon = parseFloat(p[0]), lat = parseFloat(p[1]);
          if (!isNaN(lon) && !isNaN(lat)) pts.push(L.latLng(lat, lon));
        }
      });
    });
    return pts.length ? L.latLngBounds(pts) : null;
  }

  /* ===== TILE URL ===== */
  /* Build the URL from the raw Leaflet template (_url) rather than calling
     getTileUrl(), which internally reads _tileZoom — a property set only when
     the layer is currently active on the map.  Inactive basemaps have
     _tileZoom === undefined, making getTileUrl() produce URLs with z=NaN that
     never match any cached key.  Direct template substitution avoids this. */
  function _tileUrl(mapId, z, x, y) {
    const entry = BASEMAPS[mapId];
    if (!entry || entry._needsCreds) return null;

    const template = (typeof entry._url === 'string') ? entry._url : '';
    if (template) {
      const subdomain = (() => {
        const s = entry.options && entry.options.subdomains;
        if (!s) return 'a';
        const arr = Array.isArray(s) ? s : String(s).split('');
        return arr[(x + y) % arr.length];
      })();
      return template
        .replace(/\{s\}/g, subdomain)
        .replace(/\{z\}/g, z)
        .replace(/\{x\}/g, x)
        .replace(/\{y\}/g, y)
        .replace(/\{r\}/g, '');   // retina suffix — omit for offline tiles
    }

    // Fallback for layer types without a plain _url (e.g. WMS sublayers)
    if (typeof entry.getTileUrl !== 'function') return null;
    const coords = L.point(x, y); coords.z = z;
    try { return entry.getTileUrl(coords); } catch (_) { return null; }
  }

  /* ===== SW CACHE HELPERS ===== */
  async function _openTileCache() {
    if (!window.caches) return null;
    try { return await caches.open(TILE_CACHE_NAME); } catch (_) { return null; }
  }

  /* Strip rotating subdomains so a tile cached from 'a.' is found when 'b.' requests it. */
  function _normUrl(url) {
    if (!url) return url;
    return url.replace(/^(https?:\/\/)(?:[a-c]\.|mt\d+\.)/, '$1');
  }

  async function _buildCachedSet(cache) {
    try {
      const keys = await cache.keys();
      return new Set(keys.map(r => _normUrl(r.url)));
    } catch (_) { return new Set(); }
  }

  /* ===== PROGRESS UI ===== */
  function _setProgress(done, total, visible, label) {
    const section = document.getElementById('offline-progress-section');
    const fill    = document.getElementById('offline-progress-fill');
    const text    = document.getElementById('offline-progress-text');
    const startB  = document.getElementById('btn-offline-start');
    const cancelB = document.getElementById('btn-offline-cancel');
    if (section) section.style.display = visible ? '' : 'none';
    if (visible && total > 0) {
      const pct = Math.round(done / total * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = (label || 'Scanning') + ': ' +
        done.toLocaleString() + ' / ' + total.toLocaleString() + ' (' + pct + '%)';
    }
    if (startB)  startB.style.display  = visible ? 'none' : '';
    if (cancelB) cancelB.style.display = visible ? '' : 'none';
  }

  /* ===== DOWNLOAD MISSING TILES ===== */
  /* Fetches tiles absent from cachedSet and writes them directly into the
     Cache API (does not rely on SW interception, works also when the SW is
     inactive or out-of-scope, e.g. Cordova file:// origin).
     Strategy: try CORS first (readable response); on failure try no-cors
     (opaque response — browser can still render it as an <img> src).
     All zoom levels 1..maxZoom for the same extent are included. */
  async function _downloadMissing(bounds, maxZoom, mapId, cachedSet) {
    const cache = await _openTileCache();

    const pending = [];
    for (let z = 1; z <= maxZoom; z++) {
      const r = _range(bounds, z);
      for (let x = r.xMin; x <= r.xMax; x++) {
        for (let y = r.yMin; y <= r.yMax; y++) {
          const url = _tileUrl(mapId, z, x, y);
          if (url && !cachedSet.has(_normUrl(url))) pending.push(url);
        }
      }
    }
    if (!pending.length) return;

    let done = 0;
    _setProgress(0, pending.length, true, 'Downloading');

    for (let i = 0; i < pending.length && !_cancelled; i += DL_CONCURRENCY) {
      _batchAbort = new AbortController();
      const { signal } = _batchAbort;
      const batch = pending.slice(i, i + DL_CONCURRENCY);
      await Promise.all(batch.map(async url => {
        if (_cancelled) return;
        try {
          const normUrl = _normUrl(url);
          const normReq = new Request(normUrl);

          // Skip if already in cache (ignoreVary: CORS responses may have Vary: Origin)
          if (cache && await cache.match(normReq, { ignoreVary: true })) return;

          let response = null;
          // Try CORS first: CORS-capable servers (OSM, Carto, ESRI) return
          // a readable response that caches cleanly and renders offline.
          try {
            const r = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
            if (r.ok) response = r;
          } catch (_) {}
          // Fallback no-cors: opaque response — works if the server returns
          // actual image data (not an error page).
          if (!response && !signal.aborted) {
            try {
              response = await fetch(url, { mode: 'no-cors', credentials: 'omit', signal });
            } catch (_) {}
          }

          if (response && cache && (response.ok || response.type === 'opaque')) {
            await cache.put(normReq, response);
          }
        } catch (_) {}
      }));
      _batchAbort = null;
      done += batch.length;
      _setProgress(done, pending.length, true, 'Downloading');
      if (DL_DELAY_MS > 0) await new Promise(res => setTimeout(res, DL_DELAY_MS));
    }
  }

  /* ===== MAIN FLOW: scan → download missing → register basemap ===== */
  async function _startDownload(kmlText, maxZoom, mapId, mapName) {
    if (_downloading) { toastMsg('Operation already in progress', 'error'); return; }

    const bounds = _kmlBounds(kmlText);
    if (!bounds || !bounds.isValid()) { toastMsg('Invalid KML: no valid coordinates found', 'error'); return; }

    const entry = BASEMAPS[mapId];
    if (!entry) { toastMsg('Map not found', 'error'); return; }
    maxZoom = Math.min(maxZoom, (entry.options && entry.options.maxZoom) || 18, 18);

    const tosWarn = document.getElementById('offline-tos-warn');
    if (TOS_MAPS.includes(mapId)) {
      if (tosWarn) tosWarn.style.display = '';
      toastMsg('\u26A0 Check service ToS before using offline tiles', 'error');
    } else {
      if (tosWarn) tosWarn.style.display = 'none';
    }

    const total  = _countTiles(bounds, maxZoom);
    const sizeMB = (total * AVG_TILE_KB) / 1024;
    const sizeGB = sizeMB / 1024;
    if (sizeGB > MAX_SIZE_GB) {
      toastMsg('Area exceeds ' + MAX_SIZE_GB + ' GB limit. Reduce zoom or extent.', 'error');
      return;
    }

    const cache = await _openTileCache();
    if (!cache) { toastMsg('Tile cache not available (SW not active)', 'error'); return; }

    _downloading = true; _cancelled = false;
    _setProgress(0, total, true, 'Scanning');

    try {
      /* ── Phase 1: scan existing cache ── */
      const cachedSet = await _buildCachedSet(cache);
      let checked = 0, found = 0;
      const SCAN_BATCH = 500;

      for (let z = 1; z <= maxZoom && !_cancelled; z++) {
        const r = _range(bounds, z);
        for (let x = r.xMin; x <= r.xMax && !_cancelled; x++) {
          for (let y = r.yMin; y <= r.yMax && !_cancelled; y++) {
            const url = _tileUrl(mapId, z, x, y);
            if (url && cachedSet.has(_normUrl(url))) found++;
            checked++;
            if (checked % SCAN_BATCH === 0) {
              _setProgress(checked, total, true, 'Scanning');
              await new Promise(res => setTimeout(res, 0));
            }
          }
        }
      }
      if (_cancelled) { toastMsg('Cancelled', ''); return; }
      _setProgress(total, total, true, 'Scanning');

      const missing = total - found;
      const pct     = total > 0 ? Math.round(found / total * 100) : 0;
      const sizeStr = sizeMB >= 1024 ? sizeGB.toFixed(2) + ' GB' : Math.round(sizeMB) + ' MB';

      toastMsg(
        found.toLocaleString() + '/' + total.toLocaleString() + ' tiles cached (' + pct + '%)' +
        (missing > 0 ? ' — downloading ' + missing.toLocaleString() + ' missing\u2026' : ''),
        ''
      );

      /* ── Phase 2: download uncached tiles (all zoom levels 1..maxZoom) ── */
      if (missing > 0) {
        await _downloadMissing(bounds, maxZoom, mapId, cachedSet);
      }
      if (_cancelled) { toastMsg('Cancelled', ''); return; }

      /* ── Phase 3: register as offline basemap ── */
      _registerLayer(mapName, mapId, maxZoom);
      toastMsg('Offline basemap ready: ' + mapName + ' (~' + sizeStr + ')', 'success');

    } catch (e) {
      toastMsg('Error: ' + e.message, 'error');
    } finally {
      _downloading = false;
      _setProgress(0, 0, false);
    }
  }

  /* ===== REGISTER OFFLINE BASEMAP ===== */
  function _registerLayer(name, sourceMapId, maxZoom) {
    const sourceEntry = BASEMAPS[sourceMapId];
    if (!sourceEntry || typeof sourceEntry.getTileUrl !== 'function') {
      toastMsg('Cannot get tile URL for this map', 'error'); return;
    }

    // Use the raw Leaflet template URL (_url) so variable order is preserved
    // exactly as defined (e.g. ESRI uses {z}/{y}/{x}, not {z}/{x}/{y}).
    // Reconstructing from getTileUrl() at z=1,x=0,y=0 produces the wrong
    // template for any server that doesn't use the {z}/{x}/{y} convention.
    let templateUrl = '';
    try { templateUrl = sourceEntry._url || ''; } catch (_) {}
    if (!templateUrl) {
      // Fallback for unusual layer types without _url
      try {
        const sampleCoords = L.point(0, 0); sampleCoords.z = 1;
        templateUrl = sourceEntry.getTileUrl(sampleCoords).replace('/1/0/0', '/{z}/{x}/{y}');
      } catch (_) { templateUrl = ''; }
    }

    const id = 'offline_' + Date.now();
    BASEMAPS[id] = L.tileLayer(templateUrl, {
      attribution: 'Offline: ' + name,
      maxZoom: maxZoom, maxNativeZoom: maxZoom
    });
    const cfg = { id, type: 'wmts', url: templateUrl, name: 'Offline: ' + name, offline: true };
    customMapConfigs.push(cfg);
    _autoSaveConfig();
    _addBasemapUI(cfg);
  }

  /* ===== FORM INIT ===== */
  (function initForm() {
    const kmlInput  = document.getElementById('offline-kml-input');
    const kmlName   = document.getElementById('offline-kml-name');
    const zoomInput = document.getElementById('offline-zoom');
    const mapSelect = document.getElementById('offline-map-select');
    const startBtn  = document.getElementById('btn-offline-start');
    const cancelBtn = document.getElementById('btn-offline-cancel');
    const tosWarn   = document.getElementById('offline-tos-warn');

    if (!startBtn) return;

    let _kmlText = null;

    if (kmlInput) {
      kmlInput.addEventListener('change', function () {
        const f = this.files[0]; if (!f) return;
        if (kmlName) kmlName.textContent = f.name;
        const reader = new FileReader();
        reader.onload = e => { _kmlText = e.target.result; };
        reader.readAsText(f);
      });
    }

    function _populateSelect() {
      if (!mapSelect) return;
      mapSelect.innerHTML = '';
      const offlineIds = new Set(
        (typeof customMapConfigs !== 'undefined' ? customMapConfigs : [])
          .filter(c => c.offline).map(c => c.id)
      );
      document.querySelectorAll('#basemap-list input[name="basemap"]').forEach(radio => {
        const id = radio.value;
        if (offlineIds.has(id)) return;
        const entry = BASEMAPS[id];
        if (!entry || entry._needsCreds || typeof entry.getTileUrl !== 'function') return;
        const span = radio.closest('label') && radio.closest('label').querySelector('span');
        const name = span ? span.textContent.trim() : id;
        const o = document.createElement('option');
        o.value = id; o.textContent = name;
        mapSelect.appendChild(o);
      });
    }

    if (mapSelect) {
      mapSelect.addEventListener('change', () => {
        if (tosWarn) tosWarn.style.display = TOS_MAPS.includes(mapSelect.value) ? '' : 'none';
      });
    }

    const tabBtn = document.querySelector('[data-panel="offline"]');
    if (tabBtn) tabBtn.addEventListener('click', _populateSelect);
    _populateSelect();

    startBtn.addEventListener('click', async () => {
      if (!_kmlText) { toastMsg('Select a KML file for the extent', 'error'); return; }
      const zoom = parseInt(zoomInput ? zoomInput.value : '14');
      if (isNaN(zoom) || zoom < 1 || zoom > 18) { toastMsg('Zoom must be between 1 and 18', 'error'); return; }
      if (!mapSelect || !mapSelect.value) { toastMsg('Select a map', 'error'); return; }
      const rawName = mapSelect.options[mapSelect.selectedIndex].text;
      const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      await _startDownload(_kmlText, zoom, mapSelect.value, safeName);
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (_downloading) { _cancelled = true; if (_batchAbort) _batchAbort.abort(); }
      });
    }
  })();

})();
