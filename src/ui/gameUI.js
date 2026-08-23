/**
 * Game UI — shell stabil + hand incremental (HandController)
 * Jangan rebuild hand saat Firebase update / turn change.
 */
import { renderCardHTML } from "./cardRender.js";
import { HandController } from "./handController.js";

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** @type {WeakMap<HTMLElement, { handCtrl: HandController, handlers: object, shellReady: boolean }>} */
const sessions = new WeakMap();

function nameOf(publicState, currentUid, uid) {
    if (uid === currentUid) return "You";
    const p = (publicState?.players || []).find((x) => x.uid === uid);
    return p?.displayName || String(uid || "—").slice(0, 8);
}

function buildShell(container) {
    container.innerHTML = `
        <div class="game-layout">
          <div class="game-main">
            <div class="lobby-header">
                <span class="text-muted" id="g-turn-line">Turn: —</span>
                <div style="display:flex;gap:0.35rem">
                  <button class="btn btn-secondary" id="btn-feedback-game" style="max-width:88px;padding:0.5rem;font-size:0.75rem">Feedback</button>
                  <button class="btn btn-secondary" id="btn-quit" style="max-width:72px;padding:0.5rem">Quit</button>
                </div>
            </div>
            <div class="score-bar" id="g-score-bar">Score: —</div>
            <div class="opponents-row" id="g-opponents"></div>
            <div class="game-table">
                <p class="text-muted" id="g-draw-info" style="font-size:0.8rem">Draw: —</p>
                <div class="discard-zone" id="g-discard"></div>
                <div id="draw-anim" class="draw-anim hidden"></div>
            </div>
            <div id="g-spectate"></div>
            <div id="g-challenge"></div>
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
            <div class="hand-fan" id="player-hand"><div class="hand-fan-scroll"></div></div>
            <div class="game-actions">
                <button class="btn btn-secondary" id="btn-draw">DRAW</button>
                <button class="btn btn-uno" id="btn-uno" disabled>UNO!</button>
            </div>
          </div>
          <div id="chat-slot" class="chat-slot"></div>
        </div>
    `;
}

function wireChrome(container, session) {
    const handlers = session.handlers;
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
        btn.onclick = () => {
            const color = btn.getAttribute("data-color");
            const id = pendingWildCardId;
            hidePicker();
            if (id && color) handlers.onPlayCard?.(id, color);
        };
    });

    container.querySelector("#btn-draw").onclick = () => handlers.onDraw?.();
    container.querySelector("#btn-uno").onclick = () => handlers.onUno?.();
    container.querySelector("#btn-quit").onclick = () => handlers.onQuit?.();
    const fb = container.querySelector("#btn-feedback-game");
    if (fb) fb.onclick = () => handlers.onFeedback?.();

    session.showPicker = showPicker;
    session.hidePicker = hidePicker;
}

