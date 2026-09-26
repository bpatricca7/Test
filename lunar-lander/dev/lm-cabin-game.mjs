// In-game multi-view screenshots of the LM cabin in ONE browser session (LM-CABIN helper).
// usage: node dev/lm-cabin-game.mjs '<query>' '<views JSON>' [prefix] [waitMs]
//   query: e.g. 'scenario=landed&camera=iva&fixedstep=1'
//   views: [{ "name": "fwd", "yaw": 0, "pitch": -15, "station": "CDR", "fov": 66, "eval": "js" }, ...]
//          yaw/pitch are the IO camera's head-look angles (yaw + = right, pitch + = up).
//   screenshots go to shots/lm-cabin/<prefix>-<name>.png; prints the cabin stats and renderer info.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [query = 'scenario=landed&camera=iva&fixedstep=1', viewsJson = '[{"name":"fwd"}]', prefix = 'g', waitMs = '600'] = process.argv.slice(2);
const views = JSON.parse(viewsJson);
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/index.html?hud=0&audio=0&${query}`;
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(exe) ? exe : undefined,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let errs = 0;
page.on('pageerror', (e) => { errs++; console.log('[pageerror]', e.message, e.stack); });
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) console.log('[console]', m.text()); });
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
for (let i = 0; i < 600; i++) {
  if (await page.evaluate(() => window.__READY === true)) break;
  await new Promise((r) => setTimeout(r, 250));
}
fs.mkdirSync(path.join(root, process.env.SHOT_DIR || 'shots/lm-cabin'), { recursive: true });
const frames = () => page.evaluate(() => window.game.debug.renderFrames);
for (const v of views) {
  if (v.eval) {
    const r = await page.evaluate(v.eval).catch((e) => 'EVAL ERROR ' + e.message);
    if (r !== undefined) console.log(`[eval ${v.name}]`, typeof r === 'object' ? JSON.stringify(r) : r);
  }
  await page.evaluate((o) => {
    const g = window.game;
    if (o.station && g.view.station !== o.station) g.debug.cameras.setStation?.(o.station);
    g.debug.cameras.setLook?.(o.yaw ?? 0, o.pitch ?? (o.station === 'OVERHEAD' ? 0 : -15));
  }, v);
  const f0 = await frames();
  for (let i = 0; i < 900; i++) {
    if ((await frames()) >= f0 + (v.frames ?? 4)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, v.wait ?? +waitMs));
  const out = path.join(root, process.env.SHOT_DIR || 'shots/lm-cabin', `${prefix}-${v.name}.png`);
  await page.screenshot({ path: out, timeout: 240000 });
  console.log('saved', path.relative(root, out));
}
const info = await page.evaluate(() => {
  const c = window.game.debug.modules.lmCabin;
  const r = window.game.debug.ctx.renderer.info;
  return { cabin: c.stats?.(), calls: r.render.calls, tris: r.render.triangles, programs: r.programs?.length, textures: r.memory.textures, geometries: r.memory.geometries };
});
console.log('[info]', JSON.stringify(info));
await browser.close();
await server.close();
process.exit(errs ? 1 : 0);
