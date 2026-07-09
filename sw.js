const CACHE_NAME = 'video-guru-cache-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js',
  'https://unpkg.com/mp4-muxer/build/mp4-muxer.js'
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
// good faith. This is what lets MediaPipe's dynamically-fetched
// .wasm / .binarypb / .tflite files get cached even though their exact
// URLs are never known ahead of time and aren't in ASSETS_TO_CACHE.
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
  // etc.) -- unchanged from before.
  if (!url.startsWith(self.location.origin) && !url.includes('http')) {
    return;
  }

  const isCrossOrigin = !url.startsWith(self.location.origin);

  if (isCrossOrigin) {
    // CACHE-FIRST for every cross-origin request: fonts, mp4-muxer.js,
    // selfie_segmentation.js, AND every file MediaPipe fetches at
    // runtime (wasm/binarypb/tflite/extra js chunks) from jsdelivr.
    // Because this applies to ALL cross-origin GET requests -- not just
    // the fixed list in ASSETS_TO_CACHE -- the first time AI cutout runs
    // with a network connection, every file MediaPipe pulls in gets
    // caught here and cached automatically. From then on (online or
    // fully offline) it's served straight from cache, no network needed.
    //
    // NOTE: the previous version of this handler only cached responses
    // where response.type === 'basic', which is ONLY true for
    // same-origin responses. That check silently rejected every single
    // cross-origin response (mp4-muxer, MediaPipe's JS, and all of its
    // dynamic wasm/model files), so none of them were ever actually
    // being cached by this handler -- that was the core bug.
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          cacheResponse(request, networkResponse);
          return networkResponse;
        });
      })
    );
    return;
  }

  // Same-origin app shell (index.html, manifest, icons): network-first
  // so the app updates itself whenever online, falling back to cache
  // when offline. Unchanged from before.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        cacheResponse(request, networkResponse);
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});
