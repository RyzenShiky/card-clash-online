/**
 * Presence system
 * Menggunakan .info/connected + onDisconnect.
 */
import {
    ref,
    set,
    onValue,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

/**
 * Inisialisasi presence untuk user.
 * @param {string} uid
 * @returns {() => void} cleanup
 */
export function initializePresence(uid) {
    const connectedRef = ref(database, ".info/connected");
    const presenceRef = ref(database, `presence/${uid}`);

    const unsubscribe = onValue(connectedRef, async (snap) => {
        if (snap.val() === true) {
            // Online
            await set(presenceRef, {
                state: "online",
                lastChanged: serverTimestamp()
            });

            // Saat disconnect → set offline
            onDisconnect(presenceRef).set({
                state: "offline",
                lastChanged: serverTimestamp()
            });

            logger.info("[Presence] Online:", uid);
        }
    });

    return () => {
        unsubscribe();
    };
}
