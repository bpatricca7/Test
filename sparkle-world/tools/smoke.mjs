// Headless smoke / play test for dist/sparkle-world.html (Playwright + SwiftShader WebGL2).
// Fails (exit 1) on any console error, page error or failed request (the optional Google
// Fonts request is ignored). Screenshots go to .shots/<prefix>-*.png.
//
//   node tools/smoke.mjs [--biome=meadow] [--shots-prefix=core] [--only=desktop|touch] [--headed]
//
// The helpers are exported so feature teams can write their own scenario scripts:
//   import { launch, openGame, startWorld, waitIdle, shot, finish } from './smoke.mjs';

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_URL = pathToFileURL(path.join(ROOT, 'dist', 'sparkle-world.html')).href;
export const SHOTS = path.join(ROOT, '.shots');
export const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
export const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const IGNORED_URLS = /fonts\.(googleapis|gstatic)\.com/;

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { biome: 'meadow', prefix: 'core', only: null, headed: false };
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'biome') opts.biome = v;
    else if (k === 'shots-prefix') opts.prefix = v;
    else if (k === 'only') opts.only = v;
    else if (k === 'headed') opts.headed = true;
  }
  return opts;
}

export async function launch({ headed = false } = {}) {
  return chromium.launch({ executablePath: CHROMIUM, args: LAUNCH_ARGS, headless: !headed });
}

/**
 * New context + page on the built game. errors: array that collects every problem.
 * device: { viewport, touch } (touch => hasTouch + isMobile).
 */
export async function openGame(browser, { errors, viewport = { width: 1280, height: 800 }, touch = false, label = 'page' } = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
  });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, label);
  await page.goto(PAGE_URL);
  await waitForTitle(page);
  return { context, page };
}

export function attachErrorCollectors(page, errors, label = 'page') {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() && msg.location().url) || '';
    if (IGNORED_URLS.test(url) || IGNORED_URLS.test(msg.text())) return;
    errors.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => {
    if (IGNORED_URLS.test(req.url())) return;
    errors.push(`[${label}] request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`);
  });
}

export async function waitForTitle(page, timeout = 30000) {
  await page.waitForFunction(() => window.__game && window.__game.ui && window.__game.ui.current === 'title', null, { timeout });
  await page.waitForTimeout(300);
}

export async function waitForPlay(page, timeout = 90000) {
  await page.waitForFunction(() => window.__game && window.__game.mode === 'play' && !window.__game.loading, null, { timeout, polling: 250 });
}

export async function waitIdle(page, timeout = 60000) {
  const ok = await page.evaluate((t) => window.__game.debug.waitIdle(t), timeout);
  if (!ok) throw new Error('world never became idle');
}

