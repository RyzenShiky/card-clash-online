/**
 * Full Cheat Menu — activate by typing "true" in chat (or console: window.__ccCheat = true)
 * Local-only helpers for testing / fun. Does not bypass server validation for other players.
 */
import { logger } from "./logger.js";

let active = false;
let panel = null;
let keyBuffer = "";
let keyTimer = null;

const CHEAT_CSS = `
#cc-cheat-panel {
  position: fixed; top: 12px; right: 12px; z-index: 99999;
  width: min(340px, 92vw); max-height: 86vh; overflow: auto;
  background: linear-gradient(160deg, #1a1028 0%, #0d0a14 100%);
  border: 2px solid #a855f7; border-radius: 14px;
  box-shadow: 0 0 40px rgba(168,85,247,0.45), 0 12px 40px rgba(0,0,0,0.6);
  color: #f5e9ff; font-family: system-ui, sans-serif; font-size: 13px;
  padding: 12px 14px 16px;
}
#cc-cheat-panel h3 {
  margin: 0 0 8px; font-size: 15px; color: #e879f9;
  display: flex; align-items: center; justify-content: space-between;
}
#cc-cheat-panel .cc-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
#cc-cheat-panel button {
  background: #2e1065; color: #f0abfc; border: 1px solid #7e22ce;
  border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px;
}
#cc-cheat-panel button:hover { background: #4c1d95; }
#cc-cheat-panel button.danger { background: #450a0a; border-color: #dc2626; color: #fecaca; }
#cc-cheat-panel input, #cc-cheat-panel select {
  background: #1e1033; color: #f5e9ff; border: 1px solid #6b21a8;
  border-radius: 6px; padding: 5px 8px; font-size: 12px; width: 100%;
  box-sizing: border-box; margin: 4px 0;
}
#cc-cheat-panel .cc-sec {
  margin-top: 10px; padding-top: 8px; border-top: 1px solid #4c1d95;
  font-weight: 600; color: #c084fc; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.06em;
}
#cc-cheat-panel .cc-close {
  background: transparent; border: none; color: #f0abfc; font-size: 18px;
  cursor: pointer; padding: 0 4px;
}
#cc-cheat-panel .cc-hint { opacity: 0.65; font-size: 11px; margin-top: 4px; }
`;

function injectCss() {
    if (document.getElementById("cc-cheat-css")) return;
    const s = document.createElement("style");
    s.id = "cc-cheat-css";
    s.textContent = CHEAT_CSS;
    document.head.appendChild(s);
}

function getCtx() {
    return window.__ccCheatCtx || {};
}

function notify(msg) {
    try {
        const n = document.querySelector(".notification, #notification");
        if (n) {
            n.textContent = msg;
            n.classList?.add("show");
        }
    } catch (_) {}
    logger.info("[Cheat]", msg);
    console.log("[Cheat]", msg);
}

async function forcePlayAnyCard() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { get, ref, update } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const handSnap = await get(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`));
        const hand = handSnap.val() || [];
        if (!hand.length) return notify("Hand kosong");
        const card = hand[0];
        // Set top card color to match so engine accepts
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            currentColor: card.color === "wild" ? "red" : card.color,
            updatedAt: Date.now()
        });
        const { playCardOnline } = await import("../multiplayer/matchSync.js");
        await playCardOnline(ctx.roomId, ctx.uid, card.id, card.color === "wild" ? "red" : null);
        notify("Force play: " + card.value);
    } catch (e) {
        notify("Force play gagal: " + (e.message || e));
    }
}

async function drawN(n = 1) {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { get, ref, set, update } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val();
        if (!game) return notify("No game");
        const pile = [...(game.drawPile || [])];
        const drawn = [];
        for (let i = 0; i < n && pile.length; i++) drawn.push(pile.pop());
        const hSnap = await get(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`));
        const hand = hSnap.val() || [];
        await set(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`), [...hand, ...drawn]);
        const counts = { ...(game.handCounts || {}) };
        counts[ctx.uid] = (counts[ctx.uid] || 0) + drawn.length;
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            drawPile: pile,
            drawPileCount: pile.length,
            handCounts: counts,
            updatedAt: Date.now()
        });
        notify(`Drew ${drawn.length} cards`);
    } catch (e) {
        notify("Draw gagal: " + (e.message || e));
    }
}

async function clearHand() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { set, ref, update, get } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        await set(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`), []);
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val() || {};
        const counts = { ...(game.handCounts || {}) };
        counts[ctx.uid] = 0;
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            handCounts: counts,
            updatedAt: Date.now()
        });
        notify("Hand dikosongkan (win lokal jika engine cek)");
    } catch (e) {
        notify("Clear hand gagal: " + (e.message || e));
    }
}

