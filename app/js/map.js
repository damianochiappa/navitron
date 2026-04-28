'use strict';
/* =====================================================
   MAP — init, basemaps, GPS, coord display, contextmenu
===================================================== */

/* OL map instance (WMS reprojection overlay — initialized after Leaflet) */
let olMap = null;

/* ===== BASEMAP DEFINITIONS ===== */
const BASEMAPS = {
  osm: L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>', maxZoom: 17
  }),
  osm_std: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>', maxZoom: 19
  }),
  google_hybrid: L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg', {
    attribution: '&copy; <a href="https://stadiamaps.com">Stadia Maps</a>, USGS, NASA', maxZoom: 20
  }),
  google_maps: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org">OSM</a>', maxZoom: 20
  }),
  esri_sat: L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; ESRI', maxZoom: 20
  }),
  esri_topo: L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; ESRI', maxZoom: 20
  }),
  natgeo: L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; ESRI / NatGeo', maxZoom: 16
  })
};

/* ===== MAP INIT ===== */
const _savedView = (() => { try { return JSON.parse(localStorage.getItem('navitron_view')); } catch(_) { return null; } })();
const map = L.map('map', {
  center:  (_savedView && _savedView.lat  != null) ? [_savedView.lat, _savedView.lng] : [43.70, 12.36],
  zoom:    (_savedView && _savedView.zoom != null) ? _savedView.zoom : 6,
  bearing: (_savedView && _savedView.bearing != null) ? _savedView.bearing : 0,
  zoomControl: true,
  rotate: true,
  touchRotate: true,
  rotateControl: false
});

let currentBasemap = BASEMAPS.osm;
currentBasemap.addTo(map);

window._panelZTop = 800;
window._navFollowing = true;
window._navSetFollowing = function (v) {
  window._navFollowing = v;
  const b = document.getElementById('nav-follow-badge');
  if (b) b.classList.toggle('hidden', v);
};
map.on('dragstart', () => {
  if (typeof navIsActive === 'function' && navIsActive() && window._navFollowing) {
    window._navFollowing = false;
    const b = document.getElementById('nav-follow-badge');
    if (b) b.classList.remove('hidden');
  }
});
document.getElementById('nav-follow-btn').addEventListener('click', () => {
  window._navFollowing = true;
  document.getElementById('nav-follow-badge').classList.add('hidden');
  if (typeof gpsMarker !== 'undefined' && gpsMarker) map.panTo(gpsMarker.getLatLng(), { animate: true, duration: 0.3 });
});

L.control.scale({ maxWidth: 200, metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

L.control.polylineMeasure({
  position: 'topright', unit: 'kilometres', showBearings: true,
  clearMeasurementsOnStop: false, showClearControl: true, showUnitControl: true
}).addTo(map);

const drawnItems = L.featureGroup().addTo(map);

map.addControl(new L.Control.Draw({
  position: 'topleft',
  edit: { featureGroup: drawnItems, remove: false, poly: { allowIntersection: true } },
  draw: {
    polygon:  { allowIntersection: true, showArea: true },
    polyline: { shapeOptions: { color: '#4f8ef7', weight: 3 } },
    rectangle:{ shapeOptions: { color: '#f0a830', weight: 2 } },
    circle:   { shapeOptions: { color: '#52c97e', weight: 2 } },
    marker: true, circlemarker: false
  }
}));

/* ===== OPENLAYERS (WMS overlay with reprojection) ===== */
/* Uses a separate div (#ol-map) inside #map at z-index 250 —
   above Leaflet tile pane (200) but below overlay/marker/popup panes.
   OL requests WMS in the server's native CRS (e.g. EPSG:4258) and
   reprojects to EPSG:3857 for pixel-perfect alignment with the basemap.
   All OL interactions are disabled; pointer-events:none on the div
   ensures Leaflet handles every touch/click event. */
(function _initOlMap() {
  if (!window.ol) return;

  // Register EPSG:4258 (ETRS89) and EPSG:6706 for Italian/EU WMS servers
  if (window.proj4) {
    proj4.defs('EPSG:4258', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs');
    proj4.defs('EPSG:6706', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs');
    ol.proj.proj4.register(proj4);
  }

  const c = map.getCenter();
  olMap = new ol.Map({
    target: document.getElementById('ol-map'),
    controls: [],
    interactions: [],
    layers: [],
    view: new ol.View({
      projection: 'EPSG:3857',
      center: ol.proj.fromLonLat([c.lng, c.lat]),
      resolution: 156543.033928041 / Math.pow(2, map.getZoom())
    })
  });

  // Sync container size after layout stabilizes (Android can report wrong size at init)
  setTimeout(() => { try { olMap.updateSize(); } catch(_) {} }, 300);

  // Keep OL view in sync with Leaflet on every pan/zoom/rotate
  function _syncOlView() {
    if (!olMap) return;
    const mc = map.getCenter();
    const view = olMap.getView();
    view.setCenter(ol.proj.fromLonLat([mc.lng, mc.lat]));
    view.setResolution(156543.033928041 / Math.pow(2, map.getZoom()));
    // Leaflet bearing is degrees CW from north; OL rotation is radians CCW
    view.setRotation(-map.getBearing() * Math.PI / 180);
  }
  map.on('move', _syncOlView);
  map.on('rotate', _syncOlView);
  // Apply initial bearing from saved view
  _syncOlView();
})();

/* ===== DRAW TOOL ACTIVE FLAG ===== */
let mapToolActive = false;
map.on(L.Draw.Event.DRAWSTART,   () => { mapToolActive = true; });
map.on(L.Draw.Event.DRAWSTOP,    () => { mapToolActive = false; });
map.on(L.Draw.Event.EDITSTART,   () => { mapToolActive = true; });
map.on(L.Draw.Event.EDITSTOP,    () => { mapToolActive = false; });

/* ===== SCREEN WAKE LOCK ===== */
let _wakeLock = null;
async function _acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch(_) {}
}
function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && gpsActive) _acquireWakeLock();
});

/* ===== GPS CONTROL ===== */
let gpsMarker = null, gpsCircle = null, gpsActive = false, gpsFirstFix = false, gpsWatchId = null;

/* ── Flight detection ──
   AGL = GPS ellipsoid altitude − terrain elevation (orthometric ≈ geoid surface).
   The geoid undulation in Italy is ~43 m, so the raw difference underestimates AGL
   by that amount. Threshold 200 m avoids false positives from drones or cliffs. */
const _FLIGHT_AGL_M = 200;
let _gpsTerrainElev = null;
let _gpsWasFlying   = false;
let _smoothBearing  = null;
let _gpsViewCone    = null;
let _prevGpsLL      = null;
let _lastBearingLL  = null;

function _makeNavArrowIcon(heading) {
  const rot = (heading != null && isFinite(heading)) ? heading : 0;
  return L.divIcon({
    html: `<div style="width:32px;height:32px;transform:rotate(${rot}deg);transform-origin:center;` +
          `filter:drop-shadow(0 1px 4px rgba(0,0,0,.6))">` +
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">` +
          `<polygon points="12,2 20,20 12,15 4,20" fill="#4f8ef7" stroke="white" stroke-width="1.5"/>` +
          `</svg></div>`,
    className: '',
    iconSize:    [32, 32],
    iconAnchor:  [16, 16],
    popupAnchor: [0, -18]
  });
}

