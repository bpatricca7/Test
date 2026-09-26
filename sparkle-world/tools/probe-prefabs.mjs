// Magic Houses probe: builds every prefab in a flat world (outside 3/4 view + inside view),
// checks one Undo restores the terrain exactly (hills, water, trees, world edge), and drives
// the real UI: Bag -> Magic Houses -> ghost -> Turn -> build animation -> Undo, on desktop and
// on an iPad-sized touch screen (tap to place, tap the ghost to build).
//
//   node tools/probe-prefabs.mjs [--only=gallery,undo,ui,touch] [--keys=cottage,igloo]
//                                [--prefix=prefabs] [--page=path/to/sparkle-world.html]

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle, settle, finish, screenPoint, SHOTS, PAGE_URL } from './smoke.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const ONLY = args.only ? String(args.only).split(',') : ['gallery', 'undo', 'ui', 'touch'];
const PREFIX = args.prefix || 'prefabs';
const URL = args.page ? pathToFileURL(path.resolve(String(args.page))).href : PAGE_URL;
const KEYS = args.keys ? String(args.keys).split(',') : null;

const errors = [];
function check(cond, msg) {
  if (cond) console.log('  ok: ' + msg);
  else {
    console.log('  FAIL: ' + msg);
    errors.push('[check] ' + msg);
  }
}

async function shot(page, name, { toasts = false } = {}) {
  await mkdir(SHOTS, { recursive: true });
  if (!toasts) await page.evaluate(() => document.querySelectorAll('.sw-toast, .sw-stkpop').forEach((t) => t.remove()));
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('  screenshot ' + path.relative(process.cwd(), file));
}

async function open(browser, { viewport = { width: 1280, height: 800 }, touch = false, label = 'page' } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, label);
  await page.goto(URL);
  await waitForTitle(page);
  return { context, page };
}

async function newWorld(page, biome, size = 'big', seed = 7) {
  await page.evaluate(([b, s, seed]) => window.__game.debug.newWorld({ biome: b, size: s, seed }), [biome, size, seed]);
  await waitForPlay(page);
  await waitIdle(page);
}

/** First-person camera at (x, y, z) looking at (tx, ty, tz); flying so it stays put. */
async function view(page, from, to, time = 0.38) {
  await page.evaluate(([f, t, time]) => {
    const g = window.__game;
    g.setDayTime(time);
    g.player.setFlying(true);
    g.cameraRig.setMode('first');
    g.player.teleport(f[0], f[1] - 1.55, f[2]);
    const dx = t[0] - f[0], dy = t[1] - f[1], dz = t[2] - f[2];
    g.cameraRig.yaw = Math.atan2(dx, dz);
    g.cameraRig.pitch = Math.max(-1.4, Math.min(1.4, -Math.atan2(dy, Math.hypot(dx, dz))));
    g.player.velocity.set(0, 0, 0);
  }, [from, to, time]);
  await page.waitForFunction(() => window.__game.chunks.pending === 0, null, { timeout: 30000 }).catch(() => {});
  await settle(page, 450);
}

/** World position of a prefab-local point for a placement. */
function local(res, plan, lx, ly, lz) {
  const rot = res.placement.rot & 3;
  let dx = lx - plan.ax, dz = lz - plan.az;
  [dx, dz] = rot === 1 ? [dz, -dx] : rot === 2 ? [-dx, -dz] : rot === 3 ? [-dz, dx] : [dx, dz];
  return [res.placement.x + dx + 0.5, res.placement.y + ly, res.placement.z + dz + 0.5];
}

// ---------------- gallery: every prefab in a flat world ----------------

