const CACHE = "pharma-v4";
const CORE = ["./", "./index.html", "./app.js", "./manifest.json",
              "./data/seed.js", "./data/prices.js",
              "./vendor/zxing.min.js", "./vendor/fflate.min.js",
              "./vendor/xlsx.min.js", "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const p = new URL(e.request.url).pathname;
  if (/\/(vendor|data)\//.test(p)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return r;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html"))));
});
