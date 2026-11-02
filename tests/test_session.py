"""Uji jalur lengkap server: pesan biner → MediaPipe → balasan JSON."""
import io
import json
import unittest

from PIL import Image

from lompat import config as C
from lompat.session import PoseSession, parse_frame


def message(header, jpeg):
    head = json.dumps(header).encode()
    return len(head).to_bytes(4, 'little') + head + jpeg


def blank_jpeg(w=640, h=360):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (40, 40, 40)).save(buf, 'JPEG')
    return buf.getvalue()


class ParseTest(unittest.TestCase):
    def test_roundtrip(self):
        header, jpeg = parse_frame(message({'t': 1.5}, b'abc'))
        self.assertEqual(header, {'t': 1.5})
        self.assertEqual(jpeg, b'abc')

    def test_bad_length(self):
        with self.assertRaises(ValueError):
            parse_frame((999).to_bytes(4, 'little') + b'{}')


@unittest.skipUnless(C.MODEL_PATH.exists(), 'model belum diunduh (jalankan python app.py sekali)')
class SessionTest(unittest.TestCase):
    def test_empty_frame(self):
        s = PoseSession()
        try:
            judge = [{'key': 1, 'pid': 99, 't': 1.0, 'req': 0.07}]
            out = s.handle(message({'t': 1.0, 'epoch': 1, 'phase': 'lobby', 'req': None, 'judge': judge}, blank_jpeg()))
            self.assertEqual(out['type'], 'state')
            self.assertEqual((out['w'], out['h']), (640, 360))
            self.assertEqual(out['players'], [])
            self.assertEqual(out['judged'], [{'key': 1, 'pid': 99, 'result': None}])
            # timestamp yang sama/mundur tidak membuat MediaPipe error
            s.handle(message({'t': 1.0, 'epoch': 1}, blank_jpeg()))
        finally:
            s.close()


if __name__ == '__main__':
    unittest.main()
