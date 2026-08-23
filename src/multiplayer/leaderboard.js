/**
 * Realtime wins leaderboard
 */
import {
    ref,
    onValue,
    off,
    query,
    orderByChild,
    limitToLast,
    get
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { rankLabel } from "./ranked.js";

/**
 * Subscribe top N by wins (client sorts; RTDB limitToLast needs index).
 * @param {(rows: Array) => void} callback
 * @param {number} limit
 * @returns {() => void}
 */
export function subscribeLeaderboard(callback, limit = 20) {
    const r = ref(database, "leaderboard/wins");
    const handler = (snap) => {
        if (!snap.exists()) {
            callback([]);
            return;
        }
        const rows = Object.values(snap.val() || {})
            .filter((x) => x && x.uid)
            .sort((a, b) => (b.wins || 0) - (a.wins || 0) || (b.mmr || 0) - (a.mmr || 0))
            .slice(0, limit)
            .map((x, i) => ({
                rank: i + 1,
                uid: x.uid,
                displayName: x.displayName || x.uid.slice(0, 8),
                wins: x.wins || 0,
                mmr: x.mmr || 0,
                tier: x.tier || "warrior",
                label: rankLabel(x.mmr || 0)
            }));
        callback(rows);
    };
    onValue(r, handler);
    return () => off(r, "value", handler);
}

export async function fetchLeaderboard(limit = 20) {
    const snap = await get(ref(database, "leaderboard/wins"));
    if (!snap.exists()) return [];
    return Object.values(snap.val() || {})
        .filter((x) => x && x.uid)
        .sort((a, b) => (b.wins || 0) - (a.wins || 0))
        .slice(0, limit);
}
