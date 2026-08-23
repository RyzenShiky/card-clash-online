/**
 * Ranked system — tiers + MMR
 * Warrior → Athletic → Professional → Gold → Platinum → Master → GrandMaster → Legend
 */
import {
    ref,
    get,
    update,
    set,
    increment,
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
export const RANKED_MAX_PLAYERS = 4;

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

/**
 * Ensure ranked fields exist on player profile.
 */
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
 * Simple Elo-like update after ranked match.
 * @param {string[]} playerIds
 * @param {string} winnerUid
 */
export async function applyRankedResult(playerIds, winnerUid) {
    const K = 32;
    const profiles = {};
    for (const id of playerIds) {
        if (String(id).startsWith("bot-")) continue;
        profiles[id] = await getRankedProfile(id);
    }

    const humanIds = Object.keys(profiles);
    if (!humanIds.length) return;

    const avgOpp = (uid) => {
        const others = humanIds.filter((x) => x !== uid);
        if (!others.length) return DEFAULT_MMR;
        return others.reduce((s, x) => s + (profiles[x].mmr || DEFAULT_MMR), 0) / others.length;
    };

    for (const uid of humanIds) {
        const mmr = profiles[uid].mmr || DEFAULT_MMR;
        const opp = avgOpp(uid);
        const expected = 1 / (1 + Math.pow(10, (opp - mmr) / 400));
        const score = uid === winnerUid ? 1 : 0;
        const delta = Math.round(K * (score - expected));
        const next = Math.max(0, mmr + delta);
        const tier = tierFromMmr(next).id;

        await update(ref(database, `players/${uid}/ranked`), {
            mmr: next,
            tier,
            rankedWins: (profiles[uid].rankedWins || 0) + (score ? 1 : 0),
            rankedLosses: (profiles[uid].rankedLosses || 0) + (score ? 0 : 1),
            rankedMatches: (profiles[uid].rankedMatches || 0) + 1,
            updatedAt: serverTimestamp()
        });

        // Leaderboard entry
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
            logger.warn("[Ranked] leaderboard write:", e.message);
        }
    }

    logger.info("[Ranked] Applied result, winner:", winnerUid);
}
