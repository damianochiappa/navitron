/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
/* =====================================================
   COMPASS — device heading indicator, tap to recenter
===================================================== */

(function () {

  let _svgEl = null;
  let _smooth = null;          // filtered heading, updated on every event
  let _rendered = null;        // last heading actually written to the DOM
  const _ALPHA = 0.25;         // low-pass, same figure the navigation code uses
  const _RENDER_DELTA = 1.5;   // degrees below which a change is sensor noise

  /* ===== LEAFLET CONTROL ===== */
  const CompassControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-compass');
      const a   = L.DomUtil.create('a', '', div);
      a.href = '#'; a.title = 'Compass — tap to recenter on GPS';
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
        // Reset map bearing to north
        if (typeof map.setBearing === 'function') map.setBearing(0);
        if (typeof gpsMarker !== 'undefined' && gpsMarker) {
          map.setView(gpsMarker.getLatLng(), map.getZoom(), { animate: true });
        }
        // Keep the filter in step with the needle we just forced to north,
        // otherwise the next sample can sit inside the threshold and never redraw.
        _smooth = 0; _rendered = 0;
        _svgEl.style.transform = 'rotate(0deg)';
      });
      return div;
    }
  });
  new CompassControl().addTo(map);

  /* ===== DEVICE ORIENTATION ===== */
  function _onOrientation(e) {
    let heading = null;
    if (e.webkitCompassHeading != null) {
      // iOS — already absolute bearing
      heading = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha != null) {
      // Android absolute
      heading = (360 - e.alpha) % 360;
    } else if (e.alpha != null) {
      // Android non-absolute (approx)
      heading = (360 - e.alpha) % 360;
    }
    if (heading == null || _svgEl == null) return;

    /* deviceorientation fires at ~60 Hz and the magnetometer jitters by a
       fraction of a degree even with the device flat on a table. Writing the
       transform on every event therefore repainted this control continuously —
       and with it the whole bottom-right corner it shares with the other
       controls and the attribution, which is what read as a flicker with the
       map completely still and GPS off.

       The filter always updates, the DOM does not: dropping sub-threshold
       samples from the calculation too would mean a slow rotation never
       registered at all. The smoothed value accumulates until it has genuinely
       moved, so noise stops writing while real rotation still gets through. */
    if (_smooth == null) _smooth = heading;
    else {
      // Shortest signed delta, wrap-safe: without this, 359° -> 1° reads as
      // -358 instead of +2 and the needle spins the long way round.
      const d = ((heading - _smooth + 540) % 360) - 180;
      _smooth = (_smooth + _ALPHA * d + 360) % 360;
    }
    window._compassHeading = _smooth;
    if (_rendered == null ||
        Math.abs(((_smooth - _rendered + 540) % 360) - 180) >= _RENDER_DELTA) {
      _rendered = _smooth;
      _svgEl.style.transform = 'rotate(' + (-_smooth) + 'deg)';
    }
  }

  if (window.DeviceOrientationEvent) {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ — request permission on first user tap
      document.addEventListener('click', function _req() {
        DeviceOrientationEvent.requestPermission()
          .then(s => { if (s === 'granted') window.addEventListener('deviceorientation', _onOrientation, { passive: true }); })
          .catch(() => {});
        document.removeEventListener('click', _req);
      }, { once: true });
    } else {
      window.addEventListener('deviceorientation', _onOrientation, { passive: true });
    }
  }

})();
