/**
 * Room Code generator & lookup
 * Kode pendek (mis. K7XM92) — reservation via TRANSACTION agar anti race condition.
 */
import {
    ref,
    get,
    remove,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { database } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I,O,0,1
const CODE_LENGTH = 6;

function generateCode() {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return code;
}

/**
 * Reservasi kode unik secara atomik.
 * Transaction: hanya menulis jika node masih null.
 * @param {string} roomId
 * @returns {Promise<string>} roomCode
 */
export async function createRoomCode(roomId) {
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = generateCode();
        const codeRef = ref(database, `roomCodes/${code}`);

        const result = await runTransaction(codeRef, (current) => {
            // Sudah dipakai orang lain → abort (return undefined = abort)
            if (current !== null) {
                return;
            }
            // Reserve
            return {
                roomId,
                createdAt: Date.now()
            };
        });

        if (result.committed) {
            logger.info("[RoomCode] Reserved:", code, "→", roomId);
            return code;
        }
        // Konflik → coba kode lain
        logger.debug?.("[RoomCode] Collision on", code, "— retry");
    }

    throw new Error("Gagal membuat room code unik. Coba lagi.");
}

/**
 * Resolve roomCode → roomId
 * @param {string} code
 * @returns {Promise<string|null>}
 */
export async function resolveRoomCode(code) {
    const normalized = String(code).trim().toUpperCase();
    if (normalized.length !== CODE_LENGTH) return null;

    const snap = await get(ref(database, `roomCodes/${normalized}`));
    if (!snap.exists()) return null;

    return snap.val().roomId ?? null;
}

/**
 * Hapus mapping room code (saat room ditutup).
 * @param {string} code
 */
export async function deleteRoomCode(code) {
    if (!code) return;
    await remove(ref(database, `roomCodes/${String(code).toUpperCase()}`));
}
