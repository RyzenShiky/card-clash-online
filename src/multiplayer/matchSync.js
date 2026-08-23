/**
 * Multiplayer match sync + UNO mechanics
 */
import {
    ref,
    get,
    set,
    update,
    onValue,
    off,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { createDeck, shuffle, deal } from "../game/deck.js";
import { canPlayCard, scoreHand, normalizeColor } from "../game/rules.js";
import { logger } from "../utils/logger.js";

function gameRef(roomId) {
    return ref(database, `rooms/${roomId}/game`);
}
function handRef(roomId, uid) {
    return ref(database, `rooms/${roomId}/hands/${uid}`);
}

function nextPlayer(ids, current, dir) {
    const i = ids.indexOf(current);
    if (i < 0) return ids[0];
    const len = ids.length;
    return ids[(i + dir + len * 20) % len];
}

function hasMatchingColor(hand, color) {
    if (!color) return false;
    return (hand || []).some(
        (c) =>
            c.color === color &&
            c.value !== "wild" &&
            c.value !== "wild_draw4"
    );
}

export async function initMatchOnHost(roomId, playerIds, settings = {}) {
    const gSnap = await get(gameRef(roomId));
    if (gSnap.exists() && gSnap.val()?.status === "playing") {
        return gSnap.val();
    }

    const full = shuffle(createDeck());
    const { hands, remaining } = deal(full, playerIds.length, 7);

    let discardTop = remaining.pop();
    while (
        discardTop &&
        (discardTop.value === "wild" || discardTop.value === "wild_draw4")
    ) {
        remaining.unshift(discardTop);
        discardTop = remaining.pop();
    }

    const scores = Object.fromEntries(playerIds.map((id) => [id, 0]));
    const publicState = {
        status: "playing",
        topCard: discardTop,
        currentColor: discardTop?.color || "red",
        currentTurn: playerIds[0],
        direction: 1,
        drawPile: remaining,
        drawPileCount: remaining.length,
        playerIds,
        handCounts: Object.fromEntries(
            playerIds.map((id, i) => [id, hands[i].length])
        ),
        winner: null,
        roundWinner: null,
        scores,
        targetScore: settings.targetScore ?? 500,
        // Default OFF: +2/+4 langsung kena penalti + skip
        stacking: settings.stacking ?? false,
        stackAmount: 0,
        stackType: null,
        pendingUno: null,
        unoCalled: {},
        challenge: null,
        lastAnim: null,
        turnEndsAt: Date.now() + (settings.turnTimer || 30) * 1000,
        updatedAt: Date.now()
    };

    await set(gameRef(roomId), publicState);
    for (let i = 0; i < playerIds.length; i++) {
        await set(handRef(roomId, playerIds[i]), hands[i]);
    }
    logger.info("[Match] Dealt", playerIds.length, "players");
    return publicState;
}

export function subscribePublic(roomId, callback) {
    const r = gameRef(roomId);
    onValue(r, (snap) => callback(snap.exists() ? snap.val() : null));
    return () => off(r);
}

export function subscribeHand(roomId, uid, callback) {
    const r = handRef(roomId, uid);
    onValue(r, (snap) => callback(snap.exists() ? snap.val() : []));
    return () => off(r);
}

export async function callUno(roomId, uid) {
    const gSnap = await get(gameRef(roomId));
    if (!gSnap.exists()) throw new Error("No game");
    const game = gSnap.val();
    const count = game.handCounts?.[uid] ?? 99;
    if (count !== 1 && game.pendingUno !== uid) {
        throw new Error("UNO hanya saat 1 kartu");
    }
    await update(gameRef(roomId), {
        [`unoCalled/${uid}`]: true,
        pendingUno: game.pendingUno === uid ? null : game.pendingUno,
        updatedAt: Date.now()
    });
}

export async function challengeUno(roomId, challengerUid, targetUid) {
    if (challengerUid === targetUid) throw new Error("Tidak bisa challenge diri sendiri");

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        const count = game.handCounts?.[targetUid] ?? 0;
        const called = game.unoCalled?.[targetUid];
        if (count !== 1 || called) return;

        const pile = game.drawPile || [];
        const drawn = [];
        for (let i = 0; i < 2 && pile.length; i++) drawn.push(pile.pop());
        game.drawPile = pile;
        game.drawPileCount = pile.length;
        game._forceDraw = { uid: targetUid, cards: drawn };
        game.handCounts = {
            ...game.handCounts,
            [targetUid]: count + drawn.length
        };
        game.pendingUno = null;
        game.lastAnim = { type: "penalty", uid: targetUid, n: drawn.length, at: Date.now() };
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) throw new Error("Challenge UNO tidak valid");

    const g = result.snapshot.val();
    if (g?._forceDraw?.cards?.length) {
        const { uid, cards } = g._forceDraw;
        const h = (await get(handRef(roomId, uid))).val() || [];
        await set(handRef(roomId, uid), [...h, ...cards]);
        await update(gameRef(roomId), { _forceDraw: null });
    }
}

