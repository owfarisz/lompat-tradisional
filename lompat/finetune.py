"""Fine-tuning YOLO-pose dengan rekaman dari tempat bermain sendiri.

Alur:
  1. python -m lompat.finetune prepare rekaman1.mp4 rekaman2.mp4 foto/ --out datasets/lompat
       Ambil frame (diperkecil ke FRAME_MAX seperti yang dikirim browser), bagi train/val,
       lalu beri label awal memakai model yang sedang dipakai server.
  2. Periksa & perbaiki label di alat anotasi yang mendukung format YOLO pose
     (mis. CVAT → "Ultralytics YOLO Pose"). Label awal hanya titik yang yakin; sisanya kosong.
  3. python -m lompat.finetune train --data datasets/lompat/data.yaml
       Latih dari model dasar, bandingkan dengan model dasar pada data val, lalu pasang
       ke models/pose-finetuned.pt (otomatis dipakai server) hanya kalau lebih baik.

Fungsi prepare() dan train() juga bisa dipanggil langsung dari Python.
"""
import argparse
import shutil
from pathlib import Path

from . import config as C
from .keypoints import FLIP_IDX, NUM_KPTS

VIDEO_EXT = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

# Augmentasi saat pelatihan (argumen Ultralytics), disesuaikan untuk kamera tetap & orang berdiri/melompat.
AUGMENT = {
    'hsv_h': 0.015, 'hsv_s': 0.6, 'hsv_v': 0.5,   # cahaya: pagi/sore, dalam/luar ruangan
    'degrees': 5.0,                               # kamera sedikit miring; orang tetap tegak
    'translate': 0.1,
    'scale': 0.5,                                 # pemain dekat & jauh dari kamera
    'fliplr': 0.5,                                # wajib flip_idx di data.yaml agar kiri↔kanan ikut bertukar
    'flipud': 0.0,                                # orang tidak pernah terbalik
    'mosaic': 1.0, 'close_mosaic': 10,
    'mixup': 0.0,
}


# ---------- Label ----------

def pose_label_line(box, kpts, w, h, vis_min=C.VIS_MIN):
    """Satu baris label YOLO pose: kelas, kotak (cx cy w h), lalu 17 × (x y v), semua dinormalisasi.

    box = (x1, y1, x2, y2) piksel; kpts = 17 × (x, y, keyakinan) piksel.
    v = 2 (terlihat) kalau keyakinan ≥ vis_min, selain itu 0 (tidak dilabeli, diabaikan saat latihan).
    """
    x1, y1, x2, y2 = (float(v) for v in box)
    parts = ['0', *(f'{v:.6f}' for v in ((x1 + x2) / 2 / w, (y1 + y2) / 2 / h, (x2 - x1) / w, (y2 - y1) / h))]
    for x, y, c in kpts:
        parts.append(f'{float(x) / w:.6f} {float(y) / h:.6f} 2' if c >= vis_min else '0 0 0')
    return ' '.join(parts)


def data_yaml(root):
    return '\n'.join([
        f'path: {Path(root).resolve()}',
        'train: images/train',
        'val: images/val',
        f'kpt_shape: [{NUM_KPTS}, 3]',
        f'flip_idx: {FLIP_IDX}',
        'names:',
        '  0: person',
        '',
    ])


def check_data_yaml(path, fliplr):
    import yaml
    d = yaml.safe_load(Path(path).read_text())
    if list(d.get('kpt_shape', [])) != [NUM_KPTS, 3]:
        raise SystemExit(f'{path}: kpt_shape harus [{NUM_KPTS}, 3] (urutan COCO), bukan {d.get("kpt_shape")}')
    if fliplr > 0 and list(d.get('flip_idx', [])) != FLIP_IDX:
        raise SystemExit(f'{path}: fliplr > 0 butuh flip_idx: {FLIP_IDX}, '
                         'kalau tidak label kiri/kanan tertukar pada gambar yang dicerminkan')


