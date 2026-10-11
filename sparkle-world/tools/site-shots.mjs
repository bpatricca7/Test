// Real game pictures for the home page (site/img/): staged with the debug API, rendered by
// headless Chromium (SwiftShader WebGL2) at deviceScaleFactor 2, encoded to WebP in the page.
//
//   node tools/site-shots.mjs [--only=title,studio,...] [--no-build] [--keep-png] [--force-small]
//
// It builds the game (unless --no-build), starts server/server.mjs in-process on a free port
// and opens the game at /play (so "Play with Friends" is there, like on Railway). Scenes:
//
//   title          the title screen (live 3D backdrop, "Hi, Lily!")
//   studio         the Dress-Up Studio on the Hair tab (12 styles), in a princess look with wings
//   building       real play on an iPad (touch HUD: joystick, Bag, hotbar, Undo) half way
//                  through a real hold-and-drag row of pink planks
//   bedroom        a furnished bedroom with the princess canopy bed, at golden hour, lamps on
//   camper         the Sparkle Camper (rooftop deck, slide and pool), close up
//   camper-inside  inside it: the bunk beds and the kitchenette
//   zip            a zip line between two towers, caught mid-ride
//   unicorn        riding the unicorn with its rainbow trail
//   pets           puppies, kitties, a bunny, a turtle, a pony, a horse and the unicorn (21:9)
//   night          a cottage at night: stars, the moon, lamps glowing in the windows
//   friends        friends from the Bag dancing together
//   worlds         the seven world types as 4:5 postcards, 480x600 (world-meadow, -candy,
//                  -beach, -snow, -fairy (by day, at its glowing mushrooms), -flat (a little
//                  town on Builder Flat), -mix); fairy-dusk tries the Fairy Forest at dusk
//   icecream       the Ice Cream Parlor's build-your-own sundae (just the sundae card)
//   code           "Join a Code" keypad on a phone, and the real knock card on its own
//   tiles          16x16 block textures for the page's CSS blocks (site/img/tiles/*.png)
//   small          800 px wide copies (<name>-800.webp) for srcset, of pictures that have none
//   share          img/share.jpg (1200x630 link preview) and img/icon-180.png (home-screen
//                  icon), both from the built home page itself (needs dist/site/)
//
// Pictures go to site/img/<name>.webp. LOOK at them after a run.

import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { launch, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle, settle, screenPoint, ROOT, SHOTS } from './smoke.mjs';
import { createServer } from '../server/server.mjs';
import { routeGoogleFonts } from './site-fonts.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const ONLY = arg('only') ? String(arg('only')).split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);
const OUT = path.join(ROOT, 'site', 'img');
const errors = [];
const sizes = {};
let base = '';
let encoder = null;

// ---------------------------------------------------------------- helpers

async function openPlay(browser, { viewport = { width: 1280, height: 800 }, touch = false, name = 'Lily', look = null } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  await routeGoogleFonts(context);
  const page = await context.newPage();
  attachErrorCollectors(page, errors, name);
  await page.goto(`${base}/play`, { timeout: 180000 });
  await waitForTitle(page, 180000);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(({ name, look }) => {
    const g = window.__game;
    if (look) g.profile.look = look;
    g.profile.look.name = name;
    g.profile.playerName = name;
    g.profile.tutorialDone = true;
    g.profile.lookPicked = true; // keeps the marketing title shot free of the Dress Up nudge badge
    g.profile.settings.quality = 'auto';
    g.profile.settings.music = 0;
    g.profile.settings.sfx = 0;
    g.applySettings();
    g.saveProfile(true);
    g.events.emit('avatar:changed', { look: g.profile.look });
    g.events.emit('profile:changed', { profile: g.profile });
  }, { name, look });
  return { context, page };
}

async function newWorld(page, biome, { size = 'big', seed = 7, name = "Lily's Dream Meadow", time = 0.36 } = {}) {
  await page.evaluate(([b, s, seed, name]) => window.__game.debug.newWorld({ biome: b, size: s, seed, name }), [biome, size, seed, name]);
  await waitForPlay(page);
  await waitIdle(page);
  await page.evaluate((t) => {
    const g = window.__game;
    if (g.ui && g.ui.current) g.ui.close();
    g.profile.settings.timeFrozen = true;
    g.setDayTime(t);
    if (g.weather) g.weather.set('sunny', { instant: true, manual: true, silent: true });
  }, time);
  await settle(page, 400);
}

async function meshed(page, timeout = 30000) {
  await page.waitForFunction(() => window.__game.chunks.pending === 0, null, { timeout, polling: 100 }).catch(() => {});
}

/** Hide the HUD, toasts, hints and bubbles (a clean picture of the world). */
async function clean(page, on = true) {
  await page.evaluate((on) => {
    let s = document.getElementById('site-clean');
    if (on && !s) {
      s = document.createElement('style');
      s.id = 'site-clean';
      s.textContent = '.sw-hud, .sw-toasts, .sw-toast, .sw-hint, .lf-hud, .sw-stkpop, .lf-bubble, .sw-crosshair { display: none !important; }';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
    document.querySelectorAll('.sw-toast, .sw-stkpop').forEach((t) => t.remove());
  }, on);
}

/** Free camera: stop the rig and look from `from` at `to`. */
async function freeCam(page, from, to, { fov = 55, player = false } = {}) {
  await page.evaluate(([from, to, fov, player]) => {
    const g = window.__game;
    if (!g.__rigUpdate) {
      g.__rigUpdate = g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.__reach = g.reach;
      g.reach = -2; // no target outline in the picture
    }
    g.camera.position.set(...from);
    g.camera.fov = fov;
    g.camera.updateProjectionMatrix();
    g.camera.lookAt(...to);
    const a = g.player.avatar;
    if (a) a.group.visible = player;
  }, [from, to, fov, player]);
}

async function freeCamOff(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__rigUpdate) {
      g.cameraRig.update = g.__rigUpdate;
      g.reach = g.__reach;
    }
    g.__rigUpdate = null;
    g.camera.fov = 70;
    g.camera.updateProjectionMatrix();
    g.cameraRig.snap();
  });
}

/** Encode a PNG (buffer or data: URL) in the encoder page: scaled to `width` px wide, optionally
 *  laid on a `bg` color with `pad` px around it; returns the encoded bytes. */
