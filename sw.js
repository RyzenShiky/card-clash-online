/* Card Clash SW v8 — safe Response always, full CSS precache */
const CACHE = "card-clash-v8";
const PRECACHE = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./privacy.html",
  "./terms.html",
  "./src/styles/main.css",
  "./src/styles/variables.css",
  "./src/styles/base.css",
  "./src/styles/components.css",
  "./src/styles/loading.css",
  "./src/styles/auth.css",
  "./src/styles/menu.css",
  "./src/styles/lobby.css",
  "./src/styles/game.css",
  "./src/styles/logo.css",
  "./src/styles/cards.css",
  "./src/styles/chat.css",
  "./src/styles/profile.css",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./manifest.json"
];

function offlineHtml() {
  return new Response(
    "<!DOCTYPE html><html><body style=\"font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem;text-align:center\"><h1>Offline</h1><p>Card Clash — tidak ada koneksi. Muat ulang saat online.</p></body></html>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function emptyCss() {
  return new Response("/* offline fallback */", {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function emptyJs() {
  return new Response("/* offline */", {
    status: 200,
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" }
  });
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          PRECACHE.map((url) =>
            c.add(url).catch(() => {
              /* ignore individual precache failures */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isBypass(url) {
  return (
    url.includes("firebase") ||
    url.includes("googleapis") ||
    url.includes("gstatic") ||
    url.includes("emailjs") ||
    url.includes("jsdelivr") ||
    url.includes("googleapis.com")
  );
}

function isStaticAsset(url) {
  return (
    url.includes("/src/styles/") ||
    url.includes("/icons/") ||
    url.endsWith(".css") ||
    url.endsWith(".svg") ||
    url.endsWith(".png") ||
    url.endsWith(".woff2") ||
    url.endsWith(".webmanifest") ||
    url.endsWith("manifest.json")
  );
}

function isJsModule(req, url) {
  if (req.destination === "script" || req.destination === "worker") return true;
  if (url.includes("/src/") && url.includes(".js")) return true;
  return false;
}

/** Always resolve to a Response — never undefined */
async function networkFirst(req, fallbackFactory) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => {});
      } catch (_) {}
      return res;
    }
    const cached = await caches.match(req);
    if (cached) return cached;
    if (res) return res;
    return fallbackFactory ? fallbackFactory() : offlineHtml();
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return fallbackFactory ? fallbackFactory() : offlineHtml();
  }
}

async function cacheFirst(req, fallbackFactory) {
  try {
    const cached = await caches.match(req);
    if (cached) {
      // revalidate in background
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
          }
        })
        .catch(() => {});
      return cached;
    }
  } catch (_) {}
  return networkFirst(req, fallbackFactory);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = req.url;
  } catch (_) {
    return;
  }

  if (isBypass(url)) return;

  if (isJsModule(req, url)) {
    e.respondWith(
      networkFirst(req, () => emptyJs()).catch(() => emptyJs())
    );
    return;
  }

  if (isStaticAsset(url) || req.destination === "style" || req.destination === "image") {
    const fallback = url.endsWith(".css") || req.destination === "style" ? emptyCss : null;
    e.respondWith(
      cacheFirst(req, fallback).catch(() => (fallback ? fallback() : offlineHtml()))
    );
    return;
  }

  // HTML / navigation
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(
      networkFirst(req, offlineHtml).catch(() => offlineHtml())
    );
    return;
  }

  e.respondWith(
    networkFirst(req, offlineHtml).catch(() => offlineHtml())
  );
});
