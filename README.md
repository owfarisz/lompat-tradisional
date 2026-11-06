# LOMPAT!

Filter kamera berbasis computer vision untuk permainan lompat tradisional Indonesia (lompat tali, lompat karet, lompat batu), bisa dimainkan hingga 6 orang sekaligus.

## Menjalankan

Butuh Python 3.10–3.12.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Buka http://localhost:8000 di Chrome. Saat pertama dijalankan, model YOLO-pose `yolo11n-pose.pt` (±6 MB) diunduh ke `models/`. Instalasi menarik PyTorch (lewat `ultralytics`), jadi butuh ruang disk beberapa GB.

> **Folder di iCloud Drive / OneDrive?** Folder venv berisi ribuan file. Kalau ikut disinkronkan, `import` bisa butuh beberapa menit. Di macOS, buat venv dengan nama `.venv.nosync` (iCloud melewati nama berakhiran `.nosync`), lalu `ln -s .venv.nosync .venv`.

Kamera di browser hanya diizinkan di `localhost` atau HTTPS, jadi bukalah halaman dari laptop yang menjalankan server.

## Tiga mode input

| Mode | Pose dideteksi di | Pelacakan & penilaian lompatan |
|---|---|---|
| 📷 Kamera · server Flask (utama) | Python (YOLO-pose, Ultralytics) | Python (`lompat/tracker.py`) |
| 🌐 Kamera · browser (cadangan) | Browser (MediaPipe JS, CDN) | Browser (`static/js/tracker.js`) |
| 🎮 Demo | – (kamu + 2 bot) | Browser |

## Arsitektur

```
Browser                                   Flask (app.py)
───────                                   ──────────────
kamera → frame JPEG 640 px ──WebSocket──▶ /ws/pose
  + jam frame, fase, momen yang             lompat/session.py   urai pesan, satu sesi per koneksi
    perlu dinilai                           lompat/pose.py      YOLO-pose (17 titik COCO, 6 orang)
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
  pose.py              YOLO-pose
  keypoints.py         indeks titik COCO-17
  finetune.py          pipeline fine-tuning (python -m lompat.finetune)
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

## Fine-tuning model pose

Kalau pemain sering tidak terdeteksi di tempat bermainmu (cahaya, sudut kamera, pakaian), latih ulang YOLO-pose dengan rekamanmu sendiri:

```bash
# 1. rekaman → dataset (frame 640 px, val = 20% akhir tiap video, label awal dari model saat ini)
.venv/bin/python -m lompat.finetune prepare rekaman1.mp4 rekaman2.mp4 --out datasets/lompat

# 2. periksa & perbaiki label di alat anotasi format YOLO pose (mis. CVAT → "Ultralytics YOLO Pose")

# 3. latih, bandingkan dengan model dasar, pasang ke models/pose-finetuned.pt kalau lebih baik
.venv/bin/python -m lompat.finetune train --data datasets/lompat/data.yaml --epochs 50
```

- Server otomatis memakai `models/pose-finetuned.pt` kalau ada (setelah dijalankan ulang). `LOMPAT_POSE_MODEL=path` memaksa bobot tertentu. `/api/health` menunjukkan model yang aktif.
- Augmentasi ada di `AUGMENT` (`lompat/finetune.py`): warna/cahaya, skala, geser, sedikit rotasi, cermin kiri-kanan, mosaic. Bisa ditimpa, mis. `--aug degrees=0 --aug scale=0.3`. Cermin kiri-kanan butuh `flip_idx` di `data.yaml` (dibuat otomatis oleh `prepare`, dicek sebelum latihan).
- Tanpa GPU, latihan berjalan di CPU dan lambat; pakai `--device 0` kalau ada GPU NVIDIA.

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
