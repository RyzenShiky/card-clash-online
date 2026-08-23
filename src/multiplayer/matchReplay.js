/**
 * Match Replay — append-only event log under rooms/{id}/replay
 */
import {
    ref,
    push,
    set,
    get,
    update
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

function eventsRef(roomId) {
    return ref(database, `rooms/${roomId}/replay/events`);
}

/**
 * Log a game event (host / acting client).
 * @param {string} roomId
 * @param {{ type: string, uid?: string, card?: object, meta?: object }} event
 */
export async function logEvent(roomId, event) {
    try {
        const e = {
            type: event.type,
            uid: event.uid || null,
            card: event.card || null,
            meta: event.meta || null,
            at: Date.now()
        };
        await push(eventsRef(roomId), e);
    } catch (err) {
        logger.warn("[Replay] log failed:", err.message);
    }
}

export async function logMatchStart(roomId, playerIds, settings) {
    await set(ref(database, `rooms/${roomId}/replay/meta`), {
        startedAt: Date.now(),
        playerIds,
        settings: settings || {}
    });
    await logEvent(roomId, {
        type: "match_start",
        meta: { playerIds }
    });
}

export async function logMatchEnd(roomId, winnerUid, scores) {
    await update(ref(database, `rooms/${roomId}/replay/meta`), {
        endedAt: Date.now(),
        winner: winnerUid,
        scores: scores || {}
    });
    await logEvent(roomId, {
        type: "match_end",
        uid: winnerUid,
        meta: { scores }
    });
}

/**
 * Fetch full timeline for replay UI.
 */
export async function fetchReplay(roomId) {
    const metaSnap = await get(ref(database, `rooms/${roomId}/replay/meta`));
    const eventsSnap = await get(eventsRef(roomId));
    const meta = metaSnap.exists() ? metaSnap.val() : null;
    const events = [];
    if (eventsSnap.exists()) {
        const val = eventsSnap.val();
        Object.keys(val)
            .sort()
            .forEach((k) => events.push({ id: k, ...val[k] }));
    }
    return { meta, events };
}

export function formatEventLine(ev) {
    const t = ev.type;
    const who = ev.uid ? String(ev.uid).slice(0, 8) : "—";
    switch (t) {
        case "match_start":
            return "Match Start";
        case "play":
            return `${who} played ${ev.card?.color || ""} ${ev.card?.value || ""}`.trim();
        case "draw":
            return `${who} drew a card`;
        case "stack_accept":
            return `${who} took stack +${ev.meta?.n || "?"}`;
        case "uno":
            return `${who} called UNO`;
        case "challenge_uno":
            return `${who} challenged UNO`;
        case "challenge_wd4":
            return `${who} challenged +4`;
        case "match_end":
            return `Match End — winner ${who}`;
        default:
            return `${t} (${who})`;
    }
}
