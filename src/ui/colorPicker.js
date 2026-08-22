/**
 * Color picker + draw penalty toast
 * v2 — exports: pickColor, pickWildColor, showDrawPenaltyAnim
 */
export function pickColor() {
  return new Promise((resolve) => {
    const existing = document.querySelector(".color-picker-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "color-picker-overlay";
    overlay.innerHTML = `
      <div class="color-picker">
        <h3>Pilih warna</h3>
        <button type="button" class="color-swatch red" data-c="red">Merah</button>
        <button type="button" class="color-swatch blue" data-c="blue">Biru</button>
        <button type="button" class="color-swatch green" data-c="green">Hijau</button>
        <button type="button" class="color-swatch yellow" data-c="yellow">Kuning</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const done = (c) => {
      overlay.remove();
      resolve(c);
    };

    overlay.querySelectorAll("[data-c]").forEach((btn) => {
      btn.addEventListener("click", () => done(btn.getAttribute("data-c")));
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
  });
}

export function pickWildColor() {
  return pickColor();
}

export function showDrawPenaltyAnim(n, isMe) {
  const el = document.createElement("div");
  el.className = "draw-penalty-toast";
  el.textContent = isMe ? `Kamu +${n}!` : `Lawannya +${n}!`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
