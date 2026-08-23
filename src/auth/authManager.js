/**
 * Authentication Manager
 * - Restore session jika sudah ada
 * - Guest (Anonymous) hanya atas permintaan user
 * - Google Sign-In via popup (+ siap fallback redirect)
 * - Link Anonymous → Google tanpa kehilangan data
 */
import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInAnonymously,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signOut,
    linkWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { auth } from "../firebase/services.js";
import { logger } from "../utils/logger.js";

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("profile");
googleProvider.addScope("email");
googleProvider.setCustomParameters({ prompt: "select_account" });

/**
 * Tunggu status auth sekali (restore session atau null).
 * Tidak auto sign-in anonymous.
 * @returns {Promise<import("firebase/auth").User|null>}
 */
export function waitForAuthState(timeoutMs = 6000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (user) => {
            if (done) return;
            done = true;
            try {
                unsubscribe();
            } catch (_) {}
            resolve(user);
        };
        const unsubscribe = onAuthStateChanged(auth, (user) => finish(user));
        // HP lambat / jaringan jelek: jangan stuck di "Memulai…" selamanya
        setTimeout(() => finish(auth.currentUser || null), timeoutMs);
    });
}

/**
 * Dengarkan perubahan auth secara continuous.
 * @param {(user: import("firebase/auth").User|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

/**
 * Sign-in sebagai Guest (Anonymous).
 * Hanya dipanggil dari tombol "Main sebagai Guest".
 */
export async function signInAsGuest() {
    logger.info("[Auth] Signing in as Guest...");
    const result = await signInAnonymously(auth);
    logger.info("[Auth] Guest ready:", result.user.uid);
    return result.user;
}

/**
 * Sign-in dengan Google (popup).
 */
export async function signInWithGoogle() {
    logger.info("[Auth] Google sign-in (popup)...");
    try {
        const result = await signInWithPopup(auth, googleProvider);
        logger.info("[Auth] Google ready:", result.user.uid);
        return result.user;
    } catch (error) {
        logger.error("[Auth] Google popup failed:", error.code, error.message);
        throw error;
    }
}

/**
 * Fallback Google via redirect (mobile / popup blocked).
 */
export async function signInWithGoogleRedirect() {
    logger.info("[Auth] Google sign-in (redirect)...");
    await signInWithRedirect(auth, googleProvider);
}

/**
 * Proses hasil redirect (panggil sekali di boot).
 * @returns {Promise<import("firebase/auth").User|null>}
 */
export async function handleGoogleRedirectResult() {
    try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
            logger.info("[Auth] Google redirect success:", result.user.uid);
            return result.user;
        }
        return null;
    } catch (error) {
        logger.error("[Auth] Google redirect error:", error.code, error.message);
        throw error;
    }
}

/**
 * Link akun Anonymous → Google (upgrade tanpa kehilangan data).
 * Harus dipanggil saat user masih anonymous.
 * @returns {Promise<import("firebase/auth").User>}
 */
export async function linkAnonymousToGoogle() {
    const user = auth.currentUser;
    if (!user) throw new Error("Tidak ada user yang login.");
    if (!user.isAnonymous) throw new Error("Akun sudah bukan Guest.");

    logger.info("[Auth] Linking anonymous → Google...");
    const result = await linkWithPopup(user, googleProvider);
    logger.info("[Auth] Link success:", result.user.uid);
    return result.user;
}

export async function logout() {
    logger.info("[Auth] Signing out...");
    await signOut(auth);
}

export function getCurrentUser() {
    return auth.currentUser;
}

/**
 * Apakah user saat ini anonymous (Guest).
 */
export function isAnonymousUser(user = auth.currentUser) {
    return user?.isAnonymous === true;
}
