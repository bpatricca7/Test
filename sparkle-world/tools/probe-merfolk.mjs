// Sea forms probe (docs/teams/merfolk.md §14.3): a mermaid tail or a sea dragon form in deep
// water, through the real game (keys, the touch HUD, the Studio) with the debug API to set up
// scenes and read results.
//
//   unit     the Node tests (tools/test-merfolk.mjs) and the name scan of the sea strings
//   water    beach, desktop: turning in (B1, B3), the pool tip (B2), speed (B4), Up / Down and the
//            tint (B5), the leap (B6, B6b), the shore exit (B7, B7b), Just Me (B8), the Boy style
//            and privacy (B9)
//   swim     cameras (B11), photos (B12), random swimming (B15), the candy sea (B16), the
//            first-turn bubble (B17), tips (B18), boats, flying and zip lines (B10)
//   studio   the Water tab, desktop then iPad (C1-C9), and the render grids for the owner (C5)
//   grids    only the C5 render grids (also part of studio)
//   review   the owner's showcase pictures of the Sea Dragon (merfolk-review-*.png): the boy
//            starter and the default girl from the front, three-quarter, side and back, in the
//            water from the play camera, under water, at night, and next to a mermaid
//   touch    iPad 1024x768: the HUD, the joystick label, Down, the shore with the joystick (T1-T5)
//   friends  Aria and Leo turn too, one line per visit, they keep up (D1, D2)
//   costs    draw calls, meshes, the first turn, toggles, systems time, the tint (B13a-f)
//   save     an old profile (B14), a world saved in sea form
//
//   node tools/probe-merfolk.mjs [--only=unit,water,swim,studio,grids,review,touch,friends,costs,save] [--headed]

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { launch, openGame, waitIdle, waitForTitle, shot, settle, finish, screenPoint, ROOT, SHOTS } from './smoke.mjs';

const PREFIX = 'merfolk';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : null;
const want = (name) => !only || only.includes(name);
const IPAD = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };

function check(errors, cond, message) {
  if (!cond) {
    errors.push('[check] ' + message);
    console.log('  FAIL: ' + message);
  } else console.log('  ok: ' + message);
  return !!cond;
}

const wait = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
const waitOk = (page, fn, arg, timeout) => wait(page, fn, arg, timeout).then(() => true, () => false);
const st = (page) => page.evaluate(() => window.__game.debug.merfolk.state());
const parts = (page) => page.evaluate(() => window.__game.debug.merfolk.parts());

/** A fresh world of `biome` with the probe tweaks (no tutorial, low quality, the bubble asked). */
async function newWorld(page, biome = 'beach', { asked = true, tips = false, size = 'cozy' } = {}) {
  await page.evaluate(([b, size]) => window.__game.debug.newWorld({ biome: b, size }), [biome, size]);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await page.evaluate(([asked, tips]) => {
    const g = window.__game;
    g.profile.tutorialDone = true;
    g.profile.settings.quality = 'low'; // SwiftShader: the 3D at 1x
    g.applySettings();
    if (asked) g.store.deviceSet('seaAsked', 2);
    g.debug.merfolk.tips(tips);
  }, [asked, tips]);
  await record(page);
}

/** Record sea events, toasts and the magic sound. */
async function record(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__mf) return;
    g.__mf = [];
    for (const name of ['player:seaform', 'player:leap', 'player:seaswim', 'sticker:earned', 'player:swim', 'style:changed']) {
      g.events.on(name, (p) => g.__mf.push({
        name, t: performance.now(),
        form: p && 'form' in p ? p.form : undefined, on: p && 'on' in p ? p.on : undefined,
        sticker: p && p.sticker ? p.sticker.id : undefined,
      }));
    }
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => {
      window.__toasts.push(String(text));
      return toast(text, opts);
    };
    window.__sounds = [];
    const play = g.audio.play.bind(g.audio);
    g.audio.play = (name, o) => {
      window.__sounds.push({ name, pitch: o && o.pitch, t: performance.now() });
      return play(name, o);
    };
  });
}
const evs = (page, name) => page.evaluate((n) => window.__game.__mf.filter((e) => e.name === n), name);
const clearEvs = (page) => page.evaluate(() => { window.__game.__mf.length = 0; window.__toasts.length = 0; window.__sounds.length = 0; });
const toastSeen = (page, re, timeout = 6000) => waitOk(page, (src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, timeout);

/** Teleport, face a yaw (the camera: movement is camera-relative), settle a moment. */
async function place(page, [x, y, z], yaw = null, ms = 250) {
  await page.evaluate(([x, y, z, yaw]) => {
    const g = window.__game;
    g.player.setFlying(false);
    g.player.teleport(x, y, z);
    if (yaw !== null) {
      g.cameraRig.yaw = yaw;
      g.player.yaw = yaw;
    }
  }, [x, y, z, yaw]);
  await settle(page, ms);
}

/**
 * Hold keys for `ms` of GAME time, sampling the sea state every frame; returns the samples.
 * s.t is game milliseconds: the game clamps a frame to 50 ms, so on a slow SwiftShader page
 * game time runs slower than the wall clock, and every "within N s" below is game time (what a
 * child sees at a normal frame rate). s.wall is the wall clock.
 */
async function hold(page, keys, ms, { until = null, arg = null } = {}) {
  for (const k of keys) await page.keyboard.down(k);
  const samples = await page.evaluate(([ms, until, arg]) => new Promise((resolve) => {
    const g = window.__game, out = [], t0 = performance.now();
    const stop = until ? new Function('s', 'arg', `return (${until})(s, arg);`) : null;
    let last = t0, gt = 0;
    const tick = () => {
      const now = performance.now();
      gt += Math.min(50, now - last);
      last = now;
      const s = g.debug.merfolk.state();
      s.t = gt;
      s.wall = now - t0;
      s.x = g.player.position.x;
      s.z = g.player.position.z;
      out.push(s);
      if (s.t >= ms || s.wall > ms * 6 || (stop && stop(s, arg))) resolve(out);
      else requestAnimationFrame(tick);
    };
    tick();
  }), [ms, until ? until.toString() : null, arg]);
  for (const k of keys) await page.keyboard.up(k);
  return samples;
}

const yawToward = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);
/** Wait `ms` of game time (no keys). */
const gameWait = (page, ms) => hold(page, [], ms);
/** In deep water, turned and floated up to the surface, still. */
async function atSurface(page, spot, yaw = null) {
  await place(page, spot, yaw, 100);
  await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 5000);
  await hold(page, [], 6000, { until: (s) => s.t > 1200 && Math.abs(s.vy) < 0.03 && s.swimming });
}

/** Into deep water and turned (the gate on); returns the shore info. */
async function turnAt(page, spot, ms = 1600) {
  await place(page, spot);
  await waitOk(page, () => { const s = window.__game.debug.merfolk.state(); return s.seaSwim; }, null, ms + 2000);
  await settle(page, ms);
}

// ---------------- unit ----------------

