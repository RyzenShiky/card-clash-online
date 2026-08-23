/**
 * Haptic feedback (mobile) — no-op di desktop
 */
export function haptic(ms = 12) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) {}
}

export function hapticSuccess() {
  haptic([10, 30, 10]);
}

export function hapticError() {
  haptic([30, 40, 30]);
}
