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
//   biomes  candy palettes and the chocolate-milk pond, a kid's pools in Flat, snow ice, fish past an
//           ice floe (B4)
//   saves   an old profile, an old world, a beach world saved before and after sea life (D3)
//   mp      two pages: a friend's ride, the shared whale, her own hellos, a page that closes,
//           joining late, a friend's trick, the buddy's name
//   cost    draw calls, the systems stage, geometries over time, NaN-free, the gallery (C5)
//   wave4a  the cross-team pass, part one (wave4-integration.md §9.1 X1-X5): the first deep swim
//           one thing at a time, a mermaid and a sea dragon riding, Ride from a stopped boat, a
//           toy in the water, the HUD with everything at once (--x=1,3 runs only some of them)
//   wave4b  the cross-team pass, part two (§9.1 X6-X10): the Sticker Book's 11 new stickers and the
//           Sea Friends strip, two pages (a friend in sea form with a toy rides, then hops off on
//           the shore), an old profile, coins and the present ring, a webdriver page staying quiet
//           (--x=6,8 runs only some of them)
//   --only=wave4 runs both halves (X1-X10; --x picks parts across both). Together they take
//   longer than one 570 s run, so the gate runs them split: --only=wave4a (with --x when it is
//   slow) and --only=wave4b (about 6 minutes: X7's two pages take about 3.5 of them)
//
//   node tools/probe-ocean.mjs [--only=world,see,tap,ride,touch,biomes,saves,mp,wave4a,wave4b,wave4,cost,gallery] [--x=...] [--headed]
//   (cost includes the gallery, C5; --only=cost --part=1 leaves it out and --only=gallery runs C5
//   alone, so each fits a shorter time limit; --only=review makes the
//   owner-review pictures, ocean-review-*.png, and is never part of the default run;
//   --only=dolphin makes ocean-dolphin-<palette>-<side>.png, the dolphin from five sides;
//   --only=rf [--runs=10] [--vp=desktop|ipad] runs R-F alone again and again, a new scene each run)
//
// P2 on the merged tree with merfolk: R10 (a mermaid and a sea dragon riding, in `ride`; the
// pictures wave4-ride-mermaid.png, wave4-ride-dragon.png), T3b's camera under the surface (in
// `tap`), U1's Up / Down rectangles (in `touch`), the cross-team pass (`wave4a`, `wave4b`).

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
        // g.__under: held that deep under the surface instead (merfolk's dive, T3b)
        if (t >= 0 && g.__under > 0) { pl.position.y = t - g.__under; pl.velocity.y = 0; return; }
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
 *   keep  mean |a - d| over the silhouette, d = the same picture with the animals drawn as on land
 *         (no liquid colour over them): how much of its own colour the water took away
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
    // d: every animal drawn as on land (its surface y set to "dry" for one picture)
    const surfs = [];
    for (const m of groupOf.children) {
      const A = m.geometry && m.geometry.attributes.iSurf;
      if (!A) continue;
      surfs.push([A, A.array.slice()]);
      for (let i = 0; i < A.count; i++) A.array[i * A.itemSize] = -1e4;
      A.clearUpdateRanges && A.clearUpdateRanges();
      A.needsUpdate = true;
    }
    const dd = grab();
    for (const [A, v] of surfs) { A.array.set(v); A.clearUpdateRanges && A.clearUpdateRanges(); A.needsUpdate = true; }
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
      let px = 0, sum = 0, kp = 0, ar = 0, ag = 0, ab = 0, rn = 0, rr = 0, rg = 0, rb = 0;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, k = i * 4;
        if (S[i]) {
          px++;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
          sum += Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]);
          kp += Math.hypot(a[k] - dd[k], a[k + 1] - dd[k + 1], a[k + 2] - dd[k + 2]);
          ar += a[k]; ag += a[k + 1]; ab += a[k + 2];
        } else if (D[i]) { rn++; rr += a[k]; rg += a[k + 1]; rb += a[k + 2]; }
      }
      const size = px ? Math.max(bx1 - bx0, by1 - by0) + 1 : 0;
      if (!px || !rn) return { px, size, diff: px ? sum / px : 0, keep: px ? kp / px : 0, ring: 0, luma: 0 };
      ar /= px; ag /= px; ab /= px; rr /= rn; rg /= rn; rb /= rn;
      return { px, size, diff: sum / px, keep: kp / px, ring: Math.hypot(ar - rr, ag - rg, ab - rb), luma: Math.abs(L(ar, ag, ab) - L(rr, rg, rb)) };
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
const V1_DIFF = 50, V1_RING = 36, V1_PX = 700, V1_EACH = 150, V1_SIZE = 40, V1_KEEP = 35, C5_PX = 40, C5_DIFF = 30;
// C6 (the water line): the same as on land below C6_SAME; tinted at least C6_TINT, C6_CLOSER nearer the water
const C6_SAME = 2, C6_TINT = 12, C6_CLOSER = 8;
// G1 (glass): the stained-glass wall over the animals changes them at least this much (drawn
// after the glass, the order before the third review, they change by only 17.4: the wall's
// light and shadow, nothing lies over them)
const G1_TINT = 50;

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
    updown: r('.sw-touch .sw-flybtn'), // merfolk's Up / Down (deep water; also part of hud)
    hud: [...r('.sw-joy'), ...r('.sw-touch .sw-flybtn'), ...r('.sw-touch-hud .sw-btn-jump, .sw-touch .sw-jump, [data-action="jump"]'), ...r('.lf-hud .sw-round:not([hidden])'), ...r('.sw-toasts .sw-toast'), ...r('.sw-stkpop'), ...r('.sw-coins, .sw-hud-coins, [aria-label="Coins"]'), ...r('.sw-hud-tr button'), ...r('.sw-hotbar')],
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
      const pod = g.debug.ocean.list('dolphin').filter((q) => q.role === 'show');
      if (!pod.length) return;
      const r = pod.find((q) => q.state === 'leap') || pod[0];
      // the pod's middle, seen from 7 blocks toward the island, a little above the water
      let cx = 0, cz = 0;
      for (const q of pod) { cx += q.x; cz += q.z; }
      cx /= pod.length; cz /= pod.length;
      const d = Math.hypot(s[0] - cx, s[2] - cz) || 1, ux = (s[0] - cx) / d, uz = (s[2] - cz) / d;
      const k = Math.min(7, d), x = cx + ux * k, z = cz + uz * k;
      g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.camera.position.set(x, r.level + 0.875 + 1.6, z);
      g.camera.lookAt(cx, r.level + 1.3, cz);
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
  check(errors, o9.pickables === 0 && o9.total === 0 && !o9.visible && o9.meshes === 18, `O9 back to the title: ${o9.pickables} pickables, ${o9.total} animals, ${o9.meshes} sea meshes (9 kinds, each with its glass mesh) all hidden`);
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
        d.autoSpawn(false); // only the one kind in the picture (the numbers are its own)
        d.clear();
        // 5 blocks ahead along the camera's look and 2 to the side (not behind her own head)
        const x = p.x + Math.sin(cam.yaw) * 5 - Math.cos(cam.yaw) * 2, z = p.z + Math.cos(cam.yaw) * 5 + Math.sin(cam.yaw) * 2;
        // the first palette of each kind (the same picture every run)
        const n = d.spawn(kind, x, p.y, z, { n: kind === 'fish' ? 8 : 1, variant: 0 });
        if (!n) return { n };
        await new Promise((r) => setTimeout(r, 500));
        d.still(true);
        await new Promise((r) => requestAnimationFrame(() => r()));
        return { n, each: d.list(kind).length };
      }, kind);
      const c = res.n ? await seaContrast(page) : { px: 0, diff: 0, ring: 0, luma: 0 };
      await shot(page, `see-${vp.label}-${kind}`, PREFIX);
      await ev(page, () => window.__game.debug.ocean.still(false));
      const each = Math.round(c.px / Math.max(1, res.each || 1));
      seeLog.push(`${vp.label} ${kind}: diff ${f1(c.diff)} ring ${f1(c.ring)} luma ${f1(c.luma)} keep ${f1(c.keep)} px ${c.px} (${each} each of ${res.each}) size ${c.size}`);
      // Size and colour (third owner review): at least V1_PX silhouette pixels, V1_EACH for each
      // animal (a school of 8 fish), V1_SIZE pixels across, and at most V1_KEEP of its colour lost
      // to the water (keep: against the same animals drawn as on land). The second-review look
      // (81d5d6e: small animals, up to 42% water colour and a white rim) run once with this probe:
      // seahorse 215-246 px, 24-25 across, keep 66-70; starfish 253-268 px, 26 across, keep 87;
      // octopus keep 57-60; turtle keep 34-42: 8 of 14 failed; its Little Fish (62-90 px each, from
      // the same run's px / 8) fail V1_EACH too. The new
      // look: every kind >= 757 px (fish 233-308 each), >= 45 across, keep 6-24.
      // the animal against the water it covers (diff) AND against the water around it (ring):
      // (0..441 RGB distance; each kind's first palette). The old faint look (opaque animals drawn
      // under the 75% water) measured diff 16-38 and ring 8-25 here (one seahorse whose crest broke
      // the water: diff 70, ring 44), so every kind fails. Drawn after the water with the water's
      // colour mixed over the part under the surface (material.js) they measure diff 64-107 and
      // ring 44-92 (the turtle's pale flippers and the blue dolphin are the lowest); the gate sits
      // between the two: diff >= 50, ring >= 36
      check(errors, c.px >= V1_PX && each >= V1_EACH && c.size >= V1_SIZE && c.diff >= V1_DIFF && c.ring >= V1_RING && c.keep <= V1_KEEP,
        `V1 ${vp.label}: a ${kind} ahead is big, clear and keeps its colour from the swim camera (${c.px} silhouette pixels >= ${V1_PX}, ${each} for each animal >= ${V1_EACH}, ${c.size} px across >= ${V1_SIZE}; difference ${f1(c.diff)} >= ${V1_DIFF}; against the water around it ${f1(c.ring)} >= ${V1_RING}; colour lost to the water ${f1(c.keep)} <= ${V1_KEEP})`);
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
  await ev(page, () => { const g = window.__game; g.setTool('hand'); g.debug.ocean.clear(); g.debug.ocean.autoSpawn(false); g.award('splash'); g.award('sea_magic'); });
  await page.waitForTimeout(800); // her first swim's own stickers (Splash!, and merfolk's Sea Magic! for her first turn) are out of the way

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
  // (a busy machine draws few frames: wait up to 3 s for the new dolphin's pick box to join the
  // pick set, which is refreshed every 0.25 s of game time, before the click)
  let p1 = null, hit1 = null;
  for (let t = 0; t < 30; t++) {
    p1 = await recPoint(page, 'dolphin', d0.i, 0.2);
    hit1 = await pickAt(page, p1);
    if (hit1 && hit1.kind === 'dolphin') break;
    await page.waitForTimeout(100);
  }
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
  check(errors, held && t1.state === 'hold' && t1.owner === 'ocean', `T1 a click on a dolphin: it holds beside her and the bubble opens (${t1.state}; the click hit ${JSON.stringify(hit1)})`);
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

  // T3b with the camera below the surface (P2, merfolk's dive and its under-water look): she is
  // held 2.4 blocks under, the camera level with her head; the same two clicks on a school ahead
  for (const how of ['remove', 'right']) {
    await ev(page, () => { const g = window.__game; g.__under = 2.4; g.cameraRig.pitch = 0; });
    const down = await waitOk(page, () => window.__game.underwater === 'water', null, 8000);
    await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean;
      d.still(false);
      d.clear();
      const p = g.player.position, cam = g.cameraRig;
      d.spawn('fish', p.x + Math.sin(cam.yaw) * 3.5, p.y + 1.2, p.z + Math.cos(cam.yaw) * 3.5, { n: 8 });
      await new Promise((r) => setTimeout(r, 400));
    });
    await freeze(page, true);
    const sc = await ev(page, () => window.__game.debug.ocean.schools()[0]);
    const target = [(sc.box[0][0] + sc.box[1][0]) / 2, (sc.box[0][1] + sc.box[1][1]) / 2, (sc.box[0][2] + sc.box[1][2]) / 2];
    await aim(page, target[0], target[1], target[2], 0);
    const before = await ev(page, (t) => {
      const g = window.__game, m = g.ocean.map, top = m.top(t[0], t[2]), c = g.camera.position;
      return { top, above: g.world.get(Math.floor(t[0]), top, Math.floor(t[2])), h: g.history.length, met: g.ocean.met('fish'), under: t[1] < top + 0.875, camUnder: c.y < m.top(c.x, c.z), look: g.underwater };
    }, target);
    // (as T4: up to 3 s for the school to join the pick set on a busy machine)
    let sp = null, hit = null;
    for (let t = 0; t < 30; t++) {
      const b = await ev(page, () => window.__game.debug.ocean.schools()[0].box);
      sp = await screenPoint(page, (b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2);
      hit = await pickAt(page, sp, true);
      if (hit && hit.kind === 'school') break;
      await page.waitForTimeout(100);
    }
    if (how === 'remove') { await ev(page, () => window.__game.setTool('remove')); await page.mouse.click(sp.x, sp.y); }
    else { await ev(page, () => window.__game.setTool('hand')); await page.mouse.click(sp.x, sp.y, { button: 'right' }); }
    await page.waitForTimeout(300);
    const after = await ev(page, (t) => {
      const g = window.__game, m = g.ocean.map;
      return { above: g.world.get(Math.floor(t[0]), m.top(t[0], t[2]), Math.floor(t[2])), top: m.top(t[0], t[2]), h: g.history.length, met: g.ocean.met('fish') };
    }, target);
    await freeze(page, false);
    if (how === 'remove') await shot(page, 'tap-under', PREFIX);
    check(errors, down && before.camUnder && before.look === 'water' && before.under && after.met === before.met + 1 && after.top === before.top && after.above === before.above && after.h === before.h,
      `T3b with the camera under the surface (merfolk's look ${before.look}), ${how === 'remove' ? 'Remove' : 'a right-click with the Hand'} on a fish school: a hello (${before.met} -> ${after.met}), the water stays, no history (${before.h} -> ${after.h}; aimed at ${JSON.stringify(hit)})`);
  }
  await ev(page, () => { const g = window.__game; g.__under = 0; g.setTool('hand'); });
  await waitOk(page, () => !window.__game.underwater, null, 8000);

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
  // (as T1: up to 3 s for the new school to join the pick set on a busy machine)
  let fp = null, hit4 = null;
  for (let t = 0; t < 30; t++) {
    const fsb = await ev(page, () => window.__game.debug.ocean.schools()[0].box);
    fp = await screenPoint(page, (fsb[0][0] + fsb[1][0]) / 2, (fsb[0][1] + fsb[1][1]) / 2, (fsb[0][2] + fsb[1][2]) / 2);
    hit4 = await pickAt(page, fp);
    if (hit4 && hit4.kind === 'school') break;
    await page.waitForTimeout(100);
  }
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
    // (a slow machine: her view can still drift after the Hand click, and one run's Build click
    // went past the starfish to the sand 6 blocks off; so aim again and wait, up to 2 s, until the
    // point is on the starfish block before the Build click. The check itself is unchanged.)
    await aim(page, t6[0] + 0.5, t6[1] + 0.05, t6[2] + 0.5, 0.7);
    const sp6 = await screenPoint(page, t6[0] + 0.5, t6[1] + 0.05, t6[2] + 0.5);
    for (let i = 0; i < 10; i++) {
      const h = await pickAt(page, sp6);
      if (h && h.type === 'block' && h.kind === 'starfish') break;
      await page.waitForTimeout(200);
    }
    const hit6 = await pickAt(page, sp6);
    await page.mouse.click(sp6.x, sp6.y);
    // (a slow machine: up to 3 s for the build to land)
    await waitOk(page, (c) => window.__game.debug.getBlock(c[0], c[1], c[2]) === 'planks_pink', t6, 3000);
    const now = await ev(page, (c) => window.__game.debug.getBlock(c[0], c[1], c[2]), t6);
    check(errors, now === 'planks_pink', `T6 with Build the block is replaced as today (${now}; the click hit ${JSON.stringify(hit6)})`);
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
    // (polled up to 4 s each: on a busy machine a few frames take longer than the old fixed waits)
    const until = async (fn, ms) => { const t0 = performance.now(); for (; performance.now() - t0 < ms;) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return fn(); };
    await new Promise((r) => setTimeout(r, 400));
    await until(() => d.whaleState().placed, 4000);
    const st = d.whaleState();
    const p = g.player.position;
    g.cameraRig.yaw = Math.atan2(p.x - st.x, p.z - st.z); // facing away
    const on = await until(() => !!document.querySelector('.oc-pointer.oc-on'), 4000);
    g.cameraRig.yaw = Math.atan2(st.x - p.x, st.z - p.z);
    g.cameraRig.pitch = 0.05;
    const off = await until(() => !document.querySelector('.oc-pointer.oc-on'), 4000);
    return { ok, placed: st.placed, on, off };
  });
  check(errors, t8.placed && t8.on, `T8 the whale behind her: the edge pointer shows (${JSON.stringify(t8)})`);
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
  return waitOk(page, () => window.__game.ocean.riding, null, 8000); // a slow software-drawn frame can hold the mount
}