function unitPass(errors) {
  console.log('Unit (Node)');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/test-merfolk.mjs')], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  check(errors, r.status === 0 && m && m[2] === '0', `tools/test-merfolk.mjs: ${m ? m[0] : 'did not finish'}`);
  if (r.status !== 0) console.log(out.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
}

// ---------------- water (desktop, beach) ----------------

async function waterPass(browser, errors) {
  console.log('Water (desktop 1280x800, Beach, style never picked)');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'water' });
  await newWorld(page, 'beach');
  const sh = await page.evaluate(() => window.__game.debug.merfolk.shore());
  c(!!sh, `a deep spot next to the beach (${JSON.stringify(sh)})`);
  if (!sh) {
    await context.close();
    return;
  }
  const level = await page.evaluate(() => window.__game.world.waterLevel);
  const toWater = Math.atan2(-sh.dir[0], -sh.dir[1]), toLand = Math.atan2(sh.dir[0], sh.dir[1]);

  // B1 walk in from the sand
  await place(page, [sh.land[0], sh.land[1] + 0.05, sh.land[2]], toWater, 400);
  await clearEvs(page);
  const walk = await hold(page, ['KeyW'], 8000, { until: (s) => !!s.seaForm });
  const firstDeep = walk.find((s) => s.deep && s.swimming);
  const turned = walk.find((s) => s.seaForm);
  c(!!turned && turned.seaForm === 'mermaid', `B1 walking in from the beach she turns into a mermaid (${turned ? turned.seaForm : 'never'})`);
  c(!!firstDeep && !!turned && turned.t - firstDeep.t <= 1200, `B1 within 1.2 s of deep water (${firstDeep && turned ? Math.round(turned.t - firstDeep.t) : '-'} ms)`);
  await gameWait(page, 500); // game time: the tail grows in 0.35 s of play, however slow the frames
  const p1 = await parts(page);
  c(p1 && p1.shown && p1.legsVisible === false && p1.flaresVisible === false, `B1 the tail shows, legs and skirt hidden (${JSON.stringify(p1)})`);
  const f1 = await evs(page, 'player:seaform');
  c(f1.length === 1 && f1[0].form === 'mermaid', `B1 one 'player:seaform' (${f1.length})`);
  c(await page.evaluate(() => window.__game.stickers.has('sea_magic')), 'B1 the Sea Magic! sticker');
  await settle(page, 600);
  await shot(page, 'mermaid-in', PREFIX);

  // B3 let go: she floats up to the surface and stays there
  await page.evaluate((s) => { const g = window.__game; g.player.position.y = s.deep[1] - 0.5; }, sh);
  await clearEvs(page);
  const rise = await hold(page, [], 2500, { until: (s, top) => s.y + 1.1 >= top, arg: sh.top });
  const up = rise[rise.length - 1];
  c(up.y + 1.1 >= sh.top, `B3 letting go she floats up: chest above the surface within 2.5 s (${Math.round(up.t)} ms)`);
  const idle = await hold(page, [], 5000);
  const swimFrac = idle.filter((s) => s.swimming).length / idle.length;
  const maxVy = Math.max(...idle.slice(20).map((s) => Math.abs(s.vy)));
  const f3 = await evs(page, 'player:seaform');
  c(f3.length === 0 && idle.every((s) => s.seaForm === 'mermaid'), `B3 5 s idle at the surface: no new 'player:seaform', still a mermaid (${f3.length})`);
  c(swimFrac >= 0.95, `B3 swimming on ${(swimFrac * 100).toFixed(0)} % of frames (>= 95 %)`);
  c(maxVy < 0.4, `B3 |vy| < 0.4 at the surface (${maxVy.toFixed(2)})`);

  // B4 speed (deep spot, at the surface)
  const ds = await page.evaluate(() => window.__game.debug.merfolk.deepSpot(80, 4));
  c(!!ds, `a 4-deep spot (${JSON.stringify(ds)})`);
  const deep = ds ? [ds.x, ds.y, ds.z] : sh.deep;
  const deepTop = ds ? ds.top : sh.top;
  // swim along open water: pick the direction with the most deep water ahead
  const openYaw = await page.evaluate(([x, z]) => {
    const g = window.__game;
    let best = 0, bestN = -1;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      let n = 0;
      for (let d = 1; d < 16; d++) {
        const c = g.debug.merfolk.column(x + Math.sin(ang) * d, z + Math.cos(ang) * d);
        if (c.depth >= 3) n++;
        else break;
      }
      if (n > bestN) { bestN = n; best = ang; }
    }
    return best;
  }, [deep[0], deep[2]]);
  await atSurface(page, deep, openYaw);
  const fast = await hold(page, ['KeyW'], 2000);
  const hs4 = fast[fast.length - 1].hs;
  c(hs4 >= 4.2, `B4 W for 2 s: ${hs4.toFixed(2)} blocks/s (>= 4.2)`);
  await atSurface(page, deep, openYaw);
  const y0 = (await st(page)).y;
  const shift = await hold(page, ['ShiftLeft', 'KeyW'], 2000);
  const last = shift[shift.length - 1];
  c(Math.abs(last.y - y0) < 0.3 && last.hs >= 5.5, `B4b Shift+W: fast (${last.hs.toFixed(2)} >= 5.5) and never down (dy ${(last.y - y0).toFixed(2)})`);

  // B5 Down and Up, and the tint
  await atSurface(page, deep, openYaw);
  await page.evaluate(() => { window.__game.cameraRig.pitch = 0.05; });
  const yA = (await st(page)).y;
  await hold(page, ['KeyC'], 1500);
  const yB = (await st(page)).y;
  c(yA - yB >= 2, `B5 C for 1.5 s dives (dy ${(yB - yA).toFixed(2)})`);
  await gameWait(page, 300);
  const under = await page.evaluate(() => ({ u: window.__game.underwater, on: document.querySelector('.sw-underwater').classList.contains('sw-uw-on'), cam: window.__game.camera.position.y }));
  c(under.u === 'water' && under.on, `B5 the camera under the water: the tint shows (${JSON.stringify(under)})`);
  await shot(page, 'underwater', PREFIX);
  const yB2 = (await st(page)).y;
  await hold(page, ['Space'], 1500);
  const yC = (await st(page)).y;
  c(yC - yB2 >= 2 || yC + 1.1 >= deepTop, `B5 Space for 1.5 s rises (dy ${(yC - yB2).toFixed(2)})`);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.3; });
  await settle(page, 600);
  const above = await page.evaluate(() => ({ u: window.__game.underwater, on: document.querySelector('.sw-underwater').classList.contains('sw-uw-in'), cam: window.__game.camera.position.y }));
  c(above.u === null && !above.on, `B5 above the water: no tint (${JSON.stringify(above)})`);

  // B6 the leap
  await atSurface(page, deep, openYaw);
  await clearEvs(page);
  const leap = await hold(page, ['ShiftLeft', 'KeyW', 'Space'], 2500, { until: (s) => s.t > 1500 && s.swimming && s.vy < 0 });
  const peak = Math.max(...leap.map((s) => s.y));
  const leaps = await evs(page, 'player:leap');
  c(leaps.length >= 1, `B6 Shift+W with Space at the surface: a dolphin leap ('player:leap' x${leaps.length})`);
  c(peak >= level + 1.4, `B6 the peak clears the water (feet ${peak.toFixed(2)} >= top water cell ${level} + 1.4)`);
  c(leap.every((s) => s.seaForm === 'mermaid'), 'B6 she stays a mermaid through the leap');
  c(await page.evaluate(() => window.__game.stickers.has('big_leap')), 'B6 the Big Leap! sticker');
  // a picture in the air
  await atSurface(page, deep, openYaw);
  await hold(page, ['ShiftLeft', 'KeyW', 'Space'], 2500, { until: (s) => !s.swimming && s.vy < 2 });
  await shot(page, 'leap', PREFIX);
  await settle(page, 1500);

  // B6b double Space in deep water never flies
  await place(page, deep, openYaw, 300);
  await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 3000);
  await settle(page, 1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await settle(page, 400);
  const b6b = await page.evaluate(() => ({ flying: window.__game.player.flying, form: window.__game.player.seaForm }));
  c(!b6b.flying && b6b.form === 'mermaid', `B6b double Space in deep water: no flying, still a mermaid (${JSON.stringify(b6b)})`);

  // B7 the shore exit holding only W: from the surface, the floor and mid-water
  for (const how of ['surface', 'floor', 'mid']) {
    await place(page, sh.deep, toLand, 200);
    await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 3000);
    await page.evaluate(([how, s]) => {
      const g = window.__game;
      g.cameraRig.yaw = s.yaw;
      g.player.yaw = s.yaw;
      if (how === 'surface') g.player.position.y = s.top - 1.0;
      else if (how === 'mid') g.player.position.y = s.top - 1.9;
      else g.player.position.y = s.top - s.depth + 0.05;
    }, [how, sh]);
    await settle(page, how === 'surface' ? 900 : 100);
    await clearEvs(page);
    const out = await hold(page, ['KeyW'], 5000, { until: (s, top) => !s.seaForm && !s.swimming && s.y >= top - 0.05, arg: sh.top });
    const end = out[out.length - 1];
    await gameWait(page, 450); // the tail shrinks in 0.35 s
    const back = await evs(page, 'player:seaform');
    const legs = (await parts(page)) || {};
    c(!end.seaForm && !end.swimming && end.y >= sh.top - 0.05 && end.t <= 3000,
      `B7 from the ${how}, only W: on the sand with legs within 3 s (${Math.round(end.t)} ms, y ${end.y.toFixed(2)} top ${sh.top})`);
    c(back.some((e) => e.form === null) && legs.legsVisible, `B7 (${how}) 'player:seaform' { form: null } and the legs show`);
  }
  await shot(page, 'shore-out', PREFIX);

  // B8 Just Me
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.look = { ...g.profile.look, sea: { form: 'me', color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
  });
  await clearEvs(page);
  await place(page, deep, openYaw, 300);
  const meOn = await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 3000);
  await settle(page, 1500);
  const me = await st(page);
  const meParts = await parts(page);
  const meForms = await evs(page, 'player:seaform');
  c(meOn && me.seaSwim && !me.seaForm && meForms.length === 0 && (!meParts.shown && meParts.legsVisible), `B8 Just Me: easy deep-water swimming, no tail, no 'player:seaform' (${JSON.stringify({ seaSwim: me.seaSwim, ev: meForms.length })})`);
  const meFast = await hold(page, ['KeyW'], 2000);
  const meHs = meFast[meFast.length - 1].hs;
  c(meHs >= 3.6 && meHs <= 4.2, `B8 Just Me speed ${meHs.toFixed(2)} (3.6 to 4.2)`);
  await atSurface(page, deep, openYaw);
  const meY0 = (await st(page)).y;
  await hold(page, ['KeyC'], 1200);
  const meY1 = (await st(page)).y;
  c(meY0 - meY1 >= 1.2, `B8 Just Me: C dives (dy ${(meY1 - meY0).toFixed(2)})`);
  const meRise = await hold(page, [], 6000, { until: (s, top) => s.y + 1.1 >= top, arg: deepTop });
  c(meRise[meRise.length - 1].y + 1.1 >= deepTop, 'B8 Just Me: letting go floats up');
  // a 1-deep pool: exactly today's swim
  const flatPool = await page.evaluate((s) => {
    const g = window.__game, w = g.world;
    // an 11x11 pool of water one block deep near the beach (wide enough that one second of
    // swimming from the middle never reaches the rim and hops out), raised three blocks on a
    // sand floor with a sand rim, so the sea next to the beach never runs into it or under it
    const x0 = Math.floor(s.land[0]) + s.dir[0] * 8, z0 = Math.floor(s.land[2]) + s.dir[1] * 8, y = Math.floor(s.land[1]) + 3;
    const opt = { history: false, fx: false };
    let n = 0;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const x = x0 + dx, z = z0 + dz;
      for (let yy = y - 1; yy <= y + 2; yy++) if (w.get(x, yy, z) !== 0) { g.removeBlock(x, yy, z, opt); if (w.get(x, yy, z) !== 0) w.set(x, yy, z, 0); }
      g.placeBlock(x, y - 1, z, 'sand', opt);
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 6) g.placeBlock(x, y, z, 'sand', opt);
      else if (g.placeBlock(x, y, z, 'water', opt)) n++;
    }
    return { x: x0 + 0.5, y, z: z0 + 0.5, n };
  }, sh);
  await place(page, [flatPool.x, flatPool.y + 0.02, flatPool.z], 0, 300);
  await gameWait(page, 600);
  const shallow = (await hold(page, ['KeyW'], 1000)).filter((s) => s.swimming);
  const sMax = Math.max(0, ...shallow.map((s) => s.hs));
  c(shallow.length > 5 && shallow.every((s) => !s.seaSwim) && sMax <= 3.0, `B8 1-deep water (${flatPool.n} cells): today's swimming (speed ${sMax.toFixed(2)} <= 3.0, no sea swimming, ${shallow.length} frames)${sMax > 3 ? ' ' + JSON.stringify({ pool: flatPool, s: shallow.filter((q) => q.hs > 3).slice(0, 4).map((q) => ({ t: Math.round(q.t), hs: +q.hs.toFixed(2), sea: q.seaSwim, deep: q.deep, y: +q.y.toFixed(2), x: +q.x.toFixed(2), z: +q.z.toFixed(2), st: q.state })) }) : ''}`);
  const sink = await hold(page, [], 800);
  c(sink[sink.length - 1].vy <= 0.01, `B8 1-deep water with no input: she stays down (vy ${sink[sink.length - 1].vy.toFixed(2)})${sink[sink.length - 1].vy > 0.01 ? ' ' + JSON.stringify(sink.slice(-4).map((q) => ({ t: Math.round(q.t), vy: +q.vy.toFixed(3), y: +q.y.toFixed(3), sw: q.swimming, st: q.state, x: +q.x.toFixed(2), z: +q.z.toFixed(2) }))) : ''}`);
  // back to auto
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.look = { ...g.profile.look, sea: { form: 'auto', color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
  });

  // B9 the Boy style: auto gives a sea dragon; an explicit mermaid stays; nothing names the style
  await page.evaluate(() => {
    const g = window.__game;
    g.store.deviceSet('surpriseStyle', 'boy');
    g.events.emit('style:changed', { style: 'boy' });
  });
  await place(page, deep, openYaw, 300);
  await waitOk(page, () => window.__game.player.seaForm, null, 3000);
  await settle(page, 600);
  const boyForm = await page.evaluate(() => window.__game.player.seaForm);
  c(boyForm === 'sea_dragon', `B9 Boy picked on this device: auto turns into a sea dragon (${boyForm})`);
  await shot(page, 'dragon-in', PREFIX);
  const lk = await page.evaluate(() => {
    const g = window.__game;
    const a = g.net && g.net.adapter ? g.net.adapter : null;
    const loc = a && typeof a.local === 'function' ? a.local() : null;
    return { lk: loc ? loc.lk : null, json: loc ? JSON.stringify(loc) : null };
  });
  if (lk.lk != null) {
    const toks = lk.lk.split('.');
    c(toks.length === 38 && toks[36] === '2', `B9 the adapter sends the resolved form (index 2, sea dragon), never 0 (${toks.slice(36).join('.')})`);
  } else console.log('  (B9 no adapter on a solo page: the lk check runs in probe-multiplayer SEA)');
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.look = { ...g.profile.look, sea: { form: 'mermaid', color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
  });
  await settle(page, 600);
  c(await page.evaluate(() => window.__game.player.seaForm) === 'mermaid', 'B9 an explicit Mermaid stays a mermaid under Boy');
  await page.evaluate(() => window.__game.saveProfile(true));
  await settle(page, 300);
  const priv = await page.evaluate(async () => {
    const g = window.__game;
    const saved = JSON.stringify(await g.store.loadProfile());
    const vals = [];
    const walk = (o) => { if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v); else vals.push(o); };
    walk(JSON.parse(saved));
    const a = g.net && g.net.adapter && typeof g.net.adapter.local === 'function' ? g.net.adapter.local() : {};
    walk(a);
    return vals.filter((v) => v === 'girl' || v === 'boy' || v === 'mix');
  });
  c(priv.length === 0, `B9 the saved profile and the presence never contain girl / boy / mix (${priv.join(',')})`);
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.look = { ...g.profile.look, sea: { form: 'auto', color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
    g.store.deviceSet('surpriseStyle', null);
    g.events.emit('style:changed', { style: null });
  });

  // B5 after exitToTitle: the tint is gone
  await place(page, deep, openYaw, 300);
  await settle(page, 1000);
  await hold(page, ['KeyC'], 1200);
  await settle(page, 300);
  const before = await page.evaluate(() => window.__game.underwater);
  await page.evaluate(() => window.__game.debug.exitToTitle());
  await waitForTitle(page);
  const gone = await page.evaluate(() => ({ u: window.__game.underwater, on: document.querySelector('.sw-underwater').classList.contains('sw-uw-on') }));
  c(before === 'water' && gone.u === null && !gone.on, `B5 after exitToTitle the tint is hidden and game.underwater is null (${before} -> ${JSON.stringify(gone)})`);
  await context.close();
}

// ---------------- swim (desktop) ----------------

/** The yaw from (x, z) with the most water at least `minDepth` deep ahead (up to 16 blocks). */
const openWater = (page, x, z, minDepth = 3) => page.evaluate(([x, z, m]) => {
  const g = window.__game;
  let best = 0, bestN = -1;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    let n = 0;
    for (let d = 1; d < 16; d++) {
      if (g.debug.merfolk.column(x + Math.sin(ang) * d, z + Math.cos(ang) * d).depth >= m) n++;
      else break;
    }
    if (n > bestN) { bestN = n; best = ang; }
  }
  return best;
}, [x, z, minDepth]);

/** The nearest column at least `d` deep, as a spot to drop her in. */
const deepAt = (page, d = 4) => page.evaluate((d) => window.__game.debug.merfolk.deepSpot(80, d), d);

