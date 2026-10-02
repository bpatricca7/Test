// Wave 2 Magic Builds probe (team "builds"): treehouses, campers and the campground.
//
//   node tools/probe-builds.mjs [--only=gallery,hills,play,ui,touch] [--keys=sparkle_camper,campground]
//                               [--prefix=builds] [--night] [--page=path/to/sparkle-world.html]
//
// gallery  every new build in a Builder Flat world: furniture placed, doors walkable, outside
//          3/4 view + every photo spot (inside each room), the Bag pictures, a draw-call budget
// hills    every new build on the hilliest spots of a meadow: one Undo entry, stays inside the
//          world, Undo restores every block (whole array) and the furniture; built pictures
// play     the big slide (Hand tap -> ride -> splash into the pool), the telescope, the zip
//          line towers linking up and the rope bridge (when the outdoor pieces exist)
// ui       real clicks: Bag -> Magic Houses -> Sparkle Camper -> ghost -> click -> magic ->
//          Undo button; the Hand tool on the big slide by mouse
// touch    iPad 1024x768: Bag -> Campground by taps, tap a spot, tap the ghost, it builds;
//          tap the slide of a Big Friendship Treehouse and ride it

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle, settle, finish, screenPoint, SHOTS, PAGE_URL } from './smoke.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const ONLY = args.only ? String(args.only).split(',') : ['gallery', 'hills', 'play', 'ui', 'touch'];
const PREFIX = args.prefix || 'builds';
const URL = args.page ? pathToFileURL(path.resolve(String(args.page))).href : PAGE_URL;
export const NEW_KEYS = ['sparkle_camper', 'retro_trailer', 'camper_van', 'campground', 'friendship_treehouse', 'fairy_treehouse', 'lookout_treehouse'];
const KEYS = args.keys ? String(args.keys).split(',') : NEW_KEYS;

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
  // no tutorial cards or first-play gifts over the pictures
  await page.evaluate(() => { const g = window.__game; if (g.ui && g.ui.current) g.ui.closeAll && g.ui.closeAll(); });
}

/** Wait until every chunk is meshed (and the frame after). */
async function meshed(page, timeout = 30000) {
  await page.waitForFunction(() => window.__game.chunks.pending === 0, null, { timeout, polling: 100 }).catch(() => {});
}

/** First-person camera at (x, y, z) looking at (tx, ty, tz); flying so it stays put. */
async function view(page, from, to, time = 0.38) {
  await page.evaluate(([f, t, time]) => {
    const g = window.__game;
    g.setDayTime(time);
    if (g.player.state === 'sit' || g.player.state === 'sleep') g.player.stand();
    g.player.setFlying(true);
    g.cameraRig.setMode('first');
    g.player.teleport(f[0], f[1] - 1.55, f[2]);
    const dx = t[0] - f[0], dy = t[1] - f[1], dz = t[2] - f[2];
    g.cameraRig.yaw = Math.atan2(dx, dz);
    g.cameraRig.pitch = Math.max(-1.4, Math.min(1.4, -Math.atan2(dy, Math.hypot(dx, dz))));
    g.player.velocity.set(0, 0, 0);
  }, [from, to, time]);
  await meshed(page);
  await settle(page, 450);
}

/** Back to a normal third-person walking camera. */
async function walkMode(page) {
  await page.evaluate(() => { const g = window.__game; g.cameraRig.setMode('third'); g.player.setFlying(false); });
}

/** World position of a prefab-local point for a placement. */
function local(res, plan, lx, ly, lz) {
  const rot = res.placement.rot & 3;
  let dx = lx - plan.ax, dz = lz - plan.az;
  [dx, dz] = rot === 1 ? [dz, -dx] : rot === 2 ? [-dx, -dz] : rot === 3 ? [-dz, dx] : [dx, dz];
  return [res.placement.x + dx + 0.5, res.placement.y + ly, res.placement.z + dz + 0.5];
}

/** Place a build with the debug API and gather what the probe needs to know about it. */
async function placeBuild(page, key, x, z, rot = 0) {
  return page.evaluate(([key, x, z, rot]) => {
    const g = window.__game;
    const before = new Set(g.entities.all().map((e) => e.uid));
    const t0 = performance.now();
    const r = g.prefabs.place(key, x, z, { rot });
    const ms = performance.now() - t0;
    const p = g.prefabs.plan(key);
    if (!r) return null;
    const E = g.entities, w = g.world, ph = g.physics;
    const mine = E.all().filter((e) => !before.has(e.uid));
    // every door and gate can be walked through (open): she fits in front of it and behind it
    const blockedDoors = [];
    for (const d of mine.filter((e) => e.key.startsWith('door') || e.key === 'gate')) {
      const wasOpen = !!(d.data && d.data.open);
      if (!wasOpen) E.setData(d, { open: true });
      const f = d.frontCell();
      const cellFree = (cx, cz) => [0, 1, -1].some((dy) => !ph.bodyBlocked(cx + 0.5, d.y + dy + 0.02, cz + 0.5, 0.3, 1.7));
      const bx = 2 * d.x - f[0], bz = 2 * d.z - f[2];
      if (!cellFree(f[0], f[2]) || !cellFree(bx, bz)) blockedDoors.push(`${d.key}@${d.x},${d.y},${d.z}`);
      if (!wasOpen) E.setData(d, { open: false });
    }
    const keys = {};
    for (const e of mine) keys[e.key] = (keys[e.key] || 0) + 1;
    return {
      ...r, ms, blockedDoors, keys,
      slides: mine.filter((e) => e.key.startsWith('big_slide')).map((e) => e.uid),
      scopes: mine.filter((e) => e.key === 'lookout_telescope').map((e) => e.uid),
      towers: mine.filter((e) => e.key === 'zipline_tower').map((e) => e.uid),
      bridges: mine.filter((e) => e.key === 'rope_bridge').map((e) => ({ uid: e.uid, b: e.data.b, i: e.data.i, n: e.data.n })),
      plan: { W: p.W, H: p.H, D: p.D, ax: p.ax, az: p.az, maxY: p.maxY, blocks: p.blockCount, view: g.registry.prefabs.get(key).view || null },
    };
  }, [key, x, z, rot]);
}

