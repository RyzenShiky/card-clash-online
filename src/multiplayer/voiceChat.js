/**
 * VoiceManager — signaling benar:
 * - fromSessionId (pengirim) + targetSessionId (penerima)
 * - JANGAN bandingkan session pengirim dengan session sendiri
 * - Mute = track.enabled
 * - Stream reuse lobby → in-game
 */
import {
    ref,
    set,
    push,
    onChildAdded,
    onValue,
    remove,
    off,
    serverTimestamp,
    update,
    get
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

const ICE = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
        // Production: tambah TURN di sini
    ]
};

const SIGNAL_TTL_MS = 60_000;

class VoiceManager {
    constructor() {
        this.state = "IDLE";
        this.localStream = null;
        this.muted = false;
        this.roomId = null;
        this.uid = null;
        this.sessionId = null;
        this.joinAttemptId = null;
        /** @type {Map<string, RTCPeerConnection>} */
        this.peers = new Map();
        /** @type {Map<string, string>} peerUid → sessionId */
        this.peerSessions = new Map();
        /** @type {Map<string, RTCIceCandidateInit[]>} */
        this.pendingIce = new Map();
        this.signalUnsub = null;
        this.membersUnsub = null;
        this.uiListeners = new Set();
        this.lastError = null;
        this._makingOffer = new Set();
    }

    onUi(cb) {
        this.uiListeners.add(cb);
        return () => this.uiListeners.delete(cb);
    }

    _emit() {
        const snap = this.getDebugSnapshot();
        for (const cb of this.uiListeners) {
            try {
                cb(snap);
            } catch (_) {}
        }
        // Hanya tombol mute, bukan unlock-audio
        document.querySelectorAll("#btn-mic, .voice-mute-button").forEach((btn) => {
            const muted = this.muted;
            const can =
                this.state === "CONNECTED" ||
                this.state === "MUTED" ||
                this.state === "READY" ||
                this.state === "CONNECTING";
            btn.textContent = muted ? "🔇 Unmute" : "🎙️ Mic";
            btn.classList.toggle("muted", muted);
            btn.disabled = !can;
        });
    }

    _setState(s) {
        this.state = s;
        this._emit();
        logger.info("[Voice] state →", s);
    }

    _refreshConnectionState() {
        if (this.state === "LEAVING" || this.state === "IDLE" || this.state === "FAILED") {
            return;
        }
        if (!this.peers.size) {
            this._setState(this.muted ? "MUTED" : "READY");
            return;
        }
        let anyConnected = false;
        let anyConnecting = false;
        let allFailed = true;
        for (const pc of this.peers.values()) {
            const st = pc.connectionState;
            if (st === "connected") {
                anyConnected = true;
                allFailed = false;
            } else if (st === "connecting" || st === "new") {
                anyConnecting = true;
                allFailed = false;
            } else if (st !== "failed" && st !== "closed" && st !== "disconnected") {
                allFailed = false;
            }
        }
        if (anyConnected) {
            this._setState(this.muted ? "MUTED" : "CONNECTED");
        } else if (anyConnecting) {
            this._setState("CONNECTING");
        } else if (allFailed && this.peers.size) {
            this._setState("FAILED");
        }
    }

    isAvailable() {
        return (
            typeof RTCPeerConnection !== "undefined" &&
            !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
        );
    }

