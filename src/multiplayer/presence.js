/**
 * Presence system (hardened)
 * - /.info/connected
 * - onDisconnect re-armed on every reconnect
 * - sessionId so stale callbacks cannot overwrite newer connection
 * - Does NOT remove player from rooms — presence is online/offline only
 */
import {
    ref,
    set,
    onValue,
    off,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

function newSessionId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} uid
 * @param {{ onOnline?: (sessionId: string) => void, onOffline?: () => void }} [hooks]
 * @returns {() => void} cleanup
 */
export function initializePresence(uid, hooks = {}) {
    const connectedRef = ref(database, ".info/connected");
    const presenceRef = ref(database, `presence/${uid}`);
    let activeSessionId = null;
    let disposed = false;

    const unsubscribe = onValue(connectedRef, async (snap) => {
        if (disposed) return;

        if (snap.val() === true) {
            activeSessionId = newSessionId();
            const sessionId = activeSessionId;

            try {
                // Arm onDisconnect BEFORE writing online (Firebase best practice)
                await onDisconnect(presenceRef).set({
                    state: "offline",
                    sessionId,
                    lastChanged: serverTimestamp()
                });

                await set(presenceRef, {
                    state: "online",
                    sessionId,
                    lastChanged: serverTimestamp()
                });

                logger.info("[Presence] Online:", uid, "session:", sessionId);
                hooks.onOnline?.(sessionId);
            } catch (e) {
                logger.warn("[Presence] set online failed:", e.message);
            }
        } else {
            logger.info("[Presence] Connection lost (client-side signal)");
            hooks.onOffline?.();
        }
    });

    return () => {
        disposed = true;
        try {
            unsubscribe();
        } catch (_) {}
        // Best-effort offline mark; onDisconnect still fires if tab closes
        if (activeSessionId) {
            set(presenceRef, {
                state: "offline",
                sessionId: activeSessionId,
                lastChanged: serverTimestamp()
            }).catch(() => {});
        }
    };
}

/**
 * Read presence of any uid (for UI indicators).
 */
export function subscribePresence(uid, callback) {
    const presenceRef = ref(database, `presence/${uid}`);
    const unsub = onValue(presenceRef, (snap) => {
        callback(snap.exists() ? snap.val() : { state: "offline" });
    });
    return () => {
        try {
            unsub();
        } catch (_) {}
    };
}

/**
 * Real-time global online player count (bukan angka dummy)
 * Menghitung presence/{uid}.state === 'online'
 */
export function subscribeOnlineCount(callback) {
    const presenceRoot = ref(database, "presence");
    const handler = (snap) => {
        let n = 0;
        if (snap.exists()) {
            snap.forEach((child) => {
                const v = child.val();
                if (v && v.state === "online") n += 1;
            });
        }
        try {
            callback(n);
        } catch (_) {}
    };
    onValue(presenceRoot, handler);
    return () => {
        try {
            off(presenceRoot, "value", handler);
        } catch (_) {}
    };
}
