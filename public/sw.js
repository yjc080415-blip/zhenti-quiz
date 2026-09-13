const CACHE = "zhenti-shell-v1";
const SHELL = ["./", "./index.html", "./css/app.css", "./js/quiz.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/audio/") || url.pathname.includes("/data/") || url.pathname.includes("/api/")) {
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
