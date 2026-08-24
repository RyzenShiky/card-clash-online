/**
 * Persistent reconnect / offline banner (bukan alert)
 */
let banner = null;

export function showReconnectBanner(text = "Koneksi terputus. Menyambung kembali…") {
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "reconnect-banner";
        banner.setAttribute("role", "status");
        banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
      background: #b45309; color: #fff; text-align: center;
      padding: 0.55rem 1rem; font-size: 0.875rem; font-weight: 600;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    `;
        document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.style.display = "block";
}

export function hideReconnectBanner() {
    if (banner) banner.style.display = "none";
}

export function showOnlineBannerBrief() {
    showReconnectBanner("Terhubung kembali");
    banner.style.background = "#15803d";
    setTimeout(() => {
        hideReconnectBanner();
        if (banner) banner.style.background = "#b45309";
    }, 1600);
}
