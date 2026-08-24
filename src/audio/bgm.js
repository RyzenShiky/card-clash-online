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

/** Track URL yang sedang diputar agar ended tidak double-clear */
let playingUrl = null;
let endedHandlerBound = false;

function ensureAudio() {
    if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.id = "cc-bgm";
        audioEl.loop = false; // sekali putar, tidak mengulang
        audioEl.preload = "auto";
        audioEl.volume = 0.45;
        document.body.appendChild(audioEl);
    }
    if (!endedHandlerBound) {
        endedHandlerBound = true;
        audioEl.addEventListener("ended", () => {
            logger.info("[BGM] track ended — reset ke default");
            const room = currentRoomId;
            playingUrl = null;
            stopLocal();
            // Hapus state shared agar semua pemain ikut reset (tidak ngulang)
            if (room) {
                remove(dbRef(database, `rooms/${room}/bgm`)).catch(() => {});
            }
            showNotification("Musik selesai");
        });
    }
    audioEl.loop = false;
    return audioEl;
}

function stopLocal() {
    playingUrl = null;
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
    a.loop = false;
    // Jangan restart jika URL sama dan masih bermain
    if (playingUrl === url && !a.paused) return;
    playingUrl = url;
    a.src = url;
    try {
        await a.play();
        showNotification(`♪ ${title || "BGM"}`);
    } catch (e) {
        showNotification("Ketuk ▶️ di panel audio untuk memutar");
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
        // Track baru saja (atau belum playing)
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
    // UI bar disembunyikan — buka lewat chat "audio"
    // Hanya sync BGM agar pemain lain tetap dengar
    if (roomId) startBgmSync(roomId);
    return () => {
        stopBgmSync();
    };
}

export function openBgmSecretPanel({ roomId, uid }) {
    let modal = document.getElementById("bgm-secret-modal");
    if (modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "bgm-secret-modal";
    modal.className = "profile-modal-overlay";
    modal.innerHTML = `
      <div class="profile-modal-card" style="max-width:360px">
        <header class="profile-modal-header">
          <h2>♪ Background Music</h2>
          <button type="button" class="btn btn-secondary" id="bgm-secret-close">✕</button>
        </header>
        <p class="text-muted" style="font-size:0.85rem;margin:0.5rem 0 1rem">
          Upload .mp3 (max 8MB). Semua pemain di room ini akan mendengar.
        </p>
        <label class="btn btn-primary" style="display:block;text-align:center;cursor:pointer">
          Pilih file MP3
          <input type="file" id="bgm-secret-file" accept="audio/mpeg,.mp3" hidden />
        </label>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
          <button type="button" class="btn btn-secondary" id="bgm-secret-play" style="flex:1">▶️ Play/Pause</button>
          <button type="button" class="btn btn-secondary" id="bgm-secret-stop" style="flex:1">⏹ Stop</button>
        </div>
        <label style="display:block;margin-top:0.75rem;font-size:0.8rem">Volume</label>
        <input type="range" id="bgm-secret-vol" min="0" max="100" value="45" style="width:100%" />
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#bgm-secret-close")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    modal.querySelector("#bgm-secret-file")?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
            await uploadAndShareBgm(roomId, uid, file);
        } catch (err) {
            showNotification(err.message || "Gagal upload");
        }
    });
    modal.querySelector("#bgm-secret-play")?.addEventListener("click", () => toggleBgmPause());
    modal.querySelector("#bgm-secret-stop")?.addEventListener("click", async () => {
        await clearSharedBgm(roomId);
        showNotification("BGM dihentikan");
    });
    modal.querySelector("#bgm-secret-vol")?.addEventListener("input", (e) => {
        setBgmVolume(Number(e.target.value) / 100);
    });

    // Pastikan sync aktif
    if (roomId) startBgmSync(roomId);
}
