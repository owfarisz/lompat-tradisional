import { CFG, MODES, COLORS, LIVES, REQ_TALI, KARET_LEVELS, KARET_ROUND } from './config.js';
import { makeDetection, newTrack, assign, track, isJump, cleared } from './tracker.js';
import { BrowserPose } from './pose-browser.js';
import { ServerPose } from './pose-server.js';

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d'), video = $('#video');
let W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = 'round';   // tanpa ini garis tepi teks tebal memunculkan "duri" di sudut huruf
}
addEventListener('resize', resize); resize();
// skala UI di canvas: 1 di laptop, mengecil di layar HP
const ui = () => Math.max(0.62, Math.min(1, Math.min(W, H) / 700));
const TOUCH = matchMedia('(pointer: coarse)').matches;
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

// ---------- State ----------
// input: server (kamera → Flask) | browser (kamera → MediaPipe di browser) | demo
const S = { mode: 'tali', input: 'server', phase: 'menu', now: 0, start: 0, lobbyAt: 0, game: 0 };
// phase: menu | lobby | play | over
let players = [], numCounter = 0, fx = [], flash = 0;
let T, K, B, events = [];

const elapsed = () => S.now - S.start;
const active = () => players.filter(p => p.confirmed);
const alive = () => active().filter(p => p.lives > 0);
const isCamera = () => S.input !== 'demo';

// ---------- Kamera + pose ----------
const browserPose = new BrowserPose(), server = new ServerPose();
let camReady = false;
async function initCamera() {
  const status = $('#status');
  if (!camReady) {
    status.textContent = 'Menyalakan kamera…';
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    await video.play();
    camReady = true;
  }
  if (S.input === 'server' && !server.ready) {
    status.textContent = 'Menghubungkan ke server Flask…';
    await server.connect();
  }
  if (S.input === 'browser' && !browserPose.ready) {
    status.textContent = 'Memuat model pose (MediaPipe di browser)…';
    await browserPose.init();
  }
  status.textContent = '';
}

// Video digambar "cover" & dicerminkan seperti filter kamera depan
function videoRect() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const sc = Math.max(W / vw, H / vh), dw = vw * sc, dh = vh * sc;
  return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
}

function updateCamera(nowMs) {
  if (S.input === 'server') {
    server.pump(video, { t: S.now, phase: S.phase, req: S.mode === 'karet' && K.round ? K.round.h : null });
    return;
  }
  const raws = browserPose.detect(video, nowMs);
  if (!raws) return;
  const r = videoRect();
  players = assign(players, raws.map(raw => makeDetection(raw, r, W, H)), S.now, S.phase, newPlayer, confirm);
}

// Balasan server (koordinat piksel frame) → pemain di koordinat layar
server.onState = (st) => {
  const r = videoRect(), sc = r.dw / st.w;
  const X = x => W - (r.dx + x * sc), Y = y => r.dy + y * sc;
  const seen = new Set();
  for (const s of st.players) {
    let p = players.find(q => q.sid === s.id);
    if (!p) { p = newPlayer({ x: X(s.x), foot: Y(s.foot), hip: Y(s.hip), sh: Y(s.sh), lm: null }); p.sid = s.id; players.push(p); }
    seen.add(s.id);
    p.x = X(s.x); p.footY = Y(s.foot); p.hipY = Y(s.hip); p.shoulderY = Y(s.sh);
    p.ground = s.ground == null ? null : Y(s.ground);
    p.bodyH = s.body_h * sc; p.lift = s.lift * sc; p.hipLift = s.hip_lift * sc;
    p.visible = s.visible; p.seenAt = S.now;
    p.lm = s.lm && s.lm.map(([x, y, v]) => ({ x: X(x), y: Y(y), v }));
    p.jump = s.jump; p.jumpT = s.jump_t; p.jumpReq = st.req;
    if (s.confirmed && !p.confirmed) confirm(p);
  }
  players = players.filter(p => seen.has(p.sid));
};

