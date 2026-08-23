/**
 * Podium hasil pertandingan — semua pemain melihat place, MVP, nama, waktu
 */
function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatTime(ts) {
    if (!ts) return "—";
    try {
        return new Date(ts).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    } catch {
        return "—";
    }
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {object} opts.publicState
 * @param {string} opts.currentUid
 * @param {() => void} opts.onMenu
 * @param {() => void} [opts.onReplay]
 */
export function renderResultsOverlay(container, opts = {}) {
    const { publicState, currentUid, onMenu, onReplay } = opts;
    if (!container) return;

    let overlay = container.querySelector("#results-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "results-overlay";
        overlay.className = "results-overlay";
        container.appendChild(overlay);
    }

    const placements =
        publicState?.placements ||
        publicState?.results?.placements ||
        [];
    const winner = publicState?.winner || publicState?.results?.winner;
    const finishedAt =
        publicState?.results?.finishedAt ||
        placements[0]?.finishedAt ||
        Date.now();

    const sorted = [...placements].sort((a, b) => (a.place || 99) - (b.place || 99));

    // Fallback jika belum ada placements
    let rows = sorted;
    if (!rows.length && winner) {
        rows = [
            {
                place: 1,
                uid: winner,
                name: "Pemenang",
                isMvp: true,
                finishedAt
            }
        ];
    }

    const medal = (place) => {
        if (place === 1) return "🥇";
        if (place === 2) return "🥈";
        if (place === 3) return "🥉";
        return `#${place}`;
    };

    overlay.innerHTML = `
      <div class="results-card">
        <h2 class="results-title">Pertandingan Selesai</h2>
        <p class="results-sub">Waktu: ${escapeHtml(formatTime(finishedAt))}</p>
        <div class="results-list">
          ${rows
              .map((r) => {
                  const me = r.uid === currentUid ? " me" : "";
                  const mvp = r.isMvp || r.place === 1 ? " mvp" : "";
                  return `
            <div class="results-row${me}${mvp}">
              <span class="results-place">${medal(r.place)}</span>
              <span class="results-name">
                ${escapeHtml(r.name || String(r.uid || "").slice(0, 8))}
                ${r.isMvp || r.place === 1 ? '<span class="mvp-badge">MVP</span>' : ""}
                ${r.uid === currentUid ? '<span class="you-badge">You</span>' : ""}
              </span>
              <span class="results-meta">
                Place ${r.place}
                ${r.cardsLeft != null ? ` · 🂠 ${r.cardsLeft}` : ""}
              </span>
            </div>`;
              })
              .join("")}
        </div>
        <div class="results-actions">
          <button type="button" class="btn btn-primary" id="btn-results-menu">Menu</button>
          ${
              onReplay
                  ? `<button type="button" class="btn btn-secondary" id="btn-results-replay">Replay</button>`
                  : ""
          }
        </div>
      </div>
    `;

    overlay.querySelector("#btn-results-menu")?.addEventListener("click", () => onMenu?.());
    overlay.querySelector("#btn-results-replay")?.addEventListener("click", () => onReplay?.());
}

export function hideResultsOverlay(container) {
    container?.querySelector("#results-overlay")?.remove();
}
