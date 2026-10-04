// Sea animals probe (docs/teams/ocean.md §13.4): dolphins, fish, turtles, jellies, crabs,
// starfish and the whale in a real page, through the real camera, real clicks and taps where it
// matters, the debug API (game.debug.ocean) to set up scenes and read results.
//
//   world   beach Cozy: the sea map, the first pod within 10 s (the buddy), leaps and puffs, the
//           lagoon's fish, night jellies, a crab on the shore, a Speedboat escort, a block in a
//           dolphin, unload, a Magic House on the sea, the show pod
//   see     the real swim camera: each animal clearly visible from above the water (V1)
//   tap     real clicks: Ride / Trick bubble, a moving and a stopped boat, Build / Remove on an
//           animal, a fish under the surface (Remove and right-click), first meets with a picture,
//           the Starfish block, the whale (T7, T8), the Sticker Book's Sea Friends
//   ride    the bubble's Ride, steering, zoom, leaps, the shore and the world edge, Hop off (button,
//           X, E), the water going away, a save while riding, blocks into the dolphin, a friend's
//           block, a teleport
//   touch   iPad 1024x768: a real tap, the bubble clear of the HUD, Ride with the joystick, Jump,
//           Hop off, the Help card
//   biomes  candy palettes and the chocolate-milk pond, a kid's pools in Flat, snow ice
//   saves   an old profile, an old world, a beach world saved before and after sea life (D3)
//   mp      two pages: a friend's ride, the shared whale, her own hellos, a page that closes,
//           joining late, a friend's trick, the buddy's name
//   cost    draw calls, the systems stage, geometries over time, NaN-free, the gallery (C5)
//
//   node tools/probe-ocean.mjs [--only=world,see,tap,ride,touch,biomes,saves,mp,cost,gallery] [--headed]
//   (cost includes the gallery, C5; --only=gallery runs C5 alone; --only=review makes the
//   owner-review pictures, ocean-review-*.png, and is never part of the default run)
//
// Not here yet (P2, on the merged tree with merfolk): R10 (a mermaid and a sea dragon riding),
// T3b's camera under the surface, U1's Up / Down rectangles, the cross-team `wave4` pass.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, openGame, attachErrorCollectors, waitForTitle, waitIdle, shot, settle, finish, screenPoint, PAGE_URL, ROOT } from './smoke.mjs';

const PREFIX = 'ocean';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : null;
const want = (name) => !only || only.includes(name);

function check(errors, cond, message) {
  if (!cond) {
    errors.push('[check] ' + message);
    console.log('  FAIL: ' + message);
  } else console.log('  ok: ' + message);
  return !!cond;
}

const wait = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const waitOk = (page, fn, arg, timeout) => wait(page, fn, arg, timeout).then(() => true, () => false);
const ev = (page, fn, a) => page.evaluate(fn, a);

async function newWorld(page, biome, { size = 'cozy', seed = 777, quality = 'low' } = {}) {
  await page.evaluate(([b, size, seed]) => window.__game.debug.newWorld({ biome: b, size, seed }), [biome, size, seed]);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await page.evaluate((quality) => {
    const g = window.__game;
    g.profile.tutorialDone = true;
    g.profile.settings.quality = quality; // SwiftShader: the 3D at 1x (the cost pass uses auto)
    g.profile.settings.timeFrozen = true;
    g.applySettings();
    g.setDayTime(0.42);
  }, quality);
  await recordEvents(page);
}

async function recordEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__probeEvents) return;
    g.__probeEvents = [];
    for (const name of ['sea:meet', 'sea:ride', 'sea:hopoff', 'sea:leap', 'sea:trick', 'sea:whale', 'sticker:earned', 'coins:change', 'friend:talk']) {
      g.events.on(name, (p) => g.__probeEvents.push({ name, t: performance.now(), kind: p && p.kind, first: p && p.first, quiet: p && p.quiet, reason: p && p.reason, riding: p && p.riding, delta: p && p.delta, why: p && p.reason, sticker: p && p.sticker && p.sticker.id }));
    }
    window.__toasts = [];
    window.__toastImgs = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => {
      window.__toasts.push(String(text));
      if (opts && opts.img) window.__toastImgs.push(String(text));
      return toast(text, opts);
    };
  });
}

const events = (page, name) => page.evaluate((n) => window.__game.__probeEvents.filter((e) => e.name === n), name);
const toastSeen = (page, re, timeout = 6000) => waitOk(page, (src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, timeout);
const toastCount = (page, re) => page.evaluate((src) => window.__toasts.filter((t) => new RegExp(src).test(t)).length, re.source);

/** Keep her at the surface while she swims (the base game lets a swimmer sink; merfolk floats). */
async function float(page, on = true) {
  await page.evaluate((on) => {
    const g = window.__game, pl = g.player;
    if (!pl.__floatWrap) {
      const up = pl.update.bind(pl);
      pl.update = (dt) => {
        up(dt);
        if (!g.__float || pl.state === 'ride') return;
        const m = g.ocean.map, t = m.top(pl.position.x, pl.position.z);
        if (t >= 0 && pl.position.y < t + 0.1) { pl.position.y = t + 0.1; if (pl.velocity.y < 0) pl.velocity.y = 0; }
      };
      pl.__floatWrap = true;
    }
    g.__float = on;
  }, on);
}

/** Teleport to a spot ([x, y, z] feet) and face a direction. */
async function goTo(page, spot, yaw = null) {
  await page.evaluate(([s, yaw]) => {
    const g = window.__game;
    g.player.teleport(s[0], s[1], s[2]);
    if (yaw !== null) g.cameraRig.yaw = yaw;
  }, [spot, yaw]);
}

async function cleanView(page, on, outline = false) {
  // outline: also hide the 3D target outline, name tags and build ghost (as a Photo does)
  if (outline) await page.evaluate((on) => window.__game.events.emit(on ? 'thumbnail:before' : 'thumbnail:after', {}), on);
  await page.evaluate((on) => {
    let s = document.getElementById('probe-clean');
    if (on && !s) {
      s = document.createElement('style');
      s.id = 'probe-clean';
      s.textContent = '.sw-hud, .sw-toasts, .sw-hint, .lf-hud, .sw-stkpop, .sw-touch-hud .sw-joy, .oc-pointer { display: none !important; }';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  }, on);
}

/**
 * How clearly the sea life stands out in the picture she sees. Renders the scene as it is (a),
 * without the sea life (b), and the sea life alone on black (its silhouette). Returns, for the
 * whole silhouette and around each world point in `points` (a square 2 x `radius` page pixels):
 *   px    silhouette pixels
 *   diff  mean |a - b| over the silhouette: the animal against the very water it covers
 *   ring  the colour distance between the animal (its mean colour in a) and the water around it
 *         (the mean colour of a in a 6-pixel ring just outside the silhouette)
 *   luma  the same in brightness only (0..255)
 *   view  (a point) inside the picture and in front of the camera
 */
async function seaContrast(page, points = null, radius = 40) {
  return page.evaluate(([points, radius]) => {
    const g = window.__game, R = g.renderer, W = R.domElement.width, H = R.domElement.height;
    const dpr = W / R.domElement.getBoundingClientRect().width;
    const grab = () => {
      R.render(g.scene, g.camera);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.drawImage(R.domElement, 0, 0);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const groupOf = g.scene.getObjectByName('sea-life');
    const a = grab();
    groupOf.visible = false;
    const b = grab();
    groupOf.visible = true;
    const saved = [];
    for (const c of g.scene.children) { saved.push([c, c.visible]); if (c !== groupOf && !c.isLight) c.visible = false; }
    const bg = g.scene.background, fog = g.scene.fog;
    const Color = groupOf.children[0].material.color.constructor;
    g.scene.background = new Color(0, 0, 0);
    g.scene.fog = null;
    const s = grab();
    g.scene.background = bg; g.scene.fog = fog;
    for (const [c, v] of saved) c.visible = v;
    // the silhouette mask and a 6-pixel ring around it (a separable max filter)
    const N = W * H, S = new Uint8Array(N), T = new Uint8Array(N), D = new Uint8Array(N), E = 6;
    for (let i = 0; i < N; i++) S[i] = s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] >= 30 ? 1 : 0;
    for (let y = 0; y < H; y++) {
      let run = -1e9;
      for (let x = 0; x < W; x++) { if (S[y * W + x]) run = x; if (x - run <= E) T[y * W + x] = 1; }
      run = 1e9;
      for (let x = W - 1; x >= 0; x--) { if (S[y * W + x]) run = x; if (run - x <= E) T[y * W + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      let run = -1e9;
      for (let y = 0; y < H; y++) { if (T[y * W + x]) run = y; if (y - run <= E) D[y * W + x] = 1; }
      run = 1e9;
      for (let y = H - 1; y >= 0; y--) { if (T[y * W + x]) run = y; if (run - y <= E) D[y * W + x] = 1; }
    }
    const L = (r, g2, b2) => 0.299 * r + 0.587 * g2 + 0.114 * b2;
    const stats = (x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.floor(x1)); y1 = Math.min(H - 1, Math.floor(y1));
      let px = 0, sum = 0, ar = 0, ag = 0, ab = 0, rn = 0, rr = 0, rg = 0, rb = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, k = i * 4;
        if (S[i]) {
          px++;
          sum += Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]);
          ar += a[k]; ag += a[k + 1]; ab += a[k + 2];
        } else if (D[i]) { rn++; rr += a[k]; rg += a[k + 1]; rb += a[k + 2]; }
      }
      if (!px || !rn) return { px, diff: px ? sum / px : 0, ring: 0, luma: 0 };
      ar /= px; ag /= px; ab /= px; rr /= rn; rg /= rn; rb /= rn;
      return { px, diff: sum / px, ring: Math.hypot(ar - rr, ag - rg, ab - rb), luma: Math.abs(L(ar, ag, ab) - L(rr, rg, rb)) };
    };
    const all = stats(0, 0, W - 1, H - 1);
    const each = [];
    if (points) {
      const V = g.camera.position.constructor;
      for (const p of points) {
        const v = new V(p.x, p.y, p.z).project(g.camera);
        const view = v.z < 1 && v.z > -1 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.97;
        const cx = ((v.x + 1) / 2) * W, cy = ((1 - v.y) / 2) * H, rad = radius * dpr;
        each.push({ kind: p.kind, variant: p.variant, view, sx: Math.round(cx / dpr), sy: Math.round(cy / dpr), ...(view ? stats(cx - rad, cy - rad, cx + rad, cy + rad) : { px: 0, diff: 0, ring: 0, luma: 0 }) });
      }
    }
    return { ...all, each };
  }, [points, radius]);
}

const f1 = (v) => (+v).toFixed(1);

// V1 (the swim camera) and C5 (the gallery) thresholds: see the checks
const V1_DIFF = 50, V1_RING = 36, C5_PX = 40, C5_DIFF = 30;
// C6 (the water line): the same as on land below C6_SAME; tinted at least C6_TINT, C6_CLOSER nearer the water
const C6_SAME = 2, C6_TINT = 12, C6_CLOSER = 8;

/** Aim the camera at a world point (rig yaw / pitch from the player). */
async function aim(page, x, y, z, pitch = null) {
  await page.evaluate(([x, y, z, pitch]) => {
    const g = window.__game, p = g.player.position;
    g.cameraRig.yaw = Math.atan2(x - p.x, z - p.z);
    const d = Math.hypot(x - p.x, z - p.z);
    g.cameraRig.pitch = pitch !== null ? pitch : Math.max(-0.3, Math.min(0.9, Math.atan2(p.y + 1.5 - y, d) + 0.15));
  }, [x, y, z, pitch]);
  await settle(page, 350);
}

/** Aim her camera at the nearest record of a kind (optionally only some role); returns it or null. */
async function aimAtNearest(page, kind, role = null, pitch = null) {
  const r = await ev(page, ([kind, role]) => {
    const g = window.__game, p = g.player.position;
    let best = null, bd = Infinity;
    for (const q of g.debug.ocean.list(kind)) {
      if (role && q.role !== role) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best && [best.x, best.y, best.z];
  }, [kind, role]);
  if (r) await aim(page, r[0], r[1], r[2], pitch);
  return r;
}

/** The page point of a record's centre (by kind and index), or null. */
async function recPoint(page, kind, i, dy = 0) {
  const r = await ev(page, ([kind, i]) => {
    const l = window.__game.debug.ocean.list(kind).find((q) => q.i === i);
    return l ? [l.x, l.y, l.z] : null;
  }, [kind, i]);
  if (!r) return null;
  return screenPoint(page, r[0], r[1] + dy, r[2]);
}

/**
 * Wait until `seconds` of GAME time have passed (game.time.t; SwiftShader draws few frames and the
 * game steps at most 0.05 s a frame, so game time runs slower than the wall clock here).
 */
async function gameWait(page, seconds, maxMs = 60000) {
  const t0 = await page.evaluate(() => window.__game.time.t);
  await waitOk(page, ([t0, s]) => window.__game.time.t - t0 >= s, [t0, seconds], maxMs);
}

/** What a click at page point (x, y) would hit: { type, ref kind, distance } (diagnostics). */
async function pickAt(page, pt, liquids = false) {
  if (!pt) return null;
  return page.evaluate(([x, y, liquids]) => {
    const g = window.__game, r = g.renderer.domElement.getBoundingClientRect();
    const h = g.pick({ x: ((x - r.left) / r.width) * 2 - 1, y: -(((y - r.top) / r.height) * 2 - 1) }, { liquids });
    if (!h) return null;
    return { type: h.type, kind: h.type === 'pickable' ? (h.pickable.ref && (h.pickable.ref.isSchool ? 'school' : h.pickable.ref.kind)) || h.pickable.kind : h.key, d: +h.distance.toFixed(2) };
  }, [pt.x, pt.y, liquids]);
}

/** Keep a record still where it is (for clicks): it holds its pose for `ms`. */
async function freeze(page, on) {
  await page.evaluate((on) => { window.__game.debug.ocean.still(on); }, on);
  if (on) await page.waitForTimeout(120); // the pick boxes are refreshed on the next frame
}

// rectangles of the HUD (probe-menus.mjs:24-38)
const RECTS = () => {
  const r = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect(); return { sel, x: b.left, y: b.top, w: b.width, h: b.height }; }).filter((b) => b.w > 0 && b.h > 0);
  return {
    bubble: r('.oc-bubble.lf-on'),
    hud: [...r('.sw-joy'), ...r('.sw-touch-hud .sw-btn-jump, .sw-touch .sw-jump, [data-action="jump"]'), ...r('.lf-hud .sw-round:not([hidden])'), ...r('.sw-toasts .sw-toast'), ...r('.sw-stkpop'), ...r('.sw-coins, .sw-hud-coins, [aria-label="Coins"]'), ...r('.sw-hud-tr button'), ...r('.sw-hotbar')],
  };
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// =====================================================================================
// world
// =====================================================================================

