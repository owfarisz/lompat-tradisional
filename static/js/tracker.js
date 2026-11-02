// Pelacakan pemain & penilaian lompatan di browser: dipakai mode "Kamera · browser" dan Demo.
// Versi server ada di lompat/tracker.py dengan logika yang sama.
import { CFG } from './config.js';

const MATCH_MIN_PX = 60, MIN_BODY_PX = 40;   // dalam piksel layar

// landmark ternormalisasi MediaPipe → deteksi dalam koordinat layar (cermin seperti kamera depan)
export function makeDetection(raw, r, W, H) {
  const lm = raw.map(p => ({ x: W - (r.dx + p.x * r.dw), y: r.dy + p.y * r.dh, v: p.visibility ?? 1 }));
  const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24], la = lm[27], ra = lm[28];
  const v = CFG.visMin;
  const ok = la.v > v && ra.v > v && ls.v > v && rs.v > v && la.y < H - 2 && ra.y < H - 2;
  return { lm, ok, x: (lh.x + rh.x) / 2, foot: Math.max(la.y, ra.y), hip: (lh.y + rh.y) / 2, sh: (ls.y + rs.y) / 2 };
}

export function newTrack(d, now) {
  return { confirmed: false, x: d.x, footY: d.foot, hipY: d.hip, shoulderY: d.sh, lm: d.lm,
           seenAt: now, frames: 1, visible: true, hist: [], bodyH: Math.max(MIN_BODY_PX, d.foot - d.sh),
           ground: null, lift: 0, hipLift: 0 };
}

// Pasangkan deteksi ke pemain terdekat (posisi pinggul). Mengembalikan daftar pemain yang baru.
// make(d) membuat objek pemain baru, onConfirm(p) dipanggil saat pemain terkonfirmasi.
export function assign(players, dets, now, phase, make, onConfirm) {
  const pairs = [];
  players.forEach((p, i) => dets.forEach((d, j) => {
    const dist = Math.abs(p.x - d.x);
    if (dist < Math.max(MATCH_MIN_PX, p.bodyH * CFG.matchBodyFrac)) pairs.push([dist, i, j]);
  }));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedP = new Set(), usedD = new Set();
  for (const [, i, j] of pairs) {
    if (usedP.has(i) || usedD.has(j)) continue;
    usedP.add(i); usedD.add(j); feed(players[i], dets[j], now, onConfirm);
  }
  players.forEach((p, i) => { if (!usedP.has(i)) { p.visible = false; p.lm = null; } });
  dets.forEach((d, j) => { if (!usedD.has(j) && d.ok && players.length < CFG.maxTracked) players.push(make(d)); });
  // buang deteksi palsu yang belum terkonfirmasi, dan pemain lobby yang sudah pergi
  return players.filter(p => p.confirmed ? (phase === 'play' || now - p.seenAt < CFG.keepConfirmed) : now - p.seenAt < CFG.keepUnconfirmed);
}
function feed(p, d, now, onConfirm) {
  p.lm = d.lm; p.visible = d.ok;
  if (!d.ok) return;
  const k = CFG.smooth;
  p.x = p.x * k + d.x * (1 - k);
  p.seenAt = now; p.frames++;
  if (!p.confirmed && p.frames >= CFG.confirmFrames) onConfirm(p);
  p.footY = p.footY * k + d.foot * (1 - k);   // perhalusan ringan agar titik kaki tidak bergetar
  p.hipY = p.hipY * k + d.hip * (1 - k);
  p.shoulderY = d.sh;
}

// Riwayat gerak per pemain → hitung lantai, tinggi angkat kaki & pinggul
export function track(p, t) {
  if (!p.visible) return;
  p.hist.push({ t, foot: p.footY, hip: p.hipY, lift: 0, hipLift: 0 });
  while (p.hist.length && p.hist[0].t < t - CFG.histSec) p.hist.shift();
  let gF = -Infinity, gH = -Infinity;
  for (const h of p.hist) if (h.t >= t - CFG.groundWin) { gF = Math.max(gF, h.foot); gH = Math.max(gH, h.hip); }
  p.ground = gF; p.lift = gF - p.footY; p.hipLift = gH - p.hipY;
  if (p.lift < CFG.stillFrac * p.bodyH) p.bodyH += ((p.footY - p.shoulderY) - p.bodyH) * CFG.bodyAdapt;
  const last = p.hist[p.hist.length - 1]; last.lift = p.lift; last.hipLift = p.hipLift;
}
// Lompatan sah = kedua kaki DAN pinggul ikut naik (bukan sekadar angkat satu kaki / titik bergetar)
export const isJump = (h, reqFrac, bodyH) => h.lift >= reqFrac * bodyH && h.hipLift >= CFG.hipRatio * reqFrac * bodyH;
export function cleared(p, t, reqFrac) {
  let n = 0, ok = false;
  for (const h of p.hist) {
    if (h.t < t - CFG.pre || h.t > t + CFG.post) continue;
    n++; if (isJump(h, reqFrac, p.bodyH)) ok = true;
  }
  return n >= CFG.minSamples ? ok : null;   // null = pemain tidak terlihat saat itu → tidak dinilai
}
