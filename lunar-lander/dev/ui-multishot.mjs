#!/usr/bin/env node
// UI agent QA helper: one page load, several UI states / viewport sizes.
//   node dev/ui-multishot.mjs --query "scenario=hover&fixedstep=1" --prefix shots/ui/hover \
//        --view "chase::game.debug.setCamera('chase')" --view "phone@420x860::0" [--wait 1500]
// Each --view is "name[@WxH]::js[::keys]"; the js runs (after resizing the viewport, if given),
// then the optional comma-separated keys are pressed (e.g. "ArrowDown,Enter"), and after --wait ms
// a screenshot <prefix>-<name>.png is saved. Exits 1 on page errors.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { query: '', prefix: 'shots/ui/x', wait: 1500, views: [], size: '1280x720', json: [], readyTimeout: 90000, page: 'index.html' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = () => args[++i];
  if (a === '--query') opt.query = v();
  else if (a === '--prefix') opt.prefix = v();
  else if (a === '--wait') opt.wait = +v();
  else if (a === '--view') opt.views.push(v());
  else if (a === '--size') opt.size = v();
  else if (a === '--json') opt.json.push(v());
  else if (a === '--page') opt.page = v();
  else if (a === '--ready-timeout') opt.readyTimeout = +v();
}
const [W, H] = opt.size.split('x').map(Number);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/${opt.page}${opt.query ? '?' + opt.query : ''}`;
const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
let errors = 0;
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/404|willReadFrequently/.test(m.text())) console.log(`[console.${m.type()}] ${m.text()}`);
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
    const parts = spec.split('::');
    let [name, size] = parts[0].split('@');
    const js = parts[1] || '0';
    const keys = parts[2] ? parts[2].split(',') : [];
    const [w, h] = (size || opt.size).split('x').map(Number);
    await page.setViewportSize({ width: w, height: h });
    const r = await page.evaluate(js).catch((e) => `EVAL ERROR: ${e.message}`);
    if (r !== undefined && r !== 0) console.log(`[${name}] => ${typeof r === 'object' ? JSON.stringify(r) : r}`);
    for (const k of keys) {
      await page.keyboard.press(k);
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, opt.wait));
    const out = `${opt.prefix}-${name}.png`;
    await page.screenshot({ path: path.resolve(root, out), timeout: 180000 });
    console.log(`saved ${out}`);
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
