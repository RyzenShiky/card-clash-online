# Card Clash

Game kartu kompetitif berbasis web (HTML + CSS + ES Modules + Firebase).

## Fitur versi ini

- **Login Screen** — Google Sign-In + Guest (Anonymous), tanpa auto-login
- **Session restore** — pemain yang sudah login tidak ditanya lagi
- **Guest → Google linking** — upgrade akun tanpa kehilangan UID/data
- Solo vs AI (basic)
- Create Room / Join by Room Code
- Player Profile (`public` / `stats` / `private`)
- Presence (online/offline)
- Modular architecture (`src/`)

## Setup Firebase (wajib)

1. [Firebase Console](https://console.firebase.google.com/) → project kamu.
2. **Authentication → Sign-in method**
   - **Anonymous** → Enable
   - **Google** → Enable (isi support email)
3. **Realtime Database** → Create database (region terdekat).
4. (Opsional) isi `databaseURL` di `src/firebase/config.js` jika belum otomatis.
5. Authorized domains: pastikan domain kamu (localhost, production) ada di Auth → Settings → Authorized domains.

### Security Rules (development)

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Kunci lebih ketat sebelum production (lihat STEP 12 di arsitektur).

## Menjalankan lokal

```bash
python -m http.server 8000
# atau: npx serve .
```

Buka: http://localhost:8000

**Jangan** buka via `file://`.

## Alur boot

```
PAGE LOAD
  → waitForAuthState / redirect result
  → ada session? → profile + menu
  → tidak? → Login Screen (Google | Guest)
```

## Upgrade Guest → Google

Di menu, buka **Profile**. Jika masih Guest, konfirmasi untuk link Google.  
UID tetap sama → stats & room history tidak hilang.

Logout manual (console): `await window.__cardClashLogout()`

## Struktur

```
card-clash-web/
├── index.html
├── src/
│   ├── main.js
│   ├── styles/          ← CSS modular
│   │   ├── main.css     (entry @import)
│   │   ├── variables.css
│   │   ├── base.css
│   │   ├── components.css
│   │   ├── loading.css
│   │   ├── auth.css
│   │   ├── menu.css
│   │   ├── lobby.css
│   │   └── game.css
│   ├── firebase/
│   ├── auth/
│   ├── multiplayer/
│   ├── game/
│   ├── ui/
│   └── utils/
└── assets/
```

## Phase 2 (sudah)

- `databaseURL` terisi (asia-southeast1)
- Room Code reservation via **runTransaction** (anti race)
- Join Room via **runTransaction** (anti overflow maxPlayers)
- Leave + host migration via transaction
- Ready state via transaction

## Roadmap berikutnya

- Security Rules production + App Check
- Cloud Functions: createRoom, joinRoom, startMatch, playCard, drawCard (authoritative)
- Private hand per pemain + server deck
- Reconnect profesional + matchmaking
- Emulator testing

## Catatan

- Client tidak boleh menentukan pemenang / mengubah hand lawan.
- Nama & visual orisinal untuk proyekmu.


## Build (opsional — Vite)

```bash
npm install
npm run dev      # development
npm run build    # output ke dist/ (minify + tree-shake)
npm run preview
```

Tanpa Vite, tetap bisa dijalankan dengan static server:
```bash
python -m http.server 8000
```

## Feedback (EmailJS)

Sudah dikonfigurasi:
- Public Key: `P0Rqa3Jk_akq23b1g`
- Service ID: `service_5wb7hug`
- Template ID default: `template_e0a2bnq`

Buat template di [EmailJS](https://dashboard.emailjs.com/) dengan variabel:
`from_name`, `reply_to`, `message`, `context`, `app`
lalu sesuaikan `EMAILJS_TEMPLATE_ID` di `src/ui/feedbackUI.js` jika ID berbeda.

## Legal & branding

- Privacy: `privacy.html`
- Terms: `terms.html`
- Icons PWA: `icons/icon-192.svg`, `icons/icon-512.svg`
- Manifest: `manifest.webmanifest`

Developed by **RyzenShiky**.


## Deploy ke GitHub Pages

1. Buat repo GitHub, push isi folder `card-clash-web`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. Push ke branch `main` — workflow `.github/workflows/deploy-pages.yml` akan build Vite & publish `dist/`.
4. URL: `https://<username>.github.io/<repo>/`

Atau manual tanpa Actions:
```bash
npm install && npm run build
# upload isi folder dist/ ke branch gh-pages
```

File `.nojekyll` sudah disertakan agar GitHub tidak memproses Jekyll.
