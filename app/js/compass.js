/* Navitron
 * Copyright (C) 2026 Damiano Chiappa
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
'use strict';
/* =====================================================
   COMPASS — map-north indicator, tap to reset to north
   The needle reflects the MAP's bearing (leaflet-rotate), not the device
   magnetometer. On some devices the magnetometer is unreliable and made the
   needle drift/spin at random while standing still; driven by the map it always
   points to true north on the current (possibly track-up) view and never wanders.
===================================================== */

(function () {

  let _svgEl = null;

  function _render() {
    if (!_svgEl) return;
    // setBearing applies CSS rotate(+theta) clockwise, so north on the map sits at
    // that same clockwise angle from screen-up — the needle matches it directly.
    const b = (typeof map.getBearing === 'function') ? map.getBearing() : 0;
    _svgEl.style.transform = 'rotate(' + (b || 0) + 'deg)';
  }

  /* ===== LEAFLET CONTROL ===== */
  const CompassControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-compass');
      const a   = L.DomUtil.create('a', '', div);
      a.href = '#'; a.title = 'Compass — tap to reset map to north';
      a.innerHTML =
        '<svg id="compass-svg" width="20" height="20" viewBox="0 0 24 24" style="display:block;transition:transform .15s ease">' +
          '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>' +
          '<polygon points="12,3 14,11 12,10 10,11"  fill="#ff4757"/>' +
          '<polygon points="12,21 10,13 12,14 14,13" fill="rgba(200,220,255,0.55)"/>' +
          '<circle cx="12" cy="12" r="1.8" fill="currentColor"/>' +
          '<text x="12" y="6.5" font-family="Arial,sans-serif" font-size="4.2" font-weight="900" fill="#ff4757" text-anchor="middle">N</text>' +
        '</svg>';
      _svgEl = a.querySelector('#compass-svg');
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', e => {
        L.DomEvent.preventDefault(e);
        // Reset map bearing to north, recenter on the GPS fix if we have one.
        if (typeof map.setBearing === 'function') map.setBearing(0);
        if (typeof gpsMarker !== 'undefined' && gpsMarker) {
          map.setView(gpsMarker.getLatLng(), map.getZoom(), { animate: true });
        }
        _render();
      });
      _render();
      return div;
    }
  });
  new CompassControl().addTo(map);

  /* Keep the needle in step with the map. leaflet-rotate fires 'rotate' on every
     bearing change — tap reset, touch-rotate gesture, and track-up navigation. */
  map.on('rotate', _render);
  map.whenReady(_render);

})();
