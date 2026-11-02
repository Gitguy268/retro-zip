import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePath, downloadVerified, FetchRefused, isCached, saveToCache } from '../lib/fetcher.mjs';

const allowHosts = ['good.example', 'cdn.good.example'];
const nes = () => {
  const b = new Uint8Array(64);
  b.set([0x4e, 0x45, 0x53, 0x1a]);
  return b;
};
const entryFor = (bytes, extra = {}) => ({
  id: 'x', system: 'nes', url: 'https://good.example/x.nes', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), ...extra,
});
const ok = (bytes) => async () => new Response(bytes, { status: 200 });
const refused = (p, re) => assert.rejects(p, (e) => e instanceof FetchRefused && re.test(e.message));

test('accepts a file that matches everything', async () => {
  const bytes = nes();
  const out = await downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: ok(bytes) });
  assert.deepEqual(out, bytes);
});

test('refuses a wrong checksum', async () => {
  const good = nes();
  const evil = nes();
  evil[10] = 1;
  await refused(downloadVerified(entryFor(good), { allowHosts, fetchImpl: ok(evil) }), /checksum/);
});

test('refuses a file larger than declared', async () => {
  const bytes = nes();
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: ok(new Uint8Array(100)) }), /larger/);
});

test('refuses a truncated file', async () => {
  const bytes = nes();
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: ok(bytes.slice(0, 10)) }), /expected/);
});

test('refuses the wrong file type even with a correct hash', async () => {
  const bytes = new Uint8Array(64);
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: ok(bytes) }), /type/);
});

test('refuses plain HTTP and hosts off the list', async () => {
  const bytes = nes();
  const never = async () => assert.fail('must not connect');
  await refused(downloadVerified(entryFor(bytes, { url: 'http://good.example/x' }), { allowHosts, fetchImpl: never }), /HTTPS/);
  await refused(downloadVerified(entryFor(bytes, { url: 'https://evil.example/x' }), { allowHosts, fetchImpl: never }), /allowed/);
});

test('checks every redirect hop', async () => {
  const bytes = nes();
  const to = (location) => async () => new Response(null, { status: 302, headers: { location } });
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: to('https://evil.example/x') }), /allowed/);
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: to('http://cdn.good.example/x') }), /HTTPS/);
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: to('https://cdn.good.example/x') }), /redirects/);

  let hop = 0;
  const allowed = async () => (hop++ ? new Response(bytes) : new Response(null, { status: 302, headers: { location: 'https://cdn.good.example/x' } }));
  assert.deepEqual(await downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: allowed }), bytes);
});

test('reports HTTP errors', async () => {
  const bytes = nes();
  await refused(downloadVerified(entryFor(bytes), { allowHosts, fetchImpl: async () => new Response('', { status: 503 }) }), /503/);
});

test('cache stores under the hash and leaves no partial file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rz-'));
  const bytes = nes();
  const entry = entryFor(bytes);
  assert.equal(await isCached(dir, entry), false);
  await saveToCache(dir, entry, bytes);
  assert.equal(await isCached(dir, entry), true);
  assert.deepEqual(new Uint8Array(readFileSync(cachePath(dir, entry))), bytes);
  assert.deepEqual(readdirSync(dir), [entry.sha256]);
  assert.ok(existsSync(cachePath(dir, entry)));
});