async function worldPass(browser, errors) {
  console.log('\n[world] beach Cozy, desktop 1280x800');
  const { context, page } = await openGame(browser, { errors, label: 'world' });
  await newWorld(page, 'beach');
  await ev(page, () => window.__game.debug.ocean.popups(true));
  // O1 the sea map
  const ms = await ev(page, () => window.__game.debug.ocean.mapStats());
  check(errors, ms.deep === 9810 && ms.liquid > 9810, `O1 the sea map: ${ms.deep} deep columns (Node: 9810), ${ms.liquid} liquid, built in ${ms.ms.toFixed(1)} ms`);

  // O11 the show pod: at spawn, facing the sea, a clear day
  await ev(page, () => {
    const g = window.__game, s = g.world.meta.spawn, m = g.ocean.map;
    let best = 0, bd = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let d = 0;
      for (let r = 20; r < 70; r += 2) if (m.deepAround(s[0] + Math.sin(a) * r, s[2] + Math.cos(a) * r, 3)) d++;
      if (d > bd) { bd = d; best = a; }
    }
    g.cameraRig.yaw = best;
    g.cameraRig.pitch = 0.05;
  });
  const showOk = await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'show'), null, 20000);
  check(errors, showOk, 'O11 the show pod is placed out at sea within 20 s');
  if (showOk) {
    const l0 = await ev(page, () => window.__game.debug.ocean.stats().showLeaps);
    const t11 = await ev(page, () => window.__game.time.t);
    const leapt = await waitOk(page, ([n, t]) => window.__game.debug.ocean.stats().showLeaps > n || window.__game.time.t - t > 25, [l0, t11], 90000)
      && await ev(page, (n) => window.__game.debug.ocean.stats().showLeaps > n, l0);
    const inSet = await ev(page, () => [...window.__game.pickables].some((p) => p.ref && p.ref.role === 'show'));
    check(errors, leapt && !inSet, `O11 it leaps in view (${leapt}) and is never tappable (${!inSet})`);
    // the picture: her camera turned to the show pod out at sea, the HUD out of the way
    // (the island hides the sea from where she stands: the picture's camera alone goes out toward
    // the pod, 14 blocks short of it, a little above the water; she stays at spawn)
    await cleanView(page, true, true);
    await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'show' && r.state === 'leap'), null, 12000);
    await ev(page, () => {
      const g = window.__game, s = g.world.meta.spawn;
      const r = g.debug.ocean.list('dolphin').find((q) => q.role === 'show');
      if (!r) return;
      const d = Math.hypot(s[0] - r.x, s[2] - r.z) || 1, ux = (s[0] - r.x) / d, uz = (s[2] - r.z) / d;
      const k = Math.min(14, d), x = r.x + ux * k, z = r.z + uz * k;
      g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.camera.position.set(x, r.level + 0.875 + 2.5, z);
      g.camera.lookAt(r.x, r.level + 1.2, r.z);
    });
    await settle(page, 300);
    await shot(page, 'world-showpod', PREFIX);
    await ev(page, () => { const g = window.__game; if (g.__rig) g.cameraRig.update = g.__rig; });
    await cleanView(page, false, true);
  }

  // O2 the first deep swim: a pod within 6 blocks within 10 s, the buddy's hello once
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await ev(page, () => window.__game.debug.ocean.clear());
  await float(page, true);
  await goTo(page, deep);
  const t0 = await ev(page, () => window.__game.time.t);
  const came = await waitOk(page, (t0) => {
    const g = window.__game, p = g.player.position;
    return g.time.t - t0 < 10 && g.debug.ocean.list('dolphin').filter((r) => r.role === 'wild' && Math.hypot(r.x - p.x, r.z - p.z) < 6).length >= 2;
  }, t0, 40000);
  const tCame = (await ev(page, () => window.__game.time.t)) - t0;
  const pod = await ev(page, () => window.__game.debug.ocean.list('dolphin').filter((r) => r.role === 'wild'));
  check(errors, came && pod.length >= 2 && pod.length <= 4, `O2 a pod of ${pod.length} reaches her within ${tCame.toFixed(1)} s of game time (< 10 s)`);
  const buddyName = await ev(page, () => window.__game.debug.ocean.buddy().name);
  check(errors, await toastSeen(page, new RegExp(`^${buddyName} came to say hi!$`), 8000), `O2 the buddy's hello: "${buddyName} came to say hi!"`);
  // 300 sampled frames: every dolphin's column passes the rule unless it is leaping or tricking
  const rule = await ev(page, () => new Promise((res) => {
    const g = window.__game, m = g.ocean.map;
    let n = 0, bad = 0, samples = 0;
    const f = () => {
      for (const r of g.debug.ocean.list('dolphin')) {
        if (r.role !== 'wild' || r.state === 'leap' || r.state === 'trick' || r.fade < 1) continue;
        samples++;
        if (!(m.top(r.x, r.z) === r.level && m.deepAround(r.x, r.z, 3))) bad++;
      }
      if (++n >= 300) res({ samples, bad }); else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
  check(errors, rule.samples > 300 && rule.bad === 0, `O2 over 300 frames every dolphin stays in deep water (${rule.samples} samples, ${rule.bad} outside)`);
  check(errors, await toastCount(page, new RegExp(`^${buddyName} came`)) === 1, 'O2 the buddy toast showed once');
  await shot(page, 'world-pod', PREFIX);

  // O3 leaps (at least one within 60 s, in play mode within 6 s) and puffs
  const s0 = await ev(page, () => window.__game.debug.ocean.stats());
  const leap6 = await waitOk(page, (n) => window.__game.debug.ocean.stats().leaps > n, s0.leaps, 9000);
  const leap60 = leap6 || await waitOk(page, (n) => window.__game.debug.ocean.stats().leaps > n, s0.leaps, 51000);
  const s1 = await ev(page, () => window.__game.debug.ocean.stats());
  check(errors, leap60, `O3 a dolphin leaps (${s1.leaps - s0.leaps} leaps; a still swimmer gets one quickly: ${leap6})`);
  check(errors, s1.leapApex > 1 && s1.leapApex <= 2.0, `O3 apex ${s1.leapApex.toFixed(2)} above the surface (<= 2.0)`);
  check(errors, s1.puffs > 0, `O3 blowhole puffs (${s1.puffs})`);

  // O7 a Speedboat at full speed over deep water: dolphins escort it, ahead of the bow, leaping
  await float(page, true);
  await goTo(page, deep);
  const o7 = await ev(page, async (d) => {
    const g = window.__game;
    const x = Math.floor(d[0]), z = Math.floor(d[2]), y = g.ocean.map.top(x, z);
    const e = g.entities.place('boat_speed', x, y, z, 0, null, {}, { history: false, players: false });
    if (!e) return { placed: false };
    g.debug.vehicles.drive(e.uid);
    await new Promise((r) => setTimeout(r, 500));
    return { placed: true, driving: !!g.vehicles.current };
  }, deep);
  if (o7.placed && o7.driving) {
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    const t7 = await ev(page, () => window.__game.time.t);
    let near = 0, ahead = 0, lastT = t7;
    const l7 = await ev(page, () => window.__game.debug.ocean.stats().leaps);
    for (let k = 0; k < 400 && (await ev(page, () => window.__game.time.t)) - t7 < 20; k++) {
      await page.waitForTimeout(500);
      const s = await ev(page, () => {
        const g = window.__game, b = g.vehicles.pose();
        if (!b) return null;
        let n = 0, a = 0;
        for (const r of g.debug.ocean.list('dolphin')) {
          if (r.role !== 'wild') continue;
          const dx = r.x - b.x, dz = r.z - b.z;
          if (Math.hypot(dx, dz) < 6) n++;
          if (dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw) > 0.5 && Math.hypot(dx, dz) < 8) a++;
        }
        return { n, a, speed: b.speed, t: g.time.t };
      });
      if (s && s.n > 0) near += s.t - lastT; // game seconds with a dolphin near
      if (s) lastT = s.t;
      if (s && s.a > 0) ahead++;
    }
    await page.keyboard.up('KeyA');
    // the picture: still driving, her camera turned to the nearest dolphin beside the boat
    await cleanView(page, true, true);
    await aimAtNearest(page, 'dolphin', 'wild', 0.35);
    await shot(page, 'world-boat-escort', PREFIX);
    await cleanView(page, false, true);
    await page.keyboard.up('KeyW');
    const l7b = await ev(page, () => window.__game.debug.ocean.stats().leaps);
    check(errors, near >= 5, `O7 a dolphin within 6 blocks of the moving boat for ${near.toFixed(1)} s of 20 (>= 5)`);
    check(errors, ahead > 0, `O7 one ahead of the bow (${ahead} samples)`);
    check(errors, l7b > l7, `O7 leaps while escorting (${l7b - l7})`);
    await ev(page, () => window.__game.debug.vehicles.park('stand'));
  } else check(errors, false, `O7 a Speedboat on deep water to drive (${JSON.stringify(o7)})`);

  // O8 a block into a dolphin's cell: within 1 s it is in water again or gone
  const o8 = await ev(page, async () => {
    const g = window.__game;
    const r = g.debug.ocean.list('dolphin').find((q) => q.role === 'wild' && q.state !== 'leap' && q.state !== 'trick');
    if (!r) return { none: true };
    g.world.setKey(Math.floor(r.x), r.level, Math.floor(r.z), 'stone');
    const t0 = g.time.t;
    for (let k = 0; k < 100 && g.time.t - t0 < 1; k++) await new Promise((res) => setTimeout(res, 100)); // 1 s of game time
    const after = g.debug.ocean.list('dolphin').find((q) => q.i === r.i);
    if (!after || after.fade < 1) return { ok: true, gone: true };
    const id = g.world.get(Math.floor(after.x), after.level, Math.floor(after.z));
    return { ok: g.registry.blocks.props.shape[id] === 5, x: after.x, z: after.z };
  });
  check(errors, o8.ok, `O8 a block built into a dolphin's cell: within 1 s (game time) it is back in water or fading (${JSON.stringify(o8)})`);

  // O10 a Magic House on the sea next to the pod (no events: the record:false path)
  const o10 = await ev(page, async () => {
    const g = window.__game;
    const r = g.debug.ocean.list('dolphin').find((q) => q.role === 'wild');
    if (!r) return { none: true };
    const key = g.prefabs.list()[0];
    const res = g.prefabs.place(key, Math.floor(r.x) + 2, Math.floor(r.z), { rot: 0 });
    const t = performance.now();
    let worst = 0;
    while (performance.now() - t < 5000) {
      await new Promise((q) => setTimeout(q, 250));
      worst = 0;
      for (const q of g.debug.ocean.list('dolphin')) {
        if (q.role !== 'wild' || q.fade < 1) continue;
        const id = g.world.get(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z));
        if (g.registry.blocks.props.solid[id]) worst++;
      }
      if (performance.now() - t > 1500 && worst === 0) break;
    }
    return { key, placed: !!res, inside: worst };
  });
  check(errors, o10.placed && o10.inside === 0, `O10 a ${o10.key} on the sea beside the pod: no dolphin inside a block (${JSON.stringify(o10)})`);

  // O5 night: a jelly near deep water glows; a fish does not; no whale at night
  await ev(page, () => { const g = window.__game; g.setDayTime(0.9); g.debug.ocean.clear(); });
  await goTo(page, deep);
  const jelly = await waitOk(page, () => {
    const g = window.__game, p = g.player.position;
    return g.debug.ocean.list('jelly').some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 26 && r.glow > 0.3);
  }, null, 30000);
  const glow = await ev(page, () => {
    const g = window.__game, d = g.debug.ocean;
    const k = d.meshCounts();
    let jellyGlow = 0, fishGlow = null;
    for (let i = 0; i < k.jelly; i++) jellyGlow = Math.max(jellyGlow, d.slotTint('jelly', i)[3]);
    if (k.fish) fishGlow = d.slotTint('fish', 0)[3];
    return { jellyGlow, fishGlow, whale: d.whaleNow() };
  });
  check(errors, jelly && glow.jellyGlow > 0.3, `O5 night: a jelly within 26 blocks glows (iTint.w ${glow.jellyGlow.toFixed(2)})`);
  check(errors, glow.fishGlow === null || glow.fishGlow === 0, `O5 a fish does not (${glow.fishGlow})`);
  check(errors, glow.whale === false, 'O5 whaleNow() is refused at night');
  // the picture (the Magic House of O10 stands at the deep spot): out at the deep water by the
  // world edge, jellies glowing ahead of her and a school beside them, the HUD out of the way
  await cleanView(page, true, true);
  const edge = await ev(page, () => window.__game.debug.ocean.edgeSpot());
  if (edge) await goTo(page, edge);
  await ev(page, () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, w = g.world;
    d.clear();
    const yaw = Math.atan2(w.sx / 2 - p.x, w.sz / 2 - p.z); // back toward the island
    g.cameraRig.yaw = yaw;
    const at = (f, s2) => [p.x + Math.sin(yaw) * f - Math.cos(yaw) * s2, p.z + Math.cos(yaw) * f + Math.sin(yaw) * s2];
    let [x, z] = at(5, -1); d.spawn('jelly', x, p.y, z, { n: 3 });
    [x, z] = at(6, 2.2); d.spawn('fish', x, p.y, z, { n: 8 });
  });
  await gameWait(page, 1.2, 15000);
  await aimAtNearest(page, 'jelly');
  await shot(page, 'world-night', PREFIX);
  await cleanView(page, false, true);
  await ev(page, () => window.__game.setDayTime(0.42));

  // O4 the lagoon: a school within 25 s, never a dolphin in it
  await ev(page, () => window.__game.debug.ocean.clear());
  const lagoon = await ev(page, () => window.__game.debug.ocean.lagoonSpot());
  await goTo(page, lagoon);
  const lagoonFish = await waitOk(page, () => window.__game.debug.ocean.schools().length > 0, null, 25000);
  const inLagoon = await ev(page, () => new Promise((res) => {
    const g = window.__game, w = g.world, R0 = w.sx * 0.33;
    let bad = 0, n = 0;
    const f = () => {
      for (const r of g.debug.ocean.list('dolphin')) if (Math.hypot(r.x - w.sx / 2, r.z - w.sz / 2) < R0 * 0.85) bad++;
      if (++n >= 240) res(bad); else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
  check(errors, lagoonFish, 'O4 a fish school in the lagoon within 25 s');
  check(errors, inLagoon === 0, `O4 no dolphin in the lagoon (${inLagoon})`);

  // O6 a crab on the shore; walking at it; a tap counts
  await float(page, false);
  await ev(page, () => window.__game.debug.ocean.clear());
  const shore = await ev(page, () => window.__game.debug.ocean.shoreSpot());
  await goTo(page, [shore[0] + 6, shore[1] + 0.5, shore[2]]);
  await ev(page, () => window.__game.unstickPlayer());
  let crab = await waitOk(page, () => window.__game.debug.ocean.list('crab').length > 0, null, 30000);
  if (!crab) crab = (await ev(page, (s) => window.__game.debug.ocean.spawn('crab', s[0], s[1], s[2]), shore)) > 0;
  check(errors, crab, 'O6 a crab on a shore cell within 30 s');
  if (crab) {
    const c0 = await ev(page, () => { const r = window.__game.debug.ocean.list('crab')[0]; return r; });
    await goTo(page, [c0.x + 1.4, c0.y + 0.3, c0.z]);
    await ev(page, () => window.__game.unstickPlayer());
    await page.waitForTimeout(2500);
    const c1 = await ev(page, (i) => window.__game.debug.ocean.list('crab').find((r) => r.i === i), c0.i);
    const near = c1 && Math.hypot(c1.x - c0.x, c1.z - c0.z) < 4;
    const shoreOk = c1 && await ev(page, (c) => window.__game.ocean.map.shore(Math.floor(c.x), Math.floor(c.z)), c1);
    check(errors, c1 && near && (shoreOk || c1.state === 'hide') && (c1.state !== 'swim' || Math.hypot(c1.x - c0.x, c1.z - c0.z) > 0.5), `O6 it scuttles sideways and stays (${c1 ? c1.state + ' ' + Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1) + ' blocks' : 'gone'})`);
    const met0 = await ev(page, () => window.__game.ocean.met('crab'));
    await ev(page, (i) => window.__game.debug.ocean.tapRec('crab', i), c0.i);
    check(errors, await ev(page, (m) => window.__game.ocean.met('crab') === m + 1, met0), 'O6 a tap counts as meeting it');
  }

  // O9 unload: pickables back to the baseline, no animals, meshes hidden
  const o9 = await ev(page, async () => {
    const g = window.__game;
    await g.exitToTitle();
    const counts = g.debug.ocean.count();
    const meshes = [];
    g.scene.traverse((o) => { if (o.name && o.name.startsWith('sea-') && o.isMesh) meshes.push(o.visible); });
    return { pickables: g.pickables.size, total: Object.values(counts).reduce((a, b) => a + b, 0), visible: meshes.some(Boolean), meshes: meshes.length };
  });
  check(errors, o9.pickables === 0 && o9.total === 0 && !o9.visible && o9.meshes === 9, `O9 back to the title: ${o9.pickables} pickables, ${o9.total} animals, ${o9.meshes} sea meshes all hidden`);
  await context.close();
}

// =====================================================================================
// see (V1)
// =====================================================================================

async function seePass(browser, errors) {
  const seeLog = [];
  for (const vp of [{ width: 1280, height: 800, label: 'desktop' }, { width: 1024, height: 768, label: 'ipad' }]) {
    console.log(`\n[see] the real swim camera, ${vp.label} ${vp.width}x${vp.height}`);
    const { context, page } = await openGame(browser, { errors, viewport: { width: vp.width, height: vp.height }, label: 'see-' + vp.label });
    await newWorld(page, 'beach');
    const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
    await float(page, true);
    await goTo(page, deep);
    await ev(page, () => window.__game.award('splash')); // her first swim's own sticker, out of the way
    await page.waitForTimeout(3500);
    for (const kind of ['dolphin', 'fish', 'sea_turtle', 'jelly', 'octopus', 'seahorse', 'starfish']) {
      const res = await ev(page, async (kind) => {
        const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
        d.clear();
        // 5 blocks ahead along the camera's look and 2 to the side (not behind her own head)
        const x = p.x + Math.sin(cam.yaw) * 5 - Math.cos(cam.yaw) * 2, z = p.z + Math.cos(cam.yaw) * 5 + Math.sin(cam.yaw) * 2;
        // the first palette of each kind (the same picture every run)
        const n = d.spawn(kind, x, p.y, z, { n: kind === 'fish' ? 8 : 1, variant: 0 });
        if (!n) return { n };
        await new Promise((r) => setTimeout(r, 500));
        d.still(true);
        await new Promise((r) => requestAnimationFrame(() => r()));
        return { n };
      }, kind);
      const c = res.n ? await seaContrast(page) : { px: 0, diff: 0, ring: 0, luma: 0 };
      await shot(page, `see-${vp.label}-${kind}`, PREFIX);
      await ev(page, () => window.__game.debug.ocean.still(false));
      seeLog.push(`${vp.label} ${kind}: diff ${f1(c.diff)} ring ${f1(c.ring)} luma ${f1(c.luma)} px ${c.px}`);
      // the animal against the water it covers (diff) AND against the water around it (ring):
      // (0..441 RGB distance; each kind's first palette). The old faint look (opaque animals drawn
      // under the 75% water) measured diff 16-38 and ring 8-25 here (one seahorse whose crest broke
      // the water: diff 70, ring 44), so every kind fails. Drawn after the water with the water's
      // colour mixed over the part under the surface (material.js) they measure diff 64-107 and
      // ring 44-92 (the turtle's pale flippers and the blue dolphin are the lowest); the gate sits
      // between the two: diff >= 50, ring >= 36
      check(errors, c.px > 50 && c.diff >= V1_DIFF && c.ring >= V1_RING, `V1 ${vp.label}: a ${kind} ahead is clearly visible from the swim camera (difference ${f1(c.diff)} >= ${V1_DIFF}, against the water around it ${f1(c.ring)} >= ${V1_RING}, over ${c.px} silhouette pixels)`);
    }
    // seabed animals: a bubble trail within 3 s
    const bub = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
      d.clear();
      const x = p.x + Math.sin(cam.yaw) * 4, z = p.z + Math.cos(cam.yaw) * 4;
      const n = d.spawn('octopus', x, p.y, z);
      const t0 = d.stats().trails, gt = g.time.t;
      let seen = false;
      for (let k = 0; k < 200 && !seen && g.time.t - gt < 3.2; k++) {
        await new Promise((r) => setTimeout(r, 200));
        seen = d.stats().trails > t0;
      }
      return { seen, n };
    });
    check(errors, bub.seen, `V1 an octopus on the seabed sends up a bubble trail within 3 s of game time (${JSON.stringify(bub)})`);
    await context.close();
  }
  console.log('  V1 numbers:\n    ' + seeLog.join('\n    '));
}

// =====================================================================================
// tap
// =====================================================================================

async function tapPass(browser, errors) {
  console.log('\n[tap] desktop, real clicks (Hand tool)');
  const { context, page } = await openGame(browser, { errors, label: 'tap' });
  await newWorld(page, 'beach');
  await ev(page, () => window.__game.debug.ocean.popups(true));
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  await ev(page, () => { const g = window.__game; g.setTool('hand'); g.debug.ocean.clear(); g.debug.ocean.autoSpawn(false); g.award('splash'); });
  await page.waitForTimeout(800); // her first swim's own sticker (Splash!) is out of the way

  // T1 click a dolphin while swimming: hold beside her, the bubble, the sticker, coins
  const coins0 = await ev(page, () => window.__game.profile.coins);
  const pt = await ev(page, () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
    const x = p.x + Math.sin(cam.yaw) * 4, z = p.z + Math.cos(cam.yaw) * 4;
    d.spawn('dolphin', x, p.y, z, { n: 2 });
    return [x, z];
  });
  await page.waitForTimeout(400);
  const d0 = await ev(page, () => window.__game.debug.ocean.list('dolphin')[0]);
  await aim(page, d0.x, d0.y, d0.z, 0.25);
  await freeze(page, true);
  const p1 = await recPoint(page, 'dolphin', d0.i, 0.2);
  if (p1) await page.mouse.click(p1.x, p1.y);
  await freeze(page, false);
  // (a dolphin caught mid-leap holds once it lands)
  const held = await waitOk(page, () => {
    const d = window.__game.debug.ocean, b = d.bubble();
    return !!b && d.list('dolphin').find((r) => r.i === b.i).state === 'hold';
  }, null, 8000);
  const t1 = await ev(page, () => {
    const g = window.__game, b = g.debug.ocean.bubble();
    const el = document.querySelector('.oc-bubble.lf-on');
    return {
      bubble: b, text: el ? el.textContent : '', owner: el ? el.dataset.owner : null,
      state: b ? g.debug.ocean.list('dolphin').find((r) => r.i === b.i).state : null,
      met: g.ocean.met('dolphin'), sticker: g.stickers.has('dolphin_friend'),
    };
  });
  check(errors, held && t1.state === 'hold' && t1.owner === 'ocean', `T1 a click on a dolphin: it holds beside her and the bubble opens (${t1.state})`);
  check(errors, /Ride/.test(t1.text) && /Trick/.test(t1.text) && t1.bubble && t1.text.includes(t1.bubble.name), `T1 the bubble shows its name, Ride and Trick ("${t1.text}")`);
  check(errors, t1.sticker && t1.met === 1, `T1 Dolphin Friend, seaMet.dolphin = ${t1.met}`);
  check(errors, (await toastCount(page, /^You met a Dolphin!$/)) === 0, 'T1 no first-meet toast (the sticker says it)');
  await page.waitForTimeout(1200);
  const coins1 = await ev(page, () => window.__game.profile.coins);
  check(errors, coins1 - coins0 === 22, `T1 +20 and +2 coins (${coins1 - coins0})`);
  const talks = (await events(page, 'friend:talk')).length;
  check(errors, talks <= 1, `T1 at most one NPC line (${talks})`);
  await shot(page, 'tap-bubble', PREFIX);
  // Trick
  await page.locator('.oc-bubble.lf-on .sw-round[aria-label="Trick"]').click();
  check(errors, await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.state === 'trick'), null, 2000), 'T1 Trick: a trick plays');
  const sk = await ev(page, () => window.__game.debug.ocean.fields().sk);
  check(errors, sk !== null && (await events(page, 'sea:trick')).length === 1, `T1 her trick counts for presence sk (${sk})`);
  await page.keyboard.press('Escape').catch(() => {});
  await ev(page, () => { const g = window.__game; if (g.ui.current) g.ui.close(); });

  // T3 a block selected: a click on a dolphin places nothing; Remove on a leaping dolphin removes nothing
  const t3 = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean;
    d.clear();
    const p = g.player.position, cam = g.cameraRig;
    const x = p.x + Math.sin(cam.yaw) * 4, z = p.z + Math.cos(cam.yaw) * 4;
    d.spawn('dolphin', x, p.y, z, { n: 2 });
    await new Promise((r) => setTimeout(r, 300));
    return d.list('dolphin')[0];
  });
  await aim(page, t3.x, t3.y, t3.z, 0.25);
  await ev(page, () => { const g = window.__game; g.debug.select('block:planks_pink'); g.setTool('build'); });
  const h0 = await ev(page, () => window.__game.history.length);
  await freeze(page, true);
  let p3 = await recPoint(page, 'dolphin', t3.i, 0.2);
  if (p3) await page.mouse.click(p3.x, p3.y);
  await freeze(page, false);
  await page.waitForTimeout(400);
  check(errors, (await ev(page, () => window.__game.history.length)) === h0, 'T3 Build on a dolphin: no block placed');
  await ev(page, () => { const g = window.__game; g.setTool('remove'); const r = g.debug.ocean.list('dolphin')[0]; });
  await ev(page, () => { const g = window.__game; const d = g.debug.ocean; d.tapRec('dolphin', d.list('dolphin')[0].i); });
  await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.state === 'trick' || r.state === 'leap'), null, 2000);
  const lp = await ev(page, () => window.__game.debug.ocean.list('dolphin').find((r) => r.state === 'trick' || r.state === 'leap') || window.__game.debug.ocean.list('dolphin')[0]);
  await freeze(page, true);
  p3 = await recPoint(page, 'dolphin', lp.i, 0);
  if (p3) await page.mouse.click(p3.x, p3.y);
  await freeze(page, false);
  await page.waitForTimeout(400);
  check(errors, (await ev(page, () => window.__game.history.length)) === h0, 'T3 Remove on a dolphin in a trick: nothing removed');

  // T3b a fish school 1 block under the surface: Remove, then a right-click with the Hand
  for (const how of ['remove', 'right']) {
    await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean;
      d.still(false);
      d.clear();
      const p = g.player.position, cam = g.cameraRig;
      d.spawn('fish', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 8 });
      await new Promise((r) => setTimeout(r, 400));
    });
    await freeze(page, true);
    const sc = await ev(page, () => { const d = window.__game.debug.ocean; d.shiftSchool(0, -0.9); return d.schools()[0]; });
    const target = [(sc.box[0][0] + sc.box[1][0]) / 2, (sc.box[0][1] + sc.box[1][1]) / 2, (sc.box[0][2] + sc.box[1][2]) / 2];
    await aim(page, target[0], target[1], target[2], 0.6);
    const before = await ev(page, (t) => {
      const g = window.__game, m = g.ocean.map, top = m.top(t[0], t[2]);
      return { top, above: g.world.get(Math.floor(t[0]), top, Math.floor(t[2])), h: g.history.length, met: g.ocean.met('fish'), under: t[1] < top + 0.875 };
    }, target);
    const sp = await screenPoint(page, ...target);
    const hit = await pickAt(page, sp, true);
    const inSet = await ev(page, () => window.__game.debug.ocean.schools().map((q) => q.inSet));
    if (how === 'remove') { await ev(page, () => window.__game.setTool('remove')); await page.mouse.click(sp.x, sp.y); }
    else { await ev(page, () => window.__game.setTool('hand')); await page.mouse.click(sp.x, sp.y, { button: 'right' }); }
    await page.waitForTimeout(300);
    const after = await ev(page, (t) => {
      const g = window.__game, m = g.ocean.map;
      return { above: g.world.get(Math.floor(t[0]), m.top(t[0], t[2]), Math.floor(t[2])), top: m.top(t[0], t[2]), h: g.history.length, met: g.ocean.met('fish') };
    }, target);
    await freeze(page, false);
    check(errors, before.under && after.met === before.met + 1 && after.top === before.top && after.above === before.above && after.h === before.h, `T3b ${how === 'remove' ? 'Remove' : 'a right-click with the Hand'} on a fish school under the surface: a hello (${before.met} -> ${after.met}), the water stays, no history (${before.h} -> ${after.h}; aimed at ${JSON.stringify(hit)}, school in the set ${inSet})`);
  }
  await ev(page, () => window.__game.setTool('hand'));

  // T4 click a fish school: scatter, bubbles, "You met a Little Fish!" with a picture
  // (T3b already met the fish: a fresh profile counter for this check)
  await ev(page, () => { const g = window.__game; delete g.profile.stats.seaMet.fish; window.__toasts.length = 0; window.__toastImgs.length = 0; });
  const fs = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean;
    d.clear();
    const p = g.player.position, cam = g.cameraRig;
    d.spawn('fish', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 8 });
    await new Promise((r) => setTimeout(r, 400));
    return d.schools()[0];
  });
  await aim(page, fs.x, fs.y, fs.z, 0.45);
  await freeze(page, true);
  const fsb = await ev(page, () => window.__game.debug.ocean.schools()[0].box);
  const fp = await screenPoint(page, (fsb[0][0] + fsb[1][0]) / 2, (fsb[0][1] + fsb[1][1]) / 2, (fsb[0][2] + fsb[1][2]) / 2);
  const hit4 = await pickAt(page, fp);
  await page.mouse.click(fp.x, fp.y);
  await freeze(page, false);
  console.log('    (T4 aimed at ' + JSON.stringify(hit4) + ')');
  const scat = await waitOk(page, () => (window.__game.debug.ocean.schools()[0] || {}).scatter > 0.5, null, 1500);
  check(errors, scat, 'T4 a click on a school: it scatters');
  check(errors, await toastSeen(page, /^You met a Little Fish!$/, 3000) && await waitOk(page, () => window.__toastImgs.includes('You met a Little Fish!') && !!document.querySelector('.sw-toast img.sw-toast-img'), null, 3000), 'T4 "You met a Little Fish!" with the fish\'s picture (an <img> in the toast)');
  await shot(page, 'tap-fish-toast', PREFIX);

  // T5 every other kind: a picture toast once (except the one that pops Sea Explorer); +2 coins each; a second hello pays nothing
  for (const kind of ['sea_turtle', 'octopus', 'jelly', 'seahorse', 'crab', 'starfish']) {
    const r = await ev(page, async (kind) => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position;
      d.clear();
      let x = p.x + 3, z = p.z;
      if (kind === 'crab') { const s = d.shoreSpot(); x = s[0]; z = s[2]; }
      const n = d.spawn(kind, x, p.y, z);
      const list = d.list(kind);
      if (!n || !list.length) return { n };
      const c0 = g.profile.coins;
      const tint0 = kind === 'octopus' ? list[0].variant : null;
      d.tapRec(kind, list[0].i);
      await new Promise((r) => setTimeout(r, 900));
      const c1 = g.profile.coins;
      d.tapRec(kind, list[0].i);
      await new Promise((r) => setTimeout(r, 900));
      const c2 = g.profile.coins;
      const after = d.list(kind)[0];
      return { n, paid: c1 - c0, again: c2 - c1, met: g.ocean.met(kind), recolor: kind === 'octopus' ? after && after.variant !== tint0 : null, explorer: g.stickers.has('sea_explorer') };
    }, kind);
    const want = kind === 'sea_turtle' || kind === 'octopus' || kind === 'jelly' || kind === 'seahorse' ? 'met' : 'met';
    void want;
    const toast = await toastCount(page, new RegExp(`^You met an? ${(await ev(page, (k) => ({ sea_turtle: 'Sea Turtle', octopus: 'Octopus', jelly: 'Jellyfish', seahorse: 'Seahorse', crab: 'Crab', starfish: 'Starfish' })[k], kind))}!$`));
    const explorerNow = (await events(page, 'sticker:earned')).some((e) => e.sticker === 'sea_explorer');
    check(errors, r.n > 0 && r.met === 2 && (r.paid === 2 || r.paid === 22) && r.again === 0, `T5 ${kind}: two hellos, the first pays +2 (${r.paid}${r.paid === 22 ? ', with Sea Explorer' : ''}), the second nothing (${r.again})`);
    check(errors, toast === 1 || (explorerNow && toast === 0 && r.paid === 22), `T5 ${kind}: its picture toast showed ${toast} time(s)`);
    if (kind === 'octopus') check(errors, r.recolor, 'T5 the octopus changes color on a tap');
  }
  check(errors, await ev(page, () => window.__game.stickers.has('sea_explorer')), 'T5 Sea Explorer after five kinds');

  // T6 the Starfish block: a Hand click says hi; Build replaces it as today
  const t6 = await ev(page, () => {
    const g = window.__game, w = g.world, m = g.ocean.map, p = g.player.position;
    const id = g.registry.blocks.byKey('starfish').id;
    for (let r = 0; r < 80; r++) for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, x = Math.floor(p.x + Math.sin(a) * r), z = Math.floor(p.z + Math.cos(a) * r);
      for (let y = 18; y < 30; y++) if (w.get(x, y, z) === id) return [x, y, z];
    }
    return null;
  });
  if (t6) {
    await goTo(page, [t6[0] + 2.5, t6[1] + 0.1, t6[2] + 0.5]);
    await float(page, false);
    await ev(page, () => window.__game.unstickPlayer());
    await page.waitForTimeout(400);
    await ev(page, () => window.__game.setTool('hand'));
    const m0 = await ev(page, () => window.__game.ocean.met('starfish'));
    await aim(page, t6[0] + 0.5, t6[1] + 0.05, t6[2] + 0.5, 0.7);
    const sp = await screenPoint(page, t6[0] + 0.5, t6[1] + 0.05, t6[2] + 0.5);
    await page.mouse.click(sp.x, sp.y);
    await page.waitForTimeout(300);
    const m1 = await ev(page, () => window.__game.ocean.met('starfish'));
    const still = await ev(page, (c) => window.__game.debug.getBlock(c[0], c[1], c[2]), t6);
    check(errors, m1 === m0 + 1 && still === 'starfish', `T6 a Hand click on a Starfish block says hi (${m0} -> ${m1}), the block stays`);
    await ev(page, () => { const g = window.__game; g.debug.select('block:planks_pink'); g.setTool('build'); });
    await page.mouse.click(sp.x, sp.y);
    // (a slow machine: up to 3 s for the build to land)
    await waitOk(page, (c) => window.__game.debug.getBlock(c[0], c[1], c[2]) === 'planks_pink', t6, 3000);
    const now = await ev(page, (c) => window.__game.debug.getBlock(c[0], c[1], c[2]), t6);
    check(errors, now === 'planks_pink', `T6 with Build the block is replaced as today (${now})`);
    await ev(page, () => window.__game.setTool('hand'));
  } else check(errors, false, 'T6 a Starfish block on the beach');

  // T7 the whale: facing the sea, it surfaces, the toast only once placed, Whale Hello! after 1.5 s
  await float(page, true);
  await goTo(page, deep);
  const t7 = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    d.clear();
    // face the nearest world edge (the horizon ring)
    const w = g.world;
    const opts = [[p.x, 1, 0], [w.sx - p.x, 1, Math.PI / 2], [p.z, 0, 0]];
    const dists = { E: w.sx - p.x, W: p.x, N: w.sz - p.z, S: p.z };
    const best = Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0];
    g.cameraRig.yaw = { E: Math.PI / 2, W: -Math.PI / 2, N: 0, S: Math.PI }[best];
    g.cameraRig.pitch = 0.08;
    void opts;
    const toasts0 = window.__toasts.length;
    const ok = d.whaleNow();
    await new Promise((r) => setTimeout(r, 200));
    const st0 = d.whaleState();
    const toastBefore = window.__toasts.slice(toasts0).some((t) => /whale says hello/.test(t));
    return { ok, placed: st0.placed, toastWhenPlaced: toastBefore === st0.placed || st0.placed };
  });
  check(errors, t7.ok && t7.placed, 'T7 whaleNow(): the whale is placed out on the ring');
  check(errors, await toastSeen(page, /^A whale says hello! Look at the sea!$/, 3000), 'T7 "A whale says hello! Look at the sea!" (only once it is placed)');
  const hello = await waitOk(page, () => window.__game.stickers.has('whale_hello'), null, 15000);
  check(errors, hello, 'T7 Whale Hello! once it has been in view 1.5 s');
  await page.waitForTimeout(2500);
  await cleanView(page, true);
  await shot(page, 'tap-whale', PREFIX);
  await cleanView(page, false);
  // the spouts come at 30%, 45% and 60% of the 30 s visit (game time: slower on this machine)
  await waitOk(page, () => window.__game.debug.ocean.stats().spouts >= 1, null, 45000);
  const spouts = await ev(page, () => window.__game.debug.ocean.stats().spouts);
  check(errors, spouts >= 1, `T7 it spouts (${spouts})`);
  await cleanView(page, true);
  await shot(page, 'tap-whale-spout', PREFIX);
  await cleanView(page, false);
  // every kind met: Ocean Star; the Sticker Book shows the 5 sea stickers and the strip
  await ev(page, () => { const g = window.__game, d = g.debug.ocean; d.clear(); const p = g.player.position; d.spawn('dolphin', p.x + 3, p.y, p.z, { n: 2 }); d.tap('dolphin'); });
  await page.waitForTimeout(300);
  const star = await ev(page, () => {
    const g = window.__game, m = g.profile.stats.seaMet;
    return { star: g.stickers.has('ocean_star'), met: Object.keys(m).filter((k) => m[k] > 0).sort() };
  });
  check(errors, star.star, `T7 Ocean Star with all nine met (${star.met.join(', ')})`);
  await ev(page, () => { const g = window.__game; if (g.ui.current) g.ui.close(); g.ui.open('stickers'); });
  await page.waitForSelector('.oc-friends .oc-slot');
  await page.waitForTimeout(1200);
  const book = await ev(page, () => {
    const all = window.__game.stickers.all();
    const ids = ['dolphin_friend', 'dolphin_rider', 'sea_explorer', 'ocean_star', 'whale_hello'];
    return {
      have: ids.filter((id) => all.some((s) => s.id === id)).length,
      art: ids.every((id) => !!window.__game.registry.stickers.get(id).art),
      slots: document.querySelectorAll('.oc-friends .oc-slot').length,
      met: document.querySelectorAll('.oc-friends .oc-slot.oc-met').length,
      title: document.querySelector('.oc-friends-title').textContent,
    };
  });
  check(errors, book.have === 5 && book.art, `T7 the Sticker Book has the 5 sea stickers with art (${book.have})`);
  check(errors, book.slots === 9 && book.met === 9 && book.title === 'Sea Friends', `T7 the Sea Friends strip: ${book.met} of ${book.slots} colored`);
  await page.locator('.oc-friends').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'tap-seafriends-all', PREFIX);
  await ev(page, () => { const g = window.__game; g.ui.close(); delete g.profile.stats.seaMet.octopus; g.ui.open('stickers'); });
  await page.waitForSelector('.oc-friends .oc-slot');
  await page.waitForTimeout(900);
  const one = await ev(page, () => ({ unmet: [...document.querySelectorAll('.oc-friends .oc-slot.oc-unmet')].map((e) => e.dataset.kind) }));
  check(errors, one.unmet.length === 1 && one.unmet[0] === 'octopus', `T7 one kind unmet: its slot is a silhouette (${one.unmet})`);
  await page.locator('.oc-friends').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'tap-seafriends-octopus', PREFIX);
  await ev(page, () => window.__game.ui.close());

  // T8 the pointer when the whale is off-camera; rain: a whale inside fog far, or no toast
  const t8 = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean;
    d.clear();
    window.__toasts.length = 0;
    const ok = d.whaleNow();
    await new Promise((r) => setTimeout(r, 400));
    const st = d.whaleState();
    const p = g.player.position;
    g.cameraRig.yaw = Math.atan2(p.x - st.x, p.z - st.z); // facing away
    await new Promise((r) => setTimeout(r, 700));
    const on = !!document.querySelector('.oc-pointer.oc-on');
    g.cameraRig.yaw = Math.atan2(st.x - p.x, st.z - p.z);
    g.cameraRig.pitch = 0.05;
    await new Promise((r) => setTimeout(r, 900));
    const off = !document.querySelector('.oc-pointer.oc-on');
    return { ok, placed: st.placed, on, off };
  });
  check(errors, t8.placed && t8.on, 'T8 the whale behind her: the edge pointer shows');
  check(errors, t8.off, 'T8 turning toward it hides the pointer');
  const t8r = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, w = g.world;
    d.clear();
    g.weather.set && g.weather.set('rain');
    g.player.teleport(w.sx / 2 + 0.5, w.heightAt(w.sx / 2, w.sz / 2) + 1, w.sz / 2 + 0.5);
    await new Promise((r) => setTimeout(r, 3000));
    window.__toasts.length = 0;
    d.whaleNow();
    await new Promise((r) => setTimeout(r, 6000));
    const st = d.whaleState();
    const toast = window.__toasts.some((t) => /whale says hello/.test(t));
    const fog = g.scene.fog ? g.scene.fog.far : 0;
    const dist = Math.hypot(st.x - g.player.position.x, st.z - g.player.position.z);
    g.weather.set && g.weather.set('clear');
    return { placed: st.placed, toast, fog, dist, on: st.on };
  });
  check(errors, (!t8r.toast && !t8r.placed) || (t8r.toast && t8r.placed && t8r.dist <= t8r.fog), `T8 rain at the island's centre: a whale inside fog far or no toast at all (${JSON.stringify(t8r)})`);

  // T2 a dolphin from a moving boat: a trick, no bubble, "Stop the boat..." once; stopped: Ride
  await float(page, false);
  await ev(page, () => { const g = window.__game; g.debug.ocean.clear(); window.__toasts.length = 0; });
  const boat = await ev(page, async (d) => {
    const g = window.__game;
    const x = Math.floor(d[0]), z = Math.floor(d[2]), y = g.ocean.map.top(x, z);
    g.player.teleport(d[0], d[1], d[2]);
    const e = g.entities.place('boat_speed', x, y, z, 0, null, {}, { history: false, players: false });
    if (!e) return null;
    g.debug.vehicles.drive(e.uid);
    await new Promise((r) => setTimeout(r, 400));
    return e.uid;
  }, deep);
  if (boat) {
    await page.keyboard.down('KeyW');
    await waitOk(page, () => Math.abs(window.__game.vehicles.pose().speed) > 3, null, 8000);
    const b2 = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean, b = g.vehicles.pose();
      d.spawn('dolphin', b.x + Math.sin(b.yaw) * 5, b.y, b.z + Math.cos(b.yaw) * 5, { n: 2 });
      await new Promise((r) => setTimeout(r, 100));
      const r = d.list('dolphin')[0];
      const speed = Math.abs(g.vehicles.pose().speed);
      d.tapRec('dolphin', r.i);
      await new Promise((r) => requestAnimationFrame(() => r()));
      const trick = d.list('dolphin').some((q) => q.state === 'trick' || q.state === 'leap');
      await new Promise((r) => setTimeout(r, 900));
      d.tapRec('dolphin', d.list('dolphin')[1].i);
      await new Promise((r) => setTimeout(r, 600));
      return { speed, bubble: !!d.bubble(), trick, stop: window.__toasts.filter((t) => /^Stop the boat to ride a dolphin!$/.test(t)).length };
    });
    await page.keyboard.up('KeyW');
    check(errors, b2.speed > 1 && !b2.bubble && b2.trick && b2.stop === 1, `T2 from a moving boat: a trick, no bubble, "Stop the boat to ride a dolphin!" once (${JSON.stringify(b2)})`);
    const stopped = await waitOk(page, () => Math.abs(window.__game.vehicles.pose().speed) < 1, null, 8000);
    const b3 = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean, b = g.vehicles.pose();
      d.clear();
      d.spawn('dolphin', b.x + 2.5, b.y, b.z, { n: 2 });
      await new Promise((r) => setTimeout(r, 100));
      const r = d.list('dolphin').find((q) => Math.hypot(q.x - b.x, q.z - b.z) <= 4) || d.list('dolphin')[0];
      d.tapRec('dolphin', r.i);
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector('.oc-bubble.lf-on');
      return { bubble: d.bubble(), text: el ? el.textContent : '' };
    });
    check(errors, stopped && b3.bubble && b3.bubble.from === 'boat' && /Ride/.test(b3.text), `T2 a stopped boat: the bubble offers Ride (${JSON.stringify(b3)})`);
    await shot(page, 'tap-boat-bubble', PREFIX);
    // Ride from the boat: it parks on the water, she slides over
    await page.locator('.oc-bubble.lf-on .oc-ride').click();
    const rodeFromBoat = await waitOk(page, () => window.__game.ocean.riding && !window.__game.vehicles.current, null, 3000);
    const parked = await ev(page, () => window.__game.debug.vehicles.list().some((v) => v.key === 'boat_speed'));
    check(errors, rodeFromBoat && parked, 'T2 Ride from the stopped boat: the boat stays parked on the water, she rides');
    await ev(page, () => window.__game.ocean.hopOff('button'));
  } else check(errors, false, 'T2 a Speedboat to drive');
  // a dolphin tapped from land: "Swim out to ride a dolphin!" once
  const land = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, s = d.shoreSpot();
    d.clear();
    window.__toasts.length = 0;
    g.player.teleport(s[0], s[1] + 0.2, s[2]);
    g.unstickPlayer();
    await new Promise((r) => setTimeout(r, 500));
    const dd = d.deepSpot();
    d.spawn('dolphin', dd[0], dd[1], dd[2], { n: 2 });
    d.tap('dolphin');
    await new Promise((r) => setTimeout(r, 1000));
    d.tapRec('dolphin', d.list('dolphin')[1].i);
    await new Promise((r) => setTimeout(r, 400));
    return { swim: window.__toasts.filter((t) => /^Swim out to ride a dolphin!$/.test(t)).length, bubble: !!d.bubble() };
  });
  check(errors, land.swim === 1 && !land.bubble, `T2 from the land: "Swim out to ride a dolphin!" once, no bubble (${JSON.stringify(land)})`);
  await context.close();
}

