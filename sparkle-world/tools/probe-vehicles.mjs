// Vehicles probe (docs/teams/vehicles.md §10.3): cars, vans and boats she drives, through the
// real UI where it matters (Bag -> Cars & Boats -> item -> a click on the ground places it;
// the HUD Hand button, then a click / tap on the car drives it; W A S D, Space, L, E; the touch
// joystick, Honk, Lights and Get out), the debug API to set up scenes and read results.
//
//   land    flat world, a test course: drive, turn, reverse, a wall (soft stop), a step (climb),
//           a ledge (roll down), a pond (refused), honk, lights (by hand and at night, the pooled
//           light), a broken number recovers, Build is off while driving, E gets out (not the
//           chair), auto-park on a chair; no Undo entries; Remove + Undo of a parked car;
//           draw calls and the systems stage while driving
//   water   beach: a Speedboat clicked onto the lagoon, steer, wake, the shore stops it, Get out
//           onto the sand, open water asks first then she swims; Swan Boat and Sailboat; cars
//           refuse water and boats refuse land; the Ahoy! sticker
//   touch   iPad 1024x768: Bag and items by taps, the joystick drives, Honk in Jump's place,
//           Get out and Lights clear of the joystick and the hotbar; pictures at 1024x768,
//           768x1024, 390x844 and 844x390 with nothing showing through the open Bag
//   models  all nine (Bag pictures, a day and a night picture), parked cars batch
//   save    drive the van, save and reload: parked near where she was, she stands beside it,
//           same uid; the pagehide journal too; a world saved before vehicles still loads
//   mp      two players (FakeClaudeHub + NetHub): careful friends, a friend's kart under her,
//           honks, parking while paused, custody puts it back (dropped drive, sent home), a third
//           page's snapshot, the host's reload keeps a borrowed car, the send budget
//
//   node tools/probe-vehicles.mjs [--only=land,water,touch,models,save,mp] [--headed]

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, openGame, attachErrorCollectors, waitForTitle, waitIdle, shot, settle, finish, PAGE_URL, ROOT } from './smoke.mjs';

const PREFIX = 'vehicles';
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

async function newWorld(page, biome) {
  await page.evaluate((b) => window.__game.debug.newWorld({ biome: b }), biome);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.tutorialDone = true;
    g.profile.settings.quality = 'low'; // SwiftShader: the 3D at 1x
    g.applySettings();
  });
  await recordEvents(page);
}

async function recordEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__probeEvents) return;
    g.__probeEvents = [];
    for (const name of ['vehicle:drive', 'vehicle:park', 'vehicle:honk', 'vehicle:bump', 'sticker:earned', 'entity:place', 'entity:remove']) {
      g.events.on(name, (p) => g.__probeEvents.push({ name, key: p && (p.key || (p.entity && p.entity.key) || (p.sticker && (p.sticker.id || p.sticker))) || null, reason: p && p.reason }));
    }
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => {
      window.__toasts.push(String(text));
      return toast(text, opts);
    };
  });
}

const events = (page, name) => page.evaluate((n) => window.__game.__probeEvents.filter((e) => e.name === n), name);
const toastSeen = (page, re, timeout = 6000) => waitOk(page, (src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, timeout);
const vstate = (page) => page.evaluate(() => window.__game.debug.vehicles.state());

async function cleanView(page, on) {
  await page.evaluate((on) => {
    let s = document.getElementById('probe-clean');
    if (on && !s) {
      s = document.createElement('style');
      s.id = 'probe-clean';
      s.textContent = '.sw-hud, .sw-toasts, .sw-hint, .lf-hud, .sw-stkpop { display: none !important; }';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  }, on);
}

/** A picture from `from` looking at `to` (the rig paused), with the HUD hidden. */
async function picture(page, name, from, to, { ms = 900, fov = 60 } = {}) {
  await cleanView(page, true);
  await page.evaluate(([from, to, fov]) => {
    const g = window.__game;
    g.__rigUpdate = g.cameraRig.update.bind(g.cameraRig);
    g.cameraRig.update = () => {};
    g.__reach = g.reach;
    g.reach = -2;
    g.camera.position.set(...from);
    g.camera.fov = fov;
    g.camera.updateProjectionMatrix();
    g.camera.lookAt(...to);
  }, [from, to, fov]);
  await settle(page, ms);
  await shot(page, name, PREFIX);
  await page.evaluate(() => {
    const g = window.__game;
    g.cameraRig.update = g.__rigUpdate;
    g.reach = g.__reach;
    g.camera.fov = 70;
    g.camera.updateProjectionMatrix();
    g.cameraRig.snap();
  });
  await cleanView(page, false);
}

/** Bag -> tab -> item (and a color when the color step shows), then the Build tool. */
async function fromBag(page, tab, item, { touch = false, color = 0 } = {}) {
  const press = (loc) => (touch ? loc.tap() : loc.click());
  await press(page.locator('.sw-bagbtn').first());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await press(page.locator('.sw-panel-wrap.sw-open .sw-tab2', { hasText: tab }).first());
  await settle(page, 250);
  await press(page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: item }).first());
  await settle(page, 300);
  const colorStep = await page.locator('.sw-panel-wrap.sw-open .sw-color-opt').count();
  if (colorStep) {
    const opt = page.locator('.sw-panel-wrap.sw-open .sw-color-opt').nth(color);
    await (touch ? opt.tap({ timeout: 4000 }) : opt.click({ timeout: 4000 })).catch(() => {});
  }
  const closed = await waitOk(page, () => !window.__game.ui.current, null, 2500);
  if (!closed) {
    await press(page.locator('.sw-panel-wrap.sw-open .sw-bag-close').first());
    await wait(page, () => !window.__game.ui.current, null, 10000);
  }
  if (await page.evaluate(() => window.__game.selectedTool !== 'build')) await useTool(page, 'Build', touch);
  return page.evaluate(() => ({ key: window.__game.hotbar.slots[window.__game.hotbar.index], color: window.__game.hotbar.colors[window.__game.hotbar.index] }));
}

async function useTool(page, name, touch = false) {
  const b = page.locator('.sw-hud .sw-round', { hasText: name }).first();
  if (touch) await b.tap();
  else await b.click();
  await wait(page, (t) => window.__game.selectedTool === t, name.toLowerCase(), 5000);
}

