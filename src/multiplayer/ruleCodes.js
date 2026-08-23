/**
 * Custom Rule Creator — encode/decode rule presets as short codes
 * Example: CC-A7F9X
 */
import {
    ref,
    set,
    get,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const DEFAULT_RULES = {
    drawStacking: false,
    sevenSwap: false,
    zeroRotation: false,
    forcePlay: false,
    challengeDraw: true,
    callLastCard: true,
    jumpIn: false,
    turnTimer: 30,
    targetScore: 500,
    maxPlayers: 4
};

export function generateRuleCode() {
    let s = "CC-";
    for (let i = 0; i < 5; i++) {
        s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return s;
}

/**
 * Save custom rules under ruleCodes/{code}
 */
export async function saveRulePreset(uid, rules, label = "Custom") {
    const code = generateRuleCode();
    const payload = {
        code,
        label: String(label).slice(0, 40),
        rules: { ...DEFAULT_RULES, ...rules },
        createdBy: uid,
        createdAt: Date.now(),
        plays: 0
    };
    await set(ref(database, `ruleCodes/${code}`), payload);
    logger.info("[Rules] Saved preset", code);
    return payload;
}

export async function loadRulePreset(code) {
    const normalized = String(code || "")
        .trim()
        .toUpperCase();
    if (!normalized.startsWith("CC-")) return null;
    const snap = await get(ref(database, `ruleCodes/${normalized}`));
    return snap.exists() ? snap.val() : null;
}

/** Featured / built-in presets */
export const FEATURED_PRESETS = [
    {
        code: "CC-CLASSIC",
        label: "Classic",
        rules: { ...DEFAULT_RULES }
    },
    {
        code: "CC-STACK",
        label: "Stacking +2/+4",
        rules: { ...DEFAULT_RULES, drawStacking: true }
    },
    {
        code: "CC-CHAOS",
        label: "Chaos (7 Swap + 0 Rotate)",
        rules: {
            ...DEFAULT_RULES,
            drawStacking: true,
            sevenSwap: true,
            zeroRotation: true
        }
    },
    {
        code: "CC-FAST",
        label: "Fast 15s",
        rules: { ...DEFAULT_RULES, turnTimer: 15, targetScore: 300 }
    }
];