async function gallery(browser) {
  console.log('Gallery: every Magic House in a Builder Flat world');
  const { context, page } = await open(browser, { label: 'gallery' });
  await newWorld(page, 'flat', 'big');
  const keys = await page.evaluate(() => window.__game.prefabs.list());
  const list = KEYS || keys;
  console.log(`  ${keys.length} prefabs: ${keys.join(', ')}`);
  check(keys.length >= 13, `at least 13 prefabs registered (${keys.length})`);
  const items = await page.evaluate(() => window.__game.registry.items.byCategory('houses').map((i) => i.key));
  check(items.length === keys.length, `every prefab has a Bag item in Magic Houses (${items.length})`);

  let i = 0;
  for (const key of list) {
    const col = i % 5, row = Math.floor(i / 5);
    i++;
    const x = 22 + col * 40, z = 22 + row * 44;
    const res = await page.evaluate(([key, x, z]) => {
      const g = window.__game;
      const t0 = performance.now();
      const r = g.prefabs.place(key, x, z, { rot: 0 });
      const ms = performance.now() - t0;
      const p = g.prefabs.plan(key);
      return r && { ...r, ms, plan: { W: p.W, H: p.H, D: p.D, ax: p.ax, az: p.az, maxY: p.maxY, blocks: p.blockCount, view: g.registry.prefabs.get(key).view || null } };
    }, [key, x, z]);
    if (!res) {
      check(false, `${key} placed`);
      continue;
    }
    const f = res.furniture;
    console.log(`  ${key}: ${res.plan.blocks} blocks, ${res.changed} cells changed in ${res.ms.toFixed(0)} ms, furniture ${f.placed}/${f.requested}${f.skipped.length ? ' (skipped ' + [...new Set(f.skipped)].join(' ') + ')' : ''}`);
    const plan = res.plan;
    const b = res.bounds;
    const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2;
    const top = res.placement.y + plan.maxY;
    const span = Math.max(plan.W, plan.D);
    // outside: front three-quarter view
    await view(page, [b.x1 + span * 0.3, top + span * 0.12, b.z1 + span * 0.62], [cx, res.placement.y + plan.maxY * 0.35, cz]);
    await shot(page, `${key}-outside`);
    // inside: the prefab's own photo spots (view: { inside: [x, y, z, lookX, lookY, lookZ], ... })
    const views = plan.view || { inside: [plan.ax, 2.3, plan.D - 3, plan.ax, 1.2, 2] };
    for (const [name, v] of Object.entries(views)) {
      await view(page, local(res, plan, v[0], v[1], v[2]), local(res, plan, v[3], v[4], v[5]), 0.4);
      await shot(page, `${key}-${name}`);
    }
    if (args.night) {
      await view(page, [b.x1 + span * 0.3, top + span * 0.12, b.z1 + span * 0.62], [cx, res.placement.y + plan.maxY * 0.35, cz], 0.9);
      await shot(page, `${key}-night`);
    }
  }
  // the whole town from above
  await view(page, [104, 48, 178], [104, 17, 80], 0.36);
  await shot(page, 'town');
  // Bag tab with thumbnails
  await page.evaluate(() => { const g = window.__game; g.cameraRig.setMode('third'); g.player.setFlying(false); });
  await page.keyboard.press('b');
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab');
  await page.locator('.sw-tab', { hasText: 'Magic Houses' }).click();
  await page.waitForFunction((n) => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item img')].filter((i) => i.src.startsWith('data:')).length >= n, keys.length, { timeout: 30000 }).catch(() => {});
  const pics = await page.evaluate(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item img')].filter((i) => i.src.startsWith('data:image/png') && i.src.length > 2000).length);
  check(pics === keys.length, `every Magic House has a 3D picture in the Bag (${pics}/${keys.length})`);
  await settle(page, 600);
  await shot(page, 'bag');
  await page.keyboard.press('Escape');
  await context.close();
}

// ---------------- undo restores the terrain exactly ----------------

async function undoPass(browser) {
  console.log('Undo: hills, water, trees and the world edge');
  const { context, page } = await open(browser, { label: 'undo' });
  await newWorld(page, 'meadow', 'cozy', 1234);
  const spots = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    // the hilliest spot (max height spread in a 15x15 square), a spot at the pond's edge,
    // the most wooded spot, and the world corner
    let hill = null, hillSpread = -1, water = null, trees = null, treeCount = -1;
    const waterId = g.registry.blocks.idOf('water');
    const isLog = (id) => /^log_/.test(g.registry.blocks.byId(id).key);
    for (let z = 12; z < w.sz - 12; z += 3) {
      for (let x = 12; x < w.sx - 12; x += 3) {
        let lo = 99, hi = -1, logs = 0;
        for (let dz = -7; dz <= 7; dz += 2) for (let dx = -7; dx <= 7; dx += 2) {
          const h = w.heightAt(x + dx, z + dz);
          lo = Math.min(lo, h); hi = Math.max(hi, h);
          for (let y = 1; y <= h; y++) if (isLog(w.get(x + dx, y, z + dz))) logs++;
        }
        if (hi - lo > hillSpread && hi - lo < 14) { hillSpread = hi - lo; hill = [x, z]; }
        if (logs > treeCount) { treeCount = logs; trees = [x, z]; }
        const h = w.heightAt(x, z);
        if (!water && x > 30 && z > 30 && x < w.sx - 30 && z < w.sz - 30 && w.get(x, h + 1, z) !== waterId) {
          for (const [ax, az] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
            const hh = w.heightAt(x + ax, z + az);
            if (w.get(x + ax, hh + 1, z + az) === waterId) { water = [x, z]; break; }
          }
        }
      }
    }
    return { hill, hillSpread, water, trees, treeCount, edge: [2, 2], size: [w.sx, w.sz] };
  });
  console.log(`  hill ${spots.hill} (spread ${spots.hillSpread}), water ${spots.water}, trees ${spots.trees} (${spots.treeCount} log cells)`);
  const cases = [
    ['cottage', spots.hill, 'hill'],
    ['beach_hut', spots.water || spots.hill, 'water'],
    ['princess_castle', spots.trees, 'trees'],
    ['modern_house', spots.edge, 'edge'],
    ['rainbow_bridge', spots.water || spots.hill, 'bridge'],
  ];
  for (const [key, spot, label] of cases) {
    const has = await page.evaluate((k) => !!window.__game.registry.prefabs.get(k), key);
    if (!has || !spot) continue;
    const r = await page.evaluate(([key, x, z]) => {
      const g = window.__game, w = g.world;
      const before = w.blocks.slice();
      const ents = JSON.stringify(g.debug.entities());
      const hist = g.history.length;
      const res = g.prefabs.place(key, x, z, { rot: 1 });
      let changed = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== w.blocks[i]) changed++;
      const b = res.bounds;
      const inside = b.x0 >= 1 && b.z0 >= 1 && b.x1 <= w.sx - 2 && b.z1 <= w.sz - 2;
      const oneEntry = g.history.length === hist + 1;
      const furn = g.debug.entities().length;
      return { changed, inside, oneEntry, furn, bounds: b, placed: res.placement, before: Array.from(before.subarray(0, 0)), hist, ents };
    }, [key, spot[0], spot[1]]);
    check(r.changed > 50 && r.oneEntry, `${key} on ${label}: ${r.changed} cells changed, one history entry`);
    check(r.inside, `${key} on ${label}: footprint stays inside the world (${JSON.stringify(r.bounds)})`);
    if (label === 'hill' || label === 'water' || label === 'trees') {
      const b = r.bounds;
      await view(page, [b.x1 + 16, r.placed.y + 14, b.z1 + 18], [(b.x0 + b.x1) / 2, r.placed.y + 3, (b.z0 + b.z1) / 2]);
      await shot(page, `undo-${label}-built`);
    }
    const u = await page.evaluate(([key, x, z]) => {
      const g = window.__game, w = g.world;
      g.undo();
      return { entities: JSON.stringify(g.debug.entities()), hist: g.history.length };
    }, [key, spot[0], spot[1]]);
    // compare against a fresh snapshot taken before: re-run placement on a copy to diff
    const same = await page.evaluate(([key, x, z]) => {
      const g = window.__game, w = g.world;
      const snap = w.blocks.slice();
      g.prefabs.place(key, x, z, { rot: 1 });
      g.undo();
      let diff = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== w.blocks[i]) diff++;
      return diff;
    }, [key, spot[0], spot[1]]);
    check(u.entities === r.ents && u.hist === r.hist, `${key} on ${label}: undo restored furniture and history`);
    check(same === 0, `${key} on ${label}: undo restored every block exactly (${same} differ)`);
    if (label === 'hill') {
      const b = r.bounds;
      await view(page, [b.x1 + 16, r.placed.y + 14, b.z1 + 18], [(b.x0 + b.x1) / 2, r.placed.y + 3, (b.z0 + b.z1) / 2]);
      await shot(page, `undo-${label}-restored`);
    }
  }
  // exact block-array comparison across a full place + undo of every prefab at one spot
  const all = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const snap = w.blocks.slice();
    const out = [];
    for (const key of g.prefabs.list()) {
      g.prefabs.place(key, 70, 70, { rot: 2 });
      g.undo();
      let d = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== w.blocks[i]) d++;
      out.push([key, d]);
    }
    return out;
  });
  check(all.every(([, d]) => d === 0), `place + undo of every prefab leaves the world byte-identical (${all.map(([k, d]) => k + ':' + d).join(' ')})`);
  // a built house is saved with the world and comes back after a reload
  const saved = await page.evaluate(async () => {
    const g = window.__game, w = g.world;
    const r = g.prefabs.place('candy_house', 60, 60, { rot: 0 });
    const res = await g.debug.save();
    let hash = 0;
    for (let i = 0; i < w.blocks.length; i++) hash = (hash * 31 + w.blocks[i]) | 0;
    return { ok: res && res.ok, id: w.meta.id, hash, ents: g.debug.entities().length, placed: r.furniture.placed };
  });
  await page.reload();
  await waitForTitle(page);
  await page.evaluate((id) => window.__game.debug.loadWorld(id), saved.id);
  await waitForPlay(page);
  await waitIdle(page);
  const back = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    let hash = 0;
    for (let i = 0; i < w.blocks.length; i++) hash = (hash * 31 + w.blocks[i]) | 0;
    return { hash, ents: g.debug.entities().length };
  });
  check(saved.ok && back.hash === saved.hash && back.ents === saved.ents, `a built Candy House survives save + reload (${saved.ents} furniture, blocks identical)`);
  await context.close();
}

