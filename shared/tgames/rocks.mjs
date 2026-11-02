import { grid, H, hud, makeRng, put, toLines, W, wrap, STEP_SECONDS as DT } from './kit.mjs';

const SHIP = ['>', '/', '^', '\\', '<', '/', 'v', '\\'];
const SIZES = [{ r: 3.2, score: 20 }, { r: 2, score: 50 }, { r: 1, score: 100 }];

function spawnWave(s) {
  const n = 2 + s.wave;
  for (let i = 0; i < n; i++) {
    const edge = s.rng() < 0.5;
    const a = s.rng() * Math.PI * 2;
    const speed = 3 + s.rng() * 3;
    s.rocks.push({
      x: edge ? 0 : s.rng() * W, y: edge ? s.rng() * H : 1, vx: Math.cos(a) * speed * 2, vy: Math.sin(a) * speed, size: 0,
    });
  }
}

export default {
  id: 'rocks',
  name: 'Rocks',
  blurb: 'Fly a ship through a rock field and shoot everything to dust.',
  controls: 'Left/right turn, up thrust, space fire',
  init(seed = 1) {
    const s = {
      rng: makeRng(seed), ship: { x: W / 2, y: H / 2, vx: 0, vy: 0, a: Math.PI / 2 }, bullets: [], rocks: [],
      score: 0, lives: 3, wave: 1, cooldown: 0, invuln: 60, over: false,
    };
    spawnWave(s);
    return s;
  },
  step(s, input) {
    const { ship } = s;
    if (input.left) ship.a += 4 * DT;
    if (input.right) ship.a -= 4 * DT;
    if (input.up) {
      ship.vx += Math.cos(ship.a) * 40 * DT;
      ship.vy -= Math.sin(ship.a) * 20 * DT;
    }
    ship.vx *= 0.99;
    ship.vy *= 0.99;
    ship.x = wrap(ship.x + ship.vx * DT, W);
    ship.y = wrap(ship.y + ship.vy * DT, H);
    s.cooldown = Math.max(0, s.cooldown - 1);
    s.invuln = Math.max(0, s.invuln - 1);
    if (input.fire && s.cooldown === 0 && s.bullets.length < 5) {
      s.cooldown = 6;
      s.bullets.push({
        x: ship.x, y: ship.y, vx: ship.vx + Math.cos(ship.a) * 50, vy: ship.vy - Math.sin(ship.a) * 25, life: 30,
      });
    }
    for (const b of s.bullets) {
      b.x = wrap(b.x + b.vx * DT, W);
      b.y = wrap(b.y + b.vy * DT, H);
      b.life--;
    }
    for (const r of s.rocks) {
      r.x = wrap(r.x + r.vx * DT, W);
      r.y = wrap(r.y + r.vy * DT, H);
    }
    const next = [];
    for (const r of s.rocks) {
      const radius = SIZES[r.size].r;
      const hit = s.bullets.find((b) => b.life > 0 && Math.hypot((b.x - r.x) / 2, b.y - r.y) < radius);
      if (!hit) { next.push(r); continue; }
      hit.life = 0;
      s.score += SIZES[r.size].score;
      if (r.size < 2) {
        for (const dir of [-1, 1]) {
          next.push({ x: r.x, y: r.y, vx: r.vx * 1.2 + dir * r.vy, vy: r.vy * 1.2 - dir * r.vx * 0.3, size: r.size + 1 });
        }
      }
    }
    s.rocks = next;
    s.bullets = s.bullets.filter((b) => b.life > 0);
    if (!s.invuln && s.rocks.some((r) => Math.hypot((ship.x - r.x) / 2, ship.y - r.y) < SIZES[r.size].r)) {
      s.lives--;
      if (s.lives <= 0) { s.over = true; return; }
      Object.assign(ship, { x: W / 2, y: H / 2, vx: 0, vy: 0 });
      s.invuln = 90;
    }
    if (!s.rocks.length) {
      s.wave++;
      spawnWave(s);
    }
  },
  render(s) {
    const g = grid();
    for (const r of s.rocks) {
      const radius = SIZES[r.size].r;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        put(g, wrap(r.x + Math.cos(a) * radius * 2, W), wrap(r.y + Math.sin(a) * radius, H), r.size === 2 ? '*' : 'o');
      }
    }
    for (const b of s.bullets) put(g, b.x, b.y, '.');
    if (s.invuln % 6 < 4) {
      const idx = wrap(Math.round((s.ship.a / (Math.PI * 2)) * 8), 8);
      put(g, s.ship.x, s.ship.y, SHIP[idx]);
    }
    hud(g, 'ROCKS', s.score, `WAVE ${s.wave}  LIVES ${s.lives}`);
    return toLines(g);
  },
};
