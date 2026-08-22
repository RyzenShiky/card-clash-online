/**
 * Game Manager - coordinator
 * Untuk Solo: full local.
 * Untuk Multiplayer: kirim intent ke server / Firebase, jangan percaya client.
 */
import { createDeck, shuffle, deal } from "./deck.js";
import { canPlayCard, isWinner, scoreHand } from "./rules.js";
import { TurnManager } from "./turnManager.js";
import { logger } from "../utils/logger.js";

export class GameManager {
    constructor({ playerIds, isSolo = false, rules = {} }) {
        this.playerIds = playerIds;
        this.isSolo = isSolo;
        this.rules = rules;
        this.deck = [];
        this.discard = [];
        this.hands = {};
        this.currentColor = null;
        this.turn = new TurnManager(playerIds);
        this.status = "idle"; // idle | playing | finished
        this.winner = null;
    }

    start() {
        const full = shuffle(createDeck());
        const { hands, remaining } = deal(full, this.playerIds.length, 7);

        this.playerIds.forEach((uid, i) => {
            this.hands[uid] = hands[i];
        });

        this.deck = remaining;
        // First discard (bukan wild)
        let first = this.deck.pop();
        while (first && (first.value === "wild" || first.value === "wild_draw4")) {
            this.deck.unshift(first);
            first = this.deck.pop();
        }
        this.discard = first ? [first] : [];
        this.currentColor = first?.color || null;
        this.status = "playing";
        this.winner = null;

        logger.info("[Game] Started. Top:", first);
        return this.getPublicView();
    }

    get topCard() {
        return this.discard[this.discard.length - 1] || null;
    }

    /**
     * Intent: play card
     */
    playCard(uid, cardId, chosenColor = null) {
        if (this.status !== "playing") throw new Error("Game not playing");
        if (this.turn.currentPlayerId !== uid) throw new Error("Bukan giliranmu");

        const hand = this.hands[uid];
        const idx = hand.findIndex((c) => c.id === cardId);
        if (idx === -1) throw new Error("Kartu tidak dimiliki");

        const card = hand[idx];
        if (!canPlayCard(card, this.topCard, this.currentColor, this.rules)) {
            throw new Error("Kartu tidak valid");
        }

        // Remove from hand
        hand.splice(idx, 1);
        this.discard.push(card);

        if (card.value === "wild" || card.value === "wild_draw4") {
            this.currentColor = chosenColor || "red";
        } else {
            this.currentColor = card.color;
        }

        // Effects
        if (card.value === "reverse") this.turn.reverse();
        if (card.value === "skip") this.turn.skip();
        if (card.value === "draw2") {
            this.turn.next();
            this._draw(this.turn.currentPlayerId, 2);
        }
        if (card.value === "wild_draw4") {
            this.turn.next();
            this._draw(this.turn.currentPlayerId, 4);
        }

        if (isWinner(hand)) {
            this.status = "finished";
            this.winner = uid;
            logger.info("[Game] Winner:", uid);
            return { type: "win", winner: uid };
        }

        this.turn.next();
        return { type: "ok", public: this.getPublicView() };
    }

    drawCard(uid) {
        if (this.turn.currentPlayerId !== uid) throw new Error("Bukan giliranmu");
        this._draw(uid, 1);
        this.turn.next();
        return this.getPublicView();
    }

    _draw(uid, count) {
        for (let i = 0; i < count; i++) {
            if (this.deck.length === 0) this._reshuffle();
            if (this.deck.length === 0) break;
            const c = this.deck.pop();
            this.hands[uid].push(c);
        }
    }

    _reshuffle() {
        if (this.discard.length <= 1) return;
        const top = this.discard.pop();
        this.deck = shuffle(this.discard);
        this.discard = [top];
    }

    getPublicView() {
        return {
            status: this.status,
            topCard: this.topCard,
            currentColor: this.currentColor,
            currentTurn: this.turn.currentPlayerId,
            direction: this.turn.direction,
            drawPileCount: this.deck.length,
            players: this.playerIds.map((uid) => ({
                uid,
                handCount: this.hands[uid]?.length ?? 0
            })),
            winner: this.winner
        };
    }

    getPrivateHand(uid) {
        return this.hands[uid] || [];
    }
}
