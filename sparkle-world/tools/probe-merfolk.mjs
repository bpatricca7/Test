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
//   touch    iPad 1024x768: the HUD, the joystick label, Down, the shore with the joystick (T1-T5)
//   friends  Aria and Leo turn too, one line per visit, they keep up (D1, D2)
//   costs    draw calls, meshes, the first turn, toggles, systems time, the tint (B13a-f)
//   save     an old profile (B14), a world saved in sea form
//
//   node tools/probe-merfolk.mjs [--only=unit,water,swim,studio,touch,friends,costs,save] [--headed]

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
  await settle(page, 500);
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
    // a 3x3 pool of water one block deep on top of the sand near the beach
    const x0 = Math.floor(s.land[0]) + s.dir[0] * 6, z0 = Math.floor(s.land[2]) + s.dir[1] * 6, y = Math.floor(s.land[1]);
    let n = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const x = x0 + dx, z = z0 + dz;
      for (let yy = y; yy <= y + 2; yy++) if (g.registry.blocks.props.solid[w.get(x, yy, z)]) g.removeBlock(x, yy, z, { history: false, fx: false });
      if (g.placeBlock(x, y, z, 'water', { history: false, fx: false })) n++;
    }
    return { x: x0 + 0.5, y, z: z0 + 0.5, n };
  }, sh);
  await place(page, [flatPool.x, flatPool.y + 0.02, flatPool.z], 0, 300);
  await gameWait(page, 600);
  const shallow = (await hold(page, ['KeyW'], 1000)).filter((s) => s.swimming);
  const sMax = Math.max(0, ...shallow.map((s) => s.hs));
  c(shallow.length > 5 && shallow.every((s) => !s.seaSwim) && sMax <= 3.0, `B8 1-deep water (${flatPool.n} cells): today's swimming (speed ${sMax.toFixed(2)} <= 3.0, no sea swimming, ${shallow.length} frames)`);
  const sink = await hold(page, [], 800);
  c(sink[sink.length - 1].vy <= 0.01, `B8 1-deep water with no input: she stays down (vy ${sink[sink.length - 1].vy.toFixed(2)})`);
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

// ---------------- main ----------------

async function main() {
  const errors = [];
  if (want('unit')) unitPass(errors);
  const browserPasses = ['water', 'swim', 'studio', 'touch', 'friends', 'costs', 'save'].filter(want);
  if (browserPasses.length) {
    const browser = await launch({ headed: !!args.headed });
    try {
      if (want('water')) await waterPass(browser, errors);
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
