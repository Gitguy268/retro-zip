import { grid, H, makeRng, put, text, toLines, W, clamp, STEP_SECONDS as DT, centre } from './kit.mjs';

const LEN = 5;
const TOP = 2;
const WIN = 7;

function serve(s, dir) {
  s.ball = { x: W / 2, y: H / 2, vx: dir * 30, vy: (s.rng() - 0.5) * 24 };
}

export default {
  id: 'paddle',
  name: 'Paddle',
  blurb: 'Two bats and a ball. First to seven beats the machine.',
  controls: 'Up/down move',
  init(seed = 1) {
    const s = { rng: makeRng(seed), you: H / 2, cpu: H / 2, score: 0, yours: 0, theirs: 0, over: false };
    serve(s, 1);
    return s;
  },
  step(s, input) {
    if (input.up) s.you -= 26 * DT;
    if (input.down) s.you += 26 * DT;
    s.you = clamp(s.you, TOP + LEN / 2, H - 1 - LEN / 2);
    const b = s.ball;
    const speed = 13 + s.yours * 1.5;
    s.cpu += clamp(b.y - s.cpu, -speed * DT, speed * DT);
    s.cpu = clamp(s.cpu, TOP + LEN / 2, H - 1 - LEN / 2);
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    if (b.y < TOP) { b.y = TOP; b.vy = Math.abs(b.vy); }
    if (b.y > H - 1) { b.y = H - 1; b.vy = -Math.abs(b.vy); }
    if (b.vx < 0 && b.x <= 3 && Math.abs(b.y - s.you) <= LEN / 2 + 0.5) {
      b.vx = Math.abs(b.vx) * 1.05;
      b.vy = ((b.y - s.you) / (LEN / 2)) * 18;
    }
    if (b.vx > 0 && b.x >= W - 4 && Math.abs(b.y - s.cpu) <= LEN / 2 + 0.5) {
      b.vx = -Math.abs(b.vx) * 1.05;
      b.vy = ((b.y - s.cpu) / (LEN / 2)) * 18;
    }
    if (b.x < 0) { s.theirs++; serve(s, 1); }
    if (b.x > W) { s.yours++; s.score += 100; serve(s, -1); }
    if (s.yours >= WIN || s.theirs >= WIN) s.over = true;
  },
  render(s) {
    const g = grid();
    for (let y = TOP; y < H; y += 2) put(g, W / 2, y, ':');
    for (let i = 0; i < LEN; i++) {
      put(g, 2, s.you - LEN / 2 + i + 0.5, '#');
      put(g, W - 3, s.cpu - LEN / 2 + i + 0.5, '#');
    }
    put(g, s.ball.x, s.ball.y, 'O');
    centre(g, 0, `YOU ${s.yours}   :   ${s.theirs} CPU`);
    text(g, 0, 0, 'PADDLE');
    return toLines(g);
  },
};
