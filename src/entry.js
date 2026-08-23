/**
 * Entry ringan — update teks loading, lalu muat main.js
 * Mengurangi kesan "stuck" di HP/tablet.
 */
(function () {
  const el = document.querySelector("#loading-screen p");
  const set = (t) => {
    if (el) el.textContent = t;
  };

  set("Memuat aplikasi…");
  const t1 = setTimeout(() => set("Menyiapkan Firebase…"), 1200);
  const t2 = setTimeout(() => set("Jaringan lambat, masih mencoba…"), 4000);
  const t3 = setTimeout(() => set("Hampir siap…"), 7000);

  import("./main.js?v=7")
    .catch((err) => {
      console.error("[Entry]", err);
      set(
        "Gagal memuat. Cek koneksi, lalu refresh. " +
          (err && err.message ? err.message : "")
      );
      const box = document.getElementById("loading-screen");
      if (box) {
        const btn = document.createElement("button");
        btn.textContent = "Coba lagi";
        btn.className = "btn btn-primary";
        btn.style.marginTop = "1rem";
        btn.onclick = () => location.reload();
        box.appendChild(btn);
      }
    })
    .finally(() => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    });
})();
