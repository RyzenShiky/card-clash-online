/* Card Clash SW v5 — jangan kembalikan 503 palsu untuk modul JS */
const CACHE = "card-clash-v5";
const ASSETS = ["./", "./index.html", "./src/styles/main.css", "./favicon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isBypass(url) {
  return (
    url.includes("firebase") ||
    url.includes("googleapis") ||
    url.includes("gstatic") ||
    url.includes("agora")
  );
}

function isJsModule(req, url) {
  if (req.destination === "script" || req.destination === "worker") return true;
  if (url.includes("/src/") && (url.includes(".js"))) return true;
  return false;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = req.url;
  if (isBypass(url)) return;

  // Modul JS: network saja. Gagal → coba cache. JANGAN buat Response 503.
  if (isJsModule(req, url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          // Biarkan browser error natural (bukan 503 dari SW)
          return fetch(req);
        })
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((c) => c || caches.match("./index.html"))
      )
  );
});
