/**
 * Subscription / Listener lifecycle manager
 * One active set of listeners per room. Prevents duplicate onValue after
 * UI re-render or Firebase reconnect.
 */
import { logger } from "../utils/logger.js";

class ListenerManager {
    constructor() {
        /** @type {Map<string, Array<() => void>>} */
        this._groups = new Map();
        this._activeRoomId = null;
        this._generation = 0;
    }

    get activeRoomId() {
        return this._activeRoomId;
    }

    get generation() {
        return this._generation;
    }

    /**
     * Register an unsubscribe fn under a group key (usually roomId).
     * @param {string} groupKey
     * @param {() => void} unsub
     */
    add(groupKey, unsub) {
        if (!this._groups.has(groupKey)) this._groups.set(groupKey, []);
        this._groups.get(groupKey).push(unsub);
    }

    /**
     * Unsubscribe everything under groupKey.
     */
    clear(groupKey) {
        const list = this._groups.get(groupKey);
        if (!list) return;
        for (const u of list) {
            try {
                u();
            } catch (e) {
                logger.warn("[ListenerManager] unsub error:", e.message);
            }
        }
        this._groups.delete(groupKey);
        logger.info("[ListenerManager] cleared:", groupKey);
    }

    /**
     * Switch active room — clears previous room listeners first.
     */
    setActiveRoom(roomId) {
        if (this._activeRoomId && this._activeRoomId !== roomId) {
            this.clear(this._activeRoomId);
            this.clear(`match:${this._activeRoomId}`);
        }
        this._activeRoomId = roomId;
        this._generation += 1;
        return this._generation;
    }

    /**
     * Clear all groups (leave multiplayer entirely).
     */
    clearAll() {
        for (const key of [...this._groups.keys()]) {
            this.clear(key);
        }
        this._activeRoomId = null;
        this._generation += 1;
    }

    /**
     * Guard: ignore callbacks from older generation / wrong room.
     */
    isCurrent(roomId, generation) {
        return this._activeRoomId === roomId && this._generation === generation;
    }
}

export const listenerManager = new ListenerManager();
