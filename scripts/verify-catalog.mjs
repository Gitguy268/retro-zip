#!/usr/bin/env node
// Re-downloads every catalogue entry through the real verifier and reports any
// that no longer match. Exits non-zero if one fails.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadVerified } from '../lib/fetcher.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { allowHosts, games } = JSON.parse(readFileSync(join(ROOT, 'data/catalog.json'), 'utf8'));
let failed = 0;
for (const g of games) {
  const missing = ['sha256', 'size', 'license', 'evidence'].filter((k) => !g[k]);
  if (missing.length) { console.log(`FAIL ${g.id}: missing ${missing.join(', ')}`); failed++; continue; }
  try {
    await downloadVerified(g, { allowHosts });
    console.log(`ok   ${g.id}`);
  } catch (err) {
    console.log(`FAIL ${g.id}: ${err.message}`);
    failed++;
  }
}
console.log(`${games.length - failed}/${games.length} verified.`);
process.exit(failed ? 1 : 0);