function _makeAirplaneIcon(heading) {
  const rot = (heading != null && isFinite(heading)) ? heading : 0;
  return L.divIcon({
    html: `<div style="width:34px;height:34px;transform:rotate(${rot}deg);transform-origin:center;` +
          `filter:drop-shadow(0 1px 5px rgba(0,0,0,.7))">` +
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="34" height="34" fill="#4f8ef7">` +
          `<path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19` +
          `l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>` +
          `</svg></div>`,
    className: '',
    iconSize:    [34, 34],
    iconAnchor:  [17, 17],
    popupAnchor: [0, -20]
  });
}

const GpsControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-gps');
    const a = L.DomUtil.create('a', '', div);
    a.href = '#'; a.title = 'GPS location';
    a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); toggleGPS(a); });
    return div;
  }
});
new GpsControl().addTo(map);

function gpsUpdate(pos) {
  const ll  = L.latLng(pos.coords.latitude, pos.coords.longitude);
  const acc = pos.coords.accuracy;
  const spd = pos.coords.speed;
  const alt = pos.coords.altitude;
  const ts  = pos.timestamp || Date.now();

  if (gpsCircle) map.removeLayer(gpsCircle);
  if (gpsMarker) map.removeLayer(gpsMarker);
  gpsCircle = L.circle(ll, { radius: acc, color: '#4f8ef7', fillColor: '#4f8ef7', fillOpacity: 0.12, weight: 1 }).addTo(map);

  const dd   = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
  const mgrs = mgrsForward(ll.lng, ll.lat);
  let utm = '--';
  try { const u = UTM.fromLatLng({lat: ll.lat, lng: ll.lng}); utm = `${u.zone} ${Math.round(u.x)} ${Math.round(u.y)}`; } catch(_) {}

  const gpsDiv = document.createElement('div');
  gpsDiv.style.cssText = 'font-size:12px;font-family:monospace;line-height:1.9;min-width:200px';
  gpsDiv.innerHTML =
    `<div><b>GPS</b> &mdash; Acc: &plusmn;${Math.round(acc)} m` +
    (spd != null ? ` &mdash; ${(spd*3.6).toFixed(1)} km/h` : '') + '</div>' +
    (alt != null ? `<div><b style="color:var(--accent)">ALT&nbsp; </b>${alt.toFixed(0)} m <small style="opacity:0.6">(WGS84)</small></div>` : '') +
    `<div><b style="color:var(--accent)">DD&nbsp;&nbsp; </b>${dd}</div>` +
    `<div><b style="color:var(--accent)">UTM&nbsp; </b>${utm}</div>` +
    `<div><b style="color:var(--accent)">MGRS </b>${mgrs}</div>` +
    `<div><b style="color:var(--accent)">ELEV&nbsp;</b><span id="gps-popup-elev">fetching&hellip;</span></div>`;
  const cpBtn = document.createElement('button');
  cpBtn.className = 'draw-save-btn'; cpBtn.style.marginTop = '4px';
  cpBtn.textContent = '\uD83D\uDCCB Copy coordinates';
  cpBtn.addEventListener('click', () => {
    const text = `DD: ${dd}\nUTM: ${utm}\nMGRS: ${mgrs}`;
    if (navigator.clipboard) navigator.clipboard.writeText(text)
      .then(() => toastMsg('GPS coordinates copied', 'success')).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  });
  gpsDiv.appendChild(cpBtn);

  // Determine flying state using last known terrain elevation
  const _agl = (alt != null && _gpsTerrainElev != null) ? (alt - _gpsTerrainElev) : null;
  const _isFlying = _agl != null && _agl > _FLIGHT_AGL_M;

  if (_isFlying !== _gpsWasFlying) {
    _gpsWasFlying = _isFlying;
    toastMsg(_isFlying ? '\u2708 Flight mode — AGL ' + Math.round(_agl) + ' m' : 'Ground mode', _isFlying ? 'success' : '');
    const fp = document.getElementById('flight-panel');
    if (fp) {
      fp.classList.toggle('hidden', !_isFlying);
      if (_isFlying) fp.style.zIndex = ++window._panelZTop;
    }
  }

  // Update flight panel values on every flying fix
  if (_isFlying) {
    const hdg = pos.coords.heading;
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    const dir  = (hdg != null && isFinite(hdg)) ? ' ' + dirs[Math.round(hdg / 45) % 8] : '';
    const _setFp = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _setFp('fp-spd', spd != null && spd >= 0 ? Math.round(spd * 3.6) : '--');
    _setFp('fp-agl', _agl != null ? Math.round(_agl) : '--');
    _setFp('fp-alt', alt != null ? Math.round(alt) : '--');
    _setFp('fp-hdg', hdg != null && isFinite(hdg) ? Math.round(hdg) + dir : '--');
  }

  if (_isFlying) {
    gpsMarker = L.marker(ll, { icon: _makeAirplaneIcon(pos.coords.heading), zIndexOffset: 1000 })
      .addTo(map).bindPopup(gpsDiv, { maxWidth: 260 });
  } else if (!_isFlying && typeof navIsActive === 'function' && navIsActive() && _smoothBearing != null) {
    gpsMarker = L.marker(ll, { icon: _makeNavArrowIcon(_smoothBearing), zIndexOffset: 1000 })
      .addTo(map).bindPopup(gpsDiv, { maxWidth: 260 });
  } else {
    gpsMarker = L.circleMarker(ll, { radius: 8, color: '#4f8ef7', fillColor: '#fff', fillOpacity: 1, weight: 3 })
      .addTo(map).bindPopup(gpsDiv, { maxWidth: 260 });
  }

  // Fetch terrain elevation: updates popup label + refreshes _gpsTerrainElev for next fix
  if (typeof fetchElevation === 'function') {
    fetchElevation(ll.lat, ll.lng).then(val => {
      if (val != null) _gpsTerrainElev = val;
      const el = document.getElementById('gps-popup-elev');
      if (el) el.textContent = val != null ? val + ' m' + (_agl != null ? '  (AGL ' + Math.round(_agl) + ' m)' : '') : '--';
    });
  }

  if (!gpsFirstFix) { gpsFirstFix = true; map.setView(ll, Math.max(map.getZoom(), 15)); }
  else if (typeof navIsActive === 'function' && navIsActive() && window._navFollowing) { map.panTo(ll, { animate: true, duration: 0.3 }); }

  // Update GPS accuracy in statusbar
  const accItem = document.getElementById('sb-acc-item');
  const accEl   = document.getElementById('sb-acc');
  if (accItem && accEl) {
    accEl.textContent = '\u00b1' + Math.round(acc) + ' m';
    accItem.style.display = '';
  }

  // Update speed in statusbar
  const spdItem = document.getElementById('sb-spd-item');
  const spdEl   = document.getElementById('sb-spd');
  if (spdItem && spdEl) {
    if (spd != null && spd >= 0) {
      spdEl.textContent = (spd * 3.6).toFixed(1) + ' km/h';
      spdItem.style.display = '';
    } else {
      spdItem.style.display = 'none';
    }
  }

  // Update terrain elevation in statusbar (throttled)
  if (typeof updateGpsElevation === 'function') updateGpsElevation(ll.lat, ll.lng);

  // Rotate map to heading during active navigation (ground mode only)
  // Primary: bearing computed from prev→current GPS position (reliable on Android).
  // Fallback: pos.coords.heading if GPS moved < 8 m; then compass when stationary.
  // Low-pass filter (alpha=0.25) smooths all sources.
  if (!_isFlying && typeof navIsActive === 'function' && navIsActive()) {
    let rawBrg = null;
    const _ref = _lastBearingLL || _prevGpsLL;
    if (_ref) {
      const _d = ll.distanceTo(_ref);
      if (_d >= 5) {
        // Spherical bearing ref→current; accumulates across fixes so works at any speed
        const dLng = (ll.lng - _ref.lng) * Math.PI / 180;
        const lat1 = _ref.lat * Math.PI / 180;
        const lat2 = ll.lat * Math.PI / 180;
        rawBrg = (Math.atan2(
          Math.sin(dLng) * Math.cos(lat2),
          Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
        ) * 180 / Math.PI + 360) % 360;
        _lastBearingLL = ll;
      }
    }
    if (rawBrg === null) {
      const _hdg = pos.coords.heading;
      if (_hdg != null && isFinite(_hdg) && spd != null && spd >= 0.6) rawBrg = _hdg;
      else if (typeof window._compassHeading === 'number') rawBrg = window._compassHeading;
    }
    if (rawBrg != null) {
      if (_smoothBearing === null) {
        _smoothBearing = rawBrg;
      } else {
        let diff = rawBrg - _smoothBearing;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        _smoothBearing = (_smoothBearing + 0.35 * diff + 360) % 360;
      }
      map.setBearing(_smoothBearing);
    }
  } else {
    _smoothBearing = null;
    _lastBearingLL = null;
  }

  // View cone: sector polygon showing direction of travel, only during walking navigation
  const _navProf = typeof window.navGetProfile === 'function' ? window.navGetProfile() : 'driving';
  if (!_isFlying && typeof navIsActive === 'function' && navIsActive() && _navProf === 'walking') {
    const _coneBrg = _smoothBearing != null ? _smoothBearing
                   : (pos.coords.heading != null && isFinite(pos.coords.heading)) ? pos.coords.heading
                   : typeof window._compassHeading === 'number' ? window._compassHeading : null;
    if (_coneBrg != null) {
      const _sectorPts = (function(c, brg, halfAng, rM, steps) {
        const pts = [c];
        const cosLat = Math.cos(c.lat * Math.PI / 180);
        for (let i = 0; i <= steps; i++) {
          const a = (brg - halfAng + (2 * halfAng * i / steps)) * Math.PI / 180;
          pts.push(L.latLng(c.lat + (rM / 111320) * Math.cos(a),
                            c.lng + (rM / (111320 * cosLat)) * Math.sin(a)));
        }
        pts.push(c);
        return pts;
      })(ll, _coneBrg, 35, 45, 12);
      if (_gpsViewCone) map.removeLayer(_gpsViewCone);
      _gpsViewCone = L.polygon(_sectorPts, {
        color: '#4f8ef7', weight: 1, opacity: 0.7,
        fillColor: '#4f8ef7', fillOpacity: 0.18
      }).addTo(map);
    }
  } else {
    if (_gpsViewCone) { map.removeLayer(_gpsViewCone); _gpsViewCone = null; }
  }

  _prevGpsLL = ll;

  // Forward to GPS track
  if (typeof trackActive !== 'undefined' && trackActive) updateTrack(ll, alt, ts);
  // Forward to navigation
  if (typeof navGpsUpdate === 'function') navGpsUpdate(ll);
  if (typeof navHudUpdate === 'function') navHudUpdate(ll, spd);
}

function gpsError(err, btn) {
  const msgs = { 1: 'permission denied', 2: 'position unavailable', 3: 'timeout' };
  toastMsg('GPS: ' + (msgs[err.code] || err.message), 'error');
  gpsActive = false; btn.classList.remove('gps-on');
  _releaseWakeLock();
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  const accItem = document.getElementById('sb-acc-item');
  if (accItem) accItem.style.display = 'none';
  const elevItem = document.getElementById('sb-elev-item');
  if (elevItem) elevItem.style.display = 'none';
}

function toggleGPS(btn) {
  if (!navigator.geolocation) { toastMsg('GPS not supported', 'error'); return; }
  if (!gpsActive) {
    gpsActive = true; gpsFirstFix = false;
    btn.classList.add('gps-on');
    _acquireWakeLock();
    gpsWatchId = navigator.geolocation.watchPosition(
      pos => gpsUpdate(pos),
      err => gpsError(err, btn),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  } else {
    gpsActive = false;
    btn.classList.remove('gps-on');
    _releaseWakeLock();
    if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
    if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
    if (gpsCircle) { map.removeLayer(gpsCircle); gpsCircle = null; }
    const _fp = document.getElementById('flight-panel');
    if (_fp) _fp.classList.add('hidden');
    _gpsWasFlying = false;
    const accItem = document.getElementById('sb-acc-item');
    if (accItem) accItem.style.display = 'none';
    const brgItem = document.getElementById('sb-brg-item');
    if (brgItem) brgItem.style.display = 'none';
    const spdItem = document.getElementById('sb-spd-item');
    if (spdItem) spdItem.style.display = 'none';
    const elevItem = document.getElementById('sb-elev-item');
    if (elevItem) elevItem.style.display = 'none';
  }
}

/* ===== KML POPUP SANITIZE ===== */
map.on('popupopen', e => {
  const el = e.popup.getElement();
  if (!el) return;
  el.querySelectorAll('[bgcolor]').forEach(n => n.removeAttribute('bgcolor'));
  el.querySelectorAll('[background]').forEach(n => n.removeAttribute('background'));
  el.querySelectorAll('[color]').forEach(n => n.removeAttribute('color'));
  el.querySelectorAll('[style]').forEach(n => {
    let s = n.getAttribute('style') || '';
    s = s.replace(/background(-color)?:[^;]+;?/gi, '').replace(/\bcolor:[^;]+;?/gi, '');
    n.setAttribute('style', s);
  });
});

/* ===== MAP TOOLS BUTTON ===== */
const MapToolsControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-tools');
    const a = L.DomUtil.create('a', '', div);
    a.href = '#'; a.title = 'Coordinate tools';
    a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 14-8 14S4 15.25 4 10a8 8 0 0 1 8-8z"/></svg>';
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(a, 'click', e => {
      L.DomEvent.preventDefault(e);
      const _mt = document.getElementById('map-tools');
      _mt.classList.toggle('hidden');
      if (!_mt.classList.contains('hidden')) _mt.style.zIndex = ++window._panelZTop;
    });
    return div;
  }
});
new MapToolsControl().addTo(map);

/* ===== TOPBAR SEARCH (Nominatim) ===== */
const topbarSearchInput = document.getElementById('search-input');
const searchClearBtn    = document.getElementById('search-clear');
let searchMarker = null;

topbarSearchInput.addEventListener('input', () => {
  searchClearBtn.style.display = topbarSearchInput.value ? 'flex' : 'none';
});
searchClearBtn.addEventListener('click', () => {
  topbarSearchInput.value = '';
  searchClearBtn.style.display = 'none';
  topbarSearchInput.focus();
});
_attachAddressAutocomplete(
  topbarSearchInput,
  (lat, lon, name) => {
    map.flyTo([+lat, +lon], 14);
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.circleMarker([+lat, +lon], { radius: 8, color: '#4f8ef7', fillColor: '#4f8ef7', fillOpacity: 0.6 })
      .addTo(map).bindPopup(`<b>${name}</b>`).openPopup();
    toastMsg('Found: ' + name.split(',')[0], 'success');
  }
);

/* ===== COORDINATE DISPLAY ===== */
function updateCoordDisplays(lat, lon) {
  const latStr = lat.toFixed(6), lonStr = lon.toFixed(6);
  let utmStr = '--', mgrsStr = '--';
  try { const utm = UTM.fromLatLng({ lat, lng: lon }); utmStr = `${utm.zone} ${Math.round(utm.x)} ${Math.round(utm.y)}`; } catch(e) {}
  mgrsStr = mgrsForward(lon, lat);
  const dmStr = coordToDM(lat, lon);

  document.getElementById('tc-lat').textContent  = latStr;
  document.getElementById('tc-lon').textContent  = lonStr;
  document.getElementById('tc-mgrs').textContent = mgrsStr;
  document.getElementById('sb-lat').textContent  = latStr;
  document.getElementById('sb-lon').textContent  = lonStr;
  document.getElementById('sb-dm').textContent   = dmStr;
  document.getElementById('sb-utm').textContent  = utmStr;
  document.getElementById('sb-mgrs').textContent = mgrsStr;
}

map.on('mousemove', e => updateCoordDisplays(e.latlng.lat, e.latlng.lng));
map.on('move', () => { const c = map.getCenter(); updateCoordDisplays(c.lat, c.lng); });
function _saveView() {
  const c = map.getCenter();
  try { localStorage.setItem('navitron_view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: map.getBearing() })); } catch(_) {}
}

map.on('moveend zoomend rotate', () => {
  _saveView();
  document.getElementById('zoom-level').textContent = map.getZoom();
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _saveView(); });
window.addEventListener('pagehide', _saveView);
document.addEventListener('pause', _saveView, false);

/* ===== CONTEXTMENU ===== */
map.on('contextmenu', e => {
  const pmActive = !!document.querySelector('.polyline-measure-controlOnBgColor');
  if (mapToolActive || pmActive) return;
  const { lat, lng } = e.latlng;
  const dd   = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const dm   = coordToDM(lat, lng);
  const dms  = `${latToDMS(lat)}, ${lonToDMS(lng)}`;
  const mgrs = mgrsForward(lng, lat);
  let utm = '--';
  try { const u = UTM.fromLatLng({lat, lng}); utm = `${u.zone} ${Math.round(u.x)} ${Math.round(u.y)}`; } catch(_) {}

  const div = document.createElement('div');
  div.style.cssText = 'font-size:12px;font-family:monospace;line-height:1.9';
  div.innerHTML =
    `<div><b style="color:var(--accent)">DD&nbsp;&nbsp;&nbsp;</b>${dd}</div>` +
    `<div><b style="color:var(--accent)">DM&nbsp;&nbsp;&nbsp;</b>${dm}</div>` +
    `<div><b style="color:var(--accent)">DMS&nbsp;&nbsp;</b>${dms}</div>` +
    `<div><b style="color:var(--accent)">UTM&nbsp;&nbsp;</b>${utm}</div>` +
    `<div><b style="color:var(--accent)">MGRS&nbsp;</b>${mgrs}</div>` +
    `<div><b style="color:var(--accent)">ELEV&nbsp;&nbsp;</b><span class="ctx-elev">fetching&hellip;</span></div>`;

  // Async elevation fetch for contextmenu
  if (typeof fetchElevation === 'function') {
    fetchElevation(lat, lng).then(val => {
      const el = div.querySelector('.ctx-elev');
      if (el) el.textContent = val != null ? val + ' m' : '--';
    });
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'draw-save-btn'; copyBtn.style.marginTop = '6px';
  copyBtn.textContent = '\uD83D\uDCCB Copy all';
  copyBtn.addEventListener('click', () => {
    const text = `DD: ${dd}\nDM: ${dm}\nDMS: ${dms}\nUTM: ${utm}\nMGRS: ${mgrs}`;
    if (navigator.clipboard) navigator.clipboard.writeText(text)
      .then(() => toastMsg('Coordinates copied', 'success')).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  });
  div.appendChild(copyBtn);

  // Quick add marker
  const mrkBtn = document.createElement('button');
  mrkBtn.className = 'draw-save-btn';
  mrkBtn.style.cssText = 'margin-top:4px;background:linear-gradient(135deg,#4f8ef7,#6c5ce7)';
  mrkBtn.textContent = '\uD83D\uDCCD Add marker here';
  mrkBtn.addEventListener('click', () => {
    map.closePopup();
    const layer = L.marker([lat, lng], { icon: makeEmojiIcon('pos') });
    layer._geoName = ''; layer._geoDesc = ''; layer._geoIcon = 'pos'; layer._geoColor = '#4f8ef7';
    drawnItems.addLayer(layer);
    updateDrawStats(layer);
    _openDrawPopup(layer, 'marker');
  });
  div.appendChild(mrkBtn);

  // Bookmark
  const bmBtn = document.createElement('button');
  bmBtn.className = 'draw-save-btn';
  bmBtn.style.cssText = 'margin-top:4px;background:linear-gradient(135deg,#f5a623,#e67e22)';
  bmBtn.textContent = '\u2B50 Bookmark this position';
  bmBtn.addEventListener('click', () => {
    map.closePopup();
    const defName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    showPromptModal('Bookmark name:', defName, name => {
      addBookmark(name || defName, lat, lng, map.getZoom());
    });
  });
  div.appendChild(bmBtn);

  L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(div).openOn(map);
});

/* ===== RESIZE / ORIENTATION (portrait fix) ===== */
(function() {
  let _rsTimer;
  function _doResize() {
    clearTimeout(_rsTimer);
    _rsTimer = setTimeout(() => {
      try { map.invalidateSize(); } catch(_) {}
      try { if (olMap) olMap.updateSize(); } catch(_) {}
    }, 250);
  }
  window.addEventListener('resize', _doResize);
  window.addEventListener('orientationchange', _doResize);
})();

/* ===== FLIGHT PANEL — drag + close ===== */
(function() {
  const panel = document.getElementById('flight-panel');
  const grip  = panel ? panel.querySelector('.flight-drag-header') : null;
  if (!panel || !grip) return;

  const _fpCol = document.getElementById('flight-collapse');
  if (_fpCol) _fpCol.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    _fpCol.textContent = panel.classList.contains('collapsed') ? '+' : '\u2212';
  });

  let dragging = false, startX, startY, origLeft, origTop;
  function _onStart(cx, cy) {
    dragging = true; startX = cx; startY = cy;
    panel.style.zIndex = ++window._panelZTop;
    if (!panel.style.left || panel.style.bottom) {
      const r = panel.getBoundingClientRect();
      panel.style.bottom = 'auto'; panel.style.right = 'auto';
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
    }
    origLeft = parseFloat(panel.style.left); origTop = parseFloat(panel.style.top);
  }
  function _onMove(cx, cy) {
    if (!dragging) return;
    panel.style.left = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  origLeft + cx - startX)) + 'px';
    panel.style.top  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, origTop  + cy - startY)) + 'px';
  }
  function _onEnd() { dragging = false; }

  grip.addEventListener('mousedown',  e => { _onStart(e.clientX, e.clientY); e.preventDefault(); });
  grip.addEventListener('touchstart', e => { _onStart(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('mousemove',  e => _onMove(e.clientX, e.clientY));
  document.addEventListener('touchmove',  e => { if (dragging) { _onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('mouseup',  _onEnd);
  document.addEventListener('touchend', _onEnd);
})();

/* ===== BASEMAP SWITCHER ===== */
let wsCounter = 0, currentBasemapId = 'osm';
const customMapConfigs = [];

/* Set SSL nocheck once at startup so WMS images load via native HTTP */
document.addEventListener('deviceready', () => {
  if (window.cordova && cordova.plugin && cordova.plugin.http) {
    cordova.plugin.http.setServerTrustMode('nocheck', function(){}, function(){});
  }
});

/* Non-tiled WMS image layer: requests one GetMap image per map view.
   Correct approach for WMS servers (e.g. Italian cadastral) that do not properly
   handle 256×256 tile requests — they return the full-extent image for every
   small-BBOX tile, making the whole country appear repeated in every tile slot.
   This layer instead requests a single image covering the current viewport,
   refreshing on moveend/zoomend.  Fetch is via cordova.plugin.http (SSL nocheck).
   BBOX and CRS are computed from current map bounds — no screen-pixel coordinates
   are used as geographic values. */
const _WMSImageLayer = L.Layer.extend({
  options: { layers:'', version:'1.1.1', crs:null, format:'image/png',
             transparent:true, opacity:0.8, attribution:'' },

  initialize(url, options) {
    this._wmsUrl = url.split('?')[0];
    L.setOptions(this, options);
    this._overlay = null;
    this._reqId   = 0;
  },

  onAdd(map) {
    this._map = map;
    map.on('moveend zoomend resize', this._schedule, this);
    this._schedule();
  },

  onRemove(map) {
    clearTimeout(this._timer);
    map.off('moveend zoomend resize', this._schedule, this);
    this._removeOverlay();
  },

  setOpacity(opacity) {
    this.options.opacity = opacity;
    if (this._overlay) this._overlay.setOpacity(opacity);
  },

  _removeOverlay() {
    if (this._overlay) {
      try { this._map.removeLayer(this._overlay); } catch(_) {}
      this._overlay = null;
    }
  },

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._update(), 300);
  },

  _buildUrl(bounds, size) {
    const crs     = this.options.crs || L.CRS.EPSG4326;
    const crsCode = this.options.crsCode || crs.code || 'EPSG:4326';
    const geoAxes = this.options.geoAxes !== undefined
      ? this.options.geoAxes
      : /^EPSG:(4326|4258|6706)$/.test(crsCode) || crsCode === 'CRS:84';
    const ver   = this.options.version || '1.1.1';
    const isV13 = parseFloat(ver) >= 1.3;
    const sw    = crs.project(bounds.getSouthWest());
    const ne    = crs.project(bounds.getNorthEast());
    // WMS 1.3.0 + geographic CRS: axis order is lat,lon (south,west,north,east)
    // WMS 1.1.x or projected CRS: x,y order (west,south,east,north)
    const bbox  = (isV13 && geoAxes)
      ? [sw.y, sw.x, ne.y, ne.x].join(',')
      : [sw.x, sw.y, ne.x, ne.y].join(',');
    const p = {
      SERVICE:'WMS', VERSION:ver, REQUEST:'GetMap',
      LAYERS:this.options.layers, STYLES:'',
      FORMAT:this.options.format,
      TRANSPARENT:this.options.transparent ? 'TRUE' : 'FALSE',
      WIDTH:size.x, HEIGHT:size.y, BBOX:bbox
    };
    p[isV13 ? 'CRS' : 'SRS'] = crsCode;
    return this._wmsUrl + '?' +
      Object.entries(p).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  },

  _update() {
    const map = this._map;
    if (!map) return;
    const bounds = map.getBounds();
    const size   = map.getSize();
    if (!size.x || !size.y) return;
    const reqId = ++this._reqId;
    const url   = this._buildUrl(bounds, size);
    const _show = dataUrl => {
      if (reqId !== this._reqId) return;
      const prev = this._overlay;
      this._overlay = L.imageOverlay(dataUrl, bounds, {
        opacity:this.options.opacity, zIndex:200
      }).addTo(map);
      if (prev) try { map.removeLayer(prev); } catch(_) {}
    };

    if (window.cordova && cordova.plugin && cordova.plugin.http) {
      cordova.plugin.http.sendRequest(url, { method:'get', responseType:'arraybuffer' },
        res => {
          if (reqId !== this._reqId) return;
          try {
            const bytes = new Uint8Array(res.data);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192)
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            _show('data:image/png;base64,' + btoa(bin));
          } catch(_) {}
        },
        () => {}
      );
    } else {
      _show(url);
    }
  }
});

/* ===== OVERLAY SELECTION (WFS) ===== */
const _selKeys    = new Set();   // stable feature keys — survive WFS reload
const _selLayers  = new Map();   // key → current screen layer (rebuilt after each render)
const _selLabels  = new Map();   // key → label string for cadastral tooltips
const _selFeatures = new Map();  // key → GeoJSON captured at select-time (survives pan/zoom)
const _SEL_STYLE = { color:'#ffcc00', fillColor:'#ffff00', fillOpacity:0.5, weight:2.5 };
let _selMode   = false;         // click-to-select mode active
let _selTarget = null;          // typeName of WFS layer currently targeted (null = any)
let _wfsCount  = 0;             // active WFS layers on map
const _wfsRegistry = [];        // {typeName, name, layer} for each active WFS

function _wfsLayerAdded(wfsLayer) {
  _wfsCount++;
  _wfsRegistry.push({ typeName: wfsLayer.options.typeName, name: wfsLayer.options.attribution, minZoom: wfsLayer.options.minZoom || 14, layer: wfsLayer });
  _selUpdateBadge();
}
function _wfsLayerRemoved(wfsLayer) {
  _wfsCount = Math.max(0, _wfsCount - 1);
  const idx = _wfsRegistry.findIndex(e => e.layer === wfsLayer);
  if (idx !== -1) _wfsRegistry.splice(idx, 1);
  if (_selTarget === wfsLayer.options.typeName) _selModeOff();
  if (!_wfsCount && _selMode) _selModeOff();
  _selUpdateBadge();
}

function _updateWfsPaneZOrder() {
  if (!map) return;
  const baseZ = { 'wfs-particelle': 402, 'wfs-fogli': 404 };
  _wfsRegistry.forEach(e => {
    const paneName = e.layer.options.pane;
    if (!paneName) return;
    const paneEl = map.getPane(paneName);
    if (!paneEl) return;
    // Elevate the target pane above all others so its clicks always fire first
    paneEl.style.zIndex = (_selMode && _selTarget === e.typeName) ? 410 : (baseZ[paneName] || 403);
  });
}

function _selModeOff() {
  _selMode = false; _selTarget = null;
  _hideTargetPicker();
  _updateWfsPaneZOrder();
  const btn = document.getElementById('sel-mode-btn');
  if (btn) { btn.classList.remove('active'); btn.textContent = '\u25CE Select'; }
  const badge = document.getElementById('sel-badge');
  if (badge) badge.classList.remove('mode-active');
}

function _selModeToggle() {
  if (_selMode) { _selModeOff(); return; }
  if (_wfsRegistry.length === 1) {
    // Single WFS — activate immediately, no picker needed
    _selMode = true; _selTarget = _wfsRegistry[0].typeName;
    _updateWfsPaneZOrder();
    const btn = document.getElementById('sel-mode-btn');
    if (btn) { btn.classList.add('active'); btn.textContent = '\u25CE ' + _wfsRegistry[0].name; }
    const badge = document.getElementById('sel-badge');
    if (badge) badge.classList.add('mode-active');
  } else {
    _showTargetPicker();
  }
}

function _showTargetPicker() {
  let picker = document.getElementById('wfs-target-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'wfs-target-picker';
    (document.getElementById('map') || document.body).appendChild(picker);
  }
  picker.innerHTML =
    '<span class="wtp-label">Select on:</span>' +
    _wfsRegistry.map(e =>
      `<button class="wtp-btn" data-type="${e.typeName}">${e.name}</button>`
    ).join('') +
    '<button class="wtp-cancel">Cancel</button>';
  picker.classList.remove('hidden');
  picker.querySelectorAll('.wtp-btn').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const label = b.textContent;
      _selMode = true; _selTarget = b.dataset.type;
      _hideTargetPicker();
      _updateWfsPaneZOrder();
      const modeBtn = document.getElementById('sel-mode-btn');
      if (modeBtn) { modeBtn.classList.add('active'); modeBtn.textContent = '\u25CE ' + label; }
      const _badge = document.getElementById('sel-badge');
      if (_badge) _badge.classList.add('mode-active');
      toastMsg('Selection active: ' + label, 'success');
      _selUpdateBadge();
    });
  });
  picker.querySelector('.wtp-cancel').addEventListener('click', e => {
    e.stopPropagation(); e.preventDefault();
    _hideTargetPicker();
  });
}

function _hideTargetPicker() {
  const p = document.getElementById('wfs-target-picker');
  if (p) p.classList.add('hidden');
}

function _selKey(f) {
  return f.id || JSON.stringify(f.geometry && f.geometry.coordinates);
}

function _selToggle(key, layer, baseStyle, label) {
  if (_selKeys.has(key)) {
    _selKeys.delete(key);
    _selLayers.delete(key);
    _selLabels.delete(key);
    _selFeatures.delete(key);
    try { layer.setStyle(baseStyle); } catch(_) {}
    try { layer.unbindTooltip(); } catch(_) {}
  } else {
    _selKeys.add(key);
    _selLayers.set(key, layer);
    try { const gj = layer.toGeoJSON ? layer.toGeoJSON() : null; if (gj) _selFeatures.set(key, gj); } catch(_) {}
    try { layer.setStyle(_SEL_STYLE); } catch(_) {}
    if (label) {
      _selLabels.set(key, label);
      try {
        const _center = layer.getBounds ? layer.getBounds().getCenter() : null;
        layer.bindTooltip(label, { permanent:true, className:'sel-label', direction:'center', sticky:false, offset:[0,0] });
        if (_center) layer.openTooltip(_center);
      } catch(_) {}
    }
  }
  _selUpdateBadge();
}

function _selExit() {
  _selLayers.forEach((l, k) => {
    try { l.setStyle(l._selBase); } catch(_) {}
    try { l.unbindTooltip(); } catch(_) {}
  });
  _selKeys.clear();
  _selLayers.clear();
  _selLabels.clear();
  _selFeatures.clear();
  _selUpdateBadge();
}

function _selUpdateBadge() {
  const badge = document.getElementById('sel-badge');
  if (!badge) return;
  const zoom = map ? map.getZoom() : 0;
  const hasWfs = _wfsRegistry.some(e => zoom >= e.minZoom);
  const hasSel = _selKeys.size > 0;
  if (hasWfs || hasSel) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    return;
  }
  const countEl  = document.getElementById('sel-badge-count');
  const exportEl = document.getElementById('sel-badge-export');
  const closeEl  = document.getElementById('sel-badge-close');
  if (countEl)  { countEl.textContent = _selKeys.size + ' selected'; countEl.style.display  = hasSel ? '' : 'none'; }
  if (exportEl) { exportEl.style.display = hasSel ? '' : 'none'; exportEl.classList.toggle('lit', hasSel); }
  if (closeEl)  closeEl.style.display  = hasSel ? '' : 'none';
}

function _selExportKML() {
  if (!_selKeys.size) { toastMsg('Nothing selected', 'warn'); return; }
  const features = [];
  _selFeatures.forEach(f => { if (f) features.push(f); });
  if (!features.length) { toastMsg('Cannot export selection', 'error'); return; }
  downloadFile(tokml({ type:'FeatureCollection', features }),
    'selection.kml', 'application/vnd.google-earth.kml+xml');
  toastMsg('Selection exported', 'success');
}

/* ===== ONBOARDING ===== */
(function _initOnboarding() {
  const ob     = document.getElementById('onboarding');
  const track  = document.getElementById('ob-track');
  const dots   = document.querySelectorAll('.ob-dot');
  const nextBtn = document.getElementById('ob-next');
  const skipBtn = document.getElementById('ob-skip');
  const guideBtn = document.getElementById('ob-guide-btn');
  if (!ob) return;
  if (localStorage.getItem('navitron_onboarded')) return;

  ob.classList.remove('hidden');
  let cur = 0;
  const total = dots.length;

  function _goTo(i) {
    cur = Math.max(0, Math.min(total - 1, i));
    track.style.transform = 'translateX(-' + (cur * 100) + '%)';
    dots.forEach((d, idx) => d.classList.toggle('active', idx === cur));
    nextBtn.textContent = cur === total - 1 ? 'Done ✓' : 'Next ›';
  }

  function _close() {
    localStorage.setItem('navitron_onboarded', '1');
    ob.classList.add('hidden');
  }

  nextBtn.addEventListener('click', () => { cur < total - 1 ? _goTo(cur + 1) : _close(); });
  skipBtn.addEventListener('click', _close);
  if (guideBtn) guideBtn.addEventListener('click', () => {
    _close();
    setTimeout(() => {
      const sidebarToggle = document.getElementById('sidebar-toggle');
      const navPanel = document.getElementById('nav-panel');
      if (navPanel && navPanel.classList.contains('hidden') && sidebarToggle) sidebarToggle.click();
      const guideTab = document.querySelector('[data-panel="guide"]');
      if (guideTab) guideTab.click();
    }, 200);
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const exBtn  = document.getElementById('sel-badge-export');
  const clBtn  = document.getElementById('sel-badge-close');
  const modeBtn = document.getElementById('sel-mode-btn');
  if (exBtn)   exBtn.addEventListener('click', _selExportKML);
  if (clBtn)   clBtn.addEventListener('click', _selExit);
  if (modeBtn) modeBtn.addEventListener('click', _selModeToggle);
  if (map) map.on('zoomend', _selUpdateBadge);
});

/* Sort panes inside rotatePane by z-index so DOM order matches visual z-order.
   leaflet-rotate keeps popup/tooltip in norotatePane (a separate sibling above
   rotatePane), so those never need to be touched here. */
function _reorderMapPanes(map) {
  try {
    const rotatePane = map.getPane('rotatePane');
    if (!rotatePane) return;
    const panes = Array.from(rotatePane.children).filter(el => el.classList.contains('leaflet-pane'));
    panes.sort((a, b) => (parseInt(a.style.zIndex) || 0) - (parseInt(b.style.zIndex) || 0));
    panes.forEach(p => rotatePane.appendChild(p));
  } catch(_) {}
}

/* WFS vector feature layer: fetches GeoJSON features per viewport from a
   Web Feature Service.  Only active at zoom >= minZoom (default 15) to avoid
   loading thousands of features at small scales.  Uses EPSG:4326 BBOX.
   Renders as L.geoJSON with styled polygons/points; features are clickable. */
const _WFSLayer = L.Layer.extend({
  options: { typeName:'', version:'2.0.0', minZoom:15, opacity:0.8, crs:null,
             filterAttr:'', filterVals:'', color:null, hollow:false, fillOpacity:null, pane:null,
             style:{ color:'#e63946', weight:1.5, fillOpacity:0.15 }, attribution:'' },

  initialize(url, options) {
    this._wfsUrl = url.split('?')[0];
    L.setOptions(this, options);
    this.options.style = Object.assign({}, this.options.style); // own copy
    if (this.options.color) { this.options.style.color = this.options.color; this.options.style.fillColor = this.options.color; }
    if (this.options.hollow) { this.options.style.fillOpacity = 0; }
    else if (this.options.fillOpacity !== null && this.options.fillOpacity !== undefined) { this.options.style.fillOpacity = this.options.fillOpacity; }
    this._geo = null; this._reqId = 0;
  },

  onAdd(map) {
    this._map = map;
    if (this.options.pane) {
      const paneZindex = { 'wfs-particelle': 402, 'wfs-fogli': 404 };
      if (!map.getPane(this.options.pane)) {
        const p = map.createPane(this.options.pane);
        p.style.zIndex = paneZindex[this.options.pane] || 403;
        // Move into rotatePane so the pane rotates with the map and stays
        // below norotatePane (which holds popups/tooltips)
        const rotatePane = map.getPane('rotatePane');
        if (rotatePane) rotatePane.appendChild(p);
      }
      _reorderMapPanes(map);
    }
    map.on('moveend zoomend', this._schedule, this);
    this._schedule();
    _wfsLayerAdded(this);
  },

  onRemove(map) {
    clearTimeout(this._timer);
    map.off('moveend zoomend', this._schedule, this);
    if (this._geo) { try { map.removeLayer(this._geo); } catch(_) {} this._geo = null; }
    _wfsLayerRemoved(this);
  },

  setOpacity(o) {
    this.options.opacity = o;
    // fillOpacity is a design constant set in initialize — only opacity changes for blending
    if (this._geo) this._geo.setStyle({ opacity: o });
  },

  setStyle(s) {
    Object.assign(this.options.style, s);
    if (this._geo) this._geo.setStyle(this.options.style);
  },

  _schedule() { clearTimeout(this._timer); this._timer = setTimeout(() => this._update(), 400); },

  _update() {
    const map = this._map;
    if (!map) return;
    if (map.getZoom() < this.options.minZoom) {
      if (this._geo) { try { map.removeLayer(this._geo); } catch(_) {} this._geo = null; }
      const now = Date.now();
      if (!this._lastZoomWarn || now - this._lastZoomWarn > 5000) {
        toastMsg('Zoom to level ' + this.options.minZoom + '+ to load features', 'warn');
        this._lastZoomWarn = now;
      }
      return;
    }
    const b = map.getBounds();
    const reqId = ++this._reqId;
    const ver  = parseFloat(this.options.version || '2.0');
    const srsName = this.options.crs || (ver >= 2.0 ? 'urn:ogc:def:crs:EPSG::4326' : 'EPSG:4326');
    const geoUrn  = /^urn:ogc:def:crs:/.test(srsName);
    const geoEpsg = /^EPSG:(4326|4258|6706|4230)$/.test(srsName);
    // WFS 2.0 + geographic CRS → lat/lon axis order (INSPIRE spec); WFS 1.x → traditional lon/lat
    const latFirst = geoUrn || (ver >= 2.0 && geoEpsg);
    const bbox = latFirst
      ? `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()},${srsName}`
      : ver >= 1.1
        ? `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},${srsName}`
        : `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const p = {
      SERVICE:'WFS', VERSION: this.options.version, REQUEST:'GetFeature',
      TYPENAMES: this.options.typeName,
      TYPENAME:  this.options.typeName,
      BBOX: bbox,
      SRSNAME: srsName,
      maxFeatures: 2000, count: 2000
    };
    if (ver < 2.0) p.outputFormat = 'application/json';
    if (this.options.filterAttr && this.options.filterVals) {
      const vals = this.options.filterVals.split(',')
        .map(v => `'${v.trim().replace(/'/g, "''")}'`);
      p.CQL_FILTER = vals.length > 1
        ? `${this.options.filterAttr} IN (${vals.join(',')})`
        : `${this.options.filterAttr} = ${vals[0]}`;
    }
    const url = this._wfsUrl + '?' +
      Object.entries(p).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');

    const _render = geojson => {
      if (reqId !== this._reqId) return;
      if (!geojson.features || geojson.features.length === 0) {
        const _hasFilter = this.options.filterAttr && this.options.filterVals;
        toastMsg(_hasFilter
          ? 'WFS: no features match filter — check attribute name and values'
          : 'WFS: no features in current view', 'warn');
        return;
      }
      const prev = this._geo;
      this._selectedLayer = null;
      const self = this;
      const _hlStyle = _SEL_STYLE;
      try {
        const _wfsPane = self.options.pane || null;
        this._geo = L.geoJSON(geojson, {
          style: this.options.style,
          pointToLayer: (f, ll) => L.circleMarker(ll, { radius:5, ...self.options.style, ...(_wfsPane ? { pane: _wfsPane } : {}) }),
          onEachFeature: (f, layer) => {
            if (_wfsPane) try { layer.options.pane = _wfsPane; } catch(_) {}
            const key = _selKey(f);
            layer._selBase = { ...self.options.style };

            // Cadastral label for selected features — try all known field names, handle numeric values
            const _isCadastral = /CadastralParcel|CadastralZoning/.test(self.options.typeName);
            const _fp = f.properties || {};
            const _labelRaw = _isCadastral
              ? ['label','code','number','numero','NUMERO','codice','CODICE','LABEL','CODE','NUMBER']
                  .map(k => (_fp[k] != null && _fp[k] !== '') ? String(_fp[k]) : '')
                  .find(v => v !== '') || null
              : null;

            // Re-apply selection highlight and tooltip if this feature was previously selected
            if (_selKeys.has(key)) {
              _selLayers.set(key, layer);
              try { layer.setStyle(_SEL_STYLE); } catch(_) {}
              const existingLabel = _selLabels.get(key);
              if (existingLabel) try { layer.bindTooltip(existingLabel, { permanent:true, className:'sel-label', direction:'auto' }); } catch(_) {}
            }

            layer.on('click', () => {
              if (!_selMode) return;
              layer._blockNextPopup = true;
              if (_selTarget && self.options.typeName !== _selTarget) return;
              _selToggle(key, layer, self.options.style, _labelRaw);
            });

            layer.on('popupopen', () => {
              if (layer._blockNextPopup) {
                layer._blockNextPopup = false;
                layer.closePopup();
              }
            });

            const p = f.properties;
            const popupEl = document.createElement('div');
            if (p && Object.keys(p).length) {
              const rows = Object.entries(p).slice(0, 8)
                .map(([k,v]) => `<tr><td style="opacity:.65;padding-right:6px">${k}</td><td>${v ?? ''}</td></tr>`)
                .join('');
              const tbl = document.createElement('table');
              tbl.style.cssText = 'font-size:11px;font-family:monospace;margin-bottom:6px';
              tbl.innerHTML = rows;
              popupEl.appendChild(tbl);
            }
            const selBtn = document.createElement('button');
            selBtn.style.cssText = 'font-size:11px;padding:3px 10px;cursor:pointer;background:var(--accent);color:#fff;border:none;border-radius:4px;width:100%';
            selBtn.textContent = _selKeys.has(key) ? '✓ Deselect' : '☆ Select';
            selBtn.addEventListener('click', e => {
              e.stopPropagation();
              _selToggle(key, layer, self.options.style, _labelRaw);
              selBtn.textContent = _selKeys.has(key) ? '✓ Deselect' : '☆ Select';
            });
            popupEl.appendChild(selBtn);
            layer.bindPopup(popupEl, { maxWidth:500, className:'wfs-popup' });
          }
        }).addTo(map);
        // Remove old layer; clear stale screen refs for layers that left the viewport
        if (prev) {
          try {
            prev.eachLayer(l => {
              const k = [..._selLayers.entries()].find(([,v]) => v === l)?.[0];
              if (k) _selLayers.delete(k);
            });
          } catch(_) {}
          try { map.removeLayer(prev); } catch(_) {}
        }
        _selUpdateBadge();
      } catch(_) {}
    };

    // Manual GML 3.2 / GML 2 DOM parser — handles non-standard namespaces (e.g. MapServer).
    // swapAxes=true for urn:ogc:def:crs:EPSG::4326 (server returns lat,lon → swap to lon,lat for GeoJSON).
    const _parseGmlManual = (text, swapAxes) => {
      try {
        const dom = new DOMParser().parseFromString(text, 'application/xml');
        if (dom.querySelector('parsererror')) return null;
        const G3 = 'http://www.opengis.net/gml/3.2', G2 = 'http://www.opengis.net/gml';
        const W2 = 'http://www.opengis.net/wfs/2.0', W1 = 'http://www.opengis.net/wfs';
        const root = dom.documentElement;

        // Not a FeatureCollection at all (e.g. ExceptionReport) — surface as network error
        if (root.localName !== 'FeatureCollection') return null;

        const gns = (el, name) => el.getElementsByTagNameNS(G3,name)[0] || el.getElementsByTagNameNS(G2,name)[0];
        const gnsAll = (el, name) => [...el.getElementsByTagNameNS(G3,name), ...el.getElementsByTagNameNS(G2,name)];

        const parsePosList = el => {
          const pl = gns(el,'posList'); if (!pl) return null;
          const n = pl.textContent.trim().split(/\s+/).map(Number), out = [];
          for (let i = 0; i+1 < n.length; i += 2) out.push(swapAxes ? [n[i+1],n[i]] : [n[i],n[i+1]]);
          return out.length ? out : null;
        };
        const parsePolygon = el => {
          const ext = gns(el,'exterior') || gns(el,'outerBoundaryIs'); if (!ext) return null;
          const ring = ext.firstElementChild || ext;
          const ec = parsePosList(ring); if (!ec) return null;
          const rings = [ec];
          gnsAll(el,'interior').concat(gnsAll(el,'innerBoundaryIs')).forEach(i => {
            const c = parsePosList(i.firstElementChild || i); if (c) rings.push(c);
          });
          return rings;
        };
        const parseGeom = el => {
          if (!el) return null;
          const ln = el.localName;
          if (ln === 'Point') {
            const pos = gns(el,'pos'); if (!pos) return null;
            const c = pos.textContent.trim().split(/\s+/).map(Number);
            return { type:'Point', coordinates: swapAxes ? [c[1],c[0]] : [c[0],c[1]] };
          }
          if (ln === 'Polygon') { const r = parsePolygon(el); return r ? {type:'Polygon',coordinates:r} : null; }
          if (ln === 'MultiSurface' || ln === 'MultiPolygon') {
            const ms = gnsAll(el,'surfaceMember').concat(gnsAll(el,'polygonMember'));
            const cs = ms.map(m => {
              const poly = m.getElementsByTagNameNS(G3,'Polygon')[0] || m.getElementsByTagNameNS(G2,'Polygon')[0] || m.firstElementChild;
              return parsePolygon(poly);
            }).filter(Boolean);
            return cs.length ? {type:'MultiPolygon',coordinates:cs} : null;
          }
          if (ln === 'LineString') { const c = parsePosList(el); return c ? {type:'LineString',coordinates:c} : null; }
          if (ln === 'MultiCurve' || ln === 'MultiLineString') {
            const ms = gnsAll(el,'curveMember').concat(gnsAll(el,'lineStringMember'));
            const cs = ms.map(m => parsePosList(m.firstElementChild)).filter(Boolean);
            return cs.length ? {type:'MultiLineString',coordinates:cs} : null;
          }
          return null;
        };

        const members = [...dom.getElementsByTagNameNS(W2,'member'), ...dom.getElementsByTagNameNS(W1,'member'),
                         ...dom.getElementsByTagNameNS(G3,'featureMember'), ...dom.getElementsByTagNameNS(G2,'featureMember')];
        const features = [];
        for (const member of members) {
          const fe = member.firstElementChild; if (!fe) continue;
          const props = {};
          // Search for geometry anywhere in the feature using known GML geometry types
          const GEOM_TYPES = ['MultiSurface','MultiPolygon','Polygon','Point','LineString','MultiCurve','MultiLineString'];
          let geometry = null;
          for (const gtype of GEOM_TYPES) {
            const el = fe.getElementsByTagNameNS(G3, gtype)[0] || fe.getElementsByTagNameNS(G2, gtype)[0];
            if (el) { geometry = parseGeom(el); if (geometry) break; }
          }
          // Collect leaf-text properties (skip elements that contain child elements)
          for (const child of fe.children) {
            if (!child.firstElementChild) props[child.localName] = child.textContent.trim();
          }
          if (geometry) features.push({type:'Feature', geometry, properties:props});
        }
        // Return even if empty — valid server response with 0 features in view
        return {type:'FeatureCollection', features};
      } catch(_) { return null; }
    };

    const _parse = text => {
      if (reqId !== this._reqId) return;
      // Try JSON first (GeoServer, QGIS Server, etc.)
      try { _render(JSON.parse(text)); return; } catch(_) {}
      // GML fallback: OL parser first (standard GML), then manual DOM parser (MapServer / non-standard NS)
      const swapAxes = geoUrn || (ver >= 2.0 && geoEpsg); // WFS 2.0 geographic CRS returns lat,lon
      if (window.ol && ol.format) {
        try {
          const feats = new ol.format.WFS().readFeatures(text, { featureProjection: 'EPSG:4326' });
          if (feats && feats.length) {
            _render(JSON.parse(new ol.format.GeoJSON().writeFeatures(feats, { featureProjection: 'EPSG:4326' }))); return;
          }
        } catch(_) {}
        try {
          const feats = ol.format.GML32 ? new ol.format.GML32().readFeatures(text, { featureProjection: 'EPSG:4326' }) : [];
          if (feats && feats.length) {
            _render(JSON.parse(new ol.format.GeoJSON().writeFeatures(feats, { featureProjection: 'EPSG:4326' }))); return;
          }
        } catch(_) {}
      }
      const geojson = _parseGmlManual(text, swapAxes);
      if (geojson !== null) { _render(geojson); return; } // null = not a FeatureCollection (error response)
      // Diagnostic: show what root element the server actually returned
      try {
        const _d = new DOMParser().parseFromString(text, 'application/xml');
        const _root = _d.documentElement;
        const _exc = _d.querySelector('ExceptionText,exceptionText');
        toastMsg('WFS: server returned <' + _root.localName + '>' + (_exc ? ': ' + _exc.textContent.substring(0,60) : ''), 'error');
      } catch(_) { toastMsg('WFS: invalid response', 'error'); }
    };

    if (window.cordova && cordova.plugin && cordova.plugin.http) {
      cordova.plugin.http.sendRequest(url, { method:'get', responseType:'text' },
        res => _parse(res.data),
        () => { if (reqId === this._reqId) toastMsg('WFS request failed', 'error'); }
      );
    } else {
      fetch(url).then(r => r.text()).then(_parse).catch(() => { if (reqId === this._reqId) toastMsg('WFS request failed', 'error'); });
    }
  }
});