// ---------------- the real UI on desktop ----------------

async function uiPass(browser) {
  console.log('UI: Bag -> Magic Houses -> ghost -> Turn -> build -> Undo (mouse)');
  const { context, page } = await open(browser, { label: 'ui' });
  await newWorld(page, 'meadow', 'cozy', 99);
  await page.evaluate(() => {
    const g = window.__game;
    g.setDayTime(0.36);
    g.cameraRig.pitch = 0.5;
  });
  await page.locator('.sw-bagbtn').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab');
  await page.locator('.sw-tab', { hasText: 'Magic Houses' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src^="data:"]', { timeout: 20000 });
  await settle(page, 500);
  await shot(page, 'ui-bag');
  await page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: 'Flower Cottage' }).click();
  await settle(page, 300);
  const vp = page.viewportSize();
  // aim at the ground a little ahead of her
  const aim = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 6), z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 6);
    return [x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5];
  });
  const pt = await screenPoint(page, ...aim);
  await page.mouse.move(pt ? pt.x : vp.width / 2, pt ? pt.y : vp.height * 0.6);
  await settle(page, 500);
  const g1 = await page.evaluate(() => ({ ghost: window.__game.prefabs.ghost, bar: !document.querySelector('.sw-pf-bar').hidden }));
  check(!!g1.ghost && g1.ghost.key === 'cottage', 'hovering the ground shows the cottage ghost');
  check(g1.bar, 'the house bar (Turn / Build!) is showing');
  await shot(page, 'ui-ghost');
  await page.keyboard.press('r');
  await settle(page, 400);
  const g2 = await page.evaluate(() => window.__game.prefabs.ghost);
  check(g2 && g1.ghost && g2.placement.rot !== g1.ghost.placement.rot, `R turns the ghost (${g1.ghost && g1.ghost.placement.rot} -> ${g2 && g2.placement.rot})`);
  await page.locator('.sw-pf-turn').click();
  await settle(page, 300);
  const g3 = await page.evaluate(() => window.__game.prefabs.ghost);
  check(g3 && g3.placement.rot !== g2.placement.rot, 'the Turn button turns it again');
  await shot(page, 'ui-ghost-turned');
  const before = await page.evaluate(() => ({ blocks: window.__game.world.blocks.slice().join(','), hist: window.__game.history.length, ents: window.__game.debug.entities().length }));
  await page.mouse.move(pt ? pt.x : vp.width / 2, pt ? pt.y : vp.height * 0.6);
  await settle(page, 300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__game.prefabs.clock > 0.8, null, { timeout: 5000, polling: 16 }).catch(() => {});
  const mid = await page.evaluate(() => window.__game.prefabs.building);
  check(mid, 'the house is popping in (animation running)');
  await shot(page, 'ui-building');
  await page.waitForFunction(() => !window.__game.prefabs.building, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__game.chunks.pending === 0, null, { timeout: 30000 }).catch(() => {});
  await settle(page, 700);
  const after = await page.evaluate(() => ({ hist: window.__game.history.length, ents: window.__game.debug.entities().length, last: window.__game.prefabs.lastResult }));
  check(after.hist === before.hist + 1, `one history entry for the whole house (${before.hist} -> ${after.hist})`);
  check(after.ents > before.ents, `furniture moved in (${after.ents - before.ents} pieces)`);
  await shot(page, 'ui-built');
  // step back and look at it
  await page.evaluate(() => {
    const g = window.__game, r = g.prefabs.lastResult, b = r.bounds;
    g.cameraRig.yaw = Math.atan2((b.x0 + b.x1) / 2 - g.player.position.x, (b.z0 + b.z1) / 2 - g.player.position.z);
    g.cameraRig.pitch = 0.25;
    g.cameraRig.distance = 9;
  });
  await settle(page, 700);
  await shot(page, 'ui-built-view');
  await page.locator('.sw-undobtn').click();
  await settle(page, 400);
  const undone = await page.evaluate(() => ({ blocks: window.__game.world.blocks.slice().join(','), hist: window.__game.history.length, ents: window.__game.debug.entities().length }));
  check(undone.blocks === before.blocks, 'the Undo button put every block back');
  check(undone.ents === before.ents && undone.hist === before.hist, 'and took the furniture away');
  // how long does starting the magic take for the biggest house (plan + mesh)?
  const startMs = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const t0 = performance.now();
    g.prefabs.place('princess_castle', Math.floor(p.x) + 30, Math.floor(p.z) + 30, { animate: true });
    const ms = performance.now() - t0;
    g.prefabs.finish();
    g.undo();
    return ms;
  });
  console.log(`  starting the castle's magic took ${startMs.toFixed(0)} ms`);
  check(startMs < 400, 'starting the biggest build stays snappy');
  // undo while it is still popping in cancels it
  await page.evaluate(() => { const g = window.__game; g.debug.select('prefab:igloo'); g.setTool('build'); });
  await page.mouse.move(pt ? pt.x + 5 : vp.width / 2, pt ? pt.y : vp.height * 0.6);
  await settle(page, 400);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press('z');
  await page.waitForTimeout(2200);
  const cancelled = await page.evaluate(() => ({ blocks: window.__game.world.blocks.slice().join(','), building: window.__game.prefabs.building, hist: window.__game.history.length }));
  check(cancelled.blocks === before.blocks && !cancelled.building && cancelled.hist === before.hist, 'Undo during the magic cancels the house');
  // the bar hides with another tool / item
  await page.locator('.sw-round', { hasText: 'Hand' }).first().click();
  await settle(page, 200);
  check(await page.evaluate(() => document.querySelector('.sw-pf-bar').hidden && !window.__game.prefabs.ghost), 'ghost and bar hide with the Hand tool');
  await context.close();
}

