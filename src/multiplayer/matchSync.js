/**
 * Multiplayer match sync + UNO mechanics (client-validated transactions).
 * Production: pindahkan validasi ke Cloud Functions.
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
import { canPlayCard, isWinner, scoreHand } from "../game/rules.js";
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
    return ids[(i + dir + ids.length * 10) % ids.length];
}

/** Apakah hand punya kartu warna matching (bukan wild) untuk rule WD4 */
function hasMatchingColor(hand, color) {
    if (!color) return false;
    return (hand || []).some(
        (c) => c.color === color && c.value !== "wild" && c.value !== "wild_draw4"
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
        stacking: settings.stacking ?? false,
        stackAmount: 0,
        stackType: null, // draw2 | wild_draw4
        pendingUno: null, // uid that must call UNO
        unoCalled: {},
        challenge: null, // { type, from, target, card }
        turnEndsAt: Date.now() + (settings.turnTimer || 30) * 1000,
        updatedAt: Date.now()
    };

    await set(gameRef(roomId), publicState);
    for (let i = 0; i < playerIds.length; i++) {
        await set(handRef(roomId, playerIds[i]), hands[i]);
    }
    logger.info("[Match] Dealt", playerIds.length, "players stacking=", publicState.stacking);
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

/** Pemain dengan 1 kartu wajib UNO */
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
    return true;
}

/** Lawan challenge: lupa UNO → penalti draw 2 */
export async function challengeUno(roomId, challengerUid, targetUid) {
    if (challengerUid === targetUid) throw new Error("Tidak bisa challenge diri sendiri");

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        const count = game.handCounts?.[targetUid] ?? 0;
        const called = game.unoCalled?.[targetUid];
        if (count !== 1 || called) return; // tidak valid

        const pile = game.drawPile || [];
        const drawn = [];
        for (let i = 0; i < 2 && pile.length; i++) drawn.push(pile.pop());
        game.drawPile = pile;
        game.drawPileCount = pile.length;
        game._penaltyDraw = { uid: targetUid, cards: drawn };
        game.handCounts = {
            ...game.handCounts,
            [targetUid]: count + drawn.length
        };
        game.pendingUno = null;
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) throw new Error("Challenge UNO tidak valid (sudah UNO / bukan 1 kartu)");

    const g = result.snapshot.val();
    if (g?._penaltyDraw?.cards?.length) {
        const { uid, cards } = g._penaltyDraw;
        const h = (await get(handRef(roomId, uid))).val() || [];
        await set(handRef(roomId, uid), [...h, ...cards]);
        await update(gameRef(roomId), { _penaltyDraw: null });
    }
    return true;
}

/**
 * Challenge Wild Draw 4
 * jujur (tidak punya warna) → challenger draw 6
 * curang (punya warna) → target draw 4, challenger tidak
 */
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
    // Batalkan penalti 4 awal pada challenger jika ada
    if (game.challenge.pendingVictim === challengerUid) {
        // sudah di-draw di play — simplify: victim gets drawCount
    }
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
        updatedAt: Date.now(),
        lastChallengeResult: wasIllegal ? "illegal" : "legal"
    });

    return { wasIllegal, victim, drawCount };
}

