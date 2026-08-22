/**
 * Chat overlay widget
 */
import { sendChatMessage, listenToChat } from "../multiplayer/chat.js";

let unsub = null;

export function mountChat(container, { roomId, uid, displayName }) {
    if (!container || !roomId) return () => {};

    let panel = container.querySelector(".chat-container");
    if (!panel) {
        panel = document.createElement("div");
        panel.className = "chat-container";
        panel.innerHTML = `
          <div class="chat-header">Chat</div>
          <div id="chat-messages" class="chat-messages"></div>
          <div class="chat-input-box">
            <input type="text" id="chat-input" placeholder="Ketik pesan..." maxlength="100" autocomplete="off" />
            <button type="button" id="send-chat-btn" class="btn btn-primary">Kirim</button>
          </div>
        `;
        container.appendChild(panel);
    }

    const messagesEl = panel.querySelector("#chat-messages");
    const input = panel.querySelector("#chat-input");
    const btn = panel.querySelector("#send-chat-btn");

    const append = (msg) => {
        if (!messagesEl || !msg?.text) return;
        const row = document.createElement("div");
        row.className = "chat-row" + (msg.uid === uid ? " me" : "");
        row.innerHTML = `<span class="chat-sender">${escapeHtml(msg.sender || "?")}</span> ${escapeHtml(msg.text)}`;
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    if (unsub) unsub();
    unsub = listenToChat(roomId, append);

    const send = () => {
        const text = input?.value || "";
        if (!text.trim()) return;
        sendChatMessage(roomId, uid, displayName, text);
        if (input) input.value = "";
    };

    btn?.addEventListener("click", send);
    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            send();
        }
    });

    return () => {
        if (unsub) {
            unsub();
            unsub = null;
        }
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
