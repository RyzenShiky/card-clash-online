/**
 * Shared background music in room
 * Host/anyone sets URL → semua client putar track yang sama
 * Catatan: URL harus langsung ke file audio (mp3/ogg) yang CORS-friendly
 */
import {
    ref,
    set,
    update,
    onValue,
    off,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

let audio = null;
let unsub = null;
let roomIdActive = null;
let lastUrl = null;

function musicRef(roomId) {
    return ref(database, `rooms/${roomId}/music`);
}

function ensureAudio() {
    if (!audio) {
        audio = new Audio();
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0.45;
    }
    return audio;
}

/**
 * Publish track ke room (semua pemain dengar)
 */
export async function setRoomMusic(roomId, uid, { url, title = "BGM", playing = true }) {
    const clean = String(url || "").trim();
    if (!clean) throw new Error("URL lagu kosong");
    if (!/^https?:\/\//i.test(clean)) {
        throw new Error("Pakai URL http(s) langsung ke file audio (mp3/ogg)");
    }
    await set(musicRef(roomId), {
        url: clean.slice(0, 500),
        title: String(title || "BGM").slice(0, 80),
        playing: !!playing,
        by: uid,
        updatedAt: serverTimestamp()
    });
}

export async function setMusicPlaying(roomId, playing) {
    await update(musicRef(roomId), {
        playing: !!playing,
        updatedAt: serverTimestamp()
    });
}

export async function clearRoomMusic(roomId) {
    await set(musicRef(roomId), null);
    stopLocal();
}

function stopLocal() {
    if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
    }
    lastUrl = null;
}

/**
 * Listen music state for room — auto play/pause
 * @returns {() => void}
 */
export function subscribeRoomMusic(roomId, onState) {
    if (unsub) {
        unsub();
        unsub = null;
    }
    roomIdActive = roomId;
    const r = musicRef(roomId);
    const handler = async (snap) => {
        const data = snap.val();
        onState?.(data);
        if (!data || !data.url) {
            stopLocal();
            return;
        }
        const a = ensureAudio();
        try {
            if (data.url !== lastUrl) {
                lastUrl = data.url;
                a.src = data.url;
                a.load();
            }
            if (data.playing) {
                const p = a.play();
                if (p && p.catch) {
                    p.catch((e) => {
                        logger.warn("[Music] autoplay blocked", e?.message);
                        onState?.({ ...data, blocked: true });
                    });
                }
            } else {
                a.pause();
            }
        } catch (e) {
            logger.warn("[Music] play error", e.message);
        }
    };
    onValue(r, handler);
    unsub = () => {
        off(r, "value", handler);
        stopLocal();
        roomIdActive = null;
    };
    return unsub;
}

export function setLocalMusicVolume(v) {
    ensureAudio().volume = Math.max(0, Math.min(1, Number(v) || 0));
}

export function tryUnlockMusic() {
    if (audio && lastUrl) {
        return audio.play().catch(() => {});
    }
}
