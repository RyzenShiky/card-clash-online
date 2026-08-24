/**
 * ProfileStore — single source of truth untuk username/avatar
 * Source: players/{uid}/public (+ ranked/stats di-cache)
 * Semua UI subscribe di sini.
 */
import {
    ref,
    onValue,
    off,
    update,
    serverTimestamp,
    get
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { database, auth } from "../firebase/services.js";
import { logger } from "../utils/logger.js";
import { indexUsername } from "../multiplayer/friends.js";

/** @type {Map<string, object>} */
const cache = new Map();
/** @type {Map<string, Set<Function>>} */
const listeners = new Map();
/** @type {Map<string, Function>} */
const firebaseUnsubs = new Map();

function notify(uid) {
    const data = cache.get(uid);
    const set = listeners.get(uid);
    if (!set) return;
    for (const cb of set) {
        try {
            cb(data);
        } catch (e) {
            logger.warn("[ProfileStore] listener error", e.message);
        }
    }
}

/**
 * Subscribe ke profil (realtime). Auto-start onValue.
 * @returns {() => void} unsubscribe
 */
export function subscribeProfile(uid, callback) {
    if (!uid) return () => {};
    if (!listeners.has(uid)) listeners.set(uid, new Set());
    listeners.get(uid).add(callback);

    if (cache.has(uid)) {
        try {
            callback(cache.get(uid));
        } catch (_) {}
    }

    if (!firebaseUnsubs.has(uid)) {
        const r = ref(database, `players/${uid}`);
        const handler = (snap) => {
            const val = snap.exists() ? snap.val() : null;
            cache.set(uid, val);
            notify(uid);
        };
        onValue(r, handler);
        firebaseUnsubs.set(uid, () => off(r, "value", handler));
    }

    return () => {
        const set = listeners.get(uid);
        if (set) {
            set.delete(callback);
            if (set.size === 0) {
                listeners.delete(uid);
                const unsub = firebaseUnsubs.get(uid);
                if (unsub) {
                    unsub();
                    firebaseUnsubs.delete(uid);
                }
            }
        }
    };
}

export function getCachedProfile(uid) {
    return cache.get(uid) || null;
}

export function getDisplayName(uid, fallback = "Player") {
    const p = cache.get(uid);
    return (
        p?.public?.displayName ||
        fallback ||
        String(uid || "").slice(0, 8) ||
        "Player"
    );
}

export function getAvatarId(uid) {
    return cache.get(uid)?.public?.avatarId || "default";
}

/**
 * Simpan profil + fan-out ke room aktif (jika ada)
 * Atomic-ish multi-path update
 */
export async function savePlayerProfile(uid, { displayName, avatarId, settings }, roomId = null) {
    const name = String(displayName || "").trim().slice(0, 24);
    if (name.length < 3) throw new Error("Username minimal 3 karakter");

    const versionSnap = await get(ref(database, `players/${uid}/public/profileVersion`));
    const nextVer = (versionSnap.exists() ? Number(versionSnap.val()) || 0 : 0) + 1;

    const updates = {};
    updates[`players/${uid}/public/displayName`] = name;
    updates[`players/${uid}/public/avatarId`] = avatarId || "default";
    updates[`players/${uid}/public/profileVersion`] = nextVer;
    updates[`players/${uid}/public/updatedAt`] = serverTimestamp();
    updates[`players/${uid}/public/lastSeen`] = serverTimestamp();

    if (settings) {
        if (settings.sound != null) updates[`players/${uid}/private/settings/sound`] = !!settings.sound;
        if (settings.music != null) updates[`players/${uid}/private/settings/music`] = !!settings.music;
        if (settings.language) updates[`players/${uid}/private/settings/language`] = settings.language;
    }

    // Fan-out ke room snapshot agar in-game/lobby room list ikut berubah
    if (roomId) {
        updates[`rooms/${roomId}/players/${uid}/displayName`] = name;
        updates[`rooms/${roomId}/players/${uid}/avatarId`] = avatarId || "default";
        updates[`rooms/${roomId}/players/${uid}/profileVersion`] = nextVer;
    }

    await update(ref(database), updates);

    // Sync Auth displayName (best-effort, bukan source of truth)
    try {
        if (auth.currentUser && auth.currentUser.uid === uid) {
            await updateAuthProfile(auth.currentUser, { displayName: name });
        }
    } catch (e) {
        logger.warn("[ProfileStore] Auth updateProfile failed:", e.message);
    }

    try {
        await indexUsername(uid, name);
    } catch (e) {
        logger.warn("[ProfileStore] username index:", e.message);
    }
    logger.info("[ProfileStore] saved version", nextVer, name);
    return nextVer;
}

/**
 * Resolve banyak UID (sekali) untuk lobby
 */
export async function hydrateProfiles(uids) {
    const list = [...new Set((uids || []).filter(Boolean))];
    await Promise.all(
        list.map(
            (uid) =>
                new Promise((resolve) => {
                    const unsub = subscribeProfile(uid, () => {
                        unsub();
                        resolve();
                    });
                    // timeout safety
                    setTimeout(() => {
                        unsub();
                        resolve();
                    }, 3000);
                })
        )
    );
}

export function destroyAllProfileSubscriptions() {
    for (const unsub of firebaseUnsubs.values()) {
        try {
            unsub();
        } catch (_) {}
    }
    firebaseUnsubs.clear();
    listeners.clear();
    cache.clear();
}

export async function ensureProfilesLoaded(uids = []) {
    const list = (uids || []).filter(Boolean);
    await Promise.all(
        list.map(
            (uid) =>
                new Promise((resolve) => {
                    const unsub = subscribeProfile(uid, () => {
                        unsub();
                        resolve();
                    });
                    setTimeout(() => {
                        unsub();
                        resolve();
                    }, 2500);
                })
        )
    );
}
