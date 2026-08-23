/**
 * Voice chat — WebRTC mesh via Firebase RTDB signaling (tanpa Agora).
 * Non-blocking: gagal mic / permission tidak menahan game start.
 */
import {
    ref,
    set,
    onChildAdded,
    onChildRemoved,
    remove,
    off
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

let localStream = null;
let muted = false;
let roomIdActive = null;
let myUid = null;
/** @type {Map<string, RTCPeerConnection>} */
const peers = new Map();
const unsubs = [];

const ICE = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

export function isVoiceAvailable() {
    return (
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof RTCPeerConnection !== "undefined"
    );
}

function signalPath(roomId) {
    return `rooms/${roomId}/voice`;
}

/**
 * Join voice — fire-and-forget safe. Max timeout 4s agar tidak gantung start game.
 */
export async function joinVoiceChannel(roomId, uid) {
    if (!isVoiceAvailable()) {
        logger.info("[Voice] WebRTC tidak tersedia di browser ini");
        return false;
    }
    if (roomIdActive === roomId && myUid === uid) return true;

    await leaveVoiceChannel().catch(() => {});

    roomIdActive = roomId;
    myUid = uid;

    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 4000));
    const work = doJoin(roomId, uid);
    const result = await Promise.race([work, timeout]);
    if (result === "timeout") {
        logger.warn("[Voice] join timeout — game lanjut tanpa voice");
        return false;
    }
    return !!result;
}

async function doJoin(roomId, uid) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
    } catch (e) {
        logger.warn("[Voice] mic ditolak / error:", e.message);
        return false;
    }

    // Presence di channel voice
    const meRef = ref(database, `${signalPath(roomId)}/members/${uid}`);
    await set(meRef, { uid, joinedAt: Date.now() });

    const membersRef = ref(database, `${signalPath(roomId)}/members`);
    const onMember = onChildAdded(membersRef, async (snap) => {
        const peerUid = snap.key;
        if (!peerUid || peerUid === uid) return;
        // Hanya satu sisi yang offer (uid lebih kecil)
        if (uid < peerUid) {
            await createOffer(roomId, uid, peerUid);
        }
    });
    unsubs.push(() => off(membersRef, "child_added", onMember));

    const signalsRef = ref(database, `${signalPath(roomId)}/signals/${uid}`);
    const onSignal = onChildAdded(signalsRef, async (snap) => {
        const data = snap.val();
        if (!data) return;
        try {
            await handleSignal(roomId, uid, data);
        } catch (e) {
            logger.warn("[Voice] signal:", e.message);
        }
        remove(snap.ref).catch(() => {});
    });
    unsubs.push(() => off(signalsRef, "child_added", onSignal));

    logger.info("[Voice] WebRTC joined", roomId);
    return true;
}

async function createOffer(roomId, fromUid, toUid) {
    if (peers.has(toUid)) return;
    const pc = new RTCPeerConnection(ICE);
    peers.set(toUid, pc);
    wirePc(pc, roomId, fromUid, toUid);

    (localStream?.getTracks() || []).forEach((t) => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await set(ref(database, `${signalPath(roomId)}/signals/${toUid}/${Date.now()}`), {
        type: "offer",
        from: fromUid,
        sdp: offer
    });
}

async function handleSignal(roomId, myId, data) {
    const from = data.from;
    if (!from || from === myId) return;

    if (data.type === "offer") {
        let pc = peers.get(from);
        if (!pc) {
            pc = new RTCPeerConnection(ICE);
            peers.set(from, pc);
            wirePc(pc, roomId, myId, from);
            (localStream?.getTracks() || []).forEach((t) => pc.addTrack(t, localStream));
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await set(ref(database, `${signalPath(roomId)}/signals/${from}/${Date.now()}`), {
            type: "answer",
            from: myId,
            sdp: answer
        });
    } else if (data.type === "answer") {
        const pc = peers.get(from);
        if (pc && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
    } else if (data.type === "ice" && data.candidate) {
        const pc = peers.get(from);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (_) {}
        }
    }
}

function wirePc(pc, roomId, myId, peerUid) {
    pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        set(ref(database, `${signalPath(roomId)}/signals/${peerUid}/${Date.now()}`), {
            type: "ice",
            from: myId,
            candidate: ev.candidate.toJSON()
        }).catch(() => {});
    };
    pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        let audio = document.getElementById(`voice-audio-${peerUid}`);
        if (!audio) {
            audio = document.createElement("audio");
            audio.id = `voice-audio-${peerUid}`;
            audio.autoplay = true;
            audio.playsInline = true;
            audio.style.display = "none";
            document.body.appendChild(audio);
        }
        audio.srcObject = stream;
    };
}

export function toggleMuteMic(wantMuted) {
    muted = !!wantMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach((t) => {
            t.enabled = !muted;
        });
    }
}

export async function leaveVoiceChannel() {
    unsubs.splice(0).forEach((u) => {
        try {
            u();
        } catch (_) {}
    });
    for (const [, pc] of peers) {
        try {
            pc.close();
        } catch (_) {}
    }
    peers.clear();
    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }
    document.querySelectorAll("[id^=voice-audio-]").forEach((el) => el.remove());
    if (roomIdActive && myUid) {
        try {
            await remove(ref(database, `${signalPath(roomIdActive)}/members/${myUid}`));
        } catch (_) {}
    }
    roomIdActive = null;
    myUid = null;
    muted = false;
}
