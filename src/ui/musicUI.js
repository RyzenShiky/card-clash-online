/**
 * Mini panel BGM in-game — URL shared ke semua pemain via RTDB
 */
import {
    setRoomMusic,
    setMusicPlaying,
    clearRoomMusic,
    subscribeRoomMusic,
    setLocalMusicVolume,
    tryUnlockMusic
} from "../multiplayer/musicSync.js";
import { showNotification } from "./notificationUI.js";

let panel = null;
let unsub = null;

export function mountMusicPanel(roomId, uid) {
    unmountMusicPanel();

    panel = document.createElement("div");
    panel.id = "music-panel";
    panel.className = "music-panel";
    panel.innerHTML = `
      <button type="button" class="music-toggle" id="music-toggle" title="Musik">🎵</button>
      <div class="music-drawer hidden" id="music-drawer">
        <div class="music-title">Musik latar (semua dengar)</div>
        <input type="url" id="music-url" placeholder="https://…/lagu.mp3" class="music-input" />
        <input type="text" id="music-name" placeholder="Judul (opsional)" class="music-input" />
        <div class="music-actions">
          <button type="button" class="btn btn-primary btn-sm" id="music-play">Putar</button>
          <button type="button" class="btn btn-secondary btn-sm" id="music-pause">Pause</button>
          <button type="button" class="btn btn-secondary btn-sm" id="music-stop">Stop</button>
        </div>
        <label class="music-vol">Volume
          <input type="range" id="music-vol" min="0" max="100" value="45" />
        </label>
        <p class="music-now" id="music-now">—</p>
        <p class="music-hint">Pakai URL langsung ke file mp3/ogg. Browser bisa memblokir autoplay — klik 🎵 sekali.</p>
      </div>
    `;
    document.body.appendChild(panel);

    const drawer = panel.querySelector("#music-drawer");
    panel.querySelector("#music-toggle")?.addEventListener("click", () => {
        drawer?.classList.toggle("hidden");
        tryUnlockMusic();
    });

    panel.querySelector("#music-play")?.addEventListener("click", async () => {
        const url = panel.querySelector("#music-url")?.value?.trim();
        const title = panel.querySelector("#music-name")?.value?.trim() || "BGM";
        if (!url) {
            showNotification("Isi URL lagu dulu");
            return;
        }
        try {
            await setRoomMusic(roomId, uid, { url, title, playing: true });
            showNotification("Musik diputar untuk semua");
        } catch (e) {
            showNotification(e.message || "Gagal putar");
        }
    });

    panel.querySelector("#music-pause")?.addEventListener("click", async () => {
        try {
            await setMusicPlaying(roomId, false);
        } catch (e) {
            showNotification(e.message);
        }
    });

    panel.querySelector("#music-stop")?.addEventListener("click", async () => {
        try {
            await clearRoomMusic(roomId);
            const now = panel.querySelector("#music-now");
            if (now) now.textContent = "—";
        } catch (e) {
            showNotification(e.message);
        }
    });

    panel.querySelector("#music-vol")?.addEventListener("input", (e) => {
        setLocalMusicVolume(Number(e.target.value) / 100);
    });

    unsub = subscribeRoomMusic(roomId, (data) => {
        const now = panel?.querySelector("#music-now");
        if (!now) return;
        if (!data?.url) {
            now.textContent = "—";
            return;
        }
        now.textContent = `${data.playing ? "▶" : "❚❚"} ${data.title || "BGM"}${
            data.blocked ? " (klik 🎵 untuk unlock)" : ""
        }`;
        if (data.url && panel.querySelector("#music-url") && !panel.querySelector("#music-url").value) {
            panel.querySelector("#music-url").value = data.url;
        }
    });

    return unmountMusicPanel;
}

export function unmountMusicPanel() {
    if (unsub) {
        unsub();
        unsub = null;
    }
    panel?.remove();
    panel = null;
}
