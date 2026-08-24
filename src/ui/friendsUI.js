/**
 * Friends modal — UI rapi, username-first
 */
import {
    findPlayer,
    addFriend,
    removeFriend,
    subscribeFriends,
    inviteFriendToRoom,
    subscribeInbox,
    dismissInboxItem
} from "../multiplayer/friends.js";
import { getDisplayName } from "../auth/profileStore.js";
import { showNotification } from "./notificationUI.js";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function openFriendsModal(opts = {}) {
    const user = opts.user;
    if (!user?.uid) {
        showNotification("Login dulu");
        return;
    }

    let unsubFriends = null;
    let unsubInbox = null;

    document.getElementById("friends-modal")?.remove();

    const myName =
        getDisplayName(user.uid, null) ||
        user.displayName ||
        "Player";

    const modal = document.createElement("div");
    modal.id = "friends-modal";
    modal.className = "friends-overlay";
    modal.innerHTML = `
      <div class="friends-card" role="dialog" aria-label="Teman">
        <header class="friends-header">
          <div>
            <h2 class="friends-title">Teman</h2>
            <p class="friends-sub">Main bareng tanpa salin room code</p>
          </div>
          <button type="button" class="friends-x" id="friends-close" aria-label="Tutup">×</button>
        </header>

        <section class="friends-id-box">
          <div class="friends-id-label">Username kamu</div>
          <div class="friends-id-value">${esc(myName)}</div>
          <div class="friends-id-row">
            <span class="friends-id-uid" title="${esc(user.uid)}">ID: ${esc(user.uid.slice(0, 10))}…</span>
            <button type="button" class="friends-btn-ghost" id="friends-copy-id">Salin ID</button>
          </div>
        </section>

        <section class="friends-add-row">
          <input type="text" id="friends-search" class="friends-input"
            placeholder="Username atau ID pemain" maxlength="48" autocomplete="off" />
          <button type="button" class="friends-btn-primary" id="friends-add">Add</button>
        </section>

        <section class="friends-section">
          <h3 class="friends-section-title">Undangan</h3>
          <div id="friends-inbox" class="friends-list"></div>
        </section>

        <section class="friends-section">
          <h3 class="friends-section-title">Daftar teman</h3>
          <div id="friends-list" class="friends-list"></div>
        </section>

        ${
            opts.roomCode
                ? `<p class="friends-room-hint">Room aktif <strong>${esc(opts.roomCode)}</strong> — pakai Invite</p>`
                : ""
        }
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
        try {
            unsubFriends?.();
            unsubInbox?.();
        } catch (_) {}
        modal.remove();
    };
    modal.querySelector("#friends-close")?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });
    modal.querySelector("#friends-copy-id")?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(user.uid);
            showNotification("ID disalin");
        } catch (_) {
            showNotification(user.uid);
        }
    });

    const listEl = modal.querySelector("#friends-list");
    const inboxEl = modal.querySelector("#friends-inbox");

    const renderList = (friends) => {
        if (!listEl) return;
        if (!friends?.length) {
            listEl.innerHTML =
                '<p class="friends-empty">Belum ada teman. Tambah lewat username atau ID.</p>';
            return;
        }
        listEl.innerHTML = friends
            .map((f) => {
                const name = f.displayName || getDisplayName(f.uid, f.uid?.slice(0, 8));
                return `
          <div class="friends-row">
            <div class="friends-avatar">🎮</div>
            <div class="friends-meta">
              <div class="friends-name">${esc(name)}</div>
            </div>
            <div class="friends-actions">
              ${
                  opts.roomCode
                      ? `<button type="button" class="friends-btn-primary friends-invite" data-uid="${esc(f.uid)}">Invite</button>`
                      : ""
              }
              <button type="button" class="friends-btn-ghost friends-remove" data-uid="${esc(f.uid)}">Hapus</button>
            </div>
          </div>`;
            })
            .join("");

        listEl.querySelectorAll(".friends-invite").forEach((btn) => {
            btn.addEventListener("click", async () => {
                try {
                    await inviteFriendToRoom(
                        user.uid,
                        myName,
                        btn.getAttribute("data-uid"),
                        opts.roomId,
                        opts.roomCode
                    );
                    showNotification("Undangan terkirim");
                } catch (e) {
                    showNotification(e.message || "Gagal invite");
                }
            });
        });
        listEl.querySelectorAll(".friends-remove").forEach((btn) => {
            btn.addEventListener("click", async () => {
                try {
                    await removeFriend(user.uid, btn.getAttribute("data-uid"));
                    showNotification("Teman dihapus");
                } catch (e) {
                    showNotification(e.message || "Gagal hapus");
                }
            });
        });
    };

    const renderInbox = (items) => {
        if (!inboxEl) return;
        const invites = (items || []).filter((x) => x.type === "room_invite");
        if (!invites.length) {
            inboxEl.innerHTML = '<p class="friends-empty">Tidak ada undangan</p>';
            return;
        }
        inboxEl.innerHTML = invites
            .map(
                (inv) => `
          <div class="friends-row">
            <div class="friends-meta">
              <div class="friends-name">${esc(inv.fromName)}</div>
              <div class="friends-hint">Room ${esc(inv.roomCode)}</div>
            </div>
            <div class="friends-actions">
              <button type="button" class="friends-btn-primary friends-accept" data-id="${esc(inv.id)}" data-code="${esc(inv.roomCode)}">Join</button>
              <button type="button" class="friends-btn-ghost friends-dismiss" data-id="${esc(inv.id)}">×</button>
            </div>
          </div>`
            )
            .join("");

        inboxEl.querySelectorAll(".friends-accept").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const code = btn.getAttribute("data-code");
                const id = btn.getAttribute("data-id");
                try {
                    await dismissInboxItem(user.uid, id);
                } catch (_) {}
                close();
                opts.onJoinCode?.(code);
            });
        });
        inboxEl.querySelectorAll(".friends-dismiss").forEach((btn) => {
            btn.addEventListener("click", async () => {
                await dismissInboxItem(user.uid, btn.getAttribute("data-id"));
            });
        });
    };

    unsubFriends = subscribeFriends(user.uid, renderList);
    unsubInbox = subscribeInbox(user.uid, renderInbox);

    const doAdd = async () => {
        const q = modal.querySelector("#friends-search")?.value || "";
        try {
            const player = await findPlayer(q);
            await addFriend(user.uid, player.uid);
            showNotification(`Teman ditambah: ${player.displayName}`);
            modal.querySelector("#friends-search").value = "";
        } catch (e) {
            showNotification(e.message || "Gagal add");
        }
    };
    modal.querySelector("#friends-add")?.addEventListener("click", doAdd);
    modal.querySelector("#friends-search")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            doAdd();
        }
    });
}