// ---------------- iPad: tap to place, tap the ghost to build ----------------

async function touchPass(browser) {
  console.log('Touch: iPad 1024x768 - tap a spot, then tap the house');
  const { context, page } = await open(browser, { viewport: { width: 1024, height: 768 }, touch: true, label: 'touch' });
  await newWorld(page, 'flat', 'cozy', 5);
  await page.evaluate(() => { window.__game.setDayTime(0.4); window.__game.cameraRig.pitch = 0.55; });
  await page.locator('.sw-bagbtn').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab');
  await page.locator('.sw-tab', { hasText: 'Magic Houses' }).tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src^="data:"]', { timeout: 20000 });
  await page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: 'Candy' }).first().tap();
  await settle(page, 400);
  await page.waitForFunction(() => !!window.__game.prefabs.ghost, null, { timeout: 5000 }).catch(() => {});
  await settle(page, 300);
  const s0 = await page.evaluate(() => ({ ghost: window.__game.prefabs.ghost, tip: document.querySelector('.sw-pf-tip').textContent }));
  check(!!s0.ghost, `the ghost shows where she is looking before any tap (tip: "${s0.tip}")`);
  // tap a spot beside her (off the ghost): the ghost moves there, nothing is built yet
  const tgt = await page.evaluate(() => {
    const g = window.__game, p = g.player.position, yaw = g.cameraRig.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const x = Math.floor(p.x + fx * 1 + rx * 2), z = Math.floor(p.z + fz * 1 + rz * 2);
    return [x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5];
  });
  const pt = await screenPoint(page, ...tgt);
  const hist0 = await page.evaluate(() => window.__game.history.length);
  await page.touchscreen.tap(pt.x, pt.y);
  await settle(page, 500);
  const s1 = await page.evaluate(() => ({ ghost: window.__game.prefabs.ghost, hist: window.__game.history.length, building: window.__game.prefabs.building, tip: document.querySelector('.sw-pf-tip').textContent }));
  const moved = s1.ghost && s0.ghost && (s1.ghost.placement.x !== s0.ghost.placement.x || s1.ghost.placement.z !== s0.ghost.placement.z);
  check(!!s1.ghost && moved && s1.hist === hist0 && !s1.building, `a tap off the ghost moves it there without building (tip: "${s1.tip}")`);
  await shot(page, 'touch-ghost');
  await page.locator('.sw-pf-turn').tap();
  await settle(page, 300);
  // tap on the ghost house itself
  // a point on the ghost that is on screen and not under a button
  const gpt = await page.evaluate(() => {
    const g = window.__game, gh = g.prefabs.ghost, b = gh.placement.bounds, y0 = gh.placement.y;
    const canvas = g.renderer.domElement, r = canvas.getBoundingClientRect();
    const v = g.camera.position.clone();
    for (let fy = 0.2; fy <= 0.9; fy += 0.1) {
      for (let fx = 0.5, i = 0; i < 9; i++, fx = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.1) {
        for (let fz = 0.1; fz <= 0.9; fz += 0.2) {
          v.set(b.x0 + (b.x1 - b.x0 + 1) * fx, y0 + 1 + fy * 4, b.z0 + (b.z1 - b.z0 + 1) * fz).project(g.camera);
          if (v.z > 1 || Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9) continue;
          const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
          if (document.elementFromPoint(x, y) === canvas) return { x, y };
        }
      }
    }
    return null;
  });
  await page.touchscreen.tap(gpt.x, gpt.y);
  const s2 = await page.evaluate(() => window.__game.prefabs.building);
  await page.waitForFunction(() => window.__game.prefabs.clock > 0.8, null, { timeout: 5000, polling: 16 }).catch(() => {});
  await shot(page, 'touch-building');
  check(s2, 'tapping the ghost builds the house');
  await page.waitForFunction(() => !window.__game.prefabs.building, null, { timeout: 8000 }).catch(() => {});
  await settle(page, 1200);
  await shot(page, 'touch-built');
  // Build! button path
  await page.evaluate(() => { window.__game.debug.select('prefab:bakery'); window.__game.cameraRig.yaw += Math.PI; window.__game.input.pointer = null; });
  await page.waitForFunction(() => !!window.__game.prefabs.ghost, null, { timeout: 5000 }).catch(() => {});
  await settle(page, 400);
  await page.evaluate(() => { window.__game.prefabs.lastResult = null; });
  await page.locator('.sw-pf-go').tap();
  await page.waitForTimeout(300);
  const s3 = await page.evaluate(() => window.__game.prefabs.building || !!window.__game.prefabs.lastResult);
  check(s3, 'the Build! button builds where the ghost is');
  await page.waitForFunction(() => !window.__game.prefabs.building, null, { timeout: 8000 }).catch(() => {});
  await context.close();
  // phone and portrait iPad: the house bar must not cover any HUD control
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['ipad-portrait', { width: 768, height: 1024 }]]) {
    const dev = await open(browser, { viewport, touch: true, label });
    await newWorld(dev.page, 'flat', 'cozy', 5);
    await dev.page.evaluate(() => { window.__game.debug.select('prefab:princess_castle'); window.__game.cameraRig.pitch = 0.6; });
    await settle(dev.page, 900);
    const res = await dev.page.evaluate(() => {
      const bar = document.querySelector('.sw-pf-bar').getBoundingClientRect();
      const hit = [];
      for (const sel of ['.sw-hotbar', '.sw-joy', '.sw-touch', '.sw-hud-tl', '.sw-hud-tr', '.sw-hud-right', '.sw-bagbtn', '.sw-undobtn']) {
        for (const el of document.querySelectorAll(sel)) {
          if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (!(bar.bottom <= r.top || bar.top >= r.bottom || bar.right <= r.left || bar.left >= r.right)) hit.push(sel);
        }
      }
      return { hit, inside: bar.left >= 0 && bar.right <= innerWidth && bar.height > 0 };
    });
    check(res.hit.length === 0 && res.inside, `${label}: the house bar is on screen and covers no HUD control${res.hit.length ? ' (' + res.hit.join(' ') + ')' : ''}`);
    await shot(dev.page, `${label}-bar`);
    await dev.context.close();
  }
}

async function main() {
  const browser = await launch({ headed: !!args.headed });
  try {
    if (ONLY.includes('gallery')) await gallery(browser);
    if (ONLY.includes('undo')) await undoPass(browser);
    if (ONLY.includes('ui')) await uiPass(browser);
    if (ONLY.includes('touch')) await touchPass(browser);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
