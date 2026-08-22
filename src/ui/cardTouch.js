/**
 * Mobile/tablet card gestures:
 * - Tap / click → play
 * - Swipe up → play
 * - Drag to discard pile → play
 */
const SWIPE_UP_PX = 48;
const DRAG_ACTIVATE_PX = 12;

/**
 * @param {HTMLElement} el - card element
 * @param {object} opts
 * @param {() => void} opts.onPlay
 * @param {HTMLElement|null} opts.discardZone - element .discard-zone or discard card
 */
export function bindCardGestures(el, { onPlay, discardZone = null }) {
    if (!el || el.dataset.gesturesBound === "1") return;
    el.dataset.gesturesBound = "1";

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let moved = false;
    let originParent = null;
    let placeholder = null;
    let clone = null;
    let pointerId = null;

    const resetVisual = () => {
        el.style.transition = "transform 0.15s ease";
        el.style.transform = "";
        el.style.zIndex = "";
        el.style.opacity = "";
        el.classList.remove("dragging");
        if (clone) {
            clone.remove();
            clone = null;
        }
        if (placeholder) {
            placeholder.remove();
            placeholder = null;
        }
        discardZone?.classList.remove("drop-target");
    };

    const tryPlay = () => {
        resetVisual();
        onPlay?.();
    };

    const onPointerDown = (e) => {
        // Hanya primary touch/mouse
        if (e.button != null && e.button !== 0) return;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        dragging = false;
        moved = false;
        el.setPointerCapture?.(pointerId);
    };

    const onPointerMove = (e) => {
        if (pointerId != null && e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.hypot(dx, dy);
        if (dist > 6) moved = true;

        // Mulai drag visual
        if (!dragging && dist > DRAG_ACTIVATE_PX) {
            dragging = true;
            el.classList.add("dragging");
            el.style.zIndex = "30";
            el.style.transition = "none";
        }

        if (dragging) {
            el.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
            el.style.opacity = "0.95";

            // Highlight discard jika pointer di atas zona
            if (discardZone) {
                const r = discardZone.getBoundingClientRect();
                const over =
                    e.clientX >= r.left &&
                    e.clientX <= r.right &&
                    e.clientY >= r.top &&
                    e.clientY <= r.bottom;
                discardZone.classList.toggle("drop-target", over);
            }
        }
    };

    const onPointerUp = (e) => {
        if (pointerId != null && e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let played = false;

        // Drop ke discard
        if (dragging && discardZone) {
            const r = discardZone.getBoundingClientRect();
            const over =
                e.clientX >= r.left &&
                e.clientX <= r.right &&
                e.clientY >= r.top &&
                e.clientY <= r.bottom;
            if (over) {
                played = true;
                tryPlay();
            }
        }

        // Swipe ke atas
        if (!played && moved && dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(dx)) {
            played = true;
            tryPlay();
        }

        // Tap (sedikit gerak)
        if (!played && !moved) {
            played = true;
            tryPlay();
        }

        if (!played) resetVisual();
        else resetVisual();

        pointerId = null;
        try {
            el.releasePointerCapture?.(e.pointerId);
        } catch (_) {}
    };

    const onPointerCancel = () => {
        resetVisual();
        pointerId = null;
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    // Cegah scroll page saat drag kartu di mobile
    el.style.touchAction = "none";
}
