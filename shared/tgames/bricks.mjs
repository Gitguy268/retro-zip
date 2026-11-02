import { grid, H, hud, makeRng, put, text, toLines, W, clamp, STEP_SECONDS as DT } from './kit.mjs';

const PAD = 11;

function layBricks(s) {
  s.bricks = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 12; col++) s.bricks.push({ x: 4 + col * 6, y: 3 + row, score: (5 - row) * 5 });
  }
}

function serve(s) {
  s.ball = { x: s.x, y: H - 3, vx: (s.rng() < 0.5 ? -1 : 1) * 18, vy: -(12 + s.level * 1.5) };
}

export default {
  id: 'bricks',
  name: 'Bricks',
  blurb: 'Keep the ball in play and knock out the wall.',
  controls: 'Left/right move',
  init(seed = 1) {
    const s = { rng: makeRng(seed), x: W / 2, score: 0, lives: 3, level: 1, over: false };
    layBricks(s);
    serve(s);
    return s;
  },
  step(s, input) {
    if (input.left) s.x -= 60 * DT;
    if (input.right) s.x += 60 * DT;
    s.x = clamp(s.x, PAD / 2, W - PAD / 2 - 1);
    const b = s.ball;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.x <= 0 || b.x >= W - 1) { b.vx = -b.vx; b.x = clamp(b.x, 0, W - 1); }
    if (b.y <= 1) { b.vy = Math.abs(b.vy); b.y = 1; }
    if (b.vy > 0 && Math.round(b.y) === H - 2 && Math.abs(b.x - s.x) <= PAD / 2) {
      b.vy = -Math.abs(b.vy);
      b.vx = ((b.x - s.x) / (PAD / 2)) * 26 || 4;
    }
    const hit = s.bricks.find((k) => Math.round(b.y) === k.y && b.x >= k.x && b.x < k.x + 5);
    if (hit) {
      s.bricks.splice(s.bricks.indexOf(hit), 1);
      s.score += hit.score;
      b.vy = -b.vy;
    }
    if (b.y > H - 1) {
      if (--s.lives <= 0) { s.over = true; return; }
      serve(s);
    }
    if (!s.bricks.length) {
      s.level++;
      layBricks(s);
      serve(s);
    }
  },
  render(s) {
    const g = grid();
    for (const k of s.bricks) text(g, k.x, k.y, '[===]');
    put(g, s.ball.x, s.ball.y, 'O');
    text(g, Math.round(s.x - PAD / 2), H - 2, '='.repeat(PAD));
    hud(g, 'BRICKS', s.score, `LEVEL ${s.level}  LIVES ${s.lives}`);
    return toLines(g);
  },
};