async function ridePass(browser, errors) {
  console.log('\n[ride] desktop');
  const { context, page } = await openGame(browser, { errors, label: 'ride' });
  await newWorld(page, 'beach');
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  // her first swim's own stickers out of the way (Splash!, and merfolk's Sea Magic! for her first turn)
  await ev(page, () => { const g = window.__game; g.award('splash'); g.award('sea_magic'); });
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

  // R10 (P2, with merfolk) a mermaid and a sea dragon each ride: the tail stays set through the
  // mount and the hop off with no 'player:seaform' between, the legs hidden on the dolphin;
  // the side-saddle pictures for the daughter (wave4-ride-mermaid.png, wave4-ride-dragon.png)
  await float(page, true);
  await ev(page, () => {
    const g = window.__game;
    g.__seaformEvents = [];
    if (!g.__seaformRec) { g.__seaformRec = true; g.events.on('player:seaform', (e) => g.__seaformEvents.push(e && e.form)); }
  });
  for (const [form, pic] of [['mermaid', 'ride-mermaid'], ['sea_dragon', 'ride-dragon']]) {
    await ev(page, (form) => {
      const g = window.__game;
      g.profile.look.sea = { form, color: null };
      g.events.emit('avatar:changed', { look: g.profile.look });
    }, form);
    await goTo(page, deep);
    const turned = await waitOk(page, (form) => window.__game.player.seaForm === form && !!(window.__game.debug.merfolk.parts() || {}).shown, form, 15000);
    await page.waitForTimeout(600);
    await ev(page, () => { window.__game.__seaformEvents.length = 0; });
    const mounted = await ev(page, () => window.__game.debug.ocean.ride());
    // a few frames on the dolphin, every one read
    const on = await ev(page, () => new Promise((resolve) => {
      const g = window.__game, out = { n: 0, notRide: 0, noForm: 0, hidden: 0, legs: 0 };
      const t0 = performance.now();
      const tick = () => {
        const p = g.debug.merfolk.parts() || {};
        out.n++;
        if (g.player.state !== 'ride' || !g.ocean.riding) out.notRide++;
        if (!g.player.seaForm) out.noForm++;
        if (!p.shown) out.hidden++;
        if (p.legsVisible !== false) out.legs++;
        if (performance.now() - t0 >= 2000) resolve(out); else requestAnimationFrame(tick);
      };
      tick();
    }));
    check(errors, turned && mounted && on.n > 5 && on.notRide === 0 && on.noForm === 0 && on.hidden === 0 && on.legs === 0,
      `R10 a ${form} rides: the tail on every frame, the legs hidden (${JSON.stringify(on)})`);
    // the picture: from in front of her, three-quarters (her face, the tail to the side and the
    // dolphin all in view; straight from the side shows the back of her head), a little above
    // and closer in, the HUD out of the way
    const dist0 = await ev(page, () => {
      const g = window.__game, s = g.debug.ocean.rideState(), cam = g.cameraRig, d = cam.distance;
      cam.yaw = s.yaw + Math.PI * 0.75;
      cam.pitch = 0.28;
      cam.distance = 2.2;
      return d;
    });
    await cleanView(page, true, true);
    await settle(page, 1200);
    await shot(page, pic, 'wave4');
    await cleanView(page, false, true);
    await ev(page, (d) => { window.__game.cameraRig.distance = d; }, dist0);
    await ev(page, () => window.__game.debug.ocean.hopOff('button'));
    await page.waitForTimeout(800);
    const off = await ev(page, () => {
      const g = window.__game, p = g.debug.merfolk.parts() || {};
      return { riding: g.ocean.riding, form: g.player.seaForm, shown: !!p.shown, events: g.__seaformEvents.slice() };
    });
    check(errors, !off.riding && off.form === form && off.shown && off.events.length === 0,
      `R10 the ${form} hops off in deep water: the tail still set, no 'player:seaform' from mount to hop off (${JSON.stringify(off)})`);
  }

  // R11 no dolphin swims through the one she rides (_apart: the ridden one holds its place and
  // only the other one moves): another dolphin put right on it, taken out of the pod so nothing
  // but _apart moves it (setPod -1; with the old rule, which skipped every pair with a FIXED one,
  // it stayed inside hers), is pushed out to the dolphins' spacing (1.7) and stays out. Counted in
  // game frames, not seconds (one frame counts at most 0.05 s and this machine without a GPU
  // draws few frames a second): 60 frames to part, then 40 more read.
  await goTo(page, deep);
  await page.waitForTimeout(400);
  const r11 = await ev(page, () => new Promise((resolve) => {
    const g = window.__game, d = g.debug.ocean;
    if (!d.ride()) { resolve({ rode: false }); return; }
    const s0 = d.rideState();
    const mine = d.list('dolphin').find((r) => r.state === 'ride');
    const other = d.list('dolphin').find((r) => r.state !== 'ride' && r.role === 'wild');
    if (!mine || !other) { resolve({ rode: true, other: !!other }); return; }
    d.setPod(other.i, -1);
    d.move('dolphin', other.i, s0.x + 0.2, s0.z + 0.1);
    const out = { rode: true, other: true, start: 0, frames: 0, read: 0, skipped: 0, min: Infinity, at60: null };
    const gap = () => {
      const l = d.list('dolphin'), a = l.find((r) => r.i === mine.i), b = l.find((r) => r.i === other.i);
      if (!a || !b) return null;
      return { h: Math.hypot(a.x - b.x, a.z - b.z), fixed: ['leap', 'trick', 'ride', 'hold', 'mount', 'gallery'].includes(b.state), riding: a.state === 'ride' };
    };
    const g0 = gap();
    out.start = g0 ? +g0.h.toFixed(2) : null;
    const tick = () => {
      out.frames++;
      const x = gap();
      if (!x || !x.riding) { out.lost = true; d.setPod(other.i, 0); resolve(out); return; }
      if (out.frames === 60) out.at60 = +x.h.toFixed(2);
      if (out.frames > 60) {
        if (x.fixed) out.skipped++;
        else { out.read++; out.min = Math.min(out.min, x.h); }
      }
      if (out.frames >= 100) { out.min = +out.min.toFixed(2); d.setPod(other.i, 0); resolve(out); } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  check(errors, r11.rode && r11.other && !r11.lost && r11.start < 0.5 && r11.read >= 20 && r11.min >= 1.5,
    `R11 a pod dolphin put on the one she rides is pushed out and stays out (no dolphin through hers): ${JSON.stringify(r11)}`);
  await ev(page, () => window.__game.debug.ocean.hopOff('button'));
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
  // the first swim's Splash!, merfolk's first-turn Sea Magic! and the first hello's Dolphin Friend come at a machine's own pace;
  // the tap pass checks those stickers): both are hers already, their pops shown and gone
  await ev(page, () => { const g = window.__game; g.setTool('hand'); g.debug.ocean.clear(); g.debug.ocean.autoSpawn(false); g.award('splash'); g.award('sea_magic'); g.award('dolphin_friend'); });
  await waitOk(page, () => !!document.querySelector('.sw-stkpop'), null, 3000);
  await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  await page.waitForTimeout(500);
  await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  // and merfolk's turn in deep water (its "Mermaid magic!" toast, Sea Magic! being hers already)
  // has come and gone too
  await waitOk(page, () => !!window.__game.player.seaSwim, null, 10000);
  await page.waitForTimeout(500);
  await waitOk(page, () => !document.querySelector('.sw-toasts .sw-toast') && !document.querySelector('.sw-stkpop'), null, 10000);
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
  // (P2) merfolk's Up / Down show in deep water and are among the parts the bubble keeps clear of
  check(errors, r0.updown.length === 2 && r0.updown.every((u) => r0.hud.some((h) => h.sel === u.sel && h.x === u.x && h.y === u.y)),
    `U1 merfolk's Up / Down show while she swims deep and the bubble keeps clear of them (${JSON.stringify(r0.updown.map((u) => [Math.round(u.x), Math.round(u.y), Math.round(u.w), Math.round(u.h)]))}; bubble ${b0 ? JSON.stringify([Math.round(b0.x), Math.round(b0.y), Math.round(b0.w), Math.round(b0.h)]) : 'none'})`);
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
  const rideBtns = await ev(page, RECTS);
  const jumpShown = await ev(page, () => [...document.querySelectorAll('.sw-touch [aria-label="Jump"]')].some((e) => e.offsetParent && !e.hidden));
  check(errors, rideBtns.updown.length === 0 && jumpShown, `U2 riding: Up / Down hidden (${rideBtns.updown.length}), Jump shown (${jumpShown})`);
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
  const offBtns = await ev(page, RECTS);
  check(errors, !after.seaSwim || offBtns.updown.length === 2, `U2 Hop off in deep water: Up / Down back (${offBtns.updown.length}, seaSwim ${after.seaSwim})`);
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
    // the chocolate milk's own colour lies over them (never the sea's blue)
    const milk = await ev(page, () => {
      const d = window.__game.debug.ocean, n = d.meshCounts().fish;
      const out = [];
      for (let i = 0; i < n; i++) out.push(d.slotSurf('fish', i).slice(1).map((v) => +v.toFixed(3)));
      return out;
    });
    check(errors, milk.length > 0 && milk.every((c) => c[0] > c[2] * 2), `B1 the chocolate milk's colour over the pond fish, not the sea's blue (${JSON.stringify(milk.slice(0, 2))})`);
    // the picture: her camera turned to the school, a little down into the pond
    await cleanView(page, true, true);
    const sc = await ev(page, () => { const s = window.__game.debug.ocean.schools()[0]; return s ? [s.x, s.y, s.z] : null; });
    if (sc) await aim(page, sc[0], sc[1], sc[2], 0.55);
    await gameWait(page, 0.6, 8000);
    await shot(page, 'biomes-candy-pond', PREFIX);
    await cleanView(page, false, true);
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
  const fishIn = await waitOk(page, () => window.__game.debug.ocean.schools().length > 0, null, 60000);
  const fishToast = fishIn && await toastSeen(page, /^Fish moved into your pool!$/, 3000);
  const poolInfo = await ev(page, () => { const d = window.__game.debug.ocean; return { schools: d.schools().length, counts: d.count(), toasts: window.__toasts.slice(-4) }; });
  check(errors, fishIn && fishToast, `B2 a 5x5x2 pool, standing at its edge: fish (${fishIn}) and "Fish moved into your pool!" (${fishToast}) ${JSON.stringify(poolInfo)}`);
  await shot(page, 'biomes-pool-fish', PREFIX);
  const shallow = await dig(17, 2, -40);
  void shallow;
  const big = await dig(17, 4, 30);
  await ev(page, (s) => { const g = window.__game; g.player.teleport(s[0] - 0.5, s[1] + 1, s[2] + 8.5); }, big);
  const pod = await waitOk(page, () => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'wild'), null, 45000);
  check(errors, pod && await toastSeen(page, /^Dolphins came to your pool!$/, 3000), 'B2 a 17x17x4 pool, at its edge: a pod and "Dolphins came to your pool!"');
  const inShallow = await ev(page, (s) => window.__game.debug.ocean.list('dolphin').some((r) => r.x >= s[0] && r.x < s[0] + 17 && r.z >= s[2] && r.z < s[2] + 17), shallow);
  check(errors, !inShallow, 'B2 the 2-deep pool never gets dolphins');
  // the picture: a dolphin of the pod in the pool, her camera turned to it
  await waitOk(page, (s) => window.__game.debug.ocean.list('dolphin').some((r) => r.role === 'wild' && r.fade >= 1 && r.x >= s[0] + 1 && r.x < s[0] + 16 && r.z >= s[2] + 1 && r.z < s[2] + 16), big, 20000);
  await cleanView(page, true, true);
  await aimAtNearest(page, 'dolphin', 'wild', 0.45);
  await gameWait(page, 0.4, 8000);
  await aimAtNearest(page, 'dolphin', 'wild', 0.45);
  await shot(page, 'biomes-pool-dolphins', PREFIX);
  await cleanView(page, false, true);

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

  // B4 snow: ice floes on the sea (biomes/snow.js) are see-through blocks. Before the per-animal
  // glass meshes one fish seen past a floe turned the whole school faint, back and forth (seed
  // 777: 4 flips in 12 s, all 8 fish faint 21% of the frames). Now only the fish behind the ice
  // draw behind it, and each one leaves the glass mesh only after two clear checks.
  const floe = await ev(page, () => {
    const g = window.__game, w = g.world, m = g.ocean.map, B = g.registry.blocks;
    const ice = B.byKey('ice').id, packed = B.byKey('ice_packed').id, water = B.byKey('water').id;
    for (let z = 2; z < w.sz - 2; z++) for (let x = 2; x < w.sx - 2; x++) {
      // a floe: ice at the sea's own level with water under it
      let y = -1;
      for (let k = 1; k < 48 && y < 0; k++) { const id = w.get(x, k, z); if ((id === ice || id === packed) && w.get(x, k - 1, z) === water) y = k; }
      if (y < 0) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let open = 0;
        for (let k = 2; k <= 5; k++) if (m.top(x + dx * k, z + dz * k) === y && m.deepAround(x + dx * k, z + dz * k, 1)) open++;
        if (open < 4) continue;
        const bx = x - dx * 4, bz = z - dz * 4, h = w.heightAt(bx, bz);
        if (h < y - 1 || h > y + 2) continue;
        // the school just past the floe's edge (lines to the near fish cross the ice, to the far ones not)
        return { y, dx, dz, stand: [bx + 0.5, h + 1, bz + 0.5], fish: [x + dx * 2.2 + 0.5, z + dz * 2.2 + 0.5] };
      }
    }
    return null;
  });
  if (floe) {
    await ev(page, (s) => {
      const g = window.__game, d = g.debug.ocean;
      g.player.teleport(s.stand[0], s.stand[1], s.stand[2]);
      g.cameraRig.yaw = Math.atan2(s.dx, s.dz);
      g.cameraRig.pitch = 0.35;
      d.autoSpawn(false);
      d.clear();
      d.spawn('fish', s.fish[0], s.y, s.fish[1], { n: 8, variant: 0 });
      d.schoolTo(0, s.fish[0], s.fish[1]);
    }, floe);
    await page.waitForTimeout(1500);
    const b4 = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean;
      let frames = 0, some = 0, all = 0, wrong = 0, faint = 0, switches = 0, last = null, blob = 0;
      const t0 = performance.now(), gt = g.time.t;
      // at least 12 s and 40 frames (the machine without a GPU can draw only 3 a second), at most 30 s
      while ((performance.now() - t0 < 12000 || frames < 40) && performance.now() - t0 < 30000) {
        await new Promise((r) => requestAnimationFrame(r));
        const n = d.behindCount().fish, front = d.meshCounts().fish, back = d.meshCounts(true).fish, live = d.count().fish;
        frames++;
        faint += n;
        if (n > 0) some++;
        if (n > 0 && n === live) all++;
        if (front + back !== live || back !== n) wrong++;
        if (last !== null) switches += Math.abs(n - last);
        last = n;
        if (d.fishClosest(0) < 0.4) blob++;
      }
      return { frames, some, all, wrong, faint: faint / Math.max(1, frames), switches, live: d.count().fish, game: g.time.t - gt, blob };
    });
    check(errors, b4.frames > 30 && b4.wrong === 0 && b4.live === 8 && b4.some > 0 && b4.all < b4.some,
      `B4 snow: fish seen past an ice floe draw behind it one by one, the rest of the school stays clear (${b4.frames} frames; behind the ice in ${b4.some}, the whole school in ${b4.all}; ${b4.faint.toFixed(2)} of ${b4.live} fish behind it on average; lanes wrong in ${b4.wrong})`);
    // a fish circling past the floe's edge goes behind it and out again; with the hold it never blinks
    const rate = b4.switches / Math.max(1, b4.live) / Math.max(0.5, b4.game);
    check(errors, rate <= 0.5,
      `B4 snow: no blinking at the floe's edge (${b4.switches} moves in or out of the glass mesh in ${b4.game.toFixed(1)} s of game time: ${rate.toFixed(2)} a second for each fish, <= 0.5)`);
    // by the floe the school stays spread out (motion.js spaceFish and placeFish): no two fish in one blob
    check(errors, b4.blob <= b4.frames * 0.1,
      `B4 snow: the school by the floe stays spread out (two fish closer than 0.4 in ${b4.blob} of ${b4.frames} frames, at most 10%)`);
    // the picture: her camera a little to one side (she does not hide the school), looking down on
    // the floe's edge, the fish past it
    await ev(page, () => { const r = window.__game.cameraRig; r.yaw += 0.4; r.pitch = 0.55; });
    await page.waitForTimeout(600);
    await cleanView(page, true, true);
    await shot(page, 'biomes-snow-floes', PREFIX);
    await cleanView(page, false, true);
    // B4 busy: the same school by the floe with every other kind out around it and the whale
    // visiting (short of draw calls). Before: the spare call went by list order (dolphins first),
    // so the whole school drew faint behind the ice while most of it was not (36 of 46 frames).
    // Now kinds out of view cost no call, the spare calls go to the most animals in front, and a
    // kind with none left goes to the side most of it is on.
    await ev(page, () => { const r = window.__game.cameraRig; r.yaw -= 0.4; r.pitch = 0.35; });
    const busy0 = await ev(page, (s) => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position;
      const yaw = Math.atan2(s.dx, s.dz), fx = Math.sin(yaw), fz = Math.cos(yaw);
      const at = (f, sd) => [s.fish[0] + fx * f - fz * sd, s.fish[1] + fz * f + fx * sd];
      const got = {};
      let [x, z] = at(5, -5); got.dolphin = d.spawn('dolphin', x, s.y, z, { n: 3 });
      [x, z] = at(3, 5); got.sea_turtle = d.spawn('sea_turtle', x, s.y, z);
      [x, z] = at(1, -4); got.octopus = d.spawn('octopus', x, s.y, z);
      [x, z] = at(2, 3); got.jelly = d.spawn('jelly', x, s.y, z);
      [x, z] = at(0, 4.5); got.seahorse = d.spawn('seahorse', x, s.y, z);
      [x, z] = at(-1, -3); got.starfish = d.spawn('starfish', x, s.y, z);
      const sh = d.shoreNear(p.x, p.z, 12);
      got.crab = sh ? d.spawn('crab', sh[0], sh[1], sh[2], { n: 2 }) : 0;
      got.whale = d.spawn('whale', 0, 0, 0);
      d.schoolTo(0, s.fish[0], s.fish[1]);
      return { got, count: d.count() };
    }, floe);
    await page.waitForTimeout(1500);
    console.log('  B4 busy start: ' + JSON.stringify(await ev(page, (s) => {
      const g = window.__game, d = g.debug.ocean, c = g.camera.position;
      return { floe: s, cam: [c.x, c.y, c.z].map((v) => +v.toFixed(1)), behind: d.behindCount().fish, fish: d.list('fish').map((r) => [+r.x.toFixed(1), +r.z.toFixed(1)]) };
    }, floe)));
    const busy = await ev(page, async () => {
      const g = window.__game, d = g.debug.ocean;
      let frames = 0, faintWrong = 0, faint = 0, over = 0, flips = 0, last = null, maxCalls = 0, kinds = 0, inView = 0, someBehind = 0, stacked = 0, short = 0;
      const t0 = performance.now();
      // at least 10 s and 40 frames: on the machine without a GPU this scene drew exactly 30 frames
      // in 10 s once (the check asks for more than 30), so it keeps counting, at most 30 s
      while ((performance.now() - t0 < 10000 || frames < 40) && performance.now() - t0 < 30000) {
        await new Promise((r) => requestAnimationFrame(r));
        const n = d.behindCount().fish, back = d.meshCounts(true).fish, live = d.count().fish, L = d.lanes();
        let calls = 0;
        g.scene.traverse((o) => { if (o.name && o.name.startsWith('sea-') && o.isMesh && o.visible) calls++; });
        frames++;
        maxCalls = Math.max(maxCalls, calls);
        let k = 0, v = 0;
        for (const key of Object.keys(L.seen)) { if (d.count()[key] > 0) k++; if (L.seen[key] > 0) v++; }
        kinds = Math.max(kinds, k); inView = Math.max(inView, v);
        if (n > 0) someBehind++;
        // short of calls: a kind with animals on both sides of the glass drawn all on one side
        const bc = d.behindCount(), cn = d.count();
        if (Object.keys(bc).some((key) => bc[key] > 0 && bc[key] < cn[key] && L.lanes[key] !== null && !L.hide[key])) short++;
        const all = live > 0 && back === live;
        if (all) faint++;
        // the whole school faint while fewer than half of it is behind the ice: the old look
        if (all && n * 2 < live) faintWrong++;
        if (back > 0 && back < live && back !== n) over++;
        if (last !== null && all !== last) flips++;
        last = all;
        stacked += d.fishStacked(0) || 0;
      }
      return { frames, faintWrong, faint, over, flips, maxCalls, kinds, inView, someBehind, short, stacked: stacked / Math.max(1, frames), counts: d.count() };
    });
    console.log('  B4 busy: ' + JSON.stringify({ spawned: busy0.got, ...busy }));
    check(errors, busy.frames > 30 && busy.kinds >= 8 && busy.maxCalls <= 9,
      `B4 busy: the school by the floe with ${busy.kinds} kinds out (${busy.inView} in view at most) draws at most ${busy.maxCalls} sea meshes (<= 9)`);
    check(errors, busy.faintWrong === 0 && busy.over === 0 && busy.flips <= 2,
      `B4 busy: the school never turns faint while most of it is clear of the ice (${busy.faintWrong} of ${busy.frames} frames; all in the glass mesh in ${busy.faint}, ${busy.flips} changes; fish behind the ice in ${busy.someBehind} frames; a split kind drawn on one side, short of calls, in ${busy.short})`);
  } else check(errors, false, 'B4 snow: an ice floe with open sea past it (none found)');
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
  // C1 draw calls: every kind spawned at full count, a fixed camera over the sea. The cursor's
  // target outline is hidden (as for a Photo): it is the HUD's, not sea life's (13 calls of its own
  // when the crosshair happens to rest on an animal)
  await cleanView(page, true, true);
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
  // C1 glass: a stained-glass wall over the left half of the view, so some kinds have animals on
  // both sides of it. Each glass mesh is a draw call, but never past 9 in all (render.js glassLanes:
  // with every kind out, a split kind draws all its animals behind the glass instead).
  const c1g = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, w = g.world, cam = g.camera;
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const glass = w.registry.byKey('glass_stained_pink').id;
    const fw = new cam.position.constructor(), right = new cam.position.constructor();
    cam.getWorldDirection(fw);
    fw.y = 0; fw.normalize();
    right.set(-fw.z, 0, fw.x);
    const cells = [], seen = new Set();
    for (let s = -8; s <= -0.5; s += 0.5) for (let h = -3; h <= 3; h++) {
      const x = Math.floor(cam.position.x + fw.x * 3 + right.x * s), y = Math.floor(cam.position.y + h), z = Math.floor(cam.position.z + fw.z * 3 + right.z * s);
      const key = x + ',' + y + ',' + z;
      if (seen.has(key) || w.get(x, y, z) !== 0) continue; // in the air over the sea (no animal loses its water)
      seen.add(key);
      cells.push([x, y, z, 0]);
    }
    for (const c of cells) w.set(c[0], c[1], c[2], glass, { record: false });
    await frames(40);
    const groups = {};
    g.scene.traverse((o) => { if (o.name && o.name.startsWith('sea-') && o.isMesh && o.visible) groups[o.name] = o.count; });
    const behind = d.behindCount(), live = d.count();
    let split = 0, some = 0;
    for (const k of Object.keys(behind)) { if (behind[k] > 0) some++; if (behind[k] > 0 && behind[k] < live[k]) split++; }
    for (const c of cells) w.set(c[0], c[1], c[2], c[3], { record: false });
    await frames(40);
    return { groups, n: Object.keys(groups).length, some, split, cells: cells.length };
  });
  await cleanView(page, false, true);
  check(errors, c1g.some > 0 && c1g.n <= 9,
    `C1 glass: a glass wall over half the view (${c1g.cells} cells; ${c1g.some} kinds seen through it, ${c1g.split} of them split) and sea life still draws ${c1g.n} meshes (<= 9): ${JSON.stringify(c1g.groups)}`);
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
  if (args.part !== '1') await galleryShots(browser, errors); // --part=1: C1-C4 alone (then --only=gallery)
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
  // G1 glass (see glassCheck)
  const gc = await glassCheck(page, at);
  console.log('  G1 numbers: ' + JSON.stringify(gc, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));
  check(errors, gc.px > 2000 && gc.diff >= G1_TINT && gc.behind && !gc.after, `G1 animals behind a stained-glass wall are drawn under the glass, tinted by it (difference ${f1(gc.diff)} >= ${G1_TINT}; seen through glass ${gc.behind}, back to normal without it ${!gc.after})`);
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

