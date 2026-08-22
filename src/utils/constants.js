/**
 * App constants
 */
export const APP_NAME = "Card Clash";
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const DEFAULT_TURN_TIMER = 30;
export const DEFAULT_HAND_SIZE = 7;
export const ROOM_CODE_LENGTH = 6;
export const RECONNECT_GRACE_MS = 60_000;

export const ROOM_STATUS = {
    WAITING: "waiting",
    STARTING: "starting",
    PLAYING: "playing",
    PAUSED: "paused",
    FINISHED: "finished",
    CLOSED: "closed"
};

export const PLAYER_STATUS = {
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    READY: "ready",
    PLAYING: "playing",
    ELIMINATED: "eliminated"
};
