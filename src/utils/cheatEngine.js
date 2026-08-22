/**
 * Secret developer menu — ketik "bahlil" di keyboard (tanpa input focus)
 * Hanya untuk debug lokal; jangan andalkan di ranked production.
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

export function initCheatEngine(options = {}) {
    if (options.getRoomId) roomIdGetter = options.getRoomId;
    if (options.getUid) uidGetter = options.getUid;

    window.addEventListener("keydown", (e) => {
        const tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;

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
    try {
        sfx.click();
    } catch (_) {}

    const action = prompt(
        "=== DEVELOPER MENU ===\n" +
            "1. X-Ray: tampilkan jumlah + hint hand lawan\n" +
            "2. Tambah +2 ke tangan\n" +
            "3. Tambah Wild +4 ke tangan\n" +
            "Pilih 1-3:"
    );

    const roomId = roomIdGetter();
    const uid = uidGetter();
    if (!roomId || !uid) {
        alert("Cheat hanya aktif saat di dalam room/match.");
        return;
    }

    if (action === "1") {
        document.body.classList.toggle("xray-on");
        alert(
            document.body.classList.contains("xray-on")
                ? "X-Ray ON (lihat handCounts detail)"
                : "X-Ray OFF"
        );
        return;
    }

    if (action === "2" || action === "3") {
        const isWd4 = action === "3";
        const card = {
            id: `cheat_${Date.now()}`,
            color: isWd4 ? null : "red",
            value: isWd4 ? "wild_draw4" : "draw2"
        };
        const handRef = ref(database, `rooms/${roomId}/hands/${uid}`);
        const snap = await get(handRef);
        const hand = snap.exists() ? snap.val() : [];
        hand.push(card);
        await set(handRef, hand);
        const countRef = ref(database, `rooms/${roomId}/game/handCounts/${uid}`);
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