function newPlayer(d) {
  return { ...newTrack(d, S.now), num: 0, color: '#94a3b8', score: 0, lives: LIVES, joinedAt: S.now,
           karetOk: false, karetSeen: false, bot: null, plan: null, sid: null, jump: false, jumpT: null, jumpReq: null };
}
function confirm(p) {
  p.confirmed = true; p.num = ++numCounter; p.color = COLORS[(p.num - 1) % COLORS.length];
  p.joinedAt = S.now; p.lives = LIVES; p.score = 0;
  if (S.phase === 'play') addFx(`P${p.num} ikut main!`, p.color, p.x, p.footY - p.bodyH * 1.4);
  renderBoard();
}

// Penilaian lompatan: di server (Python) untuk mode server, langsung di browser untuk mode lain
function judge(p, t, req, cb) {
  if (S.input !== 'server') return cb(cleared(p, t, req));
  const game = S.game;
  server.judge(p.sid, t, req, r => { if (S.game === game && S.phase === 'play') cb(r); });
}
function jumpedSince(p, req, since) {
  if (S.input === 'server') return p.jump && p.jumpReq === req && p.jumpT >= since;
  const last = p.hist[p.hist.length - 1];
  return !!last && last.t >= since && isJump(last, req, p.bodyH);
}
const eligible = (p, t) => p.confirmed && p.lives > 0 && p.joinedAt < t - 1.5;

// ---------- Mode demo (kamu + 2 bot) ----------
function setupDemo() {
  players = []; numCounter = 0;
  [[0.5, false], [0.2, true], [0.8, true]].forEach(([fx, isBot]) => {
    const bh = demoBodyH(), base = H * 0.88;
    const p = newPlayer({ x: W * fx, foot: base, hip: base - bh * 0.5, sh: base - bh, lm: null });
    p.bot = { y: 0, vy: 0, auto: isBot, fx, delay: 0 };
    confirm(p); p.joinedAt = S.now - 5;
    players.push(p);
  });
}
function botJump(p) { if (p.bot.y <= 0.5) p.bot.vy = 2.2 * p.bodyH; }
const demoBodyH = () => Math.min(H * 0.36, W * 0.42);   // di layar sempit (portrait) stickman diperkecil agar tidak bertabrakan
function updateDemo(dt) {
  for (const p of players) {
    const b = p.bot, bh = demoBodyH(), base = H * 0.88;
    p.bodyH = bh; p.x = W * b.fx;
    if (b.auto && S.phase === 'play' && p.lives > 0) botThink(p);
    b.vy -= 8 * bh * dt; b.y = Math.max(0, b.y + b.vy * dt); if (b.y === 0) b.vy = 0;
    p.visible = true; p.seenAt = S.now;
    p.footY = base - b.y; p.hipY = p.footY - bh * 0.5; p.shoulderY = p.footY - bh;
  }
}
function botThink(p) {
  let te = null;
  if (S.mode === 'tali') te = T.cycleStart + T.period;
  if (S.mode === 'batu') for (const s of B.stones) { const tp = stoneTime(s, p); if (tp > S.now && !s.done.has(p) && (te == null || tp < te)) te = tp; }
  if (S.mode === 'karet' && K.round && !p.karetOk) te = K.round.start + 0.6 + (p.num * 0.7) % 2;
  if (te == null || te - S.now > 0.2 || p.plan === te) return;
  p.plan = te;
  if (Math.random() < 0.88) botJump(p);
}

