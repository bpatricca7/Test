#!/usr/bin/env node
// Headless screenshot / smoke-test tool.
//
// Starts a private Vite dev server (random free port), opens a page in headless
// Chromium (SwiftShader WebGL), waits for the page to signal readiness, optionally
// runs JS steps, captures screenshots, and prints console errors.
//
// Usage:
//   node tools/shot.mjs --page index.html --query "scenario=approach&camera=chase" \
//        --out shots/approach.png [--wait 8000] [--size 1280x720] \
//        [--eval "window.game.debug.setCamera('iva')"] [--shots 3 --interval 2000]
//        [--ready-timeout 60000] [--keys "w:500,space:100"]
//
//   --page      path relative to project root (default index.html)
//   --query     query string appended to the page URL
//   --out       output png path (with --shots N, suffix _0,_1,... is added)
//   --wait      ms to wait after ready before first shot (default 3000)
//   --eval      JS expression run in page after ready (may be given multiple times)
//   --keys      comma list key:holdMs pressed in sequence after --eval steps
//   --shots     number of screenshots, --interval ms between them
//   --ready-timeout  ms to wait for window.__READY === true (default 60000; if the page
//               never sets it, the tool continues after the timeout)
//   --json      JS expression whose JSON value is printed after the last shot
//
// Exit code 1 if the page threw uncaught errors (pageerror).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { page: 'index.html', query: '', out: 'shots/shot.png', wait: 3000, size: '1280x720', evals: [], shots: 1, interval: 2000, readyTimeout: 60000, keys: '', json: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = () => args[++i];
  if (a === '--page') opt.page = v();
  else if (a === '--query') opt.query = v();
  else if (a === '--out') opt.out = v();
  else if (a === '--wait') opt.wait = +v();
  else if (a === '--size') opt.size = v();
  else if (a === '--eval') opt.evals.push(v());
  else if (a === '--shots') opt.shots = +v();
  else if (a === '--interval') opt.interval = +v();
  else if (a === '--ready-timeout') opt.readyTimeout = +v();
  else if (a === '--keys') opt.keys = v();
  else if (a === '--json') opt.json = v();
}
const [W, H] = opt.size.split('x').map(Number);

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/${opt.page}${opt.query ? '?' + opt.query : ''}`;

const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}] ${m.text()}`);
  else if (process.env.SHOT_VERBOSE) console.log(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => { errors.push(e); console.log(`[pageerror] ${e.message}\n${e.stack || ''}`); });

let exitCode = 0;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < opt.readyTimeout) {
    ready = await page.evaluate(() => window.__READY === true).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(ready ? `ready after ${Date.now() - t0} ms` : `WARNING: window.__READY not set within ${opt.readyTimeout} ms; continuing`);
  for (const e of opt.evals) {
    const r = await page.evaluate(e).catch((err) => `EVAL ERROR: ${err.message}`);
    if (r !== undefined) console.log(`[eval] ${e} => ${typeof r === 'object' ? JSON.stringify(r) : r}`);
  }
  if (opt.keys) {
    for (const k of opt.keys.split(',')) {
      const [key, ms] = k.split(':');
      await page.keyboard.down(key);
      await new Promise((r) => setTimeout(r, +ms || 100));
      await page.keyboard.up(key);
    }
  }
  await new Promise((r) => setTimeout(r, opt.wait));
  fs.mkdirSync(path.dirname(path.resolve(root, opt.out)), { recursive: true });
  for (let i = 0; i < opt.shots; i++) {
    const out = opt.shots > 1 ? opt.out.replace(/\.png$/, `_${i}.png`) : opt.out;
    await page.screenshot({ path: path.resolve(root, out) });
    console.log(`saved ${out}`);
    if (i < opt.shots - 1) await new Promise((r) => setTimeout(r, opt.interval));
  }
  if (opt.json) {
    const r = await page.evaluate(opt.json).catch((err) => `EVAL ERROR: ${err.message}`);
    console.log(`[json] ${JSON.stringify(r, null, 2)}`);
  }
  if (errors.length) exitCode = 1;
} catch (e) {
  console.error('shot failed:', e);
  exitCode = 2;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
