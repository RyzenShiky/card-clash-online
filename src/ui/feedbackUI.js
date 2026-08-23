/**
 * Feedback form — EmailJS
 * Public key + Service ID dari developer. Template perlu dibuat di dashboard EmailJS.
 */
const EMAILJS_PUBLIC_KEY = "P0Rqa3Jk_akq23b1g";
const EMAILJS_SERVICE_ID = "service_5wb7hug";
/** Ganti dengan Template ID dari EmailJS (Dashboard → Email Templates) */
const EMAILJS_TEMPLATE_ID = "template_e0a2bnq";

let scriptLoaded = false;

function loadEmailJs() {
  return new Promise((resolve, reject) => {
    if (window.emailjs) {
      scriptLoaded = true;
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = () => {
      try {
        window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
        scriptLoaded = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    s.onerror = () => reject(new Error("Gagal memuat EmailJS"));
    document.head.appendChild(s);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {HTMLElement} host
 * @param {{ onClose?: () => void, context?: string }} opts
 */
export function openFeedbackModal(host, opts = {}) {
  const root = host || document.body;
  let modal = document.getElementById("feedback-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "feedback-modal";
  modal.className = "feedback-modal";
  modal.innerHTML = `
    <div class="feedback-card" role="dialog" aria-labelledby="fb-title">
      <h2 id="fb-title">Feedback</h2>
      <p class="text-muted" style="font-size:0.85rem;margin:0 0 0.75rem">
        Saran, bug, atau kritik — kami baca semuanya.
      </p>
      <label class="fb-label">Nama (opsional)</label>
      <input type="text" id="fb-name" class="fb-input" maxlength="80" placeholder="Nama kamu" />
      <label class="fb-label">Email (opsional)</label>
      <input type="email" id="fb-email" class="fb-input" maxlength="120" placeholder="email@contoh.com" />
      <label class="fb-label">Pesan *</label>
      <textarea id="fb-msg" class="fb-input fb-ta" rows="4" maxlength="2000" placeholder="Tulis feedback…" required></textarea>
      <p id="fb-status" class="fb-status" aria-live="polite"></p>
      <div class="fb-actions">
        <button type="button" class="btn btn-secondary" id="fb-cancel">Batal</button>
        <button type="button" class="btn btn-primary" id="fb-send">Kirim</button>
      </div>
    </div>
  `;
  root.appendChild(modal);

  const close = () => {
    modal.remove();
    opts.onClose?.();
  };
  modal.querySelector("#fb-cancel").onclick = close;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  modal.querySelector("#fb-send").onclick = async () => {
    const name = modal.querySelector("#fb-name").value.trim();
    const email = modal.querySelector("#fb-email").value.trim();
    const message = modal.querySelector("#fb-msg").value.trim();
    const status = modal.querySelector("#fb-status");
    if (!message) {
      status.textContent = "Pesan wajib diisi.";
      status.className = "fb-status err";
      return;
    }
    status.textContent = "Mengirim…";
    status.className = "fb-status";
    try {
      await loadEmailJs();
      await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        from_name: name || "Anonim",
        reply_to: email || "noreply@cardclash.local",
        message,
        context: opts.context || "menu",
        app: "Card Clash"
      });
      status.textContent = "Terima kasih! Feedback terkirim.";
      status.className = "fb-status ok";
      setTimeout(close, 1400);
    } catch (e) {
      console.warn("[Feedback]", e);
      status.innerHTML = `Gagal kirim. Cek Template ID EmailJS (<code>${escapeHtml(EMAILJS_TEMPLATE_ID)}</code>) atau coba lagi.<br><small>${escapeHtml(e?.text || e?.message || "")}</small>`;
      status.className = "fb-status err";
    }
  };
}
