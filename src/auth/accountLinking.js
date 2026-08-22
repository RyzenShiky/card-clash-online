/**
 * Account Linking
 * Upgrade Guest (Anonymous) → Google tanpa kehilangan UID & data.
 *
 * Jangan: signOut guest lalu buat akun Google baru.
 * Pakai: linkWithPopup / linkWithCredential.
 */
import { linkAnonymousToGoogle, isAnonymousUser, getCurrentUser } from "./authManager.js";
import { updateAccountTypeAfterLink } from "./playerProfile.js";
import { logger } from "../utils/logger.js";

/**
 * Secure My Account — link Google ke anonymous session saat ini.
 * @returns {Promise<import("firebase/auth").User>}
 */
export async function secureAccountWithGoogle() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error("Belum login.");
    }
    if (!isAnonymousUser(user)) {
        throw new Error("Akun sudah terhubung ke provider permanen.");
    }

    const linkedUser = await linkAnonymousToGoogle();

    // Update profil: accountType, displayName, photoURL dari Google
    try {
        await updateAccountTypeAfterLink(linkedUser);
    } catch (e) {
        logger.warn("[Link] Profile update after link failed (non-fatal):", e.message);
    }

    return linkedUser;
}
