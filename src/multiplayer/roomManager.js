/**
 * Room Manager
 * Create / Join / Leave / Ready / Subscribe
 *
 * Join & leave memakai runTransaction agar anti race (tidak overflow maxPlayers).
 * Catatan production: idealnya create/join/leave dipindah ke Cloud Functions
 * + Security Rules ketat agar client tidak punya kekuasaan penuh atas room.
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
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { createRoomCode, resolveRoomCode, deleteRoomCode } from "./roomCode.js";
import { logger } from "../utils/logger.js";

/**
 * Buat room baru.
 * @param {import("firebase/auth").User} user
 * @param {object} settings
 * @returns {Promise<{ roomId: string, roomCode: string }>}
 */
export async function createRoom(user, settings = {}) {
    const roomsRef = ref(database, "rooms");
    const newRoomRef = push(roomsRef);
    const roomId = newRoomRef.key;

    // Kode direservasi atomik dulu
    const roomCode = await createRoomCode(roomId);

    const room = {
        meta: {
            hostId: user.uid,
            roomCode,
            status: "waiting",
            createdAt: serverTimestamp()
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
                joinedAt: Date.now()
            }
        }
    };

    await set(newRoomRef, room);
    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);

    logger.info("[Room] Created:", roomId, "code:", roomCode);
    return { roomId, roomCode };
}

/**
 * Join room via room code — ATOMIC (transaction).
 * Mencegah dua pemain masuk bersamaan melebihi maxPlayers.
 *
 * @param {import("firebase/auth").User} user
 * @param {string} code
 * @returns {Promise<{ roomId: string, roomCode: string }>}
 */
export async function joinRoomByCode(user, code) {
    const roomId = await resolveRoomCode(code);
    if (!roomId) {
        throw new Error("Kode room tidak ditemukan.");
    }

    const roomRef = ref(database, `rooms/${roomId}`);

    let outcome = "ok"; // ok | not_found | not_waiting | full | error

    let tx;
    try {
        tx = await runTransaction(roomRef, (room) => {
            if (room === null) {
                outcome = "not_found";
                return; // abort
            }

            const status = room.meta?.status;
            if (status !== "waiting") {
                outcome = "not_waiting";
                return;
            }

            const players = room.players || {};
            const maxPlayers = room.settings?.maxPlayers ?? 4;
            const playerCount = Object.keys(players).length;

            // Sudah anggota → cukup set connected (reconnect ke lobby)
            if (players[user.uid]) {
                players[user.uid] = {
                    ...players[user.uid],
                    connected: true
                };
                room.players = players;
                outcome = "ok";
                return room;
            }

            if (playerCount >= maxPlayers) {
                outcome = "full";
                return; // abort — room penuh
            }

            // Tambah pemain baru
            players[user.uid] = {
                uid: user.uid,
                ready: false,
                connected: true,
                joinedAt: Date.now()
            };
            room.players = players;
            outcome = "ok";
            return room;
        });
    } catch (err) {
        const code = err?.code || "";
        if (code === "PERMISSION_DENIED" || /permission/i.test(err?.message || "")) {
            throw new Error(
                "Akses room ditolak (Security Rules). Pastikan rules mengizinkan read room berstatus waiting."
            );
        }
        throw err;
    }

    if (!tx.committed) {
        if (outcome === "not_found") {
            throw new Error(
                "Room sudah tidak ada. (Atau rules memblokir read — publish rules terbaru.)"
            );
        }
        if (outcome === "not_waiting") throw new Error("Room sudah dimulai atau ditutup.");
        if (outcome === "full") throw new Error("Room sudah penuh.");
        throw new Error("Gagal bergabung ke room. Coba lagi.");
    }

    await set(ref(database, `playerRooms/${user.uid}/${roomId}`), true);

    const roomCode =
        tx.snapshot.val()?.meta?.roomCode || String(code).trim().toUpperCase();

    logger.info("[Room] Joined (atomic):", roomId);
    return { roomId, roomCode };
}

/**
 * Leave room — transaction untuk host migration & cleanup aman.
 * @param {string} uid
 * @param {string} roomId
 */
export async function leaveRoom(uid, roomId) {
    const roomRef = ref(database, `rooms/${roomId}`);
    let deletedCode = null;
    let roomDeleted = false;

    const tx = await runTransaction(roomRef, (room) => {
        if (room === null) return null;

        const players = { ...(room.players || {}) };
        if (!players[uid]) {
            // Bukan anggota — biarkan apa adanya
            return room;
        }

        delete players[uid];

        const remaining = Object.keys(players);

        if (remaining.length === 0) {
            // Room kosong → hapus
            deletedCode = room.meta?.roomCode || null;
            roomDeleted = true;
            return null;
        }

        room.players = players;

        // Host migration
        if (room.meta?.hostId === uid) {
            room.meta = {
                ...room.meta,
                hostId: remaining[0]
            };
            logger.info("[Room] Host will migrate to:", remaining[0]);
        }

        return room;
    });

    // Cleanup mapping player
    try {
        await remove(ref(database, `playerRooms/${uid}/${roomId}`));
    } catch (_) {}

    if (roomDeleted && deletedCode) {
        try {
            await deleteRoomCode(deletedCode);
        } catch (_) {}
        logger.info("[Room] Deleted empty room:", roomId);
    } else if (tx.committed) {
        logger.info("[Room] Left:", roomId);
    }
}

/**
 * Set ready — transaction kecil agar konsisten dengan state terbaru.
 * @param {string} roomId
 * @param {string} uid
 * @param {boolean} ready
 */
export async function setReady(roomId, uid, ready) {
    const playerRef = ref(database, `rooms/${roomId}/players/${uid}`);

    const tx = await runTransaction(playerRef, (player) => {
        if (player === null) return; // bukan anggota
        return {
            ...player,
            ready: !!ready
        };
    });

    if (!tx.committed) {
        throw new Error("Gagal update ready (bukan anggota room?).");
    }
}

/**
 * Subscribe room changes.
 * @param {string} roomId
 * @param {(data: object|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeRoom(roomId, callback) {
    const roomRef = ref(database, `rooms/${roomId}`);
    onValue(roomRef, (snap) => {
        callback(snap.exists() ? snap.val() : null);
    });
    return () => off(roomRef);
}

/**
 * Ambil data room sekali.
 * @param {string} roomId
 */
export async function getRoom(roomId) {
    const snap = await get(ref(database, `rooms/${roomId}`));
    return snap.exists() ? snap.val() : null;
}
