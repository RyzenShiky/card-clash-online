/**
 * Simple logger
 */
const PREFIX = "[CardClash]";

export const logger = {
    info: (...args) => console.log(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args),
    debug: (...args) => {
        if (typeof window !== "undefined" && window.__DEBUG__) {
            console.debug(PREFIX, ...args);
        }
    }
};
