import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { classify, isZip, matchesDeclared, normaliseTitle, sniff, coreFor } from '../shared/formats.mjs';
import { listZip, readEntry } from '../shared/zip.mjs';

const at = (size, offset, bytes) => {
  const b = new Uint8Array(size);
  b.set(typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes, offset);
  return b;
};

test('headers identify systems', () => {
  assert.equal(sniff(at(32, 0, 'NES\x1a')), 'nes');
  assert.equal(sniff(at(0x200, 0x104, [0xce, 0xed, 0x66, 0x66])), 'gb');
  assert.equal(sniff(at(0x200, 0x100, 'SEGA')), 'md');
  assert.equal(sniff(at(32, 0, 'IWAD')), 'doom');
  assert.equal(sniff(at(0x8000, 0x7ff0, 'TMR SEGA')), 'sms');
  const gba = at(0x200, 4, [0x24, 0xff, 0xae, 0x51]);
  gba[0xb2] = 0x96;
  assert.equal(sniff(gba), 'gba');
});

test('every format the user listed has an outcome', () => {
  const empty = new Uint8Array(16);
  assert.equal(classify('a.gg', empty).system, 'gg');
  assert.equal(classify('a.bin', empty).kind, 'ask');
  assert.equal(classify('a.iso', empty).kind, 'ask');
  assert.equal(classify('a.chd', empty).kind, 'ask');
  assert.equal(classify('a.state', empty).kind, 'save');
  assert.equal(classify('a.zip', empty).kind, 'archive');
  assert.equal(classify('a.sfc', empty).system, 'snes');
  assert.equal(classify('a.smc', empty).system, 'snes');
  assert.equal(classify('a.md', empty).system, 'md');
  assert.equal(classify('a.pbp', empty).system, 'psx');
  const rvz = classify('a.rvz', empty);
  assert.equal(rvz.kind, 'rejected');
  assert.match(rvz.reason, /GameCube/);
});

test('contents beat a misleading name', () => {
  assert.equal(classify('rom.bin', at(0x200, 0x100, 'SEGA')).system, 'md');
  assert.equal(classify('game.nes', at(16, 0, 'RVZ\x01')).kind, 'rejected');
  assert.equal(classify('game.nes', at(16, 0, [0x4d, 0x5a])).kind, 'rejected');
  assert.equal(classify('game.dat', new Uint8Array(16)).kind, 'rejected');
});

test('every system maps to a core', () => {
  for (const s of ['nes', 'snes', 'gb', 'gba', 'md', 'sms', 'gg', 'a2600', 'arcade', 'psx', 'pce', 'segacd']) assert.ok(coreFor(s), s);
});

test('declared type check', () => {
  assert.equal(matchesDeclared({ system: 'nes' }, at(16, 0, 'NES\x1a')), true);
  assert.equal(matchesDeclared({ system: 'nes' }, new Uint8Array(16)), false);
  assert.equal(matchesDeclared({ system: 'arcade', format: 'zip' }, at(16, 0, 'PK\x03\x04')), true);
  assert.equal(matchesDeclared({ system: 'arcade', format: 'zip' }, new Uint8Array(16)), false);
  assert.equal(isZip(at(16, 0, 'PK\x03\x04')), true);
});

test('title matching ignores region tags and punctuation', () => {
  assert.equal(normaliseTitle('Sonic the Hedgehog 2 (USA, Europe).md'), normaliseTitle('Sonic the Hedgehog 2'));
  assert.equal(normaliseTitle('Street Fighter II [!].sfc'), normaliseTitle('Street Fighter 2'));
  assert.equal(normaliseTitle('sf2.zip'), normaliseTitle('sf2'));
  assert.equal(normaliseTitle('Pac-Man.zip'), normaliseTitle('Pac-Man'));
});

function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const local = new Uint8Array(30 + name.length + f.data.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, f.method, true);
    v.setUint32(18, f.data.length, true);
    v.setUint32(22, f.size, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(f.data, 30 + name.length);
    const cen = new Uint8Array(46 + name.length);
    const c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(8, f.flags ?? 0, true);
    c.setUint16(10, f.method, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cen.set(name, 46);
    locals.push(local);
    central.push(cen);
    offset += local.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cenSize, true);
  e.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...locals, ...central, end]));
}

test('zip: reads stored and deflated files', async () => {
  const text = new TextEncoder().encode('hello hello hello hello');
  const zip = makeZip([
    { name: 'a.txt', method: 0, data: text, size: text.length },
    { name: 'dir/b.txt', method: 8, data: new Uint8Array(deflateRawSync(text)), size: text.length },
  ]);
  const entries = listZip(zip);
  assert.deepEqual(entries.map((x) => x.name), ['a.txt', 'dir/b.txt']);
  assert.deepEqual(await readEntry(zip, entries[0]), text);
  assert.deepEqual(await readEntry(zip, entries[1]), text);
});

test('zip: a bomb that lies about its size is stopped', async () => {
  const huge = new Uint8Array(5_000_000);
  const zip = makeZip([{ name: 'bomb.bin', method: 8, data: new Uint8Array(deflateRawSync(huge)), size: 100 }]);
  await assert.rejects(readEntry(zip, listZip(zip)[0]), /more than it declares/);
});

test('zip: declared size limits apply before unpacking', () => {
  const zip = makeZip([{ name: 'a.bin', method: 0, data: new Uint8Array(1), size: 4000 }, { name: 'b.bin', method: 0, data: new Uint8Array(1), size: 4000 }]);
  assert.throws(() => listZip(zip, { maxEntries: 10, maxEntryBytes: 2000, maxTotalBytes: 1e9 }), /too large/);
  assert.throws(() => listZip(zip, { maxEntries: 10, maxEntryBytes: 1e9, maxTotalBytes: 6000 }), /limit/);
  assert.throws(() => listZip(zip, { maxEntries: 1, maxEntryBytes: 1e9, maxTotalBytes: 1e9 }), /too many/);
});

test('zip: damage and passwords give clear errors', async () => {
  assert.throws(() => listZip(new Uint8Array(100)), /damaged/);
  const zip = makeZip([{ name: 'a.bin', method: 0, data: new Uint8Array(1), size: 1, flags: 1 }]);
  await assert.rejects(readEntry(zip, listZip(zip)[0]), /password/);
});
