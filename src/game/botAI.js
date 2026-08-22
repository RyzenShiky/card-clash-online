/**
 * Simple bot for Solo + disconnect takeover
 */
import { canPlayCard } from "./rules.js";

/**
 * Pilih aksi bot: { type: 'play', cardId, color? } | { type: 'draw' }
 */
export function chooseBotAction(hand, topCard, currentColor, difficulty = "normal") {
    const playable = (hand || []).filter((c) =>
        canPlayCard(c, topCard, currentColor)
    );

    if (!playable.length) return { type: "draw" };

    if (difficulty === "easy") {
        const c = playable[Math.floor(Math.random() * playable.length)];
        return playAction(c);
    }

    // Prefer action cards, then high numbers, save wilds
    const score = (c) => {
        let s = 0;
        if (c.value === "draw2") s += 40;
        else if (c.value === "skip" || c.value === "reverse") s += 30;
        else if (c.value === "wild_draw4") s += 10; // save
        else if (c.value === "wild") s += 5;
        else s += parseInt(c.value, 10) || 0;
        return s;
    };

    playable.sort((a, b) => score(b) - score(a));
    const pick =
        difficulty === "hard" ? playable[0] : playable[Math.floor(playable.length / 3)] || playable[0];
    return playAction(pick);
}

function playAction(c) {
    let color = null;
    if (c.value === "wild" || c.value === "wild_draw4") {
        const colors = ["red", "blue", "green", "yellow"];
        color = colors[Math.floor(Math.random() * 4)];
    }
    return { type: "play", cardId: c.id, color };
}
