const CACHE_NAME = 'video-guru-cache-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js',
  'https://unpkg.com/mp4-muxer/build/mp4-muxer.js',
  // NEW (v3): Google Fonts stylesheets are requested via <link> tags and a CSS @import in
  // index.html's <head>, but weren't in the precache list - they were only ever getting cached
  // AFTER a successful first online load (same "cache on first use" pattern as MediaPipe/Tesseract).
  // Listing them here explicitly means they're guaranteed cached the moment the app installs, so a
  // Tamil/English UI with the correct custom fonts renders correctly offline even before any of the
  // AI features have been used online once. The actual .woff2 font FILES these stylesheets point to
  // (served from fonts.gstatic.com, a different origin) still get caught by the cross-origin
  // catch-all handler below the first time each one loads - that part doesn't need a fixed list
  // since Google Fonts serves different file URLs per browser/subset.
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@700;900&family=Inter:wght@400;500;600;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Catamaran:wght@900&family=Mukta+Malar:wght@800&display=swap',
  'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@500;700&family=Roboto+Condensed:wght@700&display=swap'
];

// Install Service Worker and Cache Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        // Cache each asset individually instead of cache.addAll().
        // addAll() is all-or-nothing: if even one cross-origin request
        // (e.g. a flaky CDN blip) fails, NOTHING gets cached -- not even
        // local files like index.html. Caching one-by-one with its own
        // .catch() means a single failed asset doesn't take the rest
        // down with it.
        return Promise.all(
          ASSETS_TO_CACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('Precache failed for:', url, err);
            })
          )
        );
      })
      .catch((err) => console.error('Cache open failed:', err))
  );
  self.skipWaiting();
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Safely store a response in the cache.
// Accepts normal 200 responses (type 'basic' for same-origin, 'cors' for
// cross-origin requests that got CORS headers back) AND opaque responses
// (type 'opaque' -- cross-origin requests made in no-cors mode, e.g. a
// <script> tag without a crossorigin attribute). Opaque responses always
// report status 0 / ok:false even when they actually succeeded, because
// the browser hides that info from JS -- so they have to be accepted on
// good faith. This is what lets MediaPipe's / Tesseract's dynamically-
// fetched .wasm / .binarypb / .tflite / .traineddata files get cached even
// though their exact URLs are never known ahead of time and aren't in
// ASSETS_TO_CACHE.
function cacheResponse(request, response) {
  if (!response) return;
  const isNormalOk = response.status === 200 && (response.type === 'basic' || response.type === 'cors');
  const isOpaque = response.type === 'opaque';
  if (!isNormalOk && !isOpaque) return;

  const responseToCache = response.clone();
  caches.open(CACHE_NAME)
    .then((cache) => cache.put(request, responseToCache))
    .catch((err) => console.warn('cache.put failed for:', request.url, err));
}

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Cache API only works with GET. Anything else (rare in this app) just
  // goes straight to the network untouched.
  if (request.method !== 'GET') return;

  const url = request.url;

  // Skip blob:/data: requests (exported video previews, in-memory blobs,
  // OPFS-backed object URLs, etc.) -- these are never real network fetches
  // and the Cache API can't store them anyway.
  if (!url.startsWith(self.location.origin) && !url.startsWith('http')) {
    return;
  }

  const isCrossOrigin = !url.startsWith(self.location.origin);

  if (isCrossOrigin) {
    // CACHE-FIRST for every cross-origin request: fonts (googleapis +
    // gstatic), Font Awesome CSS, mp4-muxer.js, selfie_segmentation.js,
    // Tesseract.js, AND every file MediaPipe/Tesseract fetch at runtime
    // (wasm/binarypb/tflite/traineddata/extra js chunks) from their CDNs.
    // Because this applies to ALL cross-origin GET requests -- not just
    // the fixed list in ASSETS_TO_CACHE -- the first time AI Cutout or OCR
    // runs with a network connection, every file it pulls in gets caught
    // here and cached automatically. From then on (online or fully
    // offline) everything is served straight from cache, no network needed.
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          cacheResponse(request, networkResponse);
          return networkResponse;
        }).catch((err) => {
          console.warn('Offline and not cached yet:', url);
          throw err;
        });
      })
    );
    return;
  }

  // Same-origin app shell (index.html, manifest, icons, sw.js's own
  // requests): network-first so the app updates itself whenever online,
  // falling back to cache when offline. This is what makes "open the app
  // with zero signal" work at all for the app shell itself.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        cacheResponse(request, networkResponse);
        return networkResponse;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // Last-resort SPA fallback: if a same-origin navigation request
        // (e.g. a deep link) isn't cached under its own exact URL, serve
        // the cached index.html shell instead of a browser offline error
        // page, since this is a single-file app with no real routing.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return undefined;
      }))
  );
});
