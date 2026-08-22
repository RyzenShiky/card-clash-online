/**
 * In-game UI — professional cards, UNO, challenge, scores
 */
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

    const opponents = (publicState?.players || []).filter((p) => p.uid !== currentUid);

    const scoreLine = Object.entries(scores)
        .map(([uid, s]) => {
            const label = uid === currentUid ? "You" : uid.slice(0, 6);
            return `${label}: ${s}`;
        })
        .join(" · ");

    container.innerHTML = `
        <div class="lobby-header">
            <span class="text-muted">
                Turn: ${myTurn ? "<b>YOU</b>" : (publicState?.currentTurn || "—").slice(0, 6)}
                <span class="turn-dir ${dir}"></span>
            </span>
            <button class="btn btn-secondary" id="btn-quit" style="max-width:80px">Quit</button>
        </div>

        <div class="score-bar">${scoreLine || "Score: —"} / target ${publicState?.targetScore || 500}</div>

        <div class="opponents-row">
            ${opponents
                .map(
                    (p) => `
                <div class="opponent-chip ${p.uid === publicState?.currentTurn ? "active-turn" : ""}">
                    ${p.uid.slice(0, 6)}…<br/>🂠 ${p.handCount ?? "?"}
                    ${
                        p.uid !== currentUid && (publicState?.handCounts?.[p.uid] === 1)
                            ? `<br/><button class="btn btn-danger" data-challenge-uno="${p.uid}" style="max-width:100%;padding:0.25rem;font-size:0.7rem;margin-top:4px">Cek UNO</button>`
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
                ${top ? renderCardHTML(top, { discard: true }) : "<div class='card-face wild discard'></div>"}
                <p class="text-muted" style="font-size:0.8rem">Color: ${publicState?.currentColor || "—"}</p>
            </div>
        </div>

        ${
            challenge?.type === "wild_draw4" && challenge.from === currentUid
                ? `<div class="challenge-banner">
                    Wild +4! <button class="btn btn-danger" id="btn-challenge-wd4" style="max-width:160px;margin-top:0.5rem">Challenge</button>
                    <button class="btn btn-secondary" id="btn-accept-wd4" style="max-width:160px;margin-top:0.5rem">Accept</button>
                   </div>`
                : ""
        }

        <div class="hand-fan" id="player-hand">
            ${(hand || [])
                .map((c) => {
                    const playable =
                        myTurn &&
                        canPlayCard(c, top, publicState?.currentColor) &&
                        !(stackAmt > 0 && publicState?.stacking);
                    const stackPlayable =
                        myTurn &&
                        stackAmt > 0 &&
                        publicState?.stacking &&
                        ((publicState.stackType === "draw2" && c.value === "draw2") ||
                            (publicState.stackType === "wild_draw4" && c.value === "wild_draw4"));
                    return renderCardHTML(c, {
                        playable: playable || stackPlayable
                    });
                })
                .join("")}
        </div>

        <div class="game-actions">
            <button class="btn btn-secondary" id="btn-draw">DRAW</button>
            <button class="btn btn-uno" id="btn-uno" ${handCount === 1 || pendingUno === currentUid ? "" : "disabled"}>
                UNO!
            </button>
            <button class="btn btn-accent" id="btn-last" style="display:none">LAST</button>
        </div>
    `;

    container.querySelectorAll(".card-face[data-id]").forEach((el) => {
        if (el.classList.contains("discard")) return;
        el.addEventListener("click", () => {
            const id = el.getAttribute("data-id");
            if (id) handlers.onPlayCard?.(id);
        });
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
}
