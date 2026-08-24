/**
 * Main menu — hierarchy modern:
 * PLAY NOW (primary) → Solo / Casual / Ranked → Private Room
 * Desktop: 2-kolom | Mobile: stack
 */
import { getDisplayName, getAvatarId, getCachedProfile } from "../auth/profileStore.js";
import { subscribeOnlineCount } from "../multiplayer/presence.js";

const AVATARS = {
    default: "🎮",
    fire: "🔥",
    crown: "👑",
    rocket: "🚀",
    cool: "😎",
    wolf: "🐺",
    star: "⭐",
    bolt: "⚡"
};

function avatarEmoji(id) {
    return AVATARS[id] || AVATARS.default;
}

function rankLabel(profile) {
    const r = profile?.ranked;
    if (!r) return "Unranked";
    const tier = String(r.tier || "professional");
    const name = tier.charAt(0).toUpperCase() + tier.slice(1);
    const mmr = r.mmr != null ? Math.round(r.mmr) : 1000;
    return `${name} · ${mmr}`;
}

function lastMatchLine(profile) {
    const stats = profile?.stats;
    if (!stats) return "Belum ada match";
    const wins = stats.wins ?? 0;
    const played = stats.matchesPlayed ?? 0;
    if (!played) return "Belum ada match";
    return `${wins}W / ${played - wins}L · ${played} games`;
}

/**
 * @param {HTMLElement} container
 * @param {object} handlers
 * @param {{ uid?: string, user?: object }} [ctx]
 */
