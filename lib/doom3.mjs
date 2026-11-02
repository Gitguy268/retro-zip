// Finds the user's Doom 3 data and starts the native dhewm3 engine with fixed arguments.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const LIKELY = [
  'Library/Application Support/Steam/steamapps/common/Doom 3',
  'Library/Application Support/Steam/steamapps/common/DOOM 3',
  'Applications/Doom 3',
  'Games/Doom 3',
  'GOG Games/Doom 3',
];

export const enginePath = (root) => {
  const candidates = [
    join(root, 'vendor/dhewm3/dhewm3.app/Contents/MacOS/dhewm3'),
    join(root, 'vendor/dhewm3/dhewm3'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

// A valid install is a folder holding base/pak000.pk4 from the full game.
export function hasGameData(dir) {
  try {
    const base = join(dir, 'base');
    const paks = readdirSync(base).filter((f) => /^pak\d+\.pk4$/i.test(f));
    return paks.some((f) => /^pak000\.pk4$/i.test(f)) && paks.length >= 5;
  } catch {
    return false;
  }
}

export function findGameData(saved) {
  if (saved && hasGameData(saved)) return saved;
  const home = homedir();
  return LIKELY.map((p) => join(home, p)).find(hasGameData) ?? null;
}

export function launch(engine, dir) {
  const child = spawn(engine, ['+set', 'fs_basepath', resolve(dir)], { detached: true, stdio: 'ignore' });
  child.unref();
  return new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('spawn', () => ok(child.pid));
  });
}