async function encode(src, { width, q = 0.86, type = 'webp', pad = 0, bg = null, height = null }) {
  const data = Buffer.isBuffer(src) ? 'data:image/png;base64,' + src.toString('base64') : src;
  const mime = type === 'jpeg' ? 'image/jpeg' : type === 'png' ? 'image/png' : 'image/webp';
  const url = await encoder.evaluate(async ([data, width, q, mime, pad, bg, height]) => {
    const img = new Image();
    img.src = data;
    await img.decode();
    const inner = Math.min(width - 2 * pad, img.naturalWidth);
    const ih = Math.round((img.naturalHeight * inner) / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = inner + 2 * pad;
    c.height = height || ih + 2 * pad;
    const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, pad, Math.round((c.height - ih) / 2), inner, ih);
    return c.toDataURL(mime, q);
  }, [data, width, q, mime, pad, bg, height]);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

async function save(name, buf, ext = 'webp') {
  const file = path.join(OUT, `${name}.${ext}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  sizes[name] = buf.length;
  console.log(`  ${path.relative(ROOT, file)}  ${(buf.length / 1024).toFixed(0)} KB`);
  return file;
}

/**
 * Screenshot (optionally a clip, in CSS px) -> WebP at `width` px wide, quality q, saved as
 * site/img/<name>.webp; with `small` also site/img/<name>-<small>.webp (for srcset, phones).
 * Also keeps a PNG in .shots/ with --keep-png.
 */
async function grab(page, name, { clip = null, width = 1400, q = 0.86, type = 'webp', small = 0, pad = 0, bg = null, omitBackground = false } = {}) {
  const png = await page.screenshot({ type: 'png', omitBackground, timeout: 180000, ...(clip ? { clip } : {}) });
  if (arg('keep-png')) {
    await mkdir(SHOTS, { recursive: true });
    await writeFile(path.join(SHOTS, `site-src-${name}.png`), png);
  }
  const ext = type === 'jpeg' ? 'jpg' : type === 'png' ? 'png' : 'webp';
  const file = await save(name, await encode(png, { width, q, type, pad, bg }), ext);
  if (small) await save(`${name}-${small}`, await encode(png, { width: small, q: Math.min(q, 0.82), type, pad: Math.round((pad * small) / width), bg }), ext);
  return file;
}

/** 4:5 postcard crop from the middle of the window (the world cards). */
function cardClip(page) {
  const vp = page.viewportSize();
  const w = Math.round((vp.height * 4) / 5);
  return { x: Math.round((vp.width - w) / 2), y: 0, width: w, height: vp.height };
}

/** A band crop (`ratio` = width / height) from the window, `at` = 0 top .. 1 bottom. */
function bandClip(page, ratio, at = 0.5) {
  const vp = page.viewportSize();
  const h = Math.round(vp.width / ratio);
  return { x: 0, y: Math.round((vp.height - h) * at), width: vp.width, height: h };
}

/** Find a patch of ground in a square that is as flat as possible (returns its center + height). */
async function flatSpot(page, { x0, z0, x1, z1, r = 6, water = false }) {
  return page.evaluate(({ x0, z0, x1, z1, r, water }) => {
    const g = window.__game, w = g.world, props = g.registry.blocks.props;
    let best = null;
    for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) {
      const h0 = w.heightAt(x, z);
      if (h0 < 1) continue;
      let dev = 0, wet = 0;
      for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) {
        const h = w.heightAt(x + dx, z + dz);
        dev += Math.abs(h - h0);
        if (props.shape[w.get(x + dx, h, z + dz)] === 5) wet++;
      }
      if (!water && wet) continue;
      if (!best || dev < best.dev) best = { x, z, y: h0, dev };
    }
    return best;
  }, { x0, z0, x1, z1, r, water });
}

// ---------------------------------------------------------------- scenes

async function sceneTitle(browser) {
  console.log('title');
  const { context, page } = await openPlay(browser);
  await page.waitForSelector('button.sw-title-friends:not([hidden])', { timeout: 15000 }).catch(() => {});
  await settle(page, 3500);
  await grab(page, 'title', { width: 1600, small: 800 });
  await context.close();
}

async function sceneStudio(browser) {
  console.log('studio');
  const { context, page } = await openPlay(browser);
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.debug.avatar.starters().find((o) => o.key === 'princess');
    const look = JSON.parse(JSON.stringify(p.look));
    look.acc.back = 'fairy_wings';
    look.name = 'Lily';
    g.profile.look = look;
    g.saveProfile(true);
    g.events.emit('avatar:changed', { look });
  });
  await page.locator('.sw-title-small button', { hasText: 'Dress Up' }).click();
  await page.waitForFunction(() => window.__game.ui.current === 'dressup');
  await page.locator('.sw-dtab[data-tab="hair"]').click();
  await settle(page, 1200);
  await page.waitForFunction(() => {
    const pics = [...document.querySelectorAll('.sw-dress-content .sw-dsec:not([hidden]) .sw-dtile:not(.sw-empty) .sw-dpic')];
    return pics.length > 0 && pics.every((p) => p.classList.contains('sw-ready'));
  }, null, { timeout: 40000, polling: 250 }).catch(() => console.log('  (some thumbnails still rendering)'));
  await settle(page, 2200);
  await grab(page, 'studio', { width: 1600, small: 800 });
  await context.close();
}

/** The meadow scenes share one big world (different corners). */
async function meadowScenes(browser) {
  const names = ['bedroom', 'camper', 'camper-inside', 'zip', 'unicorn', 'pets', 'night', 'friends'].filter(want);
  if (!names.length) return;
  const { context, page } = await openPlay(browser);
  await newWorld(page, 'meadow', { seed: 7 });
  const size = await page.evaluate(() => ({ sx: window.__game.world.sx, sz: window.__game.world.sz }));
  console.log(`meadow world ${size.sx}x${size.sz}`);
  if (want('camper') || want('camper-inside')) await sceneCamper(page, size);
  if (want('bedroom')) await sceneBedroom(page, size);
  if (want('night')) await sceneNight(page, size);
  if (want('pets')) await scenePets(page, size);
  if (want('friends')) await sceneFriends(page, size);
  if (want('zip')) await sceneZip(page, size);
  if (want('unicorn')) await sceneUnicorn(page, size);
  await context.close();
}

/** Place a Magic House; returns its bounds, placement and plan. */
async function placeBuild(page, key, x, z, rot = 0) {
  return page.evaluate(([key, x, z, rot]) => {
    const g = window.__game;
    const r = g.prefabs.place(key, x, z, { rot });
    const p = g.prefabs.plan(key);
    if (!r) return null;
    return { bounds: r.bounds, placement: r.placement, plan: { W: p.W, H: p.H, D: p.D, ax: p.ax, az: p.az, maxY: p.maxY, view: g.registry.prefabs.get(key).view || null } };
  }, [key, x, z, rot]);
}

function local(res, lx, ly, lz) {
  const rot = res.placement.rot & 3, plan = res.plan;
  let dx = lx - plan.ax, dz = lz - plan.az;
  [dx, dz] = rot === 1 ? [dz, -dx] : rot === 2 ? [-dx, -dz] : rot === 3 ? [-dz, dx] : [dx, dz];
  return [res.placement.x + dx + 0.5, res.placement.y + ly, res.placement.z + dz + 0.5];
}

/**
 * Flatten a lot: grass on top at height y (the median around it), dirt below, nothing above;
 * flowers sprinkled near the edges (none in `clear` [x0, z0, x1, z1]). Returns y.
 */
async function lot(page, cx, cz, { rx = 14, rz = 14, flowers = 0.12, clear = null, seed = 1 } = {}) {
  const y = await page.evaluate(({ cx, cz, rx, rz, flowers, clear, seed }) => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const id = (k) => B.idOf(k);
    const G = id('grass'), D = id('dirt'), AIR = 0;
    const hs = [];
    for (let x = cx - rx; x <= cx + rx; x += 2) for (let z = cz - rz; z <= cz + rz; z += 2) hs.push(w.heightAt(x, z));
    hs.sort((a, b) => a - b);
    const y = Math.max(hs[Math.floor(hs.length / 2)], (w.waterLevel || 0) + 1);
    let r = seed >>> 0;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    const F = ['flower_tulip_pink', 'flower_daisy', 'flower_lavender', 'flower_cosmos', 'flower_tulip_white', 'flower_forgetmenot', 'flower_tulip', 'grass_tall', 'grass_tall'].map(id).filter((v) => v > 0);
    w.batch(() => {
      for (let x = cx - rx; x <= cx + rx; x++) for (let z = cz - rz; z <= cz + rz; z++) {
        const ex = Math.abs(x - cx) / rx, ez = Math.abs(z - cz) / rz;
        if (ex > 0.92 && ez > 0.92) continue; // rounded corners
        for (let yy = y + 1; yy < y + 40; yy++) if (w.get(x, yy, z) !== AIR) w.set(x, yy, z, AIR, { record: false });
        w.set(x, y, z, G, { record: false });
        for (let yy = y - 1; yy >= Math.max(1, y - 5); yy--) w.set(x, yy, z, D, { record: false });
        const inClear = clear && x >= clear[0] && x <= clear[2] && z >= clear[1] && z <= clear[3];
        const edge = Math.max(ex, ez);
        if (!inClear && F.length && rnd() < flowers * (0.35 + edge)) w.set(x, y + 1, z, F[Math.floor(rnd() * F.length)], { record: false });
      }
    });
    return y;
  }, { cx, cz, rx, rz, flowers, clear, seed });
  await waitIdle(page);
  return y;
}

/** Remove every tree block (leaves, logs) in a box, above ground. */
async function clearTrees(page, x0, z0, x1, z1) {
  await page.evaluate(([x0, z0, x1, z1]) => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const tree = /^(leaves|log|palm|pine|snow_leaves)/;
    w.batch(() => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = 1; y < 90; y++) {
        const id = w.get(x, y, z);
        if (id && tree.test((B.byId(id) || {}).key || '')) w.set(x, y, z, 0, { record: false });
      }
    });
  }, [x0, z0, x1, z1]);
  await waitIdle(page);
}

/** Park the player far away (hides name tags, keeps her out of the picture). */
async function parkPlayer(page, x, z) {
  await page.evaluate(([x, z]) => {
    const g = window.__game;
    g.player.setFlying(true);
    g.player.teleport(x, g.world.heightAt(x, z) + 30, z);
    g.player.velocity.set(0, 0, 0);
  }, [x, z]);
}

async function sceneCamper(page, { sx, sz }) {
  console.log('camper');
  const s = await flatSpot(page, { x0: 30, z0: 30, x1: Math.floor(sx / 2) - 16, z1: Math.floor(sz / 2) - 16, r: 10 });
  await lot(page, s.x, s.z + 4, { rx: 20, rz: 22, flowers: 0.1, clear: [s.x - 12, s.z - 8, s.x + 12, s.z + 26], seed: 3 });
  await clearTrees(page, s.x - 34, s.z - 20, s.x + 34, s.z + 46);
  const res = await placeBuild(page, 'sparkle_camper', s.x, s.z, 0);
  if (!res) return errors.push('[site] the Sparkle Camper did not place');
  await parkPlayer(page, s.x + 60, s.z + 60);
  await page.evaluate(() => window.__game.setDayTime(0.4));
  const b = res.bounds;
  const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2, y = res.placement.y;
  const span = Math.max(res.plan.W, res.plan.D);
  console.log(`  camper ${res.plan.W}x${res.plan.H}x${res.plan.D} at ${cx},${y},${cz}`);
  await clean(page);
  // close in on the camper, the roof deck and the slide into the pool
  await freeCam(page, [b.x1 + span * 0.06, y + span * 0.34, b.z1 + span * 0.52], [cx + 1.5, y + 3.2, cz], { fov: 50 });
  await meshed(page);
  await settle(page, 1400);
  await grab(page, 'camper', { small: 800 });
  // inside: the bunk beds and the kitchenette (the prefab's own "bunks" view, a little wider)
  if (want('camper-inside')) {
    const v = res.plan.view && res.plan.view.bunks;
    const from = local(res, 14.6, 4.1, 8.9), to = local(res, 5.2, 2.5, 6.6);
    if (v) console.log(`  camper inside from ${from.map((n) => n.toFixed(1))} to ${to.map((n) => n.toFixed(1))}`);
    await freeCam(page, from, to, { fov: 74 });
    await meshed(page);
    await settle(page, 1400);
    await grab(page, 'camper-inside', { small: 800 });
  }
  await freeCamOff(page);
}

async function sceneBedroom(page, { sx }) {
  console.log('bedroom');
  const s = await flatSpot(page, { x0: Math.floor(sx / 2) + 12, z0: 30, x1: sx - 34, z1: 80, r: 8 });
  const y = await lot(page, s.x, s.z, { rx: 11, rz: 11, flowers: 0.14, clear: [s.x - 6, s.z - 5, s.x + 6, s.z + 6], seed: 5 });
  const R = await page.evaluate(({ x, z, y }) => {
    const g = window.__game, w = g.world, B = g.registry.blocks, E = g.entities;
    const set = (x, y, z, key) => w.set(x, y, z, B.idOf(key), { record: false });
    const Y = y + 1, x0 = x - 4, x1 = x + 4, z0 = z - 3, z1 = z + 4;
    w.batch(() => {
      for (let xx = x0; xx <= x1; xx++) for (let zz = z0; zz <= z1 + 1; zz++) set(xx, Y - 1, zz, 'planks_pink');
      for (let yy = Y; yy < Y + 3; yy++) {
        for (let xx = x0; xx <= x1; xx++) set(xx, yy, z0, 'wallpaper_hearts');
        for (let zz = z0; zz <= z1; zz++) { set(x0, yy, zz, 'wallpaper_hearts'); set(x1, yy, zz, 'wallpaper_hearts'); }
      }
      for (let xx = x0; xx <= x1; xx++) for (let zz = z0; zz <= z0 + 1; zz++) set(xx, Y + 3, zz, 'wallpaper_hearts');
      set(x0 + 1, Y + 1, z0, 'air');
      set(x0 + 6, Y + 1, z0, 'air');
    });
    const put = (key, x, y, z, rot = 0, color = null, data = {}) => {
      const e = E.place(key, x, y, z, rot, color, data, { history: false, fx: false });
      if (!e) console.warn('bedroom: no ' + key);
      return e ? e.uid : null;
    };
    put('bed_canopy', x0 + 2, Y, z0 + 2, 0, '#FF9CCB');
    put('nightstand', x0 + 4, Y, z0 + 1, 0, '#FFFFFF');
    put('table_lamp', x0 + 4, Y + 1, z0 + 1, 0, '#FFE38F');
    put('picture_frame', x0 + 5, Y + 1, z0 + 1, 0, '#FFFFFF', { art: 0 });
    put('bed_bunk', x0 + 6, Y, z0 + 2, 0, '#C8B4FF');
    put('wardrobe', x0 + 1, Y, z0 + 5, 1, '#FFFFFF');
    put('rug_heart', x0 + 3, Y, z0 + 6, 0, '#FF9CCB');
    put('toy_chest', x0 + 7, Y, z0 + 7, 3, '#9BE8CF');
    put('bookshelf', x0 + 7, Y, z0 + 4, 3, '#FFFFFF');
    put('teddy_bear', x0 + 7, Y + 1, z0 + 4, 3, '#E7BE8C');
    put('window_frame', x0 + 1, Y + 1, z0, 0, '#FFFFFF');
    put('window_frame', x0 + 6, Y + 1, z0, 0, '#FFFFFF');
    for (const xx of [x0 + 1, x0 + 4, x0 + 5]) put('fairy_lights', xx, Y + 2, z0 + 1, 0, null);
    put('pet_bed', x0 + 5, Y, z0 + 7, 0, '#C8B4FF');
    put('floor_lamp', x0 + 1, Y, z0 + 7, 0, '#FF9CCB');
    const kitty = g.pets.adopt('kitty', 'ginger', 'Mango', [x0 + 4.2, Y + 0.01, z0 + 6.3], { fx: false });
    if (kitty) { kitty.yaw = Math.PI * 0.8; kitty._think = () => { kitty.anim.pose = 'sit'; kitty.lookAtPlayer = false; }; }
    return { x0, z0, Y };
  }, { x: s.x, z: s.z, y });
  await parkPlayer(page, s.x + 60, s.z + 40);
  await waitIdle(page);
  await clean(page);
  const { x0, z0, Y } = R;
  // looking down into the open-front room, the canopy bed in the middle
  for (const [name, t] of [['bedroom', 0.735]]) {
    await page.evaluate((t) => window.__game.setDayTime(t), t);
    await freeCam(page, [x0 + 5.4, Y + 4.4, z0 + 9.4], [x0 + 3.2, Y + 0.7, z0 + 2.6], { fov: 54 });
    await meshed(page);
    await settle(page, 1600);
    await grab(page, name, { small: 800 });
  }
  await freeCamOff(page);
  await page.evaluate(() => { const g = window.__game; for (const q of g.pets.pets.slice()) g.pets.remove(q); g.setDayTime(0.4); });
}

async function sceneNight(page, { sx, sz }) {
  console.log('night');
  const s = await flatSpot(page, { x0: 34, z0: Math.floor(sz / 2) + 12, x1: Math.floor(sx / 2) - 14, z1: sz - 40, r: 9 });
  await lot(page, s.x, s.z + 5, { rx: 18, rz: 20, flowers: 0.12, clear: [s.x - 9, s.z - 7, s.x + 9, s.z + 7], seed: 9 });
  const res = await placeBuild(page, 'cottage', s.x, s.z, 0);
  if (!res) return errors.push('[site] the cottage did not place');
  const b = res.bounds;
  const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2, y = res.placement.y;
  await page.evaluate(([b]) => {
    const g = window.__game, E = g.entities;
    const put = (key, x, z, color) => E.place(key, x, g.world.heightAt(x, z) + 1, z, 0, color, {}, { history: false, fx: false });
    put('lantern_post', b.x0 - 1, b.z1 + 3, '#C8B4FF');
    put('lantern_post', b.x1 + 1, b.z1 + 3, '#C8B4FF');
    put('campfire', b.x1 + 4, b.z1 + 6, null);
    put('camp_chair', b.x1 + 2, b.z1 + 7, '#FF9CCB');
    g.setDayTime(0.94);
  }, [b]);
  await parkPlayer(page, s.x - 50, s.z - 50);
  await waitIdle(page);
  await clean(page);
  const span = Math.max(res.plan.W, res.plan.D);
  console.log(`  cottage ${res.plan.W}x${res.plan.H}x${res.plan.D}`);
  await freeCam(page, [cx + span * 0.45, y + 2.6, b.z1 + span * 0.95], [cx, y + res.plan.maxY * 0.62, cz], { fov: 60 });
  await meshed(page);
  await settle(page, 1800);
  await grab(page, 'night', { small: 800 });
  await freeCamOff(page);
  await page.evaluate(() => window.__game.setDayTime(0.4));
}

async function scenePets(page, { sx, sz }) {
  console.log('pets');
  const s = await flatSpot(page, { x0: Math.floor(sx / 2) + 12, z0: Math.floor(sz / 2) + 12, x1: sx - 34, z1: sz - 34, r: 8 });
  const y = await lot(page, s.x, s.z, { rx: 16, rz: 16, flowers: 0.16, clear: [s.x - 8, s.z - 6, s.x + 8, s.z + 12], seed: 13 });
  await parkPlayer(page, s.x - 60, s.z - 60);
  const p = await page.evaluate(({ x, y, z }) => {
    const g = window.__game;
    for (const q of g.pets.pets.slice()) g.pets.remove(q);
    const small = [['kitty', 'siamese'], ['puppy', 'retriever'], ['bunny', 'snowball'], ['turtle', 'rainbow'], ['puppy', 'corgi'], ['kitty', 'calico'], ['duckling', 'sunny']];
    const big = [['pony', 'strawberry'], ['unicorn', 'pearl'], ['horse', 'palomino']];
    const cx = x + 0.5, cz = z + 0.5;
    const place = (s, v, px, pz, yaw) => {
      const spec = g.registry.pets.get(s);
      const vv = spec.variants.find((q) => q.key === v) || spec.variants[0];
      const pet = g.pets.adopt(s, vv.key, vv.name, [px, y + 1.01, pz], { fx: false, opts: s === 'horse' ? { braids: true } : null });
      if (!pet) return;
      pet.yaw = yaw;
      pet._think = () => { pet.anim.pose = 'stand'; pet.lookAtPlayer = false; };
    };
    small.forEach(([s, v], i) => place(s, v, cx + (i - (small.length - 1) / 2) * 1.25, cz + 1.2 + (i % 2 ? -0.3 : 0.2), (i - 3) * -0.14));
    big.forEach(([s, v], i) => place(s, v, cx + (i - 1) * 2.7, cz - 1.8, (i - 1) * -0.3));
    g.setDayTime(0.38);
    return { cx, cz, y: y + 1 };
  }, { x: s.x, y, z: s.z });
  await settle(page, 2500);
  await page.evaluate(() => { for (const q of window.__game.pets.pets) q.anim.happy = 2; });
  await clean(page);
  // a wide band (21:9) for the full-width Pets chapter: a little lower and wider than before
  await freeCam(page, [p.cx + 0.3, p.y + 2.2, p.cz + 8.8], [p.cx, p.y + 1.1, p.cz - 0.4], { fov: 44 });
  await meshed(page);
  await settle(page, 600);
  await grab(page, 'pets', { clip: bandClip(page, 21 / 9, 0.5), width: 2000, small: 800, q: 0.84 });
  await freeCamOff(page);
  await page.evaluate(() => { const g = window.__game; for (const q of g.pets.pets.slice()) g.pets.remove(q); });
}

async function sceneFriends(page, { sx, sz }) {
  console.log('friends');
  const s = await flatSpot(page, { x0: Math.floor(sx / 2) - 20, z0: Math.floor(sz / 2) - 20, x1: Math.floor(sx / 2) + 20, z1: Math.floor(sz / 2) + 20, r: 6 });
  const ly = await lot(page, s.x, s.z, { rx: 12, rz: 12, flowers: 0.16, clear: [s.x - 5, s.z - 5, s.x + 5, s.z + 7], seed: 21 });
  const p = await page.evaluate(({ x, z, ly }) => {
    const g = window.__game, d = g.debug.friends;
    const y = ly + 1;
    g.player.setFlying(false);
    g.player.teleport(x - 2.2, y + 0.02, z + 0.2);
    g.player.yaw = Math.PI * 0.8;
    const spots = [['ava', -1.6, -2.3], ['mia', -0.1, -3.0], ['zoe', 1.4, -2.7], ['lilyrose', 2.7, -1.9]];
    const ids = spots.map(([k, dx, dz]) => d.invite(k, x + 0.5 + dx, y + 0.02, z + 0.5 + dz));
    g.setDayTime(0.4);
    return { x: x + 0.5, y, z: z + 0.5, ids };
  }, { x: s.x, z: s.z, ly });
  await settle(page, 1500);
  await page.evaluate((ids) => { const d = window.__game.debug.friends; if (ids[0]) d.dance(ids[0]); }, p.ids);
  await settle(page, 1400);
  await clean(page);
  await freeCam(page, [p.x + 0.4, p.y + 2.0, p.z + 4.6], [p.x + 0.3, p.y + 1.0, p.z - 2.2], { fov: 55, player: true });
  await settle(page, 700);
  await grab(page, 'friends', { small: 800 });
  await freeCamOff(page);
  await page.evaluate((ids) => { const d = window.__game.debug.friends; for (const id of ids) if (id) d.remove(id); }, p.ids);
}

async function sceneZip(page, { sx, sz }) {
  console.log('zip');
  const spots = await page.evaluate(({ sx, sz }) => {
    const g = window.__game, w = g.world, props = g.registry.blocks.props;
    const flat2 = (x, z) => {
      const h = w.heightAt(x, z);
      if (h < 1) return -1;
      for (const [dx, dz] of [[1, 0], [0, -1], [1, -1], [0, 1], [1, 1], [-1, 0], [-1, -1]]) if (w.heightAt(x + dx, z + dz) !== h) return -1;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = h + 1; y < h + 9; y++) {
        const id = w.get(x + dx, y, z + dz);
        if (id && !props.replaceable[id]) return -1;
      }
      if (props.shape[w.get(x, h, z)] === 5) return -1;
      return h;
    };
    const cands = [];
    for (let x = 14; x < sx - 14; x += 2) for (let z = 14; z < sz - 14; z += 2) {
      const h = flat2(x, z);
      if (h > 0 && h > (w.waterLevel || 0) + 2) cands.push([x, h, z]);
    }
    cands.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < Math.min(cands.length, 80); i++) {
      const a = cands[i];
      for (let j = i + 1; j < cands.length; j++) {
        const b = cands[j];
        const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
        if (d >= 20 && d <= 28 && a[1] - b[1] >= 2 && a[1] - b[1] <= 7) return { a, b };
      }
    }
    return null;
  }, { sx, sz });
  if (!spots) return errors.push('[site] no hill tops for the zip line');
  // no trees in the way: clear leaves and logs around the cable
  await page.evaluate(({ a, b }) => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const x0 = Math.min(a[0], b[0]) - 9, x1 = Math.max(a[0], b[0]) + 9, z0 = Math.min(a[2], b[2]) - 9, z1 = Math.max(a[2], b[2]) + 9;
    const tree = /^(leaves|log|palm|pine|snow_leaves)/;
    w.batch(() => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = 1; y < 90; y++) {
        const id = w.get(x, y, z);
        if (id && tree.test((B.byId(id) || {}).key || '')) w.set(x, y, z, 0, { record: false });
      }
    });
  }, spots);
  await waitIdle(page);
  const towers = await page.evaluate(({ a, b }) => {
    const g = window.__game, d = g.debug;
    d.select('furn:zipline_tower');
    d.useAt(a[0], a[1], a[2]);
    d.useAt(b[0], b[1], b[2]);
    return g.entities.all().filter((e) => e.key === 'zipline_tower').map((e) => ({ uid: e.uid, x: e.x, y: e.y, z: e.z }));
  }, spots);
  const links = await page.evaluate(() => window.__game.debug.outdoor.links());
  if (towers.length < 2 || !links.length) return errors.push(`[site] zip line towers ${towers.length}, links ${links.length}`);
  const [A] = towers;
  await page.evaluate((uid) => {
    const g = window.__game;
    g.setDayTime(0.36);
    g.debug.outdoor.zip(uid);
  }, A.uid);
  await page.waitForFunction(() => { const r = window.__game.debug.outdoor.ride(); return !r || (r.phase === 'zip' && r.s > r.len * 0.4); }, null, { timeout: 90000, polling: 100 }).catch(() => {});
  const pose = await page.evaluate(() => {
    const g = window.__game;
    g.outdoor.zip.freeze = true;
    const p = g.player.position, r = g.outdoor.zip.ride;
    const yaw = r ? r.travelYaw : 0;
    return { p: [p.x, p.y, p.z], f: [Math.sin(yaw), Math.cos(yaw)], s: [Math.cos(yaw), -Math.sin(yaw)] };
  });
  await clean(page);
  const [px, py, pz] = pose.p;
  // from the side and a little ahead, looking back along the cable
  await freeCam(page, [px + pose.s[0] * 4.2 + pose.f[0] * 2.4, py + 0.9, pz + pose.s[1] * 4.2 + pose.f[1] * 2.4], [px - pose.f[0] * 0.8, py + 1.2, pz - pose.f[1] * 0.8], { fov: 58, player: true });
  await settle(page, 1200);
  await grab(page, 'zip', { small: 800 });
  await page.evaluate(() => { window.__game.outdoor.zip.freeze = false; });
  await freeCamOff(page);
  await page.waitForFunction(() => !window.__game.debug.outdoor.ride(), null, { timeout: 120000, polling: 250 }).catch(() => {});
}

async function sceneUnicorn(page, { sx, sz }) {
  console.log('unicorn');
  const s = await flatSpot(page, { x0: 30, z0: 30, x1: sx - 30, z1: sz - 30, r: 6 });
  const id = await page.evaluate(({ x, z }) => {
    const g = window.__game;
    const y = g.world.heightAt(x, z) + 1.02;
    g.player.teleport(x + 0.5, y, z + 0.5);
    const pet = g.pets.adopt('unicorn', 'pearl', 'Sprinkles', [x + 1.5, y, z + 0.5], { fx: false });
    g.setDayTime(0.4);
    return pet ? pet.id : null;
  }, s);
  if (!id) return errors.push('[site] no unicorn');
  await page.evaluate((id) => window.__game.debug.pets.ride(id), id);
  await settle(page, 400);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.setMode('third'); g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.1; });
  await page.mouse.move(640, 700);
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1600);
  const r = await page.evaluate(() => { const g = window.__game, p = g.pets.rider.pos; return { p: [p.x, p.y, p.z], yaw: g.pets.rider.yaw }; });
  await clean(page);
  // keep moving (the trail grows), camera beside and slightly ahead, following
  for (let i = 0; i < 6; i++) {
    const q = await page.evaluate(() => { const g = window.__game, p = g.pets.rider.pos; return { p: [p.x, p.y, p.z], yaw: g.pets.rider.yaw }; });
    const f = [Math.sin(q.yaw), Math.cos(q.yaw)], sd = [Math.cos(q.yaw), -Math.sin(q.yaw)];
    await freeCam(page, [q.p[0] + sd[0] * 5.2 + f[0] * 3.2, q.p[1] + 1.7, q.p[2] + sd[1] * 5.2 + f[1] * 3.2], [q.p[0] - f[0] * 1.2, q.p[1] + 0.9, q.p[2] - f[1] * 1.2], { fov: 58, player: true });
    await page.waitForTimeout(120);
  }
  await grab(page, 'unicorn', { small: 800 });
  await page.keyboard.up('w');
  void r;
  await freeCamOff(page);
  await page.evaluate(() => window.__game.debug.pets.dismount());
}

async function sceneCandy(browser) {
  console.log('world-candy');
  const { context, page } = await openPlay(browser);
  await newWorld(page, 'candy', { seed: 11, name: "Lily's Candy Land", time: 0.42 });
  const size = await page.evaluate(() => ({ sx: window.__game.world.sx, sz: window.__game.world.sz }));
  const s = await flatSpot(page, { x0: 30, z0: 30, x1: size.sx - 30, z1: size.sz - 30, r: 7 });
  const res = await placeBuild(page, 'candy_house', s.x, s.z, 0);
  await parkPlayer(page, 8, 8);
  await clean(page);
  const cx = res ? (res.bounds.x0 + res.bounds.x1) / 2 : s.x, cz = res ? (res.bounds.z0 + res.bounds.z1) / 2 : s.z;
  const y = res ? res.placement.y : s.y;
  // a postcard: the candy house in the middle, frosting hills around it
  await freeCam(page, [cx + 13, y + 17, cz + 30], [cx - 1, y + 1, cz - 3], { fov: 56 });
  await meshed(page);
  await settle(page, 1500);
  await grab(page, 'world-candy', { clip: cardClip(page), width: 480, q: 0.8 });
  await context.close();
}

/** Every stem base of a glowing giant mushroom, with how many others stand near it. */
async function glowMushrooms(page) {
  return page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const stem = B.idOf('mushroom_stem'), cap = B.idOf('mushroom_cap_glow');
    const bases = [];
    for (let x = 12; x < w.sx - 12; x++) for (let z = 12; z < w.sz - 12; z++) {
      for (let y = 12; y < 60; y++) {
        if (w.get(x, y, z) !== stem || w.get(x, y - 1, z) === stem) continue;
        let top = y;
        while (w.get(x, top + 1, z) === stem) top++;
        if (w.get(x, top + 1, z) === cap) bases.push({ x, y, z, top });
      }
    }
    for (const b of bases) b.near = bases.filter((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) < 13).length;
    return { bases, sx: w.sx, sz: w.sz };
  });
}

async function sceneFairy(browser, { time = 0.42, name = 'world-fairy' } = {}) {
  console.log(name);
  const { context, page } = await openPlay(browser);
  await newWorld(page, 'fairy', { seed: 5, name: "Lily's Fairy Forest", time });
  await parkPlayer(page, 8, 8);
  const { bases, sx, sz } = await glowMushrooms(page);
  if (!bases.length) {
    errors.push('[site] no glowing mushrooms in the Fairy Forest');
    await context.close();
    return;
  }
  // the busiest patch of glowing mushrooms not too far from the middle
  const mid = (b) => Math.hypot(b.x - sx / 2, b.z - sz / 2);
  bases.sort((a, b) => (b.near - mid(b) / 25) - (a.near - mid(a) / 25));
  const m = bases[0];
  const others = bases.filter((o) => o !== m && Math.hypot(o.x - m.x, o.z - m.z) < 13);
  const gx = others.reduce((a, o) => a + o.x, m.x) / (others.length + 1), gz = others.reduce((a, o) => a + o.z, m.z) / (others.length + 1);
  // look at the patch from the side with the clearest view (fewest blocks in the way)
  const target = [gx + 0.5, m.top - 1, gz + 0.5];
  const dir = await page.evaluate(({ target, sx, sz }) => {
    const g = window.__game, w = g.world, props = g.registry.blocks.props;
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const cam = [target[0] + dx * 19, target[1] + 7, target[2] + dz * 19];
      let blocked = 0;
      for (let t = 0.12; t < 0.86; t += 0.02) {
        const x = cam[0] + (target[0] - cam[0]) * t, y = cam[1] + (target[1] - cam[1]) * t, z = cam[2] + (target[2] - cam[2]) * t;
        const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z));
        if (id && !props.replaceable[id]) blocked++;
      }
      const inward = -(dx * (sx / 2 - target[0]) + dz * (sz / 2 - target[2])) / 100; // prefer standing toward the middle
      const score = blocked + inward;
      if (!best || score < best.score) best = { dx, dz, blocked, score };
    }
    return best;
  }, { target, sx, sz });
  const dx = dir.dx, dz = dir.dz;
  console.log(`  ${bases.length} glowing mushrooms; patch of ${others.length + 1} at ${gx.toFixed(0)},${gz.toFixed(0)}; view blocked ${dir.blocked}`);
  await clean(page);
  await page.evaluate(() => {
    const g = window.__game, bu = g.blockUniforms, fog = g.scene.fog;
    bu.uFogNear.value = 90; bu.uFogFar.value = 220; fog.near = 90; fog.far = 220;
  });
  const cam = [target[0] + dx * 19, target[1] + 7, target[2] + dz * 19];
  await freeCam(page, cam, target, { fov: 60 });
  await meshed(page);
  await settle(page, 1800);
  await grab(page, name, { clip: cardClip(page), width: 480, q: 0.82 });
  await context.close();
}

/** Builder Flat: a little town (a street of Magic Houses, lamps, a garden and a playground). */
async function sceneFlatTown(browser) {
  console.log('world-flat');
  const { context, page } = await openPlay(browser);
  await newWorld(page, 'flat', { seed: 5, name: "Lily's Little Town", time: 0.4 });
  await parkPlayer(page, 8, 8);
  const c = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const x = Math.floor(w.sx / 2), z = Math.floor(w.sz / 2);
    return { x, z, y: w.heightAt(x, z) };
  });
  const town = await page.evaluate(({ c }) => {
    const g = window.__game, w = g.world, B = g.registry.blocks, E = g.entities;
    const PATH = B.idOf('path');
    const zs = c.z; // the street runs along x
    w.batch(() => {
      for (let x = c.x - 44; x <= c.x + 44; x++) for (let z = zs - 1; z <= zs + 1; z++) w.set(x, c.y, z, PATH, { record: false });
    });
    const placed = [];
    // north side: houses facing the street
    let x = c.x - 34;
    for (const key of ['cottage', 'bakery', 'pet_shop', 'candy_house', 'modern_house']) {
      const p = g.prefabs.plan(key);
      if (!p) continue;
      const px = x + p.ax, pz = zs - 3 - (p.D - 1) + p.az;
      const r = g.prefabs.place(key, px, pz, { rot: 0 });
      if (r) { placed.push({ key, b: r.bounds }); x = r.bounds.x1 + 4; } else x += p.W + 4;
    }
    // south side: a flower garden and a playground
    x = c.x - 26;
    for (const key of ['flower_garden', 'playground', 'flower_garden']) {
      const p = g.prefabs.plan(key);
      if (!p) continue;
      const px = x + p.ax, pz = zs + 3 + p.az;
      const r = g.prefabs.place(key, px, pz, { rot: 0 });
      if (r) { placed.push({ key, b: r.bounds }); x = r.bounds.x1 + 6; } else x += p.W + 6;
    }
    // lamps along the street
    for (let lx = c.x - 36; lx <= c.x + 36; lx += 8) {
      E.place('lantern_post', lx, c.y + 1, zs - 2, 0, '#FF9CCB', {}, { history: false, fx: false });
      E.place('lantern_post', lx + 4, c.y + 1, zs + 2, 0, '#C8B4FF', {}, { history: false, fx: false });
    }
    return placed;
  }, { c });
  console.log(`  town: ${town.map((t) => t.key).join(', ')}`);
  await waitIdle(page);
  await clean(page);
  await page.evaluate(() => {
    const g = window.__game, bu = g.blockUniforms, fog = g.scene.fog;
    bu.uFogNear.value = 110; bu.uFogFar.value = 240; fog.near = 110; fog.far = 240;
  });
  // down the street from above one end
  await freeCam(page, [c.x + 30, c.y + 20, c.z + 17], [c.x + 2, c.y + 2, c.z - 3], { fov: 58 });
  await meshed(page);
  await settle(page, 1800);
  await grab(page, 'world-flat', { clip: cardClip(page), width: 480, q: 0.8 });
  await context.close();
}

/** A world type from a low flying view over its middle (fog pushed back a little), as a 4:5 card. */
async function sceneBiome(browser, biome, { time = 0.4, weather = 'sunny', seed = 5, name = 'World', view = null } = {}) {
  console.log(`world-${biome}`);
  const { context, page } = await openPlay(browser);
  await newWorld(page, biome, { seed, name, time, size: 'big' });
  if (weather !== 'sunny') await page.evaluate((w) => window.__game.weather.set(w, { instant: true, manual: true, silent: true }), weather);
  const info = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    return { spawn: w.meta.spawn, sx: w.sx, sz: w.sz };
  });
  const c = info.sx / 2, sy = info.spawn[1];
  await parkPlayer(page, 8, 8);
  await clean(page);
  await page.evaluate(() => {
    const g = window.__game, bu = g.blockUniforms, fog = g.scene.fog;
    g.__fog = [bu.uFogNear.value, bu.uFogFar.value, fog.near, fog.far];
    bu.uFogNear.value = 120; bu.uFogFar.value = 260; fog.near = 120; fog.far = 260;
  });
  const v = view ? view(c, sy, info) : [[c + 4, sy + 13, c + 30], [c, sy + 1, c - 20]];
  await freeCam(page, v[0], v[1], { fov: 62 });
  await meshed(page);
  await settle(page, 1800);
  await grab(page, `world-${biome}`, { clip: cardClip(page), width: 480, q: 0.8 });
  await context.close();
}

/**
 * Real play on an iPad (1024x768, touch): the on-screen joystick, the Bag, the hotbar and Undo,
 * and a row of pink planks half way through a real hold-and-drag (the finger is still down).
 */
async function sceneBuilding(browser) {
  console.log('building');
  const { context, page } = await openPlay(browser, { viewport: { width: 1024, height: 768 }, touch: true });
  await newWorld(page, 'meadow', { seed: 7, time: 0.4 });
  await page.evaluate(() => {
    const g = window.__game;
    const slots = ['block:planks_pink', 'block:glass_heart', 'block:planks_white', 'block:roof_pink', 'block:lamp_block', 'block:wallpaper_hearts', 'furn:bed_canopy', 'furn:table_lamp', 'block:flower_tulip_pink'];
    slots.forEach((k, i) => { if (g.registry.items.has(k)) g.setSlot(i, k); });
    g.selectSlot(0);
  });
  const size = await page.evaluate(() => ({ sx: window.__game.world.sx, sz: window.__game.world.sz }));
  const S = await flatSpot(page, { x0: 40, z0: 40, x1: size.sx - 40, z1: size.sz - 40, r: 10 });
  // the house: 7 wide (x0..x1), 5 deep (z0..z1); she stands in front of it, a little to the left
  const x0 = S.x - 2, x1 = S.x + 4, z0 = S.z - 4, z1 = S.z;
  const G = await lot(page, S.x, S.z + 2, { rx: 16, rz: 14, flowers: 0.14, clear: [x0 - 4, z0 - 2, x1 + 4, z1 + 9], seed: 17 });
  await clearTrees(page, x0 - 18, z0 - 16, x1 + 18, z1 + 16);
  await page.evaluate(({ x0, x1, z0, z1, G }) => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const set = (x, y, z, k) => w.set(x, y, z, B.idOf(k), { record: false });
    w.batch(() => {
      for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) set(x, G, z, 'planks_white');
      for (let y = G + 1; y <= G + 3; y++) {
        for (let x = x0; x <= x1; x++) set(x, y, z0, 'planks_pink');
        for (let z = z0; z <= z1; z++) set(x0, y, z, 'planks_pink');
        if (y <= G + 2) for (let z = z0; z <= z1; z++) set(x1, y, z, 'planks_pink');
      }
      set(x0 + 2, G + 2, z0, 'glass_heart');
      set(x0 + 4, G + 2, z0, 'glass_heart');
      set(x0, G + 2, z0 + 2, 'glass_heart');
      set(x0, G + 4, z0, 'lamp_block');
      set(x1, G + 3, z0, 'lamp_block');
    });
  }, { x0, x1, z0, z1, G });
  await waitIdle(page);
  await page.evaluate(({ x, y, z }) => {
    const g = window.__game;
    g.player.setFlying(false);
    g.player.teleport(x, y, z);
    g.player.velocity.set(0, 0, 0);
    g.cameraRig.setMode('third');
    g.cameraRig.yaw = Math.PI - 0.16;
    g.player.yaw = Math.PI - 0.16;
    g.cameraRig.pitch = 0.5;
    g.cameraRig.distance = 4.6;
    g.cameraRig.snap();
  }, { x: x0 - 0.3, y: G + 1.02, z: z1 + 4.2 });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.sw-toasts, .sw-toast, .sw-hint, .sw-stkpop { display: none !important; }';
    document.head.appendChild(s);
  });
  await meshed(page);
  await settle(page, 1500);
  // a real hold-and-drag along the front wall's first row, from the left corner
  // (touches in the left 40% of an iPad screen steer the joystick, so the row starts right of that)
  const pt = (x) => screenPoint(page, x + 0.5, G + 1, z1 + 0.5);
  const a = await pt(x0 + 1), b = await pt(x0 + 3);
  console.log(`  drag from ${a && a.x.toFixed(0)},${a && a.y.toFixed(0)} to ${b && b.x.toFixed(0)},${b && b.y.toFixed(0)}`);
  if (!a || !b || a.x < 1024 * 0.42) {
    errors.push('[site] building: the front row is not on the right part of the screen');
    await context.close();
    return;
  }
  const cdp = await context.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] : [] });
  await touch('touchStart', a);
  await page.waitForTimeout(700);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12 });
    await page.waitForTimeout(60);
  }
  await settle(page, 900);
  const row = await page.evaluate(({ x0, x1, z1, G }) => {
    const g = window.__game;
    let n = 0;
    for (let x = x0 + 1; x < x1; x++) if (g.debug.getBlock(x, G + 1, z1) === 'planks_pink') n++;
    return n;
  }, { x0, x1, z1, G });
  console.log(`  the drag laid ${row} of the front row's 5 blocks`);
  if (row < 2) errors.push(`[site] building: the hold-and-drag laid ${row} blocks`);
  await grab(page, 'building', { width: 1400, small: 800 });
  await touch('touchEnd', null);
  await context.close();
}

async function sceneIceCream(browser) {
  console.log('icecream');
  const { context, page } = await openPlay(browser);
  await newWorld(page, 'meadow', { seed: 3, name: "Lily's Sweet Street" });
  await page.evaluate(() => { window.__game.debug.shops.setCoins(240); });
  const s = await flatSpot(page, { x0: 30, z0: 30, x1: 90, z1: 90, r: 5 });
  await page.evaluate(({ x, z }) => {
    const g = window.__game, E = g.entities;
    const y = g.world.heightAt(x, z) + 1;
    const e = E.place('ice_cream_parlor', x, y, z, 0, null, {}, { history: false, fx: false });
    g.player.teleport(x + 1.5, y + 0.01, z + 4);
    return !!e;
  }, s);
  await settle(page, 600);
  await page.evaluate(() => window.__game.debug.shops.open('parlor', 'build'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sh-opt[data-style="sundae"]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.sw-panel-wrap.sw-open .sh-opt img[src^="data:"]').length >= 6, null, { timeout: 30000 }).catch(() => {});
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-style="sundae"]').click();
  await settle(page, 500);
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="scoops"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="mint"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="uni"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="tops"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="cherry"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="whipped"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="sauce"]').click();
  await settle(page, 2200);
  // just the sundae, its name and the price (the left card of the builder), on the panel's own pink
  const box = await page.locator('.sw-panel-wrap.sw-open .sh-left').boundingBox();
  if (box) {
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sw-panel-wrap.sw-open .sw-card') || document.body).backgroundColor);
    await grab(page, 'icecream', { clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) }, width: 640, pad: 22, bg: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#FFF8FC', q: 0.86 });
  }
  else errors.push('[site] icecream: no sundae card');
  await context.close();
}

async function sceneCode(browser) {
  console.log('code');
  const host = await openPlay(browser, { viewport: { width: 1280, height: 800 }, name: 'Lily' });
  const hp = host.page;
  await hp.waitForSelector('button.sw-title-friends:not([hidden])', { timeout: 15000 });
  await newWorld(hp, 'meadow', { seed: 21, name: "Lily's Rainbow Meadow", time: 0.38 });
  // a cottage in front of her, so the knock card has something pretty behind it
  const hs = await hp.evaluate(() => { const p = window.__game.player.position; return { x: Math.floor(p.x), z: Math.floor(p.z) }; });
  await hp.evaluate(({ x, z }) => {
    const g = window.__game;
    g.prefabs.place('cottage', x, z - 16, { rot: 0 });
    g.cameraRig.yaw = Math.PI;
    g.cameraRig.pitch = 0.12;
  }, hs);
  await waitIdle(hp);
  await hp.locator('.sw-hud-tr button[aria-label="Menu"]').click();
  await hp.waitForSelector('.sw-panel-wrap.sw-open .sw-pause-invite');
  await settle(hp, 600);
  await hp.locator('.sw-panel-wrap.sw-open .sw-pause-invite').click();
  await hp.waitForSelector('.sw-panel-wrap.sw-open .sw-net-code-tiles:not(.sw-wait) .sw-net-tile[data-pic]', { timeout: 30000 });
  await settle(hp, 1500);
  const code = await hp.$$eval('.sw-panel-wrap.sw-open .sw-net-code-tiles .sw-net-tile[data-pic]', (els) => els.map((e) => e.dataset.pic));
  console.log(`  code: ${code.join(' ')}`);

  // the guest on a phone types it
  const guest = await openPlay(browser, { viewport: { width: 390, height: 844 }, touch: true, name: 'Mia', look: null });
  const gp = guest.page;
  await gp.evaluate(() => {
    const g = window.__game;
    const look = g.debug.avatar.random(47);
    look.name = 'Mia';
    g.profile.look = look;
    g.saveProfile(true);
    g.events.emit('avatar:changed', { look });
  });
  // (a click event: with two software-rendered games at once, a real touch can take too long
  // to be answered; every one of these buttons acts on click)
  const press = (loc) => loc.dispatchEvent('click');
  await gp.waitForSelector('button.sw-title-friends:not([hidden])', { timeout: 15000 });
  await press(gp.locator('button.sw-title-friends'));
  await gp.waitForSelector('.sw-panel-wrap.sw-open .sw-net-join');
  await press(gp.locator('.sw-panel-wrap.sw-open .sw-net-join'));
  await gp.waitForSelector('.sw-panel-wrap.sw-open .sw-net-keypad:not([hidden])');
  for (let k = 0; k < 3; k++) await press(gp.locator(`.sw-panel-wrap.sw-open .sw-net-key[data-pic="${code[k]}"]`));
  await settle(gp, 900);
  await grab(gp, 'code-keypad', { width: 780 });
  await press(gp.locator(`.sw-panel-wrap.sw-open .sw-net-key[data-pic="${code[3]}"]`));
  await press(gp.locator('.sw-panel-wrap.sw-open .sw-net-go'));
  // the knock card on Lily's screen
  const card = hp.locator('.sw-net-knock', { hasText: 'Mia' });
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await settle(hp, 1400);
  // only the card: everything else hidden, its corners on white, with even padding around it
  await hp.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'html, body { background: transparent !important; } body * { visibility: hidden !important; } ' +
      '.sw-net-knock, .sw-net-knock * { visibility: visible !important; } .sw-net-knock { box-shadow: 0 0 0 4px var(--sw-pink) !important; animation: none !important; }';
    document.head.appendChild(s);
  });
  await settle(hp, 700);
  const cb = await card.boundingBox();
  if (cb) {
    // the pink ring is a 4 px box-shadow around the card
    const clip = { x: Math.floor(cb.x) - 5, y: Math.floor(cb.y) - 5, width: Math.ceil(cb.width) + 11, height: Math.ceil(cb.height) + 11 };
    await grab(hp, 'code-knock-card', { clip, width: 1100, pad: 36, bg: '#FFFFFF', omitBackground: true });
  }
  await host.context.close();
  await guest.context.close();
}