// ---------- Alur permainan ----------
function startGame() {
  S.now = performance.now() / 1000;
  S.game++; server.reset();
  fx = []; events = []; numCounter = 0; players = [];
  T = { period: 2.2, cycleStart: S.now - 1.1 };
  K = { level: 0, rounds: 0, round: null, nextAt: 0 };
  B = { stones: [], nextSpawn: 0 };
  $('#menu').classList.add('hidden'); $('#over').classList.add('hidden'); $('#hud').classList.remove('hidden');
  $('#hNet').classList.toggle('hidden', S.input !== 'server');
  if (S.input === 'demo') { setupDemo(); beginPlay(); }
  else { S.phase = 'lobby'; S.lobbyAt = 0; }
  renderBoard(); updateHud();
}
function beginPlay() {
  S.now = performance.now() / 1000;
  S.phase = 'play'; S.start = S.now; $('#msg').textContent = '';
  T.cycleStart = S.now - 0.2; T.period = 2.2;          // putaran pertama: ±2 detik untuk bersiap
  K.nextAt = S.now + 1.5; B.nextSpawn = S.now + 1.5;
  for (const p of active()) { p.joinedAt = Math.min(p.joinedAt, S.now - 1.5); p.lives = LIVES; p.score = 0; }
  addFx('MULAI!', '#f59e0b', W / 2, H * 0.4);
}
function toMenu() {
  S.phase = 'menu'; $('#menu').classList.remove('hidden'); $('#over').classList.add('hidden');
  $('#hud').classList.add('hidden'); $('#msg').textContent = ''; $('#board').innerHTML = '';
}
function gameOver() {
  S.phase = 'over'; $('#msg').textContent = '';
  const ranked = active().sort((a, b) => b.score - a.score);
  $('#oInfo').textContent = MODES[S.mode] + (S.mode === 'karet' ? ` · sampai Level ${K.level + 1}` : '') + ` · ${elapsed().toFixed(0)} detik`;
  $('#rank').innerHTML = ranked.map((p, i) =>
    `<div class="r"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span class="dot" style="background:${p.color}"></span>P${p.num}${p.bot?.auto ? ' (bot)' : ''}<span class="sc">${p.score}</span></div>`).join('');
  $('#over').classList.remove('hidden');
}

function pass(p) {
  p.score++; beep(880, 0.07);
  addFx('+1', '#22c55e', p.x, p.footY - p.bodyH * 1.45);
  renderBoard();
}
function fail(p) {
  p.lives--; flash = 0.6; beep(180, 0.22);
  addFx(p.lives > 0 ? 'KENA! −1 ❤' : 'GUGUR!', '#ef4444', p.x, p.footY - p.bodyH * 1.45);
  renderBoard();
  if (active().length && !alive().length) setTimeout(() => S.phase === 'play' && gameOver(), 700);
}
const verdict = p => r => { if (r === true) pass(p); else if (r === false) fail(p); };
function addFx(text, color, x, y) { fx.push({ text, color, x, y, t: 0 }); }

function updateHud() {
  $('#hMode').textContent = MODES[S.mode];
  $('#hPlayers').textContent = `👥 ${alive().length}/${active().length} pemain`;
  const lvl = Math.floor(elapsed() / 12) + 1;
  $('#hLevel').textContent = S.phase !== 'play' ? 'Persiapan'
    : S.mode === 'karet' ? `Karet Level ${K.level + 1}/${KARET_LEVELS.length}`
    : S.mode === 'tali' ? `Putaran ${T.period.toFixed(2)} dtk` : `Batu Level ${lvl}`;
  if (S.input === 'server') $('#hNet').textContent = server.ready ? `🐍 Flask ${Math.round(server.rtt)} ms` : '🐍 Flask terputus';
}
let boardKey = '';
function renderBoard() {
  const list = active().sort((a, b) => b.score - a.score);
  const key = list.map(p => p.num + ':' + p.score + ':' + p.lives).join('|');
  if (key === boardKey) return; boardKey = key;
  $('#board').innerHTML = list.map(p =>
    `<div class="r ${p.lives > 0 ? '' : 'dead'}"><span class="dot" style="background:${p.color}"></span>P${p.num} <span>${'❤'.repeat(Math.max(0, p.lives))}</span><span class="sc">${p.score}</span></div>`).join('');
}

