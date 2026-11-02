// The only code that downloads games. It is given a catalogue entry, never a
// URL from a request, and nothing is kept unless every check passes.
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { matchesDeclared } from '../shared/formats.mjs';

export const MAX_REDIRECTS = 5;

export class FetchRefused extends Error {}

function checkUrl(raw, allowHosts) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchRefused(`Not a valid address: ${raw}`); }
  if (u.protocol !== 'https:') throw new FetchRefused(`Refused ${u.protocol} address: only HTTPS is allowed.`);
  if (!allowHosts.includes(u.hostname)) throw new FetchRefused(`Refused host ${u.hostname}: it is not on the allowed list.`);
  return u;
}

export async function downloadVerified(entry, { allowHosts, fetchImpl = fetch }) {
  let url = checkUrl(entry.url, allowHosts);
  let res;
  for (let hops = 0; ; hops++) {
    res = await fetchImpl(url, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) break;
    if (hops >= MAX_REDIRECTS) throw new FetchRefused('Refused: too many redirects.');
    const next = res.headers.get('location');
    if (!next) throw new FetchRefused('Refused: redirect without a destination.');
    url = checkUrl(new URL(next, url).href, allowHosts);
  }
  if (!res.ok) throw new FetchRefused(`The source answered HTTP ${res.status}.`);

  // The exact size is known from the catalogue, so one byte more stops the transfer.
  const hash = createHash('sha256');
  const out = new Uint8Array(entry.size);
  let at = 0;
  for await (const chunk of res.body) {
    if (at + chunk.length > entry.size) throw new FetchRefused('Refused: the file is larger than the catalogue says.');
    out.set(chunk, at);
    at += chunk.length;
    hash.update(chunk);
  }
  if (at !== entry.size) throw new FetchRefused(`Refused: expected ${entry.size} bytes, received ${at}.`);
  const sha = hash.digest('hex');
  if (sha !== entry.sha256) throw new FetchRefused('Refused: the file\'s checksum does not match the catalogue.');
  if (!matchesDeclared(entry, out)) throw new FetchRefused('Refused: the file is not the type the catalogue says.');
  return out;
}

export const cachePath = (dir, entry) => join(dir, entry.sha256);

export async function isCached(dir, entry) {
  try { return (await stat(cachePath(dir, entry))).size === entry.size; } catch { return false; }
}

export async function saveToCache(dir, entry, bytes) {
  await mkdir(dir, { recursive: true });
  const tmp = `${cachePath(dir, entry)}.part`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, cachePath(dir, entry));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
