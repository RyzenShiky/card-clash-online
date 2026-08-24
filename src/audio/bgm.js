/**
 * Background music in-game
 * - Upload .mp3 (Firebase Storage) → URL di RTDB rooms/{roomId}/bgm
 * - Semua pemain di room mendengarkan yang sama
 * - Fallback: putar lokal saja jika Storage gagal
 */
import {
    ref as dbRef,
    set,
    onValue,
    off,
    remove
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import {
    getStorage,
    ref as storageRef,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";
import app from "../firebase/config.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";
import { showNotification } from "../ui/notificationUI.js";

const storage = getStorage(app);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

let audioEl = null;
let unsub = null;
let currentRoomId = null;
let localObjectUrl = null;

function ensureAudio() {
    if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.id = "cc-bgm";
        audioEl.loop = true;
        audioEl.preload = "auto";
        audioEl.volume = 0.45;
        document.body.appendChild(audioEl);
    }
    return audioEl;
}

function stopLocal() {
    if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
    }
    if (localObjectUrl) {
        URL.revokeObjectURL(localObjectUrl);
        localObjectUrl = null;
    }
}

async function playUrl(url, title) {
    const a = ensureAudio();
    if (a.src === url && !a.paused) return;
    a.src = url;
    try {
        await a.play();
        showNotification(`♪ ${title || "BGM"}`);
    } catch (e) {
        // Autoplay policy — butuh gesture
        showNotification("Ketuk ▶️ BGM untuk memutar musik");
        logger.warn("[BGM] autoplay blocked", e.message);
    }
}

/**
 * Listen shared BGM for room
 */
export function startBgmSync(roomId) {
    stopBgmSync();
    currentRoomId = roomId;
    const r = dbRef(database, `rooms/${roomId}/bgm`);
    const handler = (snap) => {
        const data = snap.val();
        if (!data?.url) {
            stopLocal();
            return;
        }
        playUrl(data.url, data.title);
    };
    onValue(r, handler);
    unsub = () => off(r, "value", handler);
}

export function stopBgmSync() {
    try {
        unsub?.();
    } catch (_) {}
    unsub = null;
    stopLocal();
    currentRoomId = null;
}

/**
 * Upload MP3 & share ke room (semua pemain dengar)
 */
export async function uploadAndShareBgm(roomId, uid, file) {
    if (!file || !roomId) throw new Error("File / room tidak valid");
    if (!/\.mp3$/i.test(file.name) && file.type !== "audio/mpeg") {
        throw new Error("Hanya file .mp3 yang didukung");
    }
    if (file.size > MAX_BYTES) {
        throw new Error("Maksimal 8 MB");
    }

    showNotification("Mengunggah musik…");

    try {
        const path = `bgm/${roomId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, file, { contentType: "audio/mpeg" });
        const url = await getDownloadURL(sRef);

        await set(dbRef(database, `rooms/${roomId}/bgm`), {
            url,
            title: file.name.replace(/\.mp3$/i, ""),
            by: uid,
            at: Date.now()
        });

        showNotification("Musik dibagikan ke semua pemain");
        return url;
    } catch (e) {
        logger.warn("[BGM] Storage share failed, local only:", e.message);
        // Fallback lokal
        stopLocal();
        localObjectUrl = URL.createObjectURL(file);
        await playUrl(localObjectUrl, file.name);
        showNotification(
            "Musik diputar lokal saja (aktifkan Storage Rules agar semua dengar)"
        );
        return localObjectUrl;
    }
}

export async function clearSharedBgm(roomId) {
    if (!roomId) return;
    try {
        await remove(dbRef(database, `rooms/${roomId}/bgm`));
    } catch (_) {}
    stopLocal();
}

export function setBgmVolume(v) {
    ensureAudio().volume = Math.max(0, Math.min(1, v));
}

export function toggleBgmPause() {
    const a = ensureAudio();
    if (!a.src) return false;
    if (a.paused) {
        a.play().catch(() => {});
        return true;
    }
    a.pause();
    return false;
}

export function mountBgmControls(parent, { roomId, uid }) {
    if (!parent || !roomId) return () => {};
    let bar = document.getElementById("bgm-bar");
    if (bar) bar.remove();

    bar = document.createElement("div");
    bar.id = "bgm-bar";
    bar.innerHTML = `
      <label class="bgm-upload-label btn btn-secondary btn-sm">
        ♪ MP3
        <input type="file" id="bgm-file" accept="audio/mpeg,.mp3" hidden />
      </label>
      <button type="button" class="btn btn-secondary btn-sm" id="bgm-play">▶️</button>
      <button type="button" class="btn btn-secondary btn-sm" id="bgm-stop">⏹</button>
      <input type="range" id="bgm-vol" min="0" max="100" value="45" title="Volume" />
    `;
    bar.style.cssText = `
      position: fixed; bottom: 12px; left: 12px; z-index: 40;
      display: flex; align-items: center; gap: 0.35rem;
      background: rgba(15,23,42,0.85); padding: 0.35rem 0.5rem;
      border-radius: 10px; border: 1px solid rgba(148,163,184,0.25);
    `;
    parent.appendChild(bar);

    bar.querySelector("#bgm-file")?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
            await uploadAndShareBgm(roomId, uid, file);
        } catch (err) {
            showNotification(err.message || "Gagal upload");
        }
    });
    bar.querySelector("#bgm-play")?.addEventListener("click", () => {
        toggleBgmPause();
    });
    bar.querySelector("#bgm-stop")?.addEventListener("click", async () => {
        await clearSharedBgm(roomId);
        showNotification("BGM dihentikan");
    });
    bar.querySelector("#bgm-vol")?.addEventListener("input", (e) => {
        setBgmVolume(Number(e.target.value) / 100);
    });

    startBgmSync(roomId);

    return () => {
        stopBgmSync();
        bar?.remove();
    };
}
