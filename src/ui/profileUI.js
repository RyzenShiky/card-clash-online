/**
 * Profile modal — view / edit displayName, stats, migrate guest→Google
 */
import { updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { ref, update, get } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { auth } from "../firebase/services.js";
import { getPlayerProfile } from "../auth/playerProfile.js";
import { isAnonymousUser } from "../auth/authManager.js";
import { secureAccountWithGoogle } from "../auth/accountLinking.js";
import { showNotification } from "./notificationUI.js";
import { logger } from "../utils/logger.js";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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
    const name =
        pub.displayName || user.displayName || `Guest_${user.uid.slice(0, 6)}`;
    const type = isAnonymousUser(user) ? "Guest" : "Google";
    const wins = stats.wins ?? 0;
    const losses = stats.losses ?? 0;
    const played = stats.matchesPlayed ?? 0;
    const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;
    const level = Math.max(1, Math.floor((wins * 2 + played) / 5) + 1);
    const ranked = profile?.ranked || {};
    const mmr = ranked.mmr ?? 1000;
    const tierName = String(ranked.tier || "professional").replace(/^\w/, (c) => c.toUpperCase());

    const modal = document.createElement("div");
    modal.id = "profile-modal";
    modal.className = "profile-modal-overlay";
    modal.innerHTML = `
      <div class="profile-modal-card">
        <header class="profile-modal-header">
          <h2>Profile</h2>
          <button type="button" class="btn btn-secondary profile-close" aria-label="Close">✕</button>
        </header>
        <div class="profile-modal-body">
          <div class="profile-identity">
            <div class="profile-avatar">${esc(name.slice(0, 1).toUpperCase())}</div>
            <div>
              <div class="profile-name">${esc(name)}</div>
              <div class="profile-meta">${type} · Lvl ${level} · ${esc(tierName)} ${mmr} · ID ${esc(user.uid.slice(0, 8))}</div>
            </div>
          </div>
          <label class="profile-field">
            <span>Username</span>
            <input id="profile-username" type="text" maxlength="24" value="${esc(name)}" />
          </label>
          <div class="profile-stats">
            <div><strong>${played}</strong><span>Matches</span></div>
            <div><strong>${wins}</strong><span>Wins</span></div>
            <div><strong>${losses}</strong><span>Losses</span></div>
            <div><strong>${winRate}%</strong><span>Win Rate</span></div>
            <div><strong>${stats.winStreak ?? 0}</strong><span>Streak</span></div>
            <div><strong>${stats.bestWinStreak ?? 0}</strong><span>Best</span></div>
          </div>
          ${
              isAnonymousUser(user)
                  ? `<button type="button" class="btn btn-accent" id="profile-link-google">Link Google (simpan progress)</button>`
                  : ""
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
        const input = modal.querySelector("#profile-username");
        let next = String(input?.value || "").trim().replace(/[\u0000-\u001F]/g, "");
        if (next.length < 3) {
            showNotification("Username minimal 3 karakter");
            return;
        }
        if (next.length > 24) next = next.slice(0, 24);

        const btn = modal.querySelector("#profile-save");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Saving...";
        }

        try {
            const a = auth;
            if (a?.currentUser) {
                await updateAuthProfile(a.currentUser, { displayName: next });
            }
            await update(ref(database, `players/${user.uid}/public`), {
                displayName: next
            });
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
