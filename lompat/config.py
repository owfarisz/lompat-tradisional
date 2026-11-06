"""Angka-angka pelacakan & penilaian lompatan.

Satu sumber untuk Python (server) dan JavaScript (mode browser/demo): nilai di
CLIENT dikirim ke halaman lewat template, jadi kedua sisi selalu sama.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------- Model pose ----------
# Server: YOLO-pose (Ultralytics, 17 titik COCO). Hasil fine-tuning (python -m lompat.finetune train)
# disimpan di FINETUNED_MODEL_PATH dan otomatis dipakai kalau ada. LOMPAT_POSE_MODEL=path menimpa keduanya.
BASE_MODEL_URL = 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt'
BASE_MODEL_PATH = BASE_DIR / 'models' / 'yolo11n-pose.pt'
FINETUNED_MODEL_PATH = BASE_DIR / 'models' / 'pose-finetuned.pt'
DETECT_CONF = 0.35            # ambang keyakinan kotak orang dari YOLO
IMGSZ = 640                   # ukuran input YOLO (sama dengan FRAME_MAX)
MAX_POSES = 6
MIN_CONFIDENCE = 0.5          # mode browser (MediaPipe JS): deteksi, kehadiran & pelacakan pose
FRAME_MAX = 640               # sisi terpanjang frame yang dikirim browser ke server (px)
JPEG_QUALITY = 0.7

# ---------- Pelacakan pemain ----------
VIS_MIN = 0.5                 # visibility / keyakinan titik minimum bahu & pergelangan kaki agar pemain dianggap terlihat
CONFIRM_FRAMES = 12           # pemain baru dikonfirmasi setelah terlihat 12 frame (menyaring deteksi palsu)
MAX_TRACKED = 12              # batas kandidat pemain yang dilacak sekaligus
SMOOTH = 0.5                  # perhalusan posisi kaki/pinggul antar-frame
MATCH_BODY_FRAC = 0.6         # deteksi dipasangkan ke pemain jika selisih X pinggul < 0,6 × tinggi badan
MATCH_MIN_FRAC = 0.047        # ... atau minimal 4,7% lebar frame (server)
MIN_BODY_FRAC = 0.055         # tinggi badan awal minimal 5,5% tinggi frame (server)
KEEP_CONFIRMED = 3.0          # di luar permainan, pemain yang hilang > 3 dtk dibuang
KEEP_UNCONFIRMED = 0.6        # kandidat yang hilang > 0,6 dtk dibuang

# ---------- Penilaian lompatan ----------
PRE, POST = 0.25, 0.18        # jendela penilaian (dtk) di sekitar momen objek lewat di kaki
GROUND_WIN = 1.2              # lantai = posisi kaki terendah dalam 1,2 dtk terakhir
HIST_SEC = 3.0                # panjang riwayat gerak per pemain
HIP_RATIO = 0.5               # pinggul wajib naik minimal 50% dari syarat tinggi kaki
MIN_SAMPLES = 3               # minimal sampel di jendela penilaian, kalau kurang → tidak dinilai
STILL_FRAC = 0.03             # saat kaki di lantai (angkat < 3%), tinggi badan disesuaikan pelan-pelan
BODY_ADAPT = 0.05



def model_path():
    """Bobot YOLO-pose yang dipakai server: env > hasil fine-tuning > model dasar."""
    if os.environ.get('LOMPAT_POSE_MODEL'):
        return Path(os.environ['LOMPAT_POSE_MODEL'])
    return FINETUNED_MODEL_PATH if FINETUNED_MODEL_PATH.exists() else BASE_MODEL_PATH


CLIENT = {
    'maxPoses': MAX_POSES, 'minConfidence': MIN_CONFIDENCE,
    'frameMax': FRAME_MAX, 'jpegQuality': JPEG_QUALITY,
    'visMin': VIS_MIN, 'confirmFrames': CONFIRM_FRAMES, 'maxTracked': MAX_TRACKED,
    'smooth': SMOOTH, 'matchBodyFrac': MATCH_BODY_FRAC,
    'keepConfirmed': KEEP_CONFIRMED, 'keepUnconfirmed': KEEP_UNCONFIRMED,
    'pre': PRE, 'post': POST, 'groundWin': GROUND_WIN, 'histSec': HIST_SEC,
    'hipRatio': HIP_RATIO, 'minSamples': MIN_SAMPLES,
    'stillFrac': STILL_FRAC, 'bodyAdapt': BODY_ADAPT,
}
