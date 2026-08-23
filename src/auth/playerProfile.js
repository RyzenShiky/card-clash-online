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
        // Jangan overwrite displayName/avatar yang sudah diedit user
        logger.info("[Profile] Existing profile — update lastSeen only");
        const existingPub = snapshot.val()?.public || {};
        const patch = {
            accountType,
            lastSeen: serverTimestamp()
        };
        // Hanya isi displayName jika masih kosong di DB
        if (!existingPub.displayName && displayName) {
            patch.displayName = displayName;
        }
        if (!existingPub.photoURL && photoURL) {
            patch.photoURL = photoURL;
        }
        await update(ref(database, `players/${user.uid}/public`), patch);
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
 * Merge data guest ke akun Google yang sudah ada (UID berbeda).
 * Ranked/stats/awards: ambil yang lebih baik / jumlahkan dengan aman.
 * Tidak menghapus guest node (bisa di-GC manual) agar rollback aman.
 */
export async function mergeGuestDataIntoGoogleUid(guestUid, googleUid) {
    if (!guestUid || !googleUid || guestUid === googleUid) return;

    const guestSnap = await get(ref(database, `players/${guestUid}`));
    const googleSnap = await get(ref(database, `players/${googleUid}`));
    const guest = guestSnap.exists() ? guestSnap.val() : {};
    const google = googleSnap.exists() ? googleSnap.val() : {};

    const gStats = guest.stats || {};
    const oStats = google.stats || {};
    const mergedStats = {
        matchesPlayed: (oStats.matchesPlayed || 0) + (gStats.matchesPlayed || 0),
        wins: (oStats.wins || 0) + (gStats.wins || 0),
        losses: (oStats.losses || 0) + (gStats.losses || 0),
        winStreak: Math.max(oStats.winStreak || 0, gStats.winStreak || 0),
        bestWinStreak: Math.max(oStats.bestWinStreak || 0, gStats.bestWinStreak || 0),
        cardsPlayed: (oStats.cardsPlayed || 0) + (gStats.cardsPlayed || 0),
        fastestWinMs:
            [oStats.fastestWinMs, gStats.fastestWinMs].filter((x) => x != null).length
                ? Math.min(
                      ...[oStats.fastestWinMs, gStats.fastestWinMs].filter((x) => x != null)
                  )
                : null
    };

    const gRank = guest.ranked || {};
    const oRank = google.ranked || {};
    const bestMmr = Math.max(oRank.mmr || 1000, gRank.mmr || 1000);
    const mergedRanked = {
        ...oRank,
        ...gRank,
        mmr: bestMmr,
        rankedWins: (oRank.rankedWins || 0) + (gRank.rankedWins || 0),
        rankedLosses: (oRank.rankedLosses || 0) + (gRank.rankedLosses || 0),
        tier: oRank.tier || gRank.tier,
        recent: [...(oRank.recent || []), ...(gRank.recent || [])].slice(-10)
    };
    // tier dari mmr terbaik
    try {
        const { tierFromMmr } = await import("../multiplayer/ranked.js");
        mergedRanked.tier = tierFromMmr(bestMmr).id;
    } catch (_) {}

    const pub = {
        ...(google.public || {}),
        accountType: "google",
        lastSeen: serverTimestamp(),
        mergedFromGuest: guestUid,
        // Pertahankan displayName custom guest jika Google kosong
        displayName:
            (google.public || {}).displayName ||
            (guest.public || {}).displayName ||
            "Player",
        photoURL: (google.public || {}).photoURL || (guest.public || {}).photoURL || null
    };

    await update(ref(database, `players/${googleUid}`), {
        public: pub,
        stats: mergedStats,
        ranked: mergedRanked,
        private: {
            ...(google.private || {}),
            ...(guest.private || {}),
            mergedAt: serverTimestamp(),
            previousGuestUid: guestUid
        }
    });

    // Tandai guest sudah dimigrasi
    await update(ref(database, `players/${guestUid}/private`), {
        migratedTo: googleUid,
        migratedAt: serverTimestamp()
    }).catch(() => {});

    logger.info("[Profile] Merged guest", guestUid, "→", googleUid, "mmr", bestMmr);
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
