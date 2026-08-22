/**
 * Room Manager
 * Create / Join / Leave / Ready / Subscribe
 */
import {
    ref,
    set,
    push,
    get,
    update,
    remove,
    onValue,
    off,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { createRoomCode, resolveRoomCode, deleteRoomCode } from "./roomCode.js";
import { logger } from "../utils/logger.js";

/**
 * Buat room baru.
 */
export async function createRoom(user, settings = {}) {
    const roomsRef = ref(database, "rooms");
    const newRoomRef = push(roomsRef);
    const roomId = newRoomRef.key;

    const roomCode = await createRoomCode(roomId);
    const now = Date.now();

    const room = {
        meta: {
            hostId: user.uid,
            roomCode,
            status: "waiting",
            createdAt: now
        },
        settings: {
            maxPlayers: settings.maxPlayers ?? 4,
            isPrivate: settings.isPrivate ?? true,
            turnTimer: settings.turnTimer ?? 30,
            targetScore: settings.targetScore ?? 500,
            allowSpectators: settings.allowSpectators ?? false,
            allowReconnect: settings.allowReconnect ?? true,
            botFill: settings.botFill ?? false,
            customRules: settings.customRules ?? {
                drawStacking: false,
                sevenSwap: false,
                zeroRotation: false,
                forcePlay: false,
                challengeDraw: true,
                callLastCard: true
            }
        },
        players: {
            [user.uid]: {
                uid: user.uid,
                ready: false,
                connected: true,
                joinedAt: now
            }
        }
    };

    try {
        await set(newRoomRef, room);
    } catch (err) {
        // Rollback room code jika write room gagal
        try {
            await deleteRoomCode(roomCode);
        } catch (_) {}
        logger.error("[Room] Create set() failed:", err.code, err.message);
        throw new Error(
            "Gagal menyimpan room. Cek Security Rules (rooms write). " +
                (err.message || "")
        );
    }

    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);

    logger.info("[Room] Created:", roomId, "code:", roomCode);
    return { roomId, roomCode };
}

/**
 * Join room via room code.
 * 1) resolve code → roomId
 * 2) get room (diagnostik permission)
 * 3) transaction atomic add player
 */
export async function joinRoomByCode(user, code) {
    const normalized = String(code).trim().toUpperCase();
    logger.info("[Room] Join attempt code:", normalized);

    const roomId = await resolveRoomCode(normalized);
    if (!roomId) {
        throw new Error("Kode room tidak ditemukan.");
    }

    logger.info("[Room] Resolved roomId:", roomId);
    const roomRef = ref(database, `rooms/${roomId}`);

    // Diagnostik: coba baca dulu
    let existing = null;
    try {
        const snap = await get(roomRef);
        if (!snap.exists()) {
            logger.error(
                "[Room] roomCodes ada tapi rooms/" +
                    roomId +
                    " tidak ada. Room create mungkin gagal / terhapus."
            );
            throw new Error(
                "Room sudah tidak ada di database. Host harus buat room baru."
            );
        }
        existing = snap.val();
        logger.info(
            "[Room] Read OK. status=",
            existing?.meta?.status,
            "players=",
            Object.keys(existing?.players || {}).length
        );
    } catch (err) {
        if (err.message?.includes("sudah tidak ada")) throw err;
        const msg = err?.message || String(err);
        if (/permission|PERMISSION/i.test(msg) || err?.code === "PERMISSION_DENIED") {
            throw new Error(
                "Rules memblokir baca room. Publish rules terbaru (status waiting boleh di-read)."
            );
        }
        throw err;
    }

    if (existing?.meta?.status !== "waiting") {
        throw new Error("Room sudah dimulai atau ditutup.");
    }

    const maxPlayers = existing?.settings?.maxPlayers ?? 4;
    const players = existing?.players || {};
    if (!players[user.uid] && Object.keys(players).length >= maxPlayers) {
        throw new Error("Room sudah penuh.");
    }

    // Atomic join
    let outcome = "ok";
    let tx;
    try {
        tx = await runTransaction(roomRef, (room) => {
            if (room === null) {
                outcome = "not_found";
                return;
            }
            if (room.meta?.status !== "waiting") {
                outcome = "not_waiting";
                return;
            }

            const plist = room.players || {};
            const max = room.settings?.maxPlayers ?? 4;

            if (plist[user.uid]) {
                plist[user.uid] = { ...plist[user.uid], connected: true };
                room.players = plist;
                return room;
            }

            if (Object.keys(plist).length >= max) {
                outcome = "full";
                return;
            }

            plist[user.uid] = {
                uid: user.uid,
                ready: false,
                connected: true,
                joinedAt: Date.now()
            };
            room.players = plist;
            return room;
        });
    } catch (err) {
        logger.error("[Room] Transaction error:", err.code, err.message);
        if (/permission|PERMISSION/i.test(err?.message || "") || err?.code === "PERMISSION_DENIED") {
            throw new Error(
                "Rules memblokir write join. Pastikan rooms write mengizinkan status waiting."
            );
        }
        throw err;
    }

    if (!tx.committed) {
        if (outcome === "not_found") {
            throw new Error("Room sudah tidak ada.");
        }
        if (outcome === "not_waiting") {
            throw new Error("Room sudah dimulai atau ditutup.");
        }
        if (outcome === "full") {
            throw new Error("Room sudah penuh.");
        }
        throw new Error("Gagal bergabung ke room. Coba lagi.");
    }

    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);

    const roomCode = tx.snapshot.val()?.meta?.roomCode || normalized;
    logger.info("[Room] Joined OK:", roomId);
    return { roomId, roomCode };
}

/**
 * Leave room
 */
export async function leaveRoom(uid, roomId) {
    const roomRef = ref(database, `rooms/${roomId}`);
    let deletedCode = null;
    let roomDeleted = false;

    await runTransaction(roomRef, (room) => {
        if (room === null) return null;

        const players = { ...(room.players || {}) };
        if (!players[uid]) return room;

        delete players[uid];
        const remaining = Object.keys(players);

        if (remaining.length === 0) {
            deletedCode = room.meta?.roomCode || null;
            roomDeleted = true;
            return null;
        }

        room.players = players;
        if (room.meta?.hostId === uid) {
            room.meta = { ...room.meta, hostId: remaining[0] };
        }
        return room;
    });

    try {
        await remove(ref(database, `playerRooms/${uid}/${roomId}`));
    } catch (_) {}

    if (roomDeleted && deletedCode) {
        try {
            await deleteRoomCode(deletedCode);
        } catch (_) {}
        logger.info("[Room] Deleted empty room:", roomId);
    } else {
        logger.info("[Room] Left:", roomId);
    }
}

/**
 * Set ready
 */
export async function setReady(roomId, uid, ready) {
    const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);
    const tx = await runTransaction(playerRef, (player) => {
        if (player === null) return;
        return { ...player, ready: !!ready };
    });
    if (!tx.committed) {
        throw new Error("Gagal update ready (bukan anggota room?).");
    }
}

export function subscribeRoom(roomId, callback) {
    const roomRef = ref(database, `rooms/${roomId}`);
    onValue(roomRef, (snap) => {
        callback(snap.exists() ? snap.val() : null);
    });
    return () => off(roomRef);
}

export async function getRoom(roomId) {
    const snap = await get(ref(database, `rooms/${roomId}`));
    return snap.exists() ? snap.val() : null;
}
