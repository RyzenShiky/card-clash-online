/**
 * Chat — ketik "audio" (rahasia) membuka panel unggah MP3 BGM
 */
import { sendChatMessage, listenToChat } from "../multiplayer/chat.js";
import { openBgmSecretPanel } from "../audio/bgm.js";

let unsub = null;

export function mountChat(container, { roomId, uid, displayName }) {
    if (!container || !roomId) return () => {};

    const slot =
        container.querySelector("#chat-slot") ||
        document.getElementById("chat-slot") ||
        container;

    let panel = document.querySelector(".chat-container");
    if (panel) panel.remove();

    panel = document.createElement("div");
    panel.className = "chat-container";
    panel.innerHTML = `
      <div class="chat-header">
        <span>Chat</span>
        <span id="chat-toggle" style="font-size:0.7rem;opacity:0.8">▾</span>
      </div>
      <div id="chat-messages" class="chat-messages"></div>
      <div class="chat-input-box">
        <input type="text" id="chat-input" placeholder="Ketik pesan..." maxlength="120" autocomplete="off" />
        <button type="button" id="send-chat-btn" class="btn btn-primary">Kirim</button>
      </div>
    `;
    slot.appendChild(panel);

    const toggle = panel.querySelector("#chat-toggle");
    const header = panel.querySelector(".chat-header");
    header?.addEventListener("click", () => {
        panel.classList.toggle("collapsed");
        if (toggle) toggle.textContent = panel.classList.contains("collapsed") ? "▸" : "▾";
    });

    const messagesEl = panel.querySelector("#chat-messages");
    const input = panel.querySelector("#chat-input");
    const btn = panel.querySelector("#send-chat-btn");

    const append = (msg) => {
        if (!messagesEl || !msg?.text) return;
        const row = document.createElement("div");
        row.className = "chat-row" + (msg.uid === uid ? " me" : "");
        row.innerHTML = `<span class="chat-sender">${escapeHtml(
            msg.sender || "?"
        )}</span> ${escapeHtml(msg.text)}`;
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    if (unsub) {
        try {
            unsub();
        } catch (_) {}
    }
    unsub = listenToChat(roomId, append);

    const send = async () => {
        const text = (input?.value || "").trim();
        if (!text) return;

        // Secret: "audio" → panel BGM (tidak dikirim ke chat publik)
        const secret = text.toLowerCase().replace(/\s+/g, "");
        if (secret === "audio") {
            if (input) input.value = "";
            openBgmSecretPanel({ roomId, uid });
            return;
        }

        try {
            await sendChatMessage(
                roomId,
                uid,
                displayName || "Player",
                text.slice(0, 120)
            );
            if (input) input.value = "";
        } catch (e) {
            console.warn("[Chat] send failed", e);
        }
    };

    btn?.addEventListener("click", send);
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            send();
        }
    });

    return () => {
        try {
            unsub?.();
        } catch (_) {}
        unsub = null;
        panel?.remove();
    };
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
