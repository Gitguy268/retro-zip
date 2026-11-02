import test from 'node:test';
import assert from 'node:assert/strict';
import { H, W } from '../shared/tgames/kit.mjs';
import { createShell, GAMES } from '../shared/tgames/shell.mjs';

const assertGrid = (lines) => {
  assert.equal(lines.length, H);
  for (const l of lines) assert.equal(l.length, W);
};

for (const game of GAMES) {
  test(`${game.id}: renders a full grid and survives 5000 random steps`, () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const s = game.init(42);
    assertGrid(game.render(s));
    for (let i = 0; i < 5000 && !s.over; i++) {
      game.step(s, { up: rnd() < 0.3, down: rnd() < 0.2, left: rnd() < 0.3, right: rnd() < 0.3, fire: rnd() < 0.5 });
      assertGrid(game.render(s));
      assert.ok(Number.isFinite(s.score));
    }
  });

  test(`${game.id}: same seed and inputs replay identically`, () => {
    const run = () => {
      const s = game.init(9);
      for (let i = 0; i < 400 && !s.over; i++) game.step(s, { left: i % 40 < 20, right: i % 40 >= 20, fire: i % 9 === 0, up: i % 25 === 0 });
      return game.render(s).join('\n');
    };
    assert.equal(run(), run());
  });

  // Standing still on Hop's start line is safe, so it has its own test below.
  if (game.id !== 'hop') {
    test(`${game.id}: reaches game over when left alone`, () => {
      const s = game.init(3);
      for (let i = 0; i < 200000 && !s.over; i++) game.step(s, {});
      assert.ok(s.over, 'an idle player eventually loses');
    });
  }
}

test('rocks: firing and hitting scores points', () => {
  const rocks = GAMES.find((g) => g.id === 'rocks');
  const s = rocks.init(1);
  s.rocks = [{ x: s.ship.x, y: s.ship.y - 6, vx: 0, vy: 0, size: 2 }, { x: 2, y: 2, vx: 0, vy: 0, size: 0 }];
  for (let i = 0; i < 20; i++) rocks.step(s, { fire: true });
  assert.equal(s.score, 100);
});

test('snake: eating grows the snake and scores', () => {
  const snake = GAMES.find((g) => g.id === 'snake');
  const s = snake.init(1);
  s.food = { x: s.body[0].x + 1, y: s.body[0].y };
  const before = s.body.length;
  for (let i = 0; i < 5; i++) snake.step(s, {});
  assert.equal(s.score, 10);
  assert.equal(s.body.length, before + 1);
});

test('snake: cannot reverse into itself', () => {
  const snake = GAMES.find((g) => g.id === 'snake');
  const s = snake.init(1);
  for (let i = 0; i < 5; i++) snake.step(s, { left: true });
  assert.deepEqual(s.dir, [1, 0]);
  assert.equal(s.over, false);
});

test('hop: standing on a road eventually costs every life', () => {
  const hop = GAMES.find((g) => g.id === 'hop');
  const s = hop.init(1);
  for (let i = 0; i < 200000 && !s.over; i++) {
    s.y = 15;
    hop.step(s, {});
  }
  assert.ok(s.over);
});

test('hop: holding a key hops once', () => {
  const hop = GAMES.find((g) => g.id === 'hop');
  const s = hop.init(1);
  const y = s.y;
  hop.step(s, { up: true });
  hop.step(s, { up: true });
  assert.equal(s.y, y - 1);
});

test('shell: menu, play, game over, best score saved', () => {
  const saved = [];
  const shell = createShell({ seed: () => 3, onScore: (x) => saved.push({ ...x }) });
  shell.tick({ fire: true });
  assert.equal(shell.screen, 'play');
  shell.state.score = 500;
  shell.state.over = true;
  shell.state.lives = 1;
  shell.game.step = ((orig) => (s, i) => { orig(s, i); s.over = true; })(shell.game.step);
  shell.tick({});
  assert.equal(shell.screen, 'over');
  assert.equal(saved.at(-1).rocks, 500);
  assertGrid(shell.render());
});

test('shell: pause and back work with single presses', () => {
  const shell = createShell({ seed: () => 3 });
  shell.start('snake');
  shell.tick({ pause: true });
  assert.equal(shell.screen, 'paused');
  shell.tick({});
  shell.tick({ pause: true });
  assert.equal(shell.screen, 'play');
  shell.tick({});
  shell.tick({ back: true });
  assert.equal(shell.screen, 'menu');
  shell.tick({});
  shell.tick({ back: true });
  assert.equal(shell.wantsQuit, true);
});