// ---------------- gallery: every new build in a flat world ----------------

async function gallery(browser) {
  console.log('Gallery: every wave 2 build in a Builder Flat world');
  const { context, page } = await open(browser, { label: 'gallery' });
  await newWorld(page, 'flat', 'big');
  const keys = await page.evaluate(() => window.__game.prefabs.list());
  for (const k of NEW_KEYS) check(keys.includes(k), `${k} is registered`);
  const items = await page.evaluate(() => window.__game.registry.items.byCategory('houses').map((i) => i.key));
  for (const k of NEW_KEYS) check(items.includes('prefab:' + k), `${k} has a Bag item in Magic Houses`);
  const hidden = await page.evaluate(() => ['furn:big_slide', 'furn:big_slide_tall', 'furn:lookout_telescope'].map((k) => { const it = window.__game.registry.items.get(k); return !!it && !!it.hidden; }));
  check(hidden.every(Boolean), 'the builds-only pieces (big slides, telescope) exist and stay out of the Bag');

  const spots = [[30, 30], [80, 30], [130, 30], [180, 30], [30, 100], [90, 100], [150, 110], [60, 170], [140, 170]];
  let i = 0;
  for (const key of KEYS) {
    const [x, z] = spots[i++ % spots.length];
    const res = await placeBuild(page, key, x, z, 0);
    if (!res) {
      check(false, `${key} placed`);
      continue;
    }
    const f = res.furniture;
    console.log(`  ${key}: ${res.plan.blocks} blocks (${res.plan.W}x${res.plan.H}x${res.plan.D}), ${res.changed} cells in ${res.ms.toFixed(0)} ms, furniture ${f.placed}/${f.requested}${f.skipped.length ? ' (skipped ' + [...new Set(f.skipped)].join(' ') + ')' : ''}`);
    console.log(`    pieces: ${Object.entries(res.keys).map(([k, n]) => (n > 1 ? `${k}x${n}` : k)).join(' ')}`);
    check(f.placed === f.requested, `${key}: every furniture piece found its spot (${f.placed}/${f.requested})`);
    check(!res.blockedDoors.length, `${key}: every door can be walked through${res.blockedDoors.length ? ' (' + res.blockedDoors.join('; ') + ')' : ''}`);
    const plan = res.plan;
    const b = res.bounds;
    const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2;
    const top = res.placement.y + plan.maxY;
    const span = Math.max(plan.W, plan.D);
    await view(page, [b.x1 + span * 0.3, top + span * 0.1, b.z1 + span * 0.62], [cx, res.placement.y + plan.maxY * 0.3, cz]);
    await shot(page, `${key}-outside`);
    for (const [name, v] of Object.entries(plan.view || {})) {
      await view(page, local(res, plan, v[0], v[1], v[2]), local(res, plan, v[3], v[4], v[5]), 0.4);
      await shot(page, `${key}-${name}`);
    }
    if (args.night) {
      await view(page, [b.x1 + span * 0.3, top + span * 0.1, b.z1 + span * 0.62], [cx, res.placement.y + plan.maxY * 0.3, cz], 0.9);
      await shot(page, `${key}-night`);
    }
  }
  if (!args.keys) {
    // the whole camp town from above, and its draw-call budget
    await view(page, [104, 62, 215], [104, 17, 95], 0.36);
    await shot(page, 'town');
    const dc = await page.evaluate(() => {
      const g = window.__game, r = g.renderer;
      const kids = g.scene.children, vis = kids.map((c) => c.visible);
      const calls = (only) => {
        kids.forEach((c) => { c.visible = !only || c === only; });
        r.render(g.scene, g.camera);
        return r.info.render.calls;
      };
      const furniture = calls(g.entities.group), all = calls(null);
      kids.forEach((c, i) => { c.visible = vis[i]; });
      return { furniture, all, pieces: g.entities.all().length, batches: g.entities.batcher ? g.entities.batcher.info() : null };
    });
    console.log(`  town: ${dc.pieces} pieces, furniture ${dc.furniture} draw calls, frame ${dc.all} (batches ${JSON.stringify(dc.batches)})`);
    check(dc.furniture <= Math.max(120, dc.pieces * 0.65), `camp town furniture stays within the draw-call budget (${dc.furniture} calls for ${dc.pieces} pieces)`);
    // Bag tab with every picture
    await walkMode(page);
    await page.keyboard.press('b');
    await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
    await page.locator('.sw-tab2', { hasText: 'Magic Houses' }).click();
    const names = await page.evaluate((keys) => keys.map((k) => window.__game.registry.items.get('prefab:' + k).name), NEW_KEYS);
    await page.waitForFunction((names) => names.every((n) => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item')].some((el) => el.textContent.includes(n) && el.querySelector('img') && el.querySelector('img').src.startsWith('data:image/png'))), names, { timeout: 60000, polling: 250 }).catch(() => {});
    const pics = await page.evaluate((names) => names.map((n) => {
      const el = [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item')].find((e) => e.textContent.includes(n));
      const img = el && el.querySelector('img');
      return !!img && img.src.startsWith('data:image/png') && img.src.length > 2000;
    }), names);
    check(pics.every(Boolean), `every new build has a 3D picture in the Bag (${pics.filter(Boolean).length}/${names.length})`);
    const last = page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: names[names.length - 1] });
    await last.scrollIntoViewIfNeeded().catch(() => {});
    await settle(page, 600);
    await shot(page, 'bag');
    await page.keyboard.press('Escape');
  }
  await context.close();
}

// ---------------- hills: undo restores the terrain exactly ----------------

async function hills(browser) {
  console.log('Hills: every new build on bumpy ground, one Undo, exact restore');
  const { context, page } = await open(browser, { label: 'hills' });
  await newWorld(page, 'meadow', 'big', 4321);
  const spots = await page.evaluate((n) => {
    const g = window.__game, w = g.world;
    const out = [];
    const cands = [];
    for (let z = 24; z < w.sz - 24; z += 4) {
      for (let x = 24; x < w.sx - 24; x += 4) {
        let lo = 99, hi = -1;
        for (let dz = -10; dz <= 10; dz += 2) for (let dx = -10; dx <= 10; dx += 2) {
          const h = w.heightAt(x + dx, z + dz);
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        cands.push([hi - lo, x, z]);
      }
    }
    cands.sort((a, b) => b[0] - a[0]);
    for (const [s, x, z] of cands) {
      if (s >= 16) continue;
      if (out.every(([, ox, oz]) => Math.hypot(ox - x, oz - z) > 30)) out.push([s, x, z]);
      if (out.length >= n) break;
    }
    return out;
  }, KEYS.length);
  let i = 0;
  for (const key of KEYS) {
    const [spread, x, z] = spots[i % spots.length];
    const rot = i % 4;
    i++;
    const r = await page.evaluate(([key, x, z, rot]) => {
      const g = window.__game, w = g.world;
      const before = w.blocks.slice();
      const ents = JSON.stringify(g.debug.entities());
      const hist = g.history.length;
      const res = g.prefabs.place(key, x, z, { rot });
      if (!res) return null;
      let changed = 0;
      for (let i = 0; i < before.length; i++) if (before[i] !== w.blocks[i]) changed++;
      const b = res.bounds;
      return {
        changed, hist, ents, bounds: b, placed: res.placement, furniture: res.furniture,
        inside: b.x0 >= 1 && b.z0 >= 1 && b.x1 <= w.sx - 2 && b.z1 <= w.sz - 2,
        oneEntry: g.history.length === hist + 1,
      };
    }, [key, x, z, rot]);
    if (!r) {
      check(false, `${key} placed on the hill`);
      continue;
    }
    check(r.changed > 50 && r.oneEntry, `${key} on a hill (spread ${spread}, turn ${rot}): ${r.changed} cells changed, one history entry`);
    check(r.inside, `${key}: footprint stays inside the world`);
    check(r.furniture.placed === r.furniture.requested, `${key} on the hill: all furniture placed (${r.furniture.placed}/${r.furniture.requested})`);
    const b = r.bounds;
    const span = Math.max(b.x1 - b.x0, b.z1 - b.z0) + 1;
    await view(page, [b.x1 + span * 0.45, r.placed.y + span * 0.5, b.z1 + span * 0.55], [(b.x0 + b.x1) / 2, r.placed.y + 3, (b.z0 + b.z1) / 2]);
    await shot(page, `hill-${key}`);
    const u = await page.evaluate(([key, x, z, rot]) => {
      const g = window.__game, w = g.world;
      g.undo();
      const ents = JSON.stringify(g.debug.entities());
      const hist = g.history.length;
      // place + undo again and compare the whole block array
      const snap = w.blocks.slice();
      g.prefabs.place(key, x, z, { rot });
      g.undo();
      let diff = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== w.blocks[i]) diff++;
      return { ents, hist, diff };
    }, [key, x, z, rot]);
    check(u.ents === r.ents && u.hist === r.hist, `${key}: Undo took away all its furniture and its history entry`);
    check(u.diff === 0, `${key}: Undo restored every block exactly (${u.diff} differ)`);
  }
  // one more: a build and an Undo leave the first spot's terrain byte-identical
  const all = await page.evaluate((keys) => {
    const g = window.__game, w = g.world;
    const snap = w.blocks.slice();
    const out = [];
    for (const key of keys) {
      g.prefabs.place(key, 100, 100, { rot: 3 });
      g.undo();
      let d = 0;
      for (let i = 0; i < snap.length; i++) if (snap[i] !== w.blocks[i]) d++;
      out.push([key, d]);
    }
    return out;
  }, KEYS);
  check(all.every(([, d]) => d === 0), `place + Undo of every new build at one spot leaves the world byte-identical (${all.map(([k, d]) => k + ':' + d).join(' ')})`);
  // a built camper survives save + reload
  const saved = await page.evaluate(async () => {
    const g = window.__game, w = g.world;
    const r = g.prefabs.place('sparkle_camper', 60, 60, { rot: 0 });
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
    return { hash, ents: g.debug.entities().length, slides: g.entities.all().filter((e) => e.key.startsWith('big_slide')).length };
  });
  check(saved.ok && back.hash === saved.hash && back.ents === saved.ents && back.slides === 1, `a built Sparkle Camper survives save + reload (${saved.ents} pieces, slide ${back.slides}, blocks identical)`);
  await context.close();
}

// ---------------- play: slides, telescope, zip line, rope bridge ----------------

async function rideSlide(page, uid, label) {
  // wait for the ride to start and finish. The ride runs on game time (about 2 s), and a
  // SwiftShader frame here can take a quarter of a second (dt is clamped to 0.05 s), so a
  // ride takes 10-15 s of real time: wait on the game state, generously
  const start = await page.evaluate(() => performance.now());
  await page.waitForFunction((uid) => { const p = window.__game.player; return p.state === 'sit' && p.seatEntity && p.seatEntity.uid === uid; }, uid, { timeout: 8000, polling: 50 }).catch(() => {});
  const riding = await page.evaluate((uid) => { const p = window.__game.player; return p.state === 'sit' && !!p.seatEntity && p.seatEntity.uid === uid; }, uid);
  await page.waitForFunction(() => { const e = window.__game.player.seatEntity; return !e || (e.anim && e.anim.t > 0.45); }, null, { timeout: 30000, polling: 30 }).catch(() => {});
  await shot(page, `${label}-mid`);
  await page.waitForFunction(() => window.__game.player.state !== 'sit', null, { timeout: 40000, polling: 50 }).catch(() => {});
  const end = await page.evaluate(([uid, t0]) => {
    const g = window.__game, p = g.player, e = g.entities.byUid(uid);
    const far = g.entities.localToWorld(e, 0.5, 0, e.def.size[2]);
    return { state: p.state, swimming: p.swimming, dist: Math.hypot(p.position.x - far.x, p.position.z - far.z), y: p.position.y, baseY: e.y, secs: (performance.now() - t0) / 1000 };
  }, [uid, start]);
  return { riding, ...end };
}

async function play(browser) {
  console.log('Play: big slides, the telescope, zip lines, rope bridges');
  const { context, page } = await open(browser, { label: 'play' });
  await newWorld(page, 'flat', 'big', 11);
  const camper = await placeBuild(page, 'sparkle_camper', 60, 60, 0);
  check(camper && camper.slides.length === 1, 'the Sparkle Camper has its big slide');
  // Hand tool on the slide from the roof deck: she sits at the top and whooshes into the pool
  await walkMode(page);
  const deck = local(camper, camper.plan, 16.5, 7.05, 7.5);
  await page.evaluate(([x, y, z]) => { const g = window.__game; g.setDayTime(0.4); g.player.teleport(x, y, z); g.setTool('hand'); g.cameraRig.yaw = Math.PI / 2; g.cameraRig.pitch = 0.35; }, deck);
  await meshed(page);
  await settle(page, 400);
  await page.evaluate((uid) => window.__game.debug.interact(uid), camper.slides[0]);
  const ride = await rideSlide(page, camper.slides[0], 'slide-camper');
  check(ride.riding, 'Hand on the big slide: she sits at the top');
  check(ride.state !== 'sit' && ride.dist < 3, `she whooshes to the bottom (${ride.dist.toFixed(2)} from the end, ${ride.secs.toFixed(1)} s)`);
  await settle(page, 500);
  const wet = await page.evaluate(() => window.__game.player.swimming || window.__game.physics.liquidAt(window.__game.player.position.x, window.__game.player.position.y + 0.3, window.__game.player.position.z));
  check(wet, 'the camper slide ends with a splash in the pool');
  await shot(page, 'slide-camper-splash');
  // standing still on the top lip starts the ride too
  const lip = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    const p = g.entities.localToWorld(e, 0.5, e.def.size[1] + 0.02, 0.35);
    g.player.teleport(p.x, p.y, p.z);
    return [p.x, p.y, p.z];
  }, camper.slides[0]);
  const lipRide = await page.waitForFunction((uid) => { const p = window.__game.player; return p.state === 'sit' && p.seatEntity && p.seatEntity.uid === uid; }, camper.slides[0], { timeout: 15000, polling: 50 }).then(() => true, () => false);
  check(lipRide, `standing still on the slide's top lip starts a ride (${lip.map((v) => v.toFixed(1)).join(', ')})`);
  await page.waitForFunction(() => window.__game.player.state !== 'sit', null, { timeout: 40000, polling: 50 }).catch(() => {});

  // the treehouse slide from the porch down to the meadow, from far away (she hops up)
  const tree = await placeBuild(page, 'friendship_treehouse', 120, 60, 0);
  check(tree && tree.slides.length === 1, 'the Big Friendship Treehouse has its big slide');
  await page.evaluate(([x, y, z]) => { const g = window.__game; g.player.teleport(x, y, z); }, local(tree, tree.plan, 18, 1.05, 21));
  await settle(page, 300);
  await page.evaluate((uid) => window.__game.debug.interact(uid), tree.slides[0]);
  const ride2 = await rideSlide(page, tree.slides[0], 'slide-tree');
  check(ride2.riding && ride2.state !== 'sit' && ride2.dist < 3 && Math.abs(ride2.y - ride2.baseY) < 1.2, `tapping the treehouse slide from the ground: a hop up and a ride down to the meadow (ends ${ride2.dist.toFixed(2)} from its foot)`);
  // bridge between the porches
  const bridge = tree.bridges;
  const outdoor = await page.evaluate(() => !!window.__game.registry.furniture.get('rope_bridge'));
  if (outdoor) {
    check(bridge.length === 5 && new Set(bridge.map((b) => b.b)).size === 1 && bridge.every((b) => b.n === 5), `the rope bridge is one bridge of 5 segments (${bridge.length})`);
    const tree2 = await placeBuild(page, 'friendship_treehouse', 120, 120, 1);
    const ids = new Set([...bridge.map((b) => b.b), ...tree2.bridges.map((b) => b.b)]);
    check(ids.size === 2, `two treehouses get two different bridge ids (${[...ids].join(' | ')})`);
    await page.evaluate(() => window.__game.undo());
  } else {
    console.log('  (no rope_bridge piece in this build: the plank bridge stands in)');
  }
  // the camper van's ladder takes her up to the roof tent, where she can tuck into its bed
  const van = await placeBuild(page, 'camper_van', 60, 100, 0);
  const inVan = `(e) => e.x >= ${van.bounds.x0} && e.x <= ${van.bounds.x1} && e.z >= ${van.bounds.z0} && e.z <= ${van.bounds.z1}`;
  const vanUp = await page.evaluate(([x, y, z, inVan]) => {
    const g = window.__game, inside = eval(inVan);
    const ladders = g.entities.all().filter((e) => e.key === 'ladder' && inside(e)).sort((a, b) => a.y - b.y);
    if (!ladders.length) return { ok: false, why: 'no ladder' };
    g.player.teleport(x, y, z);
    return { ok: true, base: ladders[0].y, uid: ladders[0].uid };
  }, [...local(van, van.plan, 0.5, 1.05, 7.5), inVan]);
  if (vanUp.ok) {
    await page.evaluate((uid) => window.__game.debug.interact(uid), vanUp.uid);
    const up = await page.waitForFunction((base) => window.__game.player.position.y >= base + 3.9, vanUp.base, { timeout: 30000, polling: 100 }).then(() => true, () => false);
    await settle(page, 1500);
    const bed = await page.evaluate((inVan) => {
      const g = window.__game, p = g.player.position, inside = eval(inVan);
      const b = g.entities.all().filter((e) => e.key.startsWith('bed_') && inside(e))[0];
      return { uid: b.uid, y: b.y, py: p.y, dist: Math.hypot(b.x + 0.5 - p.x, b.z + 0.5 - p.z) };
    }, inVan);
    check(up && bed.y > vanUp.base + 3 && bed.dist < 4.5, `the van ladder climbs up beside the roof tent bed (she is at ${bed.py.toFixed(1)}, the bed ${bed.dist.toFixed(1)} away)`);
    await page.evaluate((uid) => window.__game.debug.interact(uid), bed.uid);
    const slept = await page.waitForFunction((uid) => { const p = window.__game.player; return p.state === 'sleep' && p.seatEntity && p.seatEntity.uid === uid; }, bed.uid, { timeout: 15000, polling: 100 }).then(() => true, () => false);
    check(slept, 'she can snuggle into the roof tent bed');
    await page.evaluate(() => { const p = window.__game.player; if (p.state === 'sleep') p.stand(); });
  } else check(false, `the camper van has a ladder (${vanUp.why})`);

  // telescope + zip line on the lookout
  const look = await placeBuild(page, 'lookout_treehouse', 60, 130, 0);
  check(look && look.scopes.length === 2, 'the Lookout Treehouse has its telescopes');
  const deck2 = local(look, look.plan, 3.5, 12.05, 9.5);
  await page.evaluate(([x, y, z]) => window.__game.player.teleport(x, y, z), deck2);
  await settle(page, 300);
  const toastsBefore = await page.evaluate(() => document.querySelectorAll('.sw-toast').length);
  const used = await page.evaluate((uid) => window.__game.debug.interact(uid), look.scopes[0]);
  await page.waitForFunction(() => [...document.querySelectorAll('.sw-toast')].some((t) => /spy|see|stars|moon|clouds/i.test(t.textContent)), null, { timeout: 5000, polling: 100 }).catch(() => {});
  const toast = await page.evaluate(() => [...document.querySelectorAll('.sw-toast')].map((t) => t.textContent).join(' / '));
  check(used !== false && /spy|see|stars|moon|clouds/i.test(toast), `the telescope: "${toast}" (${toastsBefore} toasts before)`);
  await view(page, local(look, look.plan, 5, 14, 12.5), local(look, look.plan, 2.5, 12.8, 10.5), 0.4);
  await shot(page, 'telescope', { toasts: true });
  const zipOk = await page.evaluate(() => !!window.__game.registry.furniture.get('zipline_tower'));
  if (zipOk) {
    check(look.towers.length === 2, 'the Lookout Treehouse has two zip towers');
    const links = await page.evaluate(() => (window.__game.debug.outdoor ? window.__game.debug.outdoor.links() : []));
    const pair = links.find((l) => look.towers.includes(l.a) && look.towers.includes(l.b));
    check(!!pair, `its two towers are linked by a zip line (${pair ? pair.len.toFixed(1) + ' long' : JSON.stringify(links)})`);
    const hts = await page.evaluate((uids) => uids.map((u) => window.__game.entities.byUid(u).y), look.towers);
    check(Math.abs(hts[0] - hts[1]) >= 8, `the zip line runs downhill from the deck (tower bases ${hts.join(' and ')})`);
    await view(page, local(look, look.plan, 26, 16, 16), local(look, look.plan, 20, 11, 5), 0.4);
    await shot(page, 'zipline');
    // ride it from the treehouse deck: she climbs the tower, grabs the handle and zips down
    if (pair) {
      await walkMode(page);
      const top = await page.evaluate((uids) => {
        const g = window.__game, [a, b] = uids.map((u) => g.entities.byUid(u));
        const start = a.y > b.y ? a : b, end = start === a ? b : a;
        const p = g.entities.localToWorld(start, 1, 0.05, 3.2);
        g.player.teleport(p.x, p.y, p.z);
        return { start: start.uid, end: end.uid };
      }, look.towers);
      let rideEvent = null;
      await page.evaluate(() => { window.__zipDone = null; window.__game.events.on('zipline:ride', (e) => { window.__zipDone = { from: e.from && e.from.uid, to: e.to && e.to.uid }; }); });
      await page.evaluate((uid) => window.__game.debug.interact(uid), top.start);
      await page.waitForFunction(() => { const r = window.__game.debug.outdoor.ride(); return r && r.s > r.len * 0.4; }, null, { timeout: 60000, polling: 50 }).catch(() => {});
      await shot(page, 'zipline-ride');
      await page.waitForFunction(() => !window.__game.debug.outdoor.ride(), null, { timeout: 90000, polling: 100 }).catch(() => {});
      rideEvent = await page.evaluate(() => window.__zipDone);
      const where = await page.evaluate((uid) => {
        const g = window.__game, e = g.entities.byUid(uid), c = g.entities.localToWorld(e, 1, 0, 1);
        return Math.hypot(g.player.position.x - c.x, g.player.position.z - c.z);
      }, top.end);
      check(!!rideEvent && rideEvent.from === top.start && where < 3, `a zip ride from the treehouse deck lands at the meadow tower (${JSON.stringify(rideEvent)}, ${where.toFixed(1)} from it)`);
      await shot(page, 'zipline-landed');
    }
    // undo takes both towers (and the cable) away
    await page.evaluate(() => window.__game.undo());
    const left = await page.evaluate(() => (window.__game.debug.outdoor ? window.__game.debug.outdoor.links().length : 0));
    check(left === 0, 'Undo takes the zip line away with the treehouse');
  } else {
    console.log('  (no zipline_tower piece in this build: the lookout keeps a bench there)');
  }
  await context.close();
}

