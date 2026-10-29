// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Bump VERSION whenever you change any file in SHELL so phones pick up the new version.
const VERSION = "v9";
const CACHE = `house-upkeep-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/schedule.js",
  "js/store.js",
  "js/starters.js",
  "js/state.js",
  "js/ui.js",
  "js/files.js",
  "js/ics.js",
  "js/task-sheets.js",
  "js/other-sheets.js",
  "js/icons.js",
  "js/swipe.js",
  "js/attachments.js",
  "js/cloud.js",
  "js/config.js",
  "js/sync-core.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache so a new version never precaches old files.
  const fresh = SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
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

// Reminder notifications sent by the daily reminder job.
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "Home upkeep reminder", {
      body: msg.body || "Something in your home is due.",
      tag: msg.tag || "upkeep",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: msg.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(target);
    })
  );
});
