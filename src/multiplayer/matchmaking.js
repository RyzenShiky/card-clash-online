/**
 * Matchmaking Ranked / Casual
 *
 * Ranked flow:
 *  1. Cari antrean room waiting (pemain manusia online)
 *  2. Jika tidak ada → buat room antrean
 *  3. Tunggu SEARCH_WAIT_MS untuk manusia lain
 *  4. Jika masih sepi → isi bot otomatis sampai 6
 *  5. Pemain tekan Ready → jika 6/6 & semua manusia ready → auto-start (tanpa tombol Start host)
 */
import {
    ref,
    set,
    get,
    remove,
    update
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { createRoom, getRoom } from "./roomManager.js";
import {
    ensureRankedProfile,
    RANKED_MAX_PLAYERS,
    averageHumanMmr,
    botDifficultyFromMmr,
    DEFAULT_MMR
} from "./ranked.js";
import { logger } from "../utils/logger.js";

const QUEUE_CASUAL = "matchmaking/casual";
const QUEUE_RANKED = "matchmaking/ranked";

/** Tunggu pemain manusia sebelum isi bot */
export const SEARCH_WAIT_MS = 10_000;

const BOT_NAMES = [
    "Andi", "Budi", "Citra", "Dewi", "Eko", "Fajar", "Gita", "Hana",
    "Irfan", "Joko", "Kartika", "Lina", "Maya", "Nanda", "Omar", "Putri",
    "Rafi", "Sari", "Tono", "Wulan", "Yoga", "Zahra"
];

function queuePath(mode) {
    return mode === "ranked" ? QUEUE_RANKED : QUEUE_CASUAL;
}

/**
 * @returns {{ roomId, roomCode, mode, isHost }}
 */
export async function findQuickMatch(user, options = {}) {
    const mode = options.mode === "ranked" ? "ranked" : "casual";
    const maxPlayers =
        options.maxPlayers ??
        (mode === "ranked" ? RANKED_MAX_PLAYERS : 4);
    const botFill = options.botFill !== false;

    if (mode === "ranked") {
        await ensureRankedProfile(user.uid);
    }

    const open = await findOpenWaitingRoom(mode, maxPlayers);
    if (open) {
        try {
            const { roomId, roomCode } = await joinOpenRoom(user, open.roomId);
            logger.info("[Matchmaking] Joined queue", roomId);
            return { roomId, roomCode, mode, isHost: false };
        } catch (e) {
            logger.warn("[Matchmaking] join open failed:", e.message);
        }
    }

    const { roomId, roomCode } = await createRoom(user, {
        maxPlayers,
        isPrivate: false,
        botFill,
        turnTimer: options.customRules?.turnTimer ?? 30,
        targetScore: options.customRules?.targetScore ?? 500,
        customRules: options.customRules || {
            drawStacking: false,
            sevenSwap: false,
            zeroRotation: false,
            forcePlay: false,
            challengeDraw: true,
            callLastCard: true
        }
    });

    await update(ref(database, `rooms/${roomId}/meta`), {
        mode,
        matchmaking: true,
        searchStartedAt: Date.now()
    });
    await update(ref(database, `rooms/${roomId}/settings`), {
        botFill,
        isPrivate: false,
        autoStart: true,
        maxPlayers
    });

    await set(ref(database, `${queuePath(mode)}/${roomId}`), {
        roomId,
        hostId: user.uid,
        createdAt: Date.now(),
        maxPlayers,
        mode
    });

    logger.info("[Matchmaking] Created queue", mode, roomId, "max", maxPlayers);
    return { roomId, roomCode, mode, isHost: true };
}

async function findOpenWaitingRoom(mode, maxPlayers) {
    const path = queuePath(mode);
    let snap;
    try {
        snap = await get(ref(database, path));
    } catch {
        return null;
    }
    if (!snap.exists()) return null;

    const entries = Object.values(snap.val() || {}).sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );

    for (const e of entries) {
        if (!e?.roomId) continue;
        try {
            const room = await getRoom(e.roomId);
            if (!room || room.meta?.status !== "waiting") {
                await remove(ref(database, `${path}/${e.roomId}`)).catch(() => {});
                continue;
            }
            const total = Object.keys(room.players || {}).length;
            const max = room.settings?.maxPlayers || maxPlayers;
            if (total < max) return e;
        } catch (_) {}
    }
    return null;
}