async function swimPass(browser, errors) {
  console.log('Swim (desktop): pool tip, boats, flying, cameras, photos, random swimming, candy, bubble, tips');
  const c = (cond, msg) => check(errors, cond, msg);

  // B2 a 1-deep pool in a flat world: today's swimming, the pool tip once
  {
    const { context, page } = await openGame(browser, { errors, label: 'pool' });
    await newWorld(page, 'flat', { tips: true });
    const pool = await page.evaluate(() => {
      const g = window.__game, p = g.player.position;
      const x0 = Math.floor(p.x) + 3, z0 = Math.floor(p.z) - 2, h = g.world.heightAt(x0, z0);
      let n = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        g.removeBlock(x0 + a, h, z0 + b, { history: false, fx: false });
        if (g.debug.place('water', x0 + a, h, z0 + b)) n++;
      }
      return { x: x0 + 2, y: h, z: z0 + 2, n };
    });
    c(pool.n === 16, `B2 a 4x4 pool one block deep (${pool.n} water cells)`);
    await clearEvs(page);
    await place(page, [pool.x, pool.y + 0.02, pool.z], 0, 200);
    const s2 = await hold(page, [], 3400);
    const swimming = s2.filter((s) => s.swimming).length / s2.length;
    c(swimming > 0.9 && s2.every((s) => !s.seaForm && !s.seaSwim), `B2 3 s in 1-deep water: swimming, never a tail (${(swimming * 100).toFixed(0)} %)`);
    c(await toastSeen(page, /Make it 2 deep for mermaid magic!/, 3000), 'B2 the pool tip: "Make it 2 deep for mermaid magic!"');
    await place(page, [pool.x - 4, pool.y + 0.02, pool.z], 0, 200);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await place(page, [pool.x, pool.y + 0.02, pool.z], 0, 200);
    await hold(page, [], 3600);
    c(!(await page.evaluate(() => window.__toasts.some((t) => /Make it 2 deep/.test(t)))), 'B2 the pool tip shows only once');
    await context.close();
  }

  const { context, page } = await openGame(browser, { errors, label: 'swim' });
  await newWorld(page, 'beach');
  const level = await page.evaluate(() => window.__game.world.waterLevel);
  const ds = await deepAt(page, 4);
  const deep = [ds.x, ds.y, ds.z];

  // B10 boats: never a tail while she sails; the second Get out on open water turns her (out on
  // the open sea, far from any shore, so Get out asks first)
  const far = (await deepAt(page, 6)) || (await deepAt(page, 5)) || ds;
  const boat = await page.evaluate(([x, z, top]) => {
    const g = window.__game;
    const e = g.entities.place('boat_swan', Math.floor(x), top, Math.floor(z) + 2, 0, null, {}, { history: false, players: false });
    return e ? e.uid : null;
  }, [far.x, far.z, level]);
  c(!!boat, 'B10 a Swan Boat on the open water');
  if (boat) {
    await place(page, [far.x, level + 2, far.z + 2], null, 200);
    await clearEvs(page);
    await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), boat);
    await gameWait(page, 400);
    await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
    const sail = await hold(page, ['KeyW'], 2500);
    c(sail.every((s) => !s.seaForm && !s.seaSwim), 'B10 sailing across the water: never in sea form');
    await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.1, null, 15000);
    await page.evaluate(([x, z, top]) => window.__game.debug.vehicles.setPose(x, top, z + 2, 0), [far.x, far.z, level]);
    await page.keyboard.press('KeyE');
    await gameWait(page, 300);
    c(await page.evaluate(() => !!window.__game.vehicles.current), 'B10 open water: the first Get out asks first (she keeps sailing)');
    await page.locator('.lf-hud [data-action="vgetout"]').click({ timeout: 10000 });
    const t0 = await page.evaluate(() => performance.now());
    const off = await hold(page, [], 2500, { until: (s) => !!s.seaForm });
    const tTurn = off[off.length - 1];
    c(!!tTurn.seaForm && tTurn.t >= 250 && tTurn.t <= 1000 + 400, `B10 the second Get out on open water: she swims and turns ${Math.round(tTurn.t)} ms later`);
    void t0;
    // a tap on the boat from the water: cut at once, no sound
    await page.evaluate(() => { window.__sounds.length = 0; });
    await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), boat);
    await gameWait(page, 200);
    const cut = await page.evaluate(() => ({ form: window.__game.player.seaForm, w: window.__game.debug.merfolk.parts().weight, magic: window.__sounds.filter((x) => x.name === 'magic').length }));
    c(!cut.form && cut.w < 0.2 && cut.magic === 0, `B10 boarding from the water: the tail goes at once, no magic sound (${JSON.stringify(cut)})`);
    await page.evaluate(() => window.__game.debug.vehicles.park('button'));
    await page.locator('.lf-hud [data-action="vgetout"]').click().catch(() => {});
    await gameWait(page, 300);
  }
  // flying out of deep water cuts at once; a redundant setFlying(false) never does
  await atSurface(page, deep, 0);
  const red = await page.evaluate(() => { const g = window.__game; g.player.setFlying(false); return g.player.seaForm; });
  c(red === 'mermaid', 'B10 a redundant setFlying(false) in sea form: no cut');
  await page.evaluate(() => { window.__sounds.length = 0; });
  await page.keyboard.press('KeyF');
  await gameWait(page, 150);
  const fly = await page.evaluate(() => ({ flying: window.__game.player.flying, form: window.__game.player.seaForm, w: window.__game.debug.merfolk.parts().weight, magic: window.__sounds.filter((x) => x.name === 'magic').length }));
  c(fly.flying && !fly.form && fly.w < 0.2 && fly.magic === 0, `B10 F in deep water: flying, the tail cut at once, no sound (${JSON.stringify(fly)})`);
  await page.keyboard.press('KeyF');
  // holding on to something over the water (a zip line): no tail
  await atSurface(page, deep, 0);
  const zip = await page.evaluate(async ([x, y, z]) => {
    const g = window.__game, pl = g.player;
    pl.hold({ name: 'zip' });
    const cutNow = pl.seaForm;
    pl.position.set(x, y + 0.2, z);
    await new Promise((r) => setTimeout(r, 1200));
    const after = pl.seaForm;
    pl.release();
    return { cutNow, after };
  }, deep);
  c(zip.cutNow === null && zip.after === null, `B10 holding a zip line over the water: no tail (${JSON.stringify(zip)})`);

  // B11 cameras (the deepest open water near: the dive needs room ahead and below)
  const dd = (await deepAt(page, 6)) || (await deepAt(page, 5)) || ds;
  const open = await openWater(page, dd.x, dd.z, Math.min(4, dd.depth));
  console.log(`  (B11 at a ${dd.depth}-deep spot)`);
  await atSurface(page, [dd.x, dd.y, dd.z], open);
  const headY = await page.evaluate(() => {
    const g = window.__game, cam = g.camera, rig = g.cameraRig;
    const f = cam.getWorldDirection(cam.position.clone());
    const ty = cam.position.y + f.y * rig.current;
    return ty - 0.3 * rig.shoulder - g.player.position.y;
  });
  c(Math.abs(headY - 1.05) <= 0.05, `B11 third person in sea form looks at the lower head (${headY.toFixed(2)} ~ 1.05)`);
  await page.evaluate(() => window.__game.cameraRig.setMode('first'));
  await gameWait(page, 300);
  c(!(await page.evaluate(() => window.__game.player.avatar.group.visible)), 'B11 first person hides her avatar');
  await page.evaluate(() => { window.__game.cameraRig.pitch = 0.6; });
  const y11 = (await st(page)).y;
  const dive = await hold(page, ['KeyW'], 1500);
  c(y11 - dive[dive.length - 1].y >= 1, `B11 first person: looking down and swimming forward dives (dy ${(dive[dive.length - 1].y - y11).toFixed(2)})`);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.3; g.cameraRig.setMode('third'); });

  // B12 a selfie in sea form, and a photo under the water
  await atSurface(page, deep, 0);
  const selfie = await page.evaluate(async () => {
    const g = window.__game, cam = g.camera;
    const out = [];
    const watch = setInterval(() => {
      const f = cam.getWorldDirection(cam.position.clone());
      const p = g.player.position;
      // the camera's forward ray, at the player's horizontal distance
      const hd = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
      const hf = Math.hypot(f.x, f.z) || 1;
      out.push(cam.position.y + (f.y / hf) * hd - p.y);
    }, 100);
    await g.photo.take({ selfie: true });
    clearInterval(watch);
    return { taken: !!g.photo.canvas, ys: out };
  });
  // the selfie camera aims 0.15 under its head point: y + 1.0 in sea form (1.3 on land) -> y + 0.85
  const aimed = selfie.ys.filter((y) => Math.abs(y - 0.85) < 0.05).length;
  c(selfie.taken && aimed > 0, `B12 a selfie in sea form: taken, the camera aims at her lower head (head point y + 1.0, seen ${aimed}x)`);
  await page.evaluate(() => window.__game.ui.close());
  await gameWait(page, 300);
  await atSurface(page, deep, 0);
  await page.evaluate(() => { window.__game.cameraRig.pitch = 0.05; });
  await hold(page, ['KeyC'], 1600);
  await gameWait(page, 300);
  const tinted = await page.evaluate(async () => {
    const g = window.__game;
    const u = g.underwater;
    await g.photo.take();
    const c = g.photo.canvas;
    const x = c.getContext('2d');
    // the photo's bottom row sits above the card's caption strip: sample a band near it
    const pad = Math.round((c.width / 1.1) * 0.05);
    const ph = c.height - pad - Math.round((c.width - pad * 2) * 0.2);
    const d = x.getImageData(pad + 4, ph - 6, c.width - pad * 2 - 8, 4).data;
    let r = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; }
    g.ui.close();
    return { u, r, b };
  });
  c(tinted.u === 'water' && tinted.b > tinted.r, `B12 a photo under the water is tinted blue (${JSON.stringify(tinted)})`);
  await gameWait(page, 300);

  // B15 30 s of seeded random swimming: finite, no long stall, never flying
  await atSurface(page, deep, open);
  const rnd = (() => { let a = 1234567; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const KEYS = ['KeyW', 'KeyA', 'KeyD', 'KeyC', 'Space', 'ShiftLeft'];
  let bad = 0, maxGap = 0, flew = false;
  await page.evaluate(() => { const g = window.__game; g.__b15 = { last: performance.now(), max: 0 }; const tick = () => { const n = performance.now(); g.__b15.max = Math.max(g.__b15.max, n - g.__b15.last); g.__b15.last = n; if (!g.__b15.stop) requestAnimationFrame(tick); }; tick(); });
  const t15 = Date.now();
  let held = [];
  while (Date.now() - t15 < 30000) {
    for (const k of held) await page.keyboard.up(k);
    held = KEYS.filter(() => rnd() < 0.35);
    for (const k of held) await page.keyboard.down(k);
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => { const p = window.__game.player.position; return { ok: [p.x, p.y, p.z].every(Number.isFinite), fly: window.__game.player.flying }; });
    if (!s.ok) bad++;
    if (s.fly) flew = true;
  }
  for (const k of held) await page.keyboard.up(k);
  maxGap = await page.evaluate(() => { const g = window.__game; g.__b15.stop = true; return g.__b15.max; });
  c(bad === 0 && !flew, `B15 30 s of random swimming: every position finite, never flying (${bad} bad)`);
  c(maxGap < 1000, `B15 no stall over 1 s (longest frame ${Math.round(maxGap)} ms)`);
  await context.close();

  // B16 the candy biome: strawberry milk turns her too, the tint is pink
  {
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'candy' });
    await newWorld(pg, 'candy');
    let cs = await deepAt(pg, 3);
    // a candy world is random: its milk lakes are sometimes beyond the search; try a new one
    for (let i = 0; i < 3 && !cs; i++) {
      console.log('  (B16 no deep milk near the start: a new candy world)');
      await newWorld(pg, 'candy');
      cs = await deepAt(pg, 3);
    }
    const key = cs ? await pg.evaluate(([x, y, z]) => { const g = window.__game; return g.registry.blocks.defs[g.world.get(Math.floor(x), Math.floor(y), Math.floor(z))].key; }, [cs.x, cs.y, cs.z]) : null;
    c(!!cs, `B16 a deep spot in the candy sea (${key})`);
    if (cs) {
      await atSurface(pg, [cs.x, cs.y, cs.z], 0);
      const f = await pg.evaluate(() => window.__game.player.seaForm);
      c(f === 'mermaid', `B16 the ${key} sea turns her too (${f})`);
      await pg.evaluate(() => { window.__game.cameraRig.pitch = 0.05; });
      await hold(pg, ['KeyC'], 1400);
      await gameWait(pg, 300);
      const u = await pg.evaluate(() => ({ u: window.__game.underwater, bg: document.querySelector('.sw-underwater').style.background }));
      c(u.u === key && /255, 190, 220|150, 90, 50/.test(u.bg), `B16 the tint follows the liquid (${JSON.stringify(u)})`);
      await shot(pg, 'candy-underwater', PREFIX);
    }
    await cx.close();
  }

  // B17 the first-turn bubble (fresh device, form auto, tips on)
  {
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'bubble' });
    await newWorld(pg, 'beach', { asked: false, tips: true });
    const d = await deepAt(pg, 3);
    await place(pg, [d.x, d.y, d.z], 0, 100);
    // the bubble waits for the Sea Magic! pop, then shows three picture buttons
    const shown = await waitOk(pg, () => !!window.__game.debug.merfolk.bubble(), null, 20000);
    const labels = await pg.evaluate(() => window.__game.debug.merfolk.bubble());
    c(shown && JSON.stringify(labels) === JSON.stringify(['Mermaid', 'Sea Dragon', 'Just Me']), `B17 the first-turn bubble: Mermaid, Sea Dragon, Just Me (${JSON.stringify(labels)})`);
    const noPop = await pg.evaluate(() => !document.querySelector('.sw-stkpop'));
    c(noPop, 'B17 the bubble never shows with the sticker pop');
    await shot(pg, 'bubble', PREFIX);
    const x0 = await pg.evaluate(() => window.__game.player.position.z);
    await hold(pg, ['KeyW'], 400);
    const x1 = await pg.evaluate(() => window.__game.player.position.z);
    c(Math.abs(x1 - x0) > 0.8, `B17 she still swims while it shows (moved ${(x1 - x0).toFixed(2)})`);
    // the bubble follows her as she swims: tap it where it is now (no waiting for it to stop)
    c(!!(await pg.evaluate(() => window.__game.debug.merfolk.bubble())), 'B17 the bubble is still there to tap');
    await pg.locator('.lf-bubble[data-owner="merfolk"] button[aria-label="Sea Dragon"]').click({ force: true, timeout: 5000 });
    const tail = await hold(pg, [], 500, { until: (s) => s.seaForm === 'sea_dragon' });
    const after = await pg.evaluate(() => ({ form: window.__game.profile.look.sea.form, asked: window.__game.store.deviceGet('seaAsked'), parts: window.__game.debug.merfolk.parts() }));
    c(after.form === 'sea_dragon' && tail[tail.length - 1].seaForm === 'sea_dragon' && after.asked === 2, `B17 a tap on Sea Dragon: stored, a sea dragon tail within 0.5 s, seaAsked 2 (${JSON.stringify({ form: after.form, asked: after.asked, t: Math.round(tail[tail.length - 1].t) })})`);
    await cx.close();
  }
  {
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'bubble-ignored' });
    await newWorld(pg, 'beach', { asked: false, tips: true });
    const d = await deepAt(pg, 3);
    await place(pg, [d.x, d.y, d.z], 0, 100);
    await waitOk(pg, () => !!window.__game.debug.merfolk.bubble(), null, 20000);
    const gone = await hold(pg, [], 9500, { until: () => !window.__game.debug.merfolk.bubble() });
    const after = await pg.evaluate(() => ({ form: window.__game.profile.look.sea.form, asked: window.__game.store.deviceGet('seaAsked') }));
    c(gone[gone.length - 1].t <= 9000 && after.form === 'auto' && after.asked === 1, `B17 ignored: it fades within 9 s, the form stays auto, seaAsked 1 (${Math.round(gone[gone.length - 1].t)} ms, ${JSON.stringify(after)})`);
    await cx.close();
  }

  // B18 the dive tip: in a deep spot (3+ below) yes, with the Down button pulsing; 2-deep no
  {
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'tips', viewport: IPAD, touch: true });
    await newWorld(pg, 'beach', { asked: true, tips: true });
    await pg.evaluate(() => window.__game.stickers.award('sea_magic')); // not the first-ever turn
    await gameWait(pg, 4500);
    const two = await pg.evaluate(() => {
      const g = window.__game, w = g.world, p = g.player.position;
      for (let r = 2; r < 60; r++) for (let a = 0; a < 32; a++) {
        const x = Math.floor(p.x + Math.sin(a / 5) * r), z = Math.floor(p.z + Math.cos(a / 5) * r);
        const c = g.debug.merfolk.column(x, z);
        if (c.depth === 2) return { x: x + 0.5, y: c.top - 1 + 0.02, z: z + 0.5 };
      }
      return null;
    });
    if (two) {
      await place(pg, [two.x, two.y, two.z], 0, 100);
      await hold(pg, [], 3000);
      c(!(await pg.evaluate(() => window.__toasts.some((t) => /to dive/.test(t)))), 'B18 2-deep water: no dive tip');
    } else console.log('  (B18 no 2-deep column near: skipped the 2-deep check)');
    const d = await deepAt(pg, 4);
    await place(pg, [d.x, d.y, d.z], 0, 100);
    const tip = await toastSeen(pg, /Hold Down to dive!/, 6000);
    const pulse = await pg.evaluate(() => !!document.querySelector('.sw-touch .sw-flybtn.sw-pulse[aria-label="Down"]'));
    c(tip && pulse, `B18 a deep spot: "Hold Down to dive!" and the Down button pulses (${tip}, ${pulse})`);
    await cx.close();
  }
  {
    // the first-ever turn: the sticker pop, the bubble and the dive tip never on screen together
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'first-turn' });
    await newWorld(pg, 'beach', { asked: false, tips: true });
    await pg.evaluate(() => {
      const g = window.__game;
      g.__overlap = 0;
      g.__seen = { pop: 0, bubble: 0, tip: 0 };
      const tick = () => {
        const pop = !!document.querySelector('.sw-stkpop');
        const bub = !!g.debug.merfolk.bubble();
        const tip = [...document.querySelectorAll('.sw-toast')].some((t) => /to dive/.test(t.textContent));
        if (pop) g.__seen.pop++;
        if (bub) g.__seen.bubble++;
        if (tip) g.__seen.tip++;
        if ((pop && bub) || (pop && tip) || (bub && tip)) g.__overlap++;
        if (!g.__stop) requestAnimationFrame(tick);
      };
      tick();
    });
    const d = await deepAt(pg, 4);
    await place(pg, [d.x, d.y, d.z], 0, 100);
    await hold(pg, [], 16000, { until: () => window.__game.__seen.tip > 0 && !window.__game.debug.merfolk.bubble() });
    const r = await pg.evaluate(() => { window.__game.__stop = true; return { overlap: window.__game.__overlap, seen: window.__game.__seen }; });
    c(r.overlap === 0 && r.seen.pop > 0 && r.seen.bubble > 0, `B18 the first-ever turn: pop, bubble and dive tip each alone (${JSON.stringify(r)})`);
    await cx.close();
  }
}