// ---------- Logika tiap mode ----------
function stoneX(s) { return s.x0 - s.speed * (S.now - s.t0); }
function stoneTime(s, p) { return s.t0 + (s.x0 - p.x) / s.speed; }

function updateMode() {
  if (S.mode === 'tali') {
    while (S.now >= T.cycleStart + T.period) {
      const hit = T.cycleStart + T.period;
      events.push({ t: hit, req: REQ_TALI });
      T.cycleStart = hit; T.period = Math.max(0.95, T.period * 0.97);   // makin lama makin cepat
    }
    for (const e of events) {
      if (S.now < e.t + CFG.post) continue;
      e.done = true;
      for (const p of active()) if (eligible(p, e.t)) judge(p, e.t, e.req, verdict(p));
    }
    events = events.filter(e => !e.done);
  }

  if (S.mode === 'karet') {
    if (!K.round && S.now >= K.nextAt) {
      K.round = { start: S.now, end: S.now + KARET_ROUND, h: KARET_LEVELS[K.level] };
      for (const p of players) { p.karetOk = false; p.karetSeen = false; p.plan = null; }
    }
    if (K.round) {
      const R = K.round;
      for (const p of active()) {
        if (!eligible(p, R.start) || p.karetOk || !p.visible) continue;
        p.karetSeen = true;
        if (jumpedSince(p, R.h, R.start)) { p.karetOk = true; pass(p); }
      }
      const waiting = active().filter(p => eligible(p, R.start) && p.karetSeen && !p.karetOk);
      if (S.now >= R.end || (S.now > R.start + 0.8 && !waiting.length && active().some(p => p.karetOk))) {
        for (const p of waiting) fail(p);
        K.rounds++;
        if (K.rounds % 2 === 0 && K.level < KARET_LEVELS.length - 1) { K.level++; addFx('KARET NAIK!', '#f59e0b', W / 2, H * 0.32); }
        K.round = null; K.nextAt = S.now + 1.6;
      }
    }
  }

  if (S.mode === 'batu') {
    const lvl = elapsed() / 12;                                        // naik level tiap 12 detik
    if (S.now >= B.nextSpawn) {
      const refs = active().filter(p => p.visible);
      const bh = refs.length ? refs.reduce((a, p) => a + p.bodyH, 0) / refs.length : H * 0.36;
      const hFrac = Math.min(0.22, 0.06 + 0.015 * lvl + Math.random() * 0.02);   // makin tinggi
      const wFrac = Math.min(0.55, 0.18 + 0.04 * lvl + Math.random() * 0.04);    // makin lebar
      const speed = W * Math.min(0.8, 0.26 + 0.045 * lvl);                       // makin kencang
      B.stones.push({ x0: W + wFrac * bh, t0: S.now, speed, hFrac, wFrac, done: new Set(), res: new Map() });
      B.nextSpawn = S.now + Math.max(1.25, 2.8 - 0.16 * lvl) * (0.85 + Math.random() * 0.3);
    }
    for (const s of B.stones) {
      for (const p of active()) {
        if (s.done.has(p)) continue;
        const tp = stoneTime(s, p);
        if (S.now < tp + CFG.post) continue;
        s.done.add(p);
        if (!eligible(p, tp)) continue;
        judge(p, tp, s.hFrac, r => {
          if (r === true) { pass(p); s.res.set(p, 'ok'); } else if (r === false) { fail(p); s.res.set(p, 'bad'); }
        });
      }
    }
    B.stones = B.stones.filter(s => stoneX(s) > -W * 0.3);
  }
}