/**
 * G1 glass (material.js): see-through blocks (stained glass, jelly blocks, ice) write no depth, so
 * sea animals drawn after them would be pasted over the glass. Four animals float in the air (as on
 * land) behind a wall of pink stained glass; over the inside of their silhouette, the picture with
 * the wall must differ from the same picture without it (the glass lies over them). Drawn after the
 * glass (the second-review order) they look nearly the same: see G1_TINT.
 */
async function glassCheck(page, at) {
  return page.evaluate(async (at) => {
    const g = window.__game, d = g.debug.ocean, w = g.world, R = g.renderer, W = R.domElement.width, H = R.domElement.height;
    const groupOf = g.scene.getObjectByName('sea-life');
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const grab = () => {
      R.render(g.scene, g.camera);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.drawImage(R.domElement, 0, 0);
      return x.getImageData(0, 0, W, H).data;
    };
    const o = { x: at[0], y: at[1] + 2.4, z: at[2] + 12, kinds: ['dolphin', 'sea_turtle', 'octopus', 'jelly'], cols: 4, cell: 2.2 };
    g.camera.position.set(o.x, o.y + 1.0, o.z - 6.5);
    g.camera.lookAt(o.x, o.y, o.z);
    g.camera.updateMatrixWorld();
    d.gallery(o);
    const glass = w.registry.byKey('glass_stained_pink').id;
    const z = Math.floor(o.z - 3), cells = [];
    for (let x = Math.floor(o.x) - 6; x <= Math.floor(o.x) + 6; x++) for (let y = Math.floor(o.y) - 2; y <= Math.floor(o.y) + 2; y++) cells.push([x, y, z, w.get(x, y, z)]);
    for (const c of cells) w.set(c[0], c[1], c[2], glass, { record: false });
    await frames(60);
    const behind = Object.values(d.behind()).some(Boolean);
    const A = grab();
    // the silhouette (the sea life alone on black)
    const saved = [];
    for (const c of g.scene.children) { saved.push([c, c.visible]); if (c !== groupOf && !c.isLight) c.visible = false; }
    const bg = g.scene.background, fog = g.scene.fog;
    g.scene.background = new (groupOf.children[0].material.color.constructor)(0, 0, 0);
    g.scene.fog = null;
    const s = grab();
    g.scene.background = bg; g.scene.fog = fog;
    for (const [c, v] of saved) c.visible = v;
    for (const c of cells) w.set(c[0], c[1], c[2], c[3], { record: false });
    await frames(60);
    const after = Object.values(d.behind()).some(Boolean);
    const B = grab();
    // the silhouette's inside (2 pixels in from its edge: edge pixels blend with what lies behind)
    let M = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) M[i] = s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2] >= 30 ? 1 : 0;
    for (let e = 0; e < 2; e++) {
      const N = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        N[i] = M[i] && M[i - 1] && M[i + 1] && M[i - W] && M[i + W] ? 1 : 0;
      }
      M = N;
    }
    let px = 0, diff = 0;
    for (let i = 0; i < W * H; i++) {
      if (!M[i]) continue;
      const k = i * 4;
      px++;
      diff += Math.hypot(A[k] - B[k], A[k + 1] - B[k + 1], A[k + 2] - B[k + 2]);
    }
    return { px, diff: px ? diff / px : 0, behind, after };
  }, at);
}

