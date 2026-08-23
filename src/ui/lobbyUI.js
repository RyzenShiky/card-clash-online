/**
 * Lobby / Queue UI
 * Ranked: mencari → full → Ready → auto start (tanpa Start manual)
 */
export function renderLobby(
    container,
    { roomCode, room, currentUid, isHost, queueMode },
    handlers = {}
) {
    const players = room?.players || {};
    const playerList = Object.values(players);
    const maxP = room?.settings?.maxPlayers || 4;
    const mode = room?.meta?.mode || "casual";
    const isRanked = mode === "ranked" || room?.meta?.matchmaking || queueMode;
    const humans = playerList.filter((p) => !p.isBot);
    const bots = playerList.filter((p) => p.isBot);
    const me = players[currentUid];
    const full = playerList.length >= maxP;
    const allReady =
        humans.length > 0 && humans.every((p) => p.ready) && full;

    let statusLine = "";
    if (!full) {
        statusLine = isRanked
            ? `Mencari lawan… (${playerList.length}/${maxP}) — bot otomatis jika sepi`
            : `Menunggu pemain (${playerList.length}/${maxP})`;
    } else if (!allReady) {
        statusLine = "Tekan READY — semua harus siap";
    } else {
        statusLine = "Semua siap — memulai game…";
    }

    container.innerHTML = `
        <div class="lobby-header">
            <button class="btn btn-secondary" id="btn-leave" style="max-width:100px">Leave</button>
            <div class="lobby-code" title="Kode room">${roomCode || "------"}</div>
            <span class="text-muted" style="font-size:0.75rem">${isRanked ? "RANKED" : "CASUAL"}</span>
        </div>

        <p class="text-muted" style="text-align:center">${statusLine}</p>
        <p class="text-muted" style="text-align:center;font-size:0.8rem">
          ${humans.length} manusia${bots.length ? " · " + bots.length + " bot" : ""}
        </p>

        <div class="player-list" id="player-list">
            ${playerList
                .map((p) => {
                    const isMe = p.uid === currentUid;
                    let statusLabel = p.ready ? "Ready ✓" : "Not ready";
                    if (p.isBot) statusLabel = "Ready ✓";
                    else if (p.status === "reconnecting" || p.connected === false) {
                        statusLabel = "Reconnecting…";
                    }
                    const name = p.isBot
                        ? p.displayName || "Bot"
                        : isMe
                          ? "You"
                          : p.displayName || p.uid.slice(0, 8) + "…";
                    return `
                <div class="player-item ${p.uid === room?.meta?.hostId ? "host" : ""} ${p.ready || p.isBot ? "ready" : ""}">
                    <span>${name}${p.isBot ? " 🤖" : ""}</span>
                    <span class="text-muted">${statusLabel}</span>
                </div>`;
                })
                .join("")}
        </div>

        <div class="menu-actions">
            <button class="btn btn-primary" id="btn-ready">
                ${me?.ready ? "Cancel Ready" : "READY"}
            </button>
            ${
                !isRanked && isHost
                    ? `<button class="btn btn-secondary" id="btn-fill-bots">Fill Bots</button>
                       <button class="btn btn-accent" id="btn-start">START</button>`
                    : ""
            }
            ${
                isRanked && isHost && !full
                    ? `<button class="btn btn-secondary" id="btn-fill-bots">Isi Bot sekarang</button>`
                    : ""
            }
        </div>
        ${
            isRanked
                ? `<p class="text-muted" style="text-align:center;font-size:0.75rem;margin-top:0.5rem">
              ${maxP}/${maxP} + semua Ready → langsung masuk game (tanpa Start)
            </p>`
                : ""
        }
    `;

    container.querySelector("#btn-leave")?.addEventListener("click", () => handlers.onLeave?.());
    container.querySelector("#btn-ready")?.addEventListener("click", () => handlers.onReady?.());
    container.querySelector("#btn-start")?.addEventListener("click", () => handlers.onStart?.());
    container.querySelector("#btn-fill-bots")?.addEventListener("click", () => handlers.onFillBots?.());
}

export function promptJoinCode() {
    return window.prompt("Masukkan Room Code (6 karakter):");
}