export async function playCardOnline(roomId, uid, cardId, chosenColor = null) {
    const hand = (await get(handRef(roomId, uid))).val() || [];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error("Kartu tidak dimiliki");
    const card = hand[idx];

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing" || game.winner) return;
        if (game.currentTurn !== uid) return;

        // Stacking: jika ada stack, hanya boleh reply dengan tipe sama
        if (game.stackAmount > 0 && game.stacking) {
            const ok =
                (game.stackType === "draw2" && card.value === "draw2") ||
                (game.stackType === "wild_draw4" && card.value === "wild_draw4");
            if (!ok) return;
        } else if (
            !canPlayCard(card, game.topCard, game.currentColor)
        ) {
            return;
        }

        // WD4 legal check soft: still allow play, challenge handles cheat
        const colorBefore = game.currentColor;
        game.topCard = card;
        if (card.value === "wild" || card.value === "wild_draw4") {
            game.currentColor = chosenColor || "red";
        } else {
            game.currentColor = card.color;
        }

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = Math.max(0, (counts[uid] || 1) - 1);
        game.handCounts = counts;

        const ids = game.playerIds || [];
        let dir = game.direction || 1;

        if (card.value === "reverse") {
            dir *= -1;
            game.direction = dir;
            if (ids.length === 2) {
                // acts as skip
            }
        }

        // Clear previous challenge
        game.challenge = null;

        let stackAmt = game.stackAmount || 0;
        let stackType = game.stackType;

        if (card.value === "draw2") {
            if (game.stacking) {
                stackAmt += 2;
                stackType = "draw2";
                game.stackAmount = stackAmt;
                game.stackType = stackType;
            } else {
                game._forceDraw = { uid: nextPlayer(ids, uid, dir), n: 2 };
            }
        } else if (card.value === "wild_draw4") {
            if (game.stacking) {
                stackAmt += 4;
                stackType = "wild_draw4";
                game.stackAmount = stackAmt;
                game.stackType = stackType;
            } else {
                const victim = nextPlayer(ids, uid, dir);
                game._forceDraw = { uid: victim, n: 4 };
                game.challenge = {
                    type: "wild_draw4",
                    from: victim,
                    target: uid,
                    colorAtPlay: colorBefore,
                    pendingVictim: victim
                };
            }
        } else {
            // non-draw clears stack by playing — if stack was active and they played other, already blocked
            game.stackAmount = 0;
            game.stackType = null;
        }

        // UNO pending
        if (counts[uid] === 1) {
            game.pendingUno = uid;
            game.unoCalled = { ...(game.unoCalled || {}), [uid]: false };
        } else {
            if (game.pendingUno === uid) game.pendingUno = null;
        }

        if (counts[uid] === 0) {
            game.roundWinner = uid;
            // scoring handled after transaction via hands
            game.status = "round_end";
        } else {
            let next = nextPlayer(ids, uid, dir);
            if (card.value === "skip" || (card.value === "reverse" && ids.length === 2)) {
                next = nextPlayer(ids, next, dir);
            }
            if (card.value === "draw2" && !game.stacking) {
                next = nextPlayer(ids, next, dir); // skip victim
            }
            if (card.value === "wild_draw4" && !game.stacking) {
                next = nextPlayer(ids, next, dir);
            }
            if (game.stacking && stackAmt > 0 && (card.value === "draw2" || card.value === "wild_draw4")) {
                next = nextPlayer(ids, uid, dir); // next must stack or accept
            }
            game.currentTurn = next;
        }

        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Kartu tidak valid / bukan giliran / harus stack");
    }

    const newHand = hand.filter((c) => c.id !== cardId);
    await set(handRef(roomId, uid), newHand);

    let g = result.snapshot.val();

    // Force draw (non-stack)
    if (g?._forceDraw?.n) {
        const { uid: vid, n } = g._forceDraw;
        const pile = [...(g.drawPile || [])];
        const drawn = [];
        for (let i = 0; i < n && pile.length; i++) drawn.push(pile.pop());
        const vh = (await get(handRef(roomId, vid))).val() || [];
        await set(handRef(roomId, vid), [...vh, ...drawn]);
        const counts = { ...(g.handCounts || {}) };
        counts[vid] = (counts[vid] || 0) + drawn.length;
        await update(gameRef(roomId), {
            drawPile: pile,
            drawPileCount: pile.length,
            handCounts: counts,
            _forceDraw: null
        });
        g = (await get(gameRef(roomId))).val();
    }

    // Round end scoring
    if (g?.status === "round_end" && g.roundWinner) {
        await finalizeRound(roomId, g);
    }

    return (await get(gameRef(roomId))).val();
}

async function finalizeRound(roomId, game) {
    const scores = { ...(game.scores || {}) };
    let totalGained = 0;
    for (const pid of game.playerIds || []) {
        if (pid === game.roundWinner) continue;
        const h = (await get(handRef(roomId, pid))).val() || [];
        const pts = scoreHand(h);
        totalGained += pts;
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

/** Terima stack: ambil akumulasi kartu */
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
    if (g?._forceDraw) {
        const { uid: vid, n } = g._forceDraw;
        const pile = [...(g.drawPile || [])];
        const drawn = [];
        for (let i = 0; i < n && pile.length; i++) drawn.push(pile.pop());
        const vh = (await get(handRef(roomId, vid))).val() || [];
        await set(handRef(roomId, vid), [...vh, ...drawn]);
        const counts = { ...(g.handCounts || {}) };
        counts[vid] = (counts[vid] || 0) + drawn.length;
        await update(gameRef(roomId), {
            drawPile: pile,
            drawPileCount: pile.length,
            handCounts: counts,
            _forceDraw: null
        });
    }
}

export async function drawCardOnline(roomId, uid) {
    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.currentTurn !== uid) return;
        // Jika stacking aktif, draw = accept stack
        if (game.stackAmount > 0 && game.stacking) return;

        const pile = game.drawPile || [];
        if (!pile.length) return;
        const card = pile.pop();
        game.drawPile = pile;
        game.drawPileCount = pile.length;
        game._drawnCard = { uid, card };
        const counts = { ...(game.handCounts || {}) };
        counts[uid] = (counts[uid] || 0) + 1;
        game.handCounts = counts;
        const ids = game.playerIds || [];
        game.currentTurn = nextPlayer(ids, uid, game.direction || 1);
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        // coba accept stack
        const g = (await get(gameRef(roomId))).val();
        if (g?.stackAmount > 0 && g.currentTurn === uid) {
            await acceptStack(roomId, uid);
            return (await get(gameRef(roomId))).val();
        }
        throw new Error("Tidak bisa draw");
    }

    const g = result.snapshot.val();
    if (g?._drawnCard?.card && g._drawnCard.uid === uid) {
        const hand = (await get(handRef(roomId, uid))).val() || [];
        await set(handRef(roomId, uid), [...hand, g._drawnCard.card]);
        await update(gameRef(roomId), { _drawnCard: null });
    }
    return (await get(gameRef(roomId))).val();
}
