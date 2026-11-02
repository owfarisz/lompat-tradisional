// Klien WebSocket ke server Flask: kirim frame kamera, terima posisi pemain & hasil penilaian
import { CFG } from './config.js';

const TIMEOUT_MS = 2000;

export class ServerPose {
  constructor() {
    this.ws = null; this.busy = false; this.sentAt = 0; this.lastVideoTime = -1;
    this.epoch = 0; this.seq = 0; this.queue = []; this.callbacks = new Map();
    this.ms = 0; this.rtt = 0;
    this.onState = null; this.onClose = null;
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
  }

  get ready() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/pose`);
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('server Flask tidak bisa dihubungi'));
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.busy = false; this.onClose?.(); } };
      ws.onmessage = (e) => this.receive(JSON.parse(e.data));
    });
  }

  // permainan baru: pelacakan di server diulang, balasan dari permainan lama diabaikan
  reset() { this.epoch++; this.queue = []; this.callbacks.clear(); this.busy = false; }

  // minta server menilai apakah pemain pid melompat cukup tinggi di sekitar waktu t
  judge(pid, t, req, cb) {
    const key = ++this.seq;
    this.queue.push({ key, pid, t, req }); this.callbacks.set(key, cb);
  }

  // dipanggil tiap frame animasi; kirim satu frame setiap balasan sebelumnya sudah datang
  pump(video, header) {
    if (!this.ready) return;
    if (this.busy && performance.now() - this.sentAt < TIMEOUT_MS) return;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.min(1, CFG.frameMax / Math.max(vw, vh));
    this.canvas.width = Math.round(vw * s); this.canvas.height = Math.round(vh * s);
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    this.busy = true; this.sentAt = performance.now();
    const head = new TextEncoder().encode(JSON.stringify({ ...header, epoch: this.epoch, judge: this.queue.splice(0) }));
    const ws = this.ws;
    this.canvas.toBlob(async (blob) => {
      if (!blob || ws !== this.ws || ws.readyState !== WebSocket.OPEN) { this.busy = false; return; }
      const jpg = new Uint8Array(await blob.arrayBuffer());
      const msg = new Uint8Array(4 + head.length + jpg.length);
      new DataView(msg.buffer).setUint32(0, head.length, true);
      msg.set(head, 4); msg.set(jpg, 4 + head.length);
      ws.send(msg);
    }, 'image/jpeg', CFG.jpegQuality);
  }

  receive(st) {
    this.busy = false; this.rtt = performance.now() - this.sentAt;
    if (st.type === 'error') { console.warn('server:', st.message); return; }
    if (st.epoch !== this.epoch) return;
    this.ms = st.ms;
    this.onState?.(st);
    for (const j of st.judged) {
      const cb = this.callbacks.get(j.key);
      this.callbacks.delete(j.key);
      cb?.(j.result);
    }
  }
}