export function renderMenu(container, handlers = {}, ctx = {}) {
    const uid = ctx.uid || ctx.user?.uid;
    const profile = uid ? getCachedProfile(uid) : null;
    const fromStore = uid ? getDisplayName(uid, null) : null;
    const name =
        (fromStore && fromStore.length >= 2 && fromStore !== String(uid).slice(0, 8)
            ? fromStore
            : null) ||
        profile?.public?.displayName ||
        ctx.user?.displayName ||
        (ctx.user?.isAnonymous ? `Guest_${String(uid || "").slice(0, 6)}` : "Player");
    const av = uid ? getAvatarId(uid) : "default";
    const rank = rankLabel(profile);
    const last = lastMatchLine(profile);

    container.innerHTML = `
      <div class="menu-shell">
        <header class="menu-topbar">
          <div class="menu-brand">
            <h1 class="logo-card-clash menu-logo">Card Clash</h1>
            <p class="menu-tagline">Online Card Arena</p>
          </div>
          <button type="button" class="menu-avatar-btn" id="btn-profile" title="Profile">
            <span class="menu-avatar-emoji">${avatarEmoji(av)}</span>
            <span class="menu-avatar-name">${esc(name)}</span>
          </button>
        </header>

        <div class="menu-grid">
          <section class="menu-play-col">
            <div class="menu-online-pill" id="menu-online-pill" title="Pemain online real-time">
              <span class="online-dot"></span>
              <span id="menu-online-count">—</span>
              <span class="online-label">online</span>
            </div>

            <button type="button" class="btn-play-now" id="btn-play-now">
              <span class="btn-play-title">QUICK MATCH</span>
              <span class="btn-play-sub">Casual · tidak memengaruhi rank</span>
            </button>

            <div class="menu-mode-row">
              <button type="button" class="mode-card mode-casual" id="btn-online">
                <span class="mode-label">CASUAL</span>
                <span class="mode-desc">Santai · room & quick play</span>
              </button>
              <button type="button" class="mode-card mode-ranked" id="btn-ranked-main">
                <span class="mode-label">RANKED</span>
                <span class="mode-desc">Kompetitif · tier & MMR</span>
              </button>
            </div>

            <div class="menu-mode-row menu-mode-row-2">
              <button type="button" class="mode-card mode-solo" id="btn-solo">
                <span class="mode-label">SOLO</span>
                <span class="mode-desc">Practice vs AI</span>
              </button>
              <button type="button" class="mode-card mode-private" id="btn-private-room">
                <span class="mode-label">PRIVATE ROOM</span>
                <span class="mode-desc">Create or join code</span>
              </button>
            </div>
          </section>

          <aside class="menu-side-col">
            <div class="menu-profile-card">
              <h2 class="menu-side-title">Your Card Clash</h2>
              <div class="menu-profile-row">
                <span class="menu-profile-av">${avatarEmoji(av)}</span>
                <div>
                  <div class="menu-profile-name">${esc(name)}</div>
                  <div class="menu-profile-rank">${esc(rank)}</div>
                </div>
              </div>
              <p class="menu-profile-stats">${esc(last)}</p>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-profile-side">Edit Profile</button>
            </div>

            <div class="menu-links">
              <button type="button" class="menu-link" id="btn-friends">👥 Teman</button>
              <button type="button" class="menu-link" id="btn-leaderboard-main">🏆 Leaderboard</button>
              <button type="button" class="menu-link" id="btn-feedback">💬 Feedback</button>
              <button type="button" class="menu-link" id="btn-settings">⚙ Settings</button>
            </div>
          </aside>
        </div>

        <footer class="menu-bottom">
          <span>© Card Clash · RyzenShiky</span>
          <span>
            <a href="./privacy.html" target="_blank" rel="noopener">Privacy</a>
            ·
            <a href="./terms.html" target="_blank" rel="noopener">Terms</a>
          </span>
        </footer>
      </div>
    `;

    // PLAY NOW → casual matchmaking (aksi utama)
    container.querySelector("#btn-play-now")?.addEventListener("click", () => {
        if (handlers.onPlayNow) handlers.onPlayNow();
        else handlers.onOnline?.();
    });
    container.querySelector("#btn-solo")?.addEventListener("click", () => handlers.onSolo?.());
    container.querySelector("#btn-ranked-main")?.addEventListener("click", () => handlers.onRanked?.());
    container.querySelector("#btn-online")?.addEventListener("click", () => handlers.onOnline?.());
    container.querySelector("#btn-private-room")?.addEventListener("click", () => {
        if (handlers.onPrivateRoom) handlers.onPrivateRoom();
        else handlers.onOnline?.();
    });
    container.querySelector("#btn-profile")?.addEventListener("click", () => handlers.onProfile?.());
    container.querySelector("#btn-profile-side")?.addEventListener("click", () => handlers.onProfile?.());
    container.querySelector("#btn-friends")?.addEventListener("click", () => handlers.onFriends?.());
    container.querySelector("#btn-leaderboard-main")?.addEventListener("click", () => handlers.onLeaderboard?.());
    container.querySelector("#btn-feedback")?.addEventListener("click", () => handlers.onFeedback?.());
    container.querySelector("#btn-settings")?.addEventListener("click", () => handlers.onSettings?.());

    const countEl = container.querySelector("#menu-online-count");
    if (countEl) {
        const unsubOnline = subscribeOnlineCount((n) => {
            countEl.textContent = String(n);
        });
        container._unsubOnline = unsubOnline;
    }
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function renderOnlineMenu(container, handlers = {}) {
    container.innerHTML = `
      <div class="menu-shell menu-shell-sub">
        <header class="menu-topbar">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-back">← Back</button>
          <span class="text-muted">Casual / Private Room</span>
          <span></span>
        </header>

        <div class="menu-actions-online">
          <button class="btn btn-primary btn-lg" id="btn-quick">QUICK MATCH
            <span style="display:block;font-size:0.75rem;font-weight:500;opacity:0.9">Casual · tanpa rank</span>
          </button>
          <button class="btn btn-secondary" id="btn-create">CREATE ROOM</button>
          <button class="btn btn-secondary" id="btn-join">JOIN ROOM</button>
          <button class="btn btn-secondary" id="btn-rules">CUSTOM RULES</button>
          <p class="text-muted" style="font-size:0.75rem;text-align:center;margin:0.25rem 0 0">
            Ranked ada di menu utama · kompetitif + tier
          </p>
        </div>

        <div class="menu-links menu-links-center">
          <button type="button" class="menu-link" id="btn-leaderboard">🏆 Leaderboard</button>
          <button type="button" class="menu-link" id="btn-feedback-online">💬 Feedback</button>
        </div>

        <footer class="menu-bottom">
          <span>© Card Clash · RyzenShiky</span>
        </footer>
      </div>
    `;

    container.querySelector("#btn-back")?.addEventListener("click", () => handlers.onBack?.());
    container.querySelector("#btn-quick")?.addEventListener("click", () => handlers.onQuick?.());
    container.querySelector("#btn-create")?.addEventListener("click", () => handlers.onCreate?.());
    container.querySelector("#btn-join")?.addEventListener("click", () => handlers.onJoin?.());
    container.querySelector("#btn-rules")?.addEventListener("click", () => handlers.onRules?.());
    container.querySelector("#btn-leaderboard")?.addEventListener("click", () => handlers.onLeaderboard?.());
    container.querySelector("#btn-feedback-online")?.addEventListener("click", () => handlers.onFeedback?.());
}