function pad(b, n, page) {
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - n), y = Math.max(0, b.y - n);
  return { x, y, width: Math.min(vp.width - x, b.width + 2 * n), height: Math.min(vp.height - y, b.height + 2 * n) };
}

// the stickers shown in the page's Sticker Book section
const SITE_STICKERS = ['magic_builder', 'sweet_dreams', 'unicorn_rider', 'fashionista', 'little_chef', 'green_thumb', 'zip_zoom', 'smores_star', 'sleepover', 'night_owl', 'gem_hunter', 'splash'];

async function sceneTiles(browser) {
  console.log('tiles');
  const { context, page } = await openPlay(browser);
  // the block textures the page uses (hero island, block strip, closing blocks)
  const keys = ['cotton_candy', 'crystal_pink', 'dirt', 'frosting_pink', 'gem_blue', 'gem_pink', 'gift_side', 'gift_top', 'glass_heart', 'glitter_gold', 'grass_side', 'grass_top', 'jelly_blue', 'lamp_block', 'leaves_cherry', 'log_cherry_side', 'music_block', 'planks_pink', 'rainbow', 'roof_pink', 'star_block', 'wallpaper_hearts'];
  const tiles = await page.evaluate((keys) => {
    const B = window.__game.registry.blocks;
    return keys.map((k) => {
      try {
        const c = B.tileCanvas(k);
        return c ? [k, c.toDataURL('image/png')] : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
  }, keys);
  await mkdir(path.join(OUT, 'tiles'), { recursive: true });
  for (const [k, url] of tiles) await writeFile(path.join(OUT, 'tiles', `${k}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log(`  ${tiles.length} tiles -> site/img/tiles/`);
  // the game's own die-cut sticker art (Sticker Book), 240 px WebP with alpha
  const stickers = await page.evaluate((SITE_STICKERS) => {
    const g = window.__game;
    return [...g.registry.stickers.keys()].filter((id) => SITE_STICKERS.includes(id)).map((id) => {
      const d = g.registry.stickers.get(id);
      return { id, name: d.name, hint: d.hint, url: g.stickers.image(id, { size: 240 }) };
    });
  }, SITE_STICKERS);
  await mkdir(path.join(OUT, 'stickers'), { recursive: true });
  for (const s of stickers) {
    const url = await encoder.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.9);
    }, s.url);
    await writeFile(path.join(OUT, 'stickers', `${s.id}.webp`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  }
  console.log(`  ${stickers.length} stickers -> site/img/stickers/: ${stickers.map((s) => `${s.id} "${s.name}" (${s.hint})`).join('; ')}`);
  await context.close();
}

// ---------------------------------------------------------------- phone sizes, share picture, icon

// the pictures that get an 800 px wide copy for phones (srcset)
const SMALL = ['title', 'building', 'camper', 'camper-inside', 'bedroom', 'night', 'studio', 'pets', 'unicorn', 'friends', 'zip'];

/** Make <name>-800.webp for every SMALL picture that has none yet (or all, with --force-small). */
async function sceneSmall() {
  console.log('small');
  const { readFile, stat } = await import('node:fs/promises');
  for (const name of SMALL) {
    const src = path.join(OUT, `${name}.webp`);
    const dst = path.join(OUT, `${name}-800.webp`);
    const have = await stat(dst).then((d) => d, () => null);
    const from = await stat(src).then((d) => d, () => null);
    if (!from) continue;
    if (have && have.mtimeMs >= from.mtimeMs && !arg('force-small')) continue;
    const data = 'data:image/webp;base64,' + (await readFile(src)).toString('base64');
    await save(`${name}-800`, await encode(data, { width: 800, q: 0.82 }));
  }
}

/**
 * The link preview (img/share.jpg, 1200x630) and the home-screen icon (img/icon-180.png), both
 * from the built home page itself: the headline, the real title screen and the floating island.
 */
async function sceneShare(browser) {
  console.log('share');
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, 'share');
  await page.goto(`${base}/`);
  await page.evaluate(() => document.fonts.ready);
  // the hero as a 1200x630 card: the headline, the real title screen, the island, the ground
  const still = '.dio-world, .dio-shadow, .bob, .cloud { animation-play-state: paused !important; animation-delay: 0s !important; }';
  await page.addStyleTag({ content: [
    // (header.top: the island's top faces are .f.top too)
    'header.top, .skip, .lede, .cta-row, .facts { display: none !important; }',
    '.hero { height: 630px; padding-top: 44px; }',
    '.hero-grid { padding-bottom: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); align-items: start; }',
    '.hero h1 { font-size: 74px; margin-top: 8px; }',
    '.hero-art { padding-top: 26px; }',
    '.hero > .ground { position: absolute; left: 0; right: 0; bottom: 0; }',
    '.dio { --u: 27px; left: calc(var(--u) * -3); bottom: calc(var(--u) * -6.3); }',
    '.cloud { opacity: .55; }',
    still,
  ].join('\n') });
  await page.waitForFunction(() => [...document.querySelectorAll('.hero img')].every((i) => i.complete && i.naturalWidth > 0));
  await settle(page, 600);
  await grab(page, 'share', { clip: { x: 0, y: 0, width: 1200, height: 630 }, width: 1200, q: 0.86, type: 'jpeg' });
  // the island alone, on the game's sky, for Add to Home Screen
  await page.addStyleTag({ content: 'html, body, .hero { background: transparent !important; } body * { visibility: hidden !important; } .dio, .dio * { visibility: visible !important; } .dio-shadow { visibility: hidden !important; }' });
  await settle(page, 300);
  const box = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('.dio .f')].map((f) => f.getBoundingClientRect()).filter((r) => r.width);
    const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top));
    const x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
    return { x0, y0, x1, y1 };
  });
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 8;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: cx - side / 2, y: cy - side / 2, width: side, height: side } });
  await save('icon-180', await encode(png, { width: 180, height: 180, pad: 14, bg: '#BDE6FF', type: 'png' }), 'png');
  await context.close();
}

// ---------------------------------------------------------------- main

async function main() {
  if (!arg('no-build')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const app = createServer({ log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  base = `http://localhost:${port}`;
  console.log(`server: ${base} (game at /play)`);
  const browser = await launch();
  try {
    encoder = await (await browser.newContext()).newPage();
    if (want('tiles')) await sceneTiles(browser);
    if (want('title')) await sceneTitle(browser);
    if (want('studio')) await sceneStudio(browser);
    await meadowScenes(browser);
    if (want('building')) await sceneBuilding(browser);
    if (want('worlds') || want('world-candy')) await sceneCandy(browser);
    if (want('worlds') || want('world-flat')) await sceneFlatTown(browser);
    if (want('worlds') || want('world-fairy')) await sceneFairy(browser);
    if (want('fairy-dusk')) await sceneFairy(browser, { time: 0.77, name: 'world-fairy-dusk' });
    if (want('worlds') || want('world-beach')) await sceneBiome(browser, 'beach', { name: "Lily's Beach Island", time: 0.42, view: (c, sy, i) => [[c + 10, sy + 12, i.sz - 6], [c, sy - 3, c + 8]] });
    if (want('worlds') || want('world-snow')) await sceneBiome(browser, 'snow', { name: "Lily's Snowy Wonderland", time: 0.42, weather: 'snow' });
    if (want('worlds') || want('world-mix')) await sceneBiome(browser, 'mix', { name: "Lily's Everything Land", time: 0.4 });
    if (want('worlds') || want('world-meadow')) await sceneBiome(browser, 'meadow', { name: "Lily's Flower Meadow", time: 0.4, seed: 7 });
    if (want('icecream')) await sceneIceCream(browser);
    if (want('code')) await sceneCode(browser);
    if (want('small')) await sceneSmall();
    if (want('share')) await sceneShare(browser);
  } finally {
    await browser.close();
    await app.close();
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`\n${Object.keys(sizes).length} pictures, ${(total / 1024).toFixed(0)} KB this run`);
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):`);
    for (const e of errors) console.error(' - ' + e);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
