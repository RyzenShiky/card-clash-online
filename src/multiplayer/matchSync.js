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

/** Skip pemain yang sudah finish / spectator */
function nextActivePlayer(ids, current, dir, finished = {}) {
    if (!ids?.length) return current;
    let cursor = current;
    for (let n = 0; n < ids.length + 1; n++) {
        cursor = nextPlayer(ids, cursor, dir);
        if (!finished[cursor]) return cursor;
    }
    return cursor;
}

function activeIds(ids, finished = {}) {
    return (ids || []).filter((id) => !finished[id]);
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


/**
 * Jika draw pile habis: acak ulang discard (kecuali top card) → draw pile.
 * Tidak terbatas — game tidak macet karena deck kosong.
 */
function ensureDrawPile(game, need = 1) {
    if (!game) return game;
    let pile = game.drawPile || [];
    if (pile.length >= need) {
        game.drawPileCount = pile.length;
        return game;
    }
    // Kumpulkan discard history jika ada, else hanya top tetap
    const discard = Array.isArray(game.discardPile) ? [...game.discardPile] : [];
    const top = game.topCard;
    // Kartu yang bisa di-reshuffle = discard tanpa top (by id)
    // Strip color from wilds so they don't retain last chosen color
    let pool = discard
        .filter((c) => c && (!top || c.id !== top.id))
        .map((c) => {
            if (c.value === "wild" || c.value === "wild_draw4") {
                return { id: c.id, value: c.value, color: "wild" };
            }
            return { id: c.id, value: c.value, color: c.color };
        });
    // Deduplicate by id against current pile + top
    const seen = new Set(pile.map((c) => c?.id).filter(Boolean));
    if (top?.id) seen.add(top.id);
    pool = pool.filter((c) => {
        if (!c?.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });
    // Jika tidak ada history, tidak bisa isi — biarkan kosong
    if (!pool.length && pile.length === 0) {
        game.drawPileCount = pile.length;
        return game;
    }
    // Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pile = [...pile, ...pool];
    game.drawPile = pile;
    game.drawPileCount = pile.length;
    game.discardPile = top ? [top] : [];
    game.reshuffleCount = (game.reshuffleCount || 0) + 1;
    return game;
}

export async function initMatchOnHost(roomId, playerIds, settings = {}) {
    const ids = (playerIds || []).filter(Boolean);
    if (ids.length < 2) {
        throw new Error("Minimal 2 pemain untuk memulai (isi bot jika sepi).");
    }

    const gSnap = await get(gameRef(roomId));
    if (gSnap.exists() && gSnap.val()?.status === "playing") {
        return gSnap.val();
    }

    const full = shuffle(createDeck());
    const { hands, remaining } = deal(full, ids.length, 7);
    if (!hands?.length || hands.some((h) => !h || !h.length)) {
        throw new Error("Gagal deal kartu — deck kosong?");
    }

    let discardTop = remaining.pop();
    while (
        discardTop &&
        (discardTop.value === "wild" || discardTop.value === "wild_draw4")
    ) {
        remaining.unshift(discardTop);
        discardTop = remaining.pop();
    }

    const scores = Object.fromEntries(ids.map((id) => [id, 0]));
    const turnSec = Math.max(10, Math.min(120, Number(settings.turnTimer) || 30));
    const stackingOn = !!(settings.stacking ?? settings.drawStacking);
    const publicState = {
        status: "playing",
        topCard: discardTop,
        discardPile: discardTop ? [discardTop] : [],
        currentColor: discardTop?.color || "red",
        currentTurn: ids[0],
        direction: 1,
        drawPile: remaining,
        drawPileCount: remaining.length,
        playerIds: ids,
        handCounts: Object.fromEntries(
            ids.map((id, i) => [id, hands[i].length])
        ),
        winner: null,
        roundWinner: null,
        scores,
        targetScore: settings.targetScore ?? 500,
        stacking: stackingOn,
        stackAmount: 0,
        stackType: null,
        // Rule flags from host settings
        sevenSwap: !!settings.sevenSwap,
        zeroRotation: !!settings.zeroRotation,
        forcePlay: !!settings.forcePlay,
        challengeDraw: settings.challengeDraw !== false,
        callLastCard: settings.callLastCard !== false,
        jumpIn: !!settings.jumpIn,
        allowPlayAfterDraw: settings.allowPlayAfterDraw !== false,
        turnTimerSec: turnSec,
        pendingUno: null,
        unoCalled: {},
        challenge: null,
        lastAnim: null,
        turnVersion: 0,
        lastActionId: null,
        pendingHands: {},
        turnEndsAt: Date.now() + turnSec * 1000,
        finishedPlayers: {},
        placements: [],
        spectators: {},
        updatedAt: Date.now()
    };

    try {
        await set(gameRef(roomId), publicState);
    } catch (e) {
        logger.error("[Match] write game failed:", e.code, e.message);
        throw new Error(
            "Gagal menulis game state (PERMISSION?). Publish rules terbaru. " +
                (e.message || "")
        );
    }

    for (let i = 0; i < ids.length; i++) {
        try {
            await set(handRef(roomId, ids[i]), hands[i]);
        } catch (e) {
            logger.error("[Match] write hand failed:", ids[i], e.code, e.message);
            throw new Error(
                "Gagal bagi kartu ke " +
                    String(ids[i]).slice(0, 8) +
                    " (PERMISSION hands?). " +
                    (e.message || "")
            );
        }
    }
    logger.info("[Match] Dealt", ids.length, "players, hand sizes", hands.map((h) => h.length));
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

    // Challenge success (illegal WD4): player who played WD4 draws 4
    // Challenge fail (legal WD4): challenger draws 6 (the original 4 + 2 penalty)
    // Cards were NOT auto-given on play when challenge is enabled
    const drawCount = wasIllegal ? 4 : 6;
    const victim = wasIllegal ? targetUid : challengerUid;

    let g = { ...game, drawPile: [...(game.drawPile || [])] };
    g = await giveCardsFromPile(roomId, g, victim, drawCount);

    const ids = g.playerIds || [];
    const dir = g.direction || 1;
    // After challenge resolved: turn goes to next after the victim of the WD4 effect
    // (if illegal, original player drew; turn advances past challenger who was about to take it)
    // Standard: after challenge, next turn is the player after the WD4 recipient
    const nextTurn = nextActivePlayer(
        ids,
        challengerUid,
        dir,
        g.finishedPlayers || {}
    );
    const tSec = g.turnTimerSec || 30;

    await update(gameRef(roomId), {
        challenge: null,
        stackAmount: 0,
        stackType: null,
        _forceDraw: null,
        currentTurn: nextTurn,
        turnEndsAt: Date.now() + tSec * 1000,
        turnVersion: (g.turnVersion || 0) + 1,
        lastAnim: { type: "penalty", uid: victim, n: drawCount, at: Date.now() },
        updatedAt: Date.now(),
        lastChallengeResult: wasIllegal ? "illegal" : "legal"
    });

    return { wasIllegal, victim, drawCount };
}

/** Accept WD4 without challenging — take the +4 */
export async function acceptWildDraw4(roomId, uid) {
    const gSnap = await get(gameRef(roomId));
    const game = gSnap.val();
    if (!game?.challenge || game.challenge.type !== "wild_draw4") {
        throw new Error("Tidak ada WD4 untuk diterima");
    }
    if (game.challenge.from !== uid) {
        throw new Error("Hanya penerima yang bisa accept");
    }
    const n = game.challenge.pendingDraw || 4;
    let g = { ...game, drawPile: [...(game.drawPile || [])] };
    g = await giveCardsFromPile(roomId, g, uid, n);

    const ids = g.playerIds || [];
    const dir = g.direction || 1;
    const nextTurn = nextActivePlayer(ids, uid, dir, g.finishedPlayers || {});
    const tSec = g.turnTimerSec || 30;

    await update(gameRef(roomId), {
        challenge: null,
        stackAmount: 0,
        stackType: null,
        _forceDraw: null,
        currentTurn: nextTurn,
        turnEndsAt: Date.now() + tSec * 1000,
        turnVersion: (g.turnVersion || 0) + 1,
        lastAnim: { type: "penalty", uid, n, at: Date.now() },
        updatedAt: Date.now()
    });
    return (await get(gameRef(roomId))).val();
}

/**
 * Apply cards from pile to a player (helper after transaction)
 */
async function giveCardsFromPile(roomId, game, uid, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
        ensureDrawPile(game, 1);
        const pile = game.drawPile || [];
        if (!pile.length) break;
        drawn.push(pile.pop());
        game.drawPile = pile;
        game.drawPileCount = pile.length;
    }
    if (!drawn.length) return game;
    const pile = game.drawPile || [];

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
        if (game.finishedPlayers?.[uid]) return;
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

        // Discard history untuk reshuffle — avoid pushing a card that's already the sole top
        {
            const dp = Array.isArray(game.discardPile) ? [...game.discardPile] : [];
            if (game.topCard) {
                const alreadyIn =
                    dp.length && dp[dp.length - 1]?.id === game.topCard.id;
                if (!alreadyIn) {
                    dp.push(game.topCard);
                }
            }
            // Batasi ukuran history (hindari payload RTDB membengkak)
            game.discardPile = dp.slice(-80);
        }
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
                forceUid = nextActivePlayer(ids, uid, dir, game.finishedPlayers || {});
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
                forceUid = nextActivePlayer(ids, uid, dir, game.finishedPlayers || {});
                forceN = 4;
                // Don't auto-give +4 yet if challenge is allowed — victim may challenge
                const allowChallenge = game.challengeDraw !== false;
                if (allowChallenge) {
                    game.challenge = {
                        type: "wild_draw4",
                        from: forceUid,
                        target: uid,
                        colorAtPlay: colorBefore,
                        pendingVictim: forceUid,
                        pendingDraw: 4
                    };
                    // Defer the +4 until challenge resolved or accepted
                    game._forceDraw = null;
                } else {
                    game._forceDraw = { uid: forceUid, n: forceN };
                    game.challenge = null;
                }
                game.stackAmount = 0;
                game.stackType = null;
            }
        } else {
            game.stackAmount = 0;
            game.stackType = null;
        }

        // Seven Swap: swap hands with chosen target (or next active if none)
        if (playValue === "7" && game.sevenSwap) {
            game._pendingSevenSwap = { from: uid };
        }
        // Zero Rotation: rotate all hands in current direction
        if (playValue === "0" && game.zeroRotation) {
            game._pendingZeroRotate = true;
        }

        if (counts[uid] === 1) {
            game.pendingUno = uid;
            game.unoCalled = { ...(game.unoCalled || {}), [uid]: false };
        } else if (game.pendingUno === uid) {
            game.pendingUno = null;
        }

        if (counts[uid] === 0) {
            // Pemain keluar (place) — game LANJUT untuk yang masih aktif
            const finished = { ...(game.finishedPlayers || {}) };
            if (!finished[uid]) {
                const placeNum = Object.keys(finished).length + 1;
                finished[uid] = {
                    place: placeNum,
                    finishedAt: Date.now(),
                    uid
                };
                game.finishedPlayers = finished;
                if (placeNum === 1) {
                    game.roundWinner = uid;
                    game.firstWinner = uid;
                }
            }
            const active = activeIds(ids, game.finishedPlayers);
            if (active.length <= 1) {
                // Sisa 0–1 pemain → match selesai
                game._pendingMatchEnd = true;
                game.status = "round_end";
            } else {
                game.status = "playing";
                let cursor = nextActivePlayer(ids, uid, dir, game.finishedPlayers);
                const isSkip =
                    playValue === "skip" ||
                    (playValue === "reverse" && active.length === 2);
                const isDrawSkip =
                    !stackingOn &&
                    (playValue === "draw2" || playValue === "wild_draw4");
                if (isSkip || isDrawSkip) {
                    cursor = nextActivePlayer(
                        ids,
                        cursor,
                        dir,
                        game.finishedPlayers
                    );
                }
                game.currentTurn = cursor;
                const tSec = game.turnTimerSec || 30;
                game.turnEndsAt = Date.now() + tSec * 1000;
            }
        } else {
            // Giliran berikutnya (skip yang sudah finish)
            let cursor = nextActivePlayer(ids, uid, dir, game.finishedPlayers || {});
            const active = activeIds(ids, game.finishedPlayers || {});
            const isSkip =
                playValue === "skip" ||
                (playValue === "reverse" && active.length === 2);
            // WD4 with pending challenge: turn stays on victim so they can challenge/accept
            const hasPendingChallenge =
                playValue === "wild_draw4" &&
                game.challenge &&
                game.challenge.type === "wild_draw4";
            const isDrawSkip =
                !stackingOn &&
                !hasPendingChallenge &&
                (playValue === "draw2" || playValue === "wild_draw4");
            if (isSkip || isDrawSkip) {
                cursor = nextActivePlayer(
                    ids,
                    cursor,
                    dir,
                    game.finishedPlayers || {}
                );
            } else if (hasPendingChallenge && game.challenge.from) {
                cursor = game.challenge.from;
            }
            game.currentTurn = cursor;
            const tSec = game.turnTimerSec || 30;
            game.turnEndsAt = Date.now() + tSec * 1000;
        }

        game.turnVersion = (game.turnVersion || 0) + 1;
        game.lastActionId = playId + "_" + (game.turnVersion || 0);
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Kartu tidak valid / bukan giliran / pemain sudah selesai / harus stack");
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

    // Setelah ada yang keluar: update skor + mungkin end match
    if (g?.finishedPlayers?.[uid] && countsEmpty(g, uid)) {
        await afterPlayerFinished(roomId, g, uid);
        g = (await get(gameRef(roomId))).val();
    } else if (g?._pendingMatchEnd || g?.status === "round_end") {
        await endMatchWithPlacements(roomId, g);
        g = (await get(gameRef(roomId))).val();
    }

    return g;
}

