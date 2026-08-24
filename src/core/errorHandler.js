/**
 * Central error handler:
 * detect → classify → recover → update UI → log
 */
import { classifyError, Severity } from "./errors.js";
import { logger } from "../utils/logger.js";
import { showNotification } from "../ui/notificationUI.js";

/** @type {Array<object>} */
const recentErrors = [];
const MAX_LOG = 50;

/** @type {{ onRetry?: Function, onLobby?: Function } | null} */
let recoveryHooks = null;

export function setErrorRecoveryHooks(hooks) {
    recoveryHooks = hooks;
}

export function getRecentErrors() {
    return [...recentErrors];
}

/**
 * @param {unknown} err
 * @param {object} [context]
 * @param {{ silent?: boolean, toast?: boolean }} [opts]
 */
export function handleError(err, context = {}, opts = {}) {
    const appErr = classifyError(err, context);
    const entry = appErr.toJSON();
    recentErrors.push(entry);
    if (recentErrors.length > MAX_LOG) recentErrors.shift();

    const logFn =
        appErr.severity === Severity.FATAL
            ? logger.error
            : appErr.severity === Severity.WARN
              ? logger.warn
              : logger.error;

    logFn(`[${appErr.code}]`, appErr.message, appErr.context);

    if (opts.silent) return appErr;

    if (opts.toast !== false) {
        showNotification(appErr.userMessage, appErr.severity === Severity.WARN ? 3200 : 4000);
    }

    // Soft recovery hints
    if (appErr.action === "lobby" && recoveryHooks?.onLobby) {
        // don't auto-navigate; show toast only unless fatal
    }

    return appErr;
}

/**
 * Wrap async UI action with lock + error handling
 */
export async function runSafe(fn, context = {}) {
    try {
        return await fn();
    } catch (e) {
        handleError(e, context);
        return null;
    }
}

/** Feature isolation: voice fail must not kill game */
export function isolateFeature(name, fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (e) {
            handleError(e, { feature: name }, { toast: true });
            return null;
        }
    };
}
