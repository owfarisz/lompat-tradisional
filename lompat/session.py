"""Satu sesi permainan per koneksi WebSocket: frame masuk → pose → pelacakan → penilaian.

Format pesan dari browser (biner):
    [4 byte panjang header, little-endian][header JSON UTF-8][JPEG]
header = {
    "t": detik (jam browser saat frame diambil),
    "epoch": nomor permainan (berubah = permainan baru → pelacakan diulang),
    "phase": "lobby" | "play" | "over",
    "req": syarat tinggi saat ini untuk mode karet (proporsi tinggi badan) atau null,
    "judge": [{"key", "pid", "t", "req"}]  momen objek lewat di kaki yang perlu dinilai,
}
Balasan (JSON): lihat PoseSession.handle().
"""
import json
import time

from .pose import PoseEstimator, decode_jpeg
from .tracker import Tracker, make_detection

MAX_HEADER = 64 * 1024


def parse_frame(data):
    if len(data) < 4:
        raise ValueError('pesan terlalu pendek')
    n = int.from_bytes(data[:4], 'little')
    if n > MAX_HEADER or 4 + n > len(data):
        raise ValueError('header tidak valid')
    header = json.loads(data[4:4 + n].decode('utf-8'))
    return header, data[4 + n:]


class PoseSession:
    def __init__(self, estimator=None):
        self.pose = estimator or PoseEstimator()
        self.tracker = Tracker()
        self.epoch = None

    def handle(self, data):
        header, jpeg = parse_frame(data)
        epoch = header.get('epoch')
        if epoch != self.epoch:                   # permainan baru di browser
            self.epoch, self.tracker = epoch, Tracker()
        t = float(header['t'])
        rgb = decode_jpeg(jpeg)
        h, w = rgb.shape[:2]

        t0 = time.perf_counter()
        poses = self.pose.detect(rgb, t)
        infer_ms = (time.perf_counter() - t0) * 1000

        self.tracker.update([make_detection(lm, h) for lm in poses], t, header.get('phase', 'lobby'), w, h)
        req = header.get('req')
        judged = [{'key': j['key'], 'pid': j['pid'],
                   'result': self.tracker.judge(j['pid'], float(j['t']), float(j['req']))}
                  for j in header.get('judge', [])]
        return {'type': 'state', 'epoch': epoch, 't': t, 'w': w, 'h': h, 'req': req,
                'ms': round(infer_ms, 1), 'players': self.tracker.export(req), 'judged': judged}

    def close(self):
        self.pose.close()
