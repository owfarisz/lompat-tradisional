# LOMPAT!

Filter kamera berbasis computer vision untuk permainan lompat tradisional Indonesia (lompat tali, lompat karet, lompat batu), bisa dimainkan hingga 6 orang sekaligus.

## Menjalankan

Butuh Python 3.10–3.12.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Buka http://localhost:8000 di Chrome. Saat pertama dijalankan, model pose (±5,8 MB) diunduh ke `models/`.

> **Folder di iCloud Drive / OneDrive?** Folder venv berisi ribuan file. Kalau ikut disinkronkan, `import` bisa butuh beberapa menit. Di macOS, buat venv dengan nama `.venv.nosync` (iCloud melewati nama berakhiran `.nosync`), lalu `ln -s .venv.nosync .venv`.

Kamera di browser hanya diizinkan di `localhost` atau HTTPS, jadi bukalah halaman dari laptop yang menjalankan server.

## Tiga mode input

| Mode | Pose dideteksi di | Pelacakan & penilaian lompatan |
|---|---|---|
| 📷 Kamera · server Flask (utama) | Python (MediaPipe) | Python (`lompat/tracker.py`) |
| 🌐 Kamera · browser (cadangan) | Browser (MediaPipe JS, CDN) | Browser (`static/js/tracker.js`) |
| 🎮 Demo | – (kamu + 2 bot) | Browser |

## Arsitektur

```
Browser                                   Flask (app.py)
───────                                   ──────────────
kamera → frame JPEG 640 px ──WebSocket──▶ /ws/pose
  + jam frame, fase, momen yang             lompat/session.py   urai pesan, satu sesi per koneksi
    perlu dinilai                           lompat/pose.py      MediaPipe Pose Landmarker (33 titik, 6 orang)
                                            lompat/tracker.py   identitas pemain, lantai dinamis,
                                                                tinggi angkat kaki & pinggul, penilaian
render tali/karet/batu, skor, nyawa ◀──JSON── posisi pemain + hasil penilaian (lolos / kena / tidak dinilai)
```

- Browser yang mengatur waktu permainan (kapan tali sampai di kaki, kapan batu lewat). Server yang memutuskan apakah pemain melompat cukup tinggi pada momen itu.
- Frame dikirim satu per satu. Frame berikutnya baru dikirim setelah balasan datang, supaya antrean tidak menumpuk. HUD menampilkan waktu bolak-balik, misalnya `🐍 Flask 10 ms`.
- Semua angka penilaian ada di `lompat/config.py` dan dikirim ke halaman lewat template, jadi mode server dan mode browser memakai angka yang sama.

```
app.py                 server Flask: halaman, /api/health, WebSocket /ws/pose
lompat/                backend
  config.py            angka pelacakan & penilaian
  pose.py              MediaPipe
  tracker.py           pelacakan & penilaian lompatan
  session.py           protokol pesan
templates/index.html   halaman
static/css/style.css
static/js/
  main.js              alur permainan & gambar
  config.js            aturan permainan (tinggi tali, level karet, …)
  tracker.js           pelacakan versi browser (mode browser & demo)
  pose-server.js       klien WebSocket
  pose-browser.js      MediaPipe versi browser
tests/                 python -m unittest discover tests
```

## Uji

```bash
.venv/bin/python -m unittest discover tests
```

Unit test memakai pose buatan untuk memastikan hal-hal berikut:

- berdiri diam tidak dihitung melompat;
- lompatan sungguhan dihitung lolos;
- mengangkat satu kaki atau menekuk lutut tanpa pinggul naik tidak dihitung melompat;
- pemain yang tidak terlihat tidak dinilai;
- identitas pemain tetap sama walaupun urutan deteksi berubah.
