const CACHE_NAME = 'video-guru-cache-v4';
const APP_SHELL_URL = './index.html';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  // Font Awesome Icons
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  // Google Fonts (தமிழ் மற்றும் ஆங்கில ஃபான்ட்கள் - ஆஃப்லைனுக்காக)
  'https://fonts.googleapis.com/css2?family=Mukta+Malar:wght@800&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@500;700&family=Roboto+Condensed:wght@700&display=swap',
  // Core Libraries
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js',
  'https://unpkg.com/mp4-muxer/build/mp4-muxer.js',
  // Cricket Scorecard OCR Library
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
];

// 1. Install Service Worker and Cache Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache & caching core assets');
        // ஒரு ஃபைல் ஃபெயில் ஆனாலும் மற்ற ஃபைல்கள் கேச் ஆவதை இது தடுக்காது
        return Promise.all(
          ASSETS_TO_CACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('Precache skipped/failed for:', url, err);
            })
          )
        );
      })
      .catch((err) => console.error('Cache open failed:', err))
  );
  self.skipWaiting();
});

// 2. Activate Service Worker and clean up old caches
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

// Cache Response Helper (Handles basic, cors, and opaque responses like wasm/data)
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

// 3. Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Cache API only handles GET requests
  if (request.method !== 'GET') return;

  const url = request.url;

  // Skip non-http schemes (chrome-extension://, blob:, data:, etc.)
  if (!url.startsWith('http')) return;

  // Top-level Navigation (PWA Launch / Page Refresh)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          cacheResponse(request, networkResponse);
          return networkResponse;
        })
        .catch(() =>
          caches.match(APP_SHELL_URL, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./', { ignoreSearch: true }))
        )
    );
    return;
  }

  const isCrossOrigin = !url.startsWith(self.location.origin);

  // Cross-Origin Requests: Cache-First
  // Fonts, MediaPipe wasm/models, Tesseract traineddata, CDN scripts
  if (isCrossOrigin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          cacheResponse(request, networkResponse);
          return networkResponse;
        }).catch((err) => {
          console.warn('Offline and asset not cached:', url);
          throw err;
        });
      })
    );
    return;
  }

  // Same-Origin Requests: Network-First (with Cache Fallback)
  // App updates automatically when online, works offline when disconnected
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        cacheResponse(request, networkResponse);
        return networkResponse;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});