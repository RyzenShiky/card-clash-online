const CB = { red: "▲", blue: "●", green: "■", yellow: "◆", wild: "✦" };

const LABEL = {
  skip: "⊘",
  reverse: "⇄",
  draw2: "+2",
  wild: "WILD",
  wild_draw4: "+4"
};

export function cardLabel(value) {
  return LABEL[value] || String(value);
}

/**
 * @param card { id, color, value }
 * @param opts.discard
 * @param opts.playable
 * @param opts.activeColor — override class warna (untuk wild setelah pilih warna)
 */
export function renderCardHTML(card, { discard = false, playable = false, activeColor = null } = {}) {
  if (!card) return "";
  const isWild = card.value === "wild" || card.value === "wild_draw4" || !card.color;
  // Setelah pilih warna, tampilkan warna aktif pada discard wild/+4
  let colorClass = card.color || "wild";
  if (isWild && activeColor) {
    colorClass = `wild ${activeColor}`;
  } else if (isWild) {
    colorClass = "wild";
  }

  const val = cardLabel(card.value);
  const cb = CB[activeColor || card.color] || CB.wild;
  const cls = [
    "card-face",
    colorClass,
    discard ? "discard" : "",
    playable ? "playable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${cls}" data-id="${card.id || ""}" title="${colorClass} ${card.value}">
      <div class="corner top-left">
        <span>${val}</span>
        <span class="cb-symbol">${cb}</span>
      </div>
      <div class="center-ellipse">
        <span class="card-value">${val}</span>
      </div>
      <div class="corner bottom-right">
        <span>${val}</span>
        <span class="cb-symbol">${cb}</span>
      </div>
    </div>
  `;
}
