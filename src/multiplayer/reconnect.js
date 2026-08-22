/**
 * Reconnect handling (stub)
 * Grace period, state restore, AI takeover, dll.
 */
import { logger } from "../utils/logger.js";

const DEFAULT_GRACE_MS = 60_000;

/**
 * Catat disconnect dan mulai grace period.
 * Implementasi penuh membutuhkan Cloud Functions / server authoritative.
 */
export function handleDisconnect(uid, roomId, options = {}) {
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    logger.info(`[Reconnect] Player ${uid} disconnected from ${roomId}. Grace: ${graceMs}ms`);
    // TODO: set status DISCONNECTED, timer, AI takeover jika timeout
}

/**
 * Player reconnect — verifikasi token & kirim state terbaru.
 */
export async function handleReconnect(uid, roomId) {
    logger.info(`[Reconnect] Player ${uid} reconnecting to ${roomId}`);
    // TODO: validate, restore private state, clear disconnect flag
}