export async function challengeWildDraw4(roomId, challengerUid) {
    const gSnap = await get(gameRef(roomId));
    const game = gSnap.val();
    if (!game?.challenge || game.challenge.type !== "wild_draw4") {
        throw new Error("Tidak ada WD4 untuk di-challenge");
    }
    if (game.challenge.from !== challengerUid) {
        throw new Error("Hanya penerima yang bisa challenge");
    }

    const targetUid = game.challenge.target;
    const colorAtPlay = game.challenge.colorAtPlay;
    const targetHand = (await get(handRef(roomId, targetUid))).val() || [];
    const wasIllegal = hasMatchingColor(targetHand, colorAtPlay);

    const drawCount = wasIllegal ? 4 : 6;
    const victim = wasIllegal ? targetUid : challengerUid;

    const pile = [...(game.drawPile || [])];
    const drawn = [];
    for (let i = 0; i < drawCount && pile.length; i++) drawn.push(pile.pop());

    const counts = { ...(game.handCounts || {}) };
    counts[victim] = (counts[victim] || 0) + drawn.length;

    const h = (await get(handRef(roomId, victim))).val() || [];
    await set(handRef(roomId, victim), [...h, ...drawn]);

    await update(gameRef(roomId), {
        drawPile: pile,
        drawPileCount: pile.length,
        handCounts: counts,
        challenge: null,
        stackAmount: 0,
        stackType: null,
        lastAnim: { type: "penalty", uid: victim, n: drawn.length, at: Date.now() },
        updatedAt: Date.now(),
        lastChallengeResult: wasIllegal ? "illegal" : "legal"
    });

    return { wasIllegal, victim, drawCount };
}

/**
 * Apply cards from pile to a player (helper after transaction)
 */
async function giveCardsFromPile(roomId, game, uid, n) {
    const pile = [...(game.drawPile || [])];
    const drawn = [];
    for (let i = 0; i < n && pile.length; i++) drawn.push(pile.pop());
    if (!drawn.length) return game;

    const h = (await get(handRef(roomId, uid))).val() || [];
    await set(handRef(roomId, uid), [...h, ...drawn]);

    const counts = { ...(game.handCounts || {}) };
    counts[uid] = (counts[uid] || 0) + drawn.length;

    await update(gameRef(roomId), {
        drawPile: pile,
        drawPileCount: pile.length,
        handCounts: counts,
        _forceDraw: null,
        lastAnim: { type: "penalty", uid, n: drawn.length, at: Date.now() },
        updatedAt: Date.now()
    });

    return (await get(gameRef(roomId))).val();
}

export async function playCardOnline(roomId, uid, cardId, chosenColor = null) {
    const hand = (await get(handRef(roomId, uid))).val() || [];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error("Kartu tidak dimiliki");
    const card = hand[idx];

    let pickedColor = normalizeColor(chosenColor);
    if (
        (card.value === "wild" || card.value === "wild_draw4") &&
        !pickedColor
    ) {
        throw new Error("Pilih warna dulu");
    }

    // Capture for transaction (primitive — aman di-retry)
    const playValue = card.value;
    const playColor = card.color;
    const playId = card.id;
    const colorChoice = pickedColor;

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing" || game.winner) return;
        if (game.currentTurn !== uid) return;

        const stackingOn = !!game.stacking;
        const stackAmt0 = game.stackAmount || 0;

        const cardObj = {
            id: playId,
            value: playValue,
            color: playColor
        };

        if (stackAmt0 > 0 && stackingOn) {
            const ok =
                (game.stackType === "draw2" && playValue === "draw2") ||
                (game.stackType === "wild_draw4" && playValue === "wild_draw4");
            if (!ok) return;
        } else if (!canPlayCard(cardObj, game.topCard, game.currentColor)) {
            return;
        }

        const colorBefore = game.currentColor;
        const ids = game.playerIds || [];
        let dir = game.direction || 1;

        // Warna aktif setelah main
        const finalColor =
            playValue === "wild" || playValue === "wild_draw4"
                ? colorChoice
                : playColor;

        // topCard: value asli + color = warna aktif (UI kartu +4 kuning, dll)
        game.topCard = {
            id: playId,
            value: playValue,
            color: finalColor
        };
        game.currentColor = finalColor;

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = Math.max(0, (counts[uid] || 1) - 1);
        game.handCounts = counts;

        if (playValue === "reverse") {
            dir *= -1;
            game.direction = dir;
        }

        game.challenge = null;
        game._forceDraw = null;

        let forceN = 0;
        let forceUid = null;

        if (playValue === "draw2") {
            if (stackingOn) {
                game.stackAmount = stackAmt0 + 2;
                game.stackType = "draw2";
            } else {
                forceUid = nextPlayer(ids, uid, dir);
                forceN = 2;
                game._forceDraw = { uid: forceUid, n: forceN };
                game.stackAmount = 0;
                game.stackType = null;
            }
        } else if (playValue === "wild_draw4") {
            if (stackingOn) {
                game.stackAmount = stackAmt0 + 4;
                game.stackType = "wild_draw4";
            } else {
                forceUid = nextPlayer(ids, uid, dir);
                forceN = 4;
                game._forceDraw = { uid: forceUid, n: forceN };
                game.challenge = {
                    type: "wild_draw4",
                    from: forceUid,
                    target: uid,
                    colorAtPlay: colorBefore,
                    pendingVictim: forceUid
                };
                game.stackAmount = 0;
                game.stackType = null;
            }
        } else {
            game.stackAmount = 0;
            game.stackType = null;
        }

        if (counts[uid] === 1) {
            game.pendingUno = uid;
            game.unoCalled = { ...(game.unoCalled || {}), [uid]: false };
        } else if (game.pendingUno === uid) {
            game.pendingUno = null;
        }

        if (counts[uid] === 0) {
            game.roundWinner = uid;
            game.status = "round_end";
        } else {
            // Giliran berikutnya
            let cursor = nextPlayer(ids, uid, dir);

            const isSkip =
                playValue === "skip" ||
                (playValue === "reverse" && ids.length === 2);

            // +2/+4 tanpa stack: korban dilewati
            const isDrawSkip =
                !stackingOn &&
                (playValue === "draw2" || playValue === "wild_draw4");

            if (isSkip || isDrawSkip) {
                cursor = nextPlayer(ids, cursor, dir);
            }

            game.currentTurn = cursor;
            game.turnEndsAt = Date.now() + 30000;
        }

        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Kartu tidak valid / bukan giliran / harus stack");
    }

    // Hapus kartu dari hand
    await set(
        handRef(roomId, uid),
        hand.filter((c) => c.id !== cardId)
    );

    let g = result.snapshot.val();

    // Auto-beri +2/+4 ke korban (sekali saja — guard _forceDraw null setelah apply)
    if (g?._forceDraw?.n && g._forceDraw.uid) {
        const forceUid = g._forceDraw.uid;
        const forceN = g._forceDraw.n;
        // Clear flag dulu agar retry/listener tidak double-apply
        await update(gameRef(roomId), { _forceDraw: null });
        g = await giveCardsFromPile(roomId, g, forceUid, forceN);
    }

    if (g?.status === "round_end" && g.roundWinner) {
        await finalizeRound(roomId, g);
        g = (await get(gameRef(roomId))).val();
    }

    return g;
}