// ---------- Loop utama ----------
let lastT = performance.now();
function loop(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastT) / 1000); lastT = nowMs;
  S.now = nowMs / 1000;
  if (S.phase !== 'menu') {
    if (isCamera()) updateCamera(nowMs); else updateDemo(dt);
    if (S.input !== 'server') for (const p of players) track(p, S.now);   // mode server: dilacak di Python
    const msg = $('#msg');

    if (S.input === 'server' && !server.ready && S.phase !== 'over') {
      msg.textContent = 'Koneksi ke server Flask terputus. Jalankan "python app.py", lalu kembali ke Menu';
    } else if (S.phase === 'lobby') {
      const ready = active().filter(p => p.visible);
      if (!ready.length) { S.lobbyAt = 0; msg.textContent = 'Masuk ke frame (1–6 orang). Pastikan seluruh badan sampai KAKI terlihat'; }
      else {
        if (!S.lobbyAt) S.lobbyAt = S.now + 5;
        const left = Math.ceil(S.lobbyAt - S.now);
        msg.textContent = `${ready.length} pemain terdeteksi ✔ · Mulai dalam ${left}… (${TOUCH ? 'tap layar' : 'tekan Enter'} untuk langsung mulai)`;
        if (S.now >= S.lobbyAt) beginPlay();
      }
    } else if (S.phase === 'play') {
      const anyVisible = alive().some(p => p.visible);
      msg.textContent = isCamera() && !anyVisible ? 'Tidak ada pemain terlihat — masuk ke frame sampai kaki terlihat' : '';
      updateMode();
    }
    renderBoard(); updateHud();
  }
  draw(dt);
  requestAnimationFrame(loop);
}

// ---------- Gambar ----------
const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32]];

// lantai & tinggi badan di posisi x mana pun (interpolasi antarpemain) → objek pas di kaki tiap pemain
function refs() { return active().filter(p => p.visible && p.ground != null).sort((a, b) => a.x - b.x); }
function at(arr, x, key, def) {
  if (!arr.length) return def;
  if (x <= arr[0].x) return arr[0][key];
  const L = arr[arr.length - 1]; if (x >= L.x) return L[key];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (x <= b.x) { const f = (x - a.x) / ((b.x - a.x) || 1); return a[key] + (b[key] - a[key]) * f; }
  }
  return def;
}
function span(arr) {
  const avgBh = arr.length ? arr.reduce((a, p) => a + p.bodyH, 0) / arr.length : H * 0.36;
  const xmin = arr.length ? arr[0].x : W / 2, xmax = arr.length ? arr[arr.length - 1].x : W / 2;
  const m = Math.max(0.9 * avgBh, 0.4 * (xmax - xmin));
  return { x0: Math.max(16, xmin - m), x1: Math.min(W - 16, xmax + m), avgBh };
}