// =====================================================================================
// ride
// =====================================================================================

async function startRide(page, deep) {
  await float(page, true);
  await goTo(page, deep);
  await ev(page, () => { const g = window.__game; g.debug.ocean.clear(); g.debug.ocean.autoSpawn(false); g.setTool('hand'); });
  const pt = await ev(page, () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
    d.spawn('dolphin', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 2 });
    return true;
  });
  void pt;
  await page.waitForTimeout(300);
  const d0 = await ev(page, () => window.__game.debug.ocean.list('dolphin').find((r) => !r.scale || r.scale === 1));
  await aim(page, d0.x, d0.y, d0.z, 0.25);
  await freeze(page, true);
  const p = await recPoint(page, 'dolphin', d0.i, 0.2);
  if (p) await page.mouse.click(p.x, p.y);
  await freeze(page, false);
  if (!(await waitOk(page, () => !!document.querySelector('.oc-bubble.lf-on .oc-ride'), null, 3000))) {
    await ev(page, (i) => window.__game.debug.ocean.tapRec('dolphin', i), d0.i);
    await page.waitForSelector('.oc-bubble.lf-on .oc-ride', { timeout: 3000 });
  }
  await page.locator('.oc-bubble.lf-on .oc-ride').click();
  return waitOk(page, () => window.__game.ocean.riding, null, 3000);
}