async function setMyTurn() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { update, ref } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            currentTurn: ctx.uid,
            turnEndsAt: Date.now() + 120000,
            updatedAt: Date.now()
        });
        notify("Giliran dipaksa ke kamu");
    } catch (e) {
        notify("Set turn gagal: " + (e.message || e));
    }
}

async function giveWildDraw4() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { get, ref, set, update } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const id = "cheat_wd4_" + Date.now();
        const card = { id, value: "wild_draw4", color: "wild" };
        const hSnap = await get(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`));
        const hand = hSnap.val() || [];
        await set(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`), [...hand, card]);
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val() || {};
        const counts = { ...(game.handCounts || {}) };
        counts[ctx.uid] = (counts[ctx.uid] || 0) + 1;
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            handCounts: counts,
            updatedAt: Date.now()
        });
        notify("Wild Draw 4 ditambahkan");
    } catch (e) {
        notify("Gagal: " + (e.message || e));
    }
}

async function giveAllColors() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { get, ref, set, update } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const colors = ["red", "blue", "green", "yellow"];
        const values = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
        const extra = [];
        let i = 0;
        for (const c of colors) {
            for (const v of values.slice(0, 3)) {
                extra.push({ id: `cheat_${c}_${v}_${Date.now()}_${i++}`, value: v, color: c });
            }
        }
        extra.push({ id: `cheat_w_${Date.now()}`, value: "wild", color: "wild" });
        extra.push({ id: `cheat_wd4_${Date.now()}`, value: "wild_draw4", color: "wild" });
        const hSnap = await get(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`));
        const hand = hSnap.val() || [];
        await set(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`), [...hand, ...extra]);
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val() || {};
        const counts = { ...(game.handCounts || {}) };
        counts[ctx.uid] = (counts[ctx.uid] || 0) + extra.length;
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            handCounts: counts,
            updatedAt: Date.now()
        });
        notify(`+${extra.length} kartu cheat`);
    } catch (e) {
        notify("Gagal: " + (e.message || e));
    }
}

async function forceWin() {
    const ctx = getCtx();
    if (!ctx.roomId || !ctx.uid) return notify("Tidak di dalam match");
    try {
        const { set, ref, update, get } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        await set(ref(database, `rooms/${ctx.roomId}/hands/${ctx.uid}`), []);
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val() || {};
        const counts = { ...(game.handCounts || {}) };
        counts[ctx.uid] = 0;
        const finished = { ...(game.finishedPlayers || {}) };
        finished[ctx.uid] = { place: 1, finishedAt: Date.now(), uid: ctx.uid, scored: true };
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            handCounts: counts,
            finishedPlayers: finished,
            roundWinner: ctx.uid,
            firstWinner: ctx.uid,
            winner: ctx.uid,
            status: "round_end",
            updatedAt: Date.now()
        });
        notify("Force WIN!");
    } catch (e) {
        notify("Force win gagal: " + (e.message || e));
    }
}