/* isOverlay: true  → WMS uses OpenLayers (reprojection support)
              false → WMS uses Leaflet _WMSImageLayer (EPSG:3857 only, for basemap)
   If omitted, auto-detected from cfg.useAs === 'overlay' (config restore). */
function _createLayer(cfg, token, isOverlay) {
  if (isOverlay === undefined) isOverlay = (cfg.useAs === 'overlay');
  const url = cfg.url.replace(/\/?$/, '');
  switch (cfg.type) {
    case 'wfs': {
      if (!cfg.layers) throw new Error('Type name required for WFS — use "Get layers"');
      return new _WFSLayer(cfg.url.split('?')[0], {
        typeName: cfg.layers, version: cfg.version || '2.0.0',
        minZoom: cfg.minZoom !== undefined ? cfg.minZoom : 15,
        crs: cfg.crs || null,
        filterAttr: cfg.filterAttr || '',
        filterVals: cfg.filterVals || '',
        attribution: cfg.name, opacity: cfg.opacity !== undefined ? cfg.opacity / 100 : 0.8,
        color: cfg.color || null,
        hollow: cfg.hollow || false,
        fillOpacity: cfg.fillOpacity !== undefined ? cfg.fillOpacity : null,
        pane: cfg.pane || null
      });
    }
    case 'wms': {
      if (!cfg.layers) throw new Error('Layer name required for WMS — use "Get layers"');
      const wmsUrl = cfg.url.split('?')[0].split('#')[0].replace(/\/?$/, '');

      /* ── Overlay: OpenLayers handles reprojection ──
         OL requests GetMap in the server's native CRS (e.g. EPSG:4258)
         and reprojects the image to EPSG:3857 for alignment with the basemap.
         The Cordova HTTP plugin is used as imageLoadFunction for SSL bypass. */
      if (isOverlay && olMap && window.ol) {
        const ver      = cfg.version || '1.3.0';
        const olSource = new ol.source.ImageWMS({
          url: wmsUrl,
          params: { 'LAYERS': cfg.layers, 'VERSION': ver },
          projection: cfg.crs || 'EPSG:4326',
          crossOrigin: 'anonymous',
          imageLoadFunction: function(image, src) {
            if (window.cordova && cordova.plugin && cordova.plugin.http) {
              cordova.plugin.http.sendRequest(
                src, { method: 'get', responseType: 'arraybuffer' },
                res => {
                  try {
                    const bytes = new Uint8Array(res.data);
                    let bin = '';
                    for (let i = 0; i < bytes.length; i += 8192)
                      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
                    image.getImage().src = 'data:image/png;base64,' + btoa(bin);
                  } catch(_) { image.getImage().src = src; }
                },
                () => { image.getImage().src = src; }
              );
            } else {
              image.getImage().src = src;
            }
          }
        });
        const olLayer = new ol.layer.Image({ source: olSource, opacity: 0.8 });
        olLayer._isOL = true;
        return olLayer;
      }

      /* ── Basemap or OL unavailable: Leaflet WMS ── */
      const _crsCode = cfg.crs || 'EPSG:4326';
      const _isGeo   = /^EPSG:(4326|4258|6706)$/.test(_crsCode) || _crsCode === 'CRS:84';
      return new _WMSImageLayer(wmsUrl, {
        layers: cfg.layers, version: cfg.version || '1.1.1',
        transparent: true, format: 'image/png',
        attribution: cfg.name, opacity: 0.8,
        crs: _crsCode === 'EPSG:3857' ? L.CRS.EPSG3857 : L.CRS.EPSG4326,
        crsCode: _crsCode, geoAxes: _isGeo
      });
    }
    case 'wmts':
      return L.tileLayer(url, { attribution: cfg.name, maxZoom: 21 });
    case 'arcgis': {
      const tUrl = url + '/tile/{z}/{y}/{x}' + (token ? '?token=' + token : '');
      return L.tileLayer(tUrl, { attribution: cfg.name, maxZoom: 21 });
    }
    default: throw new Error('Unsupported type: ' + cfg.type);
  }
}

