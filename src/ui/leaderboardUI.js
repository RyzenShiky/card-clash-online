/**
 * Leaderboard modal (realtime)
 */
import { subscribeLeaderboard } from "../multiplayer/leaderboard.js";

export function openLeaderboardModal(handlers = {}) {
    const existing = document.getElementById("lb-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "lb-modal";
    modal.className = "profile-modal-overlay";
    modal.innerHTML = `
      <div class="profile-modal-card" style="max-width:480px">
        <header class="profile-modal-header">
          <h2>Leaderboard · Wins</h2>
          <button type="button" class="btn btn-secondary lb-close">✕</button>
        </header>
        <div class="profile-modal-body">
          <div id="lb-list" class="lb-list">
            <p class="text-muted">Loading…</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
        unsub?.();
        modal.remove();
        handlers.onClose?.();
    };
    modal.querySelector(".lb-close")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    const listEl = modal.querySelector("#lb-list");
    const unsub = subscribeLeaderboard((rows) => {
        if (!rows.length) {
            listEl.innerHTML = `<p class="text-muted">Belum ada data. Main Ranked dulu!</p>`;
            return;
        }
        listEl.innerHTML = rows
            .map(
                (r) => `
          <div class="lb-row">
            <span class="lb-rank">#${r.rank}</span>
            <span class="lb-name">${escapeHtml(r.displayName)}</span>
            <span class="lb-tier">${escapeHtml(r.label)}</span>
            <span class="lb-wins">${r.wins}W</span>
          </div>`
            )
            .join("");
    }, 25);
}

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
