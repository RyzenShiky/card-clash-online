/**
 * Rules Engine (client-side validation helper)
 * Server tetap authoritative di multiplayer kompetitif.
 */

/**
 * Apakah kartu boleh dimainkan di atas topCard.
 * @param {object} card - { color, value }
 * @param {object} topCard - { color, value }
 * @param {string|null} currentColor - warna aktif (setelah wild)
 * @param {object} [rules] - custom rules
 * @returns {boolean}
 */
export function canPlayCard(card, topCard, currentColor = null, rules = {}) {
    if (!card || !topCard) return false;

    // Wild selalu boleh (kecuali forcePlay + ada kartu matching - implement later)
    if (card.value === "wild" || card.value === "wild_draw4") {
        return true;
    }

    const effectiveColor = currentColor || topCard.color;

    // Warna sama
    if (card.color === effectiveColor) return true;

    // Nilai sama
    if (card.value === topCard.value) return true;

    return false;
}

/**
 * Apakah pemain harus bilang "LAST CARD" (1 kartu tersisa).
 */
export function shouldCallLastCard(handSize) {
    return handSize === 1;
}

/**
 * Cek win condition.
 */
export function isWinner(hand) {
    return Array.isArray(hand) && hand.length === 0;
}

/**
 * Hitung score hand (untuk penalty / target score).
 */
export function scoreHand(hand) {
    if (!hand) return 0;
    return hand.reduce((sum, c) => {
        if (c.value === "wild" || c.value === "wild_draw4") return sum + 50;
        if (["skip", "reverse", "draw2"].includes(c.value)) return sum + 20;
        const n = parseInt(c.value, 10);
        return sum + (isNaN(n) ? 0 : n);
    }, 0);
}