async function _fetchServiceInfo(url) {
  try {
    const r = await fetch(url.replace(/\/?$/, '') + '?f=json');
    if (r.status === 401 || r.status === 403) return { isProtected: true, wkid: null };
    const j = await r.json();
    const isProtected = !!(j.error && (j.error.code === 499 || j.error.code === 403 || j.error.code === 401));
    const wkid = j.spatialReference?.wkid ?? j.spatialReference?.latestWkid ?? null;
    return { isProtected, wkid };
  } catch(e) { return { isProtected: false, wkid: null }; }
}

function _applyBasemap(id, layer) {
  try { map.removeLayer(currentBasemap); } catch(e) {}
  currentBasemap = layer; currentBasemapId = id;
  try { layer.addTo(map); } catch(e) { toastMsg('Map loading error', 'error'); return; }
  try { if (layer.bringToBack) layer.bringToBack(); } catch(e) {}
  try { localStorage.setItem('navitron_basemap', id); } catch(_) {}
}

function switchBasemap(id) {
  const entry = BASEMAPS[id];
  if (!entry) return;
  if (entry._needsCreds) {
    const prevId = currentBasemapId;
    showCredModal(entry._cfg, token => {
      try {
        const layer = _createLayer(entry._cfg, token);
        BASEMAPS[id] = layer; _applyBasemap(id, layer);
        document.querySelector(`input[name="basemap"][value="${id}"]`).checked = true;
      } catch(e) {
        toastMsg('Error: ' + e.message, 'error');
        document.querySelector(`input[name="basemap"][value="${prevId}"]`).checked = true;
      }
    }, () => {
      document.querySelector(`input[name="basemap"][value="${prevId}"]`).checked = true;
    });
    return;
  }
  _applyBasemap(id, entry);
}

