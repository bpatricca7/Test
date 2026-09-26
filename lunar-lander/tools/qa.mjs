#!/usr/bin/env node
// QA screenshot matrix: one Vite server + one browser, many pages.
//
// Usage: node tools/qa.mjs [--only name1,name2] [--out shots/qa] [--size 1280x720] [--plan plan.json]
// Each plan entry: { name, query, evals?: [js], wait?: ms, json?: js }
// Prints per-shot console errors/page errors and a summary; exit 1 if any page errors.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { out: 'shots/qa', size: '1280x720', only: null, plan: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--size') opt.size = args[++i];
  else if (args[i] === '--only') opt.only = args[++i].split(',');
  else if (args[i] === '--plan') opt.plan = args[++i];
}
const [W, H] = opt.size.split('x').map(Number);

// Default plan: every scenario in its main views, plus the special moments.
const DEFAULT_PLAN = [
  { name: 'menu', query: '', wait: 1500, evals: ['game.debug.modules.ui.finishBackdrop && game.debug.modules.ui.finishBackdrop()'] },
  { name: 'pdi-iva', query: 'scenario=pdi&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'pdi-chase', query: 'scenario=pdi&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'highgate-iva', query: 'scenario=highgate&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'highgate-chase', query: 'scenario=highgate&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'lowgate-iva', query: 'scenario=lowgate&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'lowgate-chase', query: 'scenario=lowgate&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'hover-chase', query: 'scenario=hover&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'hover-iva', query: 'scenario=hover&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'landed-chase', query: 'scenario=landed&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'landed-iva', query: 'scenario=landed&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'landed-ground', query: 'scenario=landed&camera=ground&fixedstep=1', wait: 2500 },
  { name: 'undock-chase', query: 'scenario=undock&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'undock-lm-iva', query: 'scenario=undock&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'undock-csm-iva', query: 'scenario=undock&camera=iva&vessel=CSM&fixedstep=1', wait: 2500 },
  { name: 'csm-iva', query: 'scenario=csm&camera=iva&fixedstep=1', wait: 2500 },
  { name: 'csm-chase', query: 'scenario=csm&camera=chase&fixedstep=1', wait: 2500 },
  { name: 'csm-flyby', query: 'scenario=csm&camera=flyby&fixedstep=1', wait: 2500 },
];

let plan = DEFAULT_PLAN;
if (opt.plan) plan = JSON.parse(fs.readFileSync(path.resolve(root, opt.plan), 'utf8'));
if (opt.only) plan = plan.filter((p) => opt.only.includes(p.name));

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(exe) ? exe : undefined,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
fs.mkdirSync(path.resolve(root, opt.out), { recursive: true });
let failures = 0;
const summary = [];
for (const p of plan) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  const warns = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text());
    if (m.type() === 'warning') warns.push(m.text());
  });
  const url = `http://127.0.0.1:${port}/index.html${p.query ? '?' + p.query : ''}`;
  const t0 = Date.now();
  let info = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    const deadline = Date.now() + (p.readyTimeout || 90000);
    while (Date.now() < deadline) {
      if (await page.evaluate(() => window.__READY === true).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const e of p.evals || []) await page.evaluate(e).catch((err) => errs.push('eval: ' + err.message));
    await new Promise((r) => setTimeout(r, p.wait ?? 2000));
    // make sure at least two more frames have rendered since the waits (slow SwiftShader frames)
    const f0 = await page.evaluate(() => window.game?.debug?.renderFrames ?? 0).catch(() => 0);
    const tf = Date.now();
    while (Date.now() - tf < 60000) {
      const f1 = await page.evaluate(() => window.game?.debug?.renderFrames ?? 0).catch(() => 0);
      if (f1 >= f0 + 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.screenshot({ path: path.resolve(root, opt.out, `${p.name}.png`), timeout: 180000 });
    info = await page
      .evaluate(
        p.json ||
          `(() => { const g = window.game; if (!g || !g.started) return null; const v = g.active, t = v.tel;
             return { v: v.id, cam: g.view.mode, alt: +t.altitude.toFixed(1), vs: +t.vSpeed.toFixed(2), hs: +t.hSpeed.toFixed(2),
               prog: v.gnc.program, thr: +v.mainEngine.throttle.toFixed(2), fps: g.debug.renderFrames }; })()`,
      )
      .catch(() => null);
  } catch (e) {
    errs.push('nav: ' + e.message);
  }
  const ms = Date.now() - t0;
  if (errs.length) failures++;
  summary.push({ name: p.name, ms, errors: errs.length });
  console.log(`\n== ${p.name} (${ms} ms) ${errs.length ? 'ERRORS' : 'ok'} ${info ? JSON.stringify(info) : ''}`);
  for (const e of errs.slice(0, 8)) console.log('   ! ' + e.split('\n')[0]);
  const uniqWarn = [...new Set(warns)].slice(0, 4);
  for (const w of uniqWarn) console.log('   ~ ' + w.split('\n')[0].slice(0, 200));
  await page.close();
}
await browser.close();
await server.close();
console.log(`\n${plan.length} shots, ${failures} with errors -> ${opt.out}/`);
process.exit(failures ? 1 : 0);
