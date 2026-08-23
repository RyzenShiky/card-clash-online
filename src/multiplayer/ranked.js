/**
 * Card-Elo ranked system
 * Warrior → Athletic → Professional → Gold → Platinum → Master → GrandMaster → Legend
 *
 * Elo disesuaikan:
 * - skill rating (MMR)
 * - form 5 match terakhir (win streak / recent)
 * - jumlah pemain di meja (4 vs 6)
 * - bot mendapat MMR sedikit di atas rata-rata manusia agar kompetitif
 */
import {
    ref,
    get,
    update,
    set,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

export const RANK_TIERS = [
    { id: "warrior", name: "Warrior", minMmr: 0, maxMmr: 799 },
    { id: "athletic", name: "Athletic", minMmr: 800, maxMmr: 999 },
    { id: "professional", name: "Professional", minMmr: 1000, maxMmr: 1199 },
    { id: "gold", name: "Gold", minMmr: 1200, maxMmr: 1399 },
    { id: "platinum", name: "Platinum", minMmr: 1400, maxMmr: 1599 },
    { id: "master", name: "Master", minMmr: 1600, maxMmr: 1799 },
    { id: "grandmaster", name: "GrandMaster", minMmr: 1800, maxMmr: 1999 },
    { id: "legend", name: "Legend", minMmr: 2000, maxMmr: 99999 }
];

export const DEFAULT_MMR = 1000;
/** Ranked penuh = 6 kursi */
export const RANKED_MAX_PLAYERS = 6;

export function tierFromMmr(mmr) {
    const m = Math.max(0, Number(mmr) || 0);
    for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
        if (m >= RANK_TIERS[i].minMmr) return RANK_TIERS[i];
    }
    return RANK_TIERS[0];
}

export function rankLabel(mmr) {
    const t = tierFromMmr(mmr);
    return `${t.name} (${Math.round(mmr)})`;
}

export async function ensureRankedProfile(uid) {
    const r = ref(database, `players/${uid}/ranked`);
    const snap = await get(r);
    if (snap.exists()) return snap.val();
    const data = {
        mmr: DEFAULT_MMR,
        tier: tierFromMmr(DEFAULT_MMR).id,
        rankedWins: 0,
        rankedLosses: 0,
        rankedMatches: 0,
        recent: [], // 1 win / 0 loss, max 10
        season: 1,
        updatedAt: serverTimestamp()
    };
    await set(r, data);
    return data;
}

export async function getRankedProfile(uid) {
    const snap = await get(ref(database, `players/${uid}/ranked`));
    if (!snap.exists()) return ensureRankedProfile(uid);
    return snap.val();
}

/**
 * Effective rating = MMR + form bonus dari 5 match terakhir.
 */
export function effectiveRating(profile) {
    const mmr = profile?.mmr ?? DEFAULT_MMR;
    const recent = Array.isArray(profile?.recent) ? profile.recent.slice(-5) : [];
    if (!recent.length) return mmr;
    const wins = recent.filter((x) => x === 1).length;
    const form = (wins / recent.length - 0.5) * 80; // ±40
    return mmr + form;
}

/**
 * K-factor: lebih tinggi di rank rendah, lebih rendah di Legend.
 * Meja 6 → K sedikit lebih kecil (lebih stabil).
 */
function kFactor(mmr, tableSize) {
    let k = 32;
    if (mmr < 1000) k = 40;
    else if (mmr >= 1800) k = 24;
    else if (mmr >= 1400) k = 28;
    if (tableSize >= 6) k = Math.round(k * 0.85);
    else if (tableSize <= 4) k = Math.round(k * 1.05);
    return k;
}

/**
 * Card-Elo multiplayer: setiap human vs rata-rata effective rating lawan.
 */
export async function applyRankedResult(playerIds, winnerUid) {
    const humanIds = (playerIds || []).filter((id) => !String(id).startsWith("bot-"));
    if (!humanIds.length) return;

    const profiles = {};
    for (const id of humanIds) {
        profiles[id] = await getRankedProfile(id);
    }

    const tableSize = (playerIds || []).length || humanIds.length;
    const ratings = {};
    for (const id of humanIds) {
        ratings[id] = effectiveRating(profiles[id]);
    }

    for (const uid of humanIds) {
        const others = humanIds.filter((x) => x !== uid);
        const oppAvg =
            others.length > 0
                ? others.reduce((s, x) => s + ratings[x], 0) / others.length
                : DEFAULT_MMR;

        const mmr = profiles[uid].mmr || DEFAULT_MMR;
        const expected = 1 / (1 + Math.pow(10, (oppAvg - ratings[uid]) / 400));
        const score = uid === winnerUid ? 1 : 0;
        const K = kFactor(mmr, tableSize);
        const delta = Math.round(K * (score - expected));
        const next = Math.max(0, mmr + delta);
        const tier = tierFromMmr(next).id;

        const recent = Array.isArray(profiles[uid].recent)
            ? [...profiles[uid].recent, score].slice(-10)
            : [score];

        await update(ref(database, `players/${uid}/ranked`), {
            mmr: next,
            tier,
            rankedWins: (profiles[uid].rankedWins || 0) + (score ? 1 : 0),
            rankedLosses: (profiles[uid].rankedLosses || 0) + (score ? 0 : 1),
            rankedMatches: (profiles[uid].rankedMatches || 0) + 1,
            recent,
            updatedAt: serverTimestamp()
        });

        try {
            const pub = (await get(ref(database, `players/${uid}/public`))).val() || {};
            await set(ref(database, `leaderboard/wins/${uid}`), {
                uid,
                displayName: pub.displayName || uid.slice(0, 8),
                wins: (profiles[uid].rankedWins || 0) + (score ? 1 : 0),
                mmr: next,
                tier,
                updatedAt: Date.now()
            });
        } catch (e) {
            logger.warn("[Ranked] leaderboard:", e.message);
        }
    }

    logger.info("[Card-Elo] Applied, winner:", winnerUid, "table:", tableSize);
}

/**
 * Rata-rata MMR manusia di room → bot skill target (sedikit di atas).
 */
export async function averageHumanMmr(playerMap) {
    const humans = Object.values(playerMap || {}).filter((p) => p && !p.isBot);
    if (!humans.length) return DEFAULT_MMR + 50;
    let sum = 0;
    let n = 0;
    for (const p of humans) {
        try {
            const r = await getRankedProfile(p.uid);
            sum += r.mmr || DEFAULT_MMR;
            n++;
        } catch (_) {
            sum += DEFAULT_MMR;
            n++;
        }
    }
    return n ? sum / n : DEFAULT_MMR;
}

/**
 * Map MMR → personality bot (tactical/chaos saat di atas rata-rata).
 */
export function botDifficultyFromMmr(botMmr, humanAvg) {
    const diff = (botMmr || humanAvg) - (humanAvg || DEFAULT_MMR);
    if (diff >= 100) return "tactical";
    if (diff >= 50) return Math.random() < 0.5 ? "aggressive" : "tactical";
    if (diff >= 20) return Math.random() < 0.4 ? "chaos" : "balanced";
    if (diff <= -50) return "rookie";
    if (diff <= -20) return "defensive";
    const pool = ["balanced", "aggressive", "defensive", "chaos"];
    return pool[Math.floor(Math.random() * pool.length)];
}
