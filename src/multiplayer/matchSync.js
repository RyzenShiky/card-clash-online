/**
 * Multiplayer match sync via Realtime Database
 * Host deals once → semua client subscribe public + hand sendiri.
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
import { canPlayCard, isWinner } from "../game/rules.js";
import { logger } from "../utils/logger.js";

function gameRef(roomId) {
    return ref(database, `rooms/${roomId}/game`);
}

function handRef(roomId, uid) {
    return ref(database, `rooms/${roomId}/hands/${uid}`);
}

/**
 * Host only: shuffle, deal, tulis public + hands ke RTDB.
 */
export async function initMatchOnHost(roomId, playerIds) {
    const gSnap = await get(gameRef(roomId));
    if (gSnap.exists() && gSnap.val()?.status === "playing") {
        logger.info("[Match] Already initialized");
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
        updatedAt: Date.now()
    };

    // Tulis public (drawPile ikut — demo; production: server-only)
    await set(gameRef(roomId), publicState);

    // Tulis hand per pemain
    for (let i = 0; i < playerIds.length; i++) {
        await set(handRef(roomId, playerIds[i]), hands[i]);
    }

    logger.info("[Match] Host dealt cards for", playerIds.length, "players");
    return publicState;
}

/**
 * Subscribe public game state.
 */
export function subscribePublic(roomId, callback) {
    const r = gameRef(roomId);
    onValue(r, (snap) => callback(snap.exists() ? snap.val() : null));
    return () => off(r);
}

/**
 * Subscribe own hand only.
 */
export function subscribeHand(roomId, uid, callback) {
    const r = handRef(roomId, uid);
    onValue(r, (snap) => callback(snap.exists() ? snap.val() : []));
    return () => off(r);
}

/**
 * Play card — transaction on public + update hand.
 */
export async function playCardOnline(roomId, uid, cardId, chosenColor = null) {
    const hRef = handRef(roomId, uid);
    const handSnap = await get(hRef);
    const hand = handSnap.exists() ? handSnap.val() : [];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new Error("Kartu tidak dimiliki");

    const card = hand[idx];

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.winner) return;
        if (game.currentTurn !== uid) return; // abort — bukan giliran

        if (!canPlayCard(card, game.topCard, game.currentColor)) {
            return; // abort invalid
        }

        // Apply card
        game.topCard = card;
        if (card.value === "wild" || card.value === "wild_draw4") {
            game.currentColor = chosenColor || "red";
        } else {
            game.currentColor = card.color;
        }

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = Math.max(0, (counts[uid] || 1) - 1);
        game.handCounts = counts;

        // Effects
        let ids = game.playerIds || [];
        let dir = game.direction || 1;
        let turnIdx = ids.indexOf(game.currentTurn);

        const nextIdx = () => {
            turnIdx = (turnIdx + dir + ids.length) % ids.length;
            return ids[turnIdx];
        };

        if (card.value === "reverse") {
            dir *= -1;
            game.direction = dir;
            if (ids.length === 2) {
                // 2 player reverse = skip
                nextIdx();
            }
        }
        if (card.value === "skip") {
            nextIdx(); // skip next
        }

        // Draw penalties: next player draws
        const drawN =
            card.value === "draw2" ? 2 : card.value === "wild_draw4" ? 4 : 0;

        if (drawN > 0) {
            const victim = nextIdx();
            const pile = game.drawPile || [];
            const drawn = [];
            for (let i = 0; i < drawN && pile.length; i++) {
                drawn.push(pile.pop());
            }
            game.drawPile = pile;
            game.drawPileCount = pile.length;
            game._pendingDraw = { uid: victim, cards: drawn };
            counts[victim] = (counts[victim] || 0) + drawn.length;
            game.handCounts = counts;
        }

        if (counts[uid] === 0) {
            game.status = "finished";
            game.winner = uid;
        } else {
            // next turn
            if (drawN === 0 && card.value !== "skip" && !(card.value === "reverse" && ids.length === 2)) {
                game.currentTurn = nextIdx();
            } else if (drawN > 0) {
                // victim already advanced; their turn skipped after draw — next after victim
                game.currentTurn = nextIdx();
            } else {
                game.currentTurn = nextIdx();
            }
        }

        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Kartu tidak valid atau bukan giliranmu");
    }

    // Remove card from hand
    const newHand = hand.filter((c) => c.id !== cardId);
    await set(hRef, newHand);

    // Apply pending draw to victim hand
    const g = result.snapshot.val();
    if (g?._pendingDraw?.cards?.length) {
        const { uid: vid, cards } = g._pendingDraw;
        const vSnap = await get(handRef(roomId, vid));
        const vHand = vSnap.exists() ? vSnap.val() : [];
        await set(handRef(roomId, vid), [...vHand, ...cards]);
        // clear pending
        await update(gameRef(roomId), { _pendingDraw: null });
    }

    return g;
}

/**
 * Draw one card from shared pile.
 */
export async function drawCardOnline(roomId, uid) {
    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.currentTurn !== uid) return;

        const pile = game.drawPile || [];
        if (pile.length === 0) {
            // tidak reshuffle kompleks di demo
            return;
        }
        const card = pile.pop();
        game.drawPile = pile;
        game.drawPileCount = pile.length;
        game._drawnCard = { uid, card };

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = (counts[uid] || 0) + 1;
        game.handCounts = counts;

        // next turn
        const ids = game.playerIds || [];
        const dir = game.direction || 1;
        let turnIdx = ids.indexOf(uid);
        turnIdx = (turnIdx + dir + ids.length) % ids.length;
        game.currentTurn = ids[turnIdx];
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Tidak bisa draw (bukan giliran / pile kosong)");
    }

    const g = result.snapshot.val();
    const drawn = g?._drawnCard?.card;
    if (drawn && g._drawnCard.uid === uid) {
        const hSnap = await get(handRef(roomId, uid));
        const hand = hSnap.exists() ? hSnap.val() : [];
        await set(handRef(roomId, uid), [...hand, drawn]);
        await update(gameRef(roomId), { _drawnCard: null });
    }

    return g;
}
