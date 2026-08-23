/**
 * HandController — CardSlot (hitbox tetap) + CardVisual (animasi)
 * Diff by stable card.id — tidak rebuild hand.
 */
import { renderCardHTML } from "./cardRender.js";
import { canPlayCard } from "../game/rules.js";

export class HandController {
    /**
     * @param {HTMLElement} root
     * @param {{ onPlay: (cardId: string) => void, getDiscardZone?: () => HTMLElement|null }} opts
     */
    constructor(root, opts = {}) {
        this.root = root;
        this.onPlay = opts.onPlay || (() => {});
        this.getDiscardZone = opts.getDiscardZone || (() => null);
        /** @type {Map<string, { slot: HTMLElement, face: HTMLElement, card: object }>} */
        this.slots = new Map();
        this.scrollEl = null;
        this.loadingEl = null;
        this.hoveredId = null;
        this._ensureStructure();
        this._bindDelegation();
    }

    _ensureStructure() {
        if (!this.root) return;
        let scroll = this.root.querySelector(".hand-fan-scroll");
        if (!scroll) {
            this.root.innerHTML = "";
            this.root.classList.add("hand-fan");
            scroll = document.createElement("div");
            scroll.className = "hand-fan-scroll";
            this.root.appendChild(scroll);
        }
        this.scrollEl = scroll;
    }

    _bindDelegation() {
        if (!this.root || this.root.dataset.handCtrl === "1") return;
        this.root.dataset.handCtrl = "1";

        this.root.addEventListener(
            "pointerenter",
            (e) => {
                const slot = e.target.closest?.(".card-slot");
                if (!slot || !this.root.contains(slot)) return;
                this.hoveredId = slot.dataset.cardId;
                slot.classList.add("is-hovered");
            },
            true
        );

        this.root.addEventListener(
            "pointerleave",
            (e) => {
                const slot = e.target.closest?.(".card-slot");
                if (!slot || !this.root.contains(slot)) return;
                const related = e.relatedTarget;
                if (related && slot.contains(related)) return;
                slot.classList.remove("is-hovered");
                if (this.hoveredId === slot.dataset.cardId) this.hoveredId = null;
            },
            true
        );
    }

    /**
     * @param {Array<{id:string,value:string,color?:string}>} hand
     * @param {object} ctx
     */
    sync(hand, ctx = {}) {
        this._ensureStructure();
        const list = Array.isArray(hand) ? hand : [];
        const nextIds = new Set(list.map((c) => c?.id).filter(Boolean));

        for (const [id, entry] of [...this.slots.entries()]) {
            if (!nextIds.has(id)) {
                entry.slot.remove();
                this.slots.delete(id);
            }
        }

        if (!list.length) {
            if (!this.loadingEl) {
                this.loadingEl = document.createElement("p");
                this.loadingEl.className = "hand-loading";
                this.scrollEl.appendChild(this.loadingEl);
            }
            this.loadingEl.textContent =
                (ctx.expectedCount || 0) > 0 ? "Memuat kartu…" : "Tidak ada kartu";
            return;
        }
        if (this.loadingEl) {
            this.loadingEl.remove();
            this.loadingEl = null;
        }

        for (const card of list) {
            if (!card?.id) continue;
            const playable = this._isPlayable(card, ctx);
            let entry = this.slots.get(card.id);
            if (!entry) {
                entry = this._createSlot(card, playable);
                this.slots.set(card.id, entry);
                this.scrollEl.appendChild(entry.slot);
            } else {
                entry.card = card;
                entry.face.classList.toggle("playable", !!playable);
            }
        }

        // Reorder to match hand order without destroying nodes
        list.forEach((card, i) => {
            const entry = this.slots.get(card.id);
            if (!entry) return;
            const at = this.scrollEl.children[i];
            if (at !== entry.slot) {
                this.scrollEl.insertBefore(entry.slot, at || null);
            }
        });

        // First slot margin
        const kids = this.scrollEl.querySelectorAll(".card-slot");
        kids.forEach((s, i) => {
            s.style.marginLeft = i === 0 ? "0" : "-16px";
        });
    }

    _isPlayable(card, ctx) {
        if (!ctx.myTurn) return false;
        const stackAmt = ctx.stackAmount || 0;
        if (stackAmt > 0 && ctx.stacking) {
            return (
                (ctx.stackType === "draw2" && card.value === "draw2") ||
                (ctx.stackType === "wild_draw4" && card.value === "wild_draw4")
            );
        }
        return canPlayCard(card, ctx.topCard, ctx.currentColor);
    }

    _createSlot(card, playable) {
        const slot = document.createElement("div");
        slot.className = "card-slot";
        slot.dataset.cardId = card.id;
        slot.setAttribute("role", "button");
        slot.tabIndex = 0;

        // Build visual once
        const tmp = document.createElement("div");
        tmp.innerHTML = renderCardHTML(card, { playable });
        const face = tmp.firstElementChild;
        if (face) {
            face.style.pointerEvents = "none";
            slot.appendChild(face);
        }

        // Interaction on SLOT only (hitbox tetap)
        let downX = 0;
        let downY = 0;
        let moved = false;

        slot.addEventListener("pointerdown", (e) => {
            if (e.button != null && e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
            moved = false;
            slot.setPointerCapture?.(e.pointerId);
        });

        slot.addEventListener("pointermove", (e) => {
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) moved = true;
        });

        slot.addEventListener("pointerup", (e) => {
            const dy = downY - e.clientY;
            // Tap atau swipe up → play; hitbox slot tidak di-transform
            if (!moved || dy > 40) {
                this.onPlay(card.id);
            }
        });

        slot.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.onPlay(card.id);
            }
        });

        return { slot, face: face || slot, card };
    }

    clear() {
        this.slots.clear();
        if (this.scrollEl) this.scrollEl.innerHTML = "";
        this.loadingEl = null;
        this.hoveredId = null;
    }
}
