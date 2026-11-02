#!/usr/bin/env node
// Downloads the pinned EmulatorJS release and Doom engine and verifies their hashes.
// Only the emulator cores retro-zip uses are extracted. Safe to run repeatedly.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, chmodSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '4.2.3';
const URL_ = `https://github.com/EmulatorJS/EmulatorJS/releases/download/v${VERSION}/${VERSION}.7z`;
const SHA256 = '07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b';
const CORES = ['fceumm', 'snes9x', 'gambatte', 'mgba', 'genesis_plus_gx', 'smsplus', 'stella2014',
  'fbneo', 'mame2003_plus', 'pcsx_rearmed', 'picodrive', 'mednafen_pce', 'handy',
  'prosystem', 'gearcoleco', 'mednafen_ngp', 'mednafen_wswan'];

const DOOM_URL = 'https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm';
const DOOM_SHA256 = '8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa';

const dlDir = join(ROOT, 'vendor', '_dl');
const archive = join(dlDir, `emulatorjs-${VERSION}.7z`);
const dest = join(ROOT, 'vendor', 'emulatorjs');
const marker = join(dest, 'data', 'loader.js');

const hashFile = async (p) => {
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
};

async function fetchDoom() {
  const file = join(ROOT, 'vendor', 'doom', 'doom.wasm');
  if (existsSync(file) && await hashFile(file) === DOOM_SHA256) return;
  mkdirSync(dirname(file), { recursive: true });
  console.log('Downloading the Doom engine (4.5 MB)...');
  const res = await fetch(DOOM_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
  const got = await hashFile(`${file}.part`);
  if (got !== DOOM_SHA256) {
    rmSync(`${file}.part`);
    throw new Error(`Hash mismatch, Doom engine deleted. Expected ${DOOM_SHA256}, got ${got}`);
  }
  renameSync(`${file}.part`, file);
}

await fetchDoom();

if (existsSync(marker)) {
  console.log('EmulatorJS is already in vendor/emulatorjs.');
  process.exit(0);
}

mkdirSync(dlDir, { recursive: true });
if (!existsSync(archive)) {
  console.log(`Downloading EmulatorJS ${VERSION} (303 MB)...`);
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${archive}.part`));
  renameSync(`${archive}.part`, archive);
}
const actual = await hashFile(archive);
if (actual !== SHA256) {
  rmSync(archive);
  throw new Error(`Hash mismatch, archive deleted. Expected ${SHA256}, got ${actual}`);
}

const { path7za } = await import('7zip-bin');
chmodSync(path7za, 0o755);
const patterns = [
  'data/loader.js', 'data/emulator.min.js', 'data/emulator.min.css', 'data/version.json',
  'data/compression/*', 'data/localization/en*', 'data/cores/cores.json', 'data/cores/reports/*', 'LICENSE',
  ...CORES.flatMap((c) => [`data/cores/${c}-wasm.data`, `data/cores/${c}-legacy-wasm.data`]),
];
mkdirSync(dest, { recursive: true });
execFileSync(path7za, ['x', archive, `-o${dest}`, '-y', '-bso0', '-bsp0', ...patterns], { stdio: 'inherit' });
rmSync(archive);
rmSync(dlDir, { recursive: true, force: true });
console.log('EmulatorJS is ready in vendor/emulatorjs.');