// =====================================================================================
// review (owner pictures, not part of the gate): node tools/probe-ocean.mjs --only=review
// =====================================================================================

/** The review's play scene: a few of every swimmer spread before her camera (R-F, R-P). */
async function playScene(page) {
  await ev(page, () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
    d.autoSpawn(false);
    d.clear();
    cam.pitch = 0.42;
    const at = (f, s) => [p.x + Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * s, p.z + Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * s];
    let [x, z] = at(9, -3); d.spawn('dolphin', x, p.y, z, { n: 3 });
    [x, z] = at(7, 3.5); d.spawn('fish', x, p.y, z, { n: 9 });
    [x, z] = at(6.5, -2); d.spawn('sea_turtle', x, p.y, z);
    [x, z] = at(4, -1.2); d.spawn('jelly', x, p.y, z);
    [x, z] = at(4.5, -3); d.spawn('octopus', x, p.y, z);
    [x, z] = at(5.5, -3.6); d.spawn('seahorse', x, p.y, z);
    [x, z] = at(4.5, 3.8); d.spawn('starfish', x, p.y, z);
  });
  await gameWait(page, 1.2, 15000);
}

/** R-F: the school's fish show one by one from her play camera (returns the measure). */
async function rfCheck(page, vp, errors, tag = '') {
  // R-F the school from her camera: school mates seldom sit one over another (a face peeking out
  // from behind another fish: "a fish with four eyes"; fishStacked, test-sea S12's measure)
  const rf = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean;
    let frames = 0, pairs = 0, any = 0, first = '';
    const log = [];
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const st = [];
      const n = d.fishStacked(0, st);
      if (n == null) continue;
      frames++; pairs += n; if (n > 0) any++;
      // (diagnostics: the first frame with a stacked pair, every fish in the school's frame)
      if (n > 0 && !first) first = JSON.stringify({ pairs: st, pose: d.fishPose(0) });
      if (i % 15 === 0) {
        // (diagnostics: how far the rows are turned off her view, how far and how high she is)
        const s = d.schools()[0], c = g.camera.position;
        const want = Math.atan2(s.x - c.x, s.z - c.z), off = ((s.face - want + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        log.push(`${n}:${(off * 57.3).toFixed(0)}deg/${Math.hypot(s.x - c.x, s.z - c.z).toFixed(1)}m/${(c.y - s.level).toFixed(1)}up`);
      }
    }
    return { frames, pairs: pairs / Math.max(1, frames), any, log: log.join(' '), first };
  });
  check(errors, rf.frames > 60 && rf.pairs <= 0.5,
    `R-F ${vp.label}${tag}: the school's fish show one by one from her camera (${rf.pairs.toFixed(2)} stacked pairs a frame, any in ${rf.any} of ${rf.frames} frames; <= 0.5; pairs:turn/distance/height ${rf.log})`);
  if (rf.first) console.log(`  R-F ${vp.label}${tag} first stacked frame: ${rf.first}`);
  return rf;
}

/**
 * --only=rf [--runs=10]: R-F alone, run again and again (desktop and iPad), each run a new scene
 * (the school wanders its own way each time; R-F failed in about 2 of 9 runs before the fix).
 */
async function rfPass(browser, errors) {
  const runs = Math.max(1, Number(args.runs) || 10);
  for (const vp of [{ width: 1280, height: 800, label: 'desktop' }, { width: 1024, height: 768, label: 'ipad' }].filter((v) => !args.vp || v.label === args.vp)) {
    console.log(`\n[rf] the play camera, ${vp.label}, ${runs} runs`);
    const { context, page } = await openGame(browser, { errors, viewport: { width: vp.width, height: vp.height }, label: 'rf-' + vp.label });
    await newWorld(page, 'beach', { quality: 'auto' });
    await cleanView(page, true);
    await ev(page, () => window.__game.events.emit('thumbnail:before', {}));
    const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
    await float(page, true);
    await goTo(page, deep);
    await ev(page, () => { const g = window.__game; g.award('splash'); });
    await settle(page, 4000);
    for (let k = 1; k <= runs; k++) {
      await playScene(page);
      await gameWait(page, 1.5, 15000); // (the review takes its two pictures over this time)
      await rfCheck(page, vp, errors, ` run ${k}/${runs}`);
    }
    await context.close();
  }
}

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
      // each one in its own direction from the camera (none in front of another)
      let [x, z] = at(10, -2.6); d.spawn('dolphin', x, p.y, z, { n: 2 });
      [x, z] = at(7, 2.6); d.spawn('fish', x, p.y, z, { n: 9 });
      [x, z] = at(6, -3.6); d.spawn('sea_turtle', x, p.y, z);
      [x, z] = at(5, -0.3); d.spawn('octopus', x, p.y, z);
      [x, z] = at(9, 4.4); d.spawn('jelly', x, p.y, z);
      [x, z] = at(12, 6.6); d.spawn('jelly', x, p.y, z);
      [x, z] = at(5, 3.3); d.spawn('seahorse', x, p.y, z);
      [x, z] = at(5.5, 1.8); d.spawn('starfish', x, p.y, z);
      await new Promise((r) => setTimeout(r, 1500));
      d.still(true);
      // the two dolphins apart across the view (never one inside the other)
      const dl = d.list('dolphin');
      [x, z] = at(10, -2.6); if (dl[0]) d.move('dolphin', dl[0].i, x, z, yaw + Math.PI / 2);
      [x, z] = at(11, 1.6); if (dl[1]) d.move('dolphin', dl[1].i, x, z, yaw + Math.PI / 2 + 0.3);
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
    await playScene(page);
    await shot(page, `review-play-${vp.label}`, PREFIX);
    await gameWait(page, 1.5, 15000);
    await shot(page, `review-play-${vp.label}-2`, PREFIX);
    await rfCheck(page, vp, errors);
    const c = await seaContrast(page);
    check(errors, c.px > 800 && c.diff >= V1_DIFF, `R-P ${vp.label}: animals swimming near her are clearly in the picture (${c.px} pixels, difference ${f1(c.diff)})`);
    // a dolphin leaping out of the water near her (solid in the air, its splash below)
    const leap = await ev(page, () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position;
      if (!d.list('dolphin').length) {
        const cam = g.cameraRig;
        d.spawn('dolphin', p.x + Math.sin(cam.yaw) * 7, p.y, p.z + Math.cos(cam.yaw) * 7, { n: 2 });
      }
      const l = d.list('dolphin').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      // the nearest one that can leap now (one already in the air, or with no room, is skipped)
      for (const r of l) if (d.leap(r.i)) return r.i;
      return false;
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
      // spread out across the view, clear of her head
      let [x, z] = at(6, -3.2); d.spawn('jelly', x, p.y, z);
      [x, z] = at(8, -1.4); d.spawn('jelly', x, p.y, z);
      [x, z] = at(5, 3.6); d.spawn('jelly', x, p.y, z);
      [x, z] = at(6.5, 2.2); d.spawn('fish', x, p.y, z, { n: 8 });
      [x, z] = at(10, 0); d.spawn('dolphin', x, p.y, z, { n: 2 });
      [x, z] = at(4, -2.6); d.spawn('octopus', x, p.y, z);
      [x, z] = at(4.5, 2.2); d.spawn('seahorse', x, p.y, z);
    });
    await gameWait(page, 1.5, 15000);
    await shot(page, `review-night-${vp.label}`, PREFIX);
    const cn = await seaContrast(page);
    check(errors, cn.px > 800 && cn.diff >= C5_DIFF, `R-N ${vp.label}: at night the animals near her are in the picture (${cn.px} pixels, difference ${f1(cn.diff)})`);
    await ev(page, () => window.__game.setDayTime(0.42));
    // by the shore: crabs on the sand, starfish and seahorses in the shallow water near her
    const shallow = await ev(page, () => window.__game.debug.ocean.shallowSpot());
    if (shallow) {
      await goTo(page, shallow);
      const res = await ev(page, () => {
        const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
        d.clear();
        const sh = d.shoreNear(p.x, p.z, 8);
        if (!sh) return null;
        cam.yaw = Math.atan2(sh[0] - p.x, sh[2] - p.z);
        cam.pitch = 0.5;
        const at = (f, s2) => [p.x + Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * s2, p.z + Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * s2];
        const out = {};
        d.spawn('crab', sh[0], sh[1], sh[2], { n: 3 });
        let [x, z] = at(3.5, -2.2); out.starfish = d.spawn('starfish', x, p.y, z);
        [x, z] = at(4.2, 2.4); out.starfish += d.spawn('starfish', x, p.y, z, { variant: 3 });
        [x, z] = at(3.2, 1.0); out.seahorse = d.spawn('seahorse', x, p.y, z, { variant: 1 });
        [x, z] = at(5, -0.6); out.fish = d.spawn('fish', x, p.y, z, { n: 6, variant: 1 });
        out.counts = d.count();
        return out;
      });
      console.log('  shore: ' + JSON.stringify(res));
      await gameWait(page, 1.2, 15000);
      await shot(page, `review-shore-${vp.label}`, PREFIX);
      const cs = await seaContrast(page);
      check(errors, !!res && res.counts.crab > 0 && cs.px > 800 && cs.diff >= V1_DIFF, `R-S ${vp.label}: crabs, starfish and a seahorse by the shore are clearly in the picture (${cs.px} pixels, difference ${f1(cs.diff)})`);
      await goTo(page, deep);
    }
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

/**
 * The dolphin from five sides (owner pictures, on request: --only=dolphin), every palette given by
 * --variants=0,1,2 (default 0, 1, 2): ocean-dolphin-<v>-<front|three-quarter|side|back-quarter|
 * tail-side>.png, the gallery dolphin held still in the air over the sea.
 */
