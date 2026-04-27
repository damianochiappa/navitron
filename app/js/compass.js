'use strict';
/* =====================================================
   COMPASS — device heading indicator, tap to recenter
===================================================== */

(function () {

  let _svgEl = null;

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
    window._compassHeading = heading;
    _svgEl.style.transform = 'rotate(' + (-heading) + 'deg)';
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
