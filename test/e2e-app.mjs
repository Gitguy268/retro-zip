// Full flow in a real browser. Usage: PLAYWRIGHT_MODULE=... node test/e2e-app.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadChromium, startServer } from './e2e-helpers.mjs';

const chromium = await loadChromium();
const { proc, url, home } = await startServer(8644);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL ${name}: ${String(err.message).split('\n')[0]}`);
  }
};
const fixture = async (id) => {
  const cat = await (await page.request.get(`${url}/api/catalog`)).json();
  const g = cat.games.find((x) => x.id === id);
  const res = await page.request.post(`${url}/api/fetch/${id}`, { headers: { Origin: url } });
  assert.equal(res.status(), 200);
  return { name: g.fileName, mimeType: 'application/octet-stream', buffer: readFileSync(join(home, 'cache', g.sha256)) };
};
const addFiles = (files) => page.locator('#picker').setInputFiles(files);
const started = async () => {
  await page.waitForSelector('.player iframe');
  await page.locator('.player-status').waitFor({ state: 'detached', timeout: 45000 });
  await page.waitForTimeout(1500);
};
const playerFrame = () => page.frames().find((f) => f.url().includes('/play.html'));

await page.goto(url);
await page.waitForSelector('.lineup li');

await check('API refuses other websites and unknown games', async () => {
  const evil = await page.request.post(`${url}/api/fetch/thwaite`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status(), 403);
  const rebind = await page.request.get(`${url}/api/catalog`, { headers: { Host: 'evil.example:8644' } });
  assert.equal(rebind.status(), 403);
  const unknown = await page.request.post(`${url}/api/fetch/nope`, { headers: { Origin: url } });
  assert.equal(unknown.status(), 404);
  const cat = await (await page.request.get(`${url}/api/catalog`)).json();
  assert.ok(!('url' in cat.games[0]), 'download addresses stay on the server');
});

await check('server blocks path traversal', async () => {
  for (const p of ['/..%2f..%2fetc%2fpasswd', '/vendor/emulatorjs/..%2f..%2fserver.mjs', '/%2e%2e/package.json']) {
    assert.equal((await page.request.get(url + p)).status(), 404, p);
  }
});

await check('Doom III: bad folders are refused and a missing setup explains itself', async () => {
  const status = await (await page.request.get(`${url}/api/doom3`)).json();
  const bad = await page.request.post(`${url}/api/doom3/folder`, { headers: { Origin: url, 'Content-Type': 'application/json' }, data: { path: '/tmp' } });
  assert.equal(bad.status(), 422);
  if (!status.ready) {
    const launch = await page.request.post(`${url}/api/doom3/launch`, { headers: { Origin: url } });
    assert.equal(launch.status(), 409);
    assert.match((await launch.json()).error, status.engine ? /game files/ : /engine/);
  }
});

await check('home shows the seven named games', async () => {
  const text = await page.locator('.lineup').innerText();
  for (const t of ['Doom', 'Doom III', 'Pac-Man', 'Street Fighter II', 'Donkey Kong', 'Sonic the Hedgehog 2', 'Streets of Rage 2']) assert.ok(text.includes(t), t);
});

await check('top 500 has 500 rows and filters', async () => {
  await page.goto(`${url}/#/top`);
  const data = await (await page.request.get(`${url}/data/top500.json`)).json();
  assert.equal(data.length, 500);
  await page.getByRole('searchbox').fill('sonic the hedgehog 2');
  assert.equal(await page.locator('.scores li').count(), 2);
  await page.getByRole('searchbox').fill('');
  assert.equal(await page.locator('.scores li').count(), 100);
});

