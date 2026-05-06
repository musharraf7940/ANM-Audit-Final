const CACHE = "anm-audit-v1";
const URLS = ["./index.html", "./dashboard.html", "./dashboard.css", "./dashboard.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS)));
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});