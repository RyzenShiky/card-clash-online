/**
 * Audio Manager — volume, mute, unlock after user gesture (autoplay policy)
 */
const STORAGE_VOL = "cc_sfx_vol";
const STORAGE_MUTE = "cc_sfx_mute";

let ctx = null;
let unlocked = false;
let volume = 0.7;
let muted = false;

try {
  const v = localStorage.getItem(STORAGE_VOL);
  if (v != null) volume = Math.min(1, Math.max(0, parseFloat(v) || 0.7));
  muted = localStorage.getItem(STORAGE_MUTE) === "1";
} catch (_) {}

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Call once on first click/tap anywhere */
export function unlockAudio() {
  if (unlocked) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
    unlocked = true;
  } catch (_) {}
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  try {
    localStorage.setItem(STORAGE_VOL, String(volume));
  } catch (_) {}
}

export function getVolume() {
  return volume;
}

export function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(STORAGE_MUTE, muted ? "1" : "0");
  } catch (_) {}
}

export function isMuted() {
  return muted;
}

function beep(freq, dur, type = "sine", gain = 0.08) {
  if (muted || volume <= 0) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain * volume;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.stop(c.currentTime + dur);
  } catch (_) {}
}

export const sfx = {
  unlock: unlockAudio,
  setVolume,
  getVolume,
  setMuted,
  isMuted,
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

if (typeof document !== "undefined") {
  const once = () => {
    unlockAudio();
    document.removeEventListener("pointerdown", once, true);
    document.removeEventListener("keydown", once, true);
  };
  document.addEventListener("pointerdown", once, true);
  document.addEventListener("keydown", once, true);
}