function countsEmpty(game, uid) {
    return (game?.handCounts?.[uid] ?? 1) === 0;
}

/** Setelah pemain place: tambah skor, notifikasi; game tetap playing jika masih ada lawan */
async function afterPlayerFinished(roomId, game, finishedUid) {
    const finished = game.finishedPlayers || {};
    const entry = finished[finishedUid];
    if (!entry) return;

    const scores = { ...(game.scores || {}) };
    let gained = 0;
    for (const pid of game.playerIds || []) {
        if (finished[pid]) continue;
        const h = (await get(handRef(roomId, pid))).val() || [];
        gained += scoreHand(h);
    }
    // Hanya place 1 dapat poin penuh dari sisa kartu aktif (opsional: scale by place)
    if (entry.scored) {
        // sudah diproses
        return;
    }
    if (entry.place === 1) {
        scores[finishedUid] = (scores[finishedUid] || 0) + gained;
    }

    let names = {};
    try {
        const pSnap = await get(ref(database, `rooms/${roomId}/players`));
        for (const [id, p] of Object.entries(pSnap.val() || {})) {
            names[id] = p.displayName || String(id).slice(0, 8);
        }
    } catch (_) {}

    const fp = {
        ...finished,
        [finishedUid]: {
            ...entry,
            scored: true,
            name: names[finishedUid] || entry.name || String(finishedUid).slice(0, 8)
        }
    };

    const active = activeIds(game.playerIds, fp);
    const patch = {
        scores,
        finishedPlayers: fp,
        updatedAt: Date.now()
    };

    if (active.length <= 1) {
        // Assign last place ke sisa 1 (atau end)
        if (active.length === 1) {
            const last = active[0];
            fp[last] = {
                place: Object.keys(fp).length + 1,
                finishedAt: Date.now(),
                uid: last,
                name: names[last] || String(last).slice(0, 8)
            };
            patch.finishedPlayers = fp;
        }
        await update(gameRef(roomId), patch);
        await endMatchWithPlacements(roomId, {
            ...game,
            ...patch,
            finishedPlayers: fp
        });
        return;
    }

    // Masih ada yang main — tetap playing
    patch.status = "playing";
    patch.winner = null;
    await update(gameRef(roomId), patch);
}