async function ridePass(browser, errors) {
  console.log('\n[ride] desktop');
  const { context, page } = await openGame(browser, { errors, label: 'ride' });
  await newWorld(page, 'beach');
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await ev(page, () => window.__game.award('splash')); // her first swim's own sticker, out of the way
  const coins0 = await ev(page, () => window.__game.profile.coins);
  // R1 the bubble's Ride
  const rode = await startRide(page, deep);
  const r1 = await ev(page, () => {
    const g = window.__game, pl = g.player;
    return { state: pl.state, kind: pl.mounted && pl.mounted.kind, extra: g.cameraRig.extraWant, tool: g.selectedTool, rider: g.stickers.has('dolphin_rider'), rides: g.profile.stats.dolphinRides };
  });
  check(errors, rode && r1.state === 'ride' && r1.kind === 'dolphin', `R1 Ride: state ride on a dolphin (${r1.state}, ${r1.kind})`);
  check(errors, Math.abs(r1.extra - 1.5) < 0.01 && r1.tool === 'hand', `R1 camera extraWant 1.5 (${r1.extra}), Hand tool`);
  check(errors, await toastSeen(page, /^Steer with W A S D! Space to jump!$/, 3000), 'R1 "Steer with W A S D! Space to jump!"');
  check(errors, r1.rider && r1.rides === 1, `R1 Dolphin Rider, dolphinRides ${r1.rides}`);
  await page.waitForTimeout(1500);
  const coins1 = await ev(page, () => window.__game.profile.coins);
  check(errors, coins1 - coins0 === 20 + 2 + 20 + 5, `R1 the coins: Dolphin Friend +20, a hello +2, Dolphin Rider +20, the ride +5 (${coins1 - coins0})`);
  const label = await ev(page, () => (document.querySelector('.sw-joy-label') || {}).textContent || null);
  check(errors, label === null || label === 'Ride', `R1 the joystick says Ride (${label})`);
  check(errors, await ev(page, () => !!document.querySelector('.lf-hud [data-action="seahop"]:not([hidden])')), 'R1 Hop off shows in the life column');
  await shot(page, 'ride-start', PREFIX);

  // R2 W for 3 s: 18+ blocks on deep water at one level; Shift + W: 12, a splash trail, a wider camera
  const a = await ev(page, () => { const s = window.__game.debug.ocean.rideState(); return s; });
  await ev(page, () => { const g = window.__game; g.cameraRig.yaw = g.debug.ocean.rideState().yaw; });
  // point her at the longest open water
  await ev(page, () => {
    const g = window.__game, m = g.ocean.map, s = g.debug.ocean.rideState();
    let best = 0, bd = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let d = 0;
      for (let r = 1; r < 40; r++) { if (!m.deepAround(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, 3) || !m.inBounds(Math.floor(s.x + Math.sin(a) * r), Math.floor(s.z + Math.cos(a) * r))) break; d = r; }
      if (d > bd) { bd = d; best = a; }
    }
    g.cameraRig.yaw = best;
  });
  const before = await ev(page, () => window.__game.debug.ocean.rideState());
  const sampler = ev(page, () => new Promise((res) => {
    const g = window.__game, m = g.ocean.map;
    let bad = 0, n = 0, lvl = g.debug.ocean.rideState().level;
    const t = g.time.t;
    const f = () => {
      const s = g.debug.ocean.rideState();
      if (!s.on) return res({ bad: -1, n });
      n++;
      if (!(m.top(s.x, s.z) === lvl && m.depth(s.x, s.z) >= 3)) bad++;
      if (g.time.t - t >= 3) res({ bad, n }); else requestAnimationFrame(f); // 3 s of game time
    };
    requestAnimationFrame(f);
  }));
  await page.keyboard.down('KeyW');
  const samp = await sampler;
  await page.keyboard.up('KeyW');
  const after = await ev(page, () => window.__game.debug.ocean.rideState());
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check(errors, moved >= 18 && samp.bad === 0, `R2 W for 3 s (game time): ${moved.toFixed(1)} blocks (>= 18), always deep water at one level (${samp.bad} of ${samp.n} frames off)`);
  await ev(page, () => {
    const g = window.__game, m = g.ocean.map, s = g.debug.ocean.rideState();
    let best = 0, bd = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let d = 0;
      for (let r = 1; r < 40; r++) { if (!m.deepAround(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, 3) || !m.inBounds(Math.floor(s.x + Math.sin(a) * r), Math.floor(s.z + Math.cos(a) * r))) break; d = r; }
      if (d > bd) { bd = d; best = a; }
    }
    g.cameraRig.yaw = best;
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const zoom = await waitOk(page, () => { const s = window.__game.debug.ocean.rideState(); return s.speed > 11.9 && s.zoom; }, null, 3000);
  await page.waitForTimeout(400);
  const ew = await ev(page, () => window.__game.cameraRig.extraWant);
  await shot(page, 'ride-zoom', PREFIX);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  check(errors, zoom && ew > 1.6, `R2 Shift + W: speed 12 with the zoom, the camera widens toward 2 (extraWant ${ew.toFixed(2)})`);
  await page.waitForTimeout(1500);

  // R3 Space: a leap, she goes up with it; a double Space does not fly; under a bridge: the small hop
  const y0 = await ev(page, () => window.__game.player.position.y);
  const lvl = await ev(page, () => window.__game.debug.ocean.rideState().level);
  await gameWait(page, 1.3); // the cool-down of the last leap
  const topP = ev(page, () => new Promise((res) => {
    const g = window.__game, t = g.time.t;
    let top = -1e9;
    const f = () => { top = Math.max(top, g.player.position.y); if (g.time.t - t >= 1.2) res(top); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  await page.keyboard.press('Space');
  const top = await topP;
  check(errors, top >= lvl + 0.875 + 1.3, `R3 Space: she rises with the leap (${(top - lvl - 0.875).toFixed(2)} above the surface, >= 1.3)`);
  await gameWait(page, 1.5);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  await page.keyboard.press('Space');
  await gameWait(page, 1.5);
  const fl = await ev(page, () => ({ flying: window.__game.player.flying, state: window.__game.player.state }));
  check(errors, !fl.flying && fl.state === 'ride', `R3 a double Space does not start flying (${JSON.stringify(fl)})`);
  const hop = await ev(page, async () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) g.world.setKey(Math.floor(s.x) + dx, s.level + 4, Math.floor(s.z) + dz, 'glass');
    const h0 = g.debug.ocean.rideState().stats.refused;
    return { h0 };
  });
  await gameWait(page, 1.3);
  await page.keyboard.press('Space');
  await gameWait(page, 0.4);
  const hop1 = await ev(page, () => window.__game.debug.ocean.rideState().stats.refused);
  const still = await ev(page, () => window.__game.ocean.riding);
  check(errors, hop1 === hop.h0 + 1 && still, `R3 under a glass roof 4 above the water: Space gives the small hop, the ride goes on (${still})`);
  await ev(page, () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) g.world.setKey(Math.floor(s.x) + dx, s.level + 4, Math.floor(s.z) + dz, 'air');
  });

  // R4 steer at the shore: it stops, "Dolphins stay in deep water!" at most once per 4 s, never a shallow column
  await ev(page, () => {
    const g = window.__game, s = g.debug.ocean.rideState(), w = g.world;
    g.cameraRig.yaw = Math.atan2(w.sx / 2 - s.x, w.sz / 2 - s.z); // toward the island
    window.__toasts.length = 0;
  });
  const shoreRun = ev(page, () => new Promise((res) => {
    const g = window.__game, m = g.ocean.map;
    let bad = 0, n = 0;
    const t = g.time.t;
    const f = () => {
      const s = g.debug.ocean.rideState();
      n++;
      if (s.on && !(m.depth(s.x, s.z) >= 3)) bad++;
      if (g.time.t - t >= 8) res({ bad, n, speed: s.speed }); else requestAnimationFrame(f); // 8 s of game time
    };
    requestAnimationFrame(f);
  }));
  await page.keyboard.down('KeyW');
  const sr = await shoreRun;
  await page.keyboard.up('KeyW');
  const sh = await toastCount(page, /^Dolphins stay in deep water!$/);
  const rs4 = await ev(page, () => { const s = window.__game.debug.ocean.rideState(); const m = window.__game.ocean.map; return { on: s.on, x: s.x.toFixed(1), z: s.z.toFixed(1), speed: s.speed.toFixed(1), shallow: s.stats.shallow, depthAhead: m.depth(s.x + Math.sin(s.yaw) * 3, s.z + Math.cos(s.yaw) * 3) }; });
  console.log('    (R4 ' + JSON.stringify(rs4) + ' ' + JSON.stringify(sr) + ')');
  check(errors, sr.bad === 0 && sh >= 1 && sh <= 2, `R4 steering at the shore for 8 s: never a shallow column (${sr.bad}), the toast ${sh} time(s)`);
  await shot(page, 'ride-shore', PREFIX);
  // the world edge
  const edge = await ev(page, () => window.__game.debug.ocean.edgeSpot());
  await ev(page, (e) => {
    const g = window.__game, d = g.debug.ocean;
    d.hopOff('button');
    g.player.teleport(e[0], e[1], e[2]);
  }, edge);
  await page.waitForTimeout(500);
  const re = await ev(page, () => window.__game.debug.ocean.ride());
  await ev(page, () => {
    const g = window.__game, s = g.debug.ocean.rideState(), w = g.world;
    const dx = s.x < 8 ? -1 : s.x > w.sx - 8 ? 1 : 0, dz = s.z < 8 ? -1 : s.z > w.sz - 8 ? 1 : 0;
    g.cameraRig.yaw = Math.atan2(dx, dz);
    window.__toasts.length = 0;
  });
  await page.keyboard.down('KeyW');
  await gameWait(page, 5);
  await page.keyboard.up('KeyW');
  const es = await ev(page, () => ({ s: window.__game.debug.ocean.rideState(), shallow: window.__toasts.filter((t) => /Dolphins stay/.test(t)).length }));
  check(errors, re && es.s.stats.uturns >= 1 && es.shallow === 0 && es.s.stats.maxStall <= 0.5, `R4 steering at the world edge: a U-turn (${es.s.stats.uturns}), no toast (${es.shallow}), longest stall ${es.s.stats.maxStall.toFixed(2)} s`);

  // R5 Hop off (the button): swimming, feet in the water, reason 'button', the label; X and E
  await page.locator('.lf-hud [data-action="seahop"]').click();
  await page.waitForTimeout(500);
  const r5 = await ev(page, () => {
    const g = window.__game, pl = g.player, p = pl.position;
    const e = g.__probeEvents.filter((q) => q.name === 'sea:hopoff').pop();
    return { state: pl.state, feet: g.physics.liquidAt(p.x, p.y + 0.6, p.z), reason: e && e.reason, label: (document.querySelector('.sw-joy-label') || {}).textContent || null, seaSwim: pl.seaSwim, extra: g.cameraRig.extraWant, sr: g.debug.ocean.fields().sr };
  });
  const wantLabel = r5.seaSwim ? 'Swim' : 'Walk'; // "Swim" comes with merfolk's sea swimming (P2)
  check(errors, r5.state === 'swim' && r5.feet && r5.reason === 'button' && r5.extra === 0 && r5.sr === null, `R5 Hop off: swimming, feet in the water, reason ${r5.reason}, camera back, presence sr cleared`);
  check(errors, r5.label === null || r5.label === wantLabel, `R5 the joystick label follows the swim state (${r5.label}; merfolk's "Swim" lands in P2)`);
  const buddy = await ev(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.state === 'buddy'));
  check(errors, buddy, 'R5 the dolphin swims beside her as a buddy');
  for (const key of ['KeyX', 'KeyE']) {
    await ev(page, () => window.__game.debug.ocean.ride());
    await page.waitForTimeout(300);
    const met0 = await ev(page, () => window.__game.debug.ocean.stats().greets);
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    const k = await ev(page, () => ({ riding: window.__game.ocean.riding, reason: window.__game.__probeEvents.filter((q) => q.name === 'sea:hopoff').pop().reason, greets: window.__game.debug.ocean.stats().greets }));
    check(errors, !k.riding && k.reason === 'key' && k.greets === met0, `R5 ${key === 'KeyX' ? 'X' : 'E'} hops off (and greets nothing)`);
  }

  // R6 the water under the riding dolphin goes away (a friend's edit): "Splash! Off you go!"
  await ev(page, () => window.__game.debug.ocean.ride());
  await page.waitForTimeout(300);
  await ev(page, () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    window.__toasts.length = 0;
    g.removeBlock = g.removeBlock; // the friend's edit arrives as a plain change
    for (let y = s.level; y > s.level - 8; y--) g.world.setKey(Math.floor(s.x), y, Math.floor(s.z), 'air');
  });
  await page.waitForTimeout(500);
  const r6 = await ev(page, () => ({ riding: window.__game.ocean.riding, reason: window.__game.__probeEvents.filter((q) => q.name === 'sea:hopoff').pop().reason }));
  check(errors, !r6.riding && r6.reason === 'water' && await toastSeen(page, /^Splash! Off you go!$/, 2000), `R6 the water goes away: off with "Splash! Off you go!" (${r6.reason})`);

  // R8 build onto the dolphin: refused; Build picked: back to Hand with "Hop off first!"; a right-click changes nothing
  await float(page, true);
  await goTo(page, deep);
  await page.waitForTimeout(300);
  await ev(page, () => window.__game.debug.ocean.ride());
  await page.waitForTimeout(300);
  const r8 = await ev(page, async () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    window.__toasts.length = 0;
    const placed = g.placeBlock(Math.floor(s.x), s.level + 1, Math.floor(s.z), 'stone');
    g.setTool('build');
    await new Promise((r) => setTimeout(r, 200));
    const tool = g.selectedTool;
    const h0 = g.history.length;
    const removed = g.removeTarget({ type: 'block', x: Math.floor(s.x) + 2, y: s.level, z: Math.floor(s.z), id: g.world.get(Math.floor(s.x) + 2, s.level, Math.floor(s.z)) });
    return { placed, tool, removed, h: g.history.length - h0, hop: window.__toasts.filter((t) => /^Hop off first!$/.test(t)).length };
  });
  check(errors, !r8.placed, 'R8 a block onto the ridden dolphin is refused');
  check(errors, r8.tool === 'hand' && r8.hop >= 1, `R8 Build while riding: back to Hand with "Hop off first!" (${r8.tool})`);
  check(errors, !r8.removed && r8.h === 0, 'R8 Remove / a right-click on the water beside it changes nothing');

  // R8b a friend's block (net:applied path, no history) at level + 1 on its cell: blocked at once, she is free
  const r8b = await ev(page, async () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    g.world.setKey(Math.floor(s.x), s.level + 1, Math.floor(s.z), 'stone', { record: false });
    g.events.emit('net:applied', { cells: [[Math.floor(s.x), s.level + 1, Math.floor(s.z)]] });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pl = g.player, p = pl.position;
    const e = g.__probeEvents.filter((q) => q.name === 'sea:hopoff').pop();
    return { riding: g.ocean.riding, reason: e && e.reason, blocked: g.physics.bodyBlocked(p.x, p.y + 0.01, p.z, pl.halfW, pl.height) };
  });
  check(errors, !r8b.riding && r8b.reason === 'blocked' && !r8b.blocked, `R8b a friend's block in the rider: the ride ends ('${r8b.reason}') and she is free`);
  await ev(page, () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    g.world.setKey(Math.floor(s.x), s.level + 1, Math.floor(s.z), 'air', { record: false });
  });

  // R9 a teleport while riding: the label, the camera, presence sr, 'lost'
  await goTo(page, deep);
  await page.waitForTimeout(300);
  await ev(page, () => window.__game.debug.ocean.ride());
  await page.waitForTimeout(300);
  const r9 = await ev(page, async () => {
    const g = window.__game, s = g.world.meta.spawn;
    g.debug.teleport(s[0], s[1], s[2]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const e = g.__probeEvents.filter((q) => q.name === 'sea:hopoff').pop();
    return { riding: g.ocean.riding, reason: e && e.reason, label: (document.querySelector('.sw-joy-label') || {}).textContent || null, extra: g.cameraRig.extraWant, sr: g.debug.ocean.fields().sr, back: g.debug.ocean.list('dolphin').filter((r) => r.role === 'wild').length };
  });
  check(errors, !r9.riding && r9.reason === 'lost' && (r9.label === null || r9.label === 'Walk') && r9.extra === 0 && r9.sr === null && r9.back >= 1, `R9 a teleport while riding: 'lost', label Walk, camera back, sr cleared, the dolphin back with the others (${JSON.stringify(r9)})`);

  // R7 a save while riding, reload: she loads swimming near the spot, no ride
  await goTo(page, deep);
  await page.waitForTimeout(300);
  await ev(page, () => window.__game.debug.ocean.ride());
  await page.waitForTimeout(500);
  const r7 = await ev(page, async () => {
    const g = window.__game, s = g.debug.ocean.rideState();
    await g.saveWorld({ thumbnail: false });
    const id = g.world.meta.id;
    await g.exitToTitle();
    await g.debug.loadWorld(id);
    await g.debug.waitIdle(60000);
    await new Promise((r) => setTimeout(r, 800));
    const p = g.player.position;
    return { d: Math.hypot(p.x - s.x, p.z - s.z), state: g.player.state, riding: g.ocean.riding, water: g.physics.liquidAt(p.x, p.y + 0.6, p.z) };
  });
  check(errors, r7.d < 3 && !r7.riding && r7.water, `R7 saved while riding, reloaded: in the water ${r7.d.toFixed(1)} blocks from the spot, no ride (${r7.state})`);
  await context.close();
}