document.querySelectorAll('input[name="basemap"]').forEach(radio => {
  radio.addEventListener('change', () => switchBasemap(radio.value));
});

function _addBasemapUI(cfg) {
  const { id, name } = cfg;
  const list = document.getElementById('basemap-list');
  const label = document.createElement('label');
  label.className = 'basemap-item basemap-item-custom';
  label.innerHTML =
    `<input type="radio" name="basemap" value="${id}">` +
    `<span>${name}${cfg.protected ? ' \uD83D\uDD12' : ''}</span>` +
    `<button class="bm-del" title="Remove map">\u2715</button>`;
  label.querySelector('input').addEventListener('change', () => switchBasemap(id));
  label.querySelector('.bm-del').addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (currentBasemapId === id) {
      try { map.removeLayer(currentBasemap); } catch(e) {}
      currentBasemap = BASEMAPS.osm; currentBasemapId = 'osm';
      currentBasemap.addTo(map);
      try { currentBasemap.bringToBack(); } catch(e) {}
      document.querySelector('input[name="basemap"][value="osm"]').checked = true;
    }
    const entry = BASEMAPS[id];
    if (entry && !entry._needsCreds) { try { map.removeLayer(entry); } catch(e) {} }
    delete BASEMAPS[id];
    const idx = customMapConfigs.findIndex(c => c.id === id);
    if (idx !== -1) customMapConfigs.splice(idx, 1);
    _autoSaveConfig();
    label.remove();
    toastMsg('Map removed', 'success');
  });
  list.appendChild(label);
  return label;
}

