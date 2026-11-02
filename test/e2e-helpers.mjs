// Playwright comes from outside the repo so it doesn't add a dependency.
// Set PLAYWRIGHT_MODULE to a playwright-core entry point to run the browser tests.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function loadChromium() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
  return chromium;
}

export async function startServer(port) {
  const home = mkdtempSync(join(tmpdir(), 'retro-zip-test-'));
  const proc = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: String(port), RETRO_ZIP_HOME: home }, stdio: 'inherit' });
  process.on('exit', () => rmSync(home, { recursive: true, force: true }));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return { proc, home, url: `http://127.0.0.1:${port}` };
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Server did not start');
}
