// Boots emulator cores with tiny hand-written test ROMs that paint the screen red,
// so systems with no free game in the catalogue still get tested.
// Usage: PLAYWRIGHT_MODULE=... node test/e2e-cores.mjs
import { readFileSync } from 'node:fs';
import { loadChromium, startServer } from './e2e-helpers.mjs';

function snes() {
  const rom = new Uint8Array(0x8000);
  // sei; clc; xce; sep #$20; force blank; palette 0 = red; screen on; loop
  rom.set([0x78, 0x18, 0xfb, 0xe2, 0x20, 0xa9, 0x8f, 0x8d, 0x00, 0x21, 0x9c, 0x21, 0x21, 0xa9, 0x1f, 0x8d, 0x22, 0x21,
    0x9c, 0x22, 0x21, 0xa9, 0x0f, 0x8d, 0x00, 0x21, 0x80, 0xfe], 0);
  rom.set([...'RETROZIP TEST ROM    '].map((c) => c.charCodeAt(0)), 0x7fc0);
  rom[0x7fd5] = 0x20; // LoROM
  rom[0x7fd7] = 0x08; // 256 KB size field, tolerated by emulators
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80; // reset vector $8000
  return rom;
}

function sms(gg) {
  const rom = new Uint8Array(0x8000);
  // di; im 1; Mode 4 on; display on; palette 0 = red; loop
  const out = (v, p) => [0x3e, v, 0xd3, p];
  const code = [0xf3, 0xed, 0x56, ...out(0x04, 0xbf), ...out(0x80, 0xbf), ...out(0x40, 0xbf), ...out(0x81, 0xbf), ...out(0x00, 0xbf), ...out(0xc0, 0xbf)];
  if (gg) code.push(...out(0x0f, 0xbe), ...out(0x00, 0xbe));
  else code.push(...out(0x03, 0xbe));
  code.push(0x18, 0xfe);
  rom.set(code, 0);
  return rom;
}

function atari2600() {
  const rom = new Uint8Array(0x1000);
  // Red background and a standard VSYNC frame loop.
  rom.set([0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0x42, 0x85, 0x09,
    0xa9, 0x02, 0x85, 0x00, 0x85, 0x02, 0x85, 0x02, 0x85, 0x02, 0xa9, 0x00, 0x85, 0x00,
    0xa2, 0xfa, 0x85, 0x02, 0xca, 0xd0, 0xfb, 0x4c, 0x09, 0xf0], 0);
  rom[0xffc] = 0x00; rom[0xffd] = 0xf0;
  return rom;
}

const CASES = [
  ['test.sfc', snes(), 'Super NES'],
  ['test.sms', sms(false), 'Master System'],
  ['test.gg', sms(true), 'Game Gear'],
  ['test.a26', atari2600(), 'Atari 2600'],
];

const chromium = await loadChromium();
const { proc, url, home } = await startServer(8647);
const browser = await chromium.launch();

async function centreColour(buffer) {
  const p = await browser.newPage();
  await p.goto('about:blank');
  const c = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height);
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    return [...g.getImageData(img.width >> 1, img.height >> 1, 1, 1).data].slice(0, 3);
  }, buffer.toString('base64'));
  await p.close();
  return c;
}

let failed = 0;
for (const [name, bytes, label] of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${url}/#/games`);
    await page.locator('#picker').setInputFiles([{ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }]);
    await page.locator('.game button.play').first().click();
    await page.waitForSelector('.player iframe');
    await page.locator('.player-status').waitFor({ state: 'detached', timeout: 45000 });
    await page.waitForTimeout(2500);
    const shot = await page.locator('.stage').screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/core-${label.replaceAll(' ', '')}.png` : undefined });
    const [r, g, b] = await centreColour(shot);
    const red = r > 120 && g < 90 && b < 90;
    console.log(`${red ? 'ok  ' : 'FAIL'} ${label}: centre colour ${r},${g},${b}`);
    if (!red) failed++;
  } catch (err) {
    failed++;
    console.log(`FAIL ${label}: ${err.message.split('\n')[0]}`);
  }
  await ctx.close();
}

// Each arcade emulator must run a free set, and choosing one must take effect.
const cat = await (await fetch(`${url}/api/catalog`)).json();
const gridlee = cat.games.find((x) => x.id === 'mame-gridlee');
for (const core of ['fbneo', 'mame2003_plus']) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  try {
    await page.request.post(`${url}/api/fetch/${gridlee.id}`, { headers: { Origin: url } });
    await page.goto(`${url}/#/games`);
    await page.locator('#picker').setInputFiles([{
      name: gridlee.fileName, mimeType: 'application/zip', buffer: readFileSync(`${home}/cache/${gridlee.sha256}`),
    }]);
    await page.locator('.game').first().waitFor();
    await page.getByRole('combobox', { name: /Arcade emulator/ }).selectOption(core);
    await page.getByText(`now uses ${core}`).first().waitFor();
    await page.locator('.game button.play').first().click();
    await page.waitForSelector('.player iframe');
    await page.locator('.player-status').waitFor({ state: 'detached', timeout: 45000 });
    await page.waitForTimeout(3500);
    const used = await page.frames().find((f) => f.url().includes('/play.html')).evaluate(() => window.EJS_emulator.getCore());
    const shot = await page.locator('.stage').screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/arcade-${core}.png` : undefined });
    const [r, g, b] = await centreColour(shot);
    const pass = used === core && !(r > 200 && g > 200 && b > 200);
    console.log(`${pass ? 'ok  ' : 'FAIL'} arcade on ${core}: core in use ${used}, centre colour ${r},${g},${b}`);
    if (!pass) failed++;
  } catch (err) {
    failed++;
    console.log(`FAIL arcade on ${core}: ${err.message.split('\n')[0]}`);
  }
  await ctx.close();
}
// A core that can't load must produce a visible error, not an endless wait.
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx.route('**/cores/snes9x*', (route) => route.abort());
  const page = await ctx.newPage();
  try {
    await page.goto(`${url}/#/games`);
    await page.locator('#picker').setInputFiles([{ name: 'test.sfc', mimeType: 'application/octet-stream', buffer: Buffer.from(snes()) }]);
    await page.locator('.game button.play').first().click();
    await page.locator('.player-status.bad').waitFor({ timeout: 30000 });
    console.log(`ok   start failure is shown: ${await page.locator('.player-status').innerText()}`);
  } catch (err) {
    failed++;
    console.log(`FAIL start failure is shown: ${err.message.split('\n')[0]}`);
  }
  await ctx.close();
}

await browser.close();
proc.kill();
process.exit(failed ? 1 : 0);