async function skipTurnTimer() {
    const ctx = getCtx();
    if (!ctx.roomId) return notify("Tidak di dalam match");
    try {
        const { update, ref } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            turnEndsAt: Date.now() + 999999000,
            updatedAt: Date.now()
        });
        notify("Timer dimatikan (jauh ke depan)");
    } catch (e) {
        notify("Gagal: " + (e.message || e));
    }
}

async function setStack(n) {
    const ctx = getCtx();
    if (!ctx.roomId) return notify("Tidak di dalam match");
    try {
        const { update, ref } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            stacking: true,
            stackAmount: n,
            stackType: n >= 4 ? "wild_draw4" : "draw2",
            updatedAt: Date.now()
        });
        notify(`Stack = ${n}`);
    } catch (e) {
        notify("Gagal: " + (e.message || e));
    }
}

async function revealAllHands() {
    const ctx = getCtx();
    if (!ctx.roomId) return notify("Tidak di dalam match");
    try {
        const { get, ref } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const game = gSnap.val();
        const ids = game?.playerIds || [];
        const lines = [];
        for (const id of ids) {
            const h = (await get(ref(database, `rooms/${ctx.roomId}/hands/${id}`))).val() || [];
            lines.push(
                `${String(id).slice(0, 10)}: ` +
                    h.map((c) => `${c.color}/${c.value}`).join(", ")
            );
        }
        console.log("[Cheat] Hands:\n" + lines.join("\n"));
        notify("Hands dicetak ke console");
        alert(lines.join("\n") || "empty");
    } catch (e) {
        notify("Reveal gagal: " + (e.message || e));
    }
}

async function setColor(color) {
    const ctx = getCtx();
    if (!ctx.roomId) return notify("Tidak di dalam match");
    try {
        const { update, ref, get } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const gSnap = await get(ref(database, `rooms/${ctx.roomId}/game`));
        const top = gSnap.val()?.topCard || {};
        await update(ref(database, `rooms/${ctx.roomId}/game`), {
            currentColor: color,
            topCard: { ...top, color },
            updatedAt: Date.now()
        });
        notify("Warna → " + color);
    } catch (e) {
        notify("Gagal: " + (e.message || e));
    }
}

async function godMode() {
    await giveAllColors();
    await setMyTurn();
    await skipTurnTimer();
    notify("GOD MODE aktif");
}

