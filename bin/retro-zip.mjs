#!/usr/bin/env node
// Terminal mode. Plays the shared games in a real terminal with no dependencies.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { H, STEP_SECONDS, W } from '../shared/tgames/kit.mjs';
import { createShell, findGame, GAMES } from '../shared/tgames/shell.mjs';

const HOME = process.env.RETRO_ZIP_HOME || join(homedir(), '.retro-zip');
const SCORES = join(HOME, 'scores.json');

const USAGE = `retro-zip: retro games in your terminal

  retro-zip              open the game menu
  retro-zip play <game>  start a game
  retro-zip list         list the games

Normal mode with emulated games runs in the browser: double-click start.command.`;

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'list') {
  for (const g of GAMES) console.log(`${g.id.padEnd(8)} ${g.blurb}`);
  process.exit(0);
}
if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (cmd && cmd !== 'play') {
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(2);
}
if (cmd === 'play' && !findGame(arg)) {
  console.error(`Unknown game: ${arg ?? '(none)'}. Available: ${GAMES.map((g) => g.id).join(', ')}`);
  process.exit(2);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Terminal mode needs an interactive terminal.');
  process.exit(1);
}

let scores = {};
try { scores = JSON.parse(readFileSync(SCORES, 'utf8')); } catch { /* first run */ }
const shell = createShell({
  scores,
  onScore(next) {
    try {
      mkdirSync(HOME, { recursive: true });
      writeFileSync(SCORES, JSON.stringify(next));
    } catch { /* scores are optional */ }
  },
});
if (cmd === 'play') shell.start(arg);

const out = process.stdout;
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try { process.stdin.setRawMode(false); } catch { /* already closed */ }
  out.write('\x1b[?1049l\x1b[?25h\x1b[0m');
}
function quit(code = 0) {
  restore();
  process.exit(code);
}
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => quit(0));
process.on('uncaughtException', (err) => {
  restore();
  console.error(err);
  process.exit(1);
});

process.stdin.setRawMode(true);
process.stdin.resume();
out.write('\x1b[?1049h\x1b[?25l\x1b[2J');

// Terminals send key presses and repeats but no key releases, so a key counts
// as held until it hasn't repeated for a moment.
const HOLD_MS = { first: 400, repeat: 120 };
const heldUntil = {};
const press = (name) => {
  const now = Date.now();
  heldUntil[name] = now + (heldUntil[name] > now ? HOLD_MS.repeat : HOLD_MS.first);
};
// Single-press keys get one frame down and one up, so they can't double-trigger.
const tapQueue = [];
const KEYS = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
  w: 'up', s: 'down', a: 'left', d: 'right',
  ' ': 'fire', '\r': 'fire', '\n': 'fire', p: 'pause', '\x1b': 'back', q: 'back',
};
process.stdin.on('data', (buf) => {
  let s = buf.toString('latin1');
  while (s.length) {
    if (s[0] === '\x03') quit(0);
    const seq = s.startsWith('\x1b[') || s.startsWith('\x1bO') ? s.slice(0, 3) : s[0];
    s = s.slice(seq.length);
    const name = KEYS[seq];
    if (!name) continue;
    if (name === 'pause' || name === 'back') tapQueue.push(name);
    else press(name);
  }
});

let last = '';
function draw() {
  const { columns = W, rows = H } = out;
  if (columns < W || rows < H) {
    const msg = `\x1b[H\x1b[2JMake this window at least ${W}x${H} (now ${columns}x${rows}).`;
    if (msg !== last) out.write(msg);
    last = msg;
    return;
  }
  const lines = shell.render();
  const frame = lines.map((line, y) => `\x1b[${y + 1};1H${line}`).join('');
  if (frame !== last) out.write(frame);
  last = frame;
}
out.on('resize', () => { last = ''; out.write('\x1b[2J'); });

setInterval(() => {
  const now = Date.now();
  const input = {};
  for (const [k, until] of Object.entries(heldUntil)) if (until > now) input[k] = true;
  const tap = tapQueue.shift();
  if (tap) input[tap] = true;
  shell.tick(input);
  if (shell.wantsQuit) quit(0);
  draw();
}, STEP_SECONDS * 1000);