# ---------- Persiapan dataset ----------

def _resize(img, size=C.FRAME_MAX):
    import cv2
    h, w = img.shape[:2]
    s = min(1.0, size / max(h, w))
    return img if s == 1.0 else cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)


def _frames(src, every):
    """Hasilkan (nama, gambar BGR) dari video (tiap `every` frame), folder gambar, atau satu gambar."""
    import cv2
    src = Path(src)
    if src.is_dir():
        for f in sorted(p for p in src.iterdir() if p.suffix.lower() in IMAGE_EXT):
            yield from _frames(f, every)
    elif src.suffix.lower() in VIDEO_EXT:
        cap = cv2.VideoCapture(str(src))
        i = 0
        while True:
            ok, img = cap.read()
            if not ok:
                break
            if i % every == 0:
                yield f'{src.stem}_{i:06d}', img
            i += 1
        cap.release()
    elif src.suffix.lower() in IMAGE_EXT:
        img = cv2.imread(str(src))
        if img is not None:
            yield src.stem, img
    else:
        raise SystemExit(f'{src}: bukan video, gambar, atau folder gambar')


def prepare(sources, out, every=5, val=0.2, prelabel=True, model_path=None):
    """Bangun dataset YOLO pose di `out` dan kembalikan path data.yaml.

    Per sumber, bagian AKHIR (proporsi `val`) masuk val, bukan acak: frame berurutan dari video
    hampir identik, jadi pembagian acak membuat nilai val terlalu optimis.
    """
    import cv2
    out = Path(out)
    model = None
    if prelabel:
        from .pose import load_yolo
        model = load_yolo(model_path)

    counts = {'train': 0, 'val': 0}
    for src in sources:
        frames = list(_frames(src, every))
        n_val = round(len(frames) * val) if len(frames) > 1 else 0
        for i, (name, img) in enumerate(frames):
            split = 'val' if i >= len(frames) - n_val else 'train'
            img = _resize(img)
            h, w = img.shape[:2]
            (out / 'images' / split).mkdir(parents=True, exist_ok=True)
            (out / 'labels' / split).mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out / 'images' / split / f'{name}.jpg'), img,
                        [cv2.IMWRITE_JPEG_QUALITY, round(C.JPEG_QUALITY * 100)])
            lines = []
            if model is not None:
                r = model.predict(img, imgsz=C.IMGSZ, conf=C.DETECT_CONF, max_det=C.MAX_POSES,
                                  classes=[0], verbose=False)[0]
                if r.keypoints is not None:
                    for box, kp in zip(r.boxes.xyxy.cpu().numpy(), r.keypoints.data.cpu().numpy()):
                        lines.append(pose_label_line(box, kp, w, h))
            (out / 'labels' / split / f'{name}.txt').write_text('\n'.join(lines) + ('\n' if lines else ''))
            counts[split] += 1

    yaml_path = out / 'data.yaml'
    yaml_path.write_text(data_yaml(out))
    print(f'{counts["train"]} gambar train, {counts["val"]} gambar val → {yaml_path}')
    if counts['val'] == 0:
        print('Peringatan: val kosong. Pakai video atau lebih dari satu gambar per sumber.')
    if prelabel:
        print('Label awal dibuat oleh model; periksa & perbaiki dulu sebelum melatih.')
    return yaml_path


# ---------- Pelatihan ----------

def _pose_map(weights, data, device):
    from ultralytics import YOLO
    m = YOLO(str(weights)).val(data=str(data), imgsz=C.IMGSZ, device=device, plots=False, verbose=False)
    return m.pose.map50, m.pose.map


