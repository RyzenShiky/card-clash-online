/**
 * Partikel + animasi draw mewah
 */
let layer = null;

function ensureLayer() {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement("div");
  layer.id = "fx-layer";
  layer.className = "fx-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  return layer;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Burst partikel di tengah / titik (x,y) viewport
 */
export function spawnParticles({
  x = window.innerWidth / 2,
  y = window.innerHeight / 2,
  count = 18,
  colors = ["#fbbf24", "#f59e0b", "#38bdf8", "#4ade80", "#f472b6"],
  spread = 120
} = {}) {
  const root = ensureLayer();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "fx-particle";
    const ang = (Math.PI * 2 * i) / count + rand(-0.2, 0.2);
    const dist = rand(spread * 0.4, spread);
    const tx = Math.cos(ang) * dist;
    const ty = Math.sin(ang) * dist - rand(20, 60);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--tx", `${tx}px`);
    p.style.setProperty("--ty", `${ty}px`);
    p.style.setProperty("--dur", `${rand(0.55, 1.05)}s`);
    p.style.setProperty("--scale", `${rand(0.5, 1.2)}`);
    root.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

/**
 * Animasi kartu draw: dari atas menuju hand
 */
export function playDrawAnimation(n = 1) {
  const root = ensureLayer();
  const count = Math.min(8, Math.max(1, n));
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const card = document.createElement("div");
      card.className = "fx-draw-card";
      card.innerHTML = `<span class="fx-draw-back"></span>`;
      root.appendChild(card);
      requestAnimationFrame(() => card.classList.add("fx-draw-fly"));
      setTimeout(() => card.remove(), 900);
    }, i * 90);
  }
  spawnParticles({
    y: window.innerHeight * 0.35,
    count: 10 + count * 2,
    colors: ["#94a3b8", "#e2e8f0", "#38bdf8", "#fbbf24"]
  });
}

/**
 * Efek kartu special (+2, +4, skip, wild)
 */
export function playSpecialFx(type = "wild") {
  const map = {
    draw2: ["#38bdf8", "#0ea5e9", "#fff"],
    wild_draw4: ["#a855f7", "#e11d48", "#fbbf24", "#22c55e"],
    wild: ["#fbbf24", "#f59e0b", "#fff"],
    skip: ["#f87171", "#ef4444"],
    reverse: ["#4ade80", "#22c55e"],
    uno: ["#fde047", "#facc15", "#fff"],
    win: ["#fbbf24", "#f59e0b", "#4ade80", "#38bdf8", "#f472b6"]
  };
  spawnParticles({
    count: type === "win" ? 36 : 22,
    colors: map[type] || map.wild,
    spread: type === "win" ? 180 : 130
  });
}

export function playWinFx() {
  playSpecialFx("win");
  setTimeout(() => playSpecialFx("win"), 280);
}
