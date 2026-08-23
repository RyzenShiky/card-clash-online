/* Card Clash — network-first for JS modules (hindari stale / CONNECTION_RESET palsu) */
const CACHE = "card-clash-v3";
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
    url.includes("agora.io") ||
    url.includes("agora")
  );
}

function isModuleOrScript(req, url) {
  const dest = req.destination;
  if (dest === "script" || dest === "worker") return true;
  if (url.includes("/src/") && (url.endsWith(".js") || url.includes(".js?"))) return true;
  return false;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = req.url;
  if (isBypass(url)) return;

  // JS modules: always network-first (jangan sajikan cache busuk)
  if (isModuleOrScript(req, url)) {
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
          return new Response("// offline: module unavailable", {
            status: 503,
            headers: { "Content-Type": "application/javascript" }
          });
        })
    );
    return;
  }

  // Lainnya: cache fallback
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
  );
});
