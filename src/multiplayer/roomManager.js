/**
 * Room Manager v3 — join via update players path (lebih andal vs full-room transaction)
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
                drawStacking: true,
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
        try {
            await deleteRoomCode(roomCode);
        } catch (_) {}
        logger.error("[Room] create set failed:", err.code, err.message);
        throw new Error("Gagal menyimpan room: " + (err.message || err.code));
    }

    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);
    logger.info("[Room] Created:", roomId, "code:", roomCode);
    return { roomId, roomCode };
}

/**
 * Join by code — GET dulu, lalu UPDATE players/{uid}
 * (tidak rewrite seluruh room → lebih sedikit bentrok rules/validate)
 */
export async function joinRoomByCode(user, code) {
    const normalized = String(code).trim().toUpperCase();
    console.warn("[CardClash] JOIN start code=", normalized, "uid=", user.uid);

    const roomId = await resolveRoomCode(normalized);
    if (!roomId) {
        console.warn("[CardClash] JOIN fail: roomCodes not found for", normalized);
        throw new Error("Kode room tidak ditemukan. Cek kode / roomCodes di Console.");
    }
    console.warn("[CardClash] JOIN resolved roomId=", roomId);

    const roomRef = ref(database, `rooms/${roomId}`);
    let snap;
    try {
        snap = await get(roomRef);
    } catch (err) {
        console.warn("[CardClash] JOIN get() error:", err.code, err.message);
        throw new Error(
            "Tidak bisa baca room (PERMISSION?). Rules rooms harus .read: auth != null. " +
                (err.message || "")
        );
    }

    if (!snap.exists()) {
        console.warn(
            "[CardClash] JOIN fail: rooms/" + roomId + " missing (orphaned roomCode)"
        );
        // bersihkan kode yatim
        try {
            await deleteRoomCode(normalized);
        } catch (_) {}
        throw new Error(
            "Room tidak ada di database (kode yatim). Host buat room baru, pakai kode baru."
        );
    }

    const room = snap.val();
    console.warn(
        "[CardClash] JOIN room OK status=",
        room.meta?.status,
        "players=",
        Object.keys(room.players || {}).length
    );

    if (room.meta?.status !== "waiting") {
        throw new Error("Room sudah dimulai atau ditutup.");
    }

    const players = room.players || {};
    const maxPlayers = room.settings?.maxPlayers ?? 4;

    if (players[user.uid]) {
        // sudah anggota → reconnect flag
        await update(ref(database, `rooms/${roomId}/players/${user.uid}`), {
            connected: true
        });
    } else {
        if (Object.keys(players).length >= maxPlayers) {
            throw new Error("Room sudah penuh.");
        }
        try {
            await set(ref(database, `rooms/${roomId}/players/${user.uid}`), {
                uid: user.uid,
                ready: false,
                connected: true,
                joinedAt: Date.now()
            });
        } catch (err) {
            console.warn("[CardClash] JOIN set player error:", err.code, err.message);
            throw new Error(
                "Gagal join (write players ditolak rules?): " + (err.message || err.code)
            );
        }
    }

    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);
    console.warn("[CardClash] JOIN success", roomId);
    logger.info("[Room] Joined:", roomId);

    return {
        roomId,
        roomCode: room.meta?.roomCode || normalized
    };
}

export async function leaveRoom(uid, roomId) {
    const roomRef = ref(database, `rooms/${roomId}`);
    let codeToDelete = null;

    const tx = await runTransaction(roomRef, (room) => {
        if (room === null) return null;

        const players = { ...(room.players || {}) };
        if (!players[uid]) return room;

        delete players[uid];
        const remaining = Object.keys(players);

        if (remaining.length === 0) {
            codeToDelete = room.meta?.roomCode || null;
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

    // Ambil kode dari hasil akhir jika room terhapus
    if (tx.committed && tx.snapshot && !tx.snapshot.exists()) {
        if (codeToDelete) {
            try {
                await deleteRoomCode(codeToDelete);
            } catch (_) {}
            logger.info("[Room] Deleted empty room:", roomId, "code:", codeToDelete);
            return;
        }
    }

    logger.info("[Room] Left:", roomId);
}


/**
 * Host starts match — status waiting → playing + init game shell.
 * Full authoritative deal = Phase 4 Cloud Functions; ini versi client-host bootstrap.
 */
export async function startMatch(roomId, hostUid) {
    const roomRef = ref(database, `rooms/${roomId}`);
    const snap = await get(roomRef);
    if (!snap.exists()) throw new Error("Room tidak ada.");

    const room = snap.val();
    if (room.meta?.hostId !== hostUid) {
        throw new Error("Hanya host yang bisa start.");
    }
    if (room.meta?.status !== "waiting") {
        throw new Error("Room tidak dalam status waiting.");
    }

    const players = room.players || {};
    const ids = Object.keys(players);
    if (ids.length < 2) {
        throw new Error("Minimal 2 pemain untuk start.");
    }

    const notReady = ids.filter((id) => !players[id]?.ready);
    if (notReady.length > 0) {
        throw new Error("Semua pemain harus Ready dulu.");
    }

    await update(ref(database, `rooms/${roomId}/meta`), {
        status: "playing",
        startedAt: Date.now()
    });

    logger.info("[Room] Match started:", roomId, "players:", ids.length);
    return { roomId, playerIds: ids };
}

export async function setReady(roomId, uid, ready) {
    await update(ref(database, `rooms/${roomId}/players/${uid}`), {
        ready: !!ready
    });
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