await check('.rvz and non-games are refused with the reason', async () => {
  await page.goto(`${url}/#/games`);
  await addFiles([{ name: 'game.rvz', mimeType: 'application/octet-stream', buffer: Buffer.from('RVZ\x01aaaa') }]);
  await page.getByText(/GameCube and Wii/).first().waitFor({ timeout: 3000 });
  await addFiles([{ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZaaaa') }]);
  await page.getByText(/Programs can't be added/).first().waitFor({ timeout: 3000 });
  assert.equal(await page.locator('.game').count(), 0);
});

const nesFile = await fixture('thwaite');

await check('adding a game keeps it after a reload', async () => {
  await addFiles([nesFile]);
  await page.locator('.game').first().waitFor();
  await page.reload();
  await page.locator('.game').first().waitFor();
  assert.match(await page.locator('.game').first().innerText(), /NES/);
});

await check('own game boots, and save/load state round-trips', async () => {
  await page.locator('.game button.play').first().click();
  await started();
  const f = playerFrame();
  await page.keyboard.press('Enter', { delay: 150 });
  await page.waitForTimeout(900);
  const stage = page.locator('.stage');
  // Toasts sit over the picture, so keep them out of the comparisons.
  await page.addStyleTag({ content: '#toasts{display:none}' }).catch(() => {});
  await page.getByRole('button', { name: 'Save state' }).click();
  await page.getByText('State saved').first().waitFor({ state: 'attached', timeout: 8000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(4000);
  const saved = await stage.screenshot();
  await page.keyboard.press('Enter', { delay: 150 });
  await page.waitForTimeout(1500);
  const moved = await stage.screenshot();
  assert.ok(!saved.equals(moved), 'game moved on after saving');
  await page.getByRole('button', { name: 'Load state' }).click();
  await page.waitForTimeout(1500);
  assert.ok(await f.evaluate(() => window.EJS_emulator.started));
  const restored = await stage.screenshot();
  assert.ok(restored.equals(saved), 'picture went back to the saved moment');
  await page.getByRole('button', { name: 'Back to games' }).click();
});

await check('a saved state is still there on the next run', async () => {
  await page.reload();
  await page.locator('.game button.play').first().click();
  await started();
  assert.equal(await page.getByRole('button', { name: 'Load state' }).isDisabled(), false);
});

await check('sandbox: player has no origin, no storage, no reach into the app, no network', async () => {
  const f = playerFrame();
  const r = await f.evaluate(async () => {
    const out = { origin: self.origin, idb: window.indexedDB, ls: window.localStorage };
    try { out.parent = !!parent.document; } catch { out.parent = 'blocked'; }
    out.xhr = await new Promise((done) => {
      const x = new XMLHttpRequest();
      x.onload = () => done('reached');
      x.onerror = () => done('blocked');
      try { x.open('GET', 'https://example.com/'); x.send(); } catch { done('blocked'); }
    });
    out.api = await new Promise((done) => {
      const x = new XMLHttpRequest();
      x.onload = () => done(x.status);
      x.onerror = () => done('blocked');
      x.open('POST', `${location.origin}/api/fetch/thwaite`);
      x.send();
    });
    return out;
  });
  assert.equal(r.origin, 'null');
  assert.equal(r.idb, undefined);
  assert.equal(r.ls, undefined);
  assert.equal(r.parent, 'blocked');
  assert.equal(r.xhr, 'blocked');
  assert.notEqual(r.api, 200, 'player cannot drive the download API');
  await page.getByRole('button', { name: 'Back to games' }).click();
});

await check('a list plays in order with a Next button', async () => {
  await page.goto(`${url}/#/`);
  await page.waitForSelector('.game');
  for (const title of ['Libbet and the Magic Floor', 'Thwaite']) {
    const row = page.locator('.game').filter({ has: page.getByText(title, { exact: true }) }).first();
    await row.getByRole('button', { name: 'Add to list' }).click();
    const inputs = page.locator('dialog input');
    if (title === 'Libbet and the Magic Floor') await inputs.fill('Evening');
    await page.getByRole('button', { name: 'Add to list', exact: true }).last().click();
    await page.getByText(/Added to Evening/).last().waitFor();
  }
  await page.goto(`${url}/#/lists`);
  await page.getByRole('button', { name: 'Play list' }).click();
  await started();
  assert.match(await page.locator('.player h2').innerText(), /Libbet/);
  await page.getByRole('button', { name: /^Next: Thwaite/ }).click();
  await started();
  assert.match(await page.locator('.player h2').innerText(), /Thwaite/);
  assert.equal(await page.getByRole('button', { name: /^Next/ }).count(), 0);
  await page.getByRole('button', { name: 'Back to games' }).click();
});

await check('list reorder persists', async () => {
  await page.reload();
  await page.getByRole('button', { name: /Move Thwaite up/ }).click();
  await page.waitForTimeout(200);
  await page.reload();
  await page.locator('.shelf .game').first().waitFor();
  assert.match(await page.locator('.shelf .game').first().innerText(), /Thwaite/);
});

await check('adding your copy from a row links the file to that game', async () => {
  const set = await fixture('mame-gridlee');
  await page.goto(`${url}/#/top`);
  await page.getByRole('searchbox').fill('pac-man');
  const row = page.locator('.scores li').filter({ hasText: 'Arcade, 1980' });
  const chooser = page.waitForEvent('filechooser');
  await row.getByRole('button', { name: 'Add your copy' }).click();
  await (await chooser).setFiles([set]);
  await page.getByText(/Added Pac-Man/).first().waitFor();
  await page.locator('.scores li').filter({ hasText: 'Arcade, 1980' }).getByRole('button', { name: 'Play', exact: true }).waitFor();
  await page.goto(`${url}/#/games`);
  assert.equal(await page.getByRole('combobox', { name: /Arcade emulator for Pac-Man/ }).inputValue(), 'fbneo');
});

await check('wrapped ROM in a zip unpacks to the game inside', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const name = Buffer.from('thwaite.nes');
  const data = deflateRawSync(nesFile.buffer);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(nesFile.buffer.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(nesFile.buffer.length, 24); cen.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cen.length + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
  await addFiles([{ name: 'wrapped.zip', mimeType: 'application/zip', buffer: Buffer.concat([local, name, data, cen, name, end]) }]);
  await page.getByText(/Added thwaite \(NES\)/).first().waitFor({ timeout: 4000 });
});

await check('terminal mode: every game starts and draws from the keyboard', async () => {
  await page.goto(`${url}/#/terminal`);
  const crt = page.locator('.crt');
  await crt.waitFor();
  for (const name of ['Rocks', 'Snake', 'Swarm', 'Bricks', 'Paddle', 'Hop']) {
    assert.match(await crt.innerText(), new RegExp(`> ${name}`));
    await page.keyboard.press('Space', { delay: 60 });
    await page.waitForTimeout(150);
    const a = await crt.innerText();
    assert.ok(a.toUpperCase().includes(name.toUpperCase()), `${name} on screen`);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    assert.notEqual(await crt.innerText(), a, `${name} moves`);
    await page.keyboard.press('Escape', { delay: 60 });
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowDown', { delay: 60 });
    await page.waitForTimeout(100);
  }
});

await check('terminal mode: Normal mode button returns to the library', async () => {
  await page.getByRole('button', { name: 'Normal mode' }).click();
  await page.locator('.marquee').waitFor();
  assert.equal(await page.locator('.crt').count(), 0);
});

await browser.close();
proc.kill();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
