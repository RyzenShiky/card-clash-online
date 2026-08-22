/**
 * Lightweight Web Audio SFX (no external files)
 */
let ctx = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function beep(freq, dur, type = "sine", gain = 0.08) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.stop(c.currentTime + dur);
  } catch (_) {}
}

export const sfx = {
  playCard: () => {
    beep(320, 0.08, "triangle", 0.06);
    setTimeout(() => beep(480, 0.06, "triangle", 0.05), 40);
  },
  draw: () => beep(180, 0.1, "square", 0.04),
  uno: () => {
    beep(520, 0.12, "sawtooth", 0.07);
    setTimeout(() => beep(780, 0.15, "sawtooth", 0.07), 100);
  },
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => beep(f, 0.15, "sine", 0.07), i * 90)
    );
  },
  error: () => beep(120, 0.15, "sawtooth", 0.05),
  click: () => beep(600, 0.04, "sine", 0.03),
  challenge: () => {
    beep(200, 0.1, "square", 0.06);
    setTimeout(() => beep(150, 0.12, "square", 0.06), 80);
  }
};