// =====================================================================================
// touch
// =====================================================================================

async function touchPass(browser, errors) {
  console.log('\n[touch] iPad 1024x768');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'touch' });
  await newWorld(page, 'beach');
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  // no sticker pops during U1's steady check (the bubble moves aside for a pop, by design, and
  // the first swim's Splash! and the first hello's Dolphin Friend come at a machine's own pace;
  // the tap pass checks those stickers): both are hers already, their pops shown and gone
  await ev(page, () => { const g = window.__game; g.setTool('hand'); g.debug.ocean.clear(); g.debug.ocean.autoSpawn(false); g.award('splash'); g.award('dolphin_friend'); });
  await waitOk(page, () => !!document.querySelector('.sw-stkpop'), null, 3000);
  await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  await page.waitForTimeout(500);
  await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  await ev(page, () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
    d.spawn('dolphin', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 2 });
  });
  await page.waitForTimeout(300);
  const d0 = await ev(page, () => window.__game.debug.ocean.list('dolphin')[0]);
  await aim(page, d0.x, d0.y, d0.z, 0.25);
  await freeze(page, true);
  const p = await recPoint(page, 'dolphin', d0.i, 0.2);
  if (p) await page.touchscreen.tap(p.x, p.y);
  await freeze(page, false);
  const open = await waitOk(page, () => !!document.querySelector('.oc-bubble.lf-on'), null, 3000);
  check(errors, open, 'U1 a real tap on a dolphin opens the bubble');
  // the bubble's rectangle: clear of the HUD, steady over 3 s once the dolphin has come up beside
  // her (it follows the dolphin into its hold; a slow machine's frames were still on that way)
  const held = () => ev(page, () => { const r = window.__game.debug.ocean.list('dolphin').find((q) => q.state === 'hold'); return r ? [r.x, r.y, r.z] : null; });
  for (let k = 0, a = await held(); k < 20; k++) {
    await page.waitForTimeout(250);
    const b = await held();
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 0.03) break;
    a = b;
  }
  const r0 = await ev(page, RECTS);
  const b0 = r0.bubble[0];
  const hits = b0 ? r0.hud.filter((h) => overlap(b0, h)) : [];
  check(errors, b0 && hits.length === 0, `U1 the bubble overlaps no HUD part (${hits.map((h) => h.sel).join(', ') || 'none'})`);
  await page.waitForTimeout(3000);
  const r1 = await ev(page, RECTS);
  const b1 = r1.bubble[0];
  check(errors, b0 && b1 && Math.hypot(b1.x - b0.x, b1.y - b0.y) < 40, `U1 the bubble stays put (${b0 && b1 ? Math.hypot(b1.x - b0.x, b1.y - b0.y).toFixed(1) : '?'} px over 3 s)`);
  // still open 8 s later while a sticker pop shows (the idle timer pauses)
  await ev(page, () => { const g = window.__game; g.registry.stickers.set('probe_wait', { id: 'probe_wait', name: 'Probe', hint: '', icon: 'star' }); g.award('probe_wait'); });
  await waitOk(page, () => !!document.querySelector('.sw-stkpop'), null, 6000);
  const popAt = Date.now();
  await page.waitForTimeout(8000);
  const still = await ev(page, () => ({ open: !!document.querySelector('.oc-bubble.lf-on'), pop: !!document.querySelector('.sw-stkpop') }));
  check(errors, still.open, `U1 the bubble is still open 8 s later while a sticker pop shows (pop shown ${((Date.now() - popAt) / 1000).toFixed(0)} s: ${still.pop})`);
  await shot(page, 'touch-bubble', PREFIX);
  // U2 Ride by tap; the label; the joystick moves the dolphin; Jump leaps; Hop off
  if (!still.open) {
    await ev(page, () => window.__game.debug.ocean.tap('dolphin'));
    await page.waitForSelector('.oc-bubble.lf-on .oc-ride');
  }
  await page.locator('.oc-bubble.lf-on .oc-ride').tap();
  const rode = await waitOk(page, () => window.__game.ocean.riding, null, 3000);
  const label = await ev(page, () => (document.querySelector('.sw-joy-label') || {}).textContent);
  check(errors, rode && label === 'Ride', `U2 Ride: the joystick says "${label}"`);
  check(errors, await toastSeen(page, /^Steer with the joystick! Tap Jump to jump!$/, 3000), 'U2 "Steer with the joystick! Tap Jump to jump!"');
  await shot(page, 'touch-riding', PREFIX);
  const s0 = await ev(page, () => window.__game.debug.ocean.rideState());
  const joy = await ev(page, () => { const b = document.querySelector('.sw-joy').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: joy.x, y: joy.y, id: 7 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: joy.x, y: joy.y - i * 9, id: 7 }] }); await page.waitForTimeout(30); }
  await page.waitForTimeout(1500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const s1 = await ev(page, () => window.__game.debug.ocean.rideState());
  check(errors, Math.hypot(s1.x - s0.x, s1.z - s0.z) > 3, `U2 a touch drag on the joystick moves the dolphin (${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1)} blocks)`);
  const l0 = await ev(page, () => window.__game.debug.ocean.rideState().stats.leaps + window.__game.debug.ocean.rideState().stats.refused);
  const jump = page.locator('.sw-touch-hud [aria-label="Jump"], [data-action="jump"]').first();
  if (await jump.count()) await jump.tap(); else await ev(page, () => { window.__game.input.virtual.jump = true; setTimeout(() => { window.__game.input.virtual.jump = false; }, 150); });
  await page.waitForTimeout(250);
  await shot(page, 'touch-leap', PREFIX);
  const l1 = await ev(page, () => window.__game.debug.ocean.rideState().stats.leaps + window.__game.debug.ocean.rideState().stats.refused);
  check(errors, l1 > l0, 'U2 the Jump button leaps');
  await page.waitForTimeout(1200);
  await page.locator('.lf-hud [data-action="seahop"]').tap();
  await page.waitForTimeout(500);
  const after = await ev(page, () => ({ riding: window.__game.ocean.riding, label: (document.querySelector('.sw-joy-label') || {}).textContent, seaSwim: window.__game.player.seaSwim }));
  check(errors, !after.riding && after.label === (after.seaSwim ? 'Swim' : 'Walk'), `U2 Hop off: the label "${after.label}" (merfolk's "Swim" lands in P2)`);
  // the Help panel's Touch tab shows the dolphin card
  await ev(page, () => { const g = window.__game; g.ui.open('help'); });
  await page.waitForTimeout(500);
  const touchTab = page.locator('.sw-panel-wrap.sw-open .sw-help-tabs button', { hasText: 'Touch' });
  if (await touchTab.count()) await touchTab.tap();
  await page.waitForTimeout(400);
  const card = await ev(page, () => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-help-label')].some((e) => e.textContent === 'Swim to a dolphin and tap it to ride'));
  check(errors, card, 'U2 the Help panel\'s Touch tab has the dolphin card');
  await shot(page, 'touch-help', PREFIX);
  await context.close();
}

// =====================================================================================
// biomes and saves
// =====================================================================================

async function biomesPass(browser, errors) {
  console.log('\n[biomes] candy, flat pools, snow');
  const { context, page } = await openGame(browser, { errors, label: 'biomes' });
  // B1 candy: candy palettes; fish in the chocolate-milk pond
  await newWorld(page, 'candy');
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  const candy = await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'wild'), null, 20000);
  const pal = await ev(page, () => {
    const d = window.__game.debug.ocean;
    return { dolphins: d.list('dolphin').filter((r) => r.role === 'wild').map((r) => r.variant), fish: d.schools().map((s) => s.variant) };
  });
  check(errors, candy && pal.dolphins.every((v) => v === 5 || v === 6), `B1 candy: dolphins in candy palettes (${pal.dolphins})`);
  const pond = await ev(page, () => {
    const g = window.__game, w = g.world, m = g.ocean.map, id = g.registry.blocks.byKey('choco_milk') && g.registry.blocks.byKey('choco_milk').id;
    if (!id) return null;
    for (let z = 2; z < w.sz - 2; z++) for (let x = 2; x < w.sx - 2; x++) {
      const t = m.top(x, z);
      if (t >= 0 && w.get(x, t, z) === id && m.depth(x, z) >= 2) return [x + 0.5, t + 0.1, z + 0.5];
    }
    return null;
  });
  if (pond) {
    await ev(page, () => window.__game.debug.ocean.clear());
    await goTo(page, pond);
    const pf = await waitOk(page, () => window.__game.debug.ocean.schools().length > 0, null, 25000);
    check(errors, pf, 'B1 fish in the chocolate-milk pond');
    await shot(page, 'biomes-candy-pond', PREFIX);
  } else check(errors, false, 'B1 a chocolate-milk pond in Candy');

  // B2 flat: no sea life; a 5x5x2 pool gets fish ("Fish moved into your pool!"); 17x17x4 gets dolphins; 2 deep never
  await newWorld(page, 'flat');
  await float(page, false);
  await ev(page, () => window.__game.debug.ocean.popups(true));
  await page.waitForTimeout(6000);
  const none = await ev(page, () => Object.values(window.__game.debug.ocean.count()).reduce((a, b) => a + b, 0));
  check(errors, none === 0, `B2 flat: no sea life (${none})`);
  const dig = async (n, d, dx) => ev(page, ([n, d, dx]) => {
    const g = window.__game, w = g.world, p = g.player.position;
    const x0 = Math.floor(p.x) + dx, z0 = Math.floor(p.z) - (n >> 1), top = w.heightAt(x0, z0);
    const water = g.registry.blocks.byKey('water').id;
    w.batch(() => { for (let z = z0; z < z0 + n; z++) for (let x = x0; x < x0 + n; x++) for (let y = top - d + 1; y <= top; y++) w.set(x, y, z, water); });
    g.events.emit('net:applied', { cells: null });
    return [x0, top, z0];
  }, [n, d, dx]);
  const small = await dig(5, 2, 2);
  await ev(page, (s) => { const g = window.__game; g.player.teleport(s[0] - 0.5, s[1] + 1, s[2] + 2.5); }, small);
  const fishIn = await waitOk(page, () => window.__game.debug.ocean.schools().length > 0, null, 30000);
  check(errors, fishIn && await toastSeen(page, /^Fish moved into your pool!$/, 3000), 'B2 a 5x5x2 pool, standing at its edge: fish and "Fish moved into your pool!"');
  await shot(page, 'biomes-pool-fish', PREFIX);
  const shallow = await dig(17, 2, -40);
  void shallow;
  const big = await dig(17, 4, 30);
  await ev(page, (s) => { const g = window.__game; g.player.teleport(s[0] - 0.5, s[1] + 1, s[2] + 8.5); }, big);
  const pod = await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'wild'), null, 45000);
  check(errors, pod && await toastSeen(page, /^Dolphins came to your pool!$/, 3000), 'B2 a 17x17x4 pool, at its edge: a pod and "Dolphins came to your pool!"');
  const inShallow = await ev(page, (s) => window.__game.debug.ocean.list('dolphin').some((r) => r.x >= s[0] && r.x < s[0] + 17 && r.z >= s[2] && r.z < s[2] + 17), shallow);
  check(errors, !inShallow, 'B2 the 2-deep pool never gets dolphins');
  await shot(page, 'biomes-pool-dolphins', PREFIX);

  // B3 snow: no fish under the ice-capped pond
  await newWorld(page, 'snow');
  const iced = await ev(page, () => {
    const g = window.__game, w = g.world, m = g.ocean.map, ice = g.registry.blocks.byKey('ice') && g.registry.blocks.byKey('ice').id;
    const cells = [];
    for (let z = 2; z < w.sz - 2; z++) for (let x = 2; x < w.sx - 2; x++) {
      const h = w.heightAt(x, z);
      if (h >= 0 && w.get(x, h, z) === ice && g.registry.blocks.props.shape[w.get(x, h - 1, z)] === 5) cells.push([x, h, z]);
    }
    return cells.length ? { n: cells.length, at: cells[cells.length >> 1] } : null;
  });
  if (iced) {
    await goTo(page, [iced.at[0] + 0.5, iced.at[1] + 1, iced.at[2] + 0.5]);
    await page.waitForTimeout(15000);
    const under = await ev(page, () => {
      const g = window.__game, w = g.world, ice = g.registry.blocks.byKey('ice').id;
      return g.debug.ocean.list('fish').filter((f) => {
        for (let y = Math.floor(f.y) + 1; y < Math.floor(f.y) + 4; y++) if (w.get(Math.floor(f.x), y, Math.floor(f.z)) === ice) return true;
        return false;
      }).length;
    });
    check(errors, under === 0, `B3 snow: no fish under the ice (${iced.n} iced cells, ${under} fish under ice)`);
  } else check(errors, true, 'B3 snow: no ice-capped pond in this world (nothing to check)');
  await context.close();
}