/** Aim at the top face of block (x, y, z) from where she stands and click / tap it. */
async function clickBlockTop(page, x, y, z, { touch = false } = {}) {
  const pt = await page.evaluate(([x, y, z]) => {
    const g = window.__game, props = g.registry.blocks.props;
    const t = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    const r = g.renderer.domElement.getBoundingClientRect();
    if (!g.__tapRig) { g.__tapRig = g.cameraRig.update; g.cameraRig.update = () => {}; }
    const p = g.player.position;
    g.cameraRig.distance = 3.2;
    g.cameraRig.yaw = Math.atan2(t.x - p.x, t.z - p.z);
    for (const pitch of [0.5, 0.35, 0.65, 0.8, 0.95, 0.2]) {
      g.cameraRig.pitch = pitch;
      g.cameraRig.current = g.cameraRig.distance;
      g.cameraRig.shoulder = 1;
      g.__tapRig.call(g.cameraRig, 0, true);
      g.camera.updateMatrixWorld(true);
      const v = g.camera.position.clone().set(t.x, t.y, t.z).project(g.camera);
      if (Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.7) continue;
      const hit = g.pick({ x: v.x, y: v.y });
      const onTop = hit && hit.type === 'block' && hit.x === x && hit.z === z &&
        ((hit.y === y && hit.face[1] === 1) || (hit.y === y + 1 && props.replaceable[hit.id]));
      if (!onTop) continue;
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      if (document.elementFromPoint(sx, sy) === g.renderer.domElement) return { x: sx, y: sy };
    }
    return null;
  }, [x, y, z]);
  if (pt) {
    if (touch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
  }
  await settle(page, 80);
  await page.evaluate(() => { const g = window.__game; if (g.__tapRig) { g.cameraRig.update = g.__tapRig; g.__tapRig = null; } });
  await settle(page, 250);
  return !!pt;
}

/** Turn to an entity and click / tap it (with the current tool). */
async function tapEntity(page, uid, { touch = false } = {}) {
  const pt = await page.evaluate((uid) => {
    const g = window.__game, E = g.entities, e = E.byUid(uid);
    if (!e) return null;
    const t = e.pickable.box.getCenter(g.camera.position.clone());
    if (!g.__tapRig) { g.__tapRig = g.cameraRig.update; g.cameraRig.update = () => {}; }
    const r = g.renderer.domElement.getBoundingClientRect();
    const p = g.player.position;
    g.cameraRig.distance = 3.4;
    g.cameraRig.yaw = Math.atan2(t.x - p.x, t.z - p.z);
    g.cameraRig.pitch = Math.max(-0.8, Math.min(1.2, Math.atan2(p.y + 1.6 - t.y, Math.hypot(t.x - p.x, t.z - p.z))));
    g.cameraRig.current = g.cameraRig.distance;
    g.cameraRig.shoulder = 1;
    g.__tapRig.call(g.cameraRig, 0, true);
    g.camera.updateMatrixWorld(true);
    const v = t.clone().project(g.camera);
    for (const [dx, dy] of [[0, 0], [0, 0.05], [0, -0.05], [0.05, 0], [-0.05, 0], [0, 0.1], [0.1, 0.05], [-0.1, 0.05]]) {
      const ndc = { x: v.x + dx, y: v.y + dy };
      const h = g.pick(ndc);
      if (h && h.type === 'pickable' && h.pickable.ref && h.pickable.ref.uid === uid) {
        const sx = r.left + ((ndc.x + 1) / 2) * r.width, sy = r.top + ((1 - ndc.y) / 2) * r.height;
        if (document.elementFromPoint(sx, sy) !== g.renderer.domElement) continue;
        return { x: sx, y: sy };
      }
    }
    return null;
  }, uid);
  if (pt) {
    if (touch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
  }
  await settle(page, 80);
  await page.evaluate(() => { const g = window.__game; if (g.__tapRig) { g.cameraRig.update = g.__tapRig; g.__tapRig = null; } });
  await settle(page, 250);
  return !!pt;
}

/** Hold a key until cond (in the page) holds, or timeout ms; returns whether it did. */
async function holdKey(page, key, cond, arg = null, timeout = 20000) {
  await page.keyboard.down(key);
  const ok = await waitOk(page, cond, arg, timeout);
  await page.keyboard.up(key);
  return ok;
}

/** Stand her a few blocks from (x, z) on the ground, facing it. */
async function standNear(page, x, z, d = 4) {
  await page.evaluate(([x, z, d]) => {
    const g = window.__game, w = g.world;
    const px = x + 0.5, pz = z - d + 0.5;
    const h = w.heightAt(Math.floor(px), Math.floor(pz));
    if (g.player.flying) g.player.setFlying(false);
    g.player.teleport(px, h + 1.01, pz);
    g.cameraRig.yaw = 0;
  }, [x, z, d]);
  await settle(page, 300);
}

const drawCalls = (page) => page.evaluate(async () => {
  const g = window.__game;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return g.renderer.info.render.calls;
});

// =====================================================================================
// land
// =====================================================================================

async function landPass(browser, errors) {
  console.log('\n[land] flat world, a test course, the real Bag and keys');
  const { context, page } = await openGame(browser, { errors, label: 'land' });
  await newWorld(page, 'flat');
  const base = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return { x: Math.floor(p.x), z: Math.floor(p.z), gy: g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1 };
  });
  const { gy } = base;

  // ---- placing through the Bag: Convertible, its third color, nose away from her ----
  const picked = await fromBag(page, 'Cars & Boats', 'Convertible', { color: 2 });
  check(errors, picked.key === 'furn:car_convertible', `Bag -> Cars & Boats -> Convertible is in the hotbar (${picked.key}, ${picked.color})`);
  const cx = base.x, cz = base.z + 4;
  await standNear(page, cx, cz, 4);
  await clickBlockTop(page, cx, gy - 1, cz);
  const placed = await page.evaluate(() => window.__game.debug.vehicles.list());
  check(errors, placed.length === 1 && placed[0].key === 'car_convertible', `one Convertible placed with a click (${JSON.stringify(placed)})`);
  const car = placed[0];
  if (!car) {
    await context.close();
    return;
  }
  check(errors, car.color === '#3FD8B0', `in the color she picked (${car.color})`);
  const away = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid), p = g.player.position;
    const nose = [Math.sin(e.rot * Math.PI / 2), Math.cos(e.rot * Math.PI / 2)];
    const c = g.entities.localToWorld(e, 1, 0, 1.5);
    return nose[0] * (c.x - p.x) + nose[1] * (c.z - p.z) > 0;
  }, car.uid);
  check(errors, away, 'its nose points away from her (pushing forward drives away from the camera)');
  const hist0 = await page.evaluate(() => window.__game.history.length);

  // ---- Hand, click: she drives ----
  await useTool(page, 'Hand');
  await tapEntity(page, car.uid);
  const st = await page.evaluate((uid) => {
    const g = window.__game, pl = g.player;
    return { state: pl.state, kind: pl.mountPet && pl.mountPet.kind, gone: !g.entities.byUid(uid), seated: !!(pl.avatar) };
  }, car.uid);
  check(errors, st.state === 'ride' && st.kind === 'vehicle' && st.gone, `Hand click: she drives it (state ${st.state}, mount ${st.kind}, the parked one is gone: ${st.gone})`);
  check(errors, (await events(page, 'vehicle:drive')).length === 1, "'vehicle:drive' fired");
  check(errors, await waitOk(page, () => window.__game.stickers.has('beep_beep'), null, 5000), 'the Beep Beep! sticker');
  const hud = await page.evaluate(() => ({
    out: !document.querySelector('.lf-hud [data-action="vgetout"]').hidden,
    lights: !document.querySelector('.lf-hud [data-action="vlights"]').hidden,
    fly: document.querySelector('.sw-hud .sw-round[aria-label="Fly"]').hidden,
  }));
  check(errors, hud.out && hud.lights && hud.fly, `HUD: Get out and Lights show, Fly hides (${JSON.stringify(hud)})`);
  await settle(page, 800);
  await shot(page, 'land-driving', PREFIX);

  // ---- W, A, S ----
  const s0 = await vstate(page);
  await page.evaluate(() => { window.__game.cameraRig.yaw = window.__game.debug.vehicles.state().yaw; });
  const went = await holdKey(page, 'KeyW', ([x, z, yaw]) => {
    const s = window.__game.debug.vehicles.state();
    return (s.x - x) * Math.sin(yaw) + (s.z - z) * Math.cos(yaw) >= 4;
  }, [s0.x, s0.z, s0.yaw], 30000);
  const s1 = await vstate(page);
  const fwd = (s1.x - s0.x) * Math.sin(s0.yaw) + (s1.z - s0.z) * Math.cos(s0.yaw);
  check(errors, went && fwd >= 4, `W drives forward along its nose (${fwd.toFixed(2)} blocks)`);
  await holdKey(page, 'KeyA', (y0) => Math.abs(window.__game.debug.vehicles.state().yaw - y0) > 0.3, s1.yaw, 15000);
  const s2 = await vstate(page);
  check(errors, Math.abs(s2.yaw - s1.yaw) > 0.3, `A turns it (yaw ${s1.yaw.toFixed(2)} -> ${s2.yaw.toFixed(2)})`);
  await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.05, null, 15000);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
  const s3 = await vstate(page);
  await holdKey(page, 'KeyS', ([x, z, yaw]) => {
    const s = window.__game.debug.vehicles.state();
    return (s.x - x) * Math.sin(yaw) + (s.z - z) * Math.cos(yaw) < -0.8;
  }, [s3.x, s3.z, s3.yaw], 20000);
  const s4 = await vstate(page);
  const back = (s4.x - s3.x) * Math.sin(s3.yaw) + (s4.z - s3.z) * Math.cos(s3.yaw);
  check(errors, back < -0.8, `S reverses (${back.toFixed(2)} blocks along the nose)`);
  await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.05, null, 15000);

  // ---- the course (built to the side, the car moved there for each part) ----
  const C = { x: base.x + 40, z: base.z };
  await page.evaluate(([cx, cz, gy]) => {
    const g = window.__game, w = g.world, stone = g.registry.blocks.byKey('stone').id, water = g.registry.blocks.byKey('water').id;
    w.batch(() => {
      // a 2-high wall at z+6 (lane 0)
      for (let x = cx - 3; x <= cx + 3; x++) for (let y = gy; y <= gy + 1; y++) w.set(x, y, cz + 6, stone);
      // a 1-block step from z+6 (lane 1)
      for (let x = cx + 7; x <= cx + 13; x++) for (let z = cz + 6; z <= cz + 16; z++) w.set(x, gy, z, stone);
      // a raised start that ends at z+4 (lane 2): roll off the ledge
      for (let x = cx + 17; x <= cx + 23; x++) for (let z = cz - 4; z <= cz + 3; z++) w.set(x, gy, z, stone);
      // a pond from z+6 (lane 3), the water where the grass was
      for (let x = cx + 27; x <= cx + 33; x++) for (let z = cz + 6; z <= cz + 12; z++) { w.set(x, gy - 1, z, water); w.set(x, gy - 2, z, water); }
    });
  }, [C.x, C.z, gy]);
  await settle(page, 800);
  const lane = async (lx, y, z) => page.evaluate(([x, y, z]) => window.__game.debug.vehicles.setPose(x, y, z, 0), [lx + 0.5, y, z + 0.5]);
  // wall
  const free0 = await lane(C.x, gy, C.z);
  const bumps0 = (await vstate(page)).bumps;
  await holdKey(page, 'KeyW', (b0) => window.__game.debug.vehicles.state().bumps > b0, bumps0, 25000);
  await settle(page, 300);
  const sw = await vstate(page);
  check(errors, free0 && sw.bumps > bumps0 && sw.free && sw.z + 1.38 <= C.z + 6 + 0.01, `a 2-high wall: a soft stop in front of it, never inside (bumps ${sw.bumps}, nose ${(sw.z + 1.38).toFixed(2)} <= ${C.z + 6})`);
  check(errors, (await events(page, 'vehicle:bump')).length >= 1, "'vehicle:bump' fired (boing and stars)");
  // step
  await lane(C.x + 10, gy, C.z);
  const climbed = await holdKey(page, 'KeyW', (gy) => window.__game.debug.vehicles.state().y > gy + 0.95, gy, 25000);
  await settle(page, 300);
  const ss = await vstate(page);
  check(errors, climbed && Math.abs(ss.y - (gy + 1)) < 0.05, `a 1-block step: up by 1 (y ${ss.y.toFixed(3)}, ground ${gy})`);
  // ledge
  await lane(C.x + 20, gy + 1, C.z - 2);
  const down = await holdKey(page, 'KeyW', (gy) => { const s = window.__game.debug.vehicles.state(); return s.y < gy + 0.05 && s.onGround; }, gy, 25000);
  await settle(page, 300);
  const sl = await vstate(page);
  check(errors, down && Math.abs(sl.y - gy) < 0.05 && sl.nanResets === 0, `off a ledge: down by 1 (y ${sl.y.toFixed(3)}), no broken numbers`);
  // pond
  await lane(C.x + 30, gy, C.z);
  await page.evaluate(() => { window.__toasts.length = 0; });
  await page.keyboard.down('KeyW');
  const refused = await toastSeen(page, /Cars can't swim! Try a boat!/, 25000);
  await settle(page, 800);
  await page.keyboard.up('KeyW');
  const sp = await page.evaluate(() => {
    const g = window.__game, s = g.debug.vehicles.state();
    return { ...s, wetCenter: g.physics.liquidAt(s.x, s.y + 0.1, s.z) || g.physics.liquidAt(s.x, s.y - 0.5, s.z) };
  });
  check(errors, refused && !sp.wetCenter && sp.z + 1.38 <= C.z + 6 + 0.01, `the pond: stops on the shore with "Cars can't swim! Try a boat!" (nose ${(sp.z + 1.38).toFixed(2)})`);

  // ---- honk, lights ----
  const a0 = await page.evaluate(() => window.__game.audio.stats());
  const h0 = (await events(page, 'vehicle:honk')).length;
  await page.keyboard.press('Space');
  await settle(page, 400);
  const a1 = await page.evaluate(() => window.__game.audio.stats());
  check(errors, (await events(page, 'vehicle:honk')).length === h0 + 1, "Space honks ('vehicle:honk')");
  if (a0.state === 'running') check(errors, a1.started > a0.started, `the horn plays (audio voices ${a0.started} -> ${a1.started})`);
  else console.log(`  (audio is ${a0.state} here: the voice count is not checked)`);
  const stillDriving = await page.evaluate(() => window.__game.player.state === 'ride' && window.__game.ui.current !== 'help');
  check(errors, stillDriving, 'a honk never stands her up or opens anything');
  await page.evaluate(() => window.__game.setDayTime(0.92));
  const auto = await waitOk(page, () => {
    const g = window.__game, s = g.debug.vehicles.state();
    return s.lights && g.entities.lights.some((l) => l.intensity > 0 && Math.hypot(l.position.x - s.x, l.position.z - s.z) < 4);
  }, null, 8000);
  check(errors, auto, 'at night the lamps come on by themselves and borrow a pooled light (it follows the car)');
  await settle(page, 600);
  await shot(page, 'land-night-lights', PREFIX);
  await page.keyboard.press('KeyL');
  await settle(page, 300);
  const off = await vstate(page);
  await page.keyboard.press('KeyL');
  await settle(page, 300);
  const on = await vstate(page);
  check(errors, off.lights === false && on.lights === true, 'L switches the lights off and on');
  await page.evaluate(() => window.__game.setDayTime(0.4));

  // ---- a broken number recovers at once ----
  await page.evaluate(() => window.__game.debug.vehicles.corrupt('x'));
  await settle(page, 400);
  const sn = await vstate(page);
  const fps = await page.evaluate(() => window.__game.debug.info().fps);
  check(errors, Number.isFinite(sn.x) && sn.nanResets === 1 && fps > 0, `corrupt('x'): finite next frame, nanResets ${sn.nanResets}, fps ${fps}`);

  // ---- Build and Remove are off while driving ----
  await page.evaluate(() => { window.__toasts.length = 0; });
  await page.keyboard.press('KeyR');
  await settle(page, 300);
  const tool = await page.evaluate(() => window.__game.selectedTool);
  check(errors, tool === 'hand' && await toastSeen(page, /Park first to build!/, 3000), `R (Build) while driving: "Park first to build!", the tool stays Hand (${tool})`);

  // ---- costs while driving ----
  await page.evaluate(([x, z, gy]) => window.__game.debug.vehicles.setPose(x, gy, z, 0), [base.x + 0.5, base.z + 10.5, gy]);
  await settle(page, 600);
  const timing = async () => page.evaluate(async () => {
    const g = window.__game;
    let sum = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      sum += g._stageTimes.systems;
    }
    return sum / 120;
  });
  const callsDriving = await drawCalls(page);
  const sysDriving = await timing();

  // ---- E gets out (not the chair she looks at) ----
  const chair = await page.evaluate(() => {
    const g = window.__game, s = g.debug.vehicles.state();
    const e = g.entities.place('chair', Math.floor(s.x) + 3, Math.floor(s.y), Math.floor(s.z), 0, null, {}, { history: false, players: false });
    return e ? e.uid : null;
  });
  await page.keyboard.press('KeyE');
  await settle(page, 500);
  const parked = await page.evaluate(([uid, hist0]) => {
    const g = window.__game, E = g.entities, e = E.byUid(uid);
    const pl = g.player, p = pl.position;
    if (!e) return { found: false };
    const fits = E.canPlace(e.def, e.x, e.y, e.z, e.rot, e, { players: false });
    const inside = g.physics.bodyBlocked(p.x, p.y + 0.01, p.z, pl.halfW, pl.height);
    return {
      found: true, x: e.x, y: e.y, z: e.z, rot: e.rot, fits, state: pl.state, inside, hist: g.history.length, hist0,
      ints: [e.x, e.y, e.z].every(Number.isInteger),
    };
  }, [car.uid, hist0]);
  check(errors, parked.found && parked.ints && parked.rot >= 0 && parked.rot <= 3 && parked.fits, `E: parked on whole cells, a quarter turn, where it fits (${JSON.stringify(parked)})`);
  check(errors, parked.state === 'walk' && !parked.inside, `she stands beside it, not inside anything, and not on the chair (${parked.state})`);
  check(errors, parked.hist === parked.hist0, `driving and parking left no Undo entries (${parked.hist0} -> ${parked.hist})`);
  check(errors, (await events(page, 'vehicle:park')).length >= 1, "'vehicle:park' fired");
  await settle(page, 600);
  const callsParked = await drawCalls(page);
  const sysIdle = await timing();
  check(errors, callsDriving - callsParked <= 8, `draw calls while driving minus parked: ${callsDriving} - ${callsParked} = ${callsDriving - callsParked} (<= 8)`);
  check(errors, sysDriving <= sysIdle + 1.5, `systems stage while driving ${sysDriving.toFixed(2)} ms vs idle ${sysIdle.toFixed(2)} ms (<= +1.5)`);

  // ---- auto-park: a chair while driving (Hand) parks the car where it is ----
  await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), car.uid);
  await settle(page, 300);
  await page.evaluate((uid) => window.__game.debug.interact(uid), chair);
  await settle(page, 400);
  const ap = await page.evaluate((uid) => ({ state: window.__game.player.state, back: !!window.__game.entities.byUid(uid), drive: !!window.__game.vehicles.current }), car.uid);
  check(errors, ap.state === 'sit' && ap.back && !ap.drive, `sitting on a chair while driving parks the car (${JSON.stringify(ap)})`);
  await page.evaluate(() => window.__game.player.stand());

  // ---- Remove + Undo of a parked car (ordinary furniture) ----
  await useTool(page, 'Remove');
  await tapEntity(page, car.uid);
  const removed = await page.evaluate((uid) => !window.__game.entities.byUid(uid), car.uid);
  await page.locator('.sw-undobtn').first().click();
  await settle(page, 400);
  const back2 = await page.evaluate((uid) => !!window.__game.entities.byUid(uid), car.uid);
  check(errors, removed && back2, `Remove takes a parked car away, Undo brings it back (${removed}, ${back2})`);
  await context.close();
}

