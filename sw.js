// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Bump VERSION whenever you change any file in SHELL so phones pick up the new version.
const VERSION = "v1";
const CACHE = `house-upkeep-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/schedule.js",
  "js/store.js",
  "js/starters.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("house-upkeep-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !isFont) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok || res.type === "opaque") cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || (req.mode === "navigate" ? cache.match("index.html") : undefined));
      return cached || network;
    })
  );
});
