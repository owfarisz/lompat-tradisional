"""Angka-angka pelacakan & penilaian lompatan.

Satu sumber untuk Python (server) dan JavaScript (mode browser/demo): nilai di
CLIENT dikirim ke halaman lewat template, jadi kedua sisi selalu sama.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------- Model MediaPipe ----------
MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
             'pose_landmarker_lite/float16/1/pose_landmarker_lite.task')
MODEL_PATH = BASE_DIR / 'models' / 'pose_landmarker_lite.task'
MAX_POSES = 6
MIN_CONFIDENCE = 0.5          # deteksi, kehadiran & pelacakan pose
FRAME_MAX = 640               # sisi terpanjang frame yang dikirim browser ke server (px)
JPEG_QUALITY = 0.7

# ---------- Pelacakan pemain ----------
VIS_MIN = 0.5                 # visibility minimum bahu & pergelangan kaki agar pemain dianggap terlihat
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