// =====================================================================================
// water
// =====================================================================================

/** A lagoon spot: open water at least 3 deep around, near the shore, and a far one. */
async function findWater(page) {
  return page.evaluate(() => {
    const g = window.__game, w = g.world, props = g.registry.blocks.props;
    const liquid = (x, y, z) => props.shape[w.get(x, y, z)] === 5;
    const top = w.waterLevel;
    const p = g.player.position;
    const px = Math.floor(p.x), pz = Math.floor(p.z);
    let near = null, far = null;
    const open = (x, z, r) => {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (!liquid(x + dx, top, z + dz) || liquid(x + dx, top + 1, z + dz)) return false;
      return true;
    };
    for (let r = 2; r < 70 && (!near || !far); r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = px + dx, z = pz + dz;
          if (!near && open(x, z, 2) && !open(x, z, 5)) {
            let floor = top;
            for (let k = 0; k < 20 && liquid(x, floor, z); k++) floor--;
            near = { x, z, floor };
          }
          if (!far && open(x, z, 7)) far = { x, z };
        }
      }
    }
    return { top, near, far };
  });
}

async function waterPass(browser, errors) {
  console.log('\n[water] beach: boats on the lagoon');
  const { context, page } = await openGame(browser, { errors, label: 'water' });
  await newWorld(page, 'beach');
  const W = await findWater(page);
  check(errors, W.near && W.far, `found the lagoon (water level ${W.top}, ${JSON.stringify(W.near)}, ${JSON.stringify(W.far)})`);
  if (!W.near) {
    await context.close();
    return;
  }
  // a boat on grass first, a car on water: friendly refusals
  const land = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return { x: Math.floor(p.x), y: g.world.heightAt(Math.floor(p.x), Math.floor(p.z)), z: Math.floor(p.z) };
  });
  await fromBag(page, 'Cars & Boats', 'Speedboat');
  await page.evaluate(() => { window.__toasts.length = 0; });
  await page.evaluate(([x, y, z]) => window.__game.debug.useAt(x, y, z + 3), [land.x, land.y, land.z]);
  check(errors, await toastSeen(page, /Boats go on water! Tap the water\./), 'a Speedboat on the sand: "Boats go on water! Tap the water."');
  await page.evaluate(([x, z, top]) => {
    const g = window.__game;
    // stand on the shore near the water spot (a hover, the beach slopes)
    g.player.setFlying(true);
    g.player.teleport(x + 0.5, top + 3, z - 3.5);
  }, [W.near.x, W.near.z, W.top]);
  await settle(page, 400);
  await fromBag(page, 'Cars & Boats', 'Convertible');
  await page.evaluate(() => { window.__toasts.length = 0; });
  await clickBlockTop(page, W.near.x, W.near.floor, W.near.z);
  check(errors, await toastSeen(page, /Cars go on land!/), 'a Convertible clicked on the water: "Cars go on land!"');
  // the Speedboat clicked onto the lagoon
  await fromBag(page, 'Cars & Boats', 'Speedboat');
  await clickBlockTop(page, W.near.x, W.near.floor, W.near.z);
  const boat = await page.evaluate((top) => {
    const g = window.__game, E = g.entities, props = g.registry.blocks.props;
    const e = E.all().find((x) => x.key === 'boat_speed');
    if (!e) return null;
    const wet = e.cells.filter(([, y]) => y === e.y).every(([x, y, z]) => props.shape[g.world.get(x, y, z)] === 5);
    return { uid: e.uid, y: e.y, wet, top };
  }, W.top);
  check(errors, boat && boat.y === W.top && boat.wet, `a click on the lagoon puts the Speedboat in the top water cell, every bottom cell water (${JSON.stringify(boat)})`);
  if (!boat) {
    await context.close();
    return;
  }
  await page.evaluate(() => window.__game.player.setFlying(false));
  await useTool(page, 'Hand');
  await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), boat.uid);
  check(errors, await waitOk(page, () => window.__game.stickers.has('ahoy'), null, 5000), 'driving a boat: the Ahoy! sticker');
  // steer out into open water
  await page.evaluate(([x, z, top]) => window.__game.debug.vehicles.setPose(x + 0.5, top, z + 0.5, 0), [W.far.x, W.far.z, W.top]);
  const b0 = await vstate(page);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
  const moved = await holdKey(page, 'KeyW', ([x, z]) => { const s = window.__game.debug.vehicles.state(); return Math.hypot(s.x - x, s.z - z) > 3 && s.wake; }, [b0.x, b0.z], 25000);
  const b1 = await vstate(page);
  check(errors, moved && b1.y === W.top && b1.water === W.top, `W steers the boat at the water level (moved ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(1)}, y ${b1.y})`);
  check(errors, b1.wake, 'a foam wake behind it');
  await settle(page, 300);
  await shot(page, 'water-boat', PREFIX);
  // far from the shore: Get out asks first, then she swims
  await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.1, null, 15000);
  await page.evaluate(([x, z, top]) => window.__game.debug.vehicles.setPose(x + 0.5, top, z + 0.5, 0), [W.far.x, W.far.z, W.top]);
  await page.evaluate(() => { window.__toasts.length = 0; });
  await page.keyboard.press('KeyE');
  const asked = await toastSeen(page, /Drive to the shore, or tap Get out again to swim!/, 4000);
  const still = await page.evaluate(() => !!window.__game.vehicles.current);
  check(errors, asked && still, 'open water: the first Get out asks ("Drive to the shore, or tap Get out again to swim!") and she keeps driving');
  await page.locator('.lf-hud [data-action="vgetout"]').click();
  await settle(page, 1200);
  const swim = await page.evaluate((uid) => {
    const g = window.__game, pl = g.player, e = g.entities.byUid(uid);
    return { parked: !!e, onWater: !!e && e.y === g.world.waterLevel, swimming: pl.swimming, state: pl.state };
  }, boat.uid);
  check(errors, swim.parked && swim.onWater && swim.state !== 'ride' && swim.swimming, `the second tap: the boat floats where it is, she swims (${JSON.stringify(swim)})`);
  // near the shore: Get out onto the sand
  await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), boat.uid);
  await settle(page, 300);
  await page.evaluate(([x, z, top]) => window.__game.debug.vehicles.setPose(x + 0.5, top, z + 0.5, 0), [W.near.x, W.near.z, W.top]);
  await page.evaluate(() => { window.__toasts.length = 0; });
  // drive into the shore first: it stops there
  const yaw = await page.evaluate(([x, z]) => {
    // toward the nearest land
    const g = window.__game, w = g.world, props = g.registry.blocks.props, top = w.waterLevel;
    let best = null;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (let d = 1; d < 12; d++) {
        const cx = Math.floor(x + 0.5 + Math.sin(ang) * d), cz = Math.floor(z + 0.5 + Math.cos(ang) * d);
        if (props.shape[w.get(cx, top, cz)] !== 5) { if (!best || d < best.d) best = { d, ang }; break; }
      }
    }
    const ang = best ? best.ang : 0;
    g.debug.vehicles.setPose(x + 0.5, top, z + 0.5, ang);
    return ang;
  }, [W.near.x, W.near.z]);
  void yaw;
  await page.keyboard.down('KeyW');
  const shore = await toastSeen(page, /Boats stay on the water!/, 20000);
  await page.keyboard.up('KeyW');
  const sh = await page.evaluate(() => {
    const g = window.__game, s = g.debug.vehicles.state(), d = g.vehicles.current.drive;
    return { free: s.free, probesWet: d.probes.every((i) => g.physics.liquidAt(d._px(d.pos.x, d.yaw, i), d.waterY + 0.5, d._pz(d.pos.z, d.yaw, i))) };
  });
  check(errors, shore && sh.free && sh.probesWet, `the shore stops it ("Boats stay on the water!"), every probe column still water (${JSON.stringify(sh)})`);
  await page.keyboard.press('KeyE');
  await settle(page, 800);
  const out = await page.evaluate((uid) => {
    const g = window.__game, pl = g.player, p = pl.position, e = g.entities.byUid(uid), props = g.registry.blocks.props;
    const under = g.world.get(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    return { parked: !!e, onWater: !!e && e.y === g.world.waterLevel, state: pl.state, swimming: pl.swimming, ground: props.shape[under] !== 5 && props.solid[under] === 1 };
  }, boat.uid);
  check(errors, out.parked && out.onWater && out.state === 'walk' && !out.swimming && out.ground, `near the shore: the boat stays on the water, she steps onto the sand (${JSON.stringify(out)})`);
  // the Swan Boat and the Sailboat sail too
  for (const key of ['boat_swan', 'boat_sail']) {
    const uid = await page.evaluate(([key, x, z, top]) => {
      const g = window.__game;
      const e = g.entities.place(key, x, top, z, 0, null, {}, { history: false, players: false });
      return e ? e.uid : null;
    }, [key, W.far.x + (key === 'boat_sail' ? 3 : -3), W.far.z - 2, W.top]);
    if (!uid) {
      check(errors, false, `${key} placed on open water`);
      continue;
    }
    await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), uid);
    const t0 = await vstate(page);
    await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
    const ok = await holdKey(page, 'KeyW', ([x, z]) => { const s = window.__game.debug.vehicles.state(); return Math.hypot(s.x - x, s.z - z) > 1; }, [t0.x, t0.z], 20000);
    check(errors, ok, `${key} sails`);
    await settle(page, 300);
    await shot(page, `water-${key}`, PREFIX);
    await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.1, null, 15000);
    await page.evaluate(() => window.__game.debug.vehicles.park('auto'));
    await settle(page, 300);
  }
  await context.close();
}