    async join(roomId, uid) {
        if (!this.isAvailable()) {
            this.lastError = "WebRTC tidak tersedia";
            this._setState("FAILED");
            return false;
        }

        if (
            this.roomId === roomId &&
            this.uid === uid &&
            this.localStream &&
            this._tracksLive()
        ) {
            await this._publishMember();
            this._refreshConnectionState();
            return true;
        }

        if (this.roomId && this.roomId !== roomId) {
            await this._leavePeersOnly();
        }

        this.roomId = roomId;
        this.uid = uid;
        const attempt = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.joinAttemptId = attempt;
        this.sessionId = `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        try {
            if (!this.localStream || !this._tracksLive()) {
                this._setState("REQUESTING_MIC");
                await this._acquireMic();
            }
        } catch (e) {
            this.lastError = this._mapMicError(e);
            this._setState("FAILED");
            return false;
        }

        if (this.joinAttemptId !== attempt) return false;

        this._setState("READY");
        await this._publishMember();
        this._wireSignaling(attempt);
        this._applyMuteToTracks();
        this._setState(this.muted ? "MUTED" : "CONNECTING");
        return true;
    }

    async _acquireMic() {
        if (!window.isSecureContext && location.hostname !== "localhost") {
            throw Object.assign(new Error("Voice membutuhkan HTTPS"), {
                name: "SecurityError"
            });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false
        });
        const tracks = stream.getAudioTracks();
        if (!tracks.length || tracks[0].readyState !== "live") {
            stream.getTracks().forEach((t) => t.stop());
            throw Object.assign(new Error("Mic track tidak live"), {
                name: "NotReadableError"
            });
        }
        if (this.localStream && this.localStream !== stream) {
            this.localStream.getTracks().forEach((t) => t.stop());
        }
        this.localStream = stream;
    }

    _mapMicError(e) {
        const n = e?.name || "";
        if (n === "NotAllowedError" || n === "PermissionDeniedError") {
            return "Izin microphone ditolak";
        }
        if (n === "NotFoundError") return "Microphone tidak ditemukan";
        if (n === "NotReadableError") return "Microphone sedang dipakai aplikasi lain";
        if (n === "SecurityError") return "Voice harus memakai HTTPS";
        return e?.message || "Mic gagal";
    }

    _tracksLive() {
        return (this.localStream?.getAudioTracks?.() || []).some(
            (t) => t.readyState === "live"
        );
    }

    _applyMuteToTracks() {
        for (const track of this.localStream?.getAudioTracks?.() || []) {
            if (track.readyState === "live") track.enabled = !this.muted;
        }
        for (const pc of this.peers.values()) {
            for (const sender of pc.getSenders()) {
                if (sender.track?.kind === "audio" && sender.track.readyState === "live") {
                    sender.track.enabled = !this.muted;
                }
            }
        }
    }

    setMuted(muted) {
        this.muted = !!muted;
        this._applyMuteToTracks();
        this._refreshConnectionState();
        if (this.roomId && this.uid) {
            update(ref(database, `rooms/${this.roomId}/voice/members/${this.uid}`), {
                muted: this.muted
            }).catch(() => {});
        }
        this._emit();
        return this.muted;
    }

    toggleMute() {
        return this.setMuted(!this.muted);
    }

    async _publishMember() {
        if (!this.roomId || !this.uid || !this.sessionId) return;
        await set(ref(database, `rooms/${this.roomId}/voice/members/${this.uid}`), {
            uid: this.uid,
            sessionId: this.sessionId,
            muted: this.muted,
            joinedAt: serverTimestamp()
        });
    }

    _wireSignaling(attempt) {
        this._unsubSignals();
        const uid = this.uid;
        const roomId = this.roomId;

        const sigRef = ref(database, `rooms/${roomId}/voice/signals/${uid}`);
        const onSig = async (snap) => {
            if (this.joinAttemptId !== attempt) return;
            const data = snap.val();
            if (!data) return;

            const now = Date.now();
            const created = typeof data.createdAt === "number" ? data.createdAt : now;
            const expired =
                data.expiresAt && Number(data.expiresAt) < now
                    ? true
                    : now - created > SIGNAL_TTL_MS;

            // Target harus kita
            if (data.toUid && data.toUid !== uid) {
                return; // bukan untuk kita — jangan hapus (path sudah per-uid)
            }

            // Validasi session PENERIMA (bukan pengirim!)
            if (data.targetSessionId && data.targetSessionId !== this.sessionId) {
                // Signal untuk session lama kita — hapus hanya jika expired
                if (expired) {
                    try {
                        await remove(snap.ref);
                    } catch (_) {}
                }
                return;
            }

            try {
                await this._handleSignal(data);
            } catch (e) {
                logger.warn("[Voice] signal handle", e?.name, e?.message);
            }
            try {
                await remove(snap.ref);
            } catch (_) {}
        };
        onChildAdded(sigRef, onSig);
        this.signalUnsub = () => off(sigRef, "child_added", onSig);

        const memRef = ref(database, `rooms/${roomId}/voice/members`);
        const onMem = async (snap) => {
            if (this.joinAttemptId !== attempt) return;
            const members = snap.val() || {};
            for (const [peerUid, info] of Object.entries(members)) {
                if (peerUid === uid) continue;
                if (info?.sessionId) {
                    this.peerSessions.set(peerUid, info.sessionId);
                }
                if (this.peers.has(peerUid)) continue;
                // Lexicographic: lower uid offers (hindari glare)
                if (uid < peerUid) {
                    try {
                        await this._createOffer(peerUid, false);
                    } catch (e) {
                        logger.warn("[Voice] offer", peerUid, e.message);
                    }
                }
            }
            // Peer yang leave
            for (const peerUid of [...this.peers.keys()]) {
                if (!members[peerUid]) {
                    this._closePeer(peerUid);
                }
            }
            this._refreshConnectionState();
        };
        onValue(memRef, onMem);
        this.membersUnsub = () => off(memRef);
    }

    _unsubSignals() {
        try {
            this.signalUnsub?.();
            this.membersUnsub?.();
        } catch (_) {}
        this.signalUnsub = null;
        this.membersUnsub = null;
    }

    /**
     * Kirim signal dengan fromSessionId + targetSessionId yang benar
     */
    async _sendSignal(toUid, payload) {
        if (!this.roomId || !this.sessionId || !this.uid) return;

        // Ambil session peer (cache atau fetch)
        let targetSessionId = this.peerSessions.get(toUid);
        if (!targetSessionId) {
            try {
                const snap = await get(
                    ref(database, `rooms/${this.roomId}/voice/members/${toUid}/sessionId`)
                );
                if (snap.exists()) {
                    targetSessionId = snap.val();
                    this.peerSessions.set(toUid, targetSessionId);
                }
            } catch (_) {}
        }
        if (!targetSessionId) {
            logger.warn("[Voice] no targetSessionId for", toUid, "— skip signal");
            return;
        }

        const now = Date.now();
        await push(ref(database, `rooms/${this.roomId}/voice/signals/${toUid}`), {
            fromUid: this.uid,
            toUid,
            fromSessionId: this.sessionId,
            targetSessionId,
            type: payload.type,
            sdp: payload.sdp || null,
            candidate: payload.candidate || null,
            createdAt: now,
            expiresAt: now + SIGNAL_TTL_MS
        });
    }

    async _ensurePc(peerUid) {
        if (this.peers.has(peerUid)) return this.peers.get(peerUid);
        const pc = new RTCPeerConnection(ICE);
        this.peers.set(peerUid, pc);
        this.pendingIce.set(peerUid, []);

        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) {
                pc.addTrack(track, this.localStream);
            }
        }

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                this._sendSignal(peerUid, {
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
                document.body.appendChild(audio);
            }
            audio.srcObject = ev.streams[0];
            audio.play().catch(() => this._showUnlockAudio());
        };

        pc.onconnectionstatechange = () => {
            logger.info("[Voice] pc", peerUid, pc.connectionState);
            if (pc.connectionState === "failed") {
                this._recoverPeer(peerUid).catch((e) =>
                    logger.warn("[Voice] recover failed", e.message)
                );
            }
            this._refreshConnectionState();
        };

        pc.onnegotiationneeded = () => {
            // Dihindari auto-offer ganda; recovery handle iceRestart
        };

        return pc;
    }

    async _recoverPeer(peerUid) {
        if (this.uid > peerUid) return; // only lower uid restarts
        logger.info("[Voice] ICE restart →", peerUid);
        await this._createOffer(peerUid, true);
    }

    async _flushIce(peerUid, pc) {
        const q = this.pendingIce.get(peerUid) || [];
        this.pendingIce.set(peerUid, []);
        for (const c of q) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
                logger.warn("[Voice] ICE add", peerUid, e?.message);
            }
        }
    }

    async _createOffer(peerUid, iceRestart = false) {
        if (this._makingOffer.has(peerUid)) return;
        this._makingOffer.add(peerUid);
        try {
            const pc = await this._ensurePc(peerUid);
            const offer = await pc.createOffer(
                iceRestart ? { iceRestart: true } : undefined
            );
            await pc.setLocalDescription(offer);
            await this._sendSignal(peerUid, { type: "offer", sdp: offer.sdp });
        } finally {
            this._makingOffer.delete(peerUid);
        }
    }

    async _handleSignal(data) {
        const from = data.fromUid || data.from;
        if (!from || from === this.uid) return;

        // Track peer session from signal
        if (data.fromSessionId) {
            this.peerSessions.set(from, data.fromSessionId);
        }

        if (data.type === "offer" && data.sdp) {
            const pc = await this._ensurePc(from);
            // Glare: if we also have local offer, polite peer yields
            const polite = this.uid > from;
            if (pc.signalingState !== "stable" && !polite) {
                logger.info("[Voice] glare — ignore offer (impolite)");
                return;
            }
            await pc.setRemoteDescription(
                new RTCSessionDescription({ type: "offer", sdp: data.sdp })
            );
            await this._flushIce(from, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this._sendSignal(from, { type: "answer", sdp: answer.sdp });
            return;
        }

        if (data.type === "answer" && data.sdp) {
            const pc = this.peers.get(from);
            if (!pc) return;
            if (pc.signalingState !== "have-local-offer") {
                logger.warn("[Voice] unexpected answer in", pc.signalingState);
                return;
            }
            await pc.setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: data.sdp })
            );
            await this._flushIce(from, pc);
            return;
        }

        if (data.type === "ice" && data.candidate) {
            const pc = this.peers.get(from);
            if (!pc || !pc.remoteDescription) {
                const q = this.pendingIce.get(from) || [];
                q.push(data.candidate);
                this.pendingIce.set(from, q);
                return;
            }
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                logger.warn("[Voice] ICE late", from, e?.message);
            }
        }
    }

    _closePeer(peerUid) {
        const pc = this.peers.get(peerUid);
        if (pc) {
            try {
                pc.close();
            } catch (_) {}
            this.peers.delete(peerUid);
        }
        this.pendingIce.delete(peerUid);
        this.peerSessions.delete(peerUid);
        document.getElementById(`voice-audio-${peerUid}`)?.remove();
    }

    _showUnlockAudio() {
        if (document.getElementById("voice-unlock-btn")) return;
        const btn = document.createElement("button");
        btn.id = "voice-unlock-btn";
        btn.className = "btn btn-accent voice-unlock-audio-button";
        btn.style.cssText = "position:fixed;top:52px;left:12px;z-index:50";
        btn.textContent = "🔊 Aktifkan suara";
        btn.onclick = () => {
            document.querySelectorAll("audio[id^='voice-audio-']").forEach((a) => {
                a.play().catch(() => {});
            });
            btn.remove();
        };
        document.body.appendChild(btn);
    }

    async _leavePeersOnly() {
        this._unsubSignals();
        for (const uid of [...this.peers.keys()]) {
            this._closePeer(uid);
        }
        this.peerSessions.clear();
        if (this.roomId && this.uid) {
            try {
                await remove(ref(database, `rooms/${this.roomId}/voice/members/${this.uid}`));
            } catch (_) {}
        }
    }

    async leave() {
        this._setState("LEAVING");
        this.joinAttemptId = null;
        await this._leavePeersOnly();
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }
        this.roomId = null;
        this.uid = null;
        this.sessionId = null;
        this.muted = false;
        document.getElementById("voice-unlock-btn")?.remove();
        this._setState("IDLE");
    }

    getDebugSnapshot() {
        const tracks = this.localStream?.getAudioTracks?.() || [];
        const t0 = tracks[0];
        const peerStates = {};
        for (const [uid, pc] of this.peers) {
            peerStates[uid] = {
                connection: pc.connectionState,
                ice: pc.iceConnectionState,
                signaling: pc.signalingState
            };
        }
        return {
            state: this.state,
            muted: this.muted,
            sessionId: this.sessionId,
            lastError: this.lastError,
            trackReady: t0?.readyState || "none",
            trackEnabled: t0 ? t0.enabled : null,
            peers: peerStates
        };
    }
}

export const voiceManager = new VoiceManager();

export function isVoiceAvailable() {
    return voiceManager.isAvailable();
}

export async function joinVoiceChannel(roomId, uid) {
    return voiceManager.join(roomId, uid);
}

export function toggleMuteMic(isMuted) {
    if (typeof isMuted === "boolean") return voiceManager.setMuted(isMuted);
    return voiceManager.toggleMute();
}

export function setMuted(muted) {
    return voiceManager.setMuted(muted);
}

export async function leaveVoiceChannel() {
    return voiceManager.leave();
}

export function getVoiceDebug() {
    return voiceManager.getDebugSnapshot();
}
