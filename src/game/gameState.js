/**
 * Game State representation
 * Public vs private state pattern.
 */

/**
 * Buat public state yang aman dikirim ke semua client.
 * Tidak berisi hand kartu lawan.
 */
export function createPublicState({
    matchId,
    playerIds,
    topCard,
    currentColor,
    currentTurn,
    direction,
    drawPileCount,
    status = "playing"
}) {
    return {
        matchId,
        status,
        topCard,
        currentColor,
        currentTurn,
        direction,
        drawPileCount,
        players: playerIds.map((uid) => ({
            uid,
            handCount: 0, // diisi dari private
            connected: true
        }))
    };
}

/**
 * Private state per pemain (hanya dikirim ke pemilik).
 */
export function createPrivateState(uid, hand) {
    return {
        uid,
        hand: hand || []
    };
}
