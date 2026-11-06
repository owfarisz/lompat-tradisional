"""Uji logika pelacakan & penilaian lompatan dengan pose buatan (tanpa kamera).

Jalankan:  python -m unittest discover tests
"""
import unittest

from lompat import config as C
from lompat.tracker import Tracker, make_detection

IMG_W, IMG_H = 640, 360
FPS = 30


def pose(x, foot, body_h=200, left_foot=None, hip_drop=0.0, vis=0.9):
    """17 keypoint COCO sederhana: bahu, pinggul, pergelangan kaki; sisanya di pinggul."""
    sh, hip = foot - body_h, foot - body_h / 2 - hip_drop
    lm = [(x, hip, vis)] * 17
    lm[5], lm[6] = (x - 20, sh, vis), (x + 20, sh, vis)
    lm[11], lm[12] = (x - 12, hip, vis), (x + 12, hip, vis)
    lm[15] = (x - 10, foot if left_foot is None else left_foot, vis)
    lm[16] = (x + 10, foot, vis)
    return lm


def run(tracker, frames, t0=0.0, phase='play'):
    """frames: daftar (daftar pose) per frame. Mengembalikan waktu frame terakhir."""
    t = t0
    for poses in frames:
        tracker.update([make_detection(lm, IMG_H) for lm in poses], t, phase, IMG_W, IMG_H)
        t += 1 / FPS
    return t - 1 / FPS


def stand(n, x=320, foot=330):
    return [[pose(x, foot)] for _ in range(n)]


class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.tr = Tracker()

    def confirmed_player(self):
        t = run(self.tr, stand(FPS * 2))      # 2 dtk berdiri → terkonfirmasi & lantai terbentuk
        self.assertEqual(len(self.tr.players), 1)
        p = self.tr.players[0]
        self.assertTrue(p.confirmed)
        return p, t

    def test_confirm_after_frames(self):
        run(self.tr, stand(C.CONFIRM_FRAMES - 1))
        self.assertFalse(self.tr.players[0].confirmed)
        run(self.tr, stand(1), t0=1.0)
        self.assertTrue(self.tr.players[0].confirmed)

    def test_standing_still_is_not_a_jump(self):
        p, t = self.confirmed_player()
        t = run(self.tr, stand(FPS), t0=t + 1 / FPS)
        self.assertIs(self.tr.judge(p.id, t - 0.3, 0.07), False)

    def test_real_jump_is_cleared(self):
        p, t = self.confirmed_player()
        jump = [[pose(320, 330 - h, hip_drop=0)] for h in (10, 30, 50, 60, 50, 30, 10, 0)]
        t_jump = t + 1 / FPS
        t = run(self.tr, jump + stand(FPS), t0=t_jump)
        self.assertIs(self.tr.judge(p.id, t_jump + 3 / FPS, 0.07), True)   # puncak 60 px = 30% tinggi badan

    def test_one_foot_raised_is_not_a_jump(self):
        p, t = self.confirmed_player()
        t_lift = t + 1 / FPS
        t = run(self.tr, [[pose(320, 330, left_foot=270)] for _ in range(8)] + stand(FPS), t0=t_lift)
        self.assertIs(self.tr.judge(p.id, t_lift + 4 / FPS, 0.07), False)

    def test_feet_up_without_hips_is_not_a_jump(self):
        p, t = self.confirmed_player()
        t_tuck = t + 1 / FPS
        # kaki naik 40 px tetapi pinggul tetap di tempat (mis. duduk/menekuk lutut di depan kamera)
        tuck = [[pose(320, 290, body_h=160, hip_drop=-20)] for _ in range(8)]
        t = run(self.tr, tuck + stand(FPS), t0=t_tuck)
        self.assertIs(self.tr.judge(p.id, t_tuck + 4 / FPS, 0.07), False)

    def test_not_visible_means_not_judged(self):
        p, t = self.confirmed_player()
        t_gone = t + 1 / FPS
        t = run(self.tr, [[] for _ in range(FPS)], t0=t_gone)
        self.assertIsNone(self.tr.judge(p.id, t_gone + 0.4, 0.07))

    def test_identities_stay_with_their_position(self):
        frames = [[pose(120, 330), pose(500, 330)] for _ in range(FPS)]
        run(self.tr, frames)
        left = min(self.tr.players, key=lambda p: p.x)
        right = max(self.tr.players, key=lambda p: p.x)
        # urutan deteksi dibalik → pemain tetap dikenali dari posisinya
        run(self.tr, [[pose(500, 330), pose(120, 330)] for _ in range(5)], t0=1.0)
        self.assertLess(abs(self.tr.get(left.id).x - 120), 1)
        self.assertLess(abs(self.tr.get(right.id).x - 500), 1)

    def test_feet_cut_off_by_frame_not_ok(self):
        d = make_detection(pose(320, IMG_H - 1), IMG_H)
        self.assertFalse(d.ok)

    def test_lobby_drops_players_who_left(self):
        t = run(self.tr, stand(FPS), phase='lobby')
        run(self.tr, [[] for _ in range(4)], t0=t + C.KEEP_CONFIRMED + 0.1, phase='lobby')
        self.assertEqual(self.tr.players, [])

    def test_play_keeps_confirmed_players(self):
        t = run(self.tr, stand(FPS), phase='play')
        run(self.tr, [[] for _ in range(4)], t0=t + C.KEEP_CONFIRMED + 0.1, phase='play')
        self.assertEqual(len(self.tr.players), 1)


if __name__ == '__main__':
    unittest.main()