// =====================================================================================
// touch
// =====================================================================================

async function touchPass(browser, errors) {
  console.log('\n[touch] iPad: taps, the joystick, Honk, Get out');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'touch' });
  await newWorld(page, 'flat');
  const base = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return { x: Math.floor(p.x), z: Math.floor(p.z), gy: g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1 };
  });
  const picked = await fromBag(page, 'Cars & Boats', 'Safari Jeep', { touch: true });
  check(errors, picked.key === 'furn:car_jeep', `Bag tab and item by taps (${picked.key})`);
  await standNear(page, base.x, base.z + 4, 4);
  await clickBlockTop(page, base.x, base.gy - 1, base.z + 4, { touch: true });
  const jeep = await page.evaluate(() => window.__game.debug.vehicles.list().find((v) => v.key === 'car_jeep'));
  check(errors, !!jeep, 'a tap places the Safari Jeep');
  if (!jeep) {
    await context.close();
    return;
  }
  await useTool(page, 'Hand', true);
  await tapEntity(page, jeep.uid, { touch: true });
  check(errors, await waitOk(page, () => !!window.__game.vehicles.current, null, 4000), 'a Hand tap: driving');
  const label = await page.evaluate(() => {
    const t = document.querySelector('.sw-hud .sw-touch');
    const vis = (b) => b && !b.hidden && b.offsetParent !== null;
    const honk = [...t.querySelectorAll('.sw-round')].find((b) => vis(b) && b.getAttribute('aria-label') === 'Honk');
    const jump = [...t.querySelectorAll('.sw-round')].find((b) => vis(b) && b.getAttribute('aria-label') === 'Jump');
    return {
      honk: honk ? honk.querySelector('.sw-round-label').textContent : null, jump: !!jump,
      fly: vis(document.querySelector('.sw-hud .sw-round[aria-label="Fly"]')),
      joy: document.querySelector('.sw-joy-label') && document.querySelector('.sw-joy-label').textContent,
    };
  });
  check(errors, label.honk === 'Honk' && !label.jump && !label.fly && label.joy === 'Drive', `Jump's spot shows Honk, Jump and Fly hidden, the joystick says Drive (${JSON.stringify(label)})`);
  // the joystick drives forward
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const joy = await page.evaluate(() => { const r = document.querySelector('.sw-joy').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
  const j0 = await vstate(page);
  await touch('touchStart', [[joy.x, joy.y]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[joy.x, joy.y - i * 8]]); await page.waitForTimeout(30); }
  await waitOk(page, ([x, z]) => { const s = window.__game.debug.vehicles.state(); return Math.hypot(s.x - x, s.z - z) > 2; }, [j0.x, j0.z], 20000);
  await touch('touchEnd', []);
  const j1 = await vstate(page);
  const fwd = (j1.x - j0.x) * Math.sin(j0.yaw) + (j1.z - j0.z) * Math.cos(j0.yaw);
  check(errors, fwd > 2, `pushing the joystick up drives forward (${fwd.toFixed(2)} blocks)`);
  // HUD layout on four screen shapes
  const sizes = [[1024, 768], [768, 1024], [390, 844], [844, 390]];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await settle(page, 900);
    const lay = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const ov = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
      const out = document.querySelector('.lf-hud [data-action="vgetout"] .sw-round-face');
      const lights = document.querySelector('.lf-hud [data-action="vlights"] .sw-round-face');
      const joyEl = document.querySelector('.sw-joy');
      const hot = document.querySelector('.sw-hud .sw-hotbar');
      const res = { shown: !!(out && out.offsetParent && lights && lights.offsetParent), bad: [] };
      if (!res.shown) return res;
      for (const [n, el] of [['Get out', out], ['Lights', lights]]) {
        const b = box(el);
        if (joyEl && joyEl.offsetParent && ov(b, box(joyEl))) res.bad.push(n + ' x joystick');
        if (hot && ov(b, box(hot))) res.bad.push(n + ' x hotbar');
        if (b.l < -1 || b.t < -1 || b.r > innerWidth + 1 || b.b > innerHeight + 1) res.bad.push(n + ' off screen');
      }
      return res;
    });
    check(errors, lay.shown && lay.bad.length === 0, `${w}x${h}: Get out and Lights show, clear of the joystick and the hotbar ${lay.bad.length ? JSON.stringify(lay.bad) : ''}`);
    await shot(page, `hud-${w}x${h}`, PREFIX);
    // the smoke rule: nothing shows through the open Bag
    await page.evaluate(() => window.__game.ui.open('bag'));
    await settle(page, 600);
    const through = await page.evaluate(() => {
      const outl = [];
      for (const b of document.querySelectorAll('.sw-hud button, .lf-hud button')) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        const top = document.elementFromPoint(cx, cy);
        if (top && b.contains(top)) outl.push(b.getAttribute('aria-label') || b.className);
      }
      return outl;
    });
    check(errors, through.length === 0, `${w}x${h}: nothing shows through the open Bag ${through.length ? JSON.stringify(through) : ''}`);
    await page.evaluate(() => window.__game.ui.close());
    await settle(page, 300);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await settle(page, 700);
  const h0 = (await events(page, 'vehicle:honk')).length;
  await page.locator('.sw-hud .sw-touch .sw-round[aria-label="Honk"]').tap();
  await settle(page, 400);
  check(errors, (await events(page, 'vehicle:honk')).length === h0 + 1, 'tap Honk: a honk');
  await page.locator('.lf-hud [data-action="vlights"]').tap();
  await settle(page, 200);
  check(errors, (await vstate(page)).lights === true, 'tap Lights: the lamps come on');
  await page.locator('.lf-hud [data-action="vgetout"]').tap();
  await settle(page, 600);
  const out = await page.evaluate((uid) => ({ parked: !!window.__game.entities.byUid(uid), state: window.__game.player.state, joy: document.querySelector('.sw-joy-label').textContent }), jeep.uid);
  check(errors, out.parked && out.state === 'walk' && out.joy === 'Walk', `tap Get out: parked, walking, the joystick says Walk again (${JSON.stringify(out)})`);
  const after = await page.evaluate(() => ({ jump: !!document.querySelector('.sw-hud .sw-touch .sw-round[aria-label="Jump"]:not([hidden])'), out: document.querySelector('.lf-hud [data-action="vgetout"]').hidden }));
  check(errors, after.jump && after.out, 'Jump is back, Get out hides');
  await context.close();
}