/* ===== WMS / WFS FORM ===== */
(function initWsForm() {
  const typeEl    = document.getElementById('ws-type');
  const layersF   = document.getElementById('ws-layers-field');
  const verF      = document.getElementById('ws-ver-field');
  const toggleBtn = document.getElementById('ws-toggle-btn');
  const form      = document.getElementById('ws-form');

  function syncFields() {
    const t = typeEl.value;
    const isWms = t === 'wms';
    const isWfs = t === 'wfs';
    layersF.style.display = (isWms || isWfs) ? '' : 'none';
    verF.style.display    = (isWms || isWfs) ? '' : 'none';
    document.getElementById('ws-crs-field').style.display = (isWms || isWfs) ? '' : 'none';
    document.getElementById('ws-minzoom-field').style.display = isWfs ? '' : 'none';
    document.getElementById('ws-filter-field').style.display = isWfs ? '' : 'none';
    document.getElementById('ws-filter-vals-field').style.display = isWfs ? '' : 'none';
    document.getElementById('ws-layers-select').style.display = 'none';
    // Reset CRS dropdown on type change — capabilities will repopulate it after "Get layers"
    const _crsEl = document.getElementById('ws-crs');
    if (_crsEl) {
      const _defaults = { wms: 'EPSG:4258', wfs: 'EPSG:4258' };
      _crsEl.innerHTML = `<option value="${_defaults[t] || 'EPSG:4326'}">${_defaults[t] || 'EPSG:4326'}</option>`;
    }

    // Update version label + options based on protocol
    const verSel = document.getElementById('ws-version');
    const verLbl = document.getElementById('ws-ver-label');
    if (isWfs) {
      verLbl.textContent = 'WFS version';
      const cur = verSel.value;
      verSel.innerHTML =
        '<option value="2.0.0">2.0.0 (recommended)</option>' +
        '<option value="1.1.0">1.1.0</option>' +
        '<option value="1.0.0">1.0.0</option>';
      if (['2.0.0','1.1.0','1.0.0'].includes(cur)) verSel.value = cur;
    } else {
      verLbl.textContent = 'WMS version';
      const cur = verSel.value;
      verSel.innerHTML =
        '<option value="1.1.1">1.1.1</option>' +
        '<option value="1.3.0">1.3.0</option>';
      if (['1.1.1','1.3.0'].includes(cur)) verSel.value = cur;
    }

    const hints = {
      wms:    'Base endpoint only — e.g.<br><code style="font-size:10px;word-break:break-all">https://wms.cartografia.agenziaentrate.gov.it/inspire/wms/ows01.php</code><br>Paste GetCapabilities URL too — query string is stripped automatically.',
      wfs:    'Base endpoint only — e.g.<br><code style="font-size:10px;word-break:break-all">https://wfs.cartografia.agenziaentrate.gov.it/inspire/wfs/owfs01.php</code><br>GetCapabilities populates layers and CRS automatically.',
      wmts:   'URL template with {z}/{x}/{y} &mdash; e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      arcgis: 'URL up to .../MapServer &mdash; e.g. https://server/.../MapServer'
    };
    document.getElementById('ws-hint').innerHTML = hints[t] || '';
  }
  typeEl.addEventListener('change', syncFields);
  syncFields();

  toggleBtn.addEventListener('click', () => {
    const open = form.style.display !== 'none';
    form.style.display = open ? 'none' : 'flex';
    toggleBtn.innerHTML = open
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add web map'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg> Close';
  });

  function _fillSelect(sel, values, selected) {
    sel.innerHTML = '';
    values.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      if (selected !== undefined && v === selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  document.getElementById('btn-ws-caps').addEventListener('click', () => {
    const url = document.getElementById('ws-url').value.trim();
    const type = typeEl.value;
    if (!url) { toastMsg('Enter URL first', 'error'); return; }
    if (type !== 'wms' && type !== 'wfs') {
      toastMsg('Get layers is available for WMS and WFS only', 'error');
      return;
    }
    const capsBtn = document.getElementById('btn-ws-caps');
    capsBtn.disabled = true; capsBtn.textContent = '…';
    const baseUrl = url.split('?')[0];
    const capsUrl = type === 'wms'
      ? baseUrl + '?SERVICE=WMS&REQUEST=GetCapabilities'
      : baseUrl + '?SERVICE=WFS&REQUEST=GetCapabilities';

    function _done() { capsBtn.disabled = false; capsBtn.textContent = 'Get layers'; }

    function _parseCaps(text) {
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      if (xml.querySelector('parsererror')) { toastMsg('Invalid XML from server', 'error'); return; }

      let names = [];
      if (type === 'wms') {
        // getElementsByTagName works with WMS 1.3.0 namespaces
        names = [...xml.getElementsByTagName('Name')]
          .filter(el => {
            const p = el.parentNode;
            return p && (p.nodeName === 'Layer' || p.localName === 'Layer');
          })
          .map(el => el.textContent.trim()).filter(Boolean);
      } else if (type === 'wfs') {
        // WFS FeatureTypeList / FeatureType / Name
        const ftList = xml.getElementsByTagName('FeatureType');
        names = [...ftList]
          .map(ft => {
            const n = ft.getElementsByTagName('Name')[0];
            return n ? n.textContent.trim() : '';
          })
          .filter(Boolean);
      }

      if (!names.length) {
        toastMsg('No layers found', 'error');
        return;
      }

      const sel = document.getElementById('ws-layers-select');
      _fillSelect(sel, names, names[0]);
      sel.style.display = '';
      sel.onchange = () => { document.getElementById('ws-layers').value = sel.value; };
      document.getElementById('ws-layers').value = names[0];

      // Normalize any EPSG CRS form → EPSG:xxxx
      // Handles: EPSG:4258, urn:ogc:def:crs:EPSG::4258, urn:...EPSG:6.9:4258, http://.../EPSG/0/4258
      const _normCrs = raw => {
        const m = raw.match(/EPSG.*?[:\s\/](\d+)\s*$/i);
        return m ? 'EPSG:' + m[1] : raw.toUpperCase();
      };

      if (type === 'wms') {
        // Extract supported CRS/SRS from capabilities and update dropdown
        const crsCodes = [...new Set(
          [...xml.getElementsByTagName('CRS'), ...xml.getElementsByTagName('SRS')]
            .map(el => _normCrs(el.textContent.trim()))
            .filter(c => c.startsWith('EPSG:'))
        )];
        // Prefer native geographic CRS (INSPIRE servers always support 4258/4326;
        // EPSG:3857 is often advertised but BBOX-ignored for non-native requests)
        const preferred = ['EPSG:4258', 'EPSG:4326', 'EPSG:6706', 'EPSG:3857'];
        const crsSelect = document.getElementById('ws-crs');
        if (crsCodes.length) {
          const supported = preferred.filter(c => crsCodes.includes(c));
          const others = crsCodes.filter(c => !preferred.includes(c)).sort();
          const all = supported.length ? [...supported, ...others] : [...preferred, ...others];
          const best = preferred.find(c => crsCodes.includes(c)) || all[0];
          _fillSelect(crsSelect, all, best);
        }
      } else if (type === 'wfs') {
        // WFS 2.0: DefaultCRS + OtherCRS per FeatureType; WFS 1.x: SRS element
        const rawCodes = [
          ...xml.getElementsByTagName('DefaultCRS'),
          ...xml.getElementsByTagName('DefaultSRS'),
          ...xml.getElementsByTagName('OtherCRS'),
          ...xml.getElementsByTagName('OtherSRS'),
          ...xml.getElementsByTagName('SRS')
        ].map(el => _normCrs(el.textContent.trim())).filter(c => c.startsWith('EPSG:'));
        const crsCodes = [...new Set(rawCodes)];
        // For INSPIRE/Italian servers: EPSG:4258 (ETRS89) is native; prefer geographic over projected
        const preferred = ['EPSG:4258', 'EPSG:4326', 'EPSG:6706', 'EPSG:3857'];
        const crsSelect = document.getElementById('ws-crs');
        if (crsCodes.length) {
          const supported = preferred.filter(c => crsCodes.includes(c));
          const others = crsCodes.filter(c => !preferred.includes(c)).sort();
          const all = supported.length ? [...supported, ...others] : [...preferred, ...others];
          // DefaultCRS is listed first in rawCodes — use it if it's an EPSG code, else fall back to preferred
          const defaultCrs = rawCodes[0];
          const selCrs = defaultCrs || (preferred.find(c => crsCodes.includes(c)) || all[0]);
          _fillSelect(crsSelect, all, selCrs);
        }
      }

      toastMsg(names.length + ' layer' + (names.length > 1 ? 's' : '') + ' found', 'success');
    }

    function _fetchViaFetch() {
      // AbortController safe (AbortSignal.timeout not available on older WebViews)
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      fetch(capsUrl, { signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(text => _parseCaps(text))
        .catch(e => toastMsg('Connection failed: ' + e.message, 'error'))
        .finally(() => { clearTimeout(tid); _done(); });
    }

    if (window.cordova && cordova.plugin && cordova.plugin.http) {
      const doGet = () => {
        cordova.plugin.http.get(capsUrl, {}, {},
          res => { try { _parseCaps(res.data); } catch(e) { toastMsg('Parse error: ' + e.message, 'error'); } _done(); },
          err => {
            const detail = err ? (err.error || err.message || JSON.stringify(err)) : 'unknown';
            toastMsg('Plugin err: ' + detail, 'error');
            try { _fetchViaFetch(); } catch(e) { toastMsg('Fetch err: ' + e.message, 'error'); _done(); }
          }
        );
      };
      cordova.plugin.http.setServerTrustMode('nocheck',
        doGet,
        sslErr => { toastMsg('SSL mode err: ' + JSON.stringify(sslErr), 'error'); doGet(); }
      );
    } else {
      toastMsg('No cordova.plugin.http', 'warn');
      _fetchViaFetch();
    }
  });

  document.getElementById('btn-ws-add').addEventListener('click', async () => {
    const type    = typeEl.value;
    const url     = document.getElementById('ws-url').value.trim();
    const layers  = document.getElementById('ws-layers').value.trim();
    const version = document.getElementById('ws-version').value;
    const crs     = document.getElementById('ws-crs').value;
    const rawName = document.getElementById('ws-name').value.trim();
    const useAs   = (document.getElementById('ws-use') || {}).value || 'basemap';
    if (!url) { toastMsg('Enter URL', 'error'); return; }

    const addBtn = document.getElementById('btn-ws-add');
    addBtn.disabled = true;
    const id   = 'custom_ws_' + (++wsCounter);
    const name = rawName || (type.toUpperCase().replace('-',' ') + ' ' + wsCounter);

    let isProtected = false;
    if (type === 'arcgis') {
      toastMsg('Checking access…', '');
      const info = await _fetchServiceInfo(url);
      isProtected = info.isProtected;
    }

    const minZoomEl = document.getElementById('ws-minzoom');
    const minZoom = (type === 'wfs' && minZoomEl) ? (parseInt(minZoomEl.value) || 15) : undefined;
    const filterAttr = type === 'wfs' ? (document.getElementById('ws-filter-attr').value.trim()) : '';
    const filterVals = type === 'wfs' ? (document.getElementById('ws-filter-vals').value.trim()) : '';
    if ((filterAttr && !filterVals) || (!filterAttr && filterVals))
      toastMsg('WFS filter: fill both attribute name and values, or leave both empty', 'warn');
    const cfg = { id, type, url, name, layers, version, crs, protected: isProtected };
    if (minZoom !== undefined) cfg.minZoom = minZoom;
    if (filterAttr && filterVals) { cfg.filterAttr = filterAttr; cfg.filterVals = filterVals; }

    /* ── Overlay: add on top of current basemap, show in Layers panel ── */
    if (useAs === 'overlay') {
      let layer;
      try { layer = _createLayer(cfg, null, true); }
      catch(e) { toastMsg('Error: ' + e.message, 'error'); addBtn.disabled = false; return; }

      /* Pre-trust WMS hostname so SslPlugin bypasses cert errors silently
         (avoids one dialog per tile overwhelming the UI)                  */
      const _doAddOverlay = () => {
        toastMsg('WMS overlay added — pan/zoom to load image', 'success');
        if (typeof addLayerToList === 'function') {
          addLayerToList(layer, name, null, null, {
            onStateChange: ({ opacity, visible }) => {
              cfg.opacity = opacity;
              cfg.visible = visible;
              if (typeof _autoSaveConfig === 'function') _autoSaveConfig();
            }
          });
        } else {
          // Fallback (addLayerToList not yet loaded): add directly
          if (layer._isOL) { if (olMap) olMap.addLayer(layer); }
          else              { layer.addTo(map); }
        }
        // Persist overlay so it is restored on next launch
        cfg.useAs = 'overlay';
        customMapConfigs.push(cfg);
        if (typeof _autoSaveConfig === 'function') _autoSaveConfig();
        document.getElementById('ws-url').value    = '';
        document.getElementById('ws-name').value   = '';
        document.getElementById('ws-layers').value = '';
        form.style.display = 'none';
        toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add web map';
        addBtn.disabled = false;
      };

      if (window.cordova && typeof cordova.exec === 'function') {
        try {
          const wmsHost = new URL(cfg.url).hostname;
          // Persist in SSL exceptions list (same as existing SslPlugin flow)
          const exceptions = typeof _getSslExceptions === 'function' ? _getSslExceptions() : [];
          if (!exceptions.includes(wmsHost)) {
            exceptions.push(wmsHost);
            try { localStorage.setItem('navitron_ssl_exceptions', JSON.stringify(exceptions)); } catch(_) {}
          }
          // Register with native SslPlugin — on completion add the layer
          cordova.exec(
            () => { setTimeout(_doAddOverlay, 200); },
            () => { _doAddOverlay(); },
            'SslPlugin', 'addTrustedHost', [wmsHost]
          );
        } catch(_) { _doAddOverlay(); }
      } else {
        _doAddOverlay();
      }
      return;
    }

    /* ── Basemap: existing behaviour ── */
    if (isProtected) {
      BASEMAPS[id] = { _needsCreds: true, _cfg: cfg };
    } else {
      try { BASEMAPS[id] = _createLayer(cfg, null); }
      catch(e) { toastMsg('Error: ' + e.message, 'error'); addBtn.disabled = false; return; }
    }

    customMapConfigs.push(cfg);
    _autoSaveConfig();
    const label = _addBasemapUI(cfg);
    label.querySelector('input').click();

    document.getElementById('ws-url').value    = '';
    document.getElementById('ws-name').value   = '';
    document.getElementById('ws-layers').value = '';
    form.style.display = 'none';
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add web map';
    toastMsg('Map added: ' + name, 'success');
    addBtn.disabled = false;
  });
})();