/** Semua place terisi → status finished + podium */
async function endMatchWithPlacements(roomId, game) {
    const finishedAt = Date.now();
    let names = {};
    try {
        const pSnap = await get(ref(database, `rooms/${roomId}/players`));
        for (const [id, p] of Object.entries(pSnap.val() || {})) {
            names[id] = p.displayName || String(id).slice(0, 8);
        }
    } catch (_) {}

    const fp = { ...(game.finishedPlayers || {}) };
    // Siapa belum ada di finished → place terakhir by sisa kartu
    const remaining = (game.playerIds || []).filter((id) => !fp[id]);
    const meta = [];
    for (const pid of remaining) {
        const h = (await get(handRef(roomId, pid))).val() || [];
        meta.push({ uid: pid, cardsLeft: h.length, handScore: scoreHand(h) });
    }
    meta.sort((a, b) => a.cardsLeft - b.cardsLeft || a.handScore - b.handScore);
    let nextPlace = Object.keys(fp).length + 1;
    for (const m of meta) {
        fp[m.uid] = {
            place: nextPlace++,
            finishedAt,
            uid: m.uid,
            name: names[m.uid] || String(m.uid).slice(0, 8),
            cardsLeft: m.cardsLeft,
            handScore: m.handScore
        };
    }

    const placements = Object.values(fp)
        .map((e) => ({
            place: e.place,
            uid: e.uid,
            name: e.name || names[e.uid] || String(e.uid).slice(0, 8),
            cardsLeft: e.cardsLeft ?? 0,
            handScore: e.handScore ?? 0,
            isMvp: e.place === 1,
            finishedAt: e.finishedAt || finishedAt
        }))
        .sort((a, b) => a.place - b.place);

    const winner = placements.find((p) => p.place === 1)?.uid || game.firstWinner;

    await update(gameRef(roomId), {
        status: "finished",
        winner,
        finishedPlayers: fp,
        placements,
        results: {
            winner,
            mvp: winner,
            finishedAt,
            placements
        },
        _pendingMatchEnd: null,
        updatedAt: finishedAt
    });
}

