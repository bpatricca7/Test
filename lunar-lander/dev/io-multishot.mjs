#!/usr/bin/env node
// IO agent QA helper: one page load, several camera views.
//   node dev/io-multishot.mjs --query "scenario=hover&fixedstep=1" --prefix shots/io/hover \
//        --view "chase::game.debug.setCamera('chase')" --view "iva::game.debug.setCamera('iva')" [--wait 2500]
// Each --view is "name::js"; the js runs, then after --wait ms a screenshot <prefix>-<name>.png is saved.
// Prints console errors / page errors; exits 1 on page errors.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { query: '', prefix: 'shots/io/x', wait: 2500, views: [], size: '1280x720', json: [], readyTimeout: 90000 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = () => args[++i];
  if (a === '--query') opt.query = v();
  else if (a === '--prefix') opt.prefix = v();
  else if (a === '--wait') opt.wait = +v();
  else if (a === '--view') opt.views.push(v());
  else if (a === '--size') opt.size = v();
  else if (a === '--json') opt.json.push(v());
}
const [W, H] = opt.size.split('x').map(Number);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/index.html?${opt.query}`;
const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
let errors = 0;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  errors++;
  console.log(`[pageerror] ${e.message}\n${e.stack || ''}`);
});
try {
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const t0 = Date.now();
  while (Date.now() - t0 < opt.readyTimeout) {
    if (await page.evaluate(() => window.__READY === true).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`ready after ${Date.now() - t0} ms`);
  fs.mkdirSync(path.dirname(path.resolve(root, opt.prefix)), { recursive: true });
  for (const spec of opt.views) {
    const i = spec.indexOf('::');
    const name = spec.slice(0, i);
    const js = spec.slice(i + 2);
    const r = await page.evaluate(js).catch((e) => `EVAL ERROR: ${e.message}`);
    if (r !== undefined) console.log(`[${name}] => ${typeof r === 'object' ? JSON.stringify(r) : r}`);
    await new Promise((r) => setTimeout(r, opt.wait));
    const out = `${opt.prefix}-${name}.png`;
    await page.screenshot({ path: path.resolve(root, out), timeout: 180000 });
    const info = await page.evaluate(() => {
      const v = window.game.view;
      return `${v.mode}/${v.station} fov ${v.fov.toFixed(1)} near ${v.near} frame ${window.game.time.frame}`;
    });
    console.log(`saved ${out}  (${info})`);
  }
  for (const j of opt.json) console.log(`[json] ${JSON.stringify(await page.evaluate(j).catch((e) => `EVAL ERROR: ${e.message}`))}`);
} catch (e) {
  console.error('failed:', e);
  errors++;
} finally {
  await browser.close();
  await server.close();
}
process.exit(errors ? 1 : 0);
