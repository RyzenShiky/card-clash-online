/**
 * Custom errors
 */
export class GameError extends Error {
    constructor(message, code = "GAME_ERROR") {
        super(message);
        this.name = "GameError";
        this.code = code;
    }
}

export class AuthError extends Error {
    constructor(message, code = "AUTH_ERROR") {
        super(message);
        this.name = "AuthError";
        this.code = code;
    }
}

export class RoomError extends Error {
    constructor(message, code = "ROOM_ERROR") {
        super(message);
        this.name = "RoomError";
        this.code = code;
    }
}