// ---------------- studio ----------------

async function studioPass(browser, errors, { touch = false } = {}) {
  const label = touch ? 'iPad' : 'desktop';
  console.log(`Studio (${label})`);
  const c = (cond, msg) => check(errors, cond, `${msg} [${label}]`);
  const { context, page } = await openGame(browser, { errors, label: 'studio-' + label, ...(touch ? { viewport: IPAD, touch: true } : {}) });
  const press = (loc) => (touch ? loc.tap() : loc.click());
  await newWorld(page, 'beach');
  await page.evaluate(() => window.__game.ui.open('dressup'));
  await page.waitForSelector('.sw-dtab[data-tab="sea"]');
  // C1 the Water tab right after Shoes, with the new dot
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.sw-dtab')].map((b) => b.dataset.tab));
  c(tabs.indexOf('sea') === tabs.indexOf('shoes') + 1, `C1 Water comes right after Shoes (${tabs.join(',')})`);
  const dot0 = await page.evaluate(() => document.querySelector('.sw-dtab[data-tab="sea"]').classList.contains('sw-tab-new'));
  await press(page.locator('.sw-dtab[data-tab="sea"]'));
  await settle(page, 400);
  const dot1 = await page.evaluate(() => document.querySelector('.sw-dtab[data-tab="sea"]').classList.contains('sw-tab-new'));
  c(dot0 && !dot1, `C1 the new dot shows until the tab is opened (${dot0} -> ${dot1})`);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-dgrid .sw-dtile')].map((b) => ({ l: b.getAttribute('aria-label'), on: b.classList.contains('sw-on') })));
  c(JSON.stringify(tiles.map((t) => t.l)) === JSON.stringify(['Mermaid', 'Sea Dragon', 'Just Me']), `C1 three tiles: Mermaid, Sea Dragon, Just Me (${tiles.map((t) => t.l)})`);
  c(tiles[0] && tiles[0].on && !tiles[1].on, 'C1 auto, never picked, default look: Mermaid is on');
  await waitOk(page, () => [...document.querySelectorAll('.sw-dress-content .sw-dpic')].slice(0, 3).every((p) => p.classList.contains('sw-ready')), null, 30000);
  await shot(page, `studio-water-${label}`, PREFIX);
  // C2 tap Sea Dragon: stored, a tail on the preview, no wave, sparkles
  await page.evaluate(() => {
    const d = window.__game.dressup;
    window.__emotes = [];
    window.__sparks = 0;
    const pe = d.preview.avatar.playEmote;
    d.preview.avatar.playEmote = (n) => { window.__emotes.push(n); return pe(n); };
    const em = d.preview.sparkles.emit.bind(d.preview.sparkles);
    // bursts only (the turntable's ambient twinkle is one sparkle at a time)
    d.preview.sparkles.emit = (k, p, o) => { if (k === 'sparkle' && o && o.count >= 10) window.__sparks++; return em(k, p, o); };
  });
  await press(page.locator('.sw-dress-content .sw-dtile[aria-label="Sea Dragon"]'));
  await settle(page, 900);
  const c2 = await page.evaluate(() => {
    const d = window.__game.dressup;
    return { form: d.look.sea.form, emotes: window.__emotes.slice(), parts: d.preview.avatar.seaParts(), hint: document.querySelector('.sw-dress-hint span').textContent, sparks: window.__sparks };
  });
  c(c2.sparks >= 2, `C2 the preview sparkles as the tail changes (${c2.sparks} bursts)`);
  c(c2.form === 'sea_dragon' && c2.parts.shown && c2.parts.form === 'sea_dragon', `C2 Sea Dragon: picked, and the preview swims with its tail (${JSON.stringify({ form: c2.form, shown: c2.parts.shown })})`);
  c(c2.emotes.length === 0, `C2 no wave emote on this tab (${c2.emotes})`);
  c(/sea dragon/i.test(c2.hint), `C2 the hint: "${c2.hint}"`);
  // the picture once the change has settled (the tail grown, the burst of sparkles gone, the
  // preview floated up)
  await gameWait(page, 2600);
  await shot(page, `studio-dragon-${label}`, PREFIX);
  // C3 tail color: Match on by default; Pink; Undo back to Match; hidden for Just Me
  const sw = (lbl) => page.locator(`.sw-dress-content .sw-sw[aria-label="${lbl}"]`);
  c(await sw('Match my clothes').evaluate((b) => b.classList.contains('sw-on')), 'C3 Match is on by default');
  await press(sw('Pink'));
  await settle(page, 300);
  c(await page.evaluate(() => window.__game.dressup.look.sea.color) === '#FF8CC6', 'C3 tap Pink: #FF8CC6');
  await press(page.locator('.sw-dress-undo'));
  await settle(page, 300);
  c(await page.evaluate(() => window.__game.dressup.look.sea.color) === null, 'C3 Undo: back to Match');
  await press(page.locator('.sw-dress-content .sw-dtile[aria-label="Just Me"]'));
  await settle(page, 400);
  c(await page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-dsec')].find((e) => /Tail color/.test(e.textContent)).hidden), 'C3 Just Me hides the Tail color row');
  // C8 every color and Match with the tail out: no magenta, stable meshes and texture refs
  await press(page.locator('.sw-dress-content .sw-dtile[aria-label="Mermaid"]'));
  await settle(page, 600);
  const before = await page.evaluate(() => ({ tex: window.__game.debug.avatar.textures(), meshes: (() => { let n = 0; window.__game.dressup.preview.avatar.group.traverse((o) => { if (o.isMesh) n++; }); return n; })() }));
  for (const name of [...(await page.evaluate(() => [...document.querySelectorAll('.sw-dress-content .sw-sw')].map((b) => b.getAttribute('aria-label'))))]) {
    await press(sw(name));
    await settle(page, 150);
  }
  await settle(page, 500);
  const after8 = await page.evaluate(() => {
    const d = window.__game.dressup;
    let n = 0, magenta = 0;
    d.preview.avatar.group.traverse((o) => {
      if (!o.isMesh) return;
      n++;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.color && m.color.getHex() === 0xff00ff) magenta++;
    });
    return { meshes: n, magenta };
  });
  c(after8.magenta === 0 && after8.meshes === before.meshes, `C8 13 tail colors: no magenta material, meshes stable (${before.meshes} -> ${after8.meshes})`);
  // C4 auto + Boy: the on tile moves to Sea Dragon, the form stays auto; explicit Mermaid stays
  await page.evaluate(() => { const d = window.__game.dressup; d.change((dr) => { dr.sea = { form: 'auto', color: null }; }); });
  await press(page.locator('.sw-dress-who-btn[data-style="boy"]'));
  await settle(page, 600);
  const c4 = await page.evaluate(() => ({ form: window.__game.dressup.look.sea.form, on: [...document.querySelectorAll('.sw-dress-content .sw-dtile.sw-on')].map((b) => b.getAttribute('aria-label')), first: document.querySelector('.sw-dress-content .sw-dtile').getAttribute('aria-label') }));
  c(c4.form === 'auto' && c4.on.includes('Sea Dragon') && c4.first === 'Sea Dragon', `C4 auto + Boy: Sea Dragon is on and first, the form stays auto (${JSON.stringify(c4)})`);
  await press(page.locator('.sw-dress-who-btn[data-style="girl"]'));
  await settle(page, 400);
  await press(page.locator('.sw-dress-content .sw-dtile[aria-label="Mermaid"]'));
  await press(page.locator('.sw-dress-who-btn[data-style="boy"]'));
  await settle(page, 500);
  c(await page.evaluate(() => window.__game.dressup.look.sea.form) === 'mermaid', 'C4 explicit Mermaid + Boy: still Mermaid');
  await press(page.locator('.sw-dress-who-btn[data-style="girl"]'));
  await settle(page, 300);
  // C7 an old outfit slot keeps the form and shows as worn
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/merfolk-old-profile.json'), 'utf8')).profile;
  await page.evaluate((o) => { const g = window.__game; g.profile.outfits = o; }, fixture.outfits);
  await page.evaluate(() => { const d = window.__game.dressup; d.change((dr) => { dr.sea = { form: 'sea_dragon', color: null }; }); });
  await press(page.locator('.sw-dtab[data-tab="outfits"]'));
  await settle(page, 600);
  await press(page.locator('.sw-dress-content .sw-dslot .sw-dtile').first());
  await settle(page, 700);
  const c7 = await page.evaluate(() => ({ form: window.__game.dressup.look.sea.form, worn: document.querySelector('.sw-dress-content .sw-dslot .sw-dtile').classList.contains('sw-on') }));
  c(c7.form === 'sea_dragon' && c7.worn, `C7 wearing an old outfit slot keeps the sea dragon, and the slot shows as worn (${JSON.stringify(c7)})`);
  // close: textures released like before
  const texIn = await page.evaluate(() => window.__game.debug.avatar.textures());
  await page.evaluate(() => window.__game.ui.close());
  await settle(page, 600);
  const texOut = await page.evaluate(() => window.__game.debug.avatar.textures());
  c(texOut.refs < texIn.refs, `C8 closing the Studio releases its textures (refs ${texIn.refs} -> ${texOut.refs})`);
  // C9 opening Dress Up in sea form opens the Water tab
  const d9 = await deepAt(page, 3);
  await atSurface(page, [d9.x, d9.y, d9.z], 0);
  await page.evaluate(() => window.__game.ui.open('dressup'));
  await settle(page, 600);
  c(await page.evaluate(() => window.__game.dressup.tab) === 'sea', 'C9 Dress Up opened in sea form opens on the Water tab');
  await page.evaluate(() => window.__game.ui.close());
  await context.close();

  if (!touch) {
    // C6 phone 390x844: the Water tab reachable, tiles and swatches fit, no sideways scroll
    const { context: cx, page: pg } = await openGame(browser, { errors, label: 'studio-phone', viewport: PHONE, touch: true });
    await pg.evaluate(() => window.__game.ui.open('dressup'));
    await pg.waitForSelector('.sw-dtab[data-tab="sea"]');
    await pg.locator('.sw-dtab[data-tab="sea"]').tap();
    await settle(pg, 900);
    const fit = await pg.evaluate(() => {
      const W = window.innerWidth;
      const els = [...document.querySelectorAll('.sw-dress-content .sw-dtile, .sw-dress-content .sw-sw')];
      return { over: els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 || r.left < -1; }).length, scroll: document.documentElement.scrollWidth > W + 1, tiles: els.length };
    });
    c(fit.over === 0 && !fit.scroll && fit.tiles >= 16, `C6 phone: the Water tab fits, no sideways scroll (${JSON.stringify(fit)})`);
    await shot(pg, 'studio-water-phone', PREFIX);
    await cx.close();
  }
}

