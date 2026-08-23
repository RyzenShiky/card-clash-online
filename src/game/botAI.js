/**
 * Bot AI — personality dalam:
 * rookie | balanced | aggressive | defensive | tactical | chaos
 * Alias difficulty: easy→rookie, normal→balanced, hard→tactical
 */
import { canPlayCard } from "./rules.js";

const COLORS = ["red", "blue", "green", "yellow"];

function normalizePersonality(p) {
  const map = {
    easy: "rookie",
    normal: "balanced",
    hard: "tactical",
    rookie: "rookie",
    balanced: "balanced",
    aggressive: "aggressive",
    defensive: "defensive",
    tactical: "tactical",
    chaos: "chaos"
  };
  return map[p] || "balanced";
}

/**
 * @param {Array} hand
 * @param {object} topCard
 * @param {string} currentColor
 * @param {string} personality
 * @param {object} [ctx] — { opponentCounts: number[], handCounts: object, stacking, stackType }
 */
export function chooseBotAction(
  hand,
  topCard,
  currentColor,
  personality = "balanced",
  ctx = {}
) {
  const style = normalizePersonality(personality);
  const playable = (hand || []).filter((c) =>
    canPlayCard(c, topCard, currentColor)
  );
  if (!playable.length) return { type: "draw" };

  // Rookie: sering salah pilih / random
  if (style === "rookie" && Math.random() < 0.35) {
    const c = playable[Math.floor(Math.random() * playable.length)];
    return playAction(c, hand, currentColor, style, ctx);
  }

  const scored = playable.map((c) => ({
    c,
    s: scoreCard(c, hand, currentColor, style, ctx)
  }));
  scored.sort((a, b) => b.s - a.s);

  let pick = scored[0].c;

  if (style === "chaos") {
    // Chaos: 40% ambil dari top-3 acak, 15% pure random playable
    if (Math.random() < 0.15) {
      pick = playable[Math.floor(Math.random() * playable.length)];
    } else if (Math.random() < 0.4 && scored.length > 1) {
      pick = scored[Math.floor(Math.random() * Math.min(3, scored.length))].c;
    }
  } else if (style === "balanced" && scored.length > 1 && Math.random() < 0.28) {
    pick = scored[Math.floor(Math.random() * Math.min(3, scored.length))].c;
  } else if (style === "rookie" && scored.length > 1 && Math.random() < 0.5) {
    pick = scored[Math.floor(Math.random() * scored.length)].c;
  }

  return playAction(pick, hand, currentColor, style, ctx);
}

function scoreCard(c, hand, currentColor, style, ctx) {
  const v = c.value;
  const n = (hand || []).length;
  const opp = ctx.opponentCounts || [];
  const minOpp = opp.length ? Math.min(...opp) : 7;
  const maxOpp = opp.length ? Math.max(...opp) : 7;

  let s = 0;

  // Base value
  if (v === "draw2") s += 40;
  else if (v === "skip" || v === "reverse") s += 32;
  else if (v === "wild_draw4") s += 10;
  else if (v === "wild") s += 8;
  else s += (parseInt(v, 10) || 0) + 4;

  if (c.color && c.color === currentColor) s += 14;

  // --- Personality weights ---
  switch (style) {
    case "aggressive":
      if (v === "draw2" || v === "wild_draw4") s += 35;
      if (v === "skip") s += 20;
      if (minOpp <= 2 && (v === "draw2" || v === "skip" || v === "wild_draw4"))
        s += 40;
      if (v === "wild" && n > 4) s -= 15; // jangan buang wild terlalu cepat
      break;

    case "defensive":
      // Simpan special & wild
      if (v === "wild" || v === "wild_draw4") s -= 25;
      if (v === "draw2" || v === "skip") s -= 8;
      if (!isNaN(parseInt(v, 10))) s += 18;
      if (n <= 2) {
        // akhir: boleh keluarkan special
        if (v === "wild" || v === "wild_draw4") s += 50;
      }
      // Prefer warna yang paling banyak di hand
      if (c.color) s += colorCount(hand, c.color) * 3;
      break;

    case "tactical": {
      // Hitung warna, sisa lawan, timing wild
      if (c.color) s += colorCount(hand, c.color) * 4;
      // Tekan lawan yang hampir UNO
      if (minOpp <= 2) {
        if (v === "draw2" || v === "skip" || v === "wild_draw4") s += 55;
      }
      // Jika kita banyak kartu, buang angka dulu
      if (n >= 7 && !isNaN(parseInt(v, 10))) s += 12;
      // Wild +4 hanya jika tidak punya warna match (canPlay sudah filter) atau akhir
      if (v === "wild_draw4") {
        const hasColor = (hand || []).some(
          (x) => x.color === currentColor && x.value !== "wild" && x.value !== "wild_draw4"
        );
        s += hasColor ? -30 : 45;
      }
      if (v === "wild") {
        s += n <= 3 ? 40 : -10;
      }
      // Reverse berguna jika next opponent sedikit kartu (approx)
      if (v === "reverse" && maxOpp - minOpp >= 3) s += 12;
      break;
    }

    case "chaos":
      s += Math.random() * 50;
      if (v === "wild" || v === "wild_draw4") s += Math.random() * 40;
      break;

    case "rookie":
      s += Math.random() * 20;
      break;

    default: // balanced
      if (n <= 3 && !isNaN(parseInt(v, 10))) s += 12;
      if (n >= 8 && (v === "draw2" || v === "skip")) s += 15;
      if (minOpp <= 2 && (v === "draw2" || v === "wild_draw4")) s += 25;
      break;
  }

  return s;
}

function colorCount(hand, color) {
  return (hand || []).filter((c) => c.color === color).length;
}

function playAction(c, hand, currentColor, style, ctx) {
  let color = null;
  if (c.value === "wild" || c.value === "wild_draw4") {
    color = pickBestColor(hand, currentColor, style, ctx);
  }
  return { type: "play", cardId: c.id, color };
}

function pickBestColor(hand, fallback, style, ctx) {
  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  for (const c of hand || []) {
    if (c.color && counts[c.color] !== undefined) counts[c.color]++;
  }

  if (style === "chaos" && Math.random() < 0.45) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  if (style === "rookie" && Math.random() < 0.3) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  let best = fallback || "red";
  let max = -1;
  for (const [col, n] of Object.entries(counts)) {
    // Tactical: slight bias keep continuity
    let score = n;
    if (style === "tactical" && col === fallback) score += 0.5;
    if (style === "aggressive" && col === fallback) score += 0.3;
    if (score > max) {
      max = score;
      best = col;
    }
  }
  return best;
}

export function botThinkMs(personality = "balanced") {
  const style = normalizePersonality(personality);
  const base = {
    rookie: 1000,
    balanced: 700,
    aggressive: 550,
    defensive: 800,
    tactical: 900,
    chaos: 400
  }[style] || 700;
  return base + Math.floor(Math.random() * 800);
}

/** Untuk matchmaking: label personality bot */
export const BOT_PERSONALITIES = [
  "rookie",
  "balanced",
  "aggressive",
  "defensive",
  "tactical",
  "chaos"
];

export function pickBotPersonality(preferHarder = false) {
  if (preferHarder) {
    const hard = ["tactical", "aggressive", "chaos", "balanced"];
    return hard[Math.floor(Math.random() * hard.length)];
  }
  return BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)];
}