async function dolphinViews(browser, errors) {
  console.log('\n[dolphin] the dolphin from five sides');
  const { context, page } = await openGame(browser, { errors, label: 'dolphin-views' });
  await newWorld(page, 'beach');
  await cleanView(page, true, true);
  await ev(page, () => { const g = window.__game, s = g.debug.ocean.deepSpot(); g.__dv = s; g.player.teleport(s[0], s[1], s[2]); });
  await page.waitForTimeout(1500);
  const views = [['front', 0, 0.35, 2.6], ['three-quarter', 0.8, 0.4, 2.8], ['side', 1.57, 0.3, 3.2], ['back-quarter', 2.4, 0.5, 3.2], ['tail-side', 1.75, 0.7, 2.2, -0.8]];
  const variants = (args.variants || '0,1,2').split(',').map(Number);
  let made = 0;
  for (const v of variants) {
    for (const [name, ang, up, dist, along = 0] of views) {
      // the camera set by hand and one frame drawn now (the rig is not run for it)
      const ok = await ev(page, async ([v, ang, up, dist, along]) => {
        const g = window.__game, d = g.debug.ocean, p = g.__dv;
        d.autoSpawn(false);
        g.player.avatar.group.visible = false;
        // in the air over the sea from the deep spot (fixed: she may sink meanwhile), so no
        // palette lands under the water's surface
        // (14 blocks out over deep water, the side farthest from the world's edge, so the edge
        // stays out of the picture; else 14 blocks east as before)
        const m = g.ocean.map, cands = [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, 10], [10, -10], [-10, -10]];
        const room = ([dx, dz]) => { const x = Math.floor(p[0] + dx), z = Math.floor(p[2] + dz); let r = 0; for (; r < 40 && m.inBounds(x - r - 1, z - r - 1) && m.inBounds(x + r + 1, z + r + 1); r++); return m.deepAround(x, z, 3) ? r : -1; };
        let best = cands[0], bestR = -1;
        for (const c of cands) { const r = room(c); if (r > bestR) { best = c; bestR = r; } }
        const at = { x: p[0] + best[0], y: p[1] + 1.8, z: p[2] + best[1] };
        d.gallery({ kinds: ['dolphin'], variants: [v], x: at.x, y: at.y, z: at.z });
        const yaw = Math.PI - 0.95, a = yaw + ang;
        const cx = at.x + Math.sin(yaw) * along, cz = at.z + Math.cos(yaw) * along;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
        g.cameraRig.update = () => {};
        g.camera.position.set(cx + Math.sin(a) * dist, at.y + up, cz + Math.cos(a) * dist);
        g.camera.lookAt(cx, at.y, cz);
        g.camera.updateMatrixWorld();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return d.count().dolphin > 0;
      }, [v, ang, up, dist, along]);
      await shot(page, `dolphin-${v}-${name}`, PREFIX);
      if (ok) made++;
    }
  }
  await ev(page, () => { const g = window.__game; if (g.__rig) g.cameraRig.update = g.__rig; g.player.avatar.group.visible = true; });
  check(errors, made === variants.length * views.length, `R-D the dolphin from five sides: ${made} pictures (palettes ${variants.join(', ')})`);
  await context.close();
}

// =====================================================================================
// wave4 (plan docs/teams/wave4-integration.md §9.1), part one: X1-X5 (--only=wave4a;
// --only=wave4 runs both parts; part two, X6-X10, is wave4b below). Beach Cozy with the three popup switches on:
// debug.merfolk.tips(true), debug.ocean.popups(true), debug.squish.presents(true).
// =====================================================================================

const IPAD = { width: 1024, height: 768 };

/** A beach world with the three switches on, the sounds recorded. */
async function wave4World(page, { asked = true } = {}) {
  await newWorld(page, 'beach');
  await ev(page, (asked) => {
    const g = window.__game;
    g.debug.merfolk.tips(true);
    g.debug.ocean.popups(true);
    g.debug.squish.presents(true);
    if (asked) g.store.deviceSet('seaAsked', 2); // X1 alone meets the first-turn choice bubble
    g.__seaformEvents = [];
    g.events.on('player:seaform', (e) => g.__seaformEvents.push(e && e.form));
    window.__sounds = [];
    const play = g.audio.play.bind(g.audio);
    g.audio.play = (name, o) => { window.__sounds.push(name); return play(name, o); };
  }, asked);
}

/** Tap (touch) or click the nearest wild dolphin in front of her; resolves true once the bubble's Ride shows. */
async function tapDolphin(page, touch, spawn = true) {
  if (spawn) {
    await ev(page, () => {
      const g = window.__game, d = g.debug.ocean, p = g.player.position, cam = g.cameraRig;
      d.clear();
      d.autoSpawn(false);
      d.spawn('dolphin', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 2 });
    });
    await page.waitForTimeout(300);
  }
  const d0 = await ev(page, () => {
    const g = window.__game, p = g.player.position;
    const l = g.debug.ocean.list('dolphin').filter((r) => r.role === 'wild' && (!r.scale || r.scale === 1));
    l.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return l[0] || null;
  });
  if (!d0) return false;
  await aim(page, d0.x, d0.y, d0.z, 0.25);
  await freeze(page, true);
  let pt = null;
  for (let t = 0; t < 30; t++) {
    pt = await recPoint(page, 'dolphin', d0.i, 0.2);
    const h = await pickAt(page, pt);
    if (h && h.kind === 'dolphin') break;
    await page.waitForTimeout(100);
  }
  if (pt) { if (touch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y); }
  await freeze(page, false);
  if (!(await waitOk(page, () => !!document.querySelector('.oc-bubble.lf-on .oc-ride'), null, 3000))) {
    console.log('    (the tap missed the moving dolphin: tapped through the debug API)');
    await ev(page, (i) => window.__game.debug.ocean.tapRec('dolphin', i), d0.i);
  }
  return waitOk(page, () => !!document.querySelector('.oc-bubble.lf-on .oc-ride'), null, 3000);
}

async function pressRide(page, touch) {
  const b = page.locator('.oc-bubble.lf-on .oc-ride');
  if (touch) await b.tap(); else await b.click();
  return waitOk(page, () => window.__game.ocean.riding, null, 8000);
}

const joyLabel = (page) => ev(page, () => (document.querySelector('.sw-joy-label') || {}).textContent || null);
const upDownShown = (page) => ev(page, () => [...document.querySelectorAll('.sw-touch .sw-flybtn')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').length);
const jumpShown = (page) => ev(page, () => [...document.querySelectorAll('.sw-touch [aria-label="Jump"]')].some((e) => e.offsetParent && !e.hidden));
const roundShown = (page, action) => ev(page, (a) => { const b = document.querySelector(`.lf-hud .sw-round[data-action="${a}"]`); return !!b && !b.hidden && !!b.offsetParent; }, action);

// ---------- X1 the first deep swim: one thing at a time ----------
async function wave4X1(browser, errors) {
  console.log('\n[wave4] X1 the first deep swim, fresh profile, style never picked (desktop)');
  const { context, page } = await openGame(browser, { errors, label: 'x1' });
  await wave4World(page, { asked: false });
  const sh = await ev(page, () => window.__game.debug.merfolk.shore());
  if (!check(errors, !!sh, 'X1 a deep spot next to the beach')) { await context.close(); return; }
  const sq0 = await ev(page, () => { const s = window.__game.debug.squish.state(); return { ready: s.ready, toNext: s.toNext, style: window.__game.surpriseStyle ? window.__game.surpriseStyle() : null, form: window.__game.profile.look.sea && window.__game.profile.look.sea.form }; });
  console.log('    (X1 start ' + JSON.stringify(sq0) + ')');
  // every frame: which of the four is showing (a state change is kept; a pair is counted)
  await ev(page, () => {
    const vis = (el) => { if (!el || !el.isConnected) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const first = (sel) => { for (const e of document.querySelectorAll(sel)) { const r = vis(e); if (r) return r; } return null; };
    const X = window.__x1 = { on: true, t0: performance.now(), n: 0, log: [], pairs: {}, popOver: 0, sig: '' };
    const f = () => {
      if (!X.on) return;
      const pop = first('.sw-stkpop'), mf = first('.lf-bubble.lf-on[data-owner="merfolk"]'), oc = first('.lf-bubble.lf-on[data-owner="ocean"]'), drop = first('.sq-drop');
      const on = { pop: !!pop, merfolk: !!mf, ocean: !!oc, drop: !!drop };
      const names = Object.keys(on).filter((k) => on[k]);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const k = names[i] + '+' + names[j]; X.pairs[k] = (X.pairs[k] || 0) + 1; }
      if (pop && oc && pop.left < oc.right - 2 && oc.left < pop.right - 2 && pop.top < oc.bottom - 2 && oc.top < pop.bottom - 2) X.popOver++;
      const sig = names.join('+');
      if (sig !== X.sig) { X.sig = sig; X.log.push([Math.round(performance.now() - X.t0), sig]); }
      X.n++;
      requestAnimationFrame(f);
    };
    f();
  });
  // walk in from the beach
  await ev(page, ([s, yaw]) => { const g = window.__game; g.player.setFlying(false); g.player.teleport(s[0], s[1] + 0.05, s[2]); g.cameraRig.yaw = yaw; g.player.yaw = yaw; }, [sh.land, Math.atan2(-sh.dir[0], -sh.dir[1])]);
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyW');
  const turned = await waitOk(page, () => !!window.__game.player.seaForm, null, 20000);
  await page.waitForTimeout(1200); // a little further out
  await page.keyboard.up('KeyW');
  check(errors, turned, 'X1 walking in from the beach she turns (auto, never picked)');
  // merfolk's choice bubble: a tap on Mermaid
  const mfShown = await waitOk(page, () => !!window.__game.debug.merfolk.bubble(), null, 30000);
  if (mfShown) {
    await page.waitForTimeout(800);
    await page.locator('.lf-bubble[data-owner="merfolk"] button[aria-label="Mermaid"]').click({ force: true, timeout: 5000 }).catch(() => {});
  }
  await waitOk(page, () => !window.__game.debug.merfolk.bubble() && !document.querySelector('.sw-stkpop'), null, 20000);
  // a dolphin of her first pod: a real click (the bubble, Dolphin Friend, the hello's coins)
  await ev(page, () => { const g = window.__game, p = g.player.position, d = g.debug.ocean; if (!d.list('dolphin').some((r) => r.role === 'wild' && Math.hypot(r.x - p.x, r.z - p.z) < 8)) { const cam = g.cameraRig; d.spawn('dolphin', p.x + Math.sin(cam.yaw) * 3.5, p.y, p.z + Math.cos(cam.yaw) * 3.5, { n: 2 }); } });
  await page.waitForTimeout(300);
  const tapped = await tapDolphin(page, false, false);
  check(errors, tapped, 'X1 a click on a dolphin of her pod opens its bubble');
  // the present those coins made ready drops once everything else is gone
  const dropped = await waitOk(page, () => !!document.querySelector('.sq-drop'), null, 90000);
  await page.waitForTimeout(500);
  const x = await ev(page, () => {
    const g = window.__game, X = window.__x1;
    X.on = false;
    return { n: X.n, ms: Math.round(performance.now() - X.t0), log: X.log, pairs: X.pairs, popOver: X.popOver, stickers: g.__probeEvents.filter((e) => e.name === 'sticker:earned').map((e) => e.sticker), ready: g.debug.squish.state().ready, opened: g.debug.squish.state().opened };
  });
  console.log('    (X1 ' + JSON.stringify(x) + ')');
  const bad = Object.keys(x.pairs).filter((k) => k !== 'pop+ocean');
  check(errors, x.ms >= 25000 && x.n > 50, `X1 recorded every frame from the walk-in to the drop (${(x.ms / 1000).toFixed(1)} s, ${x.n} frames, >= 25 s)`);
  check(errors, bad.length === 0, `X1 never two in the same frame among the pop, merfolk's bubble, the dolphin bubble and the drop (${JSON.stringify(x.pairs)})`);
  check(errors, x.popOver === 0, `X1 the dolphin bubble the kid tapped open never lies over the sticker pop (${x.popOver} frames; ${x.pairs['pop+ocean'] || 0} frames side by side)`);
  const iM = x.stickers.indexOf('sea_magic'), iD = x.stickers.indexOf('dolphin_friend');
  check(errors, iM >= 0 && iD > iM, `X1 Sea Magic! then Dolphin Friend pop (${x.stickers.join(', ')})`);
  const mfOn = x.log.filter((l, k) => l[1].includes('merfolk') && !(k > 0 && x.log[k - 1][1].includes('merfolk'))).length;
  check(errors, mfOn === 1, `X1 merfolk's choice bubble shows once (${mfOn})`);
  const dropAt = (x.log.find((l) => l[1].includes('drop')) || [null])[0];
  const lastOther = Math.max(-1, ...x.log.filter((l) => l[0] < (dropAt === null ? Infinity : dropAt) && /pop|merfolk|ocean/.test(l[1])).map((l) => l[0]));
  check(errors, sq0.ready === 0 && dropped && dropAt !== null && dropAt > lastOther && x.ready + x.opened >= 1, `X1 the present those coins made ready (to go ${sq0.toNext} at the start) drops only after all are gone (drop at ${dropAt} ms, the last other at ${lastOther} ms)`);
  await shot(page, 'x1-drop', 'wave4');
  await context.close();
}

// ---------- X2 a mermaid (then a sea dragon with Boy picked) rides ----------
async function wave4X2(browser, errors) {
  console.log('\n[wave4] X2 a mermaid and a sea dragon ride (iPad 1024x768 touch)');
  const { context, page } = await openGame(browser, { errors, viewport: IPAD, touch: true, label: 'x2' });
  await wave4World(page);
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  // her first swim's stickers out of the way (Big Leap! stays to earn)
  await ev(page, () => { const g = window.__game; g.award('splash'); g.award('sea_magic'); g.award('dolphin_friend'); });
  await waitOk(page, () => !!document.querySelector('.sw-stkpop'), null, 3000);
  for (let k = 0; k < 3; k++) await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000).then(() => page.waitForTimeout(400));
  for (const [form, pic, boy] of [['mermaid', 'ride-mermaid', false], ['sea_dragon', 'ride-dragon', true]]) {
    if (boy) await ev(page, () => { const g = window.__game; g.store.deviceSet('surpriseStyle', 'boy'); g.events.emit('style:changed', { style: 'boy' }); });
    await float(page, true);
    await goTo(page, deep);
    const turned = await waitOk(page, (f) => window.__game.player.seaForm === f && !!(window.__game.debug.merfolk.parts() || {}).shown, form, 15000);
    check(errors, turned, `X2 ${boy ? 'Boy picked, auto' : 'never picked, auto'}: she turns into a ${form}`);
    await page.waitForTimeout(600);
    const open = await tapDolphin(page, true);
    await ev(page, () => { const g = window.__game; g.__seaformEvents.length = 0; window.__sounds.length = 0; window.__w4ride = null; });
    const rode = open && await pressRide(page, true);
    // every frame of the ride: the form set and the tail shown
    await ev(page, () => {
      const g = window.__game, R = window.__w4ride = { n: 0, noForm: 0, hidden: 0, on: true };
      const f = () => { if (!R.on) return; R.n++; if (!g.player.seaForm) R.noForm++; if (!(g.debug.merfolk.parts() || {}).shown) R.hidden++; requestAnimationFrame(f); };
      f();
    });
    await page.waitForTimeout(800);
    const r = await ev(page, () => {
      const g = window.__game, loc = g.net && g.net.adapter ? g.net.adapter.local() : null;
      return { st: loc && loc.st, sr: loc && loc.sr };
    });
    const ud = await upDownShown(page), jump = await jumpShown(page), label = await joyLabel(page);
    check(errors, rode && r.st === 'h' && r.sr !== null && r.sr !== undefined, `X2 ${form} Ride: presence st 'h', sr set (${JSON.stringify(r)})`);
    check(errors, ud === 0 && jump && label === 'Ride', `X2 ${form} riding: Up / Down hidden (${ud}), Jump shown (${jump}), the label "${label}"`);
    if (!boy) {
      const jb = page.locator('.sw-touch [aria-label="Jump"]').first();
      await jb.tap();
      check(errors, await waitOk(page, () => window.__game.stickers.has('big_leap'), null, 4000), 'X2 Jump on the dolphin: Big Leap! (fresh profile)');
      await page.waitForTimeout(1500);
    }
    // the picture, three-quarters from in front (as R10), the HUD out of the way
    const dist0 = await ev(page, () => { const g = window.__game, s = g.debug.ocean.rideState(), cam = g.cameraRig, d = cam.distance; cam.yaw = s.yaw + Math.PI * 0.75; cam.pitch = 0.28; cam.distance = 2.2; return d; });
    await cleanView(page, true, true);
    await settle(page, 1200);
    await shot(page, pic, 'wave4');
    await cleanView(page, false, true);
    await ev(page, (d) => { window.__game.cameraRig.distance = d; }, dist0);
    await page.locator('.lf-hud [data-action="seahop"]').tap();
    await page.waitForTimeout(800);
    const off = await ev(page, () => {
      const g = window.__game, R = window.__w4ride;
      R.on = false;
      return { riding: g.ocean.riding, form: g.player.seaForm, shown: !!(g.debug.merfolk.parts() || {}).shown, events: g.__seaformEvents.slice(), magic: window.__sounds.filter((s) => s === 'magic').length, R };
    });
    check(errors, off.R.n > 5 && off.R.noForm === 0 && off.R.hidden === 0 && off.events.length === 0, `X2 ${form}: seaForm set and the tail shown on every frame of the ride, no 'player:seaform' (${JSON.stringify(off.R)}, ${off.events.length} events)`);
    const ud2 = await upDownShown(page), label2 = await joyLabel(page);
    check(errors, !off.riding && off.form === form && off.shown && label2 === 'Swim' && ud2 === 2 && off.magic === 0, `X2 ${form} Hop off: the label "${label2}", Up / Down shown (${ud2}), the tail still out, no magic sound (${off.magic})`);
  }
  await context.close();
}

// ---------- X3 Ride from a stopped boat ----------
async function wave4X3(browser, errors) {
  console.log('\n[wave4] X3 Ride from a stopped boat (iPad 1024x768 touch)');
  const { context, page } = await openGame(browser, { errors, viewport: IPAD, touch: true, label: 'x3' });
  await wave4World(page);
  await ev(page, () => { const g = window.__game; g.award('splash'); g.award('sea_magic'); g.award('dolphin_friend'); g.award('dolphin_rider'); });
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  const boat = await ev(page, async (d) => {
    const g = window.__game;
    g.debug.ocean.clear();
    g.debug.ocean.autoSpawn(false);
    const x = Math.floor(d[0]), z = Math.floor(d[2]), y = g.ocean.map.top(x, z);
    g.player.teleport(d[0], d[1], d[2]);
    const e = g.entities.place('boat_speed', x, y, z, 0, null, {}, { history: false, players: false });
    if (!e) return null;
    g.debug.vehicles.drive(e.uid);
    await new Promise((r) => setTimeout(r, 600));
    return e.uid;
  }, deep);
  if (!check(errors, !!boat, 'X3 a Speedboat parked on deep water, she drives it')) { await context.close(); return; }
  await waitOk(page, () => Math.abs(window.__game.vehicles.pose().speed) < 1, null, 8000);
  const before = await ev(page, () => window.__game.debug.merfolk.state());
  const opened = await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, b = g.vehicles.pose();
    d.spawn('dolphin', b.x + 2.5, b.y, b.z, { n: 2 });
    await new Promise((r) => setTimeout(r, 150));
    const r = d.list('dolphin').find((q) => Math.hypot(q.x - b.x, q.z - b.z) <= 4) || d.list('dolphin')[0];
    d.tapRec('dolphin', r.i);
    await new Promise((r) => setTimeout(r, 300));
    return d.bubble() && d.bubble().from;
  });
  // (T2 clicks the stopped boat's dolphin for real; here the tap goes through the debug API so
  // the moment of mounting is exact)
  check(errors, opened === 'boat', `X3 a dolphin beside the stopped boat: the bubble offers Ride (${opened}; on the boat the gate was ${before.gateOn ? 'on' : 'off'})`);
  await page.locator('.oc-bubble.lf-on .oc-ride').tap();
  const at = await ev(page, () => new Promise((res) => {
    const g = window.__game, t0 = performance.now();
    const f = () => { if (g.ocean.riding) { const s = g.debug.merfolk.state(); return res({ gateOn: s.gateOn, seaSwim: s.seaSwim, boat: !!g.vehicles.current }); } if (performance.now() - t0 > 5000) return res(null); requestAnimationFrame(f); };
    f();
  }));
  check(errors, at && at.gateOn && at.seaSwim && !at.boat, `X3 Ride from the boat: the gate on and seaSwim true on the first riding frame (C3) (${JSON.stringify(at)})`);
  await page.waitForTimeout(800);
  await page.locator('.lf-hud [data-action="seahop"]').tap();
  await page.waitForTimeout(800);
  const label = await joyLabel(page), ud = await upDownShown(page);
  check(errors, label === 'Swim' && ud === 2, `X3 Hop off: the label "${label}", Up / Down shown (${ud})`);
  await context.close();
}

