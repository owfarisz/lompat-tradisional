"""LOMPAT! – server Flask.

Jalankan:  python app.py   lalu buka http://localhost:8000
"""
import argparse
import json
import logging

import mediapipe as mp
from flask import Flask, jsonify, render_template
from flask_sock import Sock

from lompat import config as C
from lompat.pose import ensure_model
from lompat.session import PoseSession

app = Flask(__name__)
sock = Sock(app)
log = logging.getLogger('lompat')


@app.get('/')
def index():
    return render_template('index.html', client_config=C.CLIENT)


@app.get('/api/health')
def health():
    return jsonify(ok=True, mediapipe=mp.__version__, model=C.MODEL_PATH.name,
                   model_ready=C.MODEL_PATH.exists(), max_poses=C.MAX_POSES)


@sock.route('/ws/pose')
def pose_ws(ws):
    session = PoseSession()
    try:
        while True:
            data = ws.receive()
            if not isinstance(data, (bytes, bytearray)):
                continue
            try:
                out = session.handle(bytes(data))
            except Exception as e:                    # frame rusak: laporkan, koneksi tetap jalan
                log.exception('frame gagal diproses')
                out = {'type': 'error', 'message': str(e)}
            ws.send(json.dumps(out, separators=(',', ':')))
    finally:
        session.close()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Server LOMPAT!')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8000)   # 5000 sering dipakai AirPlay di macOS
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    ensure_model()
    print(f'LOMPAT! siap di http://localhost:{args.port}')
    app.run(host=args.host, port=args.port, threaded=True)