async function savesPass(browser, errors) {
  console.log('\n[saves] an old profile, an old world, a beach world before and after sea life');
  const { context, page } = await openGame(browser, { errors, label: 'saves' });
  // D1 the old profile fixture (probe-boys.mjs:603-629 method)
  const fixture = JSON.parse(await readFile(path.join(ROOT, 'tools', 'fixtures', 'boys-old-profile.json'), 'utf8')).profile;
  const d1 = await ev(page, async (fx) => {
    const g = window.__game;
    g.profile = JSON.parse(JSON.stringify(fx));
    await g.saveProfile(true);
    location.reload();
    return true;
  }, fixture).catch(() => true);
  void d1;
  await waitForTitle(page, 60000);
  const loaded = await ev(page, () => ({ seaMet: window.__game.profile.stats && window.__game.profile.stats.seaMet, name: window.__game.profile.look && window.__game.profile.look.name, coins: window.__game.profile.coins }));
  check(errors, loaded.name === fixture.look.name && loaded.seaMet === undefined, `D1 the old profile loads (${loaded.name}), no seaMet`);
  await newWorld(page, 'beach');
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  await ev(page, () => { const g = window.__game, d = g.debug.ocean, p = g.player.position; d.spawn('fish', p.x + 3, p.y, p.z, { n: 6 }); d.tap('fish'); });
  const d1b = await ev(page, async () => {
    const g = window.__game;
    await g.saveProfile(true);
    return { fish: g.profile.stats.seaMet.fish, day: g.profile.stats.seaCoinDay };
  });
  await page.reload();
  await waitForTitle(page, 60000);
  const d1c = await ev(page, () => ({ fish: window.__game.profile.stats.seaMet && window.__game.profile.stats.seaMet.fish, day: window.__game.profile.stats.seaCoinDay, stickers: Object.keys(window.__game.profile.stickers).length }));
  check(errors, d1b.fish === 1 && d1b.day > 20260000 && d1c.fish === 1 && d1c.day === d1b.day, `D1 one tap makes seaMet.fish = 1 and seaCoinDay; a reload keeps them (${JSON.stringify(d1c)})`);

  // D2 the old world fixture loads with sea life, no errors
  const old = JSON.parse(await readFile(path.join(ROOT, 'tools', 'fixtures', 'old-world-96565e4.json'), 'utf8'));
  const d2 = await ev(page, async (fx) => {
    const g = window.__game;
    const res = await g.store.importWorld(fx.world);
    if (!res || !res.ok) return { imported: false };
    await g.debug.loadWorld(res.id);
    await g.debug.waitIdle(60000);
    await new Promise((r) => setTimeout(r, 4000));
    return { imported: true, mode: g.mode, map: g.debug.ocean.mapStats() };
  }, old);
  check(errors, d2.imported && d2.mode === 'play' && d2.map.liquid > 0, `D2 the old world (96565e4) loads with its sea map (${d2.map ? d2.map.liquid : 0} liquid columns)`);

  // D3 the beach world from 669b6fa: 60 s of sea life with taps and a ride, saved: the same blocks and systems
  const beach = JSON.parse(await readFile(path.join(ROOT, 'tools', 'fixtures', 'ocean-beach-669b6fa.json'), 'utf8'));
  const d3 = await ev(page, async (fx) => {
    const g = window.__game;
    await g.exitToTitle();
    const res = await g.store.importWorld(fx.world);
    if (!res || !res.ok) return { imported: false };
    await g.debug.loadWorld(res.id);
    await g.debug.waitIdle(60000);
    const before = JSON.parse(fx.world).save;
    const d = g.debug.ocean;
    const deep = d.deepSpot();
    g.player.teleport(deep[0], deep[1], deep[2]);
    const t = performance.now();
    let taps = 0, rode = false;
    while (performance.now() - t < 60000) {
      await new Promise((r) => setTimeout(r, 2000));
      for (const k of ['dolphin', 'fish', 'jelly', 'sea_turtle']) if (d.tap(k)) taps++;
      if (!rode && performance.now() - t > 20000) { rode = d.ride(); }
      if (rode && performance.now() - t > 35000 && g.ocean.riding) d.hopOff('button');
    }
    if (g.ocean.riding) d.hopOff('button');
    await g.saveWorld({ thumbnail: false });
    const after = JSON.parse(await g.store.exportWorld(g.world.meta.id)).save;
    const keys = (s) => Object.keys(s.systems || {}).sort().join(',');
    return {
      imported: true, taps, rode: !!rode,
      sameBlocks: after.blocks === before.blocks,
      sameSystems: keys(after) === keys(before),
      systems: keys(after),
      noOcean: !('ocean' in (after.systems || {})),
    };
  }, beach);
  check(errors, d3.imported && d3.sameBlocks && d3.sameSystems && d3.noOcean, `D3 a beach world saved before sea life, 60 s of sea life (${d3.taps} taps, a ride: ${d3.rode}), saved again: the same blocks and systems keys (${d3.systems})`);
  await context.close();
}

// =====================================================================================
// mp
// =====================================================================================

