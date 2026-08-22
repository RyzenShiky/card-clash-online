/**
 * Rules helpers — validasi kartu, skor, warna
 */

export function canPlayCard(card, topCard, currentColor = null, rules = {}) {
    if (!card || !topCard) return false;

    // Wild selalu boleh (kecuali sedang wajib stack — dicek di matchSync)
    if (card.value === "wild" || card.value === "wild_draw4") {
        return true;
    }

    // Warna aktif: prioritas currentColor (setelah pilih warna wild)
    const activeColor = currentColor || topCard.color || null;

    if (activeColor && card.color === activeColor) {
        return true;
    }

    // Match value (angka / skip / reverse / draw2)
    // Jangan match value wild / wild_draw4 dengan kartu biasa
    const topVal = topCard.value;
    if (
        topVal &&
        topVal !== "wild" &&
        topVal !== "wild_draw4" &&
        card.value === topVal
    ) {
        return true;
    }

    return false;
}

export function shouldCallLastCard(handSize) {
    return handSize === 1;
}

export function isWinner(hand) {
    return Array.isArray(hand) && hand.length === 0;
}

export function scoreHand(hand) {
    if (!hand) return 0;
    return hand.reduce((sum, c) => {
        if (c.value === "wild" || c.value === "wild_draw4") return sum + 50;
        if (["skip", "reverse", "draw2"].includes(c.value)) return sum + 20;
        const n = parseInt(c.value, 10);
        return sum + (isNaN(n) ? 0 : n);
    }, 0);
}

export function normalizeColor(input) {
    const s = String(input || "").toLowerCase().trim();
    const map = {
        red: "red",
        merah: "red",
        blue: "blue",
        biru: "blue",
        green: "green",
        hijau: "green",
        yellow: "yellow",
        kuning: "yellow"
    };
    return map[s] || null;
}
