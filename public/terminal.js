// Terminal mode in the browser: same game code as the retro-zip command.
import { H, STEP_SECONDS, W } from '/shared/tgames/kit.mjs';
import { createShell } from '/shared/tgames/shell.mjs';

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Space: 'fire', Enter: 'fire', KeyP: 'pause', Escape: 'back', KeyQ: 'back',
};

const loadScores = () => { try { return JSON.parse(localStorage.getItem('retro-zip-scores')) ?? {}; } catch { return {}; } };
const saveScores = (s) => { try { localStorage.setItem('retro-zip-scores', JSON.stringify(s)); } catch { /* optional */ } };

export function openTerminal(root, exit) {
  const screen = document.createElement('pre');
  screen.className = 'crt';
  screen.setAttribute('role', 'img');
  screen.setAttribute('aria-label', 'Terminal game screen. Use the arrow keys and space.');
  const wrap = document.createElement('div');
  wrap.className = 'crt-wrap';
  wrap.append(screen);

  const leave = document.createElement('button');
  leave.className = 'crt-leave';
  leave.textContent = 'Normal mode';
  leave.addEventListener('click', () => close());

  const input = {};
  const pad = document.createElement('div');
  pad.className = 'crt-pad';
  for (const [label, key] of [['Left', 'left'], ['Up', 'up'], ['Down', 'down'], ['Right', 'right'], ['Fire', 'fire'], ['Esc', 'back']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); input[key] = true; });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { input[key] = false; });
    pad.append(b);
  }
  root.replaceChildren(wrap, leave, pad);

  const shell = createShell({ scores: loadScores(), onScore: saveScores });
  const onKey = (e) => {
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    input[k] = e.type === 'keydown';
  };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);

  const fit = () => {
    // VT323 is 0.4em wide per character with a 1em line.
    const size = Math.floor(Math.min(innerWidth * 0.94 / (W * 0.4), (innerHeight - pad.offsetHeight - 24) / H));
    screen.style.fontSize = `${size}px`;
  };
  addEventListener('resize', fit);
  fit();

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let drawn = '';
  const STEP_MS = STEP_SECONDS * 1000;
  const frame = (now) => {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= STEP_MS) {
      shell.tick(input);
      acc -= STEP_MS;
    }
    if (shell.wantsQuit) { close(); return; }
    const text = shell.render().join('\n');
    if (text !== drawn) { screen.textContent = text; drawn = text; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('resize', fit);
    exit();
  }

  const stopOnNav = () => {
    if (location.hash.replace(/^#\/?/, '') === 'terminal') return;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('resize', fit);
    removeEventListener('hashchange', stopOnNav);
  };
  addEventListener('hashchange', stopOnNav);
}
