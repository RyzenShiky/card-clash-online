/**
 * Lobby UI
 */
export function renderLobby(container, { roomCode, room, currentUid, isHost }, handlers = {}) {
    const players = room?.players || {};
    const playerList = Object.values(players);

    container.innerHTML = `
        <div class="lobby-header">
            <button class="btn btn-secondary" id="btn-leave" style="max-width:100px">Leave</button>
            <div class="lobby-code" title="Salin kode">${roomCode || "------"}</div>
            <button class="btn btn-secondary" id="btn-copy" style="max-width:80px">Copy</button>
        </div>

        <p class="text-muted">Pemain (${playerList.length}/${room?.settings?.maxPlayers || 4})
          ${room?.meta?.mode === "ranked" ? " · RANKED" : ""}
        </p>

        <div class="player-list" id="player-list">
            ${playerList
                .map((p) => {
                    const isMe = p.uid === currentUid;
                    let statusLabel = p.ready ? "Ready" : "Not ready";
                    if (p.isBot) statusLabel = "Bot · Ready";
                    else if (p.status === "reconnecting" || p.connected === false) {
                        statusLabel = "Reconnecting…";
                    } else if (p.status === "disconnected") {
                        statusLabel = "Disconnected";
                    }
                    const name = p.isBot
                        ? p.displayName || "Bot"
                        : isMe
                          ? "You"
                          : p.uid.slice(0, 8) + "…";
                    return `
                <div class="player-item ${p.uid === room?.meta?.hostId ? "host" : ""} ${p.ready ? "ready" : ""} ${p.status === "reconnecting" ? "reconnecting" : ""}">
                    <span>${name}</span>
                    <span class="text-muted">${statusLabel}</span>
                </div>`;
                })
                .join("")}
        </div>

        <div class="menu-actions">
            <button class="btn btn-primary" id="btn-ready">
                ${players[currentUid]?.ready ? "Cancel Ready" : "Ready"}
            </button>
            ${isHost ? `<button class="btn btn-secondary" id="btn-fill-bots">Fill Bots</button>` : ""}
            ${isHost ? `<button class="btn btn-accent" id="btn-start">START GAME</button>` : ""}
        </div>
    `;

    container.querySelector("#btn-leave")?.addEventListener("click", () => handlers.onLeave?.());
    container.querySelector("#btn-copy")?.addEventListener("click", () => {
        if (roomCode) {
            navigator.clipboard?.writeText(roomCode);
            handlers.onNotify?.("Kode disalin!");
        }
    });
    container.querySelector("#btn-ready")?.addEventListener("click", () => handlers.onReady?.());
    container.querySelector("#btn-start")?.addEventListener("click", () => handlers.onStart?.());
    container.querySelector("#btn-fill-bots")?.addEventListener("click", () => handlers.onFillBots?.());
}

export function promptJoinCode() {
    return window.prompt("Masukkan Room Code (6 karakter):");
}
