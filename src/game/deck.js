/**
 * Deck System
 * Model kartu + shuffle + deal (client-side untuk Solo; server-side nanti).
 */

export const COLORS = ["red", "blue", "green", "yellow"];
export const VALUES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
export const SPECIALS = ["wild", "wild_draw4"];

/**
 * Buat deck standard (108 kartu style, original naming).
 * @returns {Array<{ id: string, color: string|null, value: string }>}
 */
export function createDeck() {
    const deck = [];
    let id = 0;

    for (const color of COLORS) {
        // 0: 1x
        deck.push({ id: `c${id++}`, color, value: "0" });
        // 1-9, skip, reverse, draw2: 2x
        for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"]) {
            deck.push({ id: `c${id++}`, color, value: v });
            deck.push({ id: `c${id++}`, color, value: v });
        }
    }

    // Wild & Wild Draw 4: 4x each
    for (let i = 0; i < 4; i++) {
        deck.push({ id: `c${id++}`, color: null, value: "wild" });
        deck.push({ id: `c${id++}`, color: null, value: "wild_draw4" });
    }

    return deck;
}

/**
 * Fisher-Yates shuffle
 * @param {Array} deck
 * @returns {Array}
 */
export function shuffle(deck) {
    const arr = [...deck];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Deal cards
 * @param {Array} deck
 * @param {number} playerCount
 * @param {number} cardsPerPlayer
 * @returns {{ hands: Array[], remaining: Array }}
 */
export function deal(deck, playerCount, cardsPerPlayer = 7) {
    const hands = Array.from({ length: playerCount }, () => []);
    let idx = 0;

    for (let c = 0; c < cardsPerPlayer; c++) {
        for (let p = 0; p < playerCount; p++) {
            if (idx < deck.length) {
                hands[p].push(deck[idx++]);
            }
        }
    }

    return {
        hands,
        remaining: deck.slice(idx)
    };
}
