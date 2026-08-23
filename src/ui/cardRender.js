/**
 * Kartu visual — Wild & +4 berwarna (bukan hitam polos)
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

export function renderCardHTML(card, { discard = false, playable = false, activeColor = null } = {}) {
  if (!card) return "";
  const isWild = card.value === "wild" || card.value === "wild_draw4";
  const chosen = activeColor || (isWild ? card.color : null);

  let colorClass;
  if (isWild && chosen && ["red", "blue", "green", "yellow"].includes(chosen)) {
    // Setelah pilih warna / discard aktif
    colorClass = `wild ${chosen}`;
  } else if (isWild) {
    colorClass = "wild rainbow";
  } else {
    colorClass = card.color || "wild";
  }

  const val = cardLabel(card.value);
  const cb = CB[chosen || card.color] || CB.wild;
  const cls = [
    "card-face",
    colorClass,
    discard ? "discard" : "",
    playable ? "playable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  // Rainbow wild: 4 kuadran warna di elips
  const center =
    isWild && !chosen
      ? `<div class="center-ellipse wild-quad">
           <div class="wq wq-r"></div><div class="wq wq-b"></div>
           <div class="wq wq-y"></div><div class="wq wq-g"></div>
           <span class="card-value wild-val">${val}</span>
         </div>`
      : `<div class="center-ellipse">
           <span class="card-value">${val}</span>
         </div>`;

  return `
    <div class="${cls}" data-id="${card.id || ""}" title="${colorClass} ${card.value}">
      <div class="corner top-left">
        <span>${val}</span>
        <span class="cb-symbol">${cb}</span>
      </div>
      ${center}
      <div class="corner bottom-right">
        <span>${val}</span>
        <span class="cb-symbol">${cb}</span>
      </div>
    </div>
  `;
}