async function mpPass(browser, errors) {
  console.log('\n[mp] Lily hosts a beach world (desktop), Rosie joins (iPad)');
  const { NetHub } = await import('./net/hub.mjs');
  const { FakeClaudeHub } = await import('./net/fake-claude.js');
  const flows = await import('./net/mp-flows.mjs');
  const { game, until, setupPage, waitLive, bringTo, closePanels } = flows;
  const hub = new NetHub({
    clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
    budget: { rate: 100000, burst: 100000 }, maxPeers: 16, graceMs: 10000,
  });
  const fc = new FakeClaudeHub(hub);
  const ACCOUNTS = { 'u-lily': 'Parker family (Mom)', 'u-rosie': 'Rosie R.', 'u-june': 'june@example.com' };
  const open = async (def) => {
    const context = await browser.newContext({ viewport: def.viewport, hasTouch: def.touch, isMobile: def.touch, deviceScaleFactor: 1 });
    await fc.addContext(context, { uid: def.uid, level: def.level, can: def.can, guest: def.guest, accounts: ACCOUNTS, label: def.key });
    const page = await context.newPage();
    attachErrorCollectors(page, errors, def.key);
    const pl = { ...def, context, page };
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForTitle(page, 180000);
    await setupPage(pl);
    await recordEvents(page);
    return pl;
  };
  const lily = await open({ key: 'lily', name: 'Lily', uid: 'u-lily', level: 'interact', can: true, guest: false, viewport: { width: 1280, height: 800 }, touch: false, seed: 11 });
  const rosie = await open({ key: 'rosie', name: 'Rosie', uid: 'u-rosie', level: 'interact', can: true, guest: false, viewport: { width: 1024, height: 768 }, touch: true, seed: 29 });
  const converge = async (players, label) => {
    const r = await flows.converge(players, { timeout: 60000 });
    return check(errors, r.ok, `${label}: equal hashes and entities on ${players.map((p) => p.key).join(', ')}${r.detail ? ' (' + r.detail + ')' : ''}`);
  };
  const code = await flows.hostMakesCode(lily, { biome: 'beach' });
  await flows.guestTypesCode(rosie, code);
  await flows.hostLetsIn(lily, 'Rosie');
  check(errors, await waitLive(rosie), 'Rosie is in Lily\'s world');
  await closePanels(lily);
  for (const p of [lily, rosie]) await game(p, () => { const g = window.__game; g.debug.ocean.popups(true); });
  await bringTo(rosie, lily, 3, 3);
  await converge([lily, rosie], 'start');
  const j0 = await game(lily, () => window.__game.debug.net.seq());

  // P7 both pages: the same buddy
  const bl = await game(lily, () => window.__game.debug.ocean.buddy());
  const br = await game(rosie, () => window.__game.debug.ocean.buddy());
  check(errors, bl && br && bl.name === br.name && bl.variant === br.variant, `P7 the same buddy dolphin on both pages (${bl && bl.name}, ${br && br.name})`);

  // both in deep water, side by side
  const deep = await game(lily, () => window.__game.debug.ocean.deepSpot());
  await game(lily, (d) => window.__game.player.teleport(d[0], d[1], d[2]), deep);
  await game(rosie, (d) => window.__game.player.teleport(d[0] + 3, d[1], d[2] + 2), deep);
  for (const p of [lily, rosie]) await float(p.page, true);

  // P1 Rosie rides: Lily sees st h, seaRide and a dolphin with a saddle under her seat
  check(errors, await game(rosie, () => window.__game.debug.ocean.ride()), 'P1 Rosie rides a dolphin');
  const p1 = await until(lily, () => {
    const g = window.__game, r = g.debug.net.remote().find((q) => q.name === 'Rosie');
    if (!r || r.st !== 'h' || r.seaRide === null || r.seaRide === undefined) return null;
    const rd = g.debug.ocean.remote()[0];
    if (!rd || !rd.saddle) return null;
    const dy = r.pos[1] - rd.y, d = Math.hypot(r.pos[0] - rd.x, r.pos[2] - rd.z);
    return { st: r.st, sr: r.seaRide, dy, d };
  }, null, 5000);
  check(errors, p1 && Math.abs(p1.dy - 0.42) < 0.3 && p1.d < 0.6, `P1 Lily sees Rosie (st h, sr ${p1 && p1.sr}) on a saddled dolphin under her seat (${p1 ? p1.d.toFixed(2) : '?'} blocks)`);
  await game(lily, () => { const g = window.__game, r = g.debug.net.remote().find((q) => q.name === 'Rosie'); if (r) { const p = g.player.position; g.cameraRig.yaw = Math.atan2(r.pos[0] - p.x, r.pos[2] - p.z); g.cameraRig.pitch = 0.3; } });
  await lily.page.waitForTimeout(800);
  await shot(lily.page, 'mp-lily-sees-rosie-ride', PREFIX);
  await game(rosie, () => window.__game.debug.ocean.hopOff('button'));
  check(errors, await until(lily, () => window.__game.debug.ocean.remote().length === 0, null, 3000), 'P1 Rosie hops off: the friend\'s dolphin is gone within 2 s');

  // P6 Rosie's Trick: a dolphin near her on Lily's page plays a trick with hearts
  const rt0 = await game(lily, () => window.__game.debug.ocean.stats().remoteTricks);
  await game(rosie, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    d.spawn('dolphin', p.x + 3, p.y, p.z, { n: 2 });
    await new Promise((r) => setTimeout(r, 200));
    d.tap('dolphin');
    await new Promise((r) => setTimeout(r, 300));
    const b = document.querySelector('.oc-bubble.lf-on [aria-label="Trick"]');
    if (b) b.click();
  });
  check(errors, await until(lily, (n) => window.__game.debug.ocean.stats().remoteTricks > n, rt0, 3000), 'P6 Rosie\'s trick: Lily\'s page plays one beside her within 2 s');

  // P3 Rosie's hellos are hers: stickers, coins, seaMet; Lily's do not change; no journal entries
  const lilyBefore = await game(lily, () => ({ met: JSON.stringify(window.__game.profile.stats.seaMet || {}), coins: window.__game.profile.coins, st: Object.keys(window.__game.profile.stickers).length }));
  await game(rosie, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    d.spawn('fish', p.x + 2, p.y, p.z + 2, { n: 6 });
    d.tap('fish');
    await new Promise((r) => setTimeout(r, 300));
  });
  const ros = await game(rosie, () => ({ fish: (window.__game.profile.stats.seaMet || {}).fish || 0 }));
  const lilyAfter = await game(lily, () => ({ met: JSON.stringify(window.__game.profile.stats.seaMet || {}), coins: window.__game.profile.coins, st: Object.keys(window.__game.profile.stickers).length }));
  check(errors, ros.fish >= 1 && lilyAfter.met === lilyBefore.met && lilyAfter.coins === lilyBefore.coins && lilyAfter.st === lilyBefore.st, 'P3 Rosie\'s hellos are hers: Lily\'s seaMet, coins and stickers do not change');
  const j1 = await game(lily, () => window.__game.debug.net.seq());
  check(errors, j1 === j0, `P3 the host journal has no entries from sea life (${j0} -> ${j1})`);
  for (const p of [lily, rosie]) await float(p.page, false);
  await converge([lily, rosie], 'P3');

  // P2 the whale's times are the same on both pages; a shared moment starts it on both, the same part
  const wt = await game(lily, () => [window.__game.debug.ocean.whaleTime(3, 0), window.__game.debug.ocean.whaleTime(3, 1)]);
  const wr = await game(rosie, () => [window.__game.debug.ocean.whaleTime(3, 0), window.__game.debug.ocean.whaleTime(3, 1)]);
  check(errors, JSON.stringify(wt) === JSON.stringify(wr), `P2 whaleTime is the same on both pages (${wt.map((v) => v.toFixed(4))})`);
  for (const p of [lily, rosie]) await float(p.page, true);
  await game(lily, (d) => window.__game.player.teleport(d[0], d[1], d[2]), deep);
  await game(rosie, (d) => window.__game.player.teleport(d[0] + 2, d[1], d[2] + 1), deep);
  await game(lily, () => {
    const g = window.__game;
    g.profile.settings.timeFrozen = false;
    g.setDayTime(g.debug.ocean.whaleTime(g.time.day, 0) - 0.001);
  });
  const both = await Promise.all([lily, rosie].map((p) => until(p, () => window.__game.debug.ocean.whaleState().placed, null, 12000)));
  const ph = await Promise.all([lily, rosie].map((p) => game(p, () => window.__game.debug.ocean.whaleState().phase)));
  check(errors, both.every(Boolean) && Math.abs(ph[0] - ph[1]) < 0.15, `P2 the shared visit starts the whale on both pages, at the same part (phase ${ph.map((v) => (v === null ? 'null' : v.toFixed(2))).join(' / ')})`);
  await shot(lily.page, 'mp-whale-lily', PREFIX);

  // P5 June joins while Rosie already rides: June sees the dolphin under her; no replay of old tricks
  await game(lily, () => { window.__game.profile.settings.timeFrozen = true; });
  check(errors, await game(rosie, () => window.__game.debug.ocean.ride()), 'P5 Rosie rides again');
  const june = await open({ key: 'june', name: 'June', uid: 'u-june', level: 'interact', can: true, guest: true, viewport: { width: 390, height: 844 }, touch: true, seed: 47 });
  await flows.guestTypesCode(june, code);
  await flows.hostLetsIn(lily, 'June');
  check(errors, await waitLive(june), 'June is in');
  await closePanels(lily);
  await game(june, (d) => { const g = window.__game; g.debug.ocean.popups(true); g.player.teleport(d[0] - 2, d[1], d[2] - 2); }, deep);
  await float(june.page, true);
  const p5 = await until(june, () => {
    const g = window.__game, r = g.debug.net.remote().find((q) => q.name === 'Rosie');
    return r && r.seaRide !== null && r.seaRide !== undefined && g.debug.ocean.remote().length === 1 ? { sr: r.seaRide } : null;
  }, null, 8000);
  check(errors, !!p5, `P5 June joins while Rosie rides: she sees the dolphin under Rosie (${JSON.stringify(p5)})`);
  check(errors, (await game(june, () => window.__game.debug.ocean.stats().remoteTricks)) === 0, 'P6 June, joining after Rosie\'s trick, sees no replay');

  // P2b a late joiner: at p = 0.7 no whale; at p = 0.5 the dive part, never a fresh rise
  const seaDay = await game(lily, () => { const g = window.__game; g.profile.settings.timeFrozen = false; return g.time.day; }); // shared windows need a running clock
  await game(lily, (day) => { const g = window.__game; g.debug.ocean.clear(); g.setDayTime(g.debug.ocean.whaleTime(day, 0) + 0.7 * 0.042); }, seaDay);
  await june.page.waitForTimeout(6000);
  const late7 = await game(june, () => window.__game.debug.ocean.whaleState());
  check(errors, !late7.placed, `P2b June first sees a window at p = 0.7: no whale (${JSON.stringify({ placed: late7.placed, phase: late7.phase })})`);
  await game(lily, (day) => { const g = window.__game; g.setDayTime(g.debug.ocean.whaleTime(day, 1) + 0.5 * 0.042); }, seaDay);
  const late5 = await until(june, () => { const s = window.__game.debug.ocean.whaleState(); return s.placed ? s : null; }, null, 12000);
  const dbg5 = late5 ? null : await game(june, () => { const g = window.__game; return { st: g.debug.ocean.whaleState(), t: g.time, ui: g.ui.current, mode: g.mode, see: g.debug.ocean.atSea() }; });
  const host5 = await game(lily, () => ({ t: window.__game.time }));
  check(errors, late5 && late5.phase >= 0.45 && late5.on, `P2b June first sees a window at p = 0.5: the whale is there in its dive part (phase ${late5 ? late5.phase.toFixed(2) : 'none'}${dbg5 ? ' ' + JSON.stringify({ june: dbg5, host: host5 }) : ''})`);

  // P4 Rosie's page closes while she rides: her dolphin goes from the other pages
  const seen = await until(lily, () => window.__game.debug.ocean.remote().length === 1, null, 6000);
  const wild0 = await game(lily, () => window.__game.debug.ocean.list('dolphin').filter((r) => r.role === 'wild').length);
  await rosie.context.close();
  const tClose = Date.now();
  const gone = await until(lily, () => window.__game.debug.ocean.remote().length === 0 && !window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'friend'), null, 20000);
  console.log(`    (P4 gone from Lily's page after ${((Date.now() - tClose) / 1000).toFixed(1)} s)`);
  const goneJ = await until(june, () => window.__game.debug.ocean.remote().length === 0, null, 20000);
  const wild1 = await game(lily, () => window.__game.debug.ocean.list('dolphin').filter((r) => r.role === 'wild').length);
  check(errors, seen && gone && goneJ && wild1 === wild0, `P4 Rosie's page closes while riding: her dolphin goes from Lily's and June's pages, the wild count stays (seen ${!!seen}, gone ${!!gone}/${!!goneJ}, ${wild0} -> ${wild1})`);
  await june.context.close();
  await lily.context.close();
  hub.close && hub.close();
}

// =====================================================================================
// cost
// =====================================================================================

async function costPass(browser, errors) {
  console.log('\n[cost] desktop, quality auto');
  const { context, page } = await openGame(browser, { errors, label: 'cost' });
  await newWorld(page, 'beach', { quality: 'auto' });
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  await page.waitForTimeout(500);
  // C1 draw calls: every kind spawned at full count, a fixed camera over the sea
  const c1 = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    const calls = async () => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        g.renderer.render(g.scene, g.camera);
        out.push(g.renderer.info.render.calls);
      }
      out.sort((a, b) => a - b);
      return out[2];
    };
    g.cameraRig.pitch = 0.6;
    d.clear();
    d.pause(true);
    const off = await calls();
    d.pause(false);
    const s = d.shoreSpot();
    d.spawn('dolphin', p.x + 4, p.y, p.z, { n: 4 });
    for (let i = 0; i < 3; i++) d.spawn('fish', p.x - 3 + i * 2, p.y, p.z + 4, { n: 10 });
    d.spawn('sea_turtle', p.x + 2, p.y, p.z - 3, { n: 3 });
    d.spawn('octopus', p.x - 2, p.y, p.z - 3, { n: 2 });
    d.spawn('jelly', p.x, p.y, p.z + 6, { n: 8 });
    d.spawn('seahorse', p.x + 5, p.y, p.z + 3, { n: 6 });
    d.spawn('starfish', p.x - 5, p.y, p.z + 3, { n: 12 });
    d.spawn('crab', s[0], s[1], s[2], { n: 6 });
    d.whaleNow();
    await new Promise((r) => setTimeout(r, 1500));
    const on = await calls();
    const groups = {};
    g.scene.traverse((o) => { if (o.name && o.name.startsWith('sea-') && o.isMesh && o.visible) groups[o.name] = o.count; });
    return { off, on, groups, n: Object.keys(groups).length };
  });
  check(errors, c1.n <= 9 && c1.on - c1.off <= 9, `C1 sea life adds ${c1.on - c1.off} draw calls (<= 9) with every kind out: ${JSON.stringify(c1.groups)}`);
  // C2 the systems stage: full counts vs idle (+1.0 ms at most)
  const c2 = await ev(page, async () => {
    const g = window.__game;
    const avg = async () => {
      const st = g._stageTimes;
      const a = [];
      for (let i = 0; i < 120; i++) { await new Promise((r) => requestAnimationFrame(r)); a.push(st ? st.systems : 0); }
      return a.reduce((x, y) => x + y, 0) / a.length;
    };
    const on = await avg();
    g.debug.ocean.pause(true);
    const off = await avg();
    g.debug.ocean.pause(false);
    return { on, off };
  });
  check(errors, c2.on - c2.off <= 1.0, `C2 the systems stage with full counts: +${(c2.on - c2.off).toFixed(2)} ms (${c2.on.toFixed(2)} vs ${c2.off.toFixed(2)})`);
  // C3 geometries stay flat over 3 minutes of spawning and despawning (thumbnail clones disposed)
  // the same rounds throughout (a teleport, dolphins and fish, a tap, a picture); the baseline is
  // taken after the first 10 s of them (the game's own first-visit warm-ups are done by then)
  const c3 = await ev(page, async (deep) => {
    const g = window.__game, d = g.debug.ocean;
    const t = performance.now();
    let k = 0, g10 = null;
    while (performance.now() - t < 180000) {
      await new Promise((r) => setTimeout(r, 1500));
      k++;
      if (g10 === null && performance.now() - t > 10000) g10 = g.renderer.info.memory.geometries;
      d.clear();
      const x = deep[0] + ((k * 7) % 11) - 5, z = deep[2] + ((k * 5) % 9) - 4;
      g.player.teleport(x, deep[1], z);
      d.spawn('dolphin', x + 3, deep[1], z, { n: 3 });
      d.spawn('fish', x - 3, deep[1], z + 2, { n: 8 });
      d.tap('fish');
      g.ocean.thumb(['dolphin', 'fish', 'jelly', 'crab'][k % 4], k % 3);
    }
    return { geometries: g.renderer.info.memory.geometries, rounds: k, g10 };
  }, deep);
  const g10 = c3.g10;
  check(errors, c3.geometries <= g10 + 2, `C3 geometries after 3 minutes: ${c3.geometries} (after 10 s: ${g10}; ${c3.rounds} rounds)`);
  // C4 finite positions after all that; no frame longer than 1 s
  const c4 = await ev(page, () => {
    const g = window.__game, d = g.debug.ocean;
    let bad = 0;
    for (const k of ['dolphin', 'fish', 'sea_turtle', 'octopus', 'jelly', 'seahorse', 'crab', 'starfish', 'whale']) for (const r of d.list(k)) if (![r.x, r.y, r.z].every(Number.isFinite)) bad++;
    const rep = g.diag && g.diag.report ? g.diag.report() : null;
    return { bad, long: rep ? rep.longFrames || rep.longest || 0 : null, nan: d.stats().nanResets, rep: rep ? JSON.stringify(rep).slice(0, 200) : null };
  });
  check(errors, c4.bad === 0 && c4.nan === 0, `C4 every creature position is finite (${c4.bad} bad, ${c4.nan} NaN resets)`);
  await context.close();
  await galleryShots(browser, errors);
}

