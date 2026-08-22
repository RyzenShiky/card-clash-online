/**
 * In-game UI (placeholder + basic hand)
 */
export function renderGame(container, { publicState, hand, currentUid }, handlers = {}) {
    const top = publicState?.topCard;
    const topLabel = top
        ? `${top.color || "wild"} ${top.value}`
        : "—";

    container.innerHTML = `
        <div class="lobby-header">
            <span class="text-muted">Turn: ${publicState?.currentTurn === currentUid ? "YOU" : (publicState?.currentTurn || "—").slice(0, 6)}</span>
            <button class="btn btn-secondary" id="btn-quit" style="max-width:80px">Quit</button>
        </div>

        <div class="game-table">
            <p class="text-muted">Draw pile: ${publicState?.drawPileCount ?? 0}</p>
            <div class="card ${top?.color || "wild"}" style="width:72px;height:100px;font-size:1rem">
                ${topLabel}
            </div>
            <p class="text-muted mt-2">Color: ${publicState?.currentColor || "—"}</p>
        </div>

        <div class="hand" id="player-hand">
            ${(hand || []).map((c) => `
                <div class="card ${c.color || "wild"}" data-id="${c.id}" title="${c.color || "wild"} ${c.value}">
                    ${c.value}
                </div>
            `).join("")}
        </div>

        <div class="menu-actions" style="flex-direction:row;justify-content:center;max-width:100%">
            <button class="btn btn-secondary" id="btn-draw" style="max-width:120px">DRAW</button>
            <button class="btn btn-accent" id="btn-last" style="max-width:140px">LAST CARD!</button>
        </div>
    `;

    container.querySelectorAll(".card[data-id]").forEach((el) => {
        el.addEventListener("click", () => {
            const id = el.getAttribute("data-id");
            handlers.onPlayCard?.(id);
        });
    });

    container.querySelector("#btn-draw")?.addEventListener("click", () => handlers.onDraw?.());
    container.querySelector("#btn-last")?.addEventListener("click", () => handlers.onLastCard?.());
    container.querySelector("#btn-quit")?.addEventListener("click", () => handlers.onQuit?.());
}