// =====================================================================================
// models
// =====================================================================================

const FLEET = ['car_bubble', 'car_convertible', 'car_jeep', 'car_kart', 'van_camper', 'van_icecream', 'boat_speed', 'boat_swan', 'boat_sail'];

async function modelsPass(browser, errors) {
  console.log('\n[models] the fleet');
  const { context, page } = await openGame(browser, { errors, label: 'models' });
  await newWorld(page, 'flat');
  const icons = await page.evaluate(async (keys) => {
    const out = {};
    for (const k of keys) {
      const url = await window.__game.registry.items.iconFor('furn:' + k);
      out[k] = typeof url === 'string' && url.startsWith('data:image') && url.length > 400;
    }
    return out;
  }, FLEET);
  check(errors, Object.values(icons).every(Boolean), `every vehicle has a Bag picture ${JSON.stringify(icons)}`);
  const tab = await page.evaluate(() => ({ items: window.__game.registry.items.byCategory('vehicles').length }));
  check(errors, tab.items === 9, `nine items in the Cars & Boats tab (${tab.items})`);
  // a camera fixed on an empty spot; then six land vehicles there: they batch
  const B = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    // the start of a 16 x 16 square (the furniture batches' size): six cars fit in one
    const x = Math.floor((p.x + 20) / 16) * 16, z = Math.floor((p.z + 20) / 16) * 16;
    g.player.teleport(x - 8, g.world.heightAt(x - 8, z - 8) + 1.01, z - 8);
    return { x, z, gy: g.world.heightAt(x, z) + 1 };
  });
  const fixCam = () => page.evaluate(({ x, z, gy }) => {
    const g = window.__game;
    if (!g.__rig) { g.__rig = g.cameraRig.update.bind(g.cameraRig); g.cameraRig.update = () => {}; }
    g.reach = -2;
    g.camera.position.set(x + 9, gy + 6, z - 8);
    g.camera.lookAt(x + 9, gy, z + 4);
  }, B);
  await fixCam();
  await settle(page, 800);
  const empty = await drawCalls(page);
  const placedOk = await page.evaluate(({ x, z, gy }) => {
    const g = window.__game, w = g.world, water = g.registry.blocks.byKey('water').id;
    const ok = [];
    ['car_bubble', 'car_convertible', 'car_jeep', 'car_kart', 'van_camper', 'van_icecream'].forEach((k, i) => {
      ok.push(!!g.entities.place(k, x + 1 + (i % 3) * 5, gy, z + 4 + Math.floor(i / 3) * 7, 0, null, {}, { history: false, players: false }));
    });
    return ok;
  }, B);
  await settle(page, 800);
  const six = await drawCalls(page);
  check(errors, placedOk.every(Boolean) && six - empty <= 6, `six parked land vehicles add ${six - empty} draw calls (<= 6: they batch)`);
  // the boats on a pool beside them
  await page.evaluate(({ x, z, gy }) => {
    const g = window.__game, w = g.world, water = g.registry.blocks.byKey('water').id;
    w.batch(() => {
      for (let xx = x + 18; xx < x + 29; xx++) for (let zz = z - 1; zz < z + 6; zz++) { w.set(xx, gy - 1, zz, water); w.set(xx, gy - 2, zz, water); }
    });
    let cx = x + 19;
    for (const k of ['boat_speed', 'boat_swan', 'boat_sail']) {
      g.entities.place(k, cx, gy - 1, z + 4, 0, null, {}, { history: false, players: false });
      cx += 3;
    }
  }, B);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.update = g.__rig; g.__rig = null; g.reach = 8; });
  await picture(page, 'fleet', [B.x + 14, B.gy + 7, B.z - 9], [B.x + 14, B.gy + 0.5, B.z + 3], { ms: 1500 });
  await page.evaluate(() => window.__game.setDayTime(0.92));
  // one of them driving with the lamps on at night
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    const e = g.entities.all().find((v) => v.key === 'car_convertible');
    g.player.teleport(e.x - 2.5, e.y + 0.01, e.z - 3);
    g.debug.vehicles.drive(e.uid);
  }, B);
  await settle(page, 1500);
  await picture(page, 'fleet-night', [B.x + 14, B.gy + 7, B.z - 9], [B.x + 14, B.gy + 0.5, B.z + 3], { ms: 1500 });
  check(errors, (await vstate(page)).lights === true, 'at night the driven car has its lamps on');
  await context.close();
}

