// Boots catalogue games in a real browser and checks the picture is alive.
// Usage: PLAYWRIGHT_MODULE=... node test/e2e-boot.mjs [catalogue ids...]
import { loadChromium, startServer } from './e2e-helpers.mjs';

const DEFAULT = ['thwaite', 'libbet', 'klele-atoms', 'gbadev-containers', 'mame-gridlee'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const SHOTS = process.env.SHOTS;

const chromium = await loadChromium();
const { proc, url } = await startServer(8643);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = 0;

for (const id of ids) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  try {
    await page.goto(url);
    await page.waitForSelector('.game');
    const cat = await (await page.request.get(`${url}/api/catalog`)).json();
    const g = cat.games.find((x) => x.id === id);
    const row = page.locator('.game').filter({ has: page.getByText(g.title, { exact: true }) }).first();
    await row.locator('button.play').click();
    const understand = page.getByRole('button', { name: 'I understand, continue' });
    await understand.click({ timeout: 2500 }).catch(() => {});
    const dl = page.getByRole('button', { name: /^Download \d/ }).last();
    if (g.size > cat.instantBytes) await dl.click({ timeout: 2500 }).catch(() => {});
    await page.waitForSelector('.player iframe', { timeout: 60000 });
    const status = page.locator('.player-status');
    const outcome = await Promise.race([
      status.waitFor({ state: 'detached', timeout: 45000 }).then(() => 'started'),
      page.locator('.player-status.bad').waitFor({ timeout: 45000 }).then(() => 'bad'),
    ]);
    if (outcome === 'bad') throw new Error(await page.locator('.player-status.bad').innerText());
    await page.waitForTimeout(4000);
    // Press start a few times so title screens move on.
    const stage = page.locator('.stage');
    const before = await stage.screenshot();
    for (const key of ['Enter', 'z', 'x', 's', 'Enter']) { await page.keyboard.press(key, { delay: 120 }); await page.waitForTimeout(700); }
    await page.waitForTimeout(1500);
    const after = await stage.screenshot();
    if (SHOTS) await stage.screenshot({ path: `${SHOTS}/boot-${id}.png` });
    const changed = !before.equals(after);
    const distinct = new Set(after).size;
    console.log(`${changed ? 'ok  ' : 'SAME'} ${id} (core ${g.core}) png=${after.length}B distinct=${distinct}`);
    if (!changed) failed++;
  } catch (err) {
    failed++;
    console.log(`FAIL ${id}: ${err.message.split('\n')[0]}`);
  }
  for (const e of errors.slice(0, 6)) console.log(`     ${e.slice(0, 200)}`);
  await ctx.close();
}
await browser.close();
proc.kill();
process.exit(failed ? 1 : 0);