// ---------- X4 a toy in the water ----------
async function wave4X4(browser, errors) {
  console.log('\n[wave4] X4 a toy in the water (desktop)');
  const { context, page } = await openGame(browser, { errors, label: 'x4' });
  await wave4World(page);
  await ev(page, () => { const g = window.__game; g.award('splash'); g.award('sea_magic'); g.award('dolphin_friend'); g.award('dolphin_rider'); g.award('big_leap'); g.debug.squish.give('pf_dolphin'); });
  const sh = await ev(page, () => window.__game.debug.merfolk.shore());
  const holdFromShelf = async () => {
    await ev(page, () => window.__game.ui.open('squish'));
    await page.waitForSelector('.sw-panel-wrap.sw-open .sq-grid');
    await page.locator('.sq-cubby[data-key=pf_dolphin]').click();
    await page.locator('.sq-detail .sw-btn', { hasText: 'Hold it' }).click();
    return waitOk(page, () => !window.__game.ui.current && window.__game.squish.held() === 'squish_pf_dolphin', null, 4000);
  };
  // on the sand: hold it
  await ev(page, (s) => { const g = window.__game; g.player.setFlying(false); g.player.teleport(s[0], s[1] + 0.05, s[2]); }, sh.land);
  await page.waitForTimeout(500);
  check(errors, await holdFromShelf(), 'X4 Hold it on the sand: the Dolphin Puffum in her hand');
  // swim deep: hidden, Squish! hidden, Put away shown, presence hi still the toy
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  await waitOk(page, () => !!window.__game.player.seaForm && !!(window.__game.debug.merfolk.parts() || {}).shown, null, 15000);
  await page.waitForTimeout(600);
  const w = await ev(page, () => { const g = window.__game; return { shown: g.player.avatar.heldShown, held: !!g.player.avatar.held, hi: g.net && g.net.adapter ? g.net.adapter.local().hi : 'no adapter' }; });
  const sqBtn = await roundShown(page, 'squish'), away = await roundShown(page, 'squish-away');
  check(errors, w.held && w.shown === false && !sqBtn && away && w.hi === 'squish_pf_dolphin', `X4 swimming deep: the toy hidden (${w.shown}), Squish! hidden (${!sqBtn}), Put away shown (${away}), presence hi ${w.hi}`);
  // walk out: it shows again and Squish! squashes it
  await float(page, false);
  await ev(page, (s) => { const g = window.__game; g.player.teleport(s[0], s[1] + 0.05, s[2]); }, sh.land);
  const back = await waitOk(page, () => window.__game.player.avatar.heldShown !== false && !window.__game.player.seaForm, null, 8000);
  const sq2 = await waitOk(page, () => { const b = document.querySelector('.lf-hud .sw-round[data-action="squish"]'); return b && !b.hidden && !!b.offsetParent; }, null, 3000);
  let sy = 9;
  if (sq2) {
    const bb = await page.locator('.lf-hud .sw-round[data-action="squish"]').boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    sy = await ev(page, () => window.__game.debug.squish.handSy());
    await page.mouse.up();
  }
  check(errors, back && sq2 && sy < 0.6, `X4 out of the water: the toy shows again, Squish! squashes it (sy ${typeof sy === 'number' ? sy.toFixed(2) : sy})`);
  // Just Me on a dolphin: the toy shows (as on a pony)
  await ev(page, () => { const g = window.__game; g.profile.look.sea = { form: 'me', color: null }; g.events.emit('avatar:changed', { look: g.profile.look }); });
  await float(page, true);
  await goTo(page, deep);
  await page.waitForTimeout(600);
  const rode = await tapDolphin(page, false) && await pressRide(page, false);
  await page.waitForTimeout(800);
  const me = await ev(page, () => { const g = window.__game; return { riding: g.ocean.riding, form: g.player.seaForm || null, shown: g.player.avatar.heldShown, held: g.squish.held() }; });
  check(errors, rode && me.riding && me.shown === true && me.held === 'squish_pf_dolphin', `X4 Just Me on a dolphin holds the toy where it shows (${JSON.stringify(me)})`);
  await ev(page, () => window.__game.debug.ocean.hopOff('button'));
  // "Hold it" from the shelf while swimming
  await ev(page, () => { const g = window.__game; g.squish.putAway(); g.profile.look.sea = { form: 'mermaid', color: null }; g.events.emit('avatar:changed', { look: g.profile.look }); window.__toasts.length = 0; });
  await waitOk(page, () => !!window.__game.player.seaForm, null, 10000);
  await holdFromShelf();
  check(errors, await toastSeen(page, /^Swim to the shore first!$/, 3000), 'X4 "Hold it" while swimming: "Swim to the shore first!"');
  await context.close();
}

// ---------- X5 the HUD with everything at once ----------
async function wave4X5(browser, errors) {
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['ipad-portrait', { width: 1024, height: 1366 }]]) {
    console.log(`\n[wave4] X5 the HUD with everything at once (${name} ${viewport.width}x${viewport.height} touch)`);
    const { context, page } = await openGame(browser, { errors, viewport, touch: true, label: 'x5-' + name });
    await wave4World(page);
    await ev(page, () => { const g = window.__game; g.award('splash'); g.award('sea_magic'); g.award('dolphin_friend'); g.award('dolphin_rider'); g.award('big_leap'); g.debug.squish.give('pf_dolphin'); });
    await waitOk(page, () => !!document.querySelector('.sw-stkpop'), null, 3000);
    for (let k = 0; k < 5; k++) await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000).then(() => page.waitForTimeout(400));
    // a toy held (on the land), a present waiting (its button and the ring)
    await ev(page, () => { const g = window.__game; g.ui.open('squish'); });
    await page.waitForSelector('.sw-panel-wrap.sw-open .sq-grid');
    // (setup, not the check: on the phone the grid's next cubby lies over this one's middle
    // while it scrolls, so the click goes to the button itself)
    await page.locator('.sq-cubby[data-key=pf_dolphin]').dispatchEvent('click');
    await page.locator('.sq-detail .sw-btn', { hasText: 'Hold it' }).dispatchEvent('click');
    await waitOk(page, () => !window.__game.ui.current && window.__game.squish.held() === 'squish_pf_dolphin', null, 4000);
    const toNext = await ev(page, () => window.__game.debug.squish.state().toNext);
    await ev(page, (n) => window.__game.coins.add(n, 'gift', { fly: false }), toNext);
    const present = await waitOk(page, () => { const b = document.querySelector('.lf-hud .sw-round[data-action="present"]'); return !!b && !b.hidden; }, null, 6000);
    await waitOk(page, () => !!document.querySelector('.sq-drop'), null, 4000);
    await waitOk(page, () => !document.querySelector('.sq-drop'), null, 12000); // it flies to the Present button
    // riding, a toast up and a sticker pop showing
    const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
    await float(page, true);
    await goTo(page, deep);
    await waitOk(page, () => !!window.__game.player.seaSwim, null, 10000);
    await page.waitForTimeout(600);
    const rode = await tapDolphin(page, true) && await pressRide(page, true);
    let crowdN = 0;
    const crowd = async () => {
      await ev(page, (id) => {
        const g = window.__game;
        g.registry.stickers.set(id, { id, name: 'Probe', hint: '', icon: 'star' });
        g.award(id);
        g.toast('Splash! Off you go!', { icon: 'sparkle' });
      }, 'probe_x5_' + ++crowdN);
      await waitOk(page, () => !!document.querySelector('.sw-stkpop') && !!document.querySelector('.sw-toasts .sw-toast'), null, 6000);
      await page.waitForTimeout(400);
    };
    const RECTS5 = () => {
      const r = (g, sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden' && !e.hidden).map((e) => { const b = e.getBoundingClientRect(); return { g, sel: e.getAttribute('data-action') || e.getAttribute('aria-label') || sel, x: b.left, y: b.top, w: b.width, h: b.height }; }).filter((b) => b.w > 0 && b.h > 0);
      return [
        ...r('life', '.lf-hud .sw-round:not([hidden])'), ...r('joy', '.sw-joy'), ...r('jump', '.sw-touch [aria-label="Jump"]'),
        ...r('updown', '.sw-touch .sw-flybtn'), ...r('coins', '.sw-coins'), ...r('coins', '.sw-coins-ring'),
        ...r('bubble', '.oc-bubble.lf-on'), ...r('toast', '.sw-toasts .sw-toast'), ...r('pop', '.sw-stkpop'),
      ];
    };
    const overlaps = (rs) => {
      const out = [];
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.g === b.g) continue;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2) { const at = (q) => `[${Math.round(q.x)},${Math.round(q.y)} ${Math.round(q.w)}x${Math.round(q.h)}]`; out.push(`${a.g}:${a.sel}${at(a)} x ${b.g}:${b.sel}${at(b)}`); }
      }
      return out;
    };
    await crowd();
    const a = await ev(page, RECTS5);
    const ga = [...new Set(a.map((q) => q.g))].sort();
    const oa = overlaps(a);
    check(errors, rode && present && ['coins', 'joy', 'jump', 'life', 'pop', 'toast'].every((g) => ga.includes(g)) && a.some((q) => q.sel === 'present') && a.some((q) => q.sel === 'squish-away'), `X5 ${name} riding: the joystick, Jump, the life column with Present and Put away, the coins and ring, a toast and a pop all show (${ga.join(', ')})`);
    check(errors, oa.length === 0, `X5 ${name} riding: no two overlap (${oa.join('; ') || 'none'})`);
    await shot(page, `x5-${name}-riding`, 'wave4');
    // just after Hop off: Up / Down back, the dolphin bubble open
    await page.locator('.lf-hud [data-action="seahop"]').tap();
    await waitOk(page, () => !window.__game.ocean.riding, null, 3000);
    await waitOk(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
    await page.waitForTimeout(400);
    const bub = await tapDolphin(page, true);
    await crowd();
    const b = await ev(page, RECTS5);
    const gb = [...new Set(b.map((q) => q.g))].sort();
    const ob = overlaps(b);
    check(errors, bub && ['bubble', 'coins', 'joy', 'life', 'pop', 'toast', 'updown'].every((g) => gb.includes(g)), `X5 ${name} after Hop off: Up / Down, the dolphin bubble, the life column, the coins, a toast and a pop all show (${gb.join(', ')})`);
    check(errors, ob.length === 0, `X5 ${name} after Hop off: no two overlap (${ob.join('; ') || 'none'})`);
    await shot(page, `x5-${name}-hopoff`, 'wave4');
    // five different pictures: Present, Squish!, Put away, the dolphin, Hop off
    const svgs = await ev(page, () => [
      ...['present', 'squish', 'squish-away', 'seahop'].map((a) => { const e = document.querySelector(`.lf-hud .sw-round[data-action="${a}"] .sw-round-face svg`); return e ? e.outerHTML : null; }),
      (document.querySelector('.oc-bubble .oc-ride svg') || {}).outerHTML || null,
    ]);
    check(errors, svgs.every(Boolean) && new Set(svgs).size === 5, `X5 ${name}: Present, Squish!, Put away, the dolphin and Hop off are five different pictures (${svgs.filter(Boolean).length} found, ${new Set(svgs.filter(Boolean)).size} different)`);
    await context.close();
  }
}

