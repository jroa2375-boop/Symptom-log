// Service worker: keeps the app working offline.
// Bump VERSION whenever you change any file so phones pick up the update.

const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime-v1';

const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/options.js',
  'js/migrate.js',
  'js/data.js',
  'js/importer.js',
  'js/analysis.js',
  'js/charts.js',
  'js/views/log.js',
  'js/views/today.js',
  'js/views/patterns.js',
  'js/views/report.js',
  'js/views/settings.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// Third-party files (Chart.js, the font) are cached the first time they load.
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// Fetched at install too, so charts work offline from the very first launch.
const CDN_FILES = ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL).then((c) => c.addAll(FILES)),
      // Best effort: a CDN hiccup must not stop the app from installing.
      caches.open(RUNTIME).then((c) => c.addAll(CDN_FILES)).catch(() => {}),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    // Cache first; these URLs are versioned and don't change.
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network first for the page so updates show up, fall back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  // App files: network first (so all files stay on the same version), with a
  // short timeout so a weak signal in the field falls back to the cache quickly.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch (_) {
        /* offline */
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || network;
    })
  );
});