def train(data, base=None, epochs=50, batch=16, device=None, patience=15, augment=None,
          install=True, force=False):
    """Fine-tune dari `base` (default: model dasar), bandingkan pada val, pasang kalau lebih baik.

    Mengembalikan path best.pt hasil pelatihan.
    """
    from ultralytics import YOLO
    from .pose import ensure_model

    aug = {**AUGMENT, **(augment or {})}
    check_data_yaml(data, aug['fliplr'])
    base = Path(base) if base else ensure_model()

    model = YOLO(str(base))
    model.train(data=str(data), epochs=epochs, imgsz=C.IMGSZ, batch=batch, device=device,
                patience=patience, project=str(C.BASE_DIR / 'runs' / 'pose'), name='finetune', **aug)
    best = Path(model.trainer.best)

    base_map = _pose_map(base, data, device)
    new_map = _pose_map(best, data, device)
    print(f'pose mAP50 / mAP50-95 pada val:  dasar {base_map[0]:.3f} / {base_map[1]:.3f}'
          f'   fine-tuned {new_map[0]:.3f} / {new_map[1]:.3f}')

    if not install:
        print(f'Tidak dipasang (--no-install). Bobot: {best}')
    elif new_map[1] >= base_map[1] or force:
        C.FINETUNED_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, C.FINETUNED_MODEL_PATH)
        print(f'Dipasang ke {C.FINETUNED_MODEL_PATH}; server memakainya setelah dijalankan ulang.')
    else:
        print(f'Tidak dipasang: hasil fine-tuning lebih buruk dari model dasar (pakai --force untuk tetap memasang). '
              f'Bobot: {best}')
    return best


# ---------- CLI ----------

def _parse_aug(items):
    out = {}
    for item in items:
        k, _, v = item.partition('=')
        if k not in AUGMENT or not v:
            raise SystemExit(f'--aug {item}: pakai kunci=nilai, kunci salah satu dari {", ".join(AUGMENT)}')
        out[k] = float(v)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog='python -m lompat.finetune', description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('prepare', help='video/gambar → dataset YOLO pose berlabel awal')
    p.add_argument('sources', nargs='+', help='file video, file gambar, atau folder gambar')
    p.add_argument('--out', default=str(C.BASE_DIR / 'datasets' / 'lompat'))
    p.add_argument('--every', type=int, default=5, help='ambil 1 dari tiap N frame video (default 5)')
    p.add_argument('--val', type=float, default=0.2, help='proporsi val per sumber (default 0.2)')
    p.add_argument('--no-prelabel', action='store_true', help='jangan beri label awal (label file kosong)')
    p.add_argument('--model', help='bobot untuk label awal (default: model yang dipakai server)')

    t = sub.add_parser('train', help='fine-tune YOLO-pose dan pasang hasilnya')
    t.add_argument('--data', required=True, help='data.yaml dari langkah prepare')
    t.add_argument('--base', help=f'bobot awal (default: {C.BASE_MODEL_PATH.name})')
    t.add_argument('--epochs', type=int, default=50)
    t.add_argument('--batch', type=int, default=16)
    t.add_argument('--patience', type=int, default=15, help='berhenti kalau val tidak membaik N epoch')
    t.add_argument('--device', help='mis. cpu, 0, mps (default: otomatis)')
    t.add_argument('--aug', action='append', default=[], metavar='KUNCI=NILAI',
                   help='timpa augmentasi, mis. --aug degrees=0 --aug scale=0.3')
    t.add_argument('--no-install', action='store_true', help='jangan salin ke models/pose-finetuned.pt')
    t.add_argument('--force', action='store_true', help='pasang walaupun lebih buruk dari model dasar')

    a = ap.parse_args(argv)
    if a.cmd == 'prepare':
        prepare(a.sources, a.out, every=a.every, val=a.val, prelabel=not a.no_prelabel,
                model_path=Path(a.model) if a.model else None)
    else:
        train(a.data, base=a.base, epochs=a.epochs, batch=a.batch, device=a.device, patience=a.patience,
              augment=_parse_aug(a.aug), install=not a.no_install, force=a.force)


if __name__ == '__main__':
    main()