async function joinOpenRoom(user, roomId) {
    const room = await getRoom(roomId);
    if (!room) throw new Error("Room tidak ada");
    const code = room.meta?.roomCode;
    if (!code) throw new Error("Room tanpa kode");
    const { joinRoomByCode: join } = await import("./roomManager.js");
    return join(user, code);
}

export function countHumans(players) {
    return Object.values(players || {}).filter((p) => p && !p.isBot).length;
}

export function countPlayers(players) {
    return Object.keys(players || {}).length;
}

export function isLobbyFull(room, max = RANKED_MAX_PLAYERS) {
    return countPlayers(room?.players) >= (room?.settings?.maxPlayers || max);
}

export function allHumansReady(room) {
    const humans = Object.values(room?.players || {}).filter((p) => p && !p.isBot);
    if (!humans.length) return false;
    return humans.every((p) => p.ready === true);
}

export async function maybeFillBotsAfterSearch(roomId, hostUid, options = {}) {
    const target = options.targetCount ?? RANKED_MAX_PLAYERS;
    const room = await getRoom(roomId);
    if (!room) return null;
    if (room.meta?.hostId !== hostUid) return room;
    if (room.meta?.status !== "waiting") return room;
    if (room.settings?.botFill === false) return room;
    if (countPlayers(room.players) >= target) return room;
    return fillBots(roomId, hostUid, target);
}

/**
 * Isi bot dengan skill di atas rata-rata manusia (Card-Elo balance).
 */
export async function fillBots(roomId, hostUid, targetCount = RANKED_MAX_PLAYERS) {
    const room = await getRoom(roomId);
    if (!room) throw new Error("Room tidak ada");
    if (room.meta?.hostId !== hostUid) throw new Error("Hanya host");
    if (room.meta?.status !== "waiting") throw new Error("Hanya di lobby");

    const players = { ...(room.players || {}) };
    let n = Object.keys(players).length;
    const usedNames = new Set(
        Object.values(players).map((p) => p.displayName).filter(Boolean)
    );
    const humanAvg = await averageHumanMmr(players);
    // Bot sedikit lebih kuat dari rata-rata
    const botBaseMmr = Math.round(humanAvg + 40 + Math.random() * 40);

    const updates = {};
    const shuffle = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let i = 0;

    while (n < targetCount) {
        const botId = `bot-${Date.now().toString(36)}-${n}-${Math.random().toString(36).slice(2, 5)}`;
        let name = shuffle[i % shuffle.length] || `Pemain ${n + 1}`;
        if (usedNames.has(name)) name = `${name}${n}`;
        usedNames.add(name);

        // Variasi skill bot di sekitar base (atas rata-rata)
        const mmr = Math.round(botBaseMmr + (Math.random() * 60 - 15));
        const difficulty = botDifficultyFromMmr(mmr, humanAvg);

        updates[`players/${botId}`] = {
            uid: botId,
            ready: true,
            connected: true,
            status: "active",
            isBot: true,
            displayName: name,
            botMmr: mmr,
            botDifficulty: difficulty,
            joinedAt: Date.now()
        };
        n++;
        i++;
    }

    if (Object.keys(updates).length) {
        await update(ref(database, `rooms/${roomId}`), updates);
        logger.info(
            "[Matchmaking] Bots filled",
            roomId,
            "avgHuman",
            Math.round(humanAvg),
            "botBase",
            botBaseMmr
        );
    }
    return getRoom(roomId);
}

export async function clearFromQueue(roomId, mode = "casual") {
    try {
        await remove(ref(database, `${queuePath(mode)}/${roomId}`));
    } catch (_) {}
}

export async function tryAutoStart(roomId, hostUid) {
    const room = await getRoom(roomId);
    if (!room) return false;
    if (room.meta?.hostId !== hostUid) return false;
    if (room.meta?.status !== "waiting") return false;
    if (!isLobbyFull(room)) return false;
    if (!allHumansReady(room)) return false;

    const { startMatch } = await import("./roomManager.js");
    const mode = room.meta?.mode || "casual";
    await clearFromQueue(roomId, mode);
    await startMatch(roomId, hostUid);
    logger.info("[Matchmaking] Auto-started", roomId);
    return true;
}
