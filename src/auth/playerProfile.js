/**
 * Player Profile
 * Struktur:
 * players/UID/
 *   public/   → displayName, photoURL, accountType, createdAt
 *   stats/    → matchesPlayed, wins, ...
 *   private/  → settings, metadata internal
 */
import {
    ref,
    get,
    set,
    update,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

/**
 * Buat atau restore profil setelah login.
 * @param {import("firebase/auth").User} user
 */
export async function createPlayerProfile(user) {
    const playerRef = ref(database, `players/${user.uid}`);
    const snapshot = await get(playerRef);

    const isAnonymous = user.isAnonymous === true;
    const displayName =
        user.displayName ||
        (isAnonymous ? `Guest_${user.uid.slice(0, 6)}` : "Player");
    const photoURL = user.photoURL || null;
    const accountType = isAnonymous ? "guest" : "google";

    if (snapshot.exists()) {
        logger.info("[Profile] Existing profile — update lastSeen / public fields");
        await update(ref(database, `players/${user.uid}/public`), {
            displayName,
            photoURL,
            accountType,
            lastSeen: serverTimestamp()
        });
        return snapshot.val();
    }

    const profile = {
        public: {
            displayName,
            photoURL,
            accountType,
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp()
        },
        stats: {
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            winStreak: 0,
            bestWinStreak: 0,
            cardsPlayed: 0,
            fastestWinMs: null
        },
        private: {
            settings: {
                sound: true,
                music: true,
                language: "id"
            }
        }
    };

    await set(playerRef, profile);
    logger.info("[Profile] New profile created:", accountType);
    return profile;
}

/**
 * Dipanggil setelah link Anonymous → Google.
 * UID tetap sama, hanya update public fields.
 * @param {import("firebase/auth").User} user
 */
export async function updateAccountTypeAfterLink(user) {
    await update(ref(database, `players/${user.uid}/public`), {
        displayName: user.displayName || `Player_${user.uid.slice(0, 6)}`,
        photoURL: user.photoURL || null,
        accountType: "google",
        lastSeen: serverTimestamp(),
        linkedAt: serverTimestamp()
    });
    logger.info("[Profile] Account upgraded to Google");
}

/**
 * Update lastSeen.
 * @param {string} uid
 */
export async function updateLastSeen(uid) {
    await update(ref(database, `players/${uid}/public`), {
        lastSeen: serverTimestamp()
    });
}

/**
 * Ambil profil lengkap (hanya untuk owner / server).
 * @param {string} uid
 */
export async function getPlayerProfile(uid) {
    const snapshot = await get(ref(database, `players/${uid}`));
    return snapshot.exists() ? snapshot.val() : null;
}

/**
 * Ambil hanya public profile (aman untuk ditampilkan ke lawan).
 * @param {string} uid
 */
export async function getPublicProfile(uid) {
    const snapshot = await get(ref(database, `players/${uid}/public`));
    return snapshot.exists() ? snapshot.val() : null;
}
