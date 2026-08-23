/**
 * Guest → Google tanpa hilang rank / stats / penghargaan
 */
import {
    linkAnonymousToGoogle,
    isAnonymousUser,
    getCurrentUser
} from "./authManager.js";
import {
    updateAccountTypeAfterLink,
    mergeGuestDataIntoGoogleUid
} from "./playerProfile.js";
import { auth } from "../firebase/services.js";
import { logger } from "../utils/logger.js";
import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithCredential
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

export async function secureAccountWithGoogle() {
    const user = getCurrentUser();
    if (!user) throw new Error("Belum login.");
    if (!isAnonymousUser(user)) {
        throw new Error("Akun sudah terhubung ke Google / provider permanen.");
    }

    const guestUid = user.uid;

    try {
        const linkedUser = await linkAnonymousToGoogle();
        try {
            await updateAccountTypeAfterLink(linkedUser);
        } catch (e) {
            logger.warn("[Link] Profile after link:", e.message);
        }
        logger.info("[Link] Same UID preserved:", linkedUser.uid);
        return linkedUser;
    } catch (err) {
        const code = err?.code || "";
        if (
            code === "auth/credential-already-in-use" ||
            code === "auth/email-already-in-use"
        ) {
            return await mergeThenSignInGoogle(guestUid, err);
        }
        if (code === "auth/popup-closed-by-user") {
            throw new Error("Popup ditutup. Coba lagi.");
        }
        throw err;
    }
}

async function mergeThenSignInGoogle(guestUid, originalErr) {
    const provider = new GoogleAuthProvider();
    let credential = GoogleAuthProvider.credentialFromError(originalErr);

    let googleUser;
    if (credential) {
        const result = await signInWithCredential(auth, credential);
        googleUser = result.user;
    } else {
        const result = await signInWithPopup(auth, provider);
        googleUser = result.user;
    }

    if (googleUser.uid !== guestUid) {
        await mergeGuestDataIntoGoogleUid(guestUid, googleUser.uid);
    } else {
        await updateAccountTypeAfterLink(googleUser);
    }
    logger.info("[Link] Merged guest → Google", googleUser.uid);
    return googleUser;
}
