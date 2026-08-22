/**
 * HTML for professional card face
 */
const CB = { red: "▲", blue: "●", green: "■", yellow: "◆", wild: "✦" };

const LABEL = {
  skip: "⊘",
  reverse: "⇄",
  draw2: "+2",
  wild: "W",
  wild_draw4: "+4"
};

export function cardLabel(value) {
  return LABEL[value] || String(value);
}

export function renderCardHTML(card, { discard = false, playable = false } = {}) {
  if (!card) return "";
  const color = card.color || "wild";
  const val = cardLabel(card.value);
  const cb = CB[color] || CB.wild;
  const cls = [
    "card-face",
    color,
    discard ? "discard" : "",
    playable ? "playable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${cls}" data-id="${card.id || ""}" title="${color} ${card.value}">
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
