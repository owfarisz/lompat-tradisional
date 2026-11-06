"""Uji bagian fine-tuning yang tidak butuh torch: format label & data.yaml."""
import tempfile
import unittest
from pathlib import Path

from lompat.finetune import AUGMENT, _parse_aug, check_data_yaml, data_yaml, pose_label_line
from lompat.keypoints import FLIP_IDX, NUM_KPTS


class LabelTest(unittest.TestCase):
    def test_label_line(self):
        kpts = [(64.0, 36.0, 0.9)] * NUM_KPTS
        kpts[15] = (10.0, 10.0, 0.2)                      # tidak yakin → tidak dilabeli
        parts = pose_label_line((0, 0, 320, 180), kpts, 640, 360).split()
        self.assertEqual(len(parts), 1 + 4 + NUM_KPTS * 3)
        self.assertEqual(parts[0], '0')
        self.assertEqual([float(v) for v in parts[1:5]], [0.25, 0.25, 0.5, 0.5])
        self.assertEqual(parts[5:8], ['0.100000', '0.100000', '2'])
        self.assertEqual(parts[5 + 15 * 3:8 + 15 * 3], ['0', '0', '0'])

    def test_flip_idx_is_involution(self):
        self.assertEqual(len(FLIP_IDX), NUM_KPTS)
        self.assertEqual([FLIP_IDX[i] for i in FLIP_IDX], list(range(NUM_KPTS)))


class DataYamlTest(unittest.TestCase):
    def test_generated_yaml_passes_check(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'data.yaml'
            path.write_text(data_yaml(d))
            check_data_yaml(path, fliplr=AUGMENT['fliplr'])

    def test_missing_flip_idx_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'data.yaml'
            path.write_text('\n'.join(l for l in data_yaml(d).splitlines() if not l.startswith('flip_idx')))
            with self.assertRaises(SystemExit):
                check_data_yaml(path, fliplr=0.5)
            check_data_yaml(path, fliplr=0.0)            # tanpa flip, flip_idx tidak wajib

    def test_parse_aug(self):
        self.assertEqual(_parse_aug(['degrees=0', 'scale=0.3']), {'degrees': 0.0, 'scale': 0.3})
        with self.assertRaises(SystemExit):
            _parse_aug(['bogus=1'])


if __name__ == '__main__':
    unittest.main()
