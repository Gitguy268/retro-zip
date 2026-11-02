import { grid, H, hud, makeRng, put, text, toLines, W, STEP_SECONDS as DT } from './kit.mjs';

const FRAMES = ['/o\\', '\\o/'];

function newWave(s) {
  s.aliens = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 10; col++) s.aliens.push({ x: 8 + col * 6, y: 3 + row * 2, score: (4 - row) * 10 });
  }
  s.dir = 1;
  s.moveEvery = Math.max(6, 22 - s.wave * 3);
}

export default {
  id: 'swarm',
  name: 'Swarm',
  blurb: 'Hold the line against a descending wall of aliens.',
  controls: 'Left/right move, space fire',
  init(seed = 1) {
    const s = {
      rng: makeRng(seed), x: W / 2, shots: [], bombs: [], score: 0, lives: 3, wave: 1, tick: 0, frame: 0, cooldown: 0, over: false,
    };
    newWave(s);
    return s;
  },
  step(s, input) {
    if (input.left) s.x = Math.max(1, s.x - 45 * DT);
    if (input.right) s.x = Math.min(W - 2, s.x + 45 * DT);
    s.cooldown = Math.max(0, s.cooldown - 1);
    if (input.fire && !s.cooldown && s.shots.length < 3) {
      s.cooldown = 8;
      s.shots.push({ x: s.x, y: H - 3 });
    }
    if (++s.tick >= s.moveEvery) {
      s.tick = 0;
      s.frame ^= 1;
      const edge = s.aliens.some((a) => (s.dir > 0 ? a.x >= W - 4 : a.x <= 1));
      if (edge) {
        s.dir = -s.dir;
        for (const a of s.aliens) a.y += 1;
      } else {
        for (const a of s.aliens) a.x += s.dir;
      }
      if (s.aliens.length && s.rng() < 0.5) {
        const a = s.aliens[Math.floor(s.rng() * s.aliens.length)];
        s.bombs.push({ x: a.x + 1, y: a.y + 1 });
      }
    }
    for (const b of s.shots) b.y -= 30 * DT;
    for (const b of s.bombs) b.y += 12 * DT;
    s.aliens = s.aliens.filter((a) => {
      const hit = s.shots.find((b) => Math.round(b.y) === a.y && b.x >= a.x - 0.5 && b.x <= a.x + 2.5);
      if (!hit) return true;
      hit.y = -1;
      s.score += a.score;
      return false;
    });
    s.shots = s.shots.filter((b) => b.y >= 1);
    const struck = s.bombs.some((b) => Math.round(b.y) === H - 2 && Math.abs(b.x - s.x) <= 1.5);
    s.bombs = s.bombs.filter((b) => b.y < H - 1 && !(Math.round(b.y) === H - 2 && Math.abs(b.x - s.x) <= 1.5));
    if (struck && --s.lives <= 0) { s.over = true; return; }
    if (s.aliens.some((a) => a.y >= H - 3)) { s.over = true; return; }
    if (!s.aliens.length) {
      s.wave++;
      newWave(s);
    }
  },
  render(s) {
    const g = grid();
    for (const a of s.aliens) text(g, a.x, a.y, FRAMES[s.frame]);
    for (const b of s.shots) put(g, b.x, b.y, '|');
    for (const b of s.bombs) put(g, b.x, b.y, '!');
    text(g, Math.round(s.x) - 1, H - 2, '/^\\');
    hud(g, 'SWARM', s.score, `WAVE ${s.wave}  LIVES ${s.lives}`);
    return toLines(g);
  },
};
