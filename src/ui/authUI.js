/**
 * Auth UI — Login Screen
 * Tanggung jawab: tampilan saja. Logic auth di authManager.
 */
import {
    signInAsGuest,
    signInWithGoogle,
    signInWithGoogleRedirect
} from "../auth/authManager.js";
import { logger } from "../utils/logger.js";

let rootEl = null;

/**
 * Tampilkan layar login.
 * @param {{ onAuthenticated: (user) => void }} options
 */
export function showAuthScreen(options = {}) {
    const { onAuthenticated } = options;

    // Pastikan container ada
    let container = document.getElementById("auth-screen");
    if (!container) {
        container = document.createElement("div");
        container.id = "auth-screen";
        container.className = "screen";
        document.getElementById("app")?.appendChild(container);
    }

    rootEl = container;
    container.classList.remove("hidden");
    container.style.display = "flex";

    // Sembunyikan screen lain
    ["loading-screen", "menu-screen", "lobby-screen", "game-screen"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add("hidden");
            if (id === "loading-screen") el.style.display = "none";
        }
    });

    container.innerHTML = `
        <div class="auth-card">
            <h1 class="menu-title">Card Clash</h1>
            <p class="menu-subtitle">Masuk untuk bermain</p>

            <div class="menu-actions" style="margin-top: 1.5rem">
                <button class="btn btn-primary" id="btn-google" type="button">
                    <span class="auth-icon">G</span> Masuk dengan Google
                </button>
                <button class="btn btn-secondary" id="btn-guest" type="button">
                    Main sebagai Guest
                </button>
            </div>

            <p class="auth-hint text-muted">
                Guest bisa di-upgrade ke Google nanti tanpa kehilangan progress.
            </p>

            <div id="auth-error" class="auth-error hidden"></div>
            <div id="auth-loading" class="auth-loading hidden">
                <div class="loader" style="width:32px;height:32px;border-width:3px"></div>
                <span>Memproses...</span>
            </div>
        </div>
    `;

    const btnGoogle = container.querySelector("#btn-google");
    const btnGuest = container.querySelector("#btn-guest");
    const errorEl = container.querySelector("#auth-error");
    const loadingEl = container.querySelector("#auth-loading");

    function setLoading(on) {
        loadingEl?.classList.toggle("hidden", !on);
        btnGoogle.disabled = on;
        btnGuest.disabled = on;
    }

    function showError(msg) {
        if (!errorEl) return;
        errorEl.textContent = msg;
        errorEl.classList.remove("hidden");
    }

    function clearError() {
        errorEl?.classList.add("hidden");
    }

    btnGoogle?.addEventListener("click", async () => {
        clearError();
        setLoading(true);
        try {
            const user = await signInWithGoogle();
            setLoading(false);
            onAuthenticated?.(user);
        } catch (err) {
            setLoading(false);
            // Popup blocked / cancelled
            if (err?.code === "auth/popup-blocked" || err?.code === "auth/popup-closed-by-user") {
                showError("Popup diblokir. Mencoba redirect...");
                try {
                    await signInWithGoogleRedirect();
                    // Halaman akan redirect; onAuthenticated dipanggil di boot setelah return
                } catch (e2) {
                    showError(e2.message || "Gagal login Google");
                }
            } else if (err?.code === "auth/cancelled-popup-request") {
                // ignore
            } else {
                showError(err?.message || "Gagal login Google");
                logger.error(err);
            }
        }
    });

    btnGuest?.addEventListener("click", async () => {
        clearError();
        setLoading(true);
        try {
            const user = await signInAsGuest();
            setLoading(false);
            onAuthenticated?.(user);
        } catch (err) {
            setLoading(false);
            showError(err?.message || "Gagal masuk sebagai Guest");
            logger.error(err);
        }
    });
}

export function hideAuthScreen() {
    const container = document.getElementById("auth-screen");
    if (container) {
        container.classList.add("hidden");
        container.style.display = "none";
        container.innerHTML = "";
    }
    rootEl = null;
}

export function showAuthLoading(message = "Memuat...") {
    const loading = document.getElementById("loading-screen");
    if (loading) {
        loading.classList.remove("hidden");
        loading.style.display = "flex";
        const p = loading.querySelector("p");
        if (p) p.textContent = message;
    }
}
