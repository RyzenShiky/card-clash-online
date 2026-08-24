/**
 * Friends system — add by UID or username, invite to room
 */
import {
    ref,
    get,
    set,
    update,
    remove,
    push,
    onValue,
    off,
    query,
    orderByChild,
    equalTo,
    limitToFirst,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

function normName(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

/**
 * Index username → uid (dipanggil saat save profile)
 */
export async function indexUsername(uid, displayName) {
    const key = normName(displayName);
    if (!key || key.length < 3) return;
    await set(ref(database, `usernames/${key}`), {
        uid,
        displayName: String(displayName).trim().slice(0, 32),
        updatedAt: Date.now()
    });
}

/**
 * Cari pemain by username atau UID
 */
export async function findPlayer(queryText) {
    const q = String(queryText || "").trim();
    if (!q) throw new Error("Masukkan username atau ID");

    // UID langsung (panjang Firebase UID biasanya 28)
    if (q.length >= 20 && !/\s/.test(q)) {
        const snap = await get(ref(database, `players/${q}/public`));
        if (snap.exists()) {
            return {
                uid: q,
                displayName: snap.val().displayName || q.slice(0, 8),
                avatarId: snap.val().avatarId || "default"
            };
        }
    }

    const key = normName(q);
    const idx = await get(ref(database, `usernames/${key}`));
    if (idx.exists()) {
        const { uid, displayName } = idx.val();
        const pub = await get(ref(database, `players/${uid}/public`));
        return {
            uid,
            displayName: pub.exists()
                ? pub.val().displayName || displayName
                : displayName || uid.slice(0, 8),
            avatarId: pub.exists() ? pub.val().avatarId || "default" : "default"
        };
    }

    // Fallback: scan tidak memungkinkan di client tanpa index —
    // coba exact path dengan berbagai casing sudah dinormalisasi
    throw new Error("Pemain tidak ditemukan. Cek username/ID.");
}

export async function addFriend(myUid, friendUid) {
    if (!myUid || !friendUid) throw new Error("UID tidak valid");
    if (myUid === friendUid) throw new Error("Tidak bisa add diri sendiri");

    const pubSnap = await get(ref(database, `players/${friendUid}/public`));
    if (!pubSnap.exists()) throw new Error("Pemain tidak ada");

    const name = pubSnap.val().displayName || friendUid.slice(0, 8);
    const avatarId = pubSnap.val().avatarId || "default";

    const myPub = await get(ref(database, `players/${myUid}/public`));
    const myName = myPub.exists()
        ? myPub.val().displayName || myUid.slice(0, 8)
        : myUid.slice(0, 8);

    // Mutual friendship (sederhana)
    await update(ref(database), {
        [`players/${myUid}/friends/${friendUid}`]: {
            uid: friendUid,
            displayName: name,
            avatarId,
            addedAt: Date.now()
        },
        [`players/${friendUid}/friends/${myUid}`]: {
            uid: myUid,
            displayName: myName,
            avatarId: myPub.exists() ? myPub.val().avatarId || "default" : "default",
            addedAt: Date.now()
        }
    });

    logger.info("[Friends] added", myUid, "↔", friendUid);
    return { uid: friendUid, displayName: name, avatarId };
}

export async function removeFriend(myUid, friendUid) {
    await update(ref(database), {
        [`players/${myUid}/friends/${friendUid}`]: null,
        [`players/${friendUid}/friends/${myUid}`]: null
    });
}

export async function listFriends(myUid) {
    const snap = await get(ref(database, `players/${myUid}/friends`));
    if (!snap.exists()) return [];
    return Object.values(snap.val()).sort((a, b) =>
        String(a.displayName || "").localeCompare(String(b.displayName || ""))
    );
}

export function subscribeFriends(myUid, cb) {
    const r = ref(database, `players/${myUid}/friends`);
    const h = (snap) => {
        if (!snap.exists()) {
            cb([]);
            return;
        }
        cb(Object.values(snap.val()));
    };
    onValue(r, h);
    return () => off(r, "value", h);
}

/**
 * Invite friend ke room (tanpa salin kode)
 */
export async function inviteFriendToRoom(fromUid, fromName, friendUid, roomId, roomCode) {
    if (!friendUid || !roomCode) throw new Error("Invite tidak lengkap");
    const inviteRef = push(ref(database, `players/${friendUid}/inbox`));
    await set(inviteRef, {
        type: "room_invite",
        fromUid,
        fromName: fromName || fromUid.slice(0, 8),
        roomId,
        roomCode,
        at: Date.now()
    });
    return inviteRef.key;
}

export function subscribeInbox(myUid, cb) {
    const r = ref(database, `players/${myUid}/inbox`);
    const h = (snap) => {
        if (!snap.exists()) {
            cb([]);
            return;
        }
        const list = Object.entries(snap.val()).map(([id, v]) => ({ id, ...v }));
        list.sort((a, b) => (b.at || 0) - (a.at || 0));
        cb(list);
    };
    onValue(r, h);
    return () => off(r, "value", h);
}

export async function dismissInboxItem(myUid, inviteId) {
    await remove(ref(database, `players/${myUid}/inbox/${inviteId}`));
}
