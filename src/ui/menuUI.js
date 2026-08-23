/**
 * Main Menu UI
 */
export function renderMenu(container, handlers = {}) {
    container.innerHTML = `
        <h1 class="logo-card-clash">Card Clash</h1>
        <p class="logo-sub">Online Card Arena</p>

        <div class="menu-actions">
            <button class="btn btn-primary" id="btn-solo">PLAY SOLO</button>
            <button class="btn btn-accent" id="btn-ranked-main">RANKED</button>
            <button class="btn btn-secondary" id="btn-online">PLAY ONLINE</button>
        </div>

        <div class="menu-footer">
            <button class="btn btn-secondary" id="btn-profile">Profile</button>
            <button class="btn btn-secondary" id="btn-leaderboard-main">Leaderboard</button>
            <button class="btn btn-secondary" id="btn-settings">Settings</button>
        </div>
        <p class="text-muted" style="margin-top:0.75rem;font-size:0.75rem;text-align:center;opacity:0.8">
          Ranked: Warrior → Legend · max 4 pemain
        </p>
    `;

    container.querySelector("#btn-solo")?.addEventListener("click", () => handlers.onSolo?.());
    container.querySelector("#btn-ranked-main")?.addEventListener("click", () => handlers.onRanked?.());
    container.querySelector("#btn-online")?.addEventListener("click", () => handlers.onOnline?.());
    container.querySelector("#btn-profile")?.addEventListener("click", () => handlers.onProfile?.());
    container.querySelector("#btn-leaderboard-main")?.addEventListener("click", () => handlers.onLeaderboard?.());
    container.querySelector("#btn-settings")?.addEventListener("click", () => handlers.onSettings?.());
}

export function renderOnlineMenu(container, handlers = {}) {
    container.innerHTML = `
        <div class="lobby-header">
            <button class="btn btn-secondary" id="btn-back" style="max-width:100px">← Back</button>
            <span class="text-muted">Multiplayer</span>
        </div>

        <div class="menu-actions" style="margin-top:1.5rem">
            <button class="btn btn-accent" id="btn-ranked">RANKED</button>
            <button class="btn btn-primary" id="btn-quick">QUICK MATCH</button>
            <button class="btn btn-secondary" id="btn-create">CREATE ROOM</button>
            <button class="btn btn-secondary" id="btn-join">JOIN ROOM</button>
            <button class="btn btn-secondary" id="btn-rules">CUSTOM RULES</button>
            <button class="btn btn-secondary" id="btn-leaderboard">LEADERBOARD</button>
        </div>
        <p class="text-muted" style="margin-top:1rem;font-size:0.8rem;text-align:center">
          Ranked: max 4 · bot fill jika sepi · Warrior → Legend
        </p>
    `;

    container.querySelector("#btn-back")?.addEventListener("click", () => handlers.onBack?.());
    container.querySelector("#btn-quick")?.addEventListener("click", () => handlers.onQuick?.());
    container.querySelector("#btn-ranked")?.addEventListener("click", () => handlers.onRanked?.());
    container.querySelector("#btn-create")?.addEventListener("click", () => handlers.onCreate?.());
    container.querySelector("#btn-join")?.addEventListener("click", () => handlers.onJoin?.());
    container.querySelector("#btn-rules")?.addEventListener("click", () => handlers.onRules?.());
    container.querySelector("#btn-leaderboard")?.addEventListener("click", () => handlers.onLeaderboard?.());
}
