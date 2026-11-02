// Small read-only zip reader for the browser and Node. Nothing is written to a
// path taken from the archive: entries are returned as bytes in memory.

export const LIMITS = { maxEntries: 4096, maxEntryBytes: 1024 ** 3, maxTotalBytes: 2 * 1024 ** 3 };

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function listZip(bytes, limits = LIMITS) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
    if (v.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This zip file is damaged: its directory is missing.');
  const count = v.getUint16(eocd + 10, true);
  if (count > limits.maxEntries) throw new Error(`This zip has too many files (${count}). The limit is ${limits.maxEntries}.`);
  let p = v.getUint32(eocd + 16, true);
  const entries = [];
  let total = 0;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== CEN) throw new Error('This zip file is damaged: bad directory entry.');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (name.endsWith('/')) continue;
    if (size > limits.maxEntryBytes) throw new Error(`"${name}" is too large to unpack safely.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new Error('This zip unpacks to more than the 2 GB limit.');
    entries.push({ name, method, csize, size, offset, encrypted: !!(flags & 1) });
  }
  return entries;
}

export async function readEntry(bytes, entry) {
  if (entry.encrypted) throw new Error(`"${entry.name}" is password protected.`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || v.getUint32(entry.offset, true) !== LOC) throw new Error('This zip file is damaged: bad file header.');
  const start = entry.offset + 30 + v.getUint16(entry.offset + 26, true) + v.getUint16(entry.offset + 28, true);
  const raw = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) throw new Error(`"${entry.name}" uses a compression method retro-zip can't read.`);

  // Stop as soon as output passes the size the directory declared.
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = new Uint8Array(entry.size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > entry.size) {
      await reader.cancel();
      throw new Error(`"${entry.name}" unpacks to more than it declares, so it was rejected.`);
    }
    out.set(value, at);
    at += value.length;
  }
  return out;
}
