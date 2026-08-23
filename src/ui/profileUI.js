/**
 * Profile modal lengkap:
 * - Username (validasi + preview)
 * - Avatar preset
 * - Stats + Ranked
 * - Settings (sound, music, language)
 * - Guest → Google link
 * - Save sinkron Auth + RTDB
 */
import { updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { ref, update } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database, auth } from "../firebase/services.js";
import { getPlayerProfile } from "../auth/playerProfile.js";
import { isAnonymousUser } from "../auth/authManager.js";
import { secureAccountWithGoogle } from "../auth/accountLinking.js";
import { showNotification } from "./notificationUI.js";
import { logger } from "../utils/logger.js";

const AVATAR_PRESETS = [
    { id: "default", emoji: "🎮", label: "Gamer" },
    { id: "fire", emoji: "🔥", label: "Fire" },
    { id: "crown", emoji: "👑", label: "Crown" },
    { id: "dragon", emoji: "🐉", label: "Dragon" },
    { id: "star", emoji: "⭐", label: "Star" },
    { id: "bolt", emoji: "⚡", label: "Bolt" },
    { id: "robot", emoji: "🤖", label: "Robot" },
    { id: "ninja", emoji: "🥷", label: "Ninja" }
];

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function normalizeUsername(raw) {
    let s = String(raw || "")
        .trim()
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/\s+/g, " ");
    if (s.length > 24) s = s.slice(0, 24);
    return s;
}

function validateUsername(s) {
    if (s.length < 3) return "Username minimal 3 karakter";
    if (s.length > 24) return "Username maksimal 24 karakter";
    if (!/^[\p{L}\p{N} _.\-]+$/u.test(s)) {
        return "Hanya huruf, angka, spasi, _ . -";
    }
    return null;
}

/**
 * @param {import("firebase/auth").User} user
 * @param {{ onClose?: () => void, onUpdated?: (user) => void }} handlers
 */