/** Client: pilih mode nonton (setelah place) */
export async function setSpectating(roomId, uid, enabled = true) {
    await update(gameRef(roomId), {
        [`spectators/${uid}`]: enabled
            ? { since: Date.now(), uid }
            : null
    });
}

export async function acceptStack(roomId, uid) {
    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.finishedPlayers?.[uid]) return;
        if (game.currentTurn !== uid) return;
        if (!game.stackAmount) return;
        const n = game.stackAmount;
        game._forceDraw = { uid, n };
        game.stackAmount = 0;
        game.stackType = null;
        const ids = game.playerIds || [];
        const dir = game.direction || 1;
        game.currentTurn = nextActivePlayer(ids, uid, dir, game.finishedPlayers || {});
        const tSec = game.turnTimerSec || 30;
        game.turnEndsAt = Date.now() + tSec * 1000;
        game.turnVersion = (game.turnVersion || 0) + 1;
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

export async function drawCardOnline(roomId, uid, opts = {}) {
    const actionId = opts.actionId || `${uid}_draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expectedTurnVersion = opts.turnVersion ?? null;

    // Stack accept
    const pre = (await get(gameRef(roomId))).val();
    if (pre?.stackAmount > 0 && pre.stacking && pre.currentTurn === uid) {
        if (pre.finishedPlayers?.[uid]) {
            throw new Error("Pemain sudah selesai — tidak bisa draw");
        }
        return acceptStack(roomId, uid);
    }
    if (pre?.finishedPlayers?.[uid]) {
        throw new Error("Pemain sudah selesai — tidak bisa draw");
    }

    let reservedCard = null;

    const result = await runTransaction(gameRef(roomId), (game) => {
        if (!game || game.status !== "playing") return;
        if (game.winner) return;
        if (game.finishedPlayers?.[uid]) return;
        if (game.currentTurn !== uid) return;
        if (game.stackAmount > 0 && game.stacking) return;

        // Idempotency
        if (game.lastActionId === actionId) {
            return game; // already applied
        }
        if (
            expectedTurnVersion != null &&
            game.turnVersion != null &&
            game.turnVersion !== expectedTurnVersion
        ) {
            return; // stale
        }

        ensureDrawPile(game, 1);
        const pile = game.drawPile || [];
        if (!pile.length) return; // benar-benar kosong (semua kartu di tangan)

        const drawn = pile.pop();
        reservedCard = drawn;
        game.drawPile = pile;
        game.drawPileCount = pile.length;

        // Simpan kartu di pendingHands agar tidak hilang jika hand write gagal
        const pending = { ...(game.pendingHands || {}) };
        const prev = Array.isArray(pending[uid]) ? pending[uid] : [];
        pending[uid] = [...prev, drawn];
        game.pendingHands = pending;

        const counts = { ...(game.handCounts || {}) };
        counts[uid] = (counts[uid] || 0) + 1;
        game.handCounts = counts;

        const ids = game.playerIds || [];
        const dir = game.direction || 1;
        const canPlayDrawn = game.allowPlayAfterDraw !== false;
        // If allowPlayAfterDraw: keep turn on drawer so they may play the drawn card
        // Mark drawnPending so they can only play that one card or pass
        if (canPlayDrawn && reservedCard) {
            game.drawnPending = { uid, cardId: reservedCard.id };
            // keep currentTurn = uid
        } else {
            game.drawnPending = null;
            game.currentTurn = nextActivePlayer(
                ids,
                uid,
                dir,
                game.finishedPlayers || {}
            );
        }
        game.turnVersion = (game.turnVersion || 0) + 1;
        game.lastActionId = actionId;
        game.lastAction = {
            type: "draw",
            uid,
            actionId,
            at: Date.now()
        };
        const tSec = game.turnTimerSec || 30;
        game.turnEndsAt = Date.now() + tSec * 1000;
        game.updatedAt = Date.now();
        return game;
    });

    if (!result.committed) {
        throw new Error("Tidak bisa draw (bukan giliran / sudah selesai / pile kosong)");
    }

    const g = result.snapshot.val();

    // Merge pendingHands → hand privat (idempotent)
    const pendingList = g?.pendingHands?.[uid];
    if (Array.isArray(pendingList) && pendingList.length) {
        const h = (await get(handRef(roomId, uid))).val() || [];
        const have = new Set(h.map((c) => c?.id));
        const merged = [...h];
        for (const c of pendingList) {
            if (c?.id && !have.has(c.id)) {
                merged.push(c);
                have.add(c.id);
            }
        }
        await set(handRef(roomId, uid), merged);
        // clear pending for this uid
        await update(gameRef(roomId), {
            [`pendingHands/${uid}`]: null
        });
    } else if (reservedCard) {
        // fallback
        const h = (await get(handRef(roomId, uid))).val() || [];
        if (!h.some((c) => c?.id === reservedCard.id)) {
            await set(handRef(roomId, uid), [...h, reservedCard]);
        }
    }

    return (await get(gameRef(roomId))).val();
}
