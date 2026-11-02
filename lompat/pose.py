"""Estimasi pose dengan MediaPipe Pose Landmarker (Python)."""
import io
import urllib.request

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
from PIL import Image

from . import config as C


def ensure_model(path=C.MODEL_PATH, url=C.MODEL_URL):
    """Unduh model sekali (±5,8 MB) kalau belum ada di folder models/."""
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


class PoseEstimator:
    """Satu instance per koneksi: mode VIDEO menyimpan status pelacakan antar-frame."""

    def __init__(self, model_path=C.MODEL_PATH):
        options = vision.PoseLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=C.MAX_POSES,
            min_pose_detection_confidence=C.MIN_CONFIDENCE,
            min_pose_presence_confidence=C.MIN_CONFIDENCE,
            min_tracking_confidence=C.MIN_CONFIDENCE,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_ts = -1

    def detect(self, rgb, t):
        """Kembalikan daftar pose; tiap pose = 33 × (x, y, visibility) dalam piksel frame."""
        ts = max(self._last_ts + 1, int(t * 1000))   # MediaPipe mewajibkan timestamp yang terus naik
        self._last_ts = ts
        h, w = rgb.shape[:2]
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect_for_video(image, ts)
        return [[(p.x * w, p.y * h, 1.0 if p.visibility is None else p.visibility) for p in pose]
                for pose in result.pose_landmarks]

    def close(self):
        self._landmarker.close()
