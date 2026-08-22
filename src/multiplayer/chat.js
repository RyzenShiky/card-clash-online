/**
 * Room text chat via Realtime Database
 */
import {
    ref,
    push,
    onChildAdded,
    off,
    serverTimestamp,
    query,
    limitToLast
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";

export function sendChatMessage(roomId, senderUid, senderName, text) {
    const msg = String(text || "").trim().slice(0, 100);
    if (!msg || !roomId) return Promise.resolve();
    return push(ref(database, `rooms/${roomId}/chat`), {
        uid: senderUid,
        sender: senderName || senderUid.slice(0, 8),
        text: msg,
        timestamp: serverTimestamp()
    });
}

/**
 * @returns {() => void} unsubscribe
 */
export function listenToChat(roomId, callback) {
    const chatRef = query(ref(database, `rooms/${roomId}/chat`), limitToLast(40));
    const handler = (snap) => {
        const v = snap.val();
        if (v) callback({ id: snap.key, ...v });
    };
    onChildAdded(chatRef, handler);
    return () => off(chatRef, "child_added", handler);
}
