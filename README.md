# Navitron GIS

An offline-capable GIS web app packaged as an Android APK via Apache Cordova. Built and tested entirely on an Android device using Termux + proot-distro.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

<video src="DEMO.mp4" controls width="100%"></video>

---

## Features

- **Maps** — OpenTopoMap, OpenStreetMap, ESRI (Satellite, Topo, NatGeo), Stadia Satellite, CartoDB; custom WMS/WMTS/ArcGIS layers with opacity control
- **Catasto (Italy)** — WMS labels + WFS Parcels and Sheets (Agenzia delle Entrate) preloaded
- **Offline tile cache** — download any basemap within a KML boundary for offline use (Service Worker)
- **GPS** — real-time position, accuracy circle, UTM/MGRS coordinates, terrain elevation (Open-Meteo); flight mode auto-detection (AGL threshold)
- **Navigation** — OSRM routing (driving, cycling, walking); heading-up map rotation with direction arrow; off-route detection and automatic recalculation; speed/distance/ETA HUD; walking view cone
- **Track recording** — GPS track with stats; elevation profile chart; export as GPX or KML
- **Draw & measure** — markers, polylines, polygons, circles; polyline measurement; distance/area calculation
- **KML/KMZ/GeoJSON/GPX import** — layer management, vertex editing, attribute popup, dissolve polygons (turf.js), rename, export
- **WFS** — live vector features with filtering, style customization, selection export to KML
- **Coordinate tools** — go-to by DD/DMS/UTM/MGRS, format converter, bookmarks
- **ArcGIS Online** — token authentication for protected services

---

## Requirements

- Android device (ARM64, Android 10+)
- [Termux](https://github.com/termux/termux-app) + proot-distro (Ubuntu)
- Node.js + Cordova 12 (installed in Termux)
- Android SDK 34 + Java 17 (installed in proot Ubuntu by the build script)

---

## Build

The build runs entirely on-device using Termux. There is no desktop build environment.

**First build** (installs all dependencies automatically):
```bash
bash build_navitron.sh
```

**Incremental build** (assumes first build already completed):
```bash
bash build_navitron_fast.sh
```

> The build scripts contain device-specific paths and are not included in this repository.  
> Adapt `APP_SRC` and `APK_OUTPUT_DIR` to your device's storage paths.

The signed APK is written to `output/Navitron.apk`. Signing uses a local keystore generated at first build.

---

## Private tile providers

The file `app/js/basemaps-private.js` (excluded from this repo via `.gitignore`) can override the default tile URLs at runtime. The HTML loads it silently if present:

```html
<script src="js/basemaps-private.js" onerror="void(0)"></script>
```

Template:
```js
(function () {
  if (typeof BASEMAPS === 'undefined') return;
  BASEMAPS.google_hybrid = L.tileLayer('YOUR_HYBRID_URL/{z}/{x}/{y}', {
    attribution: '...', maxZoom: 20
  });
  BASEMAPS.google_maps = L.tileLayer('YOUR_STREET_URL/{z}/{x}/{y}', {
    attribution: '...', maxZoom: 20
  });
})();
```

---

## License

Copyright (C) 2026 Damiano Chiappa — licensed under **GPL v3**.  
See [LICENSE](LICENSE) for details.

This project is GPL v3 because it uses [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) (GPL v3).  
All other third-party libraries are MIT, BSD-2, or Apache-2.0 — see [NOTICES](NOTICES) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

## Third-party libraries

| Library | License |
|---|---|
| [Leaflet](https://leafletjs.com) | BSD-2-Clause |
| [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) | GPL-3.0 |
| [OpenLayers](https://openlayers.org) | BSD-2-Clause |
| [ESRI Leaflet](https://github.com/Esri/esri-leaflet) | Apache-2.0 |
| [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw) | MIT |
| [Leaflet.PolylineMeasure](https://github.com/ppete2/Leaflet.PolylineMeasure) | MIT |
| [turf.js](https://turfjs.org) | MIT |
| [proj4js](https://github.com/proj4js/proj4js) | MIT |
| [toGeoJSON](https://github.com/mapbox/togeojson) | MIT |
| [JSZip](https://stuk.github.io/jszip) | MIT/GPL |

DEMO:


https://github.com/user-attachments/assets/988fc7ab-d597-40d2-ace7-3db82d9f86b6