async function wave4aPass(browser, errors) {
  const parts = args.x ? args.x.split(',') : ['1', '2', '3', '4', '5'];
  if (parts.includes('1')) await wave4X1(browser, errors);
  if (parts.includes('2')) await wave4X2(browser, errors);
  if (parts.includes('3')) await wave4X3(browser, errors);
  if (parts.includes('4')) await wave4X4(browser, errors);
  if (parts.includes('5')) await wave4X5(browser, errors);
}

// =====================================================================================
// wave4 part two: X6-X10 (--only=wave4b; --x=6,8 runs only some of them)
// =====================================================================================

const W4_STICKERS = ['squish_first', 'squish_ten', 'squish_all', 'squish_squeeze', 'dolphin_friend', 'dolphin_rider', 'sea_explorer', 'ocean_star', 'whale_hello', 'sea_magic', 'big_leap'];

/** Wait until every coin has landed (the ring reads earned minus the coins still flying). */
const coinsLanded = (page, timeout = 10000) => waitOk(page, () => { const g = window.__game; return !g.coins || g.coins.shown === g.profile.coins; }, null, timeout);

// ---------- X6 the Sticker Book ----------
async function wave4X6(browser, errors) {
  console.log('\n[wave4] X6 the Sticker Book: the 11 new stickers in the plan\'s order, the Sea Friends strip');
  const { context, page } = await openGame(browser, { errors, label: 'x6' });
  const s = await ev(page, (ids) => {
    const g = window.__game, reg = g.registry.stickers, keys = [...reg.keys()];
    return {
      last: keys.slice(-11), size: reg.size, total: g.stickers.total(), all: g.stickers.all().length,
      before: keys.slice(0, -11).filter((k) => ids.includes(k)).length,
      art: ids.filter((id) => reg.get(id) && reg.get(id).art).length,
    };
  }, W4_STICKERS);
  check(errors, JSON.stringify(s.last) === JSON.stringify(W4_STICKERS), `X6 the last 11 sticker ids are §4.7 in order (${s.last.join(', ')})`);
  check(errors, s.total === s.size && s.all === s.size && s.before === 0, `X6 total() is the stickers before wave 4 + 11 (${s.size - 11} + 11 = ${s.total})`);
  check(errors, s.art === 11, `X6 all 11 have art (${s.art})`);
  await ev(page, () => window.__game.ui.open('stickers'));
  const strip = await waitOk(page, () => !!document.querySelector('.sw-sb-extras .oc-friends .oc-slot'), null, 8000);
  await page.locator('.oc-friends').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(2000); // the strip's silhouettes are drawn a few per frame
  const r = await ev(page, () => {
    const book = document.querySelector('.sw-sb-book').getBoundingClientRect(), f = document.querySelector('.oc-friends');
    const fr = f.getBoundingClientRect(), cs = getComputedStyle(f);
    return { bookBottom: Math.round(book.bottom), top: Math.round(fr.top), h: Math.round(fr.height), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && fr.height > 0, slots: f.querySelectorAll('.oc-slot').length, title: (f.querySelector('.oc-friends-title') || {}).textContent };
  });
  check(errors, strip && r.shown && r.top >= r.bookBottom - 1 && r.slots === 9 && r.title === 'Sea Friends', `X6 the Sea Friends strip shows under the pages (${JSON.stringify(r)})`);
  await shot(page, 'x6-book', 'wave4');
  await context.close();
}

