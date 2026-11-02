#!/usr/bin/env node
// Builds data/catalog.json from data/catalog-sources.json: downloads each file into
// memory, records its size and SHA-256. Run only when adding or changing an entry.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesDeclared, SYSTEMS } from '../shared/formats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(ROOT, 'data/catalog-sources.json'), 'utf8'));

const entries = [
  ...src.homebrewHub.map(([id, title, system, license, base, path, author, evidence, year]) => ({
    id, title, system, license, author, evidence, year,
    url: `https://hh3.gbdev.io/static/${base}/entries/${path}`,
    fileName: path.split('/').pop(),
    source: 'Homebrew Hub',
  })),
  ...src.direct.map((d) => ({ source: 'GitHub release', ...d })),
  ...src.mameFree.map(([id, title, year]) => ({
    id: `mame-${id}`, title, system: 'arcade', core: 'mame2003_plus', year,
    license: 'Non-commercial, by permission of the rights holder',
    author: 'Rights holder, via MAME', evidence: `https://www.mamedev.org/roms/${id}/`,
    url: `https://www.mamedev.org/roms/${id}/${id}.zip`, fileName: `${id}.zip`, format: 'zip',
    source: 'MAME', nonCommercial: true,
  })),
];

const games = [];
for (const e of entries) {
  try {
    const res = await fetch(e.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!matchesDeclared(e, bytes)) throw new Error('file type does not match');
    const final = { ...e, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (!final.core) final.core = SYSTEMS[e.system].core;
    games.push(final);
    console.log(`ok   ${e.id} ${bytes.length}`);
  } catch (err) {
    console.log(`SKIP ${e.id}: ${err.message}`);
  }
}
writeFileSync(join(ROOT, 'data/catalog.json'), `${JSON.stringify({
  allowHosts: src.allowHosts, instantBytes: src.instantBytes, games,
}, null, 2)}\n`);
console.log(`${games.length}/${entries.length} pinned.`);
