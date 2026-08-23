/**
 * Matchmaking — Quick Match + Ranked queue + bot fill
 */
import {
    ref,
    set,
    get,
    remove,
    update,
    push,
    onValue,
    off,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { createRoom, joinRoomByCode, getRoom } from "./roomManager.js";
import { createRoomCode } from "./roomCode.js";
import { ensureRankedProfile, RANKED_MAX_PLAYERS, DEFAULT_MMR } from "./ranked.js";
import { logger } from "../utils/logger.js";

const QUEUE_CASUAL = "matchmaking/casual";
const QUEUE_RANKED = "matchmaking/ranked";

/**
 * Quick / Ranked find-or-create.
 * @returns {{ roomId: string, roomCode: string, mode: string }}
 */
export async function findQuickMatch(user, options = {}) {
    const mode = options.mode === "ranked" ? "ranked" : "casual";
    const maxPlayers = options.maxPlayers ?? RANKED_MAX_PLAYERS;
    const botFill = options.botFill !== false;

    if (mode === "ranked") {
        await ensureRankedProfile(user.uid);
    }

    // 1) Try join an existing open waiting room of same mode
    const open = await findOpenWaitingRoom(mode, maxPlayers);
    if (open) {
        try {
            const { roomId, roomCode } = await joinOpenRoom(user, open.roomId);
            logger.info("[Matchmaking] Joined open room", roomId);
            return { roomId, roomCode, mode };
        } catch (e) {
            logger.warn("[Matchmaking] join open failed:", e.message);
        }
    }

    // 2) Create new room
    const { roomId, roomCode } = await createRoom(user, {
        maxPlayers,
        isPrivate: false,
        botFill,
        customRules: options.customRules || {
            drawStacking: false,
            sevenSwap: false,
            zeroRotation: false,
            forcePlay: false,
            challengeDraw: true,
            callLastCard: true
        }
    });

    // Tag mode on room meta
    await update(ref(database, `rooms/${roomId}/meta`), {
        mode,
        matchmaking: true
    });
    await update(ref(database, `rooms/${roomId}/settings`), {
        botFill,
        isPrivate: false
    });

    // Register in queue index for others
    await set(ref(database, `${mode === "ranked" ? QUEUE_RANKED : QUEUE_CASUAL}/${roomId}`), {
        roomId,
        hostId: user.uid,
        createdAt: Date.now(),
        maxPlayers,
        mode
    });

    logger.info("[Matchmaking] Created", mode, roomId, roomCode);
    return { roomId, roomCode, mode };
}

async function findOpenWaitingRoom(mode, maxPlayers) {
    const path = mode === "ranked" ? QUEUE_RANKED : QUEUE_CASUAL;
    let snap;
    try {
        snap = await get(ref(database, path));
    } catch {
        return null;
    }
    if (!snap.exists()) return null;

    const entries = Object.values(snap.val() || {});
    for (const e of entries) {
        if (!e?.roomId) continue;
        try {
            const room = await getRoom(e.roomId);
            if (!room || room.meta?.status !== "waiting") {
                await remove(ref(database, `${path}/${e.roomId}`)).catch(() => {});
                continue;
            }
            const count = Object.keys(room.players || {}).length;
            if (count < (room.settings?.maxPlayers || maxPlayers)) {
                return e;
            }
        } catch (_) {}
    }
    return null;
}

async function joinOpenRoom(user, roomId) {
    const room = await getRoom(roomId);
    if (!room) throw new Error("Room tidak ada");
    const code = room.meta?.roomCode;
    if (!code) throw new Error("Room tanpa kode");

    // Reuse join by writing player directly (same as joinRoomByCode path)
    const { joinRoomByCode: join } = await import("./roomManager.js");
    return join(user, code);
}

/**
 * Fill empty seats with bots (host only, lobby waiting).
 * Bots are local markers in room.players with isBot: true.
 */
export async function fillBots(roomId, hostUid, targetCount = RANKED_MAX_PLAYERS) {
    const room = await getRoom(roomId);
    if (!room) throw new Error("Room tidak ada");
    if (room.meta?.hostId !== hostUid) throw new Error("Hanya host yang bisa fill bot");
    if (room.meta?.status !== "waiting") throw new Error("Hanya di lobby");

    const players = { ...(room.players || {}) };
    let n = Object.keys(players).length;
    const updates = {};

    while (n < targetCount) {
        const botId = `bot-${Date.now().toString(36)}-${n}`;
        updates[`players/${botId}`] = {
            uid: botId,
            ready: true,
            connected: true,
            status: "active",
            isBot: true,
            displayName: `Bot ${n}`,
            joinedAt: Date.now()
        };
        n++;
    }

    if (Object.keys(updates).length) {
        await update(ref(database, `rooms/${roomId}`), updates);
        logger.info("[Matchmaking] Filled bots in", roomId);
    }
    return getRoom(roomId);
}

/**
 * Remove room from matchmaking index when match starts / closed.
 */
export async function clearFromQueue(roomId, mode = "casual") {
    const path = mode === "ranked" ? QUEUE_RANKED : QUEUE_CASUAL;
    try {
        await remove(ref(database, `${path}/${roomId}`));
    } catch (_) {}
}
