// Angka pelacakan & penilaian dari lompat/config.py (disisipkan template) → Python dan JS selalu sama
export const CFG = window.LOMPAT_CONFIG;

// ---------- Aturan permainan ----------
export const MODES = { tali: '🪢 Lompat Tali', karet: '🎗️ Lompat Karet', batu: '🪨 Lompat Batu' };
export const COLORS = ['#f59e0b', '#38bdf8', '#a3e635', '#f472b6', '#c084fc', '#2dd4bf', '#fb923c', '#f87171'];
export const LIVES = 3;
export const REQ_TALI = 0.07;           // tinggi angkat kaki minimum, proporsi tinggi badan (bahu–kaki)
export const KARET_LEVELS = [0.06, 0.09, 0.12, 0.15, 0.18, 0.21];
export const KARET_ROUND = 5;
