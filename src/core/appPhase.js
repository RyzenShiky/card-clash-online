/**
 * Single app phase state machine
 * Prevents: game ended but play still active, double matchmaking, etc.
 */
import { logger } from "../utils/logger.js";

/** @typedef {'BOOT'|'AUTHENTICATING'|'HOME'|'MATCHMAKING'|'ROOM_LOBBY'|'LOADING_MATCH'|'PLAYING'|'ROUND_RESULT'|'MATCH_RESULT'|'RECONNECTING'|'ERROR'} AppPhase */

const TRANSITIONS = {
    BOOT: ["AUTHENTICATING", "HOME", "ERROR"],
    AUTHENTICATING: ["HOME", "ERROR"],
    HOME: ["MATCHMAKING", "ROOM_LOBBY", "AUTHENTICATING"],
    MATCHMAKING: ["ROOM_LOBBY", "HOME", "ERROR", "RECONNECTING"],
    ROOM_LOBBY: ["LOADING_MATCH", "HOME", "MATCHMAKING", "RECONNECTING", "ERROR"],
    LOADING_MATCH: ["PLAYING", "ROOM_LOBBY", "HOME", "ERROR", "RECONNECTING"],
    PLAYING: ["ROUND_RESULT", "MATCH_RESULT", "RECONNECTING", "HOME", "ERROR"],
    ROUND_RESULT: ["PLAYING", "MATCH_RESULT", "HOME"],
    MATCH_RESULT: ["HOME", "ROOM_LOBBY", "MATCHMAKING"],
    RECONNECTING: ["PLAYING", "ROOM_LOBBY", "HOME", "ERROR", "MATCHMAKING"],
    ERROR: ["HOME", "BOOT", "RECONNECTING"]
};

/** @type {AppPhase} */
let phase = "BOOT";
/** @type {Set<Function>} */
const listeners = new Set();

export function getPhase() {
    return phase;
}

export function onPhaseChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/**
 * @param {AppPhase} next
 * @param {object} [meta]
 */
export function setPhase(next, meta = {}) {
    if (next === phase) return false;
    const allowed = TRANSITIONS[phase] || [];
    if (!allowed.includes(next)) {
        logger.warn(`[Phase] blocked ${phase} → ${next}`, meta);
        return false;
    }
    const prev = phase;
    phase = next;
    logger.info(`[Phase] ${prev} → ${next}`, meta);
    for (const cb of listeners) {
        try {
            cb(next, prev, meta);
        } catch (_) {}
    }
    return true;
}

/** Force phase (recovery only) */
export function forcePhase(next, meta = {}) {
    const prev = phase;
    phase = next;
    logger.warn(`[Phase] FORCE ${prev} → ${next}`, meta);
    for (const cb of listeners) {
        try {
            cb(next, prev, meta);
        } catch (_) {}
    }
}

export function canPlayActions() {
    return phase === "PLAYING";
}

export function isInMatch() {
    return ["LOADING_MATCH", "PLAYING", "ROUND_RESULT", "RECONNECTING"].includes(
        phase
    );
}