export async function shot(page, name, prefix = 'core') {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${prefix}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  screenshot ${path.relative(ROOT, file)}`);
  return file;
}

/** Start a new world through the real UI (New World -> biome card -> Create!). */
export async function startWorldViaUI(page, biome = 'meadow', { tap = false, onPanel = null } = {}) {
  const press = async (locator) => (tap ? locator.tap() : locator.click());
  await press(page.locator('button.sw-btn', { hasText: 'New World' }).first());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
  const biomeName = await page.evaluate((b) => window.__game.registry.biomes.get(b)?.name, biome);
  if (biomeName) await press(page.locator('.sw-biome', { hasText: biomeName }).first());
  if (onPanel) await onPanel(page);
  await press(page.locator('button.sw-create'));
  await waitForPlay(page);
  await waitIdle(page);
}

/** Start a world, preferring the real UI and falling back to the debug API. */
export async function startWorld(page, biome = 'meadow', opts = {}) {
  try {
    await startWorldViaUI(page, biome, opts);
  } catch (err) {
    console.log(`  (UI start failed: ${err.message.split('\n')[0]}; using debug.newWorld)`);
    await page.evaluate((b) => window.__game.debug.newWorld({ biome: b }), biome);
    await waitForPlay(page);
    await waitIdle(page);
  }
}

/** Wait a few frames so the renderer shows the latest state. */
export async function settle(page, ms = 600) {
  await page.waitForTimeout(ms);
}

export function finish(errors) {
  if (errors.length) {
    console.error(`\nSMOKE FAILED with ${errors.length} problem(s):`);
    for (const e of errors) console.error(' - ' + e);
    process.exitCode = 1;
  } else {
    console.log('\nSMOKE PASSED: no console errors, page errors or failed requests.');
  }
}

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

// ---------------- scenarios ----------------

async function desktopPass(browser, opts, errors) {
  console.log('Desktop pass (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await shot(page, '0-title', opts.prefix);
  await startWorld(page, opts.biome, { onPanel: async (p) => { await settle(p, 400); await shot(p, '0-newworld', opts.prefix); } });
  await settle(page, 800);
  const info = await page.evaluate(() => window.__game.debug.info());
  console.log(`  world ready: ${info.world.name} (${info.world.biome}) fps~${info.fps} calls=${info.calls} tris=${info.triangles} storage=${info.storage}`);
  await shot(page, '1-world', opts.prefix);

  // build a little scene in front of the player: a wall with a tower, a bed, a lamp, a chair
  const built = await page.evaluate(() => {
    const g = window.__game, d = g.debug, p = g.player.position;
    const sy = Math.sin(g.cameraRig.yaw), cy = Math.cos(g.cameraRig.yaw);
    const f = Math.abs(sy) > Math.abs(cy) ? [Math.sign(sy), 0] : [0, Math.sign(cy)]; // forward
    const side = [-f[1], f[0]];
    const px = Math.floor(p.x), pz = Math.floor(p.z);
    const cell = (a, b) => [px + f[0] * a + side[0] * b, pz + f[1] * a + side[1] * b];
    const out = { placed: [], furniture: [] };
    d.select('block:planks_pink');
    for (let i = -2; i <= 2; i++) {
      const [x, z] = cell(6, i);
      const h = d.heightAt(x, z);
      if (d.useAt(x, h, z)) out.placed.push([x, h + 1, z]);
    }
    const [x0, y0, z0] = out.placed[0];
    if (d.place('glass', x0, y0 + 1, z0)) out.placed.push([x0, y0 + 1, z0]);
    if (d.place('lamp_block', x0, y0 + 2, z0)) out.placed.push([x0, y0 + 2, z0]);
    d.select('block:wool_sky');
    const top = out.placed[out.placed.length - 1];
    if (d.useAt(top[0], top[1], top[2])) out.placed.push([top[0], top[1] + 1, top[2]]);
    const putFurniture = (key, a, b) => {
      const [x, z] = cell(a, b);
      d.select(key);
      return d.useAt(x, d.heightAt(x, z), z);
    };
    out.results = {
      bed: putFurniture('furn:bed_single', 3, 3),
      lamp: putFurniture('furn:table_lamp', 3, -3),
      chair: putFurniture('furn:chair', 3, -1),
    };
    out.furniture = d.entities();
    out.keys = out.placed.map(([x, y, z]) => d.getBlock(x, y, z));
    return out;
  });
  check(errors, built.placed.length >= 6, `placed ${built.placed.length} blocks (${[...new Set(built.keys)].join(', ')})`);
  check(errors, built.furniture.length >= 3, `placed ${built.furniture.length} furniture pieces (${built.furniture.map((e) => e.key).join(', ')})`);
  await settle(page, 700);
  await shot(page, '2-built', opts.prefix);

  // undo removes the last thing, redo-by-hand puts it back
  const undo = await page.evaluate(() => {
    const g = window.__game;
    const before = g.debug.entities().length;
    g.undo();
    return { before, after: g.debug.entities().length };
  });
  check(errors, undo.after === undo.before - 1, 'undo removed the last furniture piece');

  // hand tool: sit on nothing, sleep in the bed -> morning
  const bed = built.furniture.find((e) => e.key === 'bed_single');
  if (bed) {
    await page.evaluate((uid) => { window.__game.setDayTime(0.85); window.__game.debug.interact(uid); }, bed.uid);
    await page.waitForTimeout(1200);
    await shot(page, '3-sleep', opts.prefix);
    await page.waitForTimeout(3600);
    const t = await page.evaluate(() => ({ ...window.__game.time, state: window.__game.player.state }));
    check(errors, t.dayTime > 0.25 && t.dayTime < 0.35, `slept until morning (dayTime ${t.dayTime.toFixed(3)}, player ${t.state})`);
  }

  // bag panel
  await page.keyboard.press('b');
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src]', { timeout: 15000 });
  await settle(page, 1500);
  await shot(page, '3-bag', opts.prefix);
  await page.keyboard.press('Escape');

  // save, reload, continue, verify persistence
  const saved = await page.evaluate(() => window.__game.debug.save());
  check(errors, saved && saved.ok, 'world saved');
  const probe = built.placed[0];
  const worldId = await page.evaluate(() => window.__game.world.meta.id);
  await page.reload();
  await waitForTitle(page);
  await page.locator('button.sw-btn', { hasText: 'My Worlds' }).first().click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-world img');
  await settle(page, 400);
  await shot(page, '4-worlds', opts.prefix);
  await page.locator('.sw-world button.sw-btn', { hasText: 'Play' }).first().click();
  await waitForPlay(page);
  await waitIdle(page);
  const after = await page.evaluate(([x, y, z]) => ({
    id: window.__game.world.meta.id,
    key: window.__game.debug.getBlock(x, y, z),
    entities: window.__game.debug.entities().length,
  }), probe);
  check(errors, after.id === worldId, 'Play continued the same world after reload');
  check(errors, after.key === built.keys[0], `placed block persisted after reload (${after.key})`);
  check(errors, after.entities >= 2, `furniture persisted after reload (${after.entities})`);

  // night, looking at what we built so the lamps' glow shows
  await page.evaluate(([x, y, z]) => {
    const g = window.__game, p = g.player.position;
    g.cameraRig.yaw = Math.atan2(x + 0.5 - p.x, z + 0.5 - p.z);
    g.cameraRig.pitch = 0.25;
    g.debug.setTime(0.9);
  }, probe);
  await settle(page, 1200);
  await shot(page, '5-night', opts.prefix);

  // pause menu
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="pause"]');
  await settle(page, 400);
  await shot(page, '6-pause', opts.prefix);
  await page.keyboard.press('Escape');
  await context.close();
}

async function touchPass(browser, opts, errors) {
  console.log('Touch pass (390x844, hasTouch)');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 390, height: 844 }, touch: true, label: 'touch' });
  await shot(page, '7-touch-title', opts.prefix);
  await startWorld(page, opts.biome, { tap: true });
  await settle(page, 800);
  // tap the ground three blocks in front of the player with the Build tool
  const target = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 3), z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 3);
    const v = g.camera.position.clone().set(x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5).project(g.camera);
    const r = g.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  const before = await page.evaluate(() => window.__game.profile.stats.blocksPlaced || 0);
  await page.touchscreen.tap(target.x, target.y);
  await settle(page, 500);
  const afterTap = await page.evaluate(() => window.__game.profile.stats.blocksPlaced || 0);
  check(errors, afterTap > before, 'tap with the Build tool placed a block');
  await shot(page, '8-touch-hud', opts.prefix);
  await context.close();
}

async function main() {
  const opts = parseArgs();
  const errors = [];
  const browser = await launch(opts);
  try {
    if (opts.only !== 'touch') await desktopPass(browser, opts, errors);
    if (opts.only !== 'desktop') await touchPass(browser, opts, errors);
  } catch (err) {
    errors.push('[smoke] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
