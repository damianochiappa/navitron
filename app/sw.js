// Navitron Service Worker - offline tile cache only
// App shell (JS/CSS/HTML) is served directly from APK assets — no caching needed.
const TILE_CACHE = 'navitron-tiles-v1';

// ~4 GB at avg 15 KB/tile → 280 000 tiles
const TILE_MAX   = 280000;
const EVICT_STEP = 5000;

// Lazy-loaded tile count (avoids cache.keys() on every fetch)
let _tileCount = -1;

// Safe mode: when the previous session was killed mid-tile-load, the page
// sets this so we short-circuit cache misses to 503 for a few seconds,
// letting Leaflet show blanks instead of piling up hanging fetches.
let _safeModeUntil = 0;

/* Strip rotating subdomains so tiles cached under 'a.' are found for 'b.' or 'c.'
   Handles: a./b./c. (OSM family) and mt0.-mt3. (Google Maps) */
function _normUrl(url) {
  return url.replace(/^(https?:\/\/)([a-c]|mt\d+)\./, '$1');
}

/* Detect slippy-map tile requests.
   Rule 1 — generic z/x/y path: covers OSM, ArcGIS, WMTS, and any user-added XYZ server.
   Rule 2 — Google query-string tiles: x/y/z in params, not in path. */
function _isTileUrl(url) {
  if (/\/\d+\/\d+\/\d+(\.\w{2,5})?(\?.*)?$/.test(url)) return true;
  return (
    (url.includes('google.com')     && (url.includes('lyrs=') || url.includes('/vt/'))) ||
    (url.includes('googleapis.com') && (url.includes('/kh?')  || url.includes('/vt?')))
  );
}

/* Fetch a tile trying CORS first (readable, cacheable response), then no-cors.
   CORS responses (Access-Control-Allow-Origin: *) render correctly offline.
   No-cors is the fallback only when CORS is rejected at the transport/header
   level (server lacks CORS); in that case the opaque response is the only way
   to get pixels. If CORS succeeds but the server returns a non-ok status
   (429/5xx), we return that status directly — we do NOT retry as no-cors,
   because the response would be identical but opaque, and caching an opaque
   error poisons the cache permanently for that tile.
   Returns null on total network failure. */
async function _fetchTile(request) {
  let corsRejected = false;
  try {
    return await fetch(request.url, { mode: 'cors', credentials: 'omit' });
  } catch (_) { corsRejected = true; }
  if (corsRejected) {
    try {
      return await fetch(request.url, { mode: 'no-cors', credentials: 'omit' });
    } catch (_) {}
  }
  return null;
}

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Delete any old app-shell caches left over from previous versions
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== TILE_CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'safeMode') {
    _safeModeUntil = Number(e.data.until) || 0;
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ ack: true });
  }
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  /* ── Tile requests: cache-first on normalized URL, LRU eviction ── */
  if (_isTileUrl(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const normUrl = _normUrl(url);
        const normReq = new Request(normUrl);
        const cached = await cache.match(normReq, { ignoreVary: true });
        if (cached) return cached;

        if (Date.now() < _safeModeUntil) {
          return new Response('', { status: 503, statusText: 'SafeMode' });
        }

        const response = await _fetchTile(e.request);
        if (!response) {
          return new Response('', { status: 503, statusText: 'Offline' });
        }

        if (response.ok || response.type === 'opaque') {
          if (_tileCount < 0) {
            _tileCount = (await cache.keys()).length;
          }
          if (_tileCount >= TILE_MAX) {
            const keys = await cache.keys();
            const toDelete = Math.min(EVICT_STEP, keys.length);
            for (let i = 0; i < toDelete; i++) await cache.delete(keys[i]);
            _tileCount = Math.max(0, _tileCount - toDelete);
          }
          cache.put(normReq, response.clone());
          _tileCount++;
        }

        return response;
      })
    );
    return;
  }

  /* ── All other requests (app shell, APIs) → pass through to assets/network ── */
});
