import { grid, H, hud, makeRng, put, toLines, W } from './kit.mjs';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function placeFood(s) {
  for (;;) {
    const f = { x: 1 + Math.floor(s.rng() * (W - 2)), y: 2 + Math.floor(s.rng() * (H - 3)) };
    if (!s.body.some((p) => p.x === f.x && p.y === f.y)) { s.food = f; return; }
  }
}

export default {
  id: 'snake',
  name: 'Snake',
  blurb: 'Eat, grow, and stay off the walls and your own tail.',
  controls: 'Arrow keys steer',
  init(seed = 1) {
    const s = {
      rng: makeRng(seed), body: [{ x: 40, y: 12 }, { x: 39, y: 12 }, { x: 38, y: 12 }], dir: [1, 0], tick: 0, score: 0, over: false, food: null,
    };
    placeFood(s);
    return s;
  },
  step(s, input) {
    for (const k of Object.keys(DIRS)) {
      const d = DIRS[k];
      if (input[k] && d[0] !== -s.dir[0] && d[1] !== -s.dir[1]) s.pending = d;
    }
    const interval = Math.max(2, 5 - Math.floor(s.score / 50));
    if (++s.tick < interval) return;
    s.tick = 0;
    if (s.pending) s.dir = s.pending;
    const head = { x: s.body[0].x + s.dir[0], y: s.body[0].y + s.dir[1] };
    const hitWall = head.x < 1 || head.x >= W - 1 || head.y < 2 || head.y >= H - 1;
    if (hitWall || s.body.some((p) => p.x === head.x && p.y === head.y)) { s.over = true; return; }
    s.body.unshift(head);
    if (head.x === s.food.x && head.y === s.food.y) {
      s.score += 10;
      placeFood(s);
    } else {
      s.body.pop();
    }
  },
  render(s) {
    const g = grid();
    for (let x = 0; x < W; x++) { put(g, x, 1, '#'); put(g, x, H - 1, '#'); }
    for (let y = 1; y < H; y++) { put(g, 0, y, '#'); put(g, W - 1, y, '#'); }
    put(g, s.food.x, s.food.y, '@');
    s.body.forEach((p, i) => put(g, p.x, p.y, i ? 'o' : 'O'));
    hud(g, 'SNAKE', s.score);
    return toLines(g);
  },
};
