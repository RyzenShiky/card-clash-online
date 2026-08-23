/* Card Clash SW v6 — stale-while-revalidate + cache-first untuk aset statis */
const CACHE = "card-clash-v7";
const PRECACHE = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./privacy.html",
  "./terms.html",
  "./src/styles/main.css",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
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
    url.includes("emailjs") ||
    url.includes("jsdelivr")
  );
}

function isStaticAsset(url) {
  return (
    url.includes("/src/styles/") ||
    url.includes("/icons/") ||
    url.endsWith(".css") ||
    url.endsWith(".svg") ||
    url.endsWith(".png") ||
    url.endsWith(".woff2")
  );
}

function isJsModule(req, url) {
  if (req.destination === "script" || req.destination === "worker") return true;
  if (url.includes("/src/") && url.includes(".js")) return true;
  return false;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  if (isBypass(url)) return;

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
        .catch(() => caches.match(req).then((c) => c || fetch(req)))
    );
    return;
  }

  if (isStaticAsset(url) || req.destination === "style" || req.destination === "image") {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
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