function patchChrome(container, publicState, currentUid, hand, handlers) {
    const iAmFinished = !!publicState?.finishedPlayers?.[currentUid];
    const myTurn = publicState?.currentTurn === currentUid && !iAmFinished;
    const dir = (publicState?.direction || 1) > 0 ? "cw" : "ccw";
    const turnName = myTurn
        ? "YOU"
        : nameOf(publicState, currentUid, publicState?.currentTurn);

    const turnEl = container.querySelector("#g-turn-line");
    if (turnEl) {
        turnEl.innerHTML = `Turn: ${myTurn ? "<b>YOU</b>" : escapeHtml(turnName)} <span class="turn-dir ${dir}"></span>`;
    }

    const scores = publicState?.scores || {};
    const scoreLine = Object.entries(scores)
        .map(([uid, s]) => `${nameOf(publicState, currentUid, uid)}: ${s}`)
        .join(" · ");
    const scoreEl = container.querySelector("#g-score-bar");
    if (scoreEl) {
        scoreEl.textContent = `${scoreLine || "Score: —"} / ${publicState?.targetScore || 500}`;
    }

    const opponents = (publicState?.players || []).filter((p) => p.uid !== currentUid);
    const oppEl = container.querySelector("#g-opponents");
    if (oppEl) {
        oppEl.innerHTML = opponents
            .map((p) => {
                const recon =
                    p.status === "reconnecting" || p.connected === false ? " · 🔄" : "";
                const finPlace = publicState?.finishedPlayers?.[p.uid]?.place;
                const placeTag = finPlace ? ` · P${finPlace}` : "";
                const label = p.displayName || String(p.uid).slice(0, 8);
                const unoBtn =
                    publicState?.handCounts?.[p.uid] === 1
                        ? `<button class="btn btn-danger btn-cek-uno" data-challenge-uno="${p.uid}">Cek UNO</button>`
                        : "";
                return `<div class="opponent-chip ${p.uid === publicState?.currentTurn ? "active-turn" : ""} ${p.status === "reconnecting" ? "reconnecting" : ""}">${escapeHtml(label)} · 🂠 ${finPlace ? 0 : (p.handCount ?? "?")}${placeTag}${recon}${unoBtn}</div>`;
            })
            .join("");
        oppEl.querySelectorAll("[data-challenge-uno]").forEach((btn) => {
            btn.onclick = () =>
                handlers.onChallengeUno?.(btn.getAttribute("data-challenge-uno"));
        });
    }

    const stackAmt = publicState?.stackAmount || 0;
    const drawInfo = container.querySelector("#g-draw-info");
    if (drawInfo) {
        drawInfo.textContent = `Draw: ${publicState?.drawPileCount ?? 0}${stackAmt ? ` · Stack +${stackAmt}` : ""}`;
    }

    const top = publicState?.topCard;
    const activeColor = publicState?.currentColor || top?.color || "—";
    const discardCard = top
        ? { ...top, color: top.color || publicState?.currentColor || null }
        : null;
    const discardEl = container.querySelector("#g-discard");
    if (discardEl) {
        const html = discardCard
            ? renderCardHTML(discardCard, {
                  discard: true,
                  activeColor:
                      discardCard.value === "wild" || discardCard.value === "wild_draw4"
                          ? publicState?.currentColor || discardCard.color
                          : null
              }) +
              `<p class="color-badge color-${activeColor}">Warna: <b>${activeColor}</b></p>`
            : `<div class="card-face wild discard"></div><p class="color-badge">Warna: —</p>`;
        // Hanya update discard jika konten berubah (hindari flicker)
        if (discardEl.dataset.sig !== (top?.id || "") + activeColor) {
            discardEl.dataset.sig = (top?.id || "") + activeColor;
            discardEl.innerHTML = html;
        }
    }

    const challenge = publicState?.challenge;
    const chEl = container.querySelector("#g-challenge");
    if (chEl) {
        if (challenge?.type === "wild_draw4" && challenge.from === currentUid) {
            if (!chEl.dataset.active) {
                chEl.dataset.active = "1";
                chEl.innerHTML = `<div class="challenge-banner">Wild +4!
                  <div class="game-actions" style="margin-top:0.5rem">
                    <button class="btn btn-danger" id="btn-challenge-wd4">Challenge</button>
                    <button class="btn btn-secondary" id="btn-accept-wd4">Accept</button>
                  </div></div>`;
                chEl.querySelector("#btn-challenge-wd4").onclick = () =>
                    handlers.onChallengeWd4?.();
                chEl.querySelector("#btn-accept-wd4").onclick = () =>
                    handlers.onAcceptWd4?.();
            }
        } else {
            chEl.innerHTML = "";
            delete chEl.dataset.active;
        }
    }

    
    // Spectator / place banner
    const fin = publicState?.finishedPlayers?.[currentUid];
    const specEl = container.querySelector("#g-spectate");
    if (specEl) {
        if (fin && publicState?.status === "playing") {
            const place = fin.place || "?";
            const watching = publicState?.spectators?.[currentUid];
            specEl.innerHTML = `
              <div class="spectate-banner">
                <p><b>Place ${place}${place === 1 ? " · MVP" : ""}</b> — kamu sudah selesai.</p>
                <p class="text-muted" style="font-size:0.8rem;margin:0.25rem 0">Nonton tanpa melihat kartu lawan</p>
                <button type="button" class="btn btn-accent" id="btn-spectate-toggle">
                  ${watching ? "Sedang menonton ✓" : "Nonton permainan"}
                </button>
              </div>`;
            specEl.querySelector("#btn-spectate-toggle")?.addEventListener("click", () => {
                handlers.onSpectate?.(!watching);
            });
        } else {
            specEl.innerHTML = "";
        }
    }

    const btnDraw = container.querySelector("#btn-draw");
    const iFinished = !!(publicState && publicState.finishedPlayers && publicState.finishedPlayers[currentUid]);
    if (btnDraw) {
        btnDraw.disabled = !myTurn || iFinished;
    }
    const handCount = (hand && hand.length) || 0;
    const btnUno = container.querySelector("#btn-uno");
    if (btnUno) {
        const pending = publicState && publicState.pendingUno === currentUid;
        btnUno.disabled = !(handCount === 1 || pending);
    }
}

/**
 * Render / patch game UI.
 * Shell dibuat sekali; hand di-diff lewat HandController.
 */
export function renderGame(container, { publicState, hand, currentUid }, handlers = {}) {
    if (!container) return;

    let session = sessions.get(container);
    if (!session || !container.querySelector("#player-hand")) {
        buildShell(container);
        session = {
            handlers,
            shellReady: true,
            handCtrl: null,
            showPicker: null
        };
        sessions.set(container, session);
        wireChrome(container, session);

        const handRoot = container.querySelector("#player-hand");
        session.handCtrl = new HandController(handRoot, {
            onPlay: (cardId) => playFromSession(session, cardId, session.handlers),
            getDiscardZone: () => container.querySelector("#g-discard")
        });
    } else {
        session.handlers = handlers;
    }

    // Keep latest hand on session for play resolution
    session.latestHand = hand || [];
    session.latestPublic = publicState;

    patchChrome(container, publicState, currentUid, hand, handlers);

    const iAmFinished = !!publicState?.finishedPlayers?.[currentUid];
    const myTurn = publicState?.currentTurn === currentUid && !iAmFinished;
    const ctx = {
        myTurn,
        topCard: publicState?.topCard,
        currentColor: publicState?.currentColor,
        stacking: publicState?.stacking,
        stackType: publicState?.stackType,
        stackAmount: publicState?.stackAmount || 0,
        expectedCount: publicState?.handCounts?.[currentUid] || 0
    };

    session.handCtrl.sync(hand || [], ctx);
}

function playFromSession(session, cardId, handlers) {
    const card = (session.latestHand || []).find((c) => c.id === cardId);
    if (!card) return;
    if (card.value === "wild" || card.value === "wild_draw4") {
        session.showPicker?.(cardId);
        return;
    }
    handlers.onPlayCard?.(cardId, null);
}

/**
 * Optional: destroy session when leaving match
 */
export function destroyGameUI(container) {
    const session = sessions.get(container);
    if (session?.handCtrl) session.handCtrl.clear();
    sessions.delete(container);
    if (container) container.innerHTML = "";
}
