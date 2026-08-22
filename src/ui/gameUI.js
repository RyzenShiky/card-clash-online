/**
 * In-game UI — mobile-friendly, color picker, chat-friendly layout
 */
import { bindCardGestures } from "./cardTouch.js";
import { renderCardHTML } from "./cardRender.js";
import { canPlayCard } from "../game/rules.js";

export function renderGame(container, { publicState, hand, currentUid }, handlers = {}) {
    const top = publicState?.topCard;
    const myTurn = publicState?.currentTurn === currentUid;
    const dir = (publicState?.direction || 1) > 0 ? "cw" : "ccw";
    const scores = publicState?.scores || {};
    const challenge = publicState?.challenge;
    const stackAmt = publicState?.stackAmount || 0;
    const pendingUno = publicState?.pendingUno;
    const handCount = hand?.length ?? 0;
    const activeColor = publicState?.currentColor || top?.color || "—";

    const opponents = (publicState?.players || []).filter((p) => p.uid !== currentUid);

    const scoreLine = Object.entries(scores)
        .map(([uid, s]) => {
            const label = uid === currentUid ? "You" : uid.slice(0, 6);
            return `${label}: ${s}`;
        })
        .join(" · ");

    // Discard shows chosen color for wild
    const discardCard = top
        ? {
              ...top,
              color: top.color || publicState?.currentColor || null
          }
        : null;

    container.innerHTML = `
        <div class="game-layout">
          <div class="game-main">
            <div class="lobby-header">
                <span class="text-muted">
                    Turn: ${myTurn ? "<b>YOU</b>" : (publicState?.currentTurn || "—").slice(0, 6)}
                    <span class="turn-dir ${dir}"></span>
                </span>
                <button class="btn btn-secondary" id="btn-quit" style="max-width:72px;padding:0.5rem">Quit</button>
            </div>

            <div class="score-bar">${scoreLine || "Score: —"} / ${publicState?.targetScore || 500}</div>

            <div class="opponents-row">
                ${opponents
                    .map(
                        (p) => `
                    <div class="opponent-chip ${p.uid === publicState?.currentTurn ? "active-turn" : ""}">
                        ${p.uid.slice(0, 6)}… · 🂠 ${p.handCount ?? "?"}
                        ${
                            publicState?.handCounts?.[p.uid] === 1
                                ? `<button class="btn btn-danger btn-cek-uno" data-challenge-uno="${p.uid}">Cek UNO</button>`
                                : ""
                        }
                    </div>
                `
                    )
                    .join("")}
            </div>

            <div class="game-table">
                <p class="text-muted" style="font-size:0.8rem">
                    Draw: ${publicState?.drawPileCount ?? 0}
                    ${stackAmt ? ` · Stack +${stackAmt}` : ""}
                </p>
                <div class="discard-zone">
                    ${
                        discardCard
                            ? renderCardHTML(discardCard, { discard: true })
                            : "<div class='card-face wild discard'></div>"
                    }
                    <p class="color-badge color-${activeColor}">Warna: <b>${activeColor}</b></p>
                </div>
                <div id="draw-anim" class="draw-anim hidden"></div>
            </div>

            ${
                challenge?.type === "wild_draw4" && challenge.from === currentUid
                    ? `<div class="challenge-banner">
                        Wild +4!
                        <div class="game-actions" style="margin-top:0.5rem">
                          <button class="btn btn-danger" id="btn-challenge-wd4">Challenge</button>
                          <button class="btn btn-secondary" id="btn-accept-wd4">Accept</button>
                        </div>
                       </div>`
                    : ""
            }

            <div id="color-picker" class="color-picker hidden">
              <p>Pilih warna</p>
              <div class="color-picker-row">
                <button type="button" class="color-btn red" data-color="red">Merah</button>
                <button type="button" class="color-btn blue" data-color="blue">Biru</button>
                <button type="button" class="color-btn green" data-color="green">Hijau</button>
                <button type="button" class="color-btn yellow" data-color="yellow">Kuning</button>
              </div>
            </div>

            <p class="mobile-play-hint">Tap · geser ke atas · atau tarik ke kartu tengah</p>
            <div class="hand-fan" id="player-hand">
                ${(hand || [])
                    .map((c) => {
                        const stackBlock = stackAmt > 0 && publicState?.stacking;
                        const playable =
                            myTurn &&
                            !stackBlock &&
                            canPlayCard(c, top, publicState?.currentColor);
                        const stackPlayable =
                            myTurn &&
                            stackBlock &&
                            ((publicState.stackType === "draw2" && c.value === "draw2") ||
                                (publicState.stackType === "wild_draw4" &&
                                    c.value === "wild_draw4"));
                        return renderCardHTML(c, {
                            playable: playable || stackPlayable
                        });
                    })
                    .join("")}
            </div>

            <div class="game-actions">
                <button class="btn btn-secondary" id="btn-draw" ${myTurn ? "" : "disabled"}>DRAW</button>
                <button class="btn btn-uno" id="btn-uno" ${
                    handCount === 1 || pendingUno === currentUid ? "" : "disabled"
                }>UNO!</button>
            </div>
          </div>
          <div id="chat-slot" class="chat-slot"></div>
        </div>
    `;

    // pending wild color pick
    let pendingWildCardId = null;

    const picker = container.querySelector("#color-picker");
    const showPicker = (cardId) => {
        pendingWildCardId = cardId;
        picker?.classList.remove("hidden");
    };
    const hidePicker = () => {
        pendingWildCardId = null;
        picker?.classList.add("hidden");
    };

    picker?.querySelectorAll("[data-color]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const color = btn.getAttribute("data-color");
            const id = pendingWildCardId;
            hidePicker();
            if (id && color) handlers.onPlayCard?.(id, color);
        });
    });

    const discardZone =
        container.querySelector(".discard-zone") ||
        container.querySelector(".card-face.discard")?.parentElement;

    container.querySelectorAll(".card-face[data-id]").forEach((el) => {
        if (el.classList.contains("discard")) return;
        const id = el.getAttribute("data-id");
        const play = () => {
            const card = (hand || []).find((c) => c.id === id);
            if (!card) return;
            if (card.value === "wild" || card.value === "wild_draw4") {
                showPicker(id);
                return;
            }
            handlers.onPlayCard?.(id, null);
        };
        bindCardGestures(el, { onPlay: play, discardZone });
    });

    container.querySelector("#btn-draw")?.addEventListener("click", () => handlers.onDraw?.());
    container.querySelector("#btn-uno")?.addEventListener("click", () => handlers.onUno?.());
    container.querySelector("#btn-quit")?.addEventListener("click", () => handlers.onQuit?.());
    container.querySelector("#btn-challenge-wd4")?.addEventListener("click", () =>
        handlers.onChallengeWd4?.()
    );
    container.querySelector("#btn-accept-wd4")?.addEventListener("click", () =>
        handlers.onAcceptWd4?.()
    );
    container.querySelectorAll("[data-challenge-uno]").forEach((btn) => {
        btn.addEventListener("click", () => {
            handlers.onChallengeUno?.(btn.getAttribute("data-challenge-uno"));
        });
    });

    // Draw animation toast
    if (publicState?._animDraw?.n) {
        const el = container.querySelector("#draw-anim");
        if (el) {
            el.textContent = `+${publicState._animDraw.n} kartu!`;
            el.classList.remove("hidden");
            setTimeout(() => el.classList.add("hidden"), 1500);
        }
    }
}