export async function openProfileModal(user, handlers = {}) {
    const existing = document.getElementById("profile-modal");
    if (existing) existing.remove();

    let profile = null;
    try {
        profile = await getPlayerProfile(user.uid);
    } catch (e) {
        logger.warn("[ProfileUI] load failed:", e.message);
    }

    const pub = profile?.public || {};
    const stats = profile?.stats || {};
    const settings = profile?.private?.settings || {
        sound: true,
        music: true,
        language: "id"
    };
    const ranked = profile?.ranked || {};

    let draftName =
        pub.displayName || user.displayName || `Guest_${user.uid.slice(0, 6)}`;
    let draftAvatar = pub.avatarId || "default";
    let draftSound = settings.sound !== false;
    let draftMusic = settings.music !== false;
    let draftLang = settings.language || "id";

    const type = isAnonymousUser(user) ? "Guest" : "Google";
    const wins = stats.wins ?? 0;
    const losses = stats.losses ?? 0;
    const played = stats.matchesPlayed ?? 0;
    const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;
    const level = Math.max(1, Math.floor((wins * 2 + played) / 5) + 1);
    const mmr = ranked.mmr ?? 1000;
    const tierName = String(ranked.tier || "professional").replace(/^\w/, (c) =>
        c.toUpperCase()
    );

    const avatarEmoji = (id) =>
        AVATAR_PRESETS.find((a) => a.id === id)?.emoji || "🎮";

    const modal = document.createElement("div");
    modal.id = "profile-modal";
    modal.className = "profile-modal-overlay";
    modal.innerHTML = `
      <div class="profile-modal-card profile-modal-wide">
        <header class="profile-modal-header">
          <h2>Profile</h2>
          <button type="button" class="btn btn-secondary profile-close" aria-label="Close">✕</button>
        </header>
        <div class="profile-modal-body profile-scroll">
          <div class="profile-identity">
            <div class="profile-avatar" id="profile-avatar-preview">${avatarEmoji(draftAvatar)}</div>
            <div>
              <div class="profile-name" id="profile-name-preview">${esc(draftName)}</div>
              <div class="profile-meta">${type} · Lvl ${level} · ${esc(tierName)} ${mmr}</div>
              <div class="profile-meta">ID ${esc(user.uid.slice(0, 10))}</div>
            </div>
          </div>

          <section class="profile-section">
            <h3>Identity</h3>
            <label class="profile-field">
              <span>Username</span>
              <input id="profile-username" type="text" maxlength="24" value="${esc(draftName)}" autocomplete="off" />
              <small id="profile-user-hint" class="profile-hint">3–24 karakter</small>
            </label>
            <div class="profile-field">
              <span>Avatar</span>
              <div class="avatar-grid" id="avatar-grid">
                ${AVATAR_PRESETS.map(
                    (a) => `
                  <button type="button" class="avatar-opt ${a.id === draftAvatar ? "selected" : ""}" data-avatar="${a.id}" title="${a.label}">
                    ${a.emoji}
                  </button>`
                ).join("")}
              </div>
            </div>
          </section>

          <section class="profile-section">
            <h3>Statistics</h3>
            <div class="profile-stats">
              <div><strong>${played}</strong><span>Matches</span></div>
              <div><strong>${wins}</strong><span>Wins</span></div>
              <div><strong>${losses}</strong><span>Losses</span></div>
              <div><strong>${winRate}%</strong><span>Win Rate</span></div>
              <div><strong>${stats.winStreak ?? 0}</strong><span>Streak</span></div>
              <div><strong>${stats.bestWinStreak ?? 0}</strong><span>Best</span></div>
              <div><strong>${stats.cardsPlayed ?? 0}</strong><span>Cards</span></div>
              <div><strong>${mmr}</strong><span>MMR</span></div>
            </div>
          </section>

          <section class="profile-section">
            <h3>Settings</h3>
            <label class="rules-check">
              <input type="checkbox" id="profile-sound" ${draftSound ? "checked" : ""} />
              Sound effects
            </label>
            <label class="rules-check">
              <input type="checkbox" id="profile-music" ${draftMusic ? "checked" : ""} />
              Music
            </label>
            <label class="profile-field">
              <span>Language</span>
              <select id="profile-lang">
                <option value="id" ${draftLang === "id" ? "selected" : ""}>Indonesia</option>
                <option value="en" ${draftLang === "en" ? "selected" : ""}>English</option>
              </select>
            </label>
          </section>

          ${
              isAnonymousUser(user)
                  ? `<button type="button" class="btn btn-accent" id="profile-link-google">Link Google (progress tetap)</button>`
                  : `<p class="text-muted" style="font-size:0.8rem;margin:0">Akun Google terhubung ✓</p>`
          }
        </div>
        <footer class="profile-modal-footer">
          <button type="button" class="btn btn-secondary profile-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="profile-save">Save</button>
        </footer>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
        modal.remove();
        handlers.onClose?.();
    };

    modal.querySelector(".profile-close")?.addEventListener("click", close);
    modal.querySelector(".profile-cancel")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    const nameInput = modal.querySelector("#profile-username");
    const namePreview = modal.querySelector("#profile-name-preview");
    const avatarPreview = modal.querySelector("#profile-avatar-preview");
    const hint = modal.querySelector("#profile-user-hint");

    nameInput?.addEventListener("input", () => {
        const n = normalizeUsername(nameInput.value);
        if (namePreview) namePreview.textContent = n || "…";
        const err = validateUsername(n);
        if (hint) {
            hint.textContent = err || "OK";
            hint.style.color = err ? "#ff6b6b" : "#34c759";
        }
    });

    modal.querySelectorAll(".avatar-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
            draftAvatar = btn.dataset.avatar;
            modal.querySelectorAll(".avatar-opt").forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
            if (avatarPreview) avatarPreview.textContent = avatarEmoji(draftAvatar);
        });
    });

    modal.querySelector("#profile-link-google")?.addEventListener("click", async () => {
        try {
            const u = await secureAccountWithGoogle();
            showNotification("Akun berhasil di-link ke Google!");
            handlers.onUpdated?.(u);
            close();
            openProfileModal(u, handlers);
        } catch (e) {
            showNotification(e.message || "Gagal link Google");
        }
    });

    modal.querySelector("#profile-save")?.addEventListener("click", async () => {
        const next = normalizeUsername(nameInput?.value);
        const err = validateUsername(next);
        if (err) {
            showNotification(err);
            return;
        }

        draftSound = !!modal.querySelector("#profile-sound")?.checked;
        draftMusic = !!modal.querySelector("#profile-music")?.checked;
        draftLang = modal.querySelector("#profile-lang")?.value || "id";

        const btn = modal.querySelector("#profile-save");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Saving…";
        }

        try {
            const a = auth;
            if (a?.currentUser) {
                await updateAuthProfile(a.currentUser, { displayName: next });
            }
            await update(ref(database, `players/${user.uid}/public`), {
                displayName: next,
                avatarId: draftAvatar
            });
            await update(ref(database, `players/${user.uid}/private/settings`), {
                sound: draftSound,
                music: draftMusic,
                language: draftLang
            });
            try {
                localStorage.setItem(
                    "cc_settings",
                    JSON.stringify({
                        sound: draftSound,
                        music: draftMusic,
                        language: draftLang
                    })
                );
            } catch (_) {}

            showNotification("Profile disimpan");
            handlers.onUpdated?.(a?.currentUser || user);
            close();
        } catch (e) {
            logger.error(e);
            showNotification(e.message || "Gagal simpan profile");
            if (btn) {
                btn.disabled = false;
                btn.textContent = "Save";
            }
        }
    });
}
