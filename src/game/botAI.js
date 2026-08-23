/**
 * Bot AI — bermain lebih mirip manusia
 */
import { canPlayCard } from "./rules.js";

export function chooseBotAction(hand, topCard, currentColor, difficulty = "normal") {
    const playable = (hand || []).filter((c) =>
        canPlayCard(c, topCard, currentColor)
    );
    if (!playable.length) return { type: "draw" };

    if (difficulty === "easy" && Math.random() < 0.25) {
        const c = playable[Math.floor(Math.random() * playable.length)];
        return playAction(c, hand, currentColor);
    }

    const score = (c) => {
        let s = 0;
        const v = c.value;
        if (v === "draw2") s += 45;
        else if (v === "skip" || v === "reverse") s += 35;
        else if (v === "wild_draw4") s += 8;
        else if (v === "wild") s += 6;
        else s += (parseInt(v, 10) || 0) + 5;
        if (c.color && c.color === currentColor) s += 12;
        if ((hand || []).length <= 3 && !isNaN(parseInt(v, 10))) s += 10;
        if ((hand || []).length >= 8 && (v === "draw2" || v === "skip")) s += 15;
        return s;
    };

    playable.sort((a, b) => score(b) - score(a));
    let pick = playable[0];
    if (difficulty === "normal" && playable.length > 1 && Math.random() < 0.35) {
        pick = playable[Math.floor(Math.random() * Math.min(3, playable.length))];
    }
    return playAction(pick, hand, currentColor);
}

function playAction(c, hand, currentColor) {
    let color = null;
    if (c.value === "wild" || c.value === "wild_draw4") {
        color = pickBestColor(hand, currentColor);
    }
    return { type: "play", cardId: c.id, color };
}

function pickBestColor(hand, fallback) {
    const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (const c of hand || []) {
        if (c.color && counts[c.color] !== undefined) counts[c.color]++;
    }
    let best = fallback || "red";
    let max = -1;
    for (const [col, n] of Object.entries(counts)) {
        if (n > max) {
            max = n;
            best = col;
        }
    }
    if (Math.random() < 0.15) {
        const cols = Object.keys(counts);
        best = cols[Math.floor(Math.random() * cols.length)];
    }
    return best;
}

export function botThinkMs(difficulty = "normal") {
    const base = difficulty === "easy" ? 900 : difficulty === "hard" ? 500 : 700;
    return base + Math.floor(Math.random() * 900);
}
