/**
 * Banner status koneksi — muncul saat offline / reconnect
 */
let el = null;

export function initNetworkBanner() {
  if (el) return;
  el = document.createElement("div");
  el.id = "network-banner";
  el.className = "network-banner hidden";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);

  const sync = () => {
    if (!navigator.onLine) {
      el.textContent = "⚠ Offline — menunggu koneksi…";
      el.classList.remove("hidden", "ok");
      el.classList.add("warn");
    } else {
      el.textContent = "✓ Kembali online";
      el.classList.remove("warn");
      el.classList.add("ok");
      el.classList.remove("hidden");
      setTimeout(() => el.classList.add("hidden"), 2200);
    }
  };

  window.addEventListener("offline", sync);
  window.addEventListener("online", sync);
  if (!navigator.onLine) sync();
}
