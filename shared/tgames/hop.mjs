import { grid, H, hud, makeRng, put, text, toLines, W, wrap, centre, STEP_SECONDS as DT } from './kit.mjs';

const GOAL = 2;
const START = H - 2;

// Rows from the goal down: water with logs, a safe bank, roads with cars.
function buildLanes(s) {
  s.lanes = [];
  for (let y = GOAL + 1; y < START; y++) {
    const safe = y === 11;
    const water = y < 11;
    if (safe) { s.lanes.push({ y, kind: 'safe', items: [], v: 0 }); continue; }
    const dir = y % 2 ? 1 : -1;
    const v = dir * (6 + s.rng() * 6 + s.level * 1.5);
    const len = water ? 10 + Math.floor(s.rng() * 6) : 4;
    const gap = water ? 22 : 16 + Math.floor(s.rng() * 8);
    const items = [];
    for (let x = s.rng() * 20; x < W; x += len + gap) items.push(x);
    s.lanes.push({ y, kind: water ? 'water' : 'road', items, v, len });
  }
}

const covered = (lane, x) => lane.items.some((i) => wrap(x - i, W) < lane.len);

export default {
  id: 'hop',
  name: 'Hop',
  blurb: 'Cross the road and the river without getting flattened or soaked.',
  controls: 'Arrow keys hop',
  init(seed = 1) {
    const s = { rng: makeRng(seed), level: 1, score: 0, lives: 3, x: W / 2, y: START, best: START, held: {}, over: false };
    buildLanes(s);
    return s;
  },
  step(s, input) {
    // One hop per press, however long the key stays down.
    for (const k of ['up', 'down', 'left', 'right']) {
      if (input[k] && !s.held[k]) {
        if (k === 'up') s.y = Math.max(GOAL, s.y - 1);
        if (k === 'down') s.y = Math.min(START, s.y + 1);
        if (k === 'left') s.x = Math.max(0, s.x - 2);
        if (k === 'right') s.x = Math.min(W - 1, s.x + 2);
      }
      s.held[k] = !!input[k];
    }
    for (const l of s.lanes) l.items = l.items.map((i) => wrap(i + l.v * DT, W));
    if (s.y < s.best) { s.best = s.y; s.score += 10; }
    const lane = s.lanes.find((l) => l.y === s.y);
    let dead = false;
    if (lane?.kind === 'road') dead = covered(lane, s.x);
    if (lane?.kind === 'water') {
      if (covered(lane, s.x)) {
        s.x += lane.v * DT;
        if (s.x < 0 || s.x >= W) dead = true;
      } else {
        dead = true;
      }
    }
    if (dead) {
      if (--s.lives <= 0) { s.over = true; return; }
      Object.assign(s, { x: W / 2, y: START, best: START });
    }
    if (s.y === GOAL) {
      s.score += 100;
      s.level++;
      Object.assign(s, { x: W / 2, y: START, best: START });
      buildLanes(s);
    }
  },
  render(s) {
    const g = grid();
    centre(g, GOAL, '='.repeat(W));
    for (const l of s.lanes) {
      if (l.kind === 'water') for (let x = 0; x < W; x++) if ((x + l.y) % 3 === 0) put(g, x, l.y, '~');
      if (l.kind === 'safe') centre(g, l.y, '.'.repeat(W));
      for (const i of l.items) {
        for (let n = 0; n < l.len; n++) put(g, wrap(i + n, W), l.y, l.kind === 'water' ? '=' : '#');
      }
    }
    text(g, 0, START, '.'.repeat(W));
    put(g, s.x, s.y, 'Y');
    hud(g, 'HOP', s.score, `LEVEL ${s.level}  LIVES ${s.lives}`);
    return toLines(g);
  },
};
