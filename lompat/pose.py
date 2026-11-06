"""Estimasi pose dengan YOLO-pose (Ultralytics), 17 titik COCO."""
import io
import urllib.request

import numpy as np
from PIL import Image

from . import config as C


def ensure_model(path=C.BASE_MODEL_PATH, url=C.BASE_MODEL_URL):
    """Unduh model dasar sekali (±6 MB) kalau belum ada di folder models/."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.part')
    print(f'Mengunduh model pose ke {path} …')
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(path)
    return path


def decode_jpeg(data):
    """JPEG → array RGB (tinggi × lebar × 3)."""
    return np.asarray(Image.open(io.BytesIO(data)).convert('RGB'))


def load_yolo(path=None):
    from ultralytics import YOLO           # impor lambat: torch berat, tes logika tidak membutuhkannya
    path = path or C.model_path()
    if path == C.BASE_MODEL_PATH:
        ensure_model()
    return YOLO(str(path))


def keypoints_to_poses(kpts):
    """Tensor/array (N × 17 × 3) → daftar pose; tiap pose = 17 × (x, y, keyakinan) dalam piksel."""
    if kpts is None:
        return []
    arr = kpts.cpu().numpy() if hasattr(kpts, 'cpu') else np.asarray(kpts)
    return [[(float(x), float(y), float(c)) for x, y, c in pose[:, :3]] for pose in arr]


class PoseEstimator:
    """Satu instance per koneksi. YOLO mendeteksi per frame, tanpa status antar-frame."""

    def __init__(self, model_path=None):
        self._model = load_yolo(model_path)

    def detect(self, rgb, t=None):
        """Kembalikan daftar pose; tiap pose = 17 × (x, y, keyakinan) dalam piksel frame."""
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])   # Ultralytics menganggap array numpy berformat BGR
        result = self._model.predict(bgr, imgsz=C.IMGSZ, conf=C.DETECT_CONF, max_det=C.MAX_POSES,
                                     classes=[0], verbose=False)[0]
        if result.keypoints is None:
            return []
        return keypoints_to_poses(result.keypoints.data)

    def close(self):
        self._model = None
