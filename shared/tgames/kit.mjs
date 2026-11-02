// Shared helpers for the terminal games. Everything draws to an 80x24 character grid.
export const W = 80;
export const H = 24;

export const grid = () => Array.from({ length: H }, () => Array(W).fill(' '));

export function put(g, x, y, ch) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cy >= 0 && cy < H && cx >= 0 && cx < W) g[cy][cx] = ch;
}

export function text(g, x, y, s) {
  for (let i = 0; i < s.length; i++) put(g, x + i, y, s[i]);
}

export const centre = (g, y, s) => text(g, Math.floor((W - s.length) / 2), y, s);
export const toLines = (g) => g.map((row) => row.join(''));

// Small seeded generator, so a game can be replayed exactly in tests.
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrap = (v, max) => ((v % max) + max) % max;
export const hud = (g, name, score, extra = '') => {
  text(g, 0, 0, `${name}  SCORE ${score}`);
  text(g, W - extra.length, 0, extra);
};

export const STEP_SECONDS = 1 / 30;
