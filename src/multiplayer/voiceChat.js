/**
 * WebRTC voice — signaling via RTDB
 * Fixes: pending ICE queue, push() keys, sessionId, connection state, play() unlock
 */
import {
    ref,
    set,
    push,
    onChildAdded,
    onValue,
    remove,
    off,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

const ICE = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
        // Production: tambah TURN server di sini
    ]
};

let localStream = null;
let roomIdActive = null;
let myUid = null;
let sessionId = null;
let joinAttemptId = null;
/** @type {Map<string, RTCPeerConnection>} */
const peers = new Map();
/** @type {Map<string, RTCIceCandidateInit[]>} */
const pendingIce = new Map();
let signalUnsub = null;
let membersUnsub = null;
let disposed = false;

function voiceRoot(roomId) {
    return ref(database, `rooms/${roomId}/voice`);
}

function isAttemptValid(id) {
    return !disposed && joinAttemptId === id && sessionId;
}

export function isVoiceAvailable() {
    return typeof RTCPeerConnection !== "undefined" && !!(navigator.mediaDevices?.getUserMedia);
}

export async function joinVoiceChannel(roomId, uid) {
    if (!isVoiceAvailable()) {
        logger.warn("[Voice] WebRTC tidak tersedia");
        return false;
    }
    disposed = false;
    const attempt = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    joinAttemptId = attempt;
    sessionId = `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    roomIdActive = roomId;
    myUid = uid;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });
    } catch (e) {
        logger.error("[Voice] getUserMedia failed", e);
        return false;
    }
    if (!isAttemptValid(attempt)) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
        return false;
    }

    // Register member
    await set(ref(database, `rooms/${roomId}/voice/members/${uid}`), {
        uid,
        sessionId,
        joinedAt: serverTimestamp()
    });

    // Listen signals targeted to me
    const sigRef = ref(database, `rooms/${roomId}/voice/signals/${uid}`);
    const onSig = async (snap) => {
        if (!isAttemptValid(attempt)) return;
        const data = snap.val();
        if (!data || data.sessionId !== sessionId) {
            // stale session — delete signal
            try {
                await remove(snap.ref);
            } catch (_) {}
            return;
        }
        try {
            await handleSignal(data);
        } catch (e) {
            logger.warn("[Voice] signal handle error", e?.name, e?.message);
        }
        try {
            await remove(snap.ref);
        } catch (_) {}
    };
    onChildAdded(sigRef, onSig);
    signalUnsub = () => off(sigRef, "child_added", onSig);

    // Existing + new members
    const memRef = ref(database, `rooms/${roomId}/voice/members`);
    const onMem = async (snap) => {
        if (!isAttemptValid(attempt)) return;
        const members = snap.val() || {};
        for (const peerUid of Object.keys(members)) {
            if (peerUid === uid) continue;
            if (peers.has(peerUid)) continue;
            // Lower uid initiates offer to avoid glare
            if (uid < peerUid) {
                try {
                    await createOffer(peerUid);
                } catch (e) {
                    logger.warn("[Voice] offer failed", peerUid, e.message);
                }
            }
        }
    };
    onValue(memRef, onMem);
    membersUnsub = () => off(memRef);

    logger.info("[Voice] joined session", sessionId);
    return true;
}

async function sendSignal(toUid, payload) {
    if (!roomIdActive || !sessionId) return;
    const r = ref(database, `rooms/${roomIdActive}/voice/signals/${toUid}`);
    await push(r, {
        ...payload,
        from: myUid,
        sessionId,
        createdAt: serverTimestamp()
    });
}

async function ensurePc(peerUid) {
    if (peers.has(peerUid)) return peers.get(peerUid);
    const pc = new RTCPeerConnection(ICE);
    peers.set(peerUid, pc);
    pendingIce.set(peerUid, []);

    if (localStream) {
        localStream.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });
    }

    pc.onicecandidate = (ev) => {
        if (ev.candidate) {
            sendSignal(peerUid, {
                type: "ice",
                candidate: ev.candidate.toJSON()
            }).catch(() => {});
        }
    };

    pc.ontrack = (ev) => {
        let audio = document.getElementById(`voice-audio-${peerUid}`);
        if (!audio) {
            audio = document.createElement("audio");
            audio.id = `voice-audio-${peerUid}`;
            audio.autoplay = true;
            audio.playsInline = true;
            audio.setAttribute("playsinline", "true");
            document.body.appendChild(audio);
        }
        audio.srcObject = ev.streams[0];
        audio.play().catch(() => {
            logger.warn("[Voice] autoplay blocked — user gesture needed");
            showUnlockAudio();
        });
    };

    pc.onconnectionstatechange = () => {
        logger.info("[Voice] pc", peerUid, "state=", pc.connectionState);
        if (pc.connectionState === "failed") {
            try {
                pc.restartIce();
            } catch (_) {}
        }
    };

    pc.oniceconnectionstatechange = () => {
        logger.info("[Voice] ice", peerUid, pc.iceConnectionState);
    };

    return pc;
}

async function flushPendingIce(peerUid, pc) {
    const queue = pendingIce.get(peerUid) || [];
    pendingIce.set(peerUid, []);
    for (const c of queue) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
            logger.warn(
                "[Voice] addIceCandidate failed",
                peerUid,
                pc.signalingState,
                e?.name,
                e?.message
            );
        }
    }
}

async function createOffer(peerUid) {
    const pc = await ensurePc(peerUid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal(peerUid, {
        type: "offer",
        sdp: offer.sdp
    });
}

async function handleSignal(data) {
    const from = data.from;
    if (!from || from === myUid) return;

    if (data.type === "offer" && data.sdp) {
        const pc = await ensurePc(from);
        await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp: data.sdp })
        );
        await flushPendingIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(from, { type: "answer", sdp: answer.sdp });
        return;
    }

    if (data.type === "answer" && data.sdp) {
        const pc = peers.get(from);
        if (!pc) return;
        await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: data.sdp })
        );
        await flushPendingIce(from, pc);
        return;
    }

    if (data.type === "ice" && data.candidate) {
        const pc = peers.get(from);
        if (!pc || !pc.remoteDescription) {
            const q = pendingIce.get(from) || [];
            q.push(data.candidate);
            pendingIce.set(from, q);
            return;
        }
        try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            logger.warn(
                "[Voice] addIceCandidate failed",
                from,
                pc.connectionState,
                pc.signalingState,
                e?.name,
                e?.message
            );
        }
    }
}

function showUnlockAudio() {
    if (document.getElementById("voice-unlock-btn")) return;
    const btn = document.createElement("button");
    btn.id = "voice-unlock-btn";
    btn.className = "btn btn-accent btn-mic";
    btn.textContent = "🔊 Aktifkan suara";
    btn.style.top = "52px";
    btn.onclick = () => {
        document.querySelectorAll("audio[id^='voice-audio-']").forEach((a) => {
            a.play().catch(() => {});
        });
        btn.remove();
    };
    document.body.appendChild(btn);
}

export function toggleMuteMic(muted) {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
    });
}

export async function leaveVoiceChannel() {
    disposed = true;
    joinAttemptId = null;
    try {
        signalUnsub?.();
        membersUnsub?.();
    } catch (_) {}
    signalUnsub = null;
    membersUnsub = null;

    for (const [uid, pc] of peers) {
        try {
            pc.close();
        } catch (_) {}
        document.getElementById(`voice-audio-${uid}`)?.remove();
    }
    peers.clear();
    pendingIce.clear();

    if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
    }

    if (roomIdActive && myUid) {
        try {
            await remove(ref(database, `rooms/${roomIdActive}/voice/members/${myUid}`));
        } catch (_) {}
    }
    roomIdActive = null;
    myUid = null;
    sessionId = null;
    document.getElementById("voice-unlock-btn")?.remove();
}
