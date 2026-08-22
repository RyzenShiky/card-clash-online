/**
 * Main Menu UI
 */
export function renderMenu(container, handlers = {}) {
    container.innerHTML = `
        <h1 class="logo-card-clash">Card Clash</h1>
        <p class="logo-sub">Online Card Arena</p>

        <div class="menu-actions">
            <button class="btn btn-primary" id="btn-solo">PLAY SOLO</button>
            <button class="btn btn-accent" id="btn-online">PLAY ONLINE</button>
        </div>

        <div class="menu-footer">
            <button class="btn btn-secondary" id="btn-profile">Profile</button>
            <button class="btn btn-secondary" id="btn-settings">Settings</button>
        </div>
    `;

    container.querySelector("#btn-solo")?.addEventListener("click", () => handlers.onSolo?.());
    container.querySelector("#btn-online")?.addEventListener("click", () => handlers.onOnline?.());
    container.querySelector("#btn-profile")?.addEventListener("click", () => handlers.onProfile?.());
    container.querySelector("#btn-settings")?.addEventListener("click", () => handlers.onSettings?.());
}

export function renderOnlineMenu(container, handlers = {}) {
    container.innerHTML = `
        <div class="lobby-header">
            <button class="btn btn-secondary" id="btn-back" style="max-width:100px">← Back</button>
            <span class="text-muted">Multiplayer</span>
        </div>

        <div class="menu-actions" style="margin-top:2rem">
            <button class="btn btn-primary" id="btn-quick">QUICK MATCH</button>
            <button class="btn btn-accent" id="btn-create">CREATE ROOM</button>
            <button class="btn btn-secondary" id="btn-join">JOIN ROOM</button>
        </div>
    `;

    container.querySelector("#btn-back")?.addEventListener("click", () => handlers.onBack?.());
    container.querySelector("#btn-quick")?.addEventListener("click", () => handlers.onQuick?.());
    container.querySelector("#btn-create")?.addEventListener("click", () => handlers.onCreate?.());
    container.querySelector("#btn-join")?.addEventListener("click", () => handlers.onJoin?.());
}
