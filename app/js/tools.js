'use strict';
/* =====================================================
   TOOLS — sidebar, go-to, converter, credentials,
            config save/load, bookmarks, splash
===================================================== */

/* ===== SIDEBAR TOGGLE ===== */
function updateMenuState() {
  const sidebar = document.getElementById('sidebar');
  const isOpen  = !sidebar.classList.contains('collapsed');
  document.getElementById('app').classList.toggle('menu-open', isOpen);
  // Wait for sidebar width transition (.3s) before recalculating map size
  setTimeout(() => map.invalidateSize(), 320);
}

document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  updateMenuState();
});

/* ===== TAB SWITCHING ===== */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
  });
});

/* ===== MAP TOOLS PANEL ===== */
document.querySelectorAll('.mt-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mt-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mt-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('mt-' + btn.dataset.mt).classList.add('active');
  });
});
document.getElementById('map-tools-close').addEventListener('click', () => {
  document.getElementById('map-tools').classList.add('hidden');
});

/* Map-tools drag */
(function () {
  const panel  = document.getElementById('map-tools');
  const header = panel.querySelector('.mt-header');
  let dragging = false, startX, startY, origLeft, origTop;

  function _onStart(cx, cy) {
    dragging = true; startX = cx; startY = cy;
    panel.style.zIndex = ++window._panelZTop;
    if (!panel.style.left) {
      const r = panel.getBoundingClientRect();
      panel.style.bottom = 'auto'; panel.style.right = 'auto';
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
    }
    origLeft = parseFloat(panel.style.left); origTop = parseFloat(panel.style.top);
  }
  function _onMove(cx, cy) {
    if (!dragging) return;
    const mw = window.innerWidth, mh = window.innerHeight;
    panel.style.left = Math.max(0, Math.min(mw - panel.offsetWidth,  origLeft + cx - startX)) + 'px';
    panel.style.top  = Math.max(0, Math.min(mh - panel.offsetHeight, origTop  + cy - startY)) + 'px';
  }
  function _onEnd() { dragging = false; }

  header.addEventListener('mousedown',  e => { if (e.target.closest('button')) return; _onStart(e.clientX, e.clientY); e.preventDefault(); });
  header.addEventListener('touchstart', e => { if (e.target.closest('button')) return; e.preventDefault(); _onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  document.addEventListener('mousemove',  e => _onMove(e.clientX, e.clientY));
  document.addEventListener('touchmove',  e => { if (dragging) { _onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('mouseup',  _onEnd);
  document.addEventListener('touchend', _onEnd);
})();

/* ===== GO TO COORDINATES ===== */
document.getElementById('btn-goto').addEventListener('click', gotoCoord);
document.getElementById('goto-input').addEventListener('keydown', e => { if (e.key === 'Enter') gotoCoord(); });

let gotoMarker = null;
function gotoCoord() {
  const val = document.getElementById('goto-input').value.trim();
  if (!val) return;
  let lat = NaN, lon = NaN;
  const s = val.replace(/\s+/g,' ');

  if (/^\d{1,2}[A-Za-z][A-Za-z]{2}\d{2,10}$/.test(val.replace(/\s/g,''))) {
    const ll = parseMGRS(val);
    if (ll) { lat = ll.lat; lon = ll.lon !== undefined ? ll.lon : ll.lng; }
  } else if (/^\d{1,2}[A-Za-z]\s+\d+\s+\d+$/.test(s)) {
    const p = s.trim().split(/\s+/);
    try { const ll = UTM.toLatLng({ zone: p[0], x: parseFloat(p[1]), y: parseFloat(p[2]) }); lat = ll.lat; lon = ll.lng; } catch(e) {}
  } else if (/[\u00b0'"]|[NSEWnsew]/.test(val)) {
    const m = val.match(/(\d[\d\u00b0\s'"\.]+[NnSs])\s*[,\s]\s*(\d[\d\u00b0\s'"\.]+[EeWw])/);
    if (m) { lat = dms2dd(m[1]); lon = dms2dd(m[2]); }
  }
  if (isNaN(lat) || isNaN(lon)) {
    const p = val.split(/[\s,;]+/);
    lat = parseFloat(p[0]); lon = parseFloat(p[1]);
  }
  if (isNaN(lat) || isNaN(lon)) { toastMsg('Unrecognized format (DD, DMS, MGRS, UTM)', 'error'); return; }
  if (gotoMarker) map.removeLayer(gotoMarker);
  map.flyTo([lat, lon], 14);
  gotoMarker = L.circleMarker([lat, lon], { radius: 10, color: '#e05252', fillColor: '#e05252', fillOpacity: 0.7, weight: 2 })
    .addTo(map)
    .bindPopup(`<div class="goto-popup"><b>Target point</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}<br>MGRS: ${mgrsForward(lon,lat)}</div>`)
    .openPopup();
}

/* goto-input autocomplete — only when text contains letters (not pure coordinates) */
_attachAddressAutocomplete(
  document.getElementById('goto-input'),
  (lat, lon, name) => {
    document.getElementById('goto-input').value = name;
    if (gotoMarker) map.removeLayer(gotoMarker);
    map.flyTo([lat, lon], 14);
    gotoMarker = L.circleMarker([lat, lon], { radius: 10, color: '#e05252', fillColor: '#e05252', fillOpacity: 0.7, weight: 2 })
      .addTo(map)
      .bindPopup(`<div class="goto-popup"><b>${name}</b><br>Lat: ${(+lat).toFixed(6)}<br>Lon: ${(+lon).toFixed(6)}</div>`)
      .openPopup();
  },
  { onlyIfText: true }
);

/* ===== COORDINATE CONVERTER ===== */
document.getElementById('btn-convert').addEventListener('click', convertCoord);
document.getElementById('convert-input').addEventListener('keydown', e => { if (e.key === 'Enter') convertCoord(); });

function convertCoord() {
  const fromFmt = document.getElementById('convert-from').value;
  const val = document.getElementById('convert-input').value.trim();
  const box = document.getElementById('convert-result');
  if (!val) return;

  let lat = NaN, lon = NaN;
  try {
    if (fromFmt === 'dd') {
      const p = val.split(/[\s,;]+/);
      lat = parseFloat(p[0]); lon = parseFloat(p[1]);
    } else if (fromFmt === 'dms') {
      const m = val.match(/(\d+[\u00b0\s]\d+['\s]\d+(?:\.\d+)?["''\s]*[NnSs])\s*[,\s]\s*(\d+[\u00b0\s]\d+['\s]\d+(?:\.\d+)?["''\s]*[EeWw])/);
      if (m) { lat = dms2dd(m[1]); lon = dms2dd(m[2]); }
      else {
        const nums = val.match(/[\d.]+/g), dirs = val.match(/[NSEWnsew]/g);
        if (nums && nums.length >= 6 && dirs && dirs.length >= 2) {
          lat = (parseFloat(nums[0]) + parseFloat(nums[1])/60 + parseFloat(nums[2])/3600) * (/[Ss]/.test(dirs[0]) ? -1 : 1);
          lon = (parseFloat(nums[3]) + parseFloat(nums[4])/60 + parseFloat(nums[5])/3600) * (/[Ww]/.test(dirs[1]) ? -1 : 1);
        }
      }
    } else if (fromFmt === 'mgrs') {
      const ll = parseMGRS(val);
      if (!ll) throw new Error('MGRS parse error');
      lat = ll.lat; lon = ll.lon !== undefined ? ll.lon : ll.lng;
    } else if (fromFmt === 'utm') {
      const p = val.trim().split(/\s+/);
      if (p.length >= 3) {
        const ll = UTM.toLatLng({ zone: p[0], x: parseFloat(p[1]), y: parseFloat(p[2]) });
        lat = ll.lat; lon = ll.lng;
      }
    }
    if (isNaN(lat) || isNaN(lon)) throw new Error('Parse error');

    let utmStr = '--';
    try { const utm = UTM.fromLatLng({ lat, lng: lon }); utmStr = `${utm.zone} ${Math.round(utm.x)} ${Math.round(utm.y)}`; } catch(e) {}
    const mgrsStr = mgrsForward(lon, lat);

    box.className = 'result-box show'; box.style.borderColor = '';
    box.innerHTML =
      `<span class="r-label">DD</span><br><span class="r-val">${lat.toFixed(6)}, ${lon.toFixed(6)}</span><br>` +
      `<span class="r-label">DMS</span><br><span class="r-val">${latToDMS(lat)} ${lonToDMS(lon)}</span><br>` +
      `<span class="r-label">UTM</span><br><span class="r-val">${utmStr}</span><br>` +
      `<span class="r-label">MGRS</span><br><span class="r-val">${mgrsStr}</span>`;
  } catch(err) {
    box.className = 'result-box show'; box.style.borderColor = 'var(--danger)';
    box.innerHTML = `<span style="color:var(--danger)">Unrecognized format.<br>Check your input.</span>`;
    setTimeout(() => { box.style.borderColor = ''; }, 2000);
  }
}

/* ===== CREDENTIAL MODAL ===== */
let _credCB = null;

function showCredModal(cfg, onSuccess, onCancel) {
  _credCB = { onSuccess, onCancel };
  document.getElementById('cred-user').value = '';
  document.getElementById('cred-pass').value = '';
  document.getElementById('cred-error').style.display = 'none';
  document.getElementById('cred-service').textContent = cfg.name || cfg.url;
  document.getElementById('modal-cred').style.display = 'flex';
  setTimeout(() => document.getElementById('cred-user').focus(), 80);
}

async function _doLogin() {
  const user = document.getElementById('cred-user').value.trim();
  const pass = document.getElementById('cred-pass').value;
  if (!user || !pass) { _showCredErr('Enter username and password'); return; }
  const btn = document.getElementById('cred-ok');
  btn.disabled = true; btn.textContent = 'Signing in\u2026';
  try {
    const r = await fetch('https://www.arcgis.com/sharing/rest/generateToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: user, password: pass,
        referer: window.location.origin || 'https://localhost',
        expiration: '120', f: 'json'
      })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    _hideCredModal();
    const cb = _credCB; _credCB = null;
    if (cb && cb.onSuccess) cb.onSuccess(data.token);
  } catch(e) {
    _showCredErr(e.message || 'Authentication failed');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

function _showCredErr(msg) {
  const el = document.getElementById('cred-error');
  el.textContent = msg; el.style.display = '';
}
function _hideCredModal() {
  document.getElementById('modal-cred').style.display = 'none';
  document.getElementById('cred-user').value = '';
  document.getElementById('cred-pass').value = '';
}

document.getElementById('cred-ok').addEventListener('click', _doLogin);
document.getElementById('cred-pass').addEventListener('keydown', e => { if (e.key === 'Enter') _doLogin(); });
document.getElementById('cred-cancel').addEventListener('click', () => {
  _hideCredModal();
  const cb = _credCB; _credCB = null;
  if (cb && cb.onCancel) cb.onCancel();
});

/* ===== CONFIG SAVE / LOAD ===== */
const _CFG_KEY = 'navitron_custom_maps';

function _getSslExceptions() {
  try { return JSON.parse(localStorage.getItem('navitron_ssl_exceptions') || '[]'); } catch(_) { return []; }
}

function _autoSaveConfig() {
  try {
    localStorage.setItem(_CFG_KEY, JSON.stringify({
      v: 1, maps: customMapConfigs, sslExceptions: _getSslExceptions()
    }));
  } catch(e) {}
}

function _importConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.maps)) { toastMsg('Invalid file', 'error'); return; }
  let added = 0;
  cfg.maps.forEach(c => {
    if (!c.id || !c.type || !c.url) return;
    if (BASEMAPS[c.id]) return;
    const n = parseInt(c.id.replace('custom_ws_',''));
    if (!isNaN(n)) wsCounter = Math.max(wsCounter, n);
    // Overlay layers: restore directly to map via addLayerToList
    if (c.useAs === 'overlay') {
      if (customMapConfigs.some(e => e.id === c.id)) return; // skip duplicates
      try {
        const layer = _createLayer(c, null);
        if (typeof addLayerToList === 'function') {
          addLayerToList(layer, c.name, null, null, {
            opacity: c.opacity !== undefined ? c.opacity : 80,
            visible: c.visible !== false,
            color:   c.color || undefined,
            hollow:  c.hollow || false,
            onStateChange: ({ opacity, visible }) => {
              c.opacity = opacity;
              c.visible = visible;
              _autoSaveConfig();
            },
            onColorChange: color => {
              c.color = color;
              _autoSaveConfig();
            },
            onHollowChange: hollow => {
              c.hollow = hollow;
              _autoSaveConfig();
            },
            onDelete: () => {
              const idx = customMapConfigs.indexOf(c);
              if (idx !== -1) customMapConfigs.splice(idx, 1);
              _autoSaveConfig();
            }
          });
        }
        customMapConfigs.push(c);
        added++;
      } catch(e) {}
      return;
    }
    if (c.protected) { BASEMAPS[c.id] = { _needsCreds: true, _cfg: c }; }
    else { try { BASEMAPS[c.id] = _createLayer(c, null); } catch(e) { return; } }
    customMapConfigs.push(c);
    _addBasemapUI(c);
    added++;
  });

  // Import SSL exceptions
  if (Array.isArray(cfg.sslExceptions) && cfg.sslExceptions.length) {
    const existing = _getSslExceptions();
    let sslAdded = 0;
    cfg.sslExceptions.forEach(host => {
      if (!existing.includes(host)) { existing.push(host); sslAdded++; }
      if (typeof cordova !== 'undefined')
        cordova.exec(() => {}, () => {}, 'SslPlugin', 'addTrustedHost', [host]);
    });
    if (sslAdded > 0) {
      localStorage.setItem('navitron_ssl_exceptions', JSON.stringify(existing));
      toastMsg('Loaded ' + sslAdded + ' SSL exception(s)', 'success');
    }
  }

  _autoSaveConfig();
  if (added > 0) toastMsg('Loaded ' + added + ' maps', 'success');
}

function _loadSavedConfig() {
  try { const raw = localStorage.getItem(_CFG_KEY); if (raw) _importConfig(JSON.parse(raw)); } catch(e) {}
}

document.getElementById('btn-cfg-save').addEventListener('click', () => {
  const json = JSON.stringify({ v:1, maps: customMapConfigs, sslExceptions: _getSslExceptions() }, null, 2);
  downloadFile(json, 'navitron-config.json', 'application/json');
});

document.getElementById('cfg-file-input').addEventListener('change', function() {
  const file = this.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try { _importConfig(JSON.parse(e.target.result)); }
    catch(e) { toastMsg('Invalid JSON', 'error'); }
  };
  reader.readAsText(file); this.value = '';
});

_loadSavedConfig();

/* ===== SSL EXCEPTION LISTENER ===== */
document.addEventListener('deviceready', () => {
  if (typeof cordova === 'undefined') return;

  // Push saved exceptions to native layer
  _getSslExceptions().forEach(host => {
    cordova.exec(() => {}, () => {}, 'SslPlugin', 'addTrustedHost', [host]);
  });

  // Listen for new exceptions added via native dialog
  cordova.exec(
    host => {
      const exceptions = _getSslExceptions();
      if (!exceptions.includes(host)) {
        exceptions.push(host);
        localStorage.setItem('navitron_ssl_exceptions', JSON.stringify(exceptions));
        _autoSaveConfig();
        toastMsg('SSL exception saved: ' + host, 'success');
      }
    },
    () => {},
    'SslPlugin', 'listenTrust', []
  );
}, false);

// Load bundled default maps from navitron-config.json (if present in app folder)
fetch('navitron-config.json')
  .then(r => r.ok ? r.json() : null)
  .then(data => { if (data && data.maps && data.maps.length) _importConfig(data); })
  .catch(() => {});

// Ripristina la basemap salvata (dopo che le mappe custom sono state caricate)
(function() {
  try {
    const savedId = localStorage.getItem('navitron_basemap');
    if (!savedId || savedId === 'osm') return;
    const entry = BASEMAPS[savedId];
    if (!entry || entry._needsCreds) return; // non ripristinare mappe protette (richiedono login)
    switchBasemap(savedId);
    const radio = document.querySelector(`input[name="basemap"][value="${savedId}"]`);
    if (radio) radio.checked = true;
  } catch(_) {}
})();

/* ===== BOOKMARKS ===== */
const _BM_KEY = 'navitron_bookmarks';
let bookmarks = [];

function _loadBookmarks() {
  try { bookmarks = JSON.parse(localStorage.getItem(_BM_KEY)) || []; } catch(e) { bookmarks = []; }
  _renderBookmarks();
}

function _saveBookmarks() {
  try { localStorage.setItem(_BM_KEY, JSON.stringify(bookmarks)); } catch(e) {}
}

function addBookmark(name, lat, lon, zoom) {
  const bm = { id: Date.now(), name: (name || '').trim() || 'Bookmark', lat, lon, zoom: zoom || 14 };
  bookmarks.unshift(bm);
  _saveBookmarks();
  _renderBookmarks();
  toastMsg('Bookmark saved: ' + bm.name, 'success');
  // Switch to bookmarks tab
  const bmBtn = document.querySelector('[data-panel="bookmarks"]');
  if (bmBtn) bmBtn.click();
}

function _renderBookmarks() {
  const list = document.getElementById('bookmark-list');
  if (!list) return;
  if (!bookmarks.length) {
    list.innerHTML = '<p class="bookmark-empty">No bookmarks saved</p>';
    return;
  }
  list.innerHTML = '';
  bookmarks.forEach(bm => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const info = document.createElement('div');
    info.className = 'bookmark-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'bookmark-name';
    nameDiv.textContent = bm.name;

    const coordsDiv = document.createElement('div');
    coordsDiv.className = 'bookmark-coords';
    coordsDiv.textContent = `${bm.lat.toFixed(5)}, ${bm.lon.toFixed(5)}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'bookmark-del';
    delBtn.title = 'Remove';
    delBtn.textContent = '\u2715';

    info.appendChild(nameDiv);
    info.appendChild(coordsDiv);
    item.appendChild(info);
    item.appendChild(delBtn);

    item.addEventListener('click', () => { map.flyTo([bm.lat, bm.lon], bm.zoom); });
    delBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      bookmarks = bookmarks.filter(b => b.id !== bm.id);
      _saveBookmarks(); _renderBookmarks();
    });
    list.appendChild(item);
  });
}

document.getElementById('btn-add-bookmark').addEventListener('click', () => {
  const c = map.getCenter();
  const defName = `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
  showPromptModal('Bookmark name:', defName, name => {
    addBookmark(name || defName, c.lat, c.lng, map.getZoom());
  });
});

_loadBookmarks();

/* ===== STATUSBAR SCROLL ARROWS ===== */
(function initSbArrows() {
  const scroll = document.getElementById('sb-scroll');
  const prev   = document.getElementById('sb-prev');
  const next   = document.getElementById('sb-next');
  if (!scroll || !prev || !next) return;

  function update() {
    const atStart = scroll.scrollLeft <= 2;
    const atEnd   = scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 2;
    prev.classList.toggle('faded', atStart);
    next.classList.toggle('faded', atEnd);
  }

  prev.addEventListener('click', () => { scroll.scrollBy({ left: -130, behavior:'smooth' }); });
  next.addEventListener('click', () => { scroll.scrollBy({ left:  130, behavior:'smooth' }); });

  let _sbSaveTimer;
  scroll.addEventListener('scroll', () => {
    update();
    clearTimeout(_sbSaveTimer);
    _sbSaveTimer = setTimeout(() => {
      try { localStorage.setItem('navitron_sb_scroll', scroll.scrollLeft); } catch(_) {}
    }, 300);
  }, { passive: true });
  window.addEventListener('resize', update);

  // Restore saved scroll position; populates coord items first so bar is scrollable
  function _restoreSbScroll() {
    // Ensure statusbar items have real content so scrollWidth > clientWidth
    try { const c = map.getCenter(); updateCoordDisplays(c.lat, c.lng); } catch(_) {}
    try {
      const saved = parseFloat(localStorage.getItem('navitron_sb_scroll'));
      if (!isNaN(saved) && saved > 0) {
        let attempts = 0;
        function trySet() {
          scroll.scrollLeft = saved;
          if (scroll.scrollLeft < saved - 2 && ++attempts < 10) setTimeout(trySet, 400);
          else update();
        }
        trySet();
        return;
      }
    } catch(_) {}
    update();
  }
  setTimeout(_restoreSbScroll, 2200);
})();

/* ===== SPLASH SCREEN ===== */
const _splashStart = performance.now();
window.addEventListener('load', () => {
  const splash  = document.getElementById('splash');
  const elapsed = performance.now() - _splashStart;
  const minShow = 1900;
  const wait    = Math.max(0, minShow - elapsed);
  setTimeout(() => {
    splash.classList.add('hidden');
    setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 600);
  }, wait);
});

document.addEventListener('deviceready', () => {
  window._cordovaReady = true;
  // Cordova WebView may report wrong dimensions at startup — re-measure after layout settles
  setTimeout(() => map.invalidateSize(), 400);
  setTimeout(_requestLocationPermission, 800);
}, { once: true });

function _requestLocationPermission() {
  try {
    const perms = window.cordova && window.cordova.plugins && window.cordova.plugins.permissions;
    if (!perms) return;
    const needed = [perms.ACCESS_FINE_LOCATION, perms.ACCESS_COARSE_LOCATION];
    perms.checkPermission(perms.ACCESS_FINE_LOCATION,
      status => {
        if (status && status.hasPermission) return;
        perms.requestPermissions(needed,
          result => { if (!result || !result.hasPermission) toastMsg('Location denied \u2014 Settings \u203A Apps \u203A Navitron \u203A Permissions', 'error'); },
          ()     => toastMsg('Location denied \u2014 Settings \u203A Apps \u203A Navitron \u203A Permissions', 'error')
        );
      },
      () => perms.requestPermissions(needed, () => {}, () => {})
    );
  } catch(e) {}
}

/* ===== ABOUT MODAL ===== */
document.querySelector('.brand').addEventListener('click', () => {
  document.getElementById('modal-about').style.display = 'flex';
});
document.getElementById('about-close').addEventListener('click', () => {
  document.getElementById('modal-about').style.display = 'none';
});
document.getElementById('modal-about').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});