// ---------------- the real UI with a mouse ----------------

async function uiPass(browser) {
  console.log('UI: Bag -> Magic Houses -> Sparkle Camper -> click -> Undo (mouse)');
  const { context, page } = await open(browser, { label: 'ui' });
  await newWorld(page, 'meadow', 'big', 99);
  await page.evaluate(() => { const g = window.__game; g.setDayTime(0.36); g.cameraRig.pitch = 0.5; });
  await page.locator('.sw-bagbtn').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await page.locator('.sw-tab2', { hasText: 'Magic Houses' }).click();
  const card = page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: 'Sparkle Camper' });
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const el = [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item')].find((e) => e.textContent.includes('Sparkle Camper')); return el && el.querySelector('img') && el.querySelector('img').src.startsWith('data:'); }, null, { timeout: 30000 }).catch(() => {});
  await settle(page, 400);
  await shot(page, 'ui-bag');
  await card.click();
  await settle(page, 300);
  const vp = page.viewportSize();
  const aim = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 6), z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 6);
    return [x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5];
  });
  const pt = await screenPoint(page, ...aim);
  await page.mouse.move(pt ? pt.x : vp.width / 2, pt ? pt.y : vp.height * 0.6);
  await page.waitForFunction(() => { const gh = window.__game.prefabs.ghost; return gh && gh.key === 'sparkle_camper'; }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  const g1 = await page.evaluate(() => ({ ghost: window.__game.prefabs.ghost, name: document.querySelector('.sw-pf-name') && document.querySelector('.sw-pf-name').textContent }));
  check(!!g1.ghost && g1.ghost.key === 'sparkle_camper' && g1.name === 'Sparkle Camper', `hovering the ground shows the Sparkle Camper ghost and its bar ("${g1.name}")`);
  await shot(page, 'ui-ghost');
  const before = await page.evaluate(() => ({ blocks: window.__game.world.blocks.slice().join(','), hist: window.__game.history.length, ents: window.__game.debug.entities().length }));
  // the magic runs on real time (about 1.6 s): one long software-drawn frame can carry it from
  // start to end, so the probe holds its clock half way (the game's test hook) to look at it
  await page.evaluate(() => { window.__game.prefabs.holdClock = 1.0; });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__game.prefabs.building, null, { timeout: 15000, polling: 50 }).catch(() => {});
  const building = await page.evaluate(() => window.__game.prefabs.building);
  check(building, 'a click starts the magic (the camper pops in)');
  await shot(page, 'ui-building');
  await page.evaluate(() => { window.__game.prefabs.holdClock = null; });
  await page.waitForFunction(() => !window.__game.prefabs.building, null, { timeout: 10000 });
  await meshed(page);
  await settle(page, 700);
  const after = await page.evaluate(() => ({ hist: window.__game.history.length, ents: window.__game.debug.entities().length, last: window.__game.prefabs.lastResult }));
  check(after.hist === before.hist + 1, `one history entry for the whole camper (${before.hist} -> ${after.hist})`);
  check(after.last && after.last.furniture.placed === after.last.furniture.requested, `all its furniture moved in (${after.last && after.last.furniture.placed}/${after.last && after.last.furniture.requested})`);
  await page.evaluate(() => {
    const g = window.__game, r = g.prefabs.lastResult, b = r.bounds;
    g.cameraRig.yaw = Math.atan2((b.x0 + b.x1) / 2 - g.player.position.x, (b.z0 + b.z1) / 2 - g.player.position.z);
    g.cameraRig.pitch = 0.3;
    g.cameraRig.distance = 9;
  });
  await settle(page, 700);
  await shot(page, 'ui-built');
  // Hand tool on the slide with the mouse: aim at it and click
  const slideUid = await page.evaluate(() => window.__game.entities.all().find((e) => e.key.startsWith('big_slide')).uid);
  await page.locator('.sw-round', { hasText: 'Hand' }).first().click();
  const sp = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    const foot = g.entities.localToWorld(e, 0.5, 0.5, e.def.size[2] + 2.5);
    g.player.teleport(foot.x, g.world.heightAt(Math.floor(foot.x), Math.floor(foot.z)) + 1.02, foot.z);
    const mid = g.entities.localToWorld(e, 0.5, 1.6, e.def.size[2] - 2.2);
    g.cameraRig.setMode('third');
    g.cameraRig.yaw = Math.atan2(mid.x - g.player.position.x, mid.z - g.player.position.z);
    g.cameraRig.pitch = 0.2;
    g.cameraRig.distance = 4.5;
    return [mid.x, mid.y, mid.z];
  }, slideUid);
  await meshed(page);
  await settle(page, 600);
  const spt = await screenPoint(page, ...sp);
  if (spt) await page.mouse.move(spt.x, spt.y);
  await settle(page, 400);
  // the hover target is worked out on the next drawn frame (a slow one here can take seconds)
  await page.waitForFunction(() => { const t = window.__game.target; return t && t.type === 'pickable' && t.pickable.ref && /^big_slide/.test(t.pickable.ref.key || ''); }, null, { timeout: 15000, polling: 100 }).catch(() => {});
  const hint = await page.evaluate(() => { const t = window.__game.target; return t && t.type === 'pickable' && t.pickable.ref && t.pickable.ref.key; });
  check(/^big_slide/.test(hint || ''), `the mouse over the slide targets it (${hint})`);
  await shot(page, 'ui-slide-hint', { toasts: true });
  if (spt) {
    await page.mouse.down();
    await page.mouse.up();
  }
  const r = await rideSlide(page, slideUid, 'ui-slide');
  check(r.riding && r.state !== 'sit', `a click with the Hand tool rides the slide all the way down (${r.secs.toFixed(1)} s real time)`);
  // the Undo button takes the whole camper away again
  await page.locator('.sw-undobtn').click();
  await page.waitForFunction((n) => window.__game.history.length === n, before.hist, { timeout: 5000, polling: 100 }).catch(() => {});
  const undone = await page.evaluate(() => ({ blocks: window.__game.world.blocks.slice().join(','), hist: window.__game.history.length, ents: window.__game.debug.entities().length }));
  check(undone.blocks === before.blocks, 'the Undo button put every block back');
  check(undone.ents === before.ents && undone.hist === before.hist, 'and took the furniture away');
  await context.close();
}