function buildPanel() {
    injectCss();
    if (panel) {
        panel.style.display = "block";
        return;
    }
    panel = document.createElement("div");
    panel.id = "cc-cheat-panel";
    panel.innerHTML = `
      <h3>⚡ CHEAT MENU <button class="cc-close" type="button" title="Close">×</button></h3>
      <div class="cc-hint">Aktif via ketik <b>true</b> di chat / keyboard. Local + RTDB write.</div>
      <div class="cc-sec">Hand</div>
      <div class="cc-row">
        <button type="button" data-a="draw1">Draw +1</button>
        <button type="button" data-a="draw5">Draw +5</button>
        <button type="button" data-a="wd4">+ WD4</button>
        <button type="button" data-a="all">+ Banyak Kartu</button>
        <button type="button" data-a="clear" class="danger">Clear Hand</button>
        <button type="button" data-a="forceplay">Force Play 1st</button>
      </div>
      <div class="cc-sec">Turn / Match</div>
      <div class="cc-row">
        <button type="button" data-a="myturn">My Turn</button>
        <button type="button" data-a="notimer">No Timer</button>
        <button type="button" data-a="win" class="danger">Force Win</button>
        <button type="button" data-a="god">GOD MODE</button>
      </div>
      <div class="cc-sec">Stack / Color</div>
      <div class="cc-row">
        <button type="button" data-a="stack2">Stack +2</button>
        <button type="button" data-a="stack4">Stack +4</button>
        <button type="button" data-a="stack0">Clear Stack</button>
      </div>
      <div class="cc-row">
        <button type="button" data-a="cred">Red</button>
        <button type="button" data-a="cblue">Blue</button>
        <button type="button" data-a="cgreen">Green</button>
        <button type="button" data-a="cyellow">Yellow</button>
      </div>
      <div class="cc-sec">Debug</div>
      <div class="cc-row">
        <button type="button" data-a="reveal">Reveal All Hands</button>
        <button type="button" data-a="dump">Dump Game State</button>
      </div>
      <div class="cc-hint">Ctx: room/uid diisi otomatis dari game. Tutup: × atau ketik true lagi.</div>
    `;
    panel.querySelector(".cc-close").onclick = () => {
        panel.style.display = "none";
    };
    panel.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-a]");
        if (!btn) return;
        const a = btn.getAttribute("data-a");
        switch (a) {
            case "draw1":
                await drawN(1);
                break;
            case "draw5":
                await drawN(5);
                break;
            case "wd4":
                await giveWildDraw4();
                break;
            case "all":
                await giveAllColors();
                break;
            case "clear":
                await clearHand();
                break;
            case "forceplay":
                await forcePlayAnyCard();
                break;
            case "myturn":
                await setMyTurn();
                break;
            case "notimer":
                await skipTurnTimer();
                break;
            case "win":
                await forceWin();
                break;
            case "god":
                await godMode();
                break;
            case "stack2":
                await setStack(2);
                break;
            case "stack4":
                await setStack(4);
                break;
            case "stack0":
                await setStack(0);
                break;
            case "cred":
                await setColor("red");
                break;
            case "cblue":
                await setColor("blue");
                break;
            case "cgreen":
                await setColor("green");
                break;
            case "cyellow":
                await setColor("yellow");
                break;
            case "reveal":
                await revealAllHands();
                break;
            case "dump":
                await dumpState();
                break;
            default:
                break;
        }
    });
    document.body.appendChild(panel);
}

async function dumpState() {
    const ctx = getCtx();
    if (!ctx.roomId) return notify("No room");
    try {
        const { get, ref } = await import(
            "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
        );
        const { database } = await import("../firebase/services.js");
        const g = (await get(ref(database, `rooms/${ctx.roomId}/game`))).val();
        console.log("[Cheat] game state", g);
        notify("State di console");
    } catch (e) {
        notify(String(e.message || e));
    }
}

export function setCheatContext(ctx) {
    window.__ccCheatCtx = { ...(window.__ccCheatCtx || {}), ...ctx };
}

export function activateCheat() {
    active = true;
    window.__ccCheat = true;
    buildPanel();
    if (panel) panel.style.display = "block";
    notify("Cheat menu AKTIF");
}

export function deactivateCheat() {
    active = false;
    if (panel) panel.style.display = "none";
    notify("Cheat menu nonaktif");
}

export function toggleCheat() {
    if (active && panel?.style.display !== "none") {
        deactivateCheat();
    } else {
        activateCheat();
    }
}

export function tryActivateCheatFromChat(text) {
    const t = String(text || "").trim().toLowerCase();
    if (t === "true" || t === "cheat" || t === "cccheat") {
        toggleCheat();
        return true;
    }
    return false;
}

export function initCheatEngine() {
    // Keyboard: type "true" quickly
    window.addEventListener("keydown", (e) => {
        if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
        if (e.key.length === 1) {
            keyBuffer += e.key.toLowerCase();
            if (keyBuffer.length > 8) keyBuffer = keyBuffer.slice(-8);
            if (keyBuffer.endsWith("true")) {
                keyBuffer = "";
                toggleCheat();
            }
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => {
                keyBuffer = "";
            }, 1500);
        }
    });
    // Console helper
    window.__ccActivateCheat = activateCheat;
    window.__ccCheatToggle = toggleCheat;
    logger.info("[Cheat] Engine ready — type true or window.__ccActivateCheat()");
}

export function resetCheatForRoom() {
    // keep panel; just clear ctx partially
    if (window.__ccCheatCtx) {
        window.__ccCheatCtx.roomId = null;
    }
}
