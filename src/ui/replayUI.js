/**
 * Match Replay viewer
 */
import { fetchReplay, formatEventLine } from "../multiplayer/matchReplay.js";

export async function openReplayModal(roomId) {
    const existing = document.getElementById("replay-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "replay-modal";
    modal.className = "profile-modal-overlay";
    modal.innerHTML = `
      <div class="profile-modal-card" style="max-width:480px">
        <header class="profile-modal-header">
          <h2>Match Replay</h2>
          <button type="button" class="btn btn-secondary replay-close">✕</button>
        </header>
        <div class="profile-modal-body">
          <p class="text-muted" id="replay-meta">Loading…</p>
          <div id="replay-timeline" class="replay-timeline"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector(".replay-close")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    try {
        const { meta, events } = await fetchReplay(roomId);
        const metaEl = modal.querySelector("#replay-meta");
        if (meta) {
            metaEl.textContent = `Winner: ${(meta.winner || "—").toString().slice(0, 8)} · Events: ${events.length}`;
        } else {
            metaEl.textContent = "Belum ada replay data";
        }
        const tl = modal.querySelector("#replay-timeline");
        tl.innerHTML = events
            .map(
                (ev, i) =>
                    `<div class="replay-line"><span class="replay-i">${i + 1}</span> ${escapeHtml(formatEventLine(ev))}</div>`
            )
            .join("") || `<p class="text-muted">Kosong</p>`;
    } catch (e) {
        modal.querySelector("#replay-meta").textContent = e.message || "Gagal load replay";
    }
}

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
