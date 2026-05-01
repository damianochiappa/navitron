'use strict';
/* =====================================================
   NAVIGATION — OSRM routing, off-route detection, recalc
===================================================== */

(function () {

  /* ===== STATE ===== */
  let navActive      = false;
  let navProfile     = 'driving';
  let navDestLat     = null;
  let navDestLon     = null;
  let navRoute       = null;       // L.polyline on map
  let navDestMarker  = null;       // destination circle marker
  let navRouteCoords = [];         // [[lat,lng], …] — current route
  let navPickMode      = false;
  let navLastRecalc    = 0;
  let _navTotalDist    = 0;
  let _navTotalDuration = 0;

  const OFF_ROUTE_M     = 50;     // metres before "off route"
  const RECALC_COOLDOWN = 12000;  // ms between automatic recalculations

  /* ===== OSRM ===== */
  const _OSRM_BASE = {
    driving: 'https://router.project-osrm.org/route/v1/driving/',
    walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/',
    cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike/'
  };

  async function _fetchRoute(fromLat, fromLon, toLat, toLon) {
    const base = _OSRM_BASE[navProfile] || _OSRM_BASE.driving;
    const url  = base + `${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('OSRM ' + r.status);
    const j = await r.json();
    if (!j.routes || !j.routes.length) throw new Error('No route found');
    return j.routes[0];
  }

  function _drawRoute(geojsonCoords) {
    // OSRM returns [lon, lat] — convert to Leaflet [lat, lng]
    navRouteCoords = geojsonCoords.map(c => [c[1], c[0]]);
    if (navRoute) map.removeLayer(navRoute);
    navRoute = L.polyline(navRouteCoords, {
      color: '#4f8ef7', weight: 5, opacity: 0.85
    }).addTo(map);
  }

  function _clearRoute() {
    if (navRoute)      { map.removeLayer(navRoute);      navRoute = null; }
    if (navDestMarker) { map.removeLayer(navDestMarker); navDestMarker = null; }
    navRouteCoords = [];
  }

  /* ===== STATUS ===== */
  function _setStatus(msg, color) {
    const el = document.getElementById('nav-status');
    if (el) { el.textContent = msg; el.style.color = color || ''; }
  }

  /* ===== SET DESTINATION ===== */
  function _setDestination(lat, lon, label) {
    navDestLat = lat; navDestLon = lon;
    document.getElementById('nav-dest-input').value = label;
    if (navDestMarker) map.removeLayer(navDestMarker);
    navDestMarker = L.circleMarker([lat, lon], {
      radius: 10, color: '#e05252', fillColor: '#e05252', fillOpacity: 0.85, weight: 2
    }).addTo(map).bindPopup('<b>Destination</b><br>' + label);
    _setStatus('Destination set — press Start', 'var(--accent)');
  }

  /* ===== START NAVIGATION ===== */
  async function _startNav() {
    if (navDestLat == null) { _setStatus('Set a destination first', 'var(--danger)'); return; }
    if (!gpsActive)         { _setStatus('Enable GPS first', 'var(--danger)'); return; }
    if (!gpsMarker)         { _setStatus('Waiting for GPS fix…', ''); return; }

    const ll = gpsMarker.getLatLng();
    _setStatus('Calculating route…', '');
    try {
      const route = await _fetchRoute(ll.lat, ll.lng, navDestLat, navDestLon);
      _drawRoute(route.geometry.coordinates);
      const km  = (route.distance / 1000).toFixed(1);
      const min = Math.round(route.duration / 60);
      _setStatus(km + ' km — ~' + min + ' min', 'var(--success)');
      navActive = true;
      navLastRecalc = 0;
      _navTotalDist     = route.distance;
      _navTotalDuration = route.duration;
      document.getElementById('nav-start-btn').style.display = 'none';
      document.getElementById('nav-stop-btn').style.display  = '';
      const _hud = document.getElementById('nav-hud');
      if (_hud) { _hud.classList.remove('hidden'); _hud.style.zIndex = ++window._panelZTop; }
      if (typeof window._navSetFollowing === 'function') window._navSetFollowing(true);
      // Center on GPS, alza a zoom 17 se inferiore, altrimenti rispetta scelta utente
      const _z = Math.max(map.getZoom(), 17);
      map.setView(ll, _z, { animate: true });
    } catch (e) {
      _setStatus('Error: ' + e.message, 'var(--danger)');
    }
  }

  /* ===== STOP NAVIGATION ===== */
  function _stopNav() {
    navActive = false;
    if (typeof window._navSetFollowing === 'function') window._navSetFollowing(true);
    _clearRoute();
    _setStatus('', '');
    const _hud = document.getElementById('nav-hud');
    if (_hud) _hud.classList.add('hidden');
    document.getElementById('nav-start-btn').style.display = '';
    document.getElementById('nav-stop-btn').style.display  = 'none';
    toastMsg('Navigation stopped', '');
  }

  /* ===== RESET NAVIGATION ===== */
  function _resetNav() {
    _stopNav();
    navDestLat = null; navDestLon = null;
    document.getElementById('nav-dest-input').value = '';
    _setStatus('', '');
    toastMsg('Navigation reset', '');
  }

  /* ===== OFF-ROUTE CHECK (called from map.js gpsUpdate) ===== */
  function _pointToSegDist(p, a, b) {
    const dLat = b[0] - a[0], dLng = b[1] - a[1];
    const len2 = dLat * dLat + dLng * dLng;
    if (len2 === 0) return p.distanceTo(L.latLng(a));
    const t = Math.max(0, Math.min(1,
      ((p.lat - a[0]) * dLat + (p.lng - a[1]) * dLng) / len2));
    return p.distanceTo(L.latLng(a[0] + t * dLat, a[1] + t * dLng));
  }

  function _distToRoute(ll) {
    let min = Infinity;
    for (let i = 1; i < navRouteCoords.length; i++) {
      const d = _pointToSegDist(ll, navRouteCoords[i - 1], navRouteCoords[i]);
      if (d < min) min = d;
    }
    return min;
  }

  window.navIsActive    = () => navActive;
  window.navGetProfile  = () => navProfile;

  window.navGpsUpdate = function (ll) {
    if (!navActive || !navRouteCoords.length) return;
    if (_distToRoute(ll) <= OFF_ROUTE_M) return;
    const now = Date.now();
    if (now - navLastRecalc < RECALC_COOLDOWN) return;
    navLastRecalc = now;
    toastMsg('Off route — recalculating\u2026', 'error');
    _setStatus('Recalculating\u2026', 'var(--danger)');
    _fetchRoute(ll.lat, ll.lng, navDestLat, navDestLon)
      .then(route => {
        if (!navActive) return;
        _drawRoute(route.geometry.coordinates);
        _navTotalDist     = route.distance;
        _navTotalDuration = route.duration;
        const km  = (route.distance / 1000).toFixed(1);
        const min = Math.round(route.duration / 60);
        _setStatus(km + ' km — ~' + min + ' min', 'var(--success)');
      })
      .catch(() => { if (navActive) _setStatus('Recalc failed', 'var(--danger)'); });
  };

  /* ===== LEAFLET CONTROL BUTTON ===== */
  const NavControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-nav');
      const a   = L.DomUtil.create('a', '', div);
      a.href  = '#'; a.title = 'Navigation';
      a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3,11 22,2 13,21 11,13 3,11"/></svg>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', e => {
        L.DomEvent.preventDefault(e);
        const _np = document.getElementById('nav-panel');
        _np.classList.toggle('hidden');
        if (!_np.classList.contains('hidden')) _np.style.zIndex = ++window._panelZTop;
      });
      return div;
    }
  });
  new NavControl().addTo(map);

  /* ===== PROFILE BUTTONS ===== */
  document.querySelectorAll('.nav-profile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-profile-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      navProfile = btn.dataset.profile;
    });
  });

  /* ===== CLOSE PANEL ===== */
  document.getElementById('nav-close').addEventListener('click', () => {
    const _np = document.getElementById('nav-panel');
    _np.classList.toggle('hidden');
    if (!_np.classList.contains('hidden')) _np.style.zIndex = ++window._panelZTop;
  });

  /* ===== PICK MODE ===== */
  const pickBtn = document.getElementById('nav-pick-btn');
  pickBtn.addEventListener('click', () => {
    navPickMode = !navPickMode;
    pickBtn.classList.toggle('active', navPickMode);
    map.getContainer().style.cursor = navPickMode ? 'crosshair' : '';
    if (navPickMode) toastMsg('Tap on map to set destination', '');
  });

  map.on('click', e => {
    if (!navPickMode) return;
    navPickMode = false;
    pickBtn.classList.remove('active');
    map.getContainer().style.cursor = '';
    const { lat, lng } = e.latlng;
    _setDestination(lat, lng, lat.toFixed(5) + ', ' + lng.toFixed(5));
  });

  /* ===== ADDRESS INPUT with autocomplete ===== */
  _attachAddressAutocomplete(
    document.getElementById('nav-dest-input'),
    (lat, lon, name) => _setDestination(lat, lon, name)
  );

  /* ===== START / STOP / RESET ===== */
  document.getElementById('nav-start-btn').addEventListener('click', _startNav);
  document.getElementById('nav-stop-btn').addEventListener('click',  _stopNav);
  document.getElementById('nav-reset-btn').addEventListener('click', _resetNav);

  /* ===== NAV HUD UPDATE (called from map.js gpsUpdate) ===== */
  window.navHudUpdate = function (ll, spd) {
    if (!navActive || navDestLat == null) return;
    const dst = ll.distanceTo(L.latLng(navDestLat, navDestLon));
    const hudSpd     = document.getElementById('nh-spd');
    const hudDst     = document.getElementById('nh-dst');
    const hudDstUnit = document.getElementById('nh-dst-unit');
    const hudEta     = document.getElementById('nh-eta');
    if (hudSpd) hudSpd.textContent = spd != null && spd >= 0 ? Math.round(spd * 3.6) : '--';
    if (hudDst) {
      if (dst >= 1000) { hudDst.textContent = (dst / 1000).toFixed(1); if (hudDstUnit) hudDstUnit.textContent = 'km'; }
      else             { hudDst.textContent = Math.round(dst);          if (hudDstUnit) hudDstUnit.textContent = 'm';  }
    }
    if (hudEta) {
      let eta = '--';
      if (spd != null && spd > 0.5) {
        const sec = dst / spd;
        eta = sec < 3600 ? Math.round(sec / 60) + '' : Math.floor(sec / 3600) + 'h' + String(Math.round((sec % 3600) / 60)).padStart(2, '0');
      } else if (_navTotalDist > 0 && _navTotalDuration > 0) {
        const sec = _navTotalDuration * (dst / _navTotalDist);
        eta = sec < 3600 ? Math.round(sec / 60) + '' : Math.floor(sec / 3600) + 'h' + String(Math.round((sec % 3600) / 60)).padStart(2, '0');
      }
      hudEta.textContent = eta;
    }
  };

  /* ===== DRAG ===== */
  (function () {
    const panel = document.getElementById('nav-panel');
    const header = panel.querySelector('.nav-drag-header');
    let dragging = false, startX, startY, origLeft, origTop;

    function _getPos() {
      const s = panel.style;
      return {
        left: parseFloat(s.left) || 0,
        top:  parseFloat(s.top)  || 0
      };
    }

    function _onStart(cx, cy) {
      dragging = true;
      panel.style.zIndex = ++window._panelZTop;
      startX = cx; startY = cy;
      const pos = _getPos();
      origLeft = pos.left; origTop = pos.top;
      /* switch to absolute positioning driven by left/top */
      if (!panel.style.left) {
        const r = panel.getBoundingClientRect();
        panel.style.bottom = 'auto';
        panel.style.right  = 'auto';
        panel.style.left   = r.left + 'px';
        panel.style.top    = r.top  + 'px';
        origLeft = r.left; origTop = r.top;
      }
    }

    function _onMove(cx, cy) {
      if (!dragging) return;
      const dx = cx - startX, dy = cy - startY;
      const mw = window.innerWidth, mh = window.innerHeight;
      panel.style.left = Math.max(0, Math.min(mw - panel.offsetWidth,  origLeft + dx)) + 'px';
      panel.style.top  = Math.max(0, Math.min(mh - panel.offsetHeight, origTop  + dy)) + 'px';
    }

    function _onEnd() { dragging = false; }

    header.addEventListener('mousedown',  e => { _onStart(e.clientX, e.clientY); e.preventDefault(); });
    header.addEventListener('touchstart', e => { if (e.target.closest('button')) return; e.preventDefault(); _onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    document.addEventListener('mousemove',  e => _onMove(e.clientX, e.clientY));
    document.addEventListener('touchmove',  e => { if (dragging) { _onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup',  _onEnd);
    document.addEventListener('touchend', _onEnd);
  })();

  /* ===== NAV HUD DRAG ===== */
  (function () {
    const hud    = document.getElementById('nav-hud');
    const header = hud.querySelector('.nav-hud-drag-header');
    let dragging = false, startX, startY, origLeft, origTop;

    function _getPos() {
      return { left: parseFloat(hud.style.left) || 0, top: parseFloat(hud.style.top) || 0 };
    }
    function _onStart(cx, cy) {
      dragging = true; startX = cx; startY = cy;
      hud.style.zIndex = ++window._panelZTop;
      if (!hud.style.left) {
        const r = hud.getBoundingClientRect();
        hud.style.bottom = 'auto'; hud.style.right = 'auto';
        hud.style.left = r.left + 'px'; hud.style.top = r.top + 'px';
      }
      const pos = _getPos(); origLeft = pos.left; origTop = pos.top;
    }
    function _onMove(cx, cy) {
      if (!dragging) return;
      const mw = window.innerWidth, mh = window.innerHeight;
      hud.style.left = Math.max(0, Math.min(mw - hud.offsetWidth,  origLeft + cx - startX)) + 'px';
      hud.style.top  = Math.max(0, Math.min(mh - hud.offsetHeight, origTop  + cy - startY)) + 'px';
    }
    function _onEnd() { dragging = false; }

    header.addEventListener('mousedown',  e => { _onStart(e.clientX, e.clientY); e.preventDefault(); });
    header.addEventListener('touchstart', e => { if (e.target.closest('button')) return; e.preventDefault(); _onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    document.addEventListener('mousemove',  e => _onMove(e.clientX, e.clientY));
    document.addEventListener('touchmove',  e => { if (dragging) { _onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup',  _onEnd);
    document.addEventListener('touchend', _onEnd);
  })();

})();