// ---------------- the render grids for the owner (C5) ----------------

async function gridsPass(browser, errors) {
  console.log('Render grids (C5): both forms x every color and Match x clothes, every head accessory');
  const { context, page } = await openGame(browser, { errors, label: 'grids' });
  const out = [];
  const grids = await page.evaluate(async () => {
    const g = window.__game, W = g.debug.avatar;
    const base = g.debug.avatar.look();
    const colors = [null, '#3FD8B0', '#6CC6FF', '#4D7CFF', '#9C7BFF', '#FF8CC6', '#FF5FA2', '#FF6B6B', '#FFA94D', '#FFD43B', '#6BD68A', '#2FB5B0', '#E6DDFF'];
    const names = ['Match', 'Sea green', 'Sky blue', 'Ocean blue', 'Purple', 'Pink', 'Hot pink', 'Coral', 'Orange', 'Gold', 'Green', 'Deep teal', 'Pearl'];
    const clothes = {
      dress: { dress: { type: 'mermaid', color: '#FF8CC6', pattern: 'none', patternColor: '#FFFFFF' } },
      jeans: { dress: null, bottom: { type: 'jeans', color: '#4D7CFF', pattern: 'none', patternColor: '#FFFFFF' } },
      skirt: { dress: null, bottom: { type: 'skirt', color: '#9C7BFF', pattern: 'none', patternColor: '#FFFFFF' } },
      shorts: { dress: null, bottom: { type: 'shorts', color: '#FFFFFF', pattern: 'none', patternColor: '#FFFFFF' } },
    };
    const swim = { state: { swimming: true, sea: true, speed: 2.2, onGround: false }, t: 0.9 };
    // floating still in the water, seen from the front: the whole tail and fin show
    const front = { state: { swimming: true, sea: true, speed: 0, onGround: false }, t: 0.9 };
    // tall enough for the sea dragon's horns above the head and its fan fin below the feet
    const FRONT = { cy: 0.8, span: 2.75, yaw: 0.35, pitch: 0.12 };
    const BACK = { cy: 0.72, span: 3.0, yaw: Math.PI * 0.84, pitch: 0.18 }; // horns to fan fin
    const res = {};
    // a boy starter (short hair, no bow) as well as the default girl
    const boy = W.starters().find((o) => o.key === 'soccer').look;
    const SIDE = { cy: 0.74, span: 3.0, yaw: Math.PI / 2, pitch: 0.1 };
    const PLAY = { cy: 0.55, span: 3.2, yaw: Math.PI * 0.94, pitch: 0.5 }; // behind, a little above (the whole fin)
    for (const form of ['mermaid', 'sea_dragon']) {
      const items = [];
      colors.forEach((col, i) => items.push({ look: { ...base, sea: { form, color: col } }, label: names[i], frame: FRONT, pose: front }));
      items.push({ look: { ...base, sea: { form, color: null } }, label: 'back', frame: BACK, pose: front });
      for (const [k, cl] of Object.entries(clothes)) items.push({ look: { ...base, ...cl, sea: { form, color: null } }, label: k + ' (Match)', frame: FRONT, pose: front });
      for (const [k, cl] of Object.entries(clothes)) items.push({ look: { ...base, ...cl, sea: { form, color: null } }, label: k + ' swims', frame: 'sea', pose: swim });
      const bl = { ...boy, sea: { form, color: null } };
      items.push({ look: bl, label: 'boy (Match)', frame: FRONT, pose: front });
      items.push({ look: bl, label: 'boy side', frame: SIDE, pose: front });
      items.push({ look: bl, label: 'boy back', frame: BACK, pose: front });
      items.push({ look: bl, label: 'boy swims', frame: 'sea', pose: swim });
      items.push({ look: bl, label: 'boy from behind', frame: PLAY, pose: swim });
      items.push({ look: { ...base, sea: { form, color: null } }, label: 'from behind', frame: PLAY, pose: swim });
      res[form] = await W.renderGrid(items, { cols: 6, size: 200 });
    }
    // every head accessory once with the sea dragon, on the boy and on the default girl (the
    // horn nubs show only with no head accessory or a bow); the accessories in pink / blue, never the
    // horns' gold, so a horn poking through one would show; framed tall enough for the halo
    const heads = W.options().HEAD_ACC.map((o) => o.key);
    // head and shoulders, big enough to see where each horn sits (the halo floats at 1.98)
    const HF = { cy: 1.58, span: 1.65, yaw: 0.35, pitch: 0.12 };
    const HB = { cy: 1.58, span: 1.65, yaw: Math.PI * 0.84, pitch: 0.18 };
    const hd = (lk, h, col, frame, who) => ({ look: { ...lk, acc: { ...lk.acc, head: h, headColor: col }, sea: { form: 'sea_dragon', color: null } }, label: `${h} (${who})`, frame, pose: front });
    res.heads = await W.renderGrid([...heads.map((h) => hd(boy, h, '#FF5FA2', HF, 'boy')), ...heads.map((h) => hd(base, h, '#4D7CFF', HF, 'girl'))], { cols: 6, size: 200 });
    res.headsBack = await W.renderGrid([...heads.map((h) => hd(boy, h, '#FF5FA2', HB, 'boy')), ...heads.map((h) => hd(base, h, '#4D7CFF', HB, 'girl'))], { cols: 6, size: 200 });
    // every hair style with the sea dragon (the horns rise out of tall hair, step around buns and
    // a fauxhawk's ridge), head and shoulders: on the boy from the front and from behind, and on
    // the default girl (her bow) from the side
    const hairs = W.options().HAIR_STYLES.map((o) => o.key);
    const HS = { cy: 1.58, span: 1.75, yaw: Math.PI / 2, pitch: 0.12 };
    const HH = { cy: 1.62, span: 1.75, yaw: 0.35, pitch: 0.12 }; // room for horns on an afro
    const HHB = { cy: 1.62, span: 1.75, yaw: Math.PI * 0.84, pitch: 0.18 };
    const hl = (lk, h) => ({ ...lk, hair: { ...lk.hair, style: h }, sea: { form: 'sea_dragon', color: null } });
    res.hair = await W.renderGrid([
      ...hairs.map((h) => ({ look: hl(boy, h), label: h, frame: HH, pose: front })),
      ...hairs.map((h) => ({ look: hl(boy, h), label: h + ' (back)', frame: HHB, pose: front })),
      ...hairs.map((h) => ({ look: hl(base, h), label: h + ' (girl)', frame: HS, pose: front })),
    ], { cols: 8, size: 170 });
    // the starters, each in its own Match form
    // (and the boy starters once more from behind: the normal play view)
    const st = W.starters().map((o) => ({ look: { ...o.look, sea: { form: o.tag === 'b' ? 'sea_dragon' : 'mermaid', color: null } }, label: o.name, frame: 'sea', pose: swim }));
    for (const o of W.starters().filter((o) => o.tag === 'b')) st.push({ look: { ...o.look, sea: { form: 'sea_dragon', color: null } }, label: o.name + ' (back)', frame: PLAY, pose: swim });
    // and the girl starters as a sea dragon too (any child can pick it), from the front
    for (const o of W.starters().filter((o) => o.tag !== 'b')) st.push({ look: { ...o.look, sea: { form: 'sea_dragon', color: null } }, label: o.name + ' (sea dragon)', frame: FRONT, pose: front });
    res.starters = await W.renderGrid(st, { cols: 6, size: 200 });
    return res;
  });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  for (const [k, url] of Object.entries(grids)) {
    const file = path.join(SHOTS, `${PREFIX}-grid-${k}.png`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    out.push(file);
    console.log(`  grid ${path.relative(ROOT, file)}`);
  }
  // no magenta anywhere (the material fallback)
  const magenta = await page.evaluate(async () => {
    const W = window.__game.debug.avatar;
    const base = W.look();
    let bad = 0;
    for (const form of ['mermaid', 'sea_dragon']) {
      const url = await W.renderGrid([{ look: { ...base, sea: { form, color: null } }, frame: 'sea', pose: { state: { swimming: true, sea: true, speed: 2 }, t: 0.9 } }], { cols: 1, size: 160 });
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = url; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const x = cv.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] < 20 && d[i + 2] > 240) bad++;
    }
    return bad;
  });
  check(errors, magenta === 0, `C5 no magenta material in the sea-form renders (${magenta} px)`);
  await context.close();
  return out;
}

// ---------------- the owner's Sea Dragon pictures ----------------

