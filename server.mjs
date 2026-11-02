#!/usr/bin/env node
// Local server for retro-zip. Binds to loopback only. Sets the isolation and
// content-security headers and owns the verified download pipeline.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath, downloadVerified, FetchRefused, isCached, saveToCache } from './lib/fetcher.mjs';
import { enginePath, findGameData, hasGameData, launch } from './lib/doom3.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8642);
const HOME = process.env.RETRO_ZIP_HOME || join(homedir(), '.retro-zip');
const CACHE = join(HOME, 'cache');
const SETTINGS = join(HOME, 'settings.json');
const catalog = JSON.parse(readFileSync(join(ROOT, 'data/catalog.json'), 'utf8'));
const byId = new Map(catalog.games.map((g) => [g.id, g]));

// Directories the browser may read. Anything else is a 404.
const MOUNTS = [
  ['/vendor/emulatorjs/', join(ROOT, 'vendor/emulatorjs/')],
  ['/vendor/doom/', join(ROOT, 'vendor/doom/')],
  ['/shared/', join(ROOT, 'shared/')],
  ['/data/top500.json', join(ROOT, 'data/top500.json')],
  ['/', join(ROOT, 'public/')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "frame-src 'self'", "media-src 'self' blob:", "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

// The player page runs game files. It can load its own code and nothing from any other
// host. The emulator cores need 'unsafe-eval', which is why this page is sandboxed with
// no origin: code in it can't reach the library, the API or the network.
const PLAYER_CSP = [
  "default-src 'none'", "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self' blob: data:", "media-src 'self' blob:",
  "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
].join('; ');

const PLAYER_PAGES = new Set(['/play.html', '/doom.html']);

// The player runs in a sandboxed iframe with no origin, so it needs these files
// served cross-origin. They hold only engine code, never user data.
const isPlayerAsset = (p) => PLAYER_PAGES.has(p) || p === '/play.js' || p === '/doom.js' || p.startsWith('/vendor/');

function headers(pathname) {
  const shared = isPlayerAsset(pathname);
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': shared ? 'cross-origin' : 'same-origin',
    ...(shared ? { 'Access-Control-Allow-Origin': '*' } : {}),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': PLAYER_PAGES.has(pathname) ? PLAYER_CSP : APP_CSP,
    'Cache-Control': 'no-cache',
  };
}

function resolveStatic(pathname) {
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    if (!prefix.endsWith('/')) return pathname === prefix ? dir : null;
    const rel = normalize(pathname.slice(prefix.length) || 'index.html');
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
    const file = resolve(dir, rel);
    return file.startsWith(resolve(dir) + sep) ? file : null;
  }
  return null;
}

function json(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers('/api') });
  res.end(out);
}

// Blocks other websites (CSRF) and rebinding hostnames from driving the local API.
function trusted(req) {
  const allowed = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!allowed.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin.replace(/^http:\/\//, ''))) return false;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

function loadSettings() {
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
}

function doom3Status() {
  const engine = enginePath(ROOT);
  const data = findGameData(loadSettings().doom3Path);
  return { engine: !!engine, data: data ?? null, ready: !!(engine && data), platform: process.platform };
}

const inFlight = new Map();
async function ensureCached(entry) {
  if (await isCached(CACHE, entry)) return;
  if (!inFlight.has(entry.id)) {
    inFlight.set(entry.id, downloadVerified(entry, { allowHosts: catalog.allowHosts })
      .then((bytes) => saveToCache(CACHE, entry, bytes))
      .finally(() => inFlight.delete(entry.id)));
  }
  await inFlight.get(entry.id);
}

async function readBody(req, limit = 8192) {
  let size = 0;
  const parts = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Request too large.');
    parts.push(c);
  }
  return JSON.parse(Buffer.concat(parts).toString() || '{}');
}

async function api(req, res, pathname) {
  if (!trusted(req)) return json(res, 403, { error: 'This request did not come from retro-zip.' });

  if (req.method === 'GET' && pathname === '/api/catalog') {
    const games = await Promise.all(catalog.games.map(async (g) => {
      const { url, ...pub } = g;
      return { ...pub, cached: await isCached(CACHE, g) };
    }));
    return json(res, 200, { games, instantBytes: catalog.instantBytes });
  }

  const fetchMatch = /^\/api\/fetch\/([a-z0-9-]+)$/.exec(pathname);
  if (req.method === 'POST' && fetchMatch) {
    const entry = byId.get(fetchMatch[1]);
    if (!entry) return json(res, 404, { error: 'That game is not in the catalogue.' });
    try {
      await ensureCached(entry);
      return json(res, 200, { ok: true });
    } catch (err) {
      const status = err instanceof FetchRefused ? 422 : 502;
      return json(res, status, { error: err instanceof FetchRefused ? err.message : `Download failed: ${err.message}` });
    }
  }

  const gameMatch = /^\/api\/games\/([a-z0-9-]+)$/.exec(pathname);
  if (req.method === 'GET' && gameMatch) {
    const entry = byId.get(gameMatch[1]);
    if (!entry || !(await isCached(CACHE, entry))) return json(res, 404, { error: 'That game has not been downloaded.' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': entry.size, ...headers('/api') });
    return createReadStream(cachePath(CACHE, entry)).pipe(res);
  }

  if (req.method === 'GET' && pathname === '/api/doom3') return json(res, 200, doom3Status());

  if (req.method === 'POST' && pathname === '/api/doom3/folder') {
    const { path } = await readBody(req);
    if (typeof path !== 'string' || !hasGameData(path)) {
      return json(res, 422, { error: 'That folder has no base/pak000.pk4 to pak004.pk4. Choose the folder that contains "base".' });
    }
    mkdirSync(HOME, { recursive: true });
    writeFileSync(SETTINGS, JSON.stringify({ ...loadSettings(), doom3Path: path }, null, 2));
    return json(res, 200, doom3Status());
  }

  if (req.method === 'POST' && pathname === '/api/doom3/launch') {
    const s = doom3Status();
    if (!s.engine) return json(res, 409, { error: 'The Doom III engine isn\'t built yet. Run scripts/build-dhewm3.sh, then try again.' });
    if (!s.data) return json(res, 409, { error: 'Doom III game files weren\'t found. Enter the folder that contains "base".' });
    const pid = await launch(enginePath(ROOT), s.data);
    return json(res, 200, { ok: true, pid });
  }

  return json(res, 404, { error: 'Not found.' });
}

const server = createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end(); }
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (pathname === '/') pathname = '/index.html';
    const file = resolveStatic(pathname);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, headers(pathname));
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      ...headers(pathname),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the local server.' });
    else res.destroy();
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`retro-zip is running at http://127.0.0.1:${PORT}`));