// ---------------- iPad: tap a spot, tap the ghost; tap the slide ----------------

async function touchPass(browser) {
  console.log('Touch: iPad 1024x768 - Campground and a slide ride by taps');
  const { context, page } = await open(browser, { viewport: { width: 1024, height: 768 }, touch: true, label: 'touch' });
  await newWorld(page, 'flat', 'cozy', 5);
  await page.evaluate(() => { window.__game.setDayTime(0.4); window.__game.cameraRig.pitch = 0.55; });
  await page.locator('.sw-bagbtn').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await page.locator('.sw-tab2', { hasText: 'Magic Houses' }).tap();
  const card = page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: 'Campground' });
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const el = [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item')].find((e) => e.textContent.includes('Campground')); return el && el.querySelector('img') && el.querySelector('img').src.startsWith('data:'); }, null, { timeout: 30000 }).catch(() => {});
  await settle(page, 300);
  await shot(page, 'touch-bag');
  await card.tap();
  await page.waitForFunction(() => { const gh = window.__game.prefabs.ghost; return gh && gh.key === 'campground'; }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  const s0 = await page.evaluate(() => window.__game.prefabs.ghost);
  check(!!s0, 'the Campground ghost shows where she is looking before any tap');
  await shot(page, 'touch-ghost');
  // tap on the ghost itself
  const gpt = await page.evaluate(() => {
    const g = window.__game, gh = g.prefabs.ghost, b = gh.placement.bounds, y0 = gh.placement.y;
    const canvas = g.renderer.domElement, r = canvas.getBoundingClientRect();
    const v = g.camera.position.clone();
    for (let fy = 0.1; fy <= 0.6; fy += 0.1) {
      for (let fx = 0.3; fx <= 0.7; fx += 0.1) {
        for (let fz = 0.2; fz <= 0.8; fz += 0.2) {
          v.set(b.x0 + (b.x1 - b.x0 + 1) * fx, y0 + 1 + fy * 3, b.z0 + (b.z1 - b.z0 + 1) * fz).project(g.camera);
          if (v.z > 1 || Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue;
          const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
          if (document.elementFromPoint(x, y) === canvas) return { x, y };
        }
      }
    }
    return null;
  });
  const hist0 = await page.evaluate(() => window.__game.history.length);
  if (gpt) await page.touchscreen.tap(gpt.x, gpt.y);
  else await page.locator('.sw-pf-go').tap();
  await page.waitForFunction(() => window.__game.prefabs.building || !!window.__game.prefabs.lastResult, null, { timeout: 6000, polling: 50 }).catch(() => {});
  await page.waitForFunction(() => !window.__game.prefabs.building, null, { timeout: 10000 }).catch(() => {});
  await meshed(page);
  await settle(page, 900);
  const built = await page.evaluate(() => ({ last: window.__game.prefabs.lastResult, hist: window.__game.history.length }));
  check(!!built.last && built.last.key === 'campground' && built.hist === hist0 + 1, 'tapping the ghost builds the Campground (one Undo entry)');
  await page.evaluate(() => {
    const g = window.__game, r = g.prefabs.lastResult, b = r.bounds;
    g.cameraRig.yaw = Math.atan2((b.x0 + b.x1) / 2 - g.player.position.x, (b.z0 + b.z1) / 2 - g.player.position.z);
    g.cameraRig.pitch = 0.35;
    g.cameraRig.distance = 8;
  });
  await settle(page, 600);
  await shot(page, 'touch-built');
  // a treehouse slide by tap with the Hand tool
  const tree = await placeBuild(page, 'friendship_treehouse', 40, 100, 0);
  await page.locator('.sw-round', { hasText: 'Hand' }).first().tap();
  const sp = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    const foot = g.entities.localToWorld(e, 0.5, 0.5, e.def.size[2] + 2.5);
    g.player.teleport(foot.x, g.world.heightAt(Math.floor(foot.x), Math.floor(foot.z)) + 1.02, foot.z);
    const mid = g.entities.localToWorld(e, 0.5, 1.4, e.def.size[2] - 2.4);
    g.cameraRig.yaw = Math.atan2(mid.x - g.player.position.x, mid.z - g.player.position.z);
    g.cameraRig.pitch = 0.15;
    g.cameraRig.distance = 4.5;
    return [mid.x, mid.y, mid.z];
  }, tree.slides[0]);
  await meshed(page);
  await settle(page, 700);
  const spt = await screenPoint(page, ...sp);
  if (spt) await page.touchscreen.tap(spt.x, spt.y);
  const r = await rideSlide(page, tree.slides[0], 'touch-slide');
  check(r.riding && r.state !== 'sit', `a tap on the big slide rides it on the iPad (${r.secs.toFixed(1)} s real time)`);
  await context.close();
}

async function main() {
  const browser = await launch({ headed: !!args.headed });
  try {
    if (ONLY.includes('gallery')) await gallery(browser);
    if (ONLY.includes('hills')) await hills(browser);
    if (ONLY.includes('play')) await play(browser);
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