async function reviewPass(browser, errors) {
  console.log('Review pictures: the Sea Dragon on a boy starter and the default girl');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'review' });
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  const save = (name, url) => {
    const file = path.join(SHOTS, `${PREFIX}-review-${name}.png`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`  picture ${path.relative(ROOT, file)}`);
  };
  // 1. the views, big: front, three-quarter, side, back, swimming, swimming seen from behind
  const views = await page.evaluate(async () => {
    const W = window.__game.debug.avatar;
    const girl = W.look();
    const boy = W.starters().find((o) => o.key === 'soccer').look;
    const still = { state: { swimming: true, sea: true, speed: 0, onGround: false }, t: 0.9 };
    const swim = { state: { swimming: true, sea: true, speed: 2.2, onGround: false }, t: 0.9 };
    const fr = {
      front: { cy: 0.68, span: 2.95, yaw: 0, pitch: 0.08 },
      'three-quarter': { cy: 0.68, span: 2.95, yaw: 0.7, pitch: 0.12 },
      side: { cy: 0.68, span: 2.95, yaw: Math.PI / 2, pitch: 0.1 },
      back: { cy: 0.68, span: 2.95, yaw: Math.PI, pitch: 0.22 },
    };
    const PLAY = { cy: 0.55, span: 3.2, yaw: Math.PI * 0.94, pitch: 0.5 }; // the whole fan fin in frame
    const set = (lk, form) => {
      const L = { ...lk, sea: { form, color: null } };
      return [
        ...Object.entries(fr).map(([k, f]) => ({ look: L, label: k, frame: f, pose: still })),
        { look: L, label: 'swims', frame: 'sea', pose: swim },
        { look: L, label: 'swims, from behind', frame: PLAY, pose: swim },
      ];
    };
    const out = {};
    out.boy = await W.renderGrid(set(boy, 'sea_dragon'), { cols: 3, size: 320 });
    out.girl = await W.renderGrid(set(girl, 'sea_dragon'), { cols: 3, size: 320 });
    // next to a mermaid: the same child, mermaid then sea dragon, front and back
    const pair = [];
    for (const [nm, lk] of [['boy', boy], ['girl', girl]]) {
      for (const [fk, f] of [['front', fr['three-quarter']], ['back', fr.back]]) {
        pair.push({ look: { ...lk, sea: { form: 'mermaid', color: null } }, label: `${nm} mermaid ${fk}`, frame: f, pose: still });
        pair.push({ look: { ...lk, sea: { form: 'sea_dragon', color: null } }, label: `${nm} sea dragon ${fk}`, frame: f, pose: still });
      }
    }
    out.compare = await W.renderGrid(pair, { cols: 4, size: 280 });
    // the tail colors on the boy, three-quarter and back
    const cols = [['Deep teal', '#2FB5B0'], ['Ocean blue', '#4D7CFF'], ['Green', '#6BD68A'], ['Gold', '#FFD43B'], ['Coral', '#FF6B6B'], ['Purple', '#9C7BFF']];
    const tc = [];
    for (const [n, h] of cols) tc.push({ look: { ...boy, sea: { form: 'sea_dragon', color: h } }, label: n, frame: fr['three-quarter'], pose: still });
    for (const [n, h] of cols) tc.push({ look: { ...boy, sea: { form: 'sea_dragon', color: h } }, label: n + ' (back)', frame: PLAY, pose: swim });
    out.colors = await W.renderGrid(tc, { cols: 6, size: 220 });
    return out;
  });
  for (const [k, url] of Object.entries(views)) save(k, url);

  // 2. in the world, from the normal play camera (behind, a little above)
  await newWorld(page, 'beach');
  await page.evaluate(() => { window.__girlLook = window.__game.debug.avatar.look(); });
  const ds = await deepAt(page, 4);
  c(!!ds, `review: a 4-deep spot (${JSON.stringify(ds)})`);
  if (!ds) { await context.close(); return; }
  // open water all around (no cliff behind the camera, room to dive): the spot in the world
  // whose 9x9 neighbourhood is all at least 3 deep with one surface, at least 5 deep itself,
  // well inside the world (its edge, where its water meets the horizon ring, stays out of the
  // pictures), the deepest such; the camera looks toward the middle of the world
  const open = await page.evaluate(() => {
    const g = window.__game, M = g.debug.merfolk;
    const sx = g.world.sx, sz = g.world.sz, m = 18;
    let best = null, bestS = -1;
    for (let z = m; z < sz - m; z += 3) {
      for (let x = m; x < sx - m; x += 3) {
        const c0 = M.column(x, z);
        if (c0.depth < 5) continue;
        let ok = true, sum = 0;
        for (let j = -4; j <= 4 && ok; j++) {
          for (let i = -4; i <= 4; i++) {
            const cc = M.column(x + i, z + j);
            if (cc.depth < 3 || cc.top !== c0.top) { ok = false; break; }
            sum += Math.min(cc.depth, 7);
          }
        }
        sum += Math.min(x, z, sx - x, sz - z);
        if (ok && sum > bestS) { bestS = sum; best = { x: x + 0.5, y: c0.top - 0.6, z: z + 0.5, depth: c0.depth }; }
      }
    }
    return best;
  });
  console.log(`  open water for the pictures: ${JSON.stringify(open)}`);
  c(!!open, 'review: open deep water well inside the world');
  const deep = open ? [open.x, open.y, open.z] : [ds.x, ds.y, ds.z];
  // facing into the world (the edge behind the camera), the direction within 70 degrees of the
  // middle with the longest run of deep water ahead
  const openYaw = await page.evaluate(([x, z]) => {
    const g = window.__game;
    const mid = Math.atan2(g.world.sx / 2 - x, g.world.sz / 2 - z);
    let best = mid, bestN = -1;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const off = Math.abs(Math.atan2(Math.sin(ang - mid), Math.cos(ang - mid)));
      if (off > 1.22) continue;
      let n = 0;
      for (let d = 1; d < 16; d++) {
        if (g.debug.merfolk.column(x + Math.sin(ang) * d, z + Math.cos(ang) * d).depth >= 3) n++;
        else break;
      }
      if (n > bestN) { bestN = n; best = ang; }
    }
    return best;
  }, [deep[0], deep[2]]);
  const wear = (key, form) => page.evaluate(([key, form]) => {
    const g = window.__game;
    const base = key ? g.debug.avatar.starters().find((o) => o.key === key).look : window.__girlLook;
    g.profile.look = { ...base, sea: { form, color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
  }, [key, form]);
  const playShot = async (name) => {
    await shot(page, `review-${name}`, PREFIX);
  };
  // a first turn earns the Sea Magic! sticker: let its cheer pass before the pictures
  await wear('soccer', 'sea_dragon');
  await atSurface(page, deep, openYaw);
  await gameWait(page, 5000);
  for (const [who, key] of [['boy', 'soccer'], ['girl', null]]) {
    await wear(key, 'sea_dragon');
    await atSurface(page, deep, openYaw);
    await page.evaluate(() => { window.__game.cameraRig.pitch = 0.32; });
    await settle(page, 500);
    const p = await parts(page);
    c(p && p.shown && p.form === 'sea_dragon', `review ${who}: a sea dragon at the surface (${p && p.form})`);
    await playShot(`${who}-water`);
    // swimming forward
    await page.keyboard.down('KeyW');
    await gameWait(page, 900);
    await playShot(`${who}-swims`);
    await page.keyboard.up('KeyW');
    // under water: dive, hover, the camera behind and a little above (still under the surface)
    await atSurface(page, deep, openYaw);
    await page.evaluate(() => { window.__game.cameraRig.pitch = 0.12; });
    await hold(page, ['KeyC'], 1100);
    await gameWait(page, 700);
    let u = null;
    for (const pitch of [0.4, 0.3, 0.2, 0.12]) {
      await page.evaluate((pt) => { window.__game.cameraRig.pitch = pt; }, pitch);
      await gameWait(page, 350);
      u = await page.evaluate(() => window.__game.underwater);
      if (u === 'water') break;
    }
    c(u === 'water', `review ${who}: the camera is under the water (${u})`);
    await playShot(`${who}-underwater`);
  }
  // at night: the glow spots shine
  await wear('soccer', 'sea_dragon');
  await atSurface(page, deep, openYaw);
  await page.evaluate(() => { window.__game.cameraRig.pitch = 0.4; window.__game.setDayTime(0.92); });
  await settle(page, 800);
  await playShot('night');
  await page.evaluate(() => window.__game.setDayTime(0.4));
  // next to a mermaid friend (a second avatar beside him, in her own sea form)
  await atSurface(page, deep, openYaw);
  await page.evaluate(() => {
    const g = window.__game;
    const look = { ...window.__girlLook, sea: { form: 'mermaid', color: null } };
    const a = g.createAvatar(look, { seaAuto: 'mermaid' });
    g.scene.add(a.group);
    let last = performance.now();
    // she swims along beside him (same speed and heading)
    const tick = () => {
      const n = performance.now();
      const p = g.player.position, yaw = g.player.yaw, v = g.player.velocity;
      a.group.position.set(p.x + Math.cos(yaw) * 1.3, p.y, p.z - Math.sin(yaw) * 1.3);
      a.group.rotation.y = yaw;
      a.update(Math.min(0.05, (n - last) / 1000), { sea: true, swimming: true, speed: Math.hypot(v.x, v.z) });
      last = n;
      if (g.__reviewMermaid === a) requestAnimationFrame(tick);
    };
    g.__reviewMermaid = a;
    tick();
    g.cameraRig.pitch = 0.3;
  });
  await settle(page, 900);
  await playShot('next-to-mermaid');
  // and swimming side by side
  await page.keyboard.down('KeyW');
  await gameWait(page, 900);
  await playShot('next-to-mermaid-swims');
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const g = window.__game, a = g.__reviewMermaid;
    g.__reviewMermaid = null;
    g.scene.remove(a.group);
    a.dispose();
  });
  // back on land after a swim: nothing of the sea form stays on him (the forearm fins once did)
  const sh = await page.evaluate(() => window.__game.debug.merfolk.shore());
  if (sh) {
    const toLand = Math.atan2(sh.dir[0], sh.dir[1]);
    await wear('soccer', 'sea_dragon');
    await place(page, sh.deep, toLand, 200);
    await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 3000);
    await gameWait(page, 1500);
    await hold(page, ['KeyW'], 5000, { until: (s, top) => !s.seaForm && !s.swimming && s.y >= top - 0.05, arg: sh.top });
    await hold(page, ['KeyW'], 700);
    await gameWait(page, 900);
    const left = await page.evaluate(() => {
      const g = window.__game;
      let n = 0;
      g.player.avatar.group.traverse((o) => {
        if (!o.isMesh) return;
        let vis = true, seaPart = false;
        for (let q = o; q; q = q.parent) { if (!q.visible) vis = false; if (/^sea/.test(q.name)) seaPart = true; }
        if (vis && seaPart) n++;
      });
      return { n, parts: g.debug.merfolk.parts() };
    });
    c(left.n === 0 && left.parts && !left.parts.shown && left.parts.legsVisible,
      `review: on land after a swim, legs and no sea parts showing (${left.n} shown)`);
    // seen from the front: he turns round to face the sea and the camera hangs over the water
    // looking at him and the beach (a camera on the land side ran into the bank or his head)
    await page.evaluate((y) => {
      const g = window.__game;
      g.player.yaw = y + Math.PI;
      g.cameraRig.yaw = y + 0.3;
      g.cameraRig.pitch = 0.22;
    }, toLand);
    await settle(page, 900);
    const view = await page.evaluate(() => {
      const g = window.__game, c = g.camera.position, p = g.player.position;
      return { dist: Math.hypot(c.x - p.x, c.z - p.z), up: c.y - p.y };
    });
    c(view.dist > 2.5, `review: the land picture's camera stands back from him (${view.dist.toFixed(1)} blocks)`);
    await playShot('boy-land-after-swim');
  } else c(false, 'review: a shore for the land picture');
  await context.close();
}

// ---------------- touch (iPad) ----------------

async function touchPass(browser, errors) {
  console.log('Touch (iPad 1024x768)');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'touch', viewport: IPAD, touch: true });
  await newWorld(page, 'beach', { tips: true });
  await page.evaluate(() => window.__game.stickers.award('sea_magic'));
  await gameWait(page, 4500);
  const hud = () => page.evaluate(() => {
    const q = (l) => document.querySelector(`.sw-touch .sw-round[aria-label="${l}"]`);
    const vis = (e) => !!e && !e.hidden && e.offsetParent !== null;
    return { jump: vis(q('Jump')), up: vis(q('Up')), down: vis(q('Down')), label: (document.querySelector('.sw-joy-label') || {}).textContent };
  });
  const sh = await page.evaluate(() => window.__game.debug.merfolk.shore());
  await place(page, [sh.land[0], sh.land[1] + 0.05, sh.land[2]], 0, 400);
  const land = await hud();
  const d = await deepAt(page, 4);
  await atSurface(page, [d.x, d.y, d.z], 0);
  const sea = await hud();
  await place(page, [sh.land[0], sh.land[1] + 0.05, sh.land[2]], 0, 600);
  const back = await hud();
  c(land.jump && !land.up && !land.down && land.label === 'Walk', `T1 on land: Jump, no Up / Down, "Walk" (${JSON.stringify(land)})`);
  c(!sea.jump && sea.up && sea.down && sea.label === 'Swim', `T1 deep water: Up and Down, no Jump, "Swim" (${JSON.stringify(sea)})`);
  c(back.jump && !back.up && back.label === 'Walk', `T1 back on land: Jump and "Walk" (${JSON.stringify(back)})`);
  // T2 holding the Down button dives; the dive tip once per device
  await page.evaluate(() => { window.__toasts.length = 0; window.__game.store.deviceSet('seaHints', 0); });
  await atSurface(page, [d.x, d.y, d.z], 0);
  await toastSeen(page, /Hold Down to dive!/, 4000);
  const y0 = (await st(page)).y;
  const btn = await page.locator('.sw-touch .sw-round[aria-label="Down"]').boundingBox();
  const cdp = await context.newCDPSession(page);
  const touchAt = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7 }] });
  await touchAt('touchStart', btn.x + btn.width / 2, btn.y + btn.height / 2);
  await hold(page, [], 1500);
  await touchAt('touchEnd', 0, 0);
  const y1 = (await st(page)).y;
  c(y0 - y1 >= 2, `T2 holding the Down button 1.5 s dives (dy ${(y1 - y0).toFixed(2)})`);
  const tips = await page.evaluate(() => window.__toasts.filter((t) => /Hold Down to dive!/.test(t)).length);
  await atSurface(page, [d.x, d.y, d.z], 0);
  await atSurface(page, [d.x, d.y, d.z], 0);
  const tips2 = await page.evaluate(() => window.__toasts.filter((t) => /Hold Down to dive!/.test(t)).length);
  c(tips === 1 && tips2 <= 2, `T2 the dive tip: "Hold Down to dive!" (shown ${tips}, then ${tips2} after more turns; at most twice per device)`);
  // T3 the joystick at its edge swims fast
  await atSurface(page, [d.x, d.y, d.z], 0);
  const joy = async (dx, dy, ms) => {
    const W = 1024, H = 768, x0 = W * 0.15, y0 = H * 0.75;
    await touchAt('touchStart', x0, y0);
    for (let i = 1; i <= 5; i++) await touchAt('touchMove', x0 + (dx * i) / 5, y0 + (dy * i) / 5);
    const s = await hold(page, [], ms);
    await touchAt('touchEnd', 0, 0);
    return s;
  };
  const js = await joy(0, -90, 1600);
  const hs3 = Math.max(...js.slice(-10).map((s) => s.hs));
  c(hs3 >= 5.5, `T3 the joystick at its edge: ${hs3.toFixed(2)} blocks/s (>= 5.5)`);
  // T4 out at the real shore with the joystick only
  await place(page, sh.deep, sh.yaw, 200);
  await waitOk(page, () => window.__game.debug.merfolk.state().seaSwim, null, 5000);
  await page.evaluate((y) => { const g = window.__game; g.cameraRig.yaw = y; }, sh.yaw);
  await gameWait(page, 900);
  const x0 = 1024 * 0.15, yy = 768 * 0.75;
  await touchAt('touchStart', x0, yy);
  for (let i = 1; i <= 4; i++) await touchAt('touchMove', x0, yy - 15 * i);
  const out = await hold(page, [], 4000, { until: (s, top) => !s.seaForm && !s.swimming && s.y >= top - 0.05, arg: sh.top });
  await touchAt('touchEnd', 0, 0);
  const e = out[out.length - 1];
  c(!e.seaForm && !e.swimming && e.t <= 3000, `T4 the joystick only, toward the beach: on the sand within 3 s (${Math.round(e.t)} ms)`);
  // T5 the help panel's deep-water card
  await page.evaluate(() => window.__game.runAction('help'));
  await settle(page, 600);
  const card = await page.evaluate(() => document.body.textContent.includes('In deep water: Up and Down to swim and dive'));
  c(card, 'T5 the touch help shows "In deep water: Up and Down to swim and dive"');
  await shot(page, 'help-touch', PREFIX);
  await page.evaluate(() => window.__game.ui.close());
  await context.close();
}

