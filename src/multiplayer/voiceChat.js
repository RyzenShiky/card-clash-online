/**
 * Voice chat stub — siap Agora.
 * Set window.AGORA_APP_ID atau ganti APP_ID di bawah setelah daftar di console.agora.io
 *
 * CDN opsional di index.html:
 * <script src="https://download.agora.io/sdk/release/AgoraRTC_N.js"></script>
 */
const APP_ID = typeof window !== "undefined" ? window.AGORA_APP_ID || "" : "";

let client = null;
let localAudioTrack = null;
let joined = false;

export function isVoiceAvailable() {
    return typeof window !== "undefined" && !!window.AgoraRTC && !!APP_ID;
}

export async function joinVoiceChannel(roomId, uid) {
    if (!isVoiceAvailable()) {
        console.warn("[Voice] Agora SDK / APP_ID belum diset. Voice chat nonaktif.");
        return false;
    }
    try {
        client = window.AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        await client.join(APP_ID, String(roomId).slice(0, 64), null, null);
        localAudioTrack = await window.AgoraRTC.createMicrophoneAudioTrack();
        await client.publish([localAudioTrack]);
        client.on("user-published", async (user, mediaType) => {
            await client.subscribe(user, mediaType);
            if (mediaType === "audio" && user.audioTrack) {
                user.audioTrack.play();
            }
        });
        joined = true;
        console.log("[Voice] Connected to", roomId);
        return true;
    } catch (e) {
        console.error("[Voice] join failed", e);
        return false;
    }
}

export function toggleMuteMic(muted) {
    if (localAudioTrack) {
        localAudioTrack.setEnabled(!muted);
    }
}

export async function leaveVoiceChannel() {
    try {
        if (localAudioTrack) {
            localAudioTrack.close();
            localAudioTrack = null;
        }
        if (client && joined) {
            await client.leave();
        }
    } catch (_) {}
    client = null;
    joined = false;
}
