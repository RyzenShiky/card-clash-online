/**
 * Unified error types for Card Clash
 * detect → classify → recover → UI → log
 */

export const Severity = {
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
    FATAL: "fatal"
};

export class AppError extends Error {
    /**
     * @param {string} code
     * @param {string} message - developer message
     * @param {object} [opts]
     */
    constructor(code, message, opts = {}) {
        super(message);
        this.name = "AppError";
        this.code = code || "APP_ERROR";
        this.userMessage =
            opts.userMessage || message || "Terjadi kesalahan. Coba lagi.";
        this.severity = opts.severity || Severity.ERROR;
        this.context = opts.context || {};
        this.timestamp = Date.now();
        this.recoverable = opts.recoverable !== false;
        this.action = opts.action || null; // 'retry' | 'lobby' | 'reload' | null
        if (opts.cause) this.cause = opts.cause;
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            userMessage: this.userMessage,
            severity: this.severity,
            context: this.context,
            timestamp: this.timestamp,
            recoverable: this.recoverable,
            action: this.action
        };
    }
}

export class NetworkError extends AppError {
    constructor(message, opts = {}) {
        super("NETWORK", message, {
            userMessage: "Koneksi terputus. Mencoba menyambung kembali…",
            severity: Severity.WARN,
            recoverable: true,
            action: "retry",
            ...opts
        });
        this.name = "NetworkError";
    }
}

export class FirebaseAppError extends AppError {
    constructor(message, opts = {}) {
        super(opts.code || "FIREBASE", message, {
            userMessage: opts.userMessage || "Gagal sinkronisasi. Ketuk Coba lagi.",
            severity: Severity.ERROR,
            recoverable: true,
            action: "retry",
            ...opts
        });
        this.name = "FirebaseAppError";
    }
}

export class VoiceError extends AppError {
    constructor(message, opts = {}) {
        super(opts.code || "VOICE", message, {
            userMessage: opts.userMessage || "Mikrofon tidak tersedia",
            severity: Severity.WARN,
            recoverable: true,
            action: null,
            ...opts
        });
        this.name = "VoiceError";
    }
}

export class GameError extends AppError {
    constructor(message, opts = {}) {
        super(opts.code || "GAME", message, {
            userMessage: opts.userMessage || message,
            severity: Severity.WARN,
            recoverable: true,
            action: opts.action || null,
            ...opts
        });
        this.name = "GameError";
    }
}

export class UIError extends AppError {
    constructor(message, opts = {}) {
        super("UI", message, {
            userMessage: opts.userMessage || "Tampilan bermasalah",
            severity: Severity.WARN,
            recoverable: true,
            ...opts
        });
        this.name = "UIError";
    }
}

/**
 * Classify unknown thrown values into AppError
 */
export function classifyError(err, context = {}) {
    if (err instanceof AppError) {
        err.context = { ...err.context, ...context };
        return err;
    }

    const msg = err?.message || String(err);
    const code = err?.code || err?.name || "";

    // Firebase
    if (
        code.startsWith("auth/") ||
        code.startsWith("PERMISSION_DENIED") ||
        code === "PERMISSION_DENIED" ||
        msg.includes("PERMISSION_DENIED") ||
        msg.includes("firebase")
    ) {
        return new FirebaseAppError(msg, {
            code: code || "FIREBASE",
            context,
            cause: err
        });
    }

    // Network
    if (
        code === "unavailable" ||
        msg.includes("network") ||
        msg.includes("offline") ||
        msg.includes("Failed to fetch") ||
        typeof navigator !== "undefined" && navigator.onLine === false
    ) {
        return new NetworkError(msg, { context, cause: err });
    }

    // Voice / media
    if (
        code === "NotAllowedError" ||
        code === "NotFoundError" ||
        code === "NotReadableError" ||
        code === "SecurityError" ||
        msg.toLowerCase().includes("microphone") ||
        msg.toLowerCase().includes("getusermedia")
    ) {
        const userMessages = {
            NotAllowedError: "Izin microphone ditolak",
            NotFoundError: "Microphone tidak ditemukan",
            NotReadableError: "Microphone sedang dipakai aplikasi lain",
            SecurityError: "Voice membutuhkan HTTPS"
        };
        return new VoiceError(msg, {
            code,
            userMessage: userMessages[code] || "Mikrofon tidak tersedia",
            context,
            cause: err
        });
    }

    // Game domain
    if (
        msg.includes("giliran") ||
        msg.includes("Kartu") ||
        msg.includes("room") ||
        msg.includes("Room") ||
        msg.includes("stack") ||
        msg.includes("draw")
    ) {
        return new GameError(msg, {
            userMessage: msg,
            context,
            cause: err
        });
    }

    return new AppError("UNKNOWN", msg, {
        userMessage: "Terjadi kesalahan. Coba lagi.",
        context,
        cause: err
    });
}