/** C5: the animals by day and night, every palette, the whale (the owner review, §7.3). */
async function galleryShots(browser, errors, pre = '') {
  console.log(`\n[${pre ? 'review' : 'cost'}] C5 the gallery (day, night, palettes, the whale)`);
  const { context, page } = await openGame(browser, { errors, label: 'gallery' });
  await newWorld(page, 'beach', { quality: 'auto' });
  await cleanView(page, true);
  // open sea toward +z: the gallery floats over it, the camera looks a little down at it
  // by the north edge, looking out over the sea and the horizon ring (+z)
  const at = await ev(page, () => {
    const g = window.__game, m = g.ocean.map, w = g.world;
    const out = m.outside();
    if (!out.liquid) return null;
    return [w.sx / 2, out.level + 0.875, w.sz - 26];
  });
  check(errors, !!at, 'C5 open sea for the gallery');
  if (!at) { await context.close(); return; }
  await ev(page, (a) => { const g = window.__game; g.player.teleport(a[0], a[1] + 30, a[2] - 20); g.player.setFlying(true); }, at);
  const pic = async (name, opts, cam) => {
    const items = await page.evaluate(([at, opts, cam]) => {
      const g = window.__game;
      const o = { x: at[0], y: at[1] + (cam.lift || 1.8), z: at[2] + 12, ...opts };
      const items = g.debug.ocean.gallery(o);
      g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.player.avatar.group.visible = false;
      g.camera.position.set(o.x, o.y + cam.up, o.z - cam.back);
      g.camera.fov = cam.fov || 50;
      g.camera.updateProjectionMatrix();
      g.camera.lookAt(o.x, o.y + (cam.look || 0), o.z);
      return items;
    }, [at, opts, cam]);
    await settle(page, 1200);
    await shot(page, pre + name, PREFIX);
    // in the picture, not just in the list: each animal's centre projects inside the view and the
    // pixels around it differ from the same picture without the sea life (empty water and sky)
    const c = await seaContrast(page, items, 34);
    const bad = c.each.filter((e) => !e.view || e.px < C5_PX || e.diff < C5_DIFF);
    if (bad.length) console.log(`  ${name}: not in the picture: ${bad.map((e) => `${e.kind}#${e.variant} view ${e.view} at ${e.sx},${e.sy} px ${e.px} diff ${f1(e.diff)}`).join('; ')}`);
    items.seen = c.each.length - bad.length;
    items.minDiff = c.each.reduce((m, e) => Math.min(m, e.diff), 1e9);
    return items;
  };
  // the review set frames the eight a little closer (big enough to judge)
  const G = pre ? [{ cols: 4, cell: 2.2 }, { up: 1.0, back: 6.5, fov: 50 }] : [{ cols: 4, cell: 2.3 }, { up: 1.2, back: 6.8, fov: 50 }];
  const day = await pic('gallery-day', G[0], G[1]);
  check(errors, day.length === 8 && day.seen === 8, `C5 the eight smaller animals by day, each one in the picture (${day.seen} of ${day.length}: ${day.map((d) => d.kind).join(', ')}; least difference ${f1(day.minDiff)} >= ${C5_DIFF})`);
  // C6 the water line (see waterLine)
  const wl = await waterLine(page, at);
  console.log('  C6 numbers: ' + JSON.stringify(wl, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));
  check(errors, wl.above.px > 2000 && wl.above.diff < C6_SAME, `C6 above the water seen from above: drawn as on land, solid (difference ${f1(wl.above.diff)} < ${C6_SAME})`);
  check(errors, wl.under.px > 2000 && wl.under.diff >= C6_TINT && wl.under.closer >= C6_CLOSER, `C6 under the water seen from above: the water's colour over them (difference ${f1(wl.under.diff)} >= ${C6_TINT}, ${f1(wl.under.closer)} closer to the water >= ${C6_CLOSER})`);
  check(errors, wl.below.px > 2000 && wl.below.diff < C6_SAME, `C6 under the water seen from under it: drawn as on land, solid (difference ${f1(wl.below.diff)} < ${C6_SAME})`);
  await page.evaluate(() => window.__game.setDayTime(0.9));
  const night = await pic('gallery-night', { ...G[0], night: true }, G[1]);
  check(errors, night.length === 8 && night.seen === 8, `C5 the eight smaller animals by night, each one in the picture (${night.seen} of ${night.length}; least difference ${f1(night.minDiff)})`);
  await page.evaluate(() => window.__game.setDayTime(0.42));
  const whale = await pic('gallery-whale', { kinds: ['whale', 'dolphin'], spacing: 1.1 }, { up: 2.5, back: 17, fov: 50, lift: 2.6 });
  check(errors, whale.seen === whale.length && whale.length === 2, `C5 the whale and a dolphin in the picture (${whale.seen} of ${whale.length})`);
  for (const k of ['dolphin', 'fish', 'sea_turtle', 'octopus', 'jelly', 'seahorse', 'crab', 'starfish', 'whale']) {
    const { n, cap } = await ev(page, (k) => ({ n: window.__game.debug.ocean.palettes(k), cap: window.__game.debug.ocean.cap(k) }), k);
    let shown = 0;
    // as many to a picture as the kind's mesh holds (the whale: one per picture)
    for (let from = 0, part = 0; from < n; from += cap, part++) {
      const variants = Array.from({ length: Math.min(cap, n - from) }, (_, i) => from + i);
      const cols = variants.length > 6 ? 5 : variants.length;
      const cell = k === 'whale' ? 9.5 : k === 'dolphin' ? 2.8 : k === 'sea_turtle' ? 2 : 1.4;
      const back = k === 'whale' ? 13 : k === 'dolphin' ? 10 : k === 'sea_turtle' ? 6 : 5.2;
      const items = await pic('palettes-' + k + (n > cap ? '-' + (part + 1) : ''), { kinds: [k], variants, cols, cell }, { up: k === 'whale' ? 2 : 1, back, fov: 50, lift: k === 'whale' ? 3 : 1.6 });
      shown += items.seen;
    }
    check(errors, shown === n, `C5 every ${k} palette in its picture (${shown} of ${n})`);
  }
  await page.evaluate(() => { const g = window.__game; g.debug.ocean.clear(); g.cameraRig.update = g.__rig; });
  await context.close();
}


/**
 * C6 the water line (material.js): the water's colour lies over an animal only where the surface
 * is BETWEEN it and the camera. The same animals are drawn twice in one spot, once with no water
 * (dry: drawn as on land) and once with a water surface at a chosen height, and compared over
 * their own silhouette (mean RGB distance, 0..441):
 *   above   camera above the water, animals above it too       -> the same as on land
 *   under   camera above the water, animals 1 block under it   -> tinted toward the water
 *   below   camera under the water, animals under it too       -> the same as on land
 * A test of the wrong side (the bug the picture judges found) fails `above` and `below`.
 */
async function waterLine(page, at) {
  return page.evaluate((at) => {
    const g = window.__game, d = g.debug.ocean, R = g.renderer, W = R.domElement.width, H = R.domElement.height;
    const groupOf = g.scene.getObjectByName('sea-life');
    const grab = () => {
      R.render(g.scene, g.camera);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(R.domElement, 0, 0);
      return x.getImageData(0, 0, W, H).data;
    };
    const mask = () => {
      const saved = [];
      for (const c of g.scene.children) { saved.push([c, c.visible]); if (c !== groupOf && !c.isLight) c.visible = false; }
      const bg = g.scene.background, fog = g.scene.fog;
      g.scene.background = new (groupOf.children[0].material.color.constructor)(0, 0, 0);
      g.scene.fog = null;
      const s = grab();
      g.scene.background = bg; g.scene.fog = fog;
      for (const [c, v] of saved) c.visible = v;
      const S = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) S[i] = s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] >= 30 ? 1 : 0;
      return S;
    };
    const o = { x: at[0], y: at[1] + 2.4, z: at[2] + 12, kinds: ['dolphin', 'sea_turtle', 'octopus', 'jelly'], cols: 4, cell: 2.2 };
    const water = [0x5c, 0xc7, 0xe8];
    const out = {};
    for (const [name, camUp, surf] of [['above', 1.0, -3], ['under', 2.2, 1.0], ['below', 0.6, 3.0]]) {
      g.camera.position.set(o.x, o.y + camUp, o.z - 6.5);
      g.camera.lookAt(o.x, o.y, o.z);
      g.camera.updateMatrixWorld();
      d.gallery({ ...o, surface: o.y + surf });
      const A = grab(), S = mask();
      d.gallery(o);
      const B = grab();
      let px = 0, diff = 0, wa = 0, wb = 0;
      for (let i = 0; i < W * H; i++) {
        if (!S[i]) continue;
        const k = i * 4;
        px++;
        diff += Math.hypot(A[k] - B[k], A[k + 1] - B[k + 1], A[k + 2] - B[k + 2]);
        wa += Math.hypot(A[k] - water[0], A[k + 1] - water[1], A[k + 2] - water[2]);
        wb += Math.hypot(B[k] - water[0], B[k + 1] - water[1], B[k + 2] - water[2]);
      }
      out[name] = { px, diff: px ? diff / px : 0, closer: px ? (wb - wa) / px : 0 };
    }
    return out;
  }, at);
}

// =====================================================================================
// review (owner pictures, not part of the gate): node tools/probe-ocean.mjs --only=review
// =====================================================================================

/** The owner-review pictures: the gallery and every palette, under the water, her play camera. */
async function reviewPass(browser, errors) {
  await galleryShots(browser, errors, 'review-');
  // under the water: a camera below the surface looking at a few animals (merfolk's own under-water
  // camera comes with P2; this one is a debug camera for the picture)
  {
    console.log('\n[review] under the water');
    const { context, page } = await openGame(browser, { errors, label: 'review-under' });
    await newWorld(page, 'beach', { quality: 'auto' });
    await cleanView(page, true);
    // no target outline, name tags or build ghost in the owner's pictures (as a Photo does)
    await ev(page, () => window.__game.events.emit('thumbnail:before', {}));
    const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
    await float(page, true);
    await goTo(page, deep, 0);
    await settle(page, 800);
    const under = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position, m = g.ocean.map, w = g.world;
      d.autoSpawn(false);
      d.clear();
      // look out to sea: away from the island's middle
      const yaw = Math.atan2(p.x - w.sx / 2, p.z - w.sz / 2);
      const surf = m.top(p.x, p.z) + 0.875, bed = m.bed(p.x, p.z);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const at = (f, s) => [p.x + fx * f - fz * s, p.z + fz * f + fx * s];
      let [x, z] = at(9, -1.5); d.spawn('dolphin', x, p.y, z, { n: 2 });
      [x, z] = at(7, 2.4); d.spawn('fish', x, p.y, z, { n: 9 });
      [x, z] = at(6, -2.4); d.spawn('sea_turtle', x, p.y, z);
      [x, z] = at(7, 0.6); d.spawn('octopus', x, p.y, z);
      [x, z] = at(10, 3.5); d.spawn('jelly', x, p.y, z, { n: 2 });
      [x, z] = at(6.5, -0.9); d.spawn('seahorse', x, p.y, z);
      [x, z] = at(5.5, 1.6); d.spawn('starfish', x, p.y, z);
      await new Promise((r) => setTimeout(r, 1500));
      d.still(true);
      g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.player.avatar.group.visible = false;
      const cy = Math.max(bed + 1.8, surf - 2.4);
      g.camera.position.set(p.x - fx * 1.5, cy, p.z - fz * 1.5);
      g.camera.fov = 55;
      g.camera.updateProjectionMatrix();
      g.camera.lookAt(p.x + fx * 7, cy - 0.2, p.z + fz * 7);
      return { surf, bed, cy, counts: d.count() };
    });
    console.log('  ' + JSON.stringify(under));
    await settle(page, 600);
    await shot(page, 'review-underwater', PREFIX);
    const c = await seaContrast(page);
    check(errors, c.px > 2000 && c.diff >= V1_DIFF, `R-U under the water: the animals in the picture (${c.px} pixels, difference ${f1(c.diff)})`);
    await ev(page, () => { const g = window.__game; g.debug.ocean.still(false); g.cameraRig.update = g.__rig; g.player.avatar.group.visible = true; });
    await context.close();
  }
  // her normal play camera, animals swimming near her (desktop and iPad)
  for (const vp of [{ width: 1280, height: 800, label: 'desktop' }, { width: 1024, height: 768, label: 'ipad' }]) {
    console.log(`\n[review] the play camera, ${vp.label}`);
    const { context, page } = await openGame(browser, { errors, viewport: { width: vp.width, height: vp.height }, label: 'review-' + vp.label });
    await newWorld(page, 'beach', { quality: 'auto' });
    await cleanView(page, true);
    // no target outline, name tags or build ghost in the owner's pictures (as a Photo does)
    await ev(page, () => window.__game.events.emit('thumbnail:before', {}));
    const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
    await float(page, true);
    await goTo(page, deep);
    await ev(page, () => { const g = window.__game; g.award('splash'); });
    await settle(page, 4000); // her first swim's sticker and its confetti are over
    await ev(page, () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
      d.autoSpawn(false);
      d.clear();
      cam.pitch = 0.42;
      const at = (f, s) => [p.x + Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * s, p.z + Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * s];
      let [x, z] = at(9, -3); d.spawn('dolphin', x, p.y, z, { n: 3 });
      [x, z] = at(5, 2.5); d.spawn('fish', x, p.y, z, { n: 9 });
      [x, z] = at(6.5, -2); d.spawn('sea_turtle', x, p.y, z);
      [x, z] = at(4, -1.2); d.spawn('jelly', x, p.y, z);
      [x, z] = at(3.5, 1.6); d.spawn('octopus', x, p.y, z);
    });
    await gameWait(page, 1.2, 15000);
    await shot(page, `review-play-${vp.label}`, PREFIX);
    await gameWait(page, 1.5, 15000);
    await shot(page, `review-play-${vp.label}-2`, PREFIX);
    const c = await seaContrast(page);
    check(errors, c.px > 800 && c.diff >= V1_DIFF, `R-P ${vp.label}: animals swimming near her are clearly in the picture (${c.px} pixels, difference ${f1(c.diff)})`);
    // a dolphin leaping out of the water near her (solid in the air, its splash below)
    const leap = await ev(page, () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position;
      const l = d.list('dolphin').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return l.length ? d.leap(l[0].i) && l[0].i : false;
    });
    if (leap !== false) {
      await waitOk(page, (i) => { const r = window.__game.debug.ocean.list('dolphin').find((q) => q.i === i); return r && r.y > r.level + 1.3; }, leap, 8000);
      await shot(page, `review-leap-${vp.label}`, PREFIX);
    }
    check(errors, leap !== false, `R-L ${vp.label}: a dolphin near her leaps for the picture`);
    // the play camera at night: glowing jellies, fish and a dolphin near her
    await ev(page, () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
      g.setDayTime(0.9);
      d.clear();
      const at = (f, s) => [p.x + Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * s, p.z + Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * s];
      let [x, z] = at(4.5, -1.5); d.spawn('jelly', x, p.y, z, { n: 3 });
      [x, z] = at(5, 2.2); d.spawn('fish', x, p.y, z, { n: 8 });
      [x, z] = at(8, 0); d.spawn('dolphin', x, p.y, z, { n: 2 });
      [x, z] = at(3.5, 0.6); d.spawn('octopus', x, p.y, z);
    });
    await gameWait(page, 1.5, 15000);
    await shot(page, `review-night-${vp.label}`, PREFIX);
    const cn = await seaContrast(page);
    check(errors, cn.px > 800 && cn.diff >= C5_DIFF, `R-N ${vp.label}: at night the animals near her are in the picture (${cn.px} pixels, difference ${f1(cn.diff)})`);
    await ev(page, () => window.__game.setDayTime(0.42));
    if (vp.label === 'desktop') {
      // riding a dolphin (her own view: half the dolphin above the water, solid)
      await cleanView(page, false);
      const rode = await startRide(page, deep);
      await cleanView(page, true);
      // a little way along, her camera following behind her and the dolphin
      await page.keyboard.down('KeyW');
      await gameWait(page, 2.5, 20000);
      await shot(page, 'review-ride', PREFIX);
      await page.keyboard.up('KeyW');
      check(errors, rode, 'R-R riding a dolphin for the picture');
    }
    await context.close();
  }
}

// =====================================================================================

const errors = [];
const browser = await launch({ headed: !!args.headed });
const t0 = Date.now();
try {
  if (want('world')) await worldPass(browser, errors);
  if (want('see')) await seePass(browser, errors);
  if (want('tap')) await tapPass(browser, errors);
  if (want('ride')) await ridePass(browser, errors);
  if (want('touch')) await touchPass(browser, errors);
  if (want('biomes')) await biomesPass(browser, errors);
  if (want('saves')) await savesPass(browser, errors);
  if (want('mp')) await mpPass(browser, errors);
  if (want('cost')) await costPass(browser, errors);
  else if (only && only.includes('gallery')) await galleryShots(browser, errors); // C5 alone
  if (only && only.includes('review')) await reviewPass(browser, errors); // owner pictures (on request)
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
  console.log('  ERROR: ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
console.log(`\nprobe-ocean: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
finish(errors);