// =====================================================================================
// save
// =====================================================================================

async function reloadInto(page, id) {
  await page.reload();
  await waitForTitle(page, 60000);
  await page.evaluate((id) => window.__game.debug.loadWorld(id), id);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await recordEvents(page);
}

async function savePass(browser, errors) {
  console.log('\n[save] never lost: save and reload while driving, the pagehide journal, an old save');
  const { context, page } = await openGame(browser, { errors, label: 'save' });
  await newWorld(page, 'flat');
  const setup = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3, y = g.world.heightAt(x, z) + 1;
    const e = g.entities.place('van_camper', x, y, z, 0, '#FFB3C7', {}, { history: false });
    return { uid: e && e.uid, id: g.world.meta.id };
  });
  check(errors, !!setup.uid, 'a Road Trip Van in the world');
  const driveAndSave = async (how) => {
    await page.evaluate((uid) => window.__game.debug.vehicles.drive(uid), setup.uid);
    await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.debug.vehicles.state().yaw; });
    const v0 = await vstate(page);
    await holdKey(page, 'KeyW', ([x, z]) => { const s = window.__game.debug.vehicles.state(); return Math.hypot(s.x - x, s.z - z) > 10; }, [v0.x, v0.z], 40000);
    await waitOk(page, () => Math.abs(window.__game.debug.vehicles.state().speed) < 0.1, null, 15000);
    const v1 = await vstate(page);
    if (how === 'save') await page.evaluate(() => window.__game.debug.save());
    else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await settle(page, 400);
    return v1;
  };
  const v1 = await driveAndSave('save');
  await reloadInto(page, setup.id);
  const r1 = await page.evaluate(([uid]) => {
    const g = window.__game, E = g.entities, e = E.byUid(uid), pl = g.player, p = pl.position;
    if (!e) return { found: false, list: g.debug.vehicles.list() };
    const c = E.localToWorld(e, 1, 0, 2);
    const inside = g.physics.bodyBlocked(p.x, p.y + 0.01, p.z, pl.halfW, pl.height);
    return { found: true, cx: c.x, cz: c.z, color: e.color, dist: Math.hypot(p.x - c.x, p.z - c.z), inside, state: pl.state };
  }, [setup.uid]);
  check(errors, r1.found && Math.hypot(r1.cx - v1.x, r1.cz - v1.z) < 2.5 && r1.color === '#FFB3C7', `saved while driving, reloaded: the van (same uid, same color) is parked where she was (${JSON.stringify(r1)})`);
  check(errors, r1.found && !r1.inside && r1.dist < 5 && r1.state === 'walk', 'she stands beside it, not inside');
  const v2 = await driveAndSave('pagehide');
  await reloadInto(page, setup.id);
  const r2 = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    if (!e) return { found: false };
    const c = g.entities.localToWorld(e, 1, 0, 2);
    return { found: true, cx: c.x, cz: c.z, n: g.debug.vehicles.list().length };
  }, setup.uid);
  check(errors, r2.found && r2.n === 1 && Math.hypot(r2.cx - v2.x, r2.cz - v2.z) < 2.5, `the page closed while driving (pagehide journal): parked where she was, one van (${JSON.stringify(r2)})`);
  // a world saved before vehicles existed (96565e4: a horse ride, a pool float, a friend)
  const fixture = JSON.parse(await readFile(path.join(ROOT, 'tools', 'fixtures', 'old-world-96565e4.json'), 'utf8'));
  const old = await page.evaluate(async (fx) => {
    const g = window.__game;
    await g.exitToTitle();
    const res = await g.store.importWorld(fx.world);
    if (!res || !res.ok) return { imported: false };
    await g.debug.loadWorld(res.id);
    await g.debug.waitIdle(60000);
    return {
      imported: true, mode: g.mode, ents: g.entities.all().length, keys: [...new Set(g.entities.all().map((e) => e.key))].sort(),
      pets: g.pets.pets.length, friends: g.friends ? g.friends.friends.length : null, state: g.player.state, vehicles: g.debug.vehicles.list().length,
    };
  }, fixture);
  check(errors, old.imported && old.mode === 'play' && old.ents >= 3 && old.keys.includes('pool_float') && old.pets === 2 && old.vehicles === 0 && old.state === 'walk', `a world saved by the build before vehicles loads as before (${JSON.stringify(old)})`);
  await context.close();
}

