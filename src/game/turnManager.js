/**
 * Turn Manager
 */
export class TurnManager {
    constructor(playerIds = [], direction = 1) {
        this.playerIds = [...playerIds];
        this.currentIndex = 0;
        this.direction = direction; // 1 = clockwise, -1 = reverse
    }

    get currentPlayerId() {
        return this.playerIds[this.currentIndex] ?? null;
    }

    next() {
        const len = this.playerIds.length;
        if (len === 0) return null;
        this.currentIndex = (this.currentIndex + this.direction + len) % len;
        return this.currentPlayerId;
    }

    reverse() {
        this.direction *= -1;
    }

    skip() {
        this.next(); // skip current next
    }

    setPlayers(ids) {
        this.playerIds = [...ids];
        this.currentIndex = 0;
    }
}