async function finalizeRound(roomId, game) {
    const scores = { ...(game.scores || {}) };
    let totalGained = 0;
    for (const pid of game.playerIds || []) {
        if (pid === game.roundWinner) continue;
        const h = (await get(handRef(roomId, pid))).val() || [];
        totalGained += scoreHand(h);
    }
    scores[game.roundWinner] = (scores[game.roundWinner] || 0) + totalGained;
    const target = game.targetScore || 500;
    const matchOver = scores[game.roundWinner] >= target;

    await update(gameRef(roomId), {
        scores,
        status: matchOver ? "finished" : "round_end",
        winner: matchOver ? game.roundWinner : null,
        updatedAt: Date.now()
    });
}

export async function acceptStack(roomId, uid) {
    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.currentTurn !== uid) return;
        if (!game.stackAmount) return;
        const n = game.stackAmount;
        game._forceDraw = { uid, n };
        game.stackAmount = 0;
        game.stackType = null;
        const ids = game.playerIds || [];
        const dir = game.direction || 1;
        game.currentTurn = nextPlayer(ids, uid, dir);
        game.updatedAt = Date.now();
        return game;
    });
    if (!result.committed) throw new Error("Tidak ada stack");

    let g = result.snapshot.val();
    if (g?._forceDraw?.n) {
        g = await giveCardsFromPile(roomId, g, g._forceDraw.uid, g._forceDraw.n);
    }
    return g;
}

export async function drawCardOnline(roomId, uid) {
    // Cek dulu stack
    const pre = (await get(gameRef(roomId))).val();
    if (pre?.stackAmount > 0 && pre.stacking && pre.currentTurn === uid) {
        return acceptStack(roomId, uid);
    }

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.currentTurn !== uid) return;
        if (game.stackAmount > 0 && game.stacking) return;

        const pile = game.drawPile || [];
        if (!pile.length) return;

        const drawn = pile.pop();
        game.drawPile = pile;
        game.drawPileCount = pile.length;
        game._drawnCard = { uid, card: drawn };

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = (counts[uid] || 0) + 1;
        game.handCounts = counts;

        const ids = game.playerIds || [];
        game.currentTurn = nextPlayer(ids, uid, game.direction || 1);
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Tidak bisa draw (bukan giliran / pile kosong)");
    }

    const g = result.snapshot.val();
    if (g?._drawnCard?.card && g._drawnCard.uid === uid) {
        const h = (await get(handRef(roomId, uid))).val() || [];
        await set(handRef(roomId, uid), [...h, g._drawnCard.card]);
        await update(gameRef(roomId), { _drawnCard: null });
    }
    return (await get(gameRef(roomId))).val();
}
