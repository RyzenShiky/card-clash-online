/**
 * Reconnect system — grace period, room membership preserved
 *
 * States for a room player:
 *   connected | reconnecting | disconnected
 *
 * Internet drop ≠ leave room.
 * Only after grace timeout (or explicit Leave) is player removed.
 */
import {
    ref,
    update,
    get,
    onValue,
    off,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_GRACE_MS = 60_000;

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const graceTimers = new Map();

function playerPath(roomId, uid) {
    return `rooms/${roomId}/players/${uid}`;
}

/**
 * Mark player reconnecting in room (do NOT remove from players).
 */
export async function markReconnecting(roomId, uid, graceMs = DEFAULT_GRACE_MS) {
    const until = Date.now() + graceMs;
    try {
        await update(ref(database, playerPath(roomId, uid)), {
            connected: false,
            status: "reconnecting",
            reconnectUntil: until,
            lastHeartbeat: serverTimestamp()
        });
        logger.info(`[Reconnect] ${uid} → reconnecting until ${until}`);
    } catch (e) {
        logger.warn("[Reconnect] markReconnecting failed:", e.message);
    }

    const key = `${roomId}:${uid}`;
    if (graceTimers.has(key)) clearTimeout(graceTimers.get(key));

    const t = setTimeout(async () => {
        graceTimers.delete(key);
        try {
            const snap = await get(ref(database, playerPath(roomId, uid)));
            if (!snap.exists()) return;
            const p = snap.val();
            if (p.status === "reconnecting" && p.reconnectUntil && Date.now() >= p.reconnectUntil) {
                await update(ref(database, playerPath(roomId, uid)), {
                    status: "disconnected",
                    connected: false
                });
                logger.info(`[Reconnect] Grace expired → disconnected ${uid}`);
            }
        } catch (e) {
            logger.warn("[Reconnect] grace timeout check failed:", e.message);
        }
    }, graceMs + 500);

    graceTimers.set(key, t);
}

/**
 * Player back online — restore room membership flags.
 */
export async function markConnected(roomId, uid, sessionId = null) {
    const key = `${roomId}:${uid}`;
    if (graceTimers.has(key)) {
        clearTimeout(graceTimers.get(key));
        graceTimers.delete(key);
    }

    const payload = {
        connected: true,
        status: "active",
        reconnectUntil: null,
        lastHeartbeat: serverTimestamp()
    };
    if (sessionId) payload.sessionId = sessionId;

    try {
        await update(ref(database, playerPath(roomId, uid)), payload);
        logger.info(`[Reconnect] ${uid} restored active in ${roomId}`);
    } catch (e) {
        logger.warn("[Reconnect] markConnected failed:", e.message);
    }
}

/**
 * Heartbeat while in room (optional, for lastSeen).
 */
export async function heartbeat(roomId, uid) {
    try {
        await update(ref(database, playerPath(roomId, uid)), {
            lastHeartbeat: serverTimestamp()
        });
    } catch (_) {}
}

/**
 * Subscribe connection state of a room player for UI ("Reconnecting...").
 */
export function subscribePlayerConnection(roomId, uid, callback) {
    const r = ref(database, playerPath(roomId, uid));
    onValue(r, (snap) => {
        callback(snap.exists() ? snap.val() : null);
    });
    return () => off(r);
}

/**
 * Legacy stubs kept for API compatibility.
 */
export function handleDisconnect(uid, roomId, options = {}) {
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    logger.info(`[Reconnect] handleDisconnect ${uid} @ ${roomId} grace=${graceMs}`);
    return markReconnecting(roomId, uid, graceMs);
}

export async function handleReconnect(uid, roomId, sessionId = null) {
    logger.info(`[Reconnect] handleReconnect ${uid} @ ${roomId}`);
    await markConnected(roomId, uid, sessionId);
}