// posisi teks besar: di bawah HUD & papan skor supaya tidak bertumpuk (penting di HP)
let labelY = 110;
function measureOverlay() {
  let bottom = 0;
  for (const id of ['#hud', '#board']) {
    const el = $(id);
    if (el.classList.contains('hidden') || !el.innerHTML.trim()) continue;
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  labelY = bottom + 44 * ui();
}

function draw(dt) {
  ctx.clearRect(0, 0, W, H);
  measureOverlay();
  if (isCamera() && camReady && S.phase !== 'menu') {
    const r = videoRect();
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1e293b'); g.addColorStop(0.88, '#334155'); g.addColorStop(0.88, '#3f6212'); g.addColorStop(1, '#365314');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (S.phase === 'menu') return;

  const R = refs();
  const playing = S.phase === 'play' || S.phase === 'over';
  if (playing && S.mode === 'tali') drawRope(R, false);
  for (const p of players) { if (isCamera()) drawSkeleton(p); else drawStickman(p); }
  if (playing) {
    if (S.mode === 'tali') drawRope(R, true);
    if (S.mode === 'karet') drawKaret(R);
    if (S.mode === 'batu') drawStones(R);
  }
  for (const p of active()) if (p.visible) drawTag(p);

  for (const f of fx) {
    f.t += dt;
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.1);
    ctx.font = `900 ${Math.round(38 * ui())}px system-ui,sans-serif`; ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 6; ctx.fillStyle = f.color;
    const y = Math.max(60, f.y) - f.t * 60;
    ctx.strokeText(f.text, f.x, y); ctx.fillText(f.text, f.x, y);
    ctx.globalAlpha = 1;
  }
  fx = fx.filter(f => f.t < 1.1);
  if (flash > 0) { ctx.fillStyle = `rgba(239,68,68,${flash * 0.3})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2.5); }
}

function drawSkeleton(p) {
  if (!p.lm) return;
  const col = p.confirmed ? p.color : 'rgba(148,163,184,.7)';
  ctx.globalAlpha = p.lives > 0 ? 1 : 0.35;
  ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const u = p.lm[a], v = p.lm[b];
    if (u.v < 0.4 || v.v < 0.4) continue;
    ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y); ctx.stroke();
  }
  for (const i of [23, 24, 25, 26, 27, 28]) {          // pinggul, lutut, pergelangan kaki
    const u = p.lm[i]; if (u.v < 0.4) continue;
    ctx.fillStyle = i >= 27 ? '#fff' : col;
    ctx.beginPath(); ctx.arc(u.x, u.y, i >= 27 ? 8 : 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawStickman(p) {
  const f = p.footY, h = p.bodyH, x = p.x, tuck = p.bot.y > 1 ? h * 0.08 : 0;
  ctx.globalAlpha = p.lives > 0 ? 1 : 0.35;
  ctx.strokeStyle = p.color; ctx.lineWidth = 7; ctx.lineCap = 'round';
  const hip = f - h * 0.5, sh = f - h;
  ctx.beginPath();
  ctx.moveTo(x - h * 0.08, f - tuck); ctx.lineTo(x - h * 0.06, f - h * 0.25); ctx.lineTo(x - h * 0.05, hip);
  ctx.moveTo(x + h * 0.08, f - tuck); ctx.lineTo(x + h * 0.06, f - h * 0.25); ctx.lineTo(x + h * 0.05, hip);
  ctx.moveTo(x, hip); ctx.lineTo(x, sh);
  ctx.moveTo(x - h * 0.22, sh + h * 0.3); ctx.lineTo(x - h * 0.12, sh); ctx.lineTo(x + h * 0.12, sh); ctx.lineTo(x + h * 0.22, sh + h * 0.3);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, sh - h * 0.14, h * 0.11, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * h * 0.08, f - tuck, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
}

// label di atas kepala: nomor, nyawa, skor + meter tinggi lompatan vs yang dibutuhkan
function drawTag(p) {
  const k = ui(), y = Math.max(40, p.footY - p.bodyH * 1.3), x = p.x;
  ctx.font = `800 ${Math.round(18 * k)}px system-ui,sans-serif`; ctx.textAlign = 'center';
  const txt = `P${p.num}  ${p.lives > 0 ? '❤'.repeat(p.lives) : '✖'}  ${p.score}`;
  const w = ctx.measureText(txt).width + 20 * k;
  ctx.fillStyle = 'rgba(15,17,21,.75)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 22 * k, w, 30 * k, 10 * k); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y);
  if (p.lives <= 0 || S.phase !== 'play') return;
  const req = needFor(p), maxF = 0.3, bw = 70 * k, by = y + 12 * k;
  const lf = Math.max(0, p.lift / p.bodyH);
  ctx.fillStyle = 'rgba(15,17,21,.75)'; ctx.fillRect(x - bw / 2, by, bw, 8 * k);
  ctx.fillStyle = lf >= req ? '#22c55e' : '#38bdf8'; ctx.fillRect(x - bw / 2, by, bw * Math.min(1, lf / maxF), 8 * k);
  ctx.fillStyle = '#f59e0b'; ctx.fillRect(x - bw / 2 + bw * (req / maxF) - 1.5, by - 3 * k, 3, 14 * k);
  if (S.mode === 'karet' && K.round && p.karetOk) { ctx.fillStyle = '#22c55e'; ctx.font = `900 ${Math.round(26 * k)}px system-ui`; ctx.fillText('✔', x + w / 2 + 14 * k, y); }
}
function needFor(p) {
  if (S.mode === 'tali') return REQ_TALI;
  if (S.mode === 'karet') return K.round ? K.round.h : KARET_LEVELS[K.level];
  let best = null;
  for (const s of B.stones) { const tp = stoneTime(s, p); if (!s.done.has(p) && (best == null || tp < best.tp)) best = { tp, h: s.hFrac }; }
  return best ? best.h : 0.06;
}

function drawRope(R, front) {
  const theta = 2 * Math.PI * (S.now - T.cycleStart) / T.period;   // 0 / 2π = tali di bawah kaki
  if ((Math.cos(theta) > 0) !== front) return;                      // separuh bawah = di depan pemain
  const { x0, x1, avgBh } = span(R);
  const gAvg = R.length ? R.reduce((a, p) => a + p.ground, 0) / R.length : H * 0.88;
  const pivotY = gAvg - avgBh * 0.55;
  ctx.fillStyle = '#fde68a';
  for (const x of [x0, x1]) { ctx.beginPath(); ctx.arc(x, pivotY, 10, 0, Math.PI * 2); ctx.fill(); }
  const near = Math.abs(Math.sin(theta / 2)) < 0.25;
  ctx.strokeStyle = front ? (near ? '#facc15' : '#f97316') : 'rgba(249,115,22,.45)';
  ctx.lineWidth = front ? 8 : 5; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const u = i / 60, x = x0 + (x1 - x0) * u;
    const bottom = at(R, x, 'ground', H * 0.88) - REQ_TALI * at(R, x, 'bodyH', H * 0.36);
    const shape = Math.min(1, Math.sin(Math.PI * u) * 1.6);       // bagian tengah rata → lewat tepat di kaki semua pemain
    const y = pivotY + (bottom - pivotY) * Math.cos(theta) * shape;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  const left = T.cycleStart + T.period - S.now;                     // aba-aba: lingkaran mengecil di kaki tiap pemain
  if (front && left < 0.9) {
    ctx.strokeStyle = 'rgba(250,204,21,.9)'; ctx.lineWidth = 4;
    for (const p of R) if (p.lives > 0) { ctx.beginPath(); ctx.arc(p.x, p.ground, 12 + left * 80, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (left < 0.45 || left > T.period - 0.1) bigLabel('LOMPAT!', '#facc15');
}

function drawKaret(R) {
  const h = K.round ? K.round.h : KARET_LEVELS[K.level];
  const { x0, x1 } = span(R);
  const yAt = x => at(R, x, 'ground', H * 0.88) - h * at(R, x, 'bodyH', H * 0.36);
  ctx.strokeStyle = '#d4d4d8'; ctx.lineWidth = 6;
  for (const x of [x0, x1]) { ctx.beginPath(); ctx.moveTo(x, at(R, x, 'ground', H * 0.88) + 10); ctx.lineTo(x, yAt(x) - 30); ctx.stroke(); }
  const colors = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ec4899'];
  const n = 40;
  ctx.lineWidth = 7; ctx.lineCap = 'butt';
  for (let i = 0; i < n; i++) {
    const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.beginPath(); ctx.moveTo(a, yAt(a)); ctx.lineTo(b, yAt(b)); ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(15 * ui())}px system-ui,sans-serif`; ctx.textAlign = 'right';
  ctx.fillText(`Karet Level ${K.level + 1}`, x1 - 8, yAt(x1) - 12);
  if (K.round) {
    const left = Math.max(0, K.round.end - S.now);
    bigLabel(`LOMPATI KARETNYA!  ${Math.ceil(left)}`, '#facc15');
    const bw = Math.min(360, W * 0.6), barY = labelY + 16 * ui();
    ctx.fillStyle = 'rgba(15,17,21,.7)'; ctx.fillRect(W / 2 - bw / 2, barY, bw, 10);
    ctx.fillStyle = left > 1.5 ? '#22c55e' : '#ef4444'; ctx.fillRect(W / 2 - bw / 2, barY, bw * left / KARET_ROUND, 10);
  } else bigLabel('Bersiap… karet dipasang', '#fff');
}

function drawStones(R) {
  let warn = false;
  for (const s of B.stones) {
    const x = stoneX(s), g = at(R, x, 'ground', H * 0.88), bh = at(R, x, 'bodyH', H * 0.36);
    const h = s.hFrac * bh, w = s.wFrac * bh, top = g - h;
    const res = [...s.res.values()];
    ctx.fillStyle = res.includes('bad') ? '#b91c1c' : res.length ? '#15803d' : '#78716c';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - w / 2, top, w, h, 6); ctx.fill(); ctx.stroke();
    const rows = 3;                                        // pola susunan batu
    for (let r = 1; r < rows; r++) { const yy = top + h * r / rows; ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke(); }
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 0.25 : 0.5, y0 = top + h * r / rows, y1 = top + h * (r + 1) / rows;
      for (let k = off; k < 1; k += 0.5) { const xx = x - w / 2 + w * k; ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); ctx.stroke(); }
    }
    for (const p of R) { const left = stoneTime(s, p) - S.now; if (p.lives > 0 && !s.done.has(p) && left < 0.4 && left > -0.1) warn = true; }
  }
  if (warn) bigLabel('LOMPAT!', '#facc15');
}