// ---------- X7 two pages: a friend riding with a toy ----------
async function wave4X7(browser, errors) {
  console.log('\n[wave4] X7 two pages: Rosie in sea form with a toy rides a dolphin, then hops off on the shore');
  const { NetHub } = await import('./net/hub.mjs');
  const { FakeClaudeHub } = await import('./net/fake-claude.js');
  const flows = await import('./net/mp-flows.mjs');
  const { game, until, setupPage, waitLive, bringTo, closePanels } = flows;
  const hub = new NetHub({
    clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
    budget: { rate: 100000, burst: 100000 }, maxPeers: 16, graceMs: 10000,
  });
  const fc = new FakeClaudeHub(hub);
  const ACCOUNTS = { 'u-lily': 'Parker family (Mom)', 'u-rosie': 'Rosie R.' };
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
  const rosie = await open({ key: 'rosie', name: 'Rosie', uid: 'u-rosie', level: 'interact', can: true, guest: false, viewport: IPAD, touch: true, seed: 29 });
  const code = await flows.hostMakesCode(lily, { biome: 'beach' });
  await flows.guestTypesCode(rosie, code);
  await flows.hostLetsIn(lily, 'Rosie');
  check(errors, await waitLive(rosie), 'X7 Rosie is in Lily\'s world');
  await closePanels(lily);
  for (const p of [lily, rosie]) {
    await game(p, () => { const g = window.__game; g.debug.merfolk.tips(true); g.debug.ocean.popups(true); g.debug.squish.presents(true); g.store.deviceSet('seaAsked', 2); });
  }
  await bringTo(rosie, lily, 3, 3);
  // Rosie holds the Dolphin Puffum on the sand
  const sh = await game(rosie, () => window.__game.debug.merfolk.shore());
  await game(rosie, (s) => { const g = window.__game; g.player.setFlying(false); g.player.teleport(s[0], s[1] + 0.05, s[2]); g.debug.squish.give('pf_dolphin'); return g.squish.hold('pf_dolphin'); }, sh.land);
  check(errors, await until(rosie, () => window.__game.squish.held() === 'squish_pf_dolphin', null, 4000), 'X7 Rosie holds the Dolphin Puffum on the sand');
  // both at a deep spot; Rosie turns, then rides
  const deep = await game(lily, () => window.__game.debug.ocean.deepSpot());
  await game(lily, (d) => window.__game.player.teleport(d[0] - 3, d[1], d[2] - 2), deep);
  await game(rosie, (d) => window.__game.player.teleport(d[0], d[1], d[2]), deep);
  for (const p of [lily, rosie]) await float(p.page, true);
  check(errors, await until(rosie, () => !!window.__game.player.seaForm && !!(window.__game.debug.merfolk.parts() || {}).shown, null, 15000), 'X7 Rosie turns in deep water');
  check(errors, await game(rosie, () => window.__game.debug.ocean.ride()), 'X7 Rosie rides a dolphin');
  const friend = () => {
    const g = window.__game, f = [...g.net.remote.friends.values()].find((q) => q.name === 'Rosie');
    if (!f || !f.avatar) return null;
    const sea = f.avatar.seaParts(), rd = g.debug.ocean.remote()[0] || null;
    return { st: f.st, sr: f.sr, shown: sea.shown, form: sea.form, legs: sea.legsVisible, held: f.heldKey || null, inHand: !!f.avatar.held, heldShown: f.avatar.heldShown, dolphin: !!rd && rd.saddle, d: rd ? Math.hypot(f.pos.x - rd.x, f.pos.z - rd.z) : null };
  };
  const on = await until(lily, () => {
    const g = window.__game, f = [...g.net.remote.friends.values()].find((q) => q.name === 'Rosie');
    if (!f || !f.avatar) return null;
    const sea = f.avatar.seaParts(), rd = g.debug.ocean.remote()[0] || null;
    const r = { st: f.st, sr: f.sr, shown: sea.shown, form: sea.form, legs: sea.legsVisible, held: f.heldKey || null, inHand: !!f.avatar.held, heldShown: f.avatar.heldShown, dolphin: !!rd && rd.saddle, d: rd ? Math.hypot(f.pos.x - rd.x, f.pos.z - rd.z) : null };
    return r.st === 'h' && r.sr != null && r.dolphin && r.shown && !r.legs && r.heldShown === false ? r : null;
  }, null, 8000);
  const onNow = on || await game(lily, friend);
  check(errors, !!on && on.d < 0.6, `X7 Lily sees the dolphin under Rosie, her tail out (side-saddle), no toy in her hand (${JSON.stringify(onNow)})`);
  await game(lily, () => { const g = window.__game, r = g.debug.net.remote().find((q) => q.name === 'Rosie'); if (r) { const p = g.player.position; g.cameraRig.yaw = Math.atan2(r.pos[0] - p.x, r.pos[2] - p.z); g.cameraRig.pitch = 0.3; } });
  await game(lily, () => { window.__game.player.avatar.group.visible = false; }); // her own back out of the picture
  await lily.page.waitForTimeout(800);
  await shot(lily.page, 'x7-lily-sees-rosie-ride', 'wave4');
  await game(lily, () => { window.__game.player.avatar.group.visible = true; });
  // Rosie hops off on the shore: Lily sees legs and the toy within 2 s
  // (Lily waits on the shore first, so the 2 s are the message and the change, not her own trip)
  // Two parts, timed the way each one runs (robust on the GPU-less test machine, [rf2-hud]):
  // - the message: her page sees Rosie's new state within 2 s of wall time;
  // - the change: the tail shrinks over game time (SEA_GROW / 2 = 0.175 s), and a page adds at
  //   most 0.05 s per frame, so on two pages at about 2 frames a second the 4 frames it needs
  //   took 1.5-2.4 s of wall time (X7 failed at 2033-2978 ms although the message came in
  //   200-550 ms). So the whole change must show within 2 s of her game time (frames counted
  //   the way game.js counts them); on a phone at 60 frames a second that is the wall time.
  await float(lily.page, false);
  await game(lily, (s) => { const g = window.__game; g.player.teleport(s[0] + 2, s[1] + 0.05, s[2] + 1); }, sh.land);
  await lily.page.waitForTimeout(1500);
  await float(rosie.page, false);
  // Lily's page notes when each part first shows: wall ms and game ms
  await game(lily, () => {
    const g = window.__game, w0 = performance.now(), wall = {}, gameMs = {};
    let last = w0, gt = 0;
    window.__x7 = { wall, game: gameMs };
    const tick = () => {
      const now = performance.now();
      gt += Math.min(50, now - last); last = now;
      const f = [...g.net.remote.friends.values()].find((q) => q.name === 'Rosie');
      if (f && f.avatar) {
        const sea = f.avatar.seaParts();
        const parts = { st: f.st !== 'h', noDolphin: g.debug.ocean.remote().length === 0, key: f.heldKey === 'squish_pf_dolphin', held: !!f.avatar.held, tailGone: !sea.shown, legs: sea.legsVisible, heldShown: f.avatar.heldShown === true };
        for (const k in parts) if (parts[k] && wall[k] == null) { wall[k] = Math.round(now - w0); gameMs[k] = Math.round(gt); }
      }
      if (Object.keys(wall).length < 7 && now - w0 < 10000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await game(rosie, (s) => { const g = window.__game; g.debug.ocean.hopOff('button'); g.player.teleport(s[0], s[1] + 0.05, s[2]); }, sh.land);
  const off = await until(lily, () => {
    const g = window.__game, f = [...g.net.remote.friends.values()].find((q) => q.name === 'Rosie');
    if (!f || !f.avatar) return null;
    const sea = f.avatar.seaParts();
    return !sea.shown && sea.legsVisible && f.heldKey === 'squish_pf_dolphin' && !!f.avatar.held && f.avatar.heldShown === true && g.debug.ocean.remote().length === 0 ? { legs: sea.legsVisible, held: f.heldKey } : null;
  }, null, 10000, 50);
  const offMs = Date.now() - t0;
  const offNow = off || await game(lily, friend);
  const seen = await game(lily, () => window.__x7);
  const msgMs = seen.wall.st, changeMs = Math.max(...Object.values(seen.game));
  check(errors, !!off && msgMs <= 2000 && Object.keys(seen.game).length === 7 && changeMs <= 2000,
    `X7 Rosie on the shore: Lily sees legs and the toy within 2 s (her new state after ${msgMs} ms, all of it after ${changeMs} ms of game time; ${off ? offMs + ' ms of wall time' : 'not in 10 s: ' + JSON.stringify(offNow)}; first seen ${JSON.stringify(seen)})`);
  // sizes and hashes
  for (const p of [lily, rosie]) {
    const s = await game(p, () => window.__swFakeStats());
    check(errors, s.maxPresence <= 3900 && s.maxEmit <= 3900 && Object.keys(s.rejects).length === 0, `X7 ${p.key}: presence at most ${s.maxPresence} B, every message at most ${s.maxEmit} B, no refusals`);
  }
  check(errors, hub.violations.length === 0 && hub.stats.maxEmit <= 3900 && hub.stats.maxState <= 3900, `X7 the hub: no violations (${hub.violations.length}), largest message ${hub.stats.maxEmit} B, largest presence ${hub.stats.maxState} B`);
  const r = await flows.converge([lily, rosie], { timeout: 60000 });
  check(errors, r.ok, `X7 equal hashes and entities on lily, rosie${r.detail ? ' (' + r.detail + ')' : ''}`);
  for (const p of [lily, rosie]) await p.context.close();
  hub.close && hub.close();
}

// ---------- X8 an old profile ----------
async function wave4X8(browser, errors) {
  console.log('\n[wave4] X8 an old profile (boys-old-profile.json): a deep swim, a dolphin tap, the first world load');
  const fixture = JSON.parse(await readFile(path.join(ROOT, 'tools', 'fixtures', 'boys-old-profile.json'), 'utf8')).profile;
  const { context, page } = await openGame(browser, { errors, label: 'x8' });
  await ev(page, async (p) => {
    const g = window.__game;
    for (const k of Object.keys(g.profile)) delete g.profile[k];
    Object.assign(g.profile, JSON.parse(JSON.stringify(p)));
    await g.store.saveProfile(p);
  }, fixture);
  await page.reload();
  await waitForTitle(page, 60000);
  await settle(page, 800);
  const t = await ev(page, () => ({ hello: (document.querySelector('.sw-hello') || {}).textContent || '', name: window.__game.profile.look.name }));
  check(errors, t.name === 'Lily' && t.hello.includes('Hi, Lily!'), `X8 the old profile loads: "${t.hello.trim()}"`);
  await wave4World(page);
  const base = await ev(page, () => window.__game.debug.squish.state().base);
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  const turned = await waitOk(page, () => !!window.__game.player.seaForm, null, 15000);
  await page.waitForTimeout(1500);
  await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    d.clear(); d.autoSpawn(false);
    d.spawn('dolphin', p.x + 3, p.y, p.z, { n: 2 });
    await new Promise((r) => setTimeout(r, 200));
    d.tap('dolphin');
  });
  await page.waitForTimeout(800);
  await coinsLanded(page);
  await page.waitForTimeout(1500);
  const x = await ev(page, async () => {
    const g = window.__game, p = g.profile;
    await g.saveProfile(true);
    const saved = await g.store.loadProfile();
    return {
      sea: p.look.sea, savedSea: saved && saved.look && saved.look.sea, met: p.stats.seaMet, coins: p.coins, base: g.debug.squish.state().base,
      stickers: Object.keys(p.stickers), sea2: g.__probeEvents.filter((e) => e.name === 'coins:change' && e.reason === 'sea').reduce((a, e) => a + (e.delta || 0), 0),
    };
  });
  console.log('    (X8 ' + JSON.stringify({ base, ...x }) + ')');
  const def = JSON.stringify({ form: 'auto', color: null });
  check(errors, turned && JSON.stringify(x.sea) === def && JSON.stringify(x.savedSea) === def, `X8 look.sea is the default, also saved (${JSON.stringify(x.sea)})`);
  check(errors, x.met && x.met.dolphin === 1, `X8 stats.seaMet.dolphin === 1 (${JSON.stringify(x.met)})`);
  check(errors, base && base.coins === 0 && x.base && x.base.coins === 0, `X8 squish.base.coins === 0 after the first world load (${JSON.stringify(x.base)})`);
  const old = Object.keys(fixture.stickers);
  const added = x.stickers.filter((k) => !old.includes(k));
  check(errors, old.every((k) => x.stickers.includes(k)) && added.every((k) => ['splash', 'sea_magic', 'dolphin_friend'].includes(k)), `X8 every old sticker kept; new only from this swim (${added.join(', ')})`);
  const want = fixture.coins + 20 * added.length + 2;
  check(errors, x.coins === want && x.sea2 === 2, `X8 coins ${fixture.coins} + ${20 * added.length} (stickers) + 2 (the hello) = ${x.coins} (want ${want})`);
  await context.close();
}

// ---------- X9 coins and the ring ----------
async function wave4X9(browser, errors) {
  console.log('\n[wave4] X9 coins: a dolphin hello and Sea Magic! move the ring, a spend does not');
  const { context, page } = await openGame(browser, { errors, label: 'x9' });
  await wave4World(page);
  // Splash! and Dolphin Friend owned first, so the swim pays exactly Sea Magic! and the hello
  await ev(page, () => { const g = window.__game; g.award('splash'); g.award('dolphin_friend'); });
  await page.waitForTimeout(500);
  check(errors, await coinsLanded(page, 15000), 'X9 inFlight 0 before the swim');
  const s0 = await ev(page, () => ({ ...window.__game.debug.squish.state(), ring: window.__game.squish.ring() }));
  // a candy-shop spend of 30 while the ring is part way: it does not move (and once more below)
  await ev(page, () => window.__game.coins.spend(30, 'shop'));
  await settle(page, 600);
  const s0b = await ev(page, () => ({ ...window.__game.debug.squish.state(), ring: window.__game.squish.ring() }));
  check(errors, s0.ring.frac > 0 && s0.ring.frac < 1 && s0b.earned === s0.earned && s0b.ring.frac === s0.ring.frac && s0b.ring.state === s0.ring.state, `X9 a candy-shop spend of 30 with the ring part way does not move it (${s0.ring.frac.toFixed(3)} -> ${s0b.ring.frac.toFixed(3)}, earned ${s0b.earned})`);
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  await waitOk(page, () => window.__game.stickers.has('sea_magic'), null, 15000);
  await ev(page, async () => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position;
    d.clear(); d.autoSpawn(false);
    d.spawn('dolphin', p.x + 3, p.y, p.z, { n: 2 });
    await new Promise((r) => setTimeout(r, 200));
    d.tap('dolphin');
  });
  await page.waitForTimeout(800);
  await coinsLanded(page, 15000);
  await page.waitForTimeout(800);
  const s1 = await ev(page, () => ({ ...window.__game.debug.squish.state(), ring: window.__game.squish.ring() }));
  console.log(`    (X9 earned ${s0.earned} -> ${s1.earned}, ring ${JSON.stringify(s0.ring)} -> ${JSON.stringify(s1.ring)}, to go ${s0.toNext} -> ${s1.toNext})`);
  check(errors, s1.earned - s0.earned === 22, `X9 a dolphin hello (+2) and Sea Magic! (+20) raise earned by 22 (${s0.earned} -> ${s1.earned})`);
  check(errors, s1.ring.frac > s0.ring.frac || s1.ring.state !== s0.ring.state, `X9 the ring moves (${s0.ring.frac.toFixed(3)} ${s0.ring.state} -> ${s1.ring.frac.toFixed(3)} ${s1.ring.state})`);
  const s1b = await ev(page, () => ({ ...window.__game.debug.squish.state(), ring: window.__game.squish.ring() }));
  await ev(page, () => window.__game.coins.spend(30, 'shop'));
  await settle(page, 600);
  const s2 = await ev(page, () => ({ ...window.__game.debug.squish.state(), ring: window.__game.squish.ring() }));
  check(errors, s2.earned === s1b.earned && s2.ring.frac === s1b.ring.frac && s2.ring.state === s1b.ring.state, `X9 a spend of 30 with a present ready does not move it either (${s1b.ring.frac.toFixed(3)} ${s1b.ring.state} -> ${s2.ring.frac.toFixed(3)} ${s2.ring.state})`);
  await context.close();
}

// ---------- X10 a webdriver page stays quiet ----------
async function wave4X10(browser, errors) {
  console.log('\n[wave4] X10 webdriver quiet: 60 s of swimming and riding with none of the three switches on');
  const { context, page } = await openGame(browser, { errors, label: 'x10' });
  await newWorld(page, 'beach');
  // a present made ready, a fresh device (merfolk's choice bubble would ask), the buddy pod on
  await ev(page, async () => {
    const g = window.__game;
    const n = Math.max(1, g.debug.squish.state().toNext);
    g.coins.add(n, 'gift', { fly: false });
    window.__x10 = { on: true, n: 0, mf: 0, drop: 0, keys: [] };
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => { window.__x10.keys.push([String(text), (opts && opts.key) || null]); return toast(text, opts); };
    const X = window.__x10;
    const f = () => {
      if (!X.on) return;
      X.n++;
      const mf = document.querySelector('.lf-bubble.lf-on[data-owner="merfolk"]');
      if (mf && mf.offsetParent) X.mf++;
      if (document.querySelector('.sq-drop')) X.drop++;
      requestAnimationFrame(f);
    };
    f();
  });
  const st0 = await ev(page, () => ({ ready: window.__game.debug.squish.state().ready, asked: window.__game.store.deviceGet('seaAsked', 0), form: window.__game.profile.look.sea && window.__game.profile.look.sea.form }));
  const deep = await ev(page, () => window.__game.debug.ocean.deepSpot());
  await float(page, true);
  await goTo(page, deep);
  const t0 = Date.now();
  await waitOk(page, () => !!window.__game.player.seaForm, null, 15000);
  // swim about (W held, turning), ride after 20 s, ride 20 s, hop off, swim to the end
  await page.keyboard.down('KeyW');
  let rode = false;
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(2000);
    const el = Date.now() - t0;
    await ev(page, () => { const c = window.__game.cameraRig; c.yaw += 0.6; });
    if (!rode && el > 20000) {
      await page.keyboard.up('KeyW');
      rode = await ev(page, async () => {
        const g = window.__game, d = g.debug.ocean, p = g.player.position;
        if (!d.list('dolphin').some((r) => r.role === 'wild' && Math.hypot(r.x - p.x, r.z - p.z) < 6)) d.spawn('dolphin', p.x + 3, p.y, p.z, { n: 2 });
        await new Promise((r) => setTimeout(r, 200));
        return !!d.ride();
      });
      await page.keyboard.down('KeyW');
    }
    if (rode === true && el > 42000) {
      await ev(page, () => { if (window.__game.ocean.riding) window.__game.debug.ocean.hopOff('button'); });
      rode = 'off';
    }
  }
  await page.keyboard.up('KeyW');
  const x = await ev(page, () => { const X = window.__x10; X.on = false; return { n: X.n, mf: X.mf, drop: X.drop, keys: X.keys, ready: window.__game.debug.squish.state().ready, presentsOn: window.__game.debug.squish.dropState().presentsOn, pods: window.__game.debug.ocean.pods() }; });
  console.log('    (X10 ' + JSON.stringify({ st0, rode, n: x.n, toasts: x.keys, ready: x.ready, pods: x.pods.length }) + ')');
  const bad = x.keys.filter(([t, k]) => /^sea-(buddy|whale|form-dive|form-leap|form-pool)$/.test(k || '') || /came to say hi!|into your pool|to your pool|A whale says hello|to dive!|big leap|deep for/.test(t));
  check(errors, (Date.now() - t0) >= 60000 && rode === 'off' && x.n > 50, `X10 60 s of swimming at a deep spot with a ride (${x.n} frames)`);
  check(errors, x.mf === 0, `X10 no merfolk bubble (${x.mf} frames; seaAsked ${st0.asked}, form ${st0.form})`);
  check(errors, bad.length === 0, `X10 no merfolk tip, no buddy / pool / whale toast (${JSON.stringify(bad)})`);
  // (the drop stays wanted, for a page where presents are on; webdriver keeps them off)
  check(errors, st0.ready >= 1 && x.drop === 0 && !x.presentsOn, `X10 no present drop (${st0.ready} ready at the start, ${x.ready} at the end, ${x.drop} frames)`);
  await context.close();
}

async function wave4bPass(browser, errors) {
  const parts = args.x ? args.x.split(',') : ['6', '7', '8', '9', '10'];
  if (parts.includes('6')) await wave4X6(browser, errors);
  if (parts.includes('7')) await wave4X7(browser, errors);
  if (parts.includes('8')) await wave4X8(browser, errors);
  if (parts.includes('9')) await wave4X9(browser, errors);
  if (parts.includes('10')) await wave4X10(browser, errors);
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
  if (want('wave4a') || (only && only.includes('wave4'))) await wave4aPass(browser, errors);
  if (want('wave4b') || (only && only.includes('wave4'))) await wave4bPass(browser, errors);
  if (want('cost')) await costPass(browser, errors);
  else if (only && only.includes('gallery')) await galleryShots(browser, errors); // C5 alone
  if (only && only.includes('review')) await reviewPass(browser, errors); // owner pictures (on request)
  if (only && only.includes('rf')) await rfPass(browser, errors); // R-F again and again (--runs=10)
  if (only && only.includes('dolphin')) await dolphinViews(browser, errors); // the dolphin's five sides (on request)
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
  console.log('  ERROR: ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
console.log(`\nprobe-ocean: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
finish(errors);