// ---------------- friends ----------------

async function friendsPass(browser, errors) {
  console.log('Friends: Aria and Leo turn too');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'friends' });
  await newWorld(page, 'beach');
  const d = await deepAt(page, 4);
  const ids = await page.evaluate(([x, y, z]) => {
    const g = window.__game;
    const a = g.debug.friends.invite('aria', x + 1.5, y + 0.6, z);
    const l = g.debug.friends.invite('leo', x - 1.5, y + 0.6, z);
    g.debug.friends.setMode(a, 'follow');
    g.debug.friends.setMode(l, 'follow');
    window.__lines = [];
    g.events.on('friend:talk', (e) => window.__lines.push(e.line));
    return { a, l };
  }, [d.x, d.y, d.z]);
  await place(page, [d.x, d.y, d.z], 0, 100);
  const both = await waitOk(page, (ids) => {
    const g = window.__game, A = g.friends.byId(ids.a), L = g.friends.byId(ids.l);
    return A && L && A.avatar.seaShown && L.avatar.seaShown;
  }, ids, 15000);
  const forms = await page.evaluate((ids) => { const g = window.__game; return [g.friends.byId(ids.a).avatar.seaForm, g.friends.byId(ids.l).avatar.seaForm]; }, ids);
  c(both && forms[0] === 'mermaid' && forms[1] === 'sea_dragon', `D1 Aria is a mermaid, Leo a sea dragon (${forms})`);
  const LINES = ['Whoa! Look at your tail!', "So sparkly! Let's swim!", 'You swim so fast now!'];
  const said = await waitOk(page, (L) => window.__lines.some((l) => L.includes(l)), LINES, 9000);
  c(said, 'D1 a friend says a sea-form line when she turns');
  await shot(page, 'friends-sea', PREFIX);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const g = window.__game; g.player.setFlying(true); g.player.setFlying(false); });
    await gameWait(page, 1200);
  }
  const n = await page.evaluate((L) => window.__lines.filter((l) => L.includes(l)).length, LINES);
  c(n === 1, `D1 turning back and in again 3 times: no second line (${n})`);
  // D2 following at 4.6 near the surface, they stay close
  await atSurface(page, [d.x, d.y, d.z], 0);
  const openYaw = await page.evaluate(([x, z]) => {
    const g = window.__game;
    let best = 0, bestN = -1;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      let k = 0;
      for (let s = 1; s < 50; s++) { if (g.debug.merfolk.column(x + Math.sin(ang) * s, z + Math.cos(ang) * s).depth >= 2) k++; else break; }
      if (k > bestN) { bestN = k; best = ang; }
    }
    return best;
  }, [d.x, d.z]);
  await page.evaluate((y) => { window.__game.cameraRig.yaw = y; }, openYaw);
  const far = [];
  const swimS = await hold(page, ['KeyW'], 10000);
  for (let i = 0; i < swimS.length; i += 15) {
    const fd = await page.evaluate((ids) => {
      const g = window.__game, p = g.player.position;
      return [ids.a, ids.l].map((id) => { const f = g.friends.byId(id); return Math.hypot(f.pos.x - p.x, f.pos.z - p.z); });
    }, ids);
    far.push(Math.max(...fd));
    if (far.length > 4) break;
  }
  const fdEnd = await page.evaluate((ids) => {
    const g = window.__game, p = g.player.position;
    return Math.max(...[ids.a, ids.l].map((id) => { const f = g.friends.byId(id); return Math.hypot(f.pos.x - p.x, f.pos.z - p.z); }));
  }, ids);
  c(fdEnd <= 6, `D2 after 10 s of swimming the friends are within 6 blocks (${fdEnd.toFixed(1)})`);
  await context.close();
}

// ---------------- costs ----------------