function bigLabel(t, color) {
  let size = Math.round(40 * ui());
  ctx.font = `900 ${size}px system-ui,sans-serif`;
  const fit = (W - 32) / ctx.measureText(t).width;          // kecilkan sampai muat di lebar layar
  if (fit < 1) { size = Math.floor(size * fit); ctx.font = `900 ${size}px system-ui,sans-serif`; }
  ctx.textAlign = 'center';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(t, W / 2, labelY);
  ctx.fillStyle = color; ctx.fillText(t, W / 2, labelY);
}

// ---------- Suara ----------
let actx = null;
function beep(f, d) {
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f; o.type = 'square'; g.gain.value = 0.05;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
  } catch (e) {}
}

// ---------- UI ----------
document.querySelectorAll('#cards .card').forEach(c => c.onclick = () => {
  document.querySelectorAll('#cards .card').forEach(x => x.classList.remove('sel'));
  c.classList.add('sel'); S.mode = c.dataset.mode;
});
document.querySelectorAll('#inputSeg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#inputSeg button').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel'); S.input = b.dataset.input;
});
$('#startBtn').onclick = async () => {
  if (isCamera()) {
    try { await initCamera(); }
    catch (e) {
      console.error(e);
      $('#status').textContent = S.input === 'server' && camReady
        ? 'Server Flask tidak terhubung. Jalankan "python app.py", atau pilih Kamera · browser.'
        : 'Kamera/model gagal dimuat (' + (e.name || e.message) + '). Coba izinkan kamera, atau pakai mode Demo.';
      return;
    }
  }
  startGame();
};
$('#againBtn').onclick = startGame;
$('#menuBtn').onclick = toMenu;
$('#hMenu').onclick = toMenu;
function humanJump() {
  if (S.phase === 'lobby' && active().length) { beginPlay(); return; }
  if (S.input === 'demo' && S.phase === 'play') { const p = players.find(q => !q.bot.auto); if (p && p.lives > 0) botJump(p); } }
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); humanJump(); }
  if (e.code === 'Enter' && S.phase === 'lobby' && active().length) beginPlay();
  if (e.code === 'Escape' && S.phase !== 'menu') toMenu();
});
cv.addEventListener('pointerdown', humanJump);

requestAnimationFrame(loop);