// =====================================================================================
// mp
// =====================================================================================

async function mpPass(browser, errors) {
  console.log('\n[mp] Lily hosts (desktop), Rosie (iPad) and June (phone) join');
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
    return pl;
  };
  const lily = await open({ key: 'lily', name: 'Lily', uid: 'u-lily', level: 'interact', can: true, guest: false, viewport: { width: 1280, height: 800 }, touch: false, seed: 11 });
  const rosie = await open({ key: 'rosie', name: 'Rosie', uid: 'u-rosie', level: 'view', can: null, guest: false, viewport: { width: 1024, height: 768 }, touch: true, seed: 29 });
  const converge = async (players, label) => {
    const r = await flows.converge(players, { timeout: 60000 });
    return check(errors, r.ok, `${label}: equal hashes and entities on ${players.map((p) => p.key).join(', ')}${r.detail ? ' (' + r.detail + ')' : ''}`);
  };
  const code = await flows.hostMakesCode(lily, { biome: 'flat' });
  await flows.guestTypesCode(rosie, code);
  await flows.hostLetsIn(lily, 'Rosie');
  check(errors, await waitLive(rosie), 'Rosie is in Lily\'s world');
  await closePanels(lily);
  await bringTo(rosie, lily, 3, 3);
  await converge([lily, rosie], 'start');
  const resync0 = await game(rosie, () => window.__game.debug.net.stats().resyncs || 0);

  // 1. careful friends: Rosie cannot drive Lily's car
  const lc = await game(lily, () => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + 5, z = Math.floor(p.z) - 4, y = g.world.heightAt(x, z) + 1;
    const e = g.entities.place('car_convertible', x, y, z, 0, null, {});
    return e ? e.uid : null;
  });
  await converge([lily, rosie], '1 placed');
  await game(rosie, (uid) => window.__game.debug.vehicles.drive(uid), lc);
  check(errors, await until(rosie, () => window.__toasts.some((t) => /That's Lily's car! Make your own in the Bag\./.test(t)), null, 5000), 'careful mode: Rosie hears "That\'s Lily\'s car! Make your own in the Bag."');
  check(errors, await game(rosie, (uid) => !!window.__game.entities.byUid(uid) && !window.__game.vehicles.current, lc), 'and nothing changed on her page');
  await converge([lily, rosie], '1');

  // 2. Rosie's own Go-Kart: she drives, Lily sees it under her, the honk plays there
  const rk = await game(rosie, () => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + 2, z = Math.floor(p.z) + 3, y = g.world.heightAt(x, z) + 1;
    const e = g.entities.place('car_kart', x, y, z, 0, '#4FB8FF', {});
    return e ? e.uid : null;
  });
  check(errors, rk >= 1000001 && rk < 2000000, `Rosie's kart has a uid of hers (${rk})`);
  await converge([lily, rosie], '2 placed');
  await game(rosie, (uid) => window.__game.debug.vehicles.drive(uid), rk);
  check(errors, await until(lily, () => window.__game.debug.net.remote().some((r) => r.name === 'Rosie' && r.vehicle === 'car_kart'), null, 10000), 'Lily sees Rosie in her go-kart (remote vehicle car_kart)');
  check(errors, await until(lily, (uid) => !window.__game.entities.byUid(uid), rk, 10000) && await game(rosie, (uid) => !window.__game.entities.byUid(uid), rk), 'the parked kart is gone on both pages');
  check(errors, await game(lily, () => window.__game.net.session.hostCore.custody.size === 1), 'the host keeps custody of it');
  await game(rosie, async () => {
    const g = window.__game;
    g.cameraRig.yaw = g.debug.vehicles.state().yaw;
  });
  await rosie.page.waitForTimeout(300);
  const honks0 = await game(lily, () => window.__game.debug.vehicles.stats().remoteHonks);
  await game(rosie, () => window.__game.debug.vehicles.honk());
  check(errors, await until(lily, (n) => window.__game.debug.vehicles.stats().remoteHonks > n, honks0, 8000), 'Rosie honks: Lily\'s page plays it');
  await lily.page.waitForTimeout(800);
  await shot(lily, 'mp-lily-sees-rosie-kart', PREFIX);

  // 3. building paused: her park still goes through
  await game(lily, () => window.__game.debug.net.setRules({ build: 0 }));
  await until(rosie, () => window.__game.net.mayEdit('build') === false, null, 8000);
  await game(rosie, () => window.__game.debug.vehicles.park('button'));
  const nk = await until(lily, () => window.__game.debug.vehicles.list().some((v) => v.key === 'car_kart'), null, 10000);
  check(errors, nk, 'building paused: Rosie parks, the kart is back on Lily\'s page');
  await converge([lily, rosie], '3');
  check(errors, (await game(rosie, () => window.__game.debug.net.stats().resyncs || 0)) === resync0, 'no resyncs');
  await game(lily, () => window.__game.debug.net.setRules({ build: 1 }));
  await until(rosie, () => window.__game.net.mayEdit('build') === true, null, 8000);

  // 4. her drive ends without a park (a dropped page): within 12 s the kart is back
  const kart = await game(rosie, () => window.__game.debug.vehicles.list().find((v) => v.key === 'car_kart'));
  await game(rosie, (uid) => window.__game.debug.vehicles.drive(uid), kart.uid);
  await until(lily, (uid) => !window.__game.entities.byUid(uid), kart.uid, 10000);
  await game(rosie, () => window.__game.debug.vehicles.drop());
  const t4 = Date.now();
  const back4 = await until(lily, (uid) => !!window.__game.entities.byUid(uid), kart.uid, 20000, 250);
  check(errors, back4 && Date.now() - t4 < 16000, `a drive that ends without parking: the host puts the kart back (${((Date.now() - t4) / 1000).toFixed(1)} s)`);
  check(errors, await until(rosie, (uid) => !!window.__game.entities.byUid(uid), kart.uid, 10000), 'and Rosie sees it back too');
  check(errors, await until(lily, () => window.__toasts.some((t) => /Rosie's go-kart went back to its spot\./.test(t)), null, 3000), 'Lily hears "Rosie\'s go-kart went back to its spot."');
  await converge([lily, rosie], '4');

  // 7. Lily drives; June joins: her snapshot has no parked copy of Lily's car; Lily parks
  const june = await open({ key: 'june', name: 'June', uid: 'u-june', level: 'view', can: null, guest: true, viewport: { width: 390, height: 844 }, touch: true, seed: 47 });
  await game(lily, (uid) => window.__game.debug.vehicles.drive(uid), lc);
  await lily.page.waitForTimeout(500);
  await flows.guestTypesCode(june, code);
  await flows.hostLetsIn(lily, 'June');
  check(errors, await waitLive(june), 'June is in');
  await closePanels(lily);
  const jc = await game(june, (uid) => ({ copy: !!window.__game.entities.byUid(uid), vehicles: window.__game.debug.vehicles.list().length }), lc);
  check(errors, !jc.copy, `June's snapshot has no parked copy of the car Lily drives (${JSON.stringify(jc)})`);
  check(errors, await until(june, () => window.__game.debug.net.remote().some((r) => r.name === 'Lily' && r.vehicle === 'car_convertible'), null, 15000), 'June sees Lily in her convertible');
  await game(lily, () => window.__game.debug.vehicles.park('button'));
  check(errors, await until(june, (uid) => !!window.__game.entities.byUid(uid), lc, 10000) && await until(rosie, (uid) => !!window.__game.entities.byUid(uid), lc, 10000), 'Lily parks: it appears on every page');
  await converge([lily, rosie, june], '7');

  // 5. Rosie drives, Lily sends her home: the kart is back on Lily's page
  await game(rosie, (uid) => window.__game.debug.vehicles.drive(uid), kart.uid);
  await until(lily, (uid) => !window.__game.entities.byUid(uid), kart.uid, 10000);
  const rosiePeer = await game(rosie, () => window.__game.net.session.transport.selfId());
  await game(lily, (peer) => window.__game.debug.net.kick(peer), rosiePeer);
  check(errors, await until(lily, (uid) => !!window.__game.entities.byUid(uid), kart.uid, 10000), 'Rosie sent home while driving: her kart is back on Lily\'s page');
  await converge([lily, june], '5');

  // 8. the send budget (AT14 / AT15 style)
  const st = fc.stats();
  for (const pl of [lily, june]) {
    const s = await game(pl, () => window.__swFakeStats());
    check(errors, s.maxPerSec <= 80 && s.maxEmit <= 3900 && s.maxPresence <= 3900 && Object.keys(s.rejects).length === 0, `${pl.key}: at most ${s.maxPerSec} sends a second, largest emit ${s.maxEmit} B, presence ${s.maxPresence} B, no refusals`);
  }
  check(errors, st.filter((s) => s.label !== 'lily').every((s) => s.emits === 0), 'guest pages never emit');
  check(errors, hub.violations.length === 0, `no room rule broken (${JSON.stringify(hub.violations.slice(0, 2))})`);

  // 6. "Friends can change my things": June drives Lily's car; Lily's page reloads mid-drive
  await game(lily, () => window.__game.debug.net.setRules({ mine: 1 }));
  await until(june, () => window.__game.net.session.rules.mine === 1, null, 8000);
  await game(june, (uid) => window.__game.debug.vehicles.drive(uid), lc);
  check(errors, await until(lily, (uid) => !window.__game.entities.byUid(uid) && window.__game.net.session.hostCore.custody.size === 1, lc, 10000), 'June drives Lily\'s convertible (custody on the host)');
  const worldId = await game(lily, () => window.__game.world.meta.id);
  await lily.page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForTitle(lily.page, 180000);
  await setupPage(lily);
  await game(lily, (id) => window.__game.debug.loadWorld(id), worldId);
  await until(lily, () => window.__game.mode === 'play' && !window.__game.loading, null, 120000, 400);
  check(errors, await game(lily, (uid) => !!window.__game.entities.byUid(uid), lc), 'after Lily\'s page reloaded mid-drive, her world still has the convertible (custody in systems.vehicles)');
  for (const pl of [lily, rosie, june]) await pl.context.close();
  hub.close?.();
}

// =====================================================================================

const errors = [];
const browser = await launch({ headed: !!args.headed });
try {
  if (want('land')) await landPass(browser, errors);
  if (want('water')) await waterPass(browser, errors);
  if (want('touch')) await touchPass(browser, errors);
  if (want('models')) await modelsPass(browser, errors);
  if (want('save')) await savePass(browser, errors);
  if (want('mp')) await mpPass(browser, errors);
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
finish(errors);
