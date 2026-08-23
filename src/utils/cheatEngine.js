/**
 * Cheat "bahlil" — HANYA di luar input chat
 * Maksimal 1x per match (roomId)
 */
import { sfx } from "../audio/sfx.js";
import {
    ref,
    get,
    set,
    update
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";

let inputBuffer = "";
const SECRET = "bahlil";
let roomIdGetter = () => null;
let uidGetter = () => null;
/** @type {Set<string>} */
const usedInRoom = new Set();

export function initCheatEngine(options = {}) {
    if (options.getRoomId) roomIdGetter = options.getRoomId;
    if (options.getUid) uidGetter = options.getUid;

    window.addEventListener("keydown", (e) => {
        const t = e.target;
        if (!t) return;
        const tag = (t.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (t.isContentEditable) return;
        if (t.closest?.("#chat-input, .chat-input-box, .chat-container, [contenteditable=true]")) {
            return;
        }

        if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
            inputBuffer += e.key.toLowerCase();
            if (inputBuffer.length > SECRET.length * 2) {
                inputBuffer = inputBuffer.slice(-SECRET.length);
            }
            if (inputBuffer.endsWith(SECRET)) {
                inputBuffer = "";
                activateCheatMenu();
            }
        }
    });
}

async function activateCheatMenu() {
    const roomId = roomIdGetter();
    const uid = uidGetter();
    if (!roomId || !uid) {
        alert("Cheat hanya aktif saat di dalam match.");
        return;
    }
    if (usedInRoom.has(roomId)) {
        alert("Cheat sudah dipakai 1x di match ini.");
        return;
    }

    try {
        sfx.click();
    } catch (_) {}

    const action = prompt(
        "=== DEVELOPER MENU (1x / match) ===\n" +
            "1. X-Ray\n" +
            "2. Tambah +2\n" +
            "3. Tambah Wild +4\n" +
            "Pilih 1-3:"
    );
    if (!action) return;

    usedInRoom.add(roomId);

    if (action === "1") {
        document.body.classList.toggle("xray-on");
        alert(document.body.classList.contains("xray-on") ? "X-Ray ON" : "X-Ray OFF");
        return;
    }

    if (action === "2" || action === "3") {
        const isWd4 = action === "3";
        const card = {
            id: `cheat_${Date.now()}`,
            color: isWd4 ? null : "red",
            value: isWd4 ? "wild_draw4" : "draw2"
        };
        const handRefPath = ref(database, `rooms/${roomId}/hands/${uid}`);
        const snap = await get(handRefPath);
        const hand = snap.exists() ? snap.val() : [];
        hand.push(card);
        await set(handRefPath, hand);
        const cSnap = await get(ref(database, `rooms/${roomId}/game/handCounts`));
        const counts = cSnap.exists() ? cSnap.val() : {};
        counts[uid] = (counts[uid] || 0) + 1;
        await update(ref(database, `rooms/${roomId}/game`), {
            handCounts: counts,
            updatedAt: Date.now()
        });
        alert(isWd4 ? "+ Wild Draw 4" : "+ Draw 2");
    }
}

/** Reset saat leave room (opsional) */
export function resetCheatForRoom(roomId) {
    if (roomId) usedInRoom.delete(roomId);
}
