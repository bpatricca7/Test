// Multi-view screenshots of dev/csm-cabin.html in ONE browser session (CSM-CABIN helper).
// usage: node dev/csm-cabin-multishot.mjs '<query>' '<views JSON>' [prefix] [waitMs]
//   views: [{ "name": "fwd", "yaw": 0, "pitch": -10, "fov": 75, "station": "CDR", "eval": "js before",
//            "after": "js after the view is set" }, ...]
//   screenshots go to shots/csm-cabin/<prefix>-<name>.png
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [query = '', viewsJson = '[{"name":"fwd"}]', prefix = 'm', waitMs = '1200'] = process.argv.slice(2);
const views = JSON.parse(viewsJson);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/dev/csm-cabin.html?${query}`;
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(exe) ? exe : undefined,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let errs = 0;
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message, e.stack); });
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) console.log('[console]', m.text()); });
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
for (let i = 0; i < 480; i++) {
  if (await page.evaluate(() => window.__READY === true)) break;
  await new Promise((r) => setTimeout(r, 250));
}
fs.mkdirSync(path.join(root, 'shots/csm-cabin'), { recursive: true });
for (const v of views) {
  if (v.eval) {
    const r = await page.evaluate(v.eval).catch((e) => 'EVAL ERROR ' + e.message);
    if (r !== undefined) console.log(`[eval ${v.name}]`, typeof r === 'object' ? JSON.stringify(r) : r);
  }
  await page.evaluate((o) => window.H.setView(o), v);
  await new Promise((r) => setTimeout(r, v.wait ?? +waitMs));
  if (v.after) {
    const r = await page.evaluate(v.after).catch((e) => 'EVAL ERROR ' + e.message);
    console.log(`[after ${v.name}]`, typeof r === 'object' ? JSON.stringify(r) : r);
  }
  const out = path.join(root, 'shots/csm-cabin', `${prefix}-${v.name}.png`);
  await page.screenshot({ path: out });
  console.log('saved', path.relative(root, out));
}
await browser.close();
await server.close();
process.exit(errs ? 1 : 0);