async function costsPass(browser, errors) {
  console.log('Costs (fixed camera, median of 5 frames)');
  const c = (cond, msg) => check(errors, cond, msg);
  // B13c the first turn of a fresh page, a boy starter as a Sea Dragon (the form with the most
  // parts): the longest frame from the turn's own frame (the first frame drawn with the tail)
  // through the next 0.5 s, against the same measure before he went in (the longest frame of each
  // 0.5 s stretch on the shore, their middle): like against like. The Sea Magic! sticker is
  // earned (and its cheer has passed) first: its pop is the sticker book's cost, not the turn's.
  // A software GPU's frames jump by 100-300 ms on their own, so three fresh pages are measured
  // (before the main page opens, so no other page draws meanwhile) and the middle one counts;
  // and on every page the turn must build no new shader program (on a real device that compile
  // is the stall a child would see).
  const firstTurn = async () => {
    const pg = await openGame(browser, { errors, label: 'costs-turn' });
    const P = pg.page;
    await newWorld(P, 'beach');
    const sh1 = await P.evaluate(() => window.__game.debug.merfolk.shore());
    await P.evaluate(() => {
      const g = window.__game;
      g.stickers.award('sea_magic');
      const boy = g.debug.avatar.starters().find((o) => o.key === 'soccer').look;
      g.profile.look = { ...boy, sea: { form: 'sea_dragon', color: null } };
      g.events.emit('avatar:changed', { look: g.profile.look });
    });
    await gameWait(P, 5000);
    await P.evaluate(() => {
      const g = window.__game, R = g.renderer;
      g.__frames = [];
      let last = performance.now();
      const tick = () => {
        const n = performance.now();
        g.__frames.push([n, n - last, !!g.player.seaForm, R.info.programs ? R.info.programs.length : 0]);
        last = n;
        if (g.__frames.length < 2000) requestAnimationFrame(tick);
      };
      tick();
    });
    await settle(P, 3000);
    await place(P, sh1.deep, 0, 100);
    await waitOk(P, () => !!window.__game.player.seaForm, null, 5000);
    await settle(P, 900);
    const r = await P.evaluate(() => {
      const all = window.__game.__frames;
      const i = all.findIndex((f) => f[2]);
      if (i < 2) return null;
      const t = all[i][0] - all[i][1]; // the turn frame started here
      const start = ([n, d]) => n - d;
      // frames that started in the 0.5 s from the turn frame's start (the turn frame always)
      const after = all.slice(i).filter((f) => start(f) <= t + 500).map((f) => f[1]);
      // the same on the shore: each 0.5 s stretch that ended before he was moved (he turns 0.25 s
      // after the move, so stretches end 1.2 s before the turn)
      const wins = [];
      for (let k = 1; k < i; k++) {
        const s0 = start(all[k]);
        if (s0 + 500 > t - 1200) break;
        wins.push(Math.max(...all.slice(k).filter((f) => start(f) >= s0 && start(f) <= s0 + 500).map((f) => f[1])));
      }
      wins.sort((a, b) => a - b);
      const usual = all.slice(1, i).map((f) => f[1]).sort((a, b) => a - b);
      return {
        longest: Math.max(...after), shore: wins[Math.floor(wins.length / 2)] || 0, median: usual[Math.floor(usual.length / 2)] || 0,
        turn: all[i][1], progs: all[all.length - 1][3] - all[i - 1][3],
      };
    });
    await pg.context.close();
    return r;
  };
  const turns = [];
  for (let i = 0; i < 3; i++) turns.push(await firstTurn());
  const okTurns = turns.filter(Boolean);
  const deltas = okTurns.map((f) => f.longest - f.shore).sort((a, b) => a - b);
  const fr = okTurns.length ? okTurns.find((f) => f.longest - f.shore === deltas[Math.floor(deltas.length / 2)]) : { longest: Infinity, shore: 0 };
  const { context, page } = await openGame(browser, { errors, label: 'costs' });
  await newWorld(page, 'beach');
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const calls = async (from, to) => {
    await page.evaluate(([from, to]) => {
      const g = window.__game;
      g.__rig = g.__rig || g.cameraRig.update.bind(g.cameraRig);
      g.cameraRig.update = () => {};
      g.camera.position.set(...from);
      g.camera.lookAt(...to);
    }, [from, to]);
    await settle(page, 500);
    const v = [];
    for (let i = 0; i < 5; i++) {
      v.push(await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(window.__game.renderer.info.render.calls)))));
    }
    await page.evaluate(() => { const g = window.__game; g.cameraRig.update = g.__rig; });
    return median(v);
  };
  const sh = await page.evaluate(() => window.__game.debug.merfolk.shore());
  // the main page turns too (the sea textures stay painted for the ensureSea timing below)
  await page.evaluate(() => window.__game.stickers.award('sea_magic'));
  await gameWait(page, 3000);
  await place(page, sh.deep, 0, 100);
  await waitOk(page, () => !!window.__game.player.seaForm, null, 5000);
  await settle(page, 700);
  console.log(`  first turns: ${okTurns.map((f) => `turn frame ${Math.round(f.turn)}, longest ${Math.round(f.longest)} (shore ${Math.round(f.shore)}, usual frame ${Math.round(f.median)}), new programs ${f.progs}`).join('; ')}`);
  const longest = fr.longest;
  const ensureMs = (form) => page.evaluate((form) => {
    // ensureSea: a fresh avatar's first sea frame (it builds the parts) minus a later sea frame
    // (the shared textures are already painted: the player turned above); the Sea Dragon on a
    // boy starter (horn nubs, crest, forearm fins: the most parts)
    const g = window.__game, out = [];
    const look = form === 'mermaid' ? g.profile.look : { ...g.debug.avatar.starters().find((o) => o.key === 'soccer').look, sea: { form, color: null } };
    for (let i = 0; i < 5; i++) {
      const a = g.createAvatar(look, { seaAuto: form });
      a.update(0.016, { swimming: true, speed: 2 });
      const t0 = performance.now();
      a.update(0.016, { sea: true, swimming: true, speed: 2 });
      const t1 = performance.now();
      a.update(0.016, { sea: true, swimming: true, speed: 2 });
      const t2 = performance.now();
      out.push((t1 - t0) - (t2 - t1));
      a.dispose();
    }
    return out.sort((x, y) => x - y)[2];
  }, form);
  const ens = await ensureMs('mermaid');
  await ensureMs('sea_dragon'); // its textures painted once
  const ensD = await ensureMs('sea_dragon');
  // SwiftShader draws every frame on the CPU (a normal frame here is already over 33 ms), so the
  // check is what 33 ms means on a device: the turn adds at most 33 ms to the usual frame
  c(okTurns.length === 3 && longest <= fr.shore + 33, `B13c the longest frame from the first turn through 0.5 s: ${Math.round(longest)} ms (on the shore ${Math.round(fr.shore)} ms; at most +33 ms; the middle of 3 fresh pages: ${deltas.map((d) => (d >= 0 ? '+' : '') + Math.round(d)).join(', ')} ms)`);
  c(okTurns.length === 3 && okTurns.every((f) => f.progs === 0), `B13c the first turn builds no new shader program (${okTurns.map((f) => f.progs).join(', ')})`);
  c(ens <= 2, `B13c ensureSea (building the sea parts once): ${ens.toFixed(2)} ms (median of 5, <= 2 ms)`);
  c(ensD <= 2, `B13c ensureSea for a Sea Dragon: ${ensD.toFixed(2)} ms (median of 5, <= 2 ms)`);
  // B13a / B13b draw calls and meshes: in sea form vs standing on the shore, same camera; her
  // default look (a mermaid), then a boy starter as a Sea Dragon (the form with the most parts)
  const pos = sh.deep;
  const from = [pos[0] + 4, sh.top + 2.5, pos[2] + 4], to = [pos[0], sh.top - 0.6, pos[2]];
  const meshCount = () => page.evaluate(() => { let n = 0; window.__game.player.avatar.group.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; });
  const seaVsLand = async (label) => {
    await atSurface(page, pos, 0);
    const seaCalls = await calls(from, to);
    const seaMeshes = await meshCount();
    const form = await page.evaluate(() => window.__game.player.seaForm);
    await place(page, [sh.land[0], sh.land[1] + 0.05, sh.land[2]], 0, 900);
    await page.evaluate((p) => window.__game.player.teleport(p[0], p[1], p[2]), [pos[0], sh.top + 0.02, pos[2]]);
    // stand her on a block at the same spot (one stone under her feet over the water)
    await page.evaluate(([x, top, z]) => { const g = window.__game; g.placeBlock(Math.floor(x), top - 1, Math.floor(z), 'stone', { history: false, fx: false }); g.player.teleport(x, top + 0.02, z); }, [pos[0], sh.top, pos[2]]);
    await gameWait(page, 900);
    const landCalls = await calls(from, to);
    const landMeshes = await meshCount();
    await page.evaluate(([x, top, z]) => window.__game.removeBlock(Math.floor(x), top - 1, Math.floor(z), { history: false, fx: false }), [pos[0], sh.top, pos[2]]);
    c(seaCalls - landCalls <= 6, `B13a ${label} (${form}): draw calls in sea form ${seaCalls} vs on land ${landCalls} (<= +6)`);
    c(seaMeshes <= landMeshes + 6, `B13b ${label} (${form}): meshes under the avatar: sea ${seaMeshes}, land ${landMeshes} (<= +6)`);
  };
  await seaVsLand('her look');
  const look0 = await page.evaluate(() => {
    const g = window.__game, l0 = JSON.parse(JSON.stringify(g.profile.look));
    const boy = g.debug.avatar.starters().find((o) => o.key === 'soccer').look;
    g.profile.look = { ...boy, sea: { form: 'sea_dragon', color: null } };
    g.events.emit('avatar:changed', { look: g.profile.look });
    return l0;
  });
  await seaVsLand('a boy starter');
  await page.evaluate((l0) => { const g = window.__game; g.profile.look = l0; g.events.emit('avatar:changed', { look: l0 }); }, look0);
  // B13c setLook time over 20 looks: the sea parts are not built in build()
  const sl = await page.evaluate(() => {
    const g = window.__game, W = g.debug.avatar;
    const a = g.createAvatar(g.profile.look), b = g.createAvatar(g.profile.look);
    b.update(0.016, { sea: true, swimming: true, speed: 2 }); // b has its sea parts built
    const looks = [];
    for (let i = 0; i < 20; i++) looks.push(W.random(100 + i));
    const time = (av) => { const t0 = performance.now(); for (const l of looks) av.setLook(l); return performance.now() - t0; };
    time(a); time(b); // warm the texture cache
    const ta = time(a), tb = time(b);
    a.dispose(); b.dispose();
    return { land: ta, sea: tb };
  });
  c(sl.sea <= sl.land * 1.3 + 0.5 * 20, `B13c setLook x20 with the sea built: ${sl.sea.toFixed(1)} ms vs ${sl.land.toFixed(1)} ms on land`);
  // B13d 60 toggles + 20 look changes with the tail out: no geometry or texture leak
  await atSurface(page, pos, 0);
  const leak = await page.evaluate(async ([pos, land]) => {
    const g = window.__game, av = g.player.avatar, W = g.debug.avatar;
    const geos = () => { const s = new Set(); av.group.traverse((o) => { if (o.geometry) s.add(o.geometry.uuid); }); return s.size; };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const g0 = geos(), t0 = W.textures();
    for (let i = 0; i < 60; i++) {
      if (i % 2) g.player.teleport(pos[0], pos[1], pos[2]);
      else g.player.teleport(land[0], land[1] + 0.05, land[2]);
      for (let k = 0; k < 3; k++) await frame();
    }
    g.player.teleport(pos[0], pos[1], pos[2]);
    for (let k = 0; k < 40; k++) await frame();
    const look0 = JSON.parse(JSON.stringify(g.profile.look));
    for (let i = 0; i < 20; i++) {
      g.profile.look = { ...W.random(300 + i), sea: { form: i % 2 ? 'mermaid' : 'sea_dragon', color: null } };
      g.events.emit('avatar:changed', { look: g.profile.look });
      for (let k = 0; k < 3; k++) await frame();
    }
    g.profile.look = look0;
    g.events.emit('avatar:changed', { look: look0 });
    for (let k = 0; k < 10; k++) await frame();
    return { g0, g1: geos(), t0, t1: W.textures(), shown: av.seaShown };
  }, [pos, sh.land]);
  c(leak.g1 <= leak.g0 + 0, `B13d 60 sea toggles + 20 looks: geometries under her ${leak.g0} -> ${leak.g1}`);
  c(leak.t1.refs <= leak.t0.refs && leak.t1.textures <= leak.t0.textures + 2, `B13d texture refs ${leak.t0.refs} -> ${leak.t1.refs}, textures ${leak.t0.textures} -> ${leak.t1.textures}`);
  // B13e systems time with the player + 3 friends in sea form vs idle
  const sysTime = async () => page.evaluate(() => new Promise((resolve) => {
    const g = window.__game, v = [];
    const tick = () => { if (g._stageTimes) v.push(g._stageTimes.systems); if (v.length >= 120) resolve(v.reduce((a, b) => a + b, 0) / v.length); else requestAnimationFrame(tick); };
    tick();
  }));
  await place(page, [sh.land[0], sh.land[1] + 0.05, sh.land[2]], 0, 600);
  const idle = await sysTime();
  await page.evaluate(([x, y, z]) => {
    const g = window.__game;
    for (const [k, dx] of [['aria', 1.5], ['leo', -1.5], ['mia', 0]]) {
      const id = g.debug.friends.invite(k, x + dx, y + 0.4, z + 1.5);
      if (id) g.debug.friends.setMode(id, 'follow');
    }
    g.player.teleport(x, y, z);
  }, pos);
  await waitOk(page, () => window.__game.friends.friends.filter((f) => f.seaOn).length >= 3, null, 15000);
  const busy = await sysTime();
  c(busy <= idle + 1.0, `B13e systems stage with her and 3 friends in sea form: ${busy.toFixed(2)} ms vs idle ${idle.toFixed(2)} ms (<= +1.0)`);
  await context.close();
  // B13f the tint's cost on the iPad viewport (DPR 2): under the water vs just above, same spot
  const { context: cx, page: pg } = await openGame(browser, { errors, label: 'tint', viewport: IPAD, touch: true });
  await newWorld(pg, 'beach');
  const d = await deepAt(pg, 4);
  const frameTime = async () => pg.evaluate(() => new Promise((resolve) => {
    const v = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); v.push(n - last); last = n; if (v.length >= 90) resolve(v.slice(10).reduce((a, b) => a + b, 0) / 80); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  await atSurface(pg, [d.x, d.y, d.z], 0);
  await pg.evaluate(([x, top, z]) => { const g = window.__game; g.__rig = g.cameraRig.update.bind(g.cameraRig); g.cameraRig.update = () => {}; g.camera.position.set(x, top + 0.15, z); g.camera.lookAt(x + 3, top - 0.5, z); }, [d.x, d.top, d.z]);
  await settle(pg, 700);
  const above = await frameTime();
  const u0 = await pg.evaluate(() => window.__game.underwater);
  await pg.evaluate(([x, top, z]) => { const g = window.__game; g.camera.position.set(x, top - 0.5, z); g.camera.lookAt(x + 3, top - 1.1, z); }, [d.x, d.top, d.z]);
  await settle(pg, 700);
  const under = await frameTime();
  const u1 = await pg.evaluate(() => window.__game.underwater);
  c(u0 === null && u1 === 'water', `B13f the tint shows only under the water (${u0} -> ${u1})`);
  c(under <= above + 1, `B13f average frame under the water ${under.toFixed(1)} ms vs above ${above.toFixed(1)} ms (<= +1 ms)`);
  await cx.close();
}

// ---------------- save ----------------

async function savePass(browser, errors) {
  console.log('Save: an old profile (B14), a world saved in sea form');
  const c = (cond, msg) => check(errors, cond, msg);
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/merfolk-old-profile.json'), 'utf8')).profile;
  const { context, page } = await openGame(browser, { errors, label: 'old-save' });
  await page.evaluate(async (p) => {
    const g = window.__game;
    for (const k of Object.keys(g.profile)) delete g.profile[k];
    Object.assign(g.profile, JSON.parse(JSON.stringify(p)));
    await g.store.saveProfile(p);
  }, fixture);
  await page.reload();
  await waitForTitle(page);
  await settle(page, 800);
  const loaded = await page.evaluate(() => {
    const g = window.__game, l = g.debug.avatar.look();
    return {
      title: g.ui.current, look: l, coins: g.profile.coins, stickers: Object.keys(g.profile.stickers).sort(),
      outfits: g.profile.outfits.map((o) => (o ? o.top.type : null)), nudge: !!document.querySelector('.sw-title2 .sw-tile--nudge'),
    };
  });
  const expect = JSON.parse(JSON.stringify(fixture.look));
  const got = { ...loaded.look };
  delete got.sea;
  c(JSON.stringify(got) === JSON.stringify({ ...expect, face: { ...expect.face }, top: { ...expect.top } }) || (got.dress && got.dress.type === 'mermaid' && got.hair.style === expect.hair.style), 'B14 the old look is the same look');
  c(JSON.stringify(loaded.look.sea) === JSON.stringify({ form: 'auto', color: null }), `B14 it gains the default sea (${JSON.stringify(loaded.look.sea)})`);
  c(loaded.coins === 340 && JSON.stringify(loaded.stickers) === JSON.stringify(Object.keys(fixture.stickers).sort()), `B14 coins and stickers as before (${loaded.coins}, ${loaded.stickers})`);
  c(JSON.stringify(loaded.outfits) === JSON.stringify(fixture.outfits.map((o) => (o ? o.top.type : null))), 'B14 the saved outfit slots are intact');
  c(!loaded.nudge, 'B14 no Dress Up nudge (the look was changed before)');
  // a world saved while she is in sea form reloads with her in the water, sea form back within 1 s
  await newWorld(page, 'beach');
  const d = await deepAt(page, 4);
  await atSurface(page, [d.x, d.y, d.z], 0);
  const id = await page.evaluate(async () => { const g = window.__game; await g.saveWorld({ thumbnail: false }); return g.world.meta.id; });
  await page.evaluate(() => window.__game.debug.exitToTitle());
  await waitForTitle(page);
  await page.evaluate((id) => window.__game.debug.loadWorld(id), id);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000 });
  await record(page);
  const back = await hold(page, [], 3000, { until: (s) => !!s.seaForm });
  const e = back[back.length - 1];
  c(e.swimming && e.seaForm === 'mermaid' && e.t <= 1000, `a world saved in sea form: back in the water, a mermaid again within 1 s (${Math.round(e.t)} ms)`);
  await context.close();
}

// ---------------- main ----------------

async function main() {
  const errors = [];
  if (want('unit')) unitPass(errors);
  const browserPasses = ['water', 'swim', 'studio', 'grids', 'review', 'touch', 'friends', 'costs', 'save'].filter(want);
  if (browserPasses.length) {
    const browser = await launch({ headed: !!args.headed });
    try {
      if (want('water')) await waterPass(browser, errors);
      if (want('swim')) await swimPass(browser, errors);
      if (want('studio')) {
        await studioPass(browser, errors);
        await studioPass(browser, errors, { touch: true });
      }
      if (want('studio') || (only && only.includes('grids'))) await gridsPass(browser, errors);
      if (want('studio') || (only && only.includes('review'))) await reviewPass(browser, errors);
      if (want('touch')) await touchPass(browser, errors);
      if (want('friends')) await friendsPass(browser, errors);
      if (want('costs')) await costsPass(browser, errors);
      if (want('save')) await savePass(browser, errors);
    } catch (err) {
      errors.push('[probe] ' + (err && err.stack ? err.stack : err));
      console.log('  ERROR: ' + (err && err.message));
    } finally {
      await browser.close();
    }
  }
  finish(errors);
}

main();
