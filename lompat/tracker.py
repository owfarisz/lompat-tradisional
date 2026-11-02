"""Pelacakan identitas pemain antar-frame dan penilaian lompatan.

Semua posisi dalam piksel frame kamera (y ke bawah). Waktu dalam detik, memakai
jam browser yang dikirim bersama tiap frame, sehingga momen objek lewat di kaki
(dihitung browser) dan riwayat gerak (dihitung di sini) memakai jam yang sama.
"""
from collections import deque
from dataclasses import dataclass

from . import config as C

# indeks landmark MediaPipe Pose
L_SH, R_SH, L_HIP, R_HIP, L_ANK, R_ANK = 11, 12, 23, 24, 27, 28


@dataclass
class Detection:
    lm: list          # 33 × (x, y, visibility)
    ok: bool          # bahu & kedua pergelangan kaki terlihat, kaki tidak terpotong tepi bawah
    x: float          # tengah pinggul
    foot: float       # kaki TERENDAH → kedua kaki harus terangkat agar dihitung melompat
    hip: float
    sh: float


def make_detection(lm, img_h):
    ls, rs, lh, rh, la, ra = (lm[i] for i in (L_SH, R_SH, L_HIP, R_HIP, L_ANK, R_ANK))
    ok = (all(p[2] > C.VIS_MIN for p in (la, ra, ls, rs))
          and la[1] < img_h - 2 and ra[1] < img_h - 2)
    return Detection(lm=lm, ok=ok, x=(lh[0] + rh[0]) / 2, foot=max(la[1], ra[1]),
                     hip=(lh[1] + rh[1]) / 2, sh=(ls[1] + rs[1]) / 2)


@dataclass
class Sample:
    t: float
    foot: float
    hip: float
    lift: float = 0.0
    hip_lift: float = 0.0


def is_jump(s, req, body_h):
    """Lompatan sah = kedua kaki DAN pinggul ikut naik (bukan sekadar angkat satu kaki / titik bergetar)."""
    return s.lift >= req * body_h and s.hip_lift >= C.HIP_RATIO * req * body_h


class Player:
    def __init__(self, pid, d, t, img_h):
        self.id = pid
        self.confirmed = False
        self.x, self.foot, self.hip, self.sh = d.x, d.foot, d.hip, d.sh
        self.lm = d.lm
        self.seen_at = t
        self.frames = 1
        self.visible = True
        self.hist = deque()
        self.body_h = max(C.MIN_BODY_FRAC * img_h, d.foot - d.sh)
        self.ground = None
        self.lift = 0.0
        self.hip_lift = 0.0

    def feed(self, d, t):
        self.lm, self.visible = d.lm, d.ok
        if not d.ok:
            return
        k = C.SMOOTH
        self.x = self.x * k + d.x * (1 - k)
        self.seen_at = t
        self.frames += 1
        if self.frames >= C.CONFIRM_FRAMES:
            self.confirmed = True
        self.foot = self.foot * k + d.foot * (1 - k)    # perhalusan ringan agar titik kaki tidak bergetar
        self.hip = self.hip * k + d.hip * (1 - k)
        self.sh = d.sh

    def track(self, t):
        """Riwayat gerak → lantai dinamis, tinggi angkat kaki & pinggul."""
        if not self.visible:
            return
        self.hist.append(Sample(t, self.foot, self.hip))
        while self.hist and self.hist[0].t < t - C.HIST_SEC:
            self.hist.popleft()
        recent = [h for h in self.hist if h.t >= t - C.GROUND_WIN]
        g_foot = max(h.foot for h in recent)
        g_hip = max(h.hip for h in recent)
        self.ground = g_foot
        self.lift = g_foot - self.foot
        self.hip_lift = g_hip - self.hip
        if self.lift < C.STILL_FRAC * self.body_h:
            self.body_h += ((self.foot - self.sh) - self.body_h) * C.BODY_ADAPT
        last = self.hist[-1]
        last.lift, last.hip_lift = self.lift, self.hip_lift

    def cleared(self, t, req):
        """True = lolos, False = kena, None = pemain tidak cukup terlihat saat itu → tidak dinilai."""
        n, ok = 0, False
        for h in self.hist:
            if t - C.PRE <= h.t <= t + C.POST:
                n += 1
                ok = ok or is_jump(h, req, self.body_h)
        return ok if n >= C.MIN_SAMPLES else None

    def jumping(self, req):
        """Apakah sampel terakhir sudah memenuhi syarat tinggi (dipakai mode karet)."""
        return bool(self.visible and self.hist and is_jump(self.hist[-1], req, self.body_h))


class Tracker:
    def __init__(self):
        self.players = []
        self._next_id = 1

    def update(self, dets, t, phase, img_w, img_h):
        players = self.players
        # pasangkan deteksi ke pemain terdekat (posisi pinggul), jarak terkecil lebih dulu
        pairs = []
        for i, p in enumerate(players):
            for j, d in enumerate(dets):
                dist = abs(p.x - d.x)
                if dist < max(C.MATCH_MIN_FRAC * img_w, p.body_h * C.MATCH_BODY_FRAC):
                    pairs.append((dist, i, j))
        pairs.sort()
        used_p, used_d = set(), set()
        for _, i, j in pairs:
            if i in used_p or j in used_d:
                continue
            used_p.add(i)
            used_d.add(j)
            players[i].feed(dets[j], t)
        for i, p in enumerate(players):
            if i not in used_p:
                p.visible, p.lm = False, None
        for j, d in enumerate(dets):
            if j not in used_d and d.ok and len(players) < C.MAX_TRACKED:
                players.append(Player(self._next_id, d, t, img_h))
                self._next_id += 1
        # buang deteksi palsu yang belum terkonfirmasi, dan pemain lobby yang sudah pergi
        def keep(p):
            if p.confirmed:
                return phase == 'play' or t - p.seen_at < C.KEEP_CONFIRMED
            return t - p.seen_at < C.KEEP_UNCONFIRMED
        self.players = [p for p in players if keep(p)]
        for p in self.players:
            p.track(t)

    def get(self, pid):
        return next((p for p in self.players if p.id == pid), None)

    def judge(self, pid, t, req):
        p = self.get(pid)
        return p.cleared(t, req) if p else None

    def export(self, req=None):
        out = []
        for p in self.players:
            out.append({
                'id': p.id, 'confirmed': p.confirmed, 'visible': p.visible,
                'x': p.x, 'foot': p.foot, 'hip': p.hip, 'sh': p.sh,
                'ground': p.ground, 'body_h': p.body_h, 'lift': p.lift, 'hip_lift': p.hip_lift,
                'jump': p.jumping(req) if req else False,
                'jump_t': p.hist[-1].t if p.hist else None,
                'lm': [[round(x, 1), round(y, 1), round(v, 2)] for x, y, v in p.lm] if p.lm else None,
            })
        return out
