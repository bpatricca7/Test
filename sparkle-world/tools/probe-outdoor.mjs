// Outdoor probe (zip lines, treehouse parts, camping, salon chair), driven through the real
// UI where it matters: Bag -> Camping tab -> item -> a click on the ground places it; the HUD
// Hand button, then a click / tap on the piece uses it.
//
//   zip    meadow hills: two Zip Towers placed with the Bag + clicks on two hill tops, they
//          link; Hand-click a tower: climb, jump, zip across (mid-ride pictures), land on the
//          far deck; ride back; save + reload keeps the link; Remove + Undo unlink / relink
//   tree   two Tree Platforms on stilts (clicks), climb the rope ladder (Hand), a Rope Bridge
//          clicked across the gap, walk over it (W key), wobble it, Remove takes the whole
//          bridge and one Undo brings it back; a platform braced against a tree trunk
//   camp   a campsite at night (fire light, string lights), the marshmallow game (golden
//          and crispy), sleeping in the tent, the hammock, camp chair, picnic table, cooler
//   salon  the salon chair: she sits, spins, and the Dress-Up Studio opens on Hair
//   touch  iPad 1024x768: Bag Camping tab, place a camp fire, roast a marshmallow and zip,
//          all with taps
//
//   node tools/probe-outdoor.mjs [--only=zip,tree,camp,salon,touch] [--headed]

import { launch, openGame, startWorld, waitIdle, shot, settle, finish, screenPoint } from './smoke.mjs';

const PREFIX = 'outdoor';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : null;
const want = (name) => !only || only.includes(name);

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

const wait = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

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

/** Free camera for pictures: stop the rig and look from `from` at `to`. */
async function freeCam(page, from, to, fov = 60) {
  await page.evaluate(([from, to, fov]) => {
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
  }, [from, to, fov]);
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

async function picture(page, name, from, to, { wait: ms = 700, fov = 60 } = {}) {
  await cleanView(page, true);
  await freeCam(page, from, to, fov);
  await settle(page, ms);
  await shot(page, name, PREFIX);
  await freeCamOff(page);
  await cleanView(page, false);
}

/** Bag -> tab -> item (and its first color when a color step shows). */
async function fromBag(page, tab, item, { touch = false, color = 0 } = {}) {
  const press = (loc) => (touch ? loc.tap() : loc.click());
  await press(page.locator('.sw-bagbtn').first());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await press(page.locator('.sw-panel-wrap.sw-open .sw-tab2', { hasText: tab }).first());
  await settle(page, 250);
  await press(page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: item }).first());
  await settle(page, 300);
  const colorStep = await page.locator('.sw-panel-wrap.sw-open .sw-color-opt').count();
  if (colorStep) await press(page.locator('.sw-panel-wrap.sw-open .sw-color-opt').nth(color));
  // picking an item (or its color) closes the Bag by itself; close it only if it stays open
  const closed = await wait(page, () => !window.__game.ui.current, null, 2500).then(() => true, () => false);
  if (!closed) {
    await press(page.locator('.sw-panel-wrap.sw-open .sw-bag-close').first());
    await wait(page, () => !window.__game.ui.current, null, 10000);
  }
  // and the Build tool from the HUD, ready to place it
  if (await page.evaluate(() => window.__game.selectedTool !== 'build')) await useTool(page, 'Build', touch);
  return page.evaluate(() => window.__game.hotbar.slots[window.__game.hotbar.index]);
}

/** Stand near block (x, y, z), aim at its top face and click it with the current tool. */
async function clickBlockTop(page, x, y, z, { touch = false, from = null, pitch = 0.62, dist = 4.5 } = {}) {
  const pt = await page.evaluate(([x, y, z, from, pitch, dist]) => {
    const g = window.__game, w = g.world;
    const t = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    let px, pz;
    if (from) [px, pz] = from;
    else {
      // a free spot on the ground a few blocks away (the side with the lowest ground)
      let best = null;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const cx = Math.floor(t.x + Math.sin(ang) * dist), cz = Math.floor(t.z + Math.cos(ang) * dist);
        const h = w.heightAt(cx, cz);
        if (h < 0) continue;
        const score = Math.abs(h + 1 - (y + 1)) + (g.physics.bodyBlocked(cx + 0.5, h + 1.01, cz + 0.5, 0.3, 1.7) ? 99 : 0);
        if (!best || score < best.score) best = { cx, cz, h, score };
      }
      px = best.cx + 0.5;
      pz = best.cz + 0.5;
    }
    let gy = w.heightAt(Math.floor(px), Math.floor(pz)) + 1;
    if (Math.abs(gy - (y + 1)) > 1.2) {
      // no ground at that height nearby (a narrow peak): hover beside it instead
      gy = y + 2.5;
      g.player.setFlying(true);
      g.player.teleport(px, gy, pz);
      g.player.velocity.set(0, 0, 0);
    } else {
      if (g.player.flying) g.player.setFlying(false);
      g.player.teleport(px, gy + 0.01, pz);
    }
    const p = g.player.position;
    g.cameraRig.distance = 3.2;
    g.cameraRig.yaw = Math.atan2(t.x - p.x, t.z - p.z);
    g.cameraRig.pitch = pitch;
    g.cameraRig.snap();
    g.camera.updateMatrixWorld(true);
    if (!g.__tapRig) { g.__tapRig = g.cameraRig.update; g.cameraRig.update = () => {}; }
    const r = g.renderer.domElement.getBoundingClientRect();
    for (let i = 0; i < 24; i++) {
      const v = g.camera.position.clone().set(t.x, t.y, t.z).project(g.camera);
      const h = g.pick({ x: v.x, y: v.y });
      // the top face of the block, or a flower / grass tuft standing on it (Build replaces it)
      const onTop = h && h.type === 'block' && h.x === x && h.z === z &&
        ((h.y === y && h.face[1] === 1) || (h.y === y + 1 && g.registry.blocks.props.replaceable[h.id]));
      if (onTop) {
        const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
        if (document.elementFromPoint(sx, sy) === g.renderer.domElement) return { x: sx, y: sy };
      }
      g.cameraRig.pitch += i % 2 ? 0.05 : -0.08;
      g.cameraRig.snap();
      g.camera.updateMatrixWorld(true);
    }
    return null;
  }, [x, y, z, from, pitch, dist]);
  if (pt) {
    if (touch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
  }
  await settle(page, 80);
  await page.evaluate(() => { const g = window.__game; if (g.__tapRig) { g.cameraRig.update = g.__tapRig; g.__tapRig = null; } });
  await settle(page, 250);
  return !!pt;
}

/** Turn to an entity (optionally a model-space point on it) and click / tap it. */
async function tapEntity(page, uid, { touch = false, local = null, stand = null } = {}) {
  const pt = await page.evaluate(([uid, local, stand]) => {
    const g = window.__game, E = g.entities, e = E.byUid(uid);
    if (!e) return null;
    const t = local ? E.localToWorld(e, local[0], local[1], local[2]) : e.pickable.box.getCenter(g.camera.position.clone());
    if (stand === 'front') {
      // a few steps in front of it, on the ground
      const [w, , d] = e.def.size;
      const f = E.localToWorld(e, w / 2, 0, d + 2.6);
      const gy = g.world.heightAt(Math.floor(f.x), Math.floor(f.z)) + 1;
      if (g.player.flying) g.player.setFlying(false);
      g.player.teleport(f.x, gy + 0.01, f.z);
    } else if (stand) g.player.teleport(stand[0], stand[1], stand[2]);
    const p = g.player.position;
    const head = p.y + 1.6;
    g.cameraRig.distance = 3.4;
    g.cameraRig.yaw = Math.atan2(t.x - p.x, t.z - p.z);
    g.cameraRig.pitch = Math.max(-0.8, Math.min(1.2, Math.atan2(head - t.y, Math.hypot(t.x - p.x, t.z - p.z))));
    g.cameraRig.snap();
    g.camera.updateMatrixWorld(true);
    if (!g.__tapRig) { g.__tapRig = g.cameraRig.update; g.cameraRig.update = () => {}; }
    const r = g.renderer.domElement.getBoundingClientRect();
    const v = t.clone().project(g.camera);
    const nudges = [[0, 0], [0, 0.04], [0, -0.04], [0.04, 0], [-0.04, 0], [0, 0.09], [0, -0.09], [0.09, 0], [-0.09, 0], [0.15, 0.1], [-0.15, 0.1]];
    for (const [dx, dy] of nudges) {
      const ndc = { x: v.x + dx, y: v.y + dy };
      const h = g.pick(ndc);
      if (h && h.type === 'pickable' && h.pickable.ref && h.pickable.ref.uid === uid) {
        const sx = r.left + ((ndc.x + 1) / 2) * r.width, sy = r.top + ((1 - ndc.y) / 2) * r.height;
        if (document.elementFromPoint(sx, sy) !== g.renderer.domElement) continue;
        return { x: sx, y: sy };
      }
    }
    return null;
  }, [uid, local, stand]);
  if (pt) {
    if (touch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
  }
  await settle(page, 80);
  await page.evaluate(() => { const g = window.__game; if (g.__tapRig) { g.cameraRig.update = g.__tapRig; g.__tapRig = null; } });
  await settle(page, 200);
  return !!pt;
}

async function useTool(page, name, touch = false) {
  const b = page.locator('.sw-round', { hasText: name }).first();
  if (touch) await b.tap();
  else await b.click();
  await wait(page, (t) => window.__game.selectedTool === t, name.toLowerCase(), 5000);
}

const info = (page) => page.evaluate(() => {
  const g = window.__game, p = g.player;
  return { x: p.position.x, y: p.position.y, z: p.position.z, state: p.state, seat: p.seatEntity ? p.seatEntity.key : null, panel: g.ui.current };
});
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.sw-toast')].map((t) => t.textContent).join(' | '));

async function recordEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__probeEvents) return;
    g.__probeEvents = [];
    for (const name of ['zipline:ride', 'camp:marshmallow', 'player:sleep', 'entity:use', 'food:eat', 'sticker:earned']) {
      g.events.on(name, (payload) => g.__probeEvents.push({ name, key: payload && (payload.entity ? payload.entity.key : payload.sticker ? payload.sticker.id || payload.sticker : payload.result || null), from: payload && payload.from ? payload.from.uid : null, to: payload && payload.to ? payload.to.uid : null, result: payload && payload.result }));
    }
  });
}
const events = (page, name) => page.evaluate((name) => window.__game.__probeEvents.filter((e) => e.name === name), name);

async function newWorld(page, biome) {
  await page.evaluate((b) => window.__game.debug.newWorld({ biome: b }), biome);
  await wait(page, () => window.__game.mode === 'play' && !window.__game.loading, null, 120000);
  await waitIdle(page);
  await recordEvents(page);
}

// ---------------------------------------------------------------------------------------
// zip lines on hills
// ---------------------------------------------------------------------------------------

async function zipPass(browser, errors) {
  console.log('Zip lines: two towers on hills, zip across and back');
  const { context, page } = await openGame(browser, { errors, label: 'zip' });
  await newWorld(page, 'meadow');
  await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.4); });
  // two hill tops 18-30 blocks apart with room for a 2x2 tower
  const spots = await page.evaluate(() => {
    const g = window.__game, w = g.world, props = g.registry.blocks.props;
    const flat2 = (x, z) => {
      const h = w.heightAt(x, z);
      if (h < 1) return -1;
      for (const [dx, dz] of [[1, 0], [0, -1], [1, -1], [0, 1], [1, 1], [-1, 0], [-1, -1]]) if (w.heightAt(x + dx, z + dz) !== h) return -1;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = h + 1; y < h + 9; y++) {
        const id = w.get(x + dx, y, z + dz);
        if (id && !props.replaceable[id]) return -1;
      }
      const top = w.get(x, h, z);
      if (props.shape[top] === 5 /* liquid */) return -1;
      return h;
    };
    const cands = [];
    for (let x = 14; x < w.sx - 14; x += 2) for (let z = 14; z < w.sz - 14; z += 2) {
      const h = flat2(x, z);
      if (h > 0 && h > (w.waterLevel || 0) + 2) cands.push([x, h, z]);
    }
    cands.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < Math.min(cands.length, 60); i++) {
      const a = cands[i];
      for (let j = i + 1; j < cands.length; j++) {
        const b = cands[j];
        const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
        if (d >= 18 && d <= 30 && Math.abs(a[1] - b[1]) <= 6) return { a, b, n: cands.length };
      }
    }
    return { a: null, b: null, n: cands.length };
  });
  console.log(`  hill tops: ${JSON.stringify(spots)}`);
  check(errors, !!(spots.a && spots.b), 'found two hill tops for the towers');
  if (!spots.a) { await context.close(); return; }
  const key = await fromBag(page, 'Camping', 'Zip Line Tower');
  check(errors, key === 'furn:zipline_tower', `Bag -> Camping -> Zip Line Tower is in the hotbar (${key})`);
  await shot(page, 'zip-hotbar', PREFIX);
  const [ax, ay, az] = spots.a, [bx, by, bz] = spots.b;
  const okA = await clickBlockTop(page, ax, ay, az);
  if (process.env.PROBE_DEBUG) console.log('  debug', okA, await toasts(page), JSON.stringify(await info(page)));
  const tA = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'zipline_tower').map((e) => e.uid));
  check(errors, okA && tA.length === 1, `a click on the first hill top built a tower (${tA.length})`);
  const t1 = await toasts(page);
  const okB = await clickBlockTop(page, bx, by, bz);
  if (process.env.PROBE_DEBUG) console.log('  debug B', okB, await toasts(page), JSON.stringify(await info(page)), await page.evaluate(() => JSON.stringify(window.__game.debug.entities())));
  const towers = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'zipline_tower').map((e) => ({ uid: e.uid, x: e.x, y: e.y, z: e.z })));
  check(errors, okB && towers.length === 2, `a click on the second hill top built another tower (${towers.length})`);
  const links = await page.evaluate(() => window.__game.debug.outdoor.links());
  check(errors, links.length === 1, `the towers linked into a zip line (${links.length} link, ${links[0] ? links[0].len.toFixed(1) : '-'} blocks of cable)`);
  const t2 = await toasts(page);
  check(errors, /second Zip Tower/.test(t1) && /Zip line ready/.test(t2), `toasts guide her ("${t1}" then "${t2}")`);
  if (towers.length < 2 || !links.length) { await context.close(); return; }
  const [A, B] = towers;
  const mid = [(A.x + B.x) / 2, (A.y + B.y) / 2 + 4, (A.z + B.z) / 2];
  const side = [B.z - A.z, 0, A.x - B.x];
  const sl = Math.hypot(side[0], side[2]) || 1;
  await picture(page, 'zip-towers', [mid[0] + (side[0] / sl) * 26, mid[1] + 8, mid[2] + (side[2] / sl) * 26], mid, { fov: 55 });
  // ride: the Hand tool from the HUD, then a click on the first tower
  await useTool(page, 'Hand');
  const okTap = await tapEntity(page, A.uid, { local: [1, 1.6, 1], stand: 'front' });
  const r0 = await page.evaluate(() => window.__game.debug.outdoor.ride());
  check(errors, okTap && !!r0, `Hand-click on the tower starts the ride (${r0 && r0.phase})`);
  const phaseShot = async (phase, name) => {
    try {
      await wait(page, (ph) => { const r = window.__game.debug.outdoor.ride(); return !r || r.phase === ph; }, phase, 60000);
      const r = await page.evaluate(() => window.__game.debug.outdoor.ride());
      if (r && r.phase === phase) await shot(page, name, PREFIX);
    } catch (err) {
      errors.push('[check] ride never reached ' + phase);
    }
  };
  await phaseShot('climb', 'zip-1-climb');
  await phaseShot('grab', 'zip-2-grab');
  await wait(page, () => { const r = window.__game.debug.outdoor.ride(); return !r || (r.phase === 'zip' && r.s > r.len * 0.18); }, null, 90000);
  await shot(page, 'zip-3-zooming', PREFIX);
  await wait(page, () => { const r = window.__game.debug.outdoor.ride(); return !r || (r.phase === 'zip' && r.s > r.len * 0.45); }, null, 90000);
  // hold the ride still for close-ups from the side and the front
  const pose = await page.evaluate(() => {
    const g = window.__game;
    g.outdoor.zip.freeze = true;
    const p = g.player.position, r = g.outdoor.zip.ride;
    const yaw = r ? r.travelYaw : 0;
    const f = [Math.sin(yaw), Math.cos(yaw)], s = [Math.cos(yaw), -Math.sin(yaw)];
    const av = g.player.avatar;
    return { p: [p.x, p.y, p.z], f, s, arm: av ? av.bones.armL.rotation.z : 0 };
  });
  check(errors, pose.arm > 2.4, `she hangs with her arms up (left arm ${pose.arm.toFixed(2)} rad)`);
  const [px, py, pz] = pose.p;
  await picture(page, 'zip-4-side', [px + pose.s[0] * 3.6 - pose.f[0] * 0.6, py + 1.3, pz + pose.s[1] * 3.6 - pose.f[1] * 0.6], [px, py + 1.1, pz]);
  await picture(page, 'zip-5-front', [px + pose.f[0] * 3 + pose.s[0] * 1.2, py + 1.5, pz + pose.f[1] * 3 + pose.s[1] * 1.2], [px, py + 1.2, pz]);
  await picture(page, 'zip-6-wide', [px + pose.s[0] * 12, py + 4, pz + pose.s[1] * 12], [px, py, pz], { fov: 55 });
  await page.evaluate(() => { window.__game.outdoor.zip.freeze = false; });
  await wait(page, () => !window.__game.debug.outdoor.ride(), null, 120000);
  await settle(page, 500);
  await shot(page, 'zip-7-landed', PREFIX);
  const land = await page.evaluate((b) => {
    const g = window.__game, e = g.entities.byUid(b), p = g.player.position;
    const deck = e.y + 3;
    const c = g.entities.localToWorld(e, 1, 0, 1);
    return { state: g.player.state, dy: p.y - deck, dx: Math.abs(p.x - c.x), dz: Math.abs(p.z - c.z), stickers: Object.keys(g.profile.stickers || {}) };
  }, B.uid);
  check(errors, land.state === 'walk' && Math.abs(land.dy) < 0.3 && land.dx < 1 && land.dz < 1, `she landed softly on the far deck (${JSON.stringify(land)})`);
  const zev = await events(page, 'zipline:ride');
  check(errors, zev.length === 1 && zev[0].from === A.uid && zev[0].to === B.uid, `'zipline:ride' { from, to } fired (${JSON.stringify(zev)})`);
  check(errors, land.stickers.includes('zip_zoom'), 'the Zip Zoom! sticker was earned');
  // and back again from the far deck (the trolley is already there)
  await tapEntity(page, B.uid, { local: [1, 4.2, 1] });
  await wait(page, () => { const r = window.__game.debug.outdoor.ride(); return !!r && r.phase === 'zip'; }, null, 60000).catch(() => {});
  await wait(page, () => !window.__game.debug.outdoor.ride(), null, 120000);
  const back = await page.evaluate((a) => {
    const g = window.__game, e = g.entities.byUid(a), p = g.player.position;
    return { state: g.player.state, dy: p.y - (e.y + 3), rides: g.__probeEvents.filter((x) => x.name === 'zipline:ride').length };
  }, A.uid);
  check(errors, back.state === 'walk' && Math.abs(back.dy) < 0.3 && back.rides === 2, `zipped back to the first tower (${JSON.stringify(back)})`);
  // saved with the world
  await page.evaluate(() => window.__game.debug.save());
  const id = await page.evaluate(() => window.__game.world.meta.id);
  await page.evaluate(() => window.__game.debug.exitToTitle());
  await page.evaluate((id) => window.__game.debug.loadWorld(id), id);
  await wait(page, () => window.__game.mode === 'play' && !window.__game.loading, null, 120000);
  await waitIdle(page);
  const reloaded = await page.evaluate(() => window.__game.debug.outdoor.links());
  check(errors, reloaded.length === 1, `the zip line is still there after save + reload (${reloaded.length})`);
  // Remove tool on a tower unlinks it; one Undo brings tower and cable back
  await useTool(page, 'Remove');
  const towerB = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'zipline_tower').map((e) => e.uid));
  await tapEntity(page, towerB[1], { local: [1, 1.6, 1], stand: 'front' });
  const afterRemove = await page.evaluate(() => ({ towers: window.__game.entities.all().filter((e) => e.key === 'zipline_tower').length, links: window.__game.debug.outdoor.links().length }));
  await page.locator('.sw-round', { hasText: 'Undo' }).first().click().catch(async () => page.evaluate(() => window.__game.undo()));
  await settle(page, 400);
  const afterUndo = await page.evaluate(() => ({ towers: window.__game.entities.all().filter((e) => e.key === 'zipline_tower').length, links: window.__game.debug.outdoor.links().length }));
  check(errors, afterRemove.towers === 1 && afterRemove.links === 0 && afterUndo.towers === 2 && afterUndo.links === 1, `Remove unlinks, Undo relinks (${JSON.stringify({ afterRemove, afterUndo })})`);
  await context.close();
}

// ---------------------------------------------------------------------------------------
// tree platforms and a rope bridge
// ---------------------------------------------------------------------------------------

async function treePass(browser, errors) {
  console.log('Tree platforms + rope bridge');
  const { context, page } = await openGame(browser, { errors, label: 'tree' });
  await newWorld(page, 'flat');
  const G = await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.42); return g.world.heightAt(40, 40); });
  const X = 40;
  await fromBag(page, 'Camping', 'Tree Platform');
  // platform A: clicked from the south, so it faces south with its ladder
  await clickBlockTop(page, X, G, 36, { from: [X + 0.5, 41.5] });
  // platform B: clicked from the north, 5 blocks further north (a 5-block gap)
  await clickBlockTop(page, X - 1, G, 28, { from: [X - 0.5, 22.5] });
  const plats = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'tree_platform').map((e) => ({ uid: e.uid, x: e.x, y: e.y, z: e.z, rot: e.rot, data: e.data })));
  check(errors, plats.length === 2 && plats.every((p) => p.y === plats[0].y && p.data.ladder >= 3), `two platforms on stilts, 3 blocks up, with rope ladders (${JSON.stringify(plats.map((p) => [p.x, p.y, p.z, p.rot]))})`);
  if (plats.length < 2) { await context.close(); return; }
  const [A, B] = plats;
  // climb A's rope ladder with the Hand tool
  await useTool(page, 'Hand');
  const climbTap = await tapEntity(page, A.uid, { local: [1.5, 0.2, 3.0], stand: [A.x + 0.5, G + 1.01, A.z + 3.5] });
  if (process.env.PROBE_DEBUG) console.log('  debug climb', climbTap, JSON.stringify(await info(page)), await toasts(page), await page.evaluate(() => JSON.stringify(window.__game.outdoor.ladders.auto && window.__game.outdoor.ladders.auto.e.uid)));
  await wait(page, (a) => { const g = window.__game, p = g.player.position; return Math.abs(p.y - (a.y + 1)) < 0.2 && g.player.onGround && g.outdoor.ladders.onDeck(g.entities.byUid(a.uid), p); }, A, 30000).catch(() => {});
  const up = await info(page);
  check(errors, Math.abs(up.y - (A.y + 1)) < 0.25, `she climbed the rope ladder onto the deck (y ${up.y.toFixed(2)}, deck ${A.y + 1})`);
  await shot(page, 'tree-1-on-deck', PREFIX);
  // the rope bridge: click the deck's far edge (toward B)
  await fromBag(page, 'Camping', 'Rope Bridge');
  // stand near the back of the deck, facing the other platform, and click the deck edge
  const standAt = await page.evaluate(([a]) => { const E = window.__game.entities; const t = E.localToWorld(E.byUid(a.uid), 1.5, 1.02, 1.6); return [t.x, t.y, t.z]; }, [A]);
  const bridgeOk = await tapEntity(page, A.uid, { local: [1.5, 1.0, 0.35], stand: standAt });
  await settle(page, 700);
  const segs = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'rope_bridge').map((e) => ({ uid: e.uid, x: e.x, y: e.y, z: e.z, i: e.data.i, n: e.data.n })));
  check(errors, segs.length >= 3 && segs.every((s) => s.n === segs.length), `a click across the gap stretched a rope bridge (${segs.length} cells)`);
  const opens = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'tree_platform').map((e) => e.data.open));
  check(errors, opens.every((o) => (o & ~2) !== 0), `both railings opened where the bridge meets them (${opens})`);
  if (segs.length < 3) { await context.close(); return; }
  const minZ = Math.min(A.z, B.z) - 3, maxZ = Math.max(A.z, B.z);
  await picture(page, 'tree-2-bridge', [X + 9, A.y + 5, (minZ + maxZ) / 2 + 5], [X, A.y + 0.5, (minZ + maxZ) / 2], { fov: 55 });
  // walk across with the keyboard
  await page.evaluate(([a]) => {
    const g = window.__game, E = g.entities, e = E.byUid(a.uid);
    const t = E.localToWorld(e, 1.5, 1.0, 0.7);
    g.player.teleport(t.x, a.y + 1.02, t.z);
    g.cameraRig.yaw = Math.PI;
    g.cameraRig.pitch = 0.35;
    g.cameraRig.distance = 4.5;
    g.cameraRig.snap();
  }, [A]);
  await settle(page, 300);
  await page.keyboard.down('KeyW');
  let midShot = false, swayed = 0;
  try {
    for (let i = 0; i < 300; i++) {
      await settle(page, 100);
      const s = await page.evaluate((b) => { const g = window.__game; const p = g.player.position; const e = g.entities.at(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z)); const B = g.entities.byUid(b); const l = g.outdoor.ladders; return { z: p.z, y: p.y, on: e ? e.key : null, bounce: g.outdoor.bridges.bounce, onB: e === B && l.onDeck(B, p) }; }, B.uid);
      if (s.on === 'rope_bridge') swayed = Math.max(swayed, s.bounce);
      if (s.on === 'rope_bridge' && !midShot) { midShot = true; await shot(page, 'tree-3-crossing', PREFIX); }
      if (s.onB) break;
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  const across = await info(page);
  const onB = await page.evaluate((b) => { const g = window.__game; return g.outdoor.ladders.onDeck(g.entities.byUid(b), g.player.position); }, B.uid);
  check(errors, onB && Math.abs(across.y - (B.y + 1)) < 0.3, `she walked over the bridge onto the other platform (z ${across.z.toFixed(1)}, y ${across.y.toFixed(2)})`);
  check(errors, swayed > 0.2, `the bridge bounced under her feet (${swayed.toFixed(2)})`);
  // wobble it with the Hand tool, then Remove takes the whole bridge and Undo brings it back
  await useTool(page, 'Hand');
  await tapEntity(page, segs[0].uid);
  const wob = await page.evaluate(() => window.__game.outdoor.bridges.bounce);
  check(errors, wob > 0.5, `Hand-tap wobbles the bridge (${wob.toFixed(2)})`);
  await useTool(page, 'Remove');
  await tapEntity(page, segs[0].uid);
  const left = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'rope_bridge').length);
  await page.locator('.sw-round', { hasText: 'Undo' }).first().click().catch(() => page.evaluate(() => window.__game.undo()));
  await settle(page, 400);
  const back = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'rope_bridge').length);
  check(errors, left === 0 && back === segs.length, `Remove took the whole bridge (${left} left), one Undo brought all ${back} cells back`);
  // a platform braced against a tree trunk
  const trunk = await page.evaluate((G) => {
    const g = window.__game, w = g.world, id = g.registry.blocks.idOf('log_oak'), leaves = g.registry.blocks.idOf('leaves_cherry');
    const x = 56, z = 40;
    w.batch(() => {
      for (let y = G + 1; y <= G + 7; y++) w.set(x, y, z, id, { record: false });
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = G + 7; y <= G + 8; y++) if (dx || dz || y > G + 7) w.set(x + dx, y, z + dz, leaves, { record: false });
    });
    return [x, z];
  }, G);
  await waitIdle(page);
  await fromBag(page, 'Camping', 'Tree Platform');
  await page.evaluate(([x, z, G]) => {
    const g = window.__game;
    g.player.teleport(x + 0.5, G + 1.01, z + 4.5);
    g.cameraRig.yaw = Math.PI;
    g.cameraRig.distance = 3;
    g.cameraRig.pitch = -0.35;
    g.cameraRig.snap();
  }, [trunk[0], trunk[1], G]);
  await settle(page, 300);
  const tp = await screenPoint(page, trunk[0] + 0.5, G + 4.5, trunk[1] + 1.0);
  if (process.env.PROBE_DEBUG) console.log('  debug trunk', JSON.stringify(tp), JSON.stringify(await page.evaluate(([x, y, z]) => { const g = window.__game; const v = g.camera.position.clone().set(x, y, z).project(g.camera); const h = g.pick({ x: v.x, y: v.y }); return h && { type: h.type, x: h.x, y: h.y, z: h.z, face: h.face, key: h.key || (h.pickable && h.pickable.ref && h.pickable.ref.key) }; }, [trunk[0] + 0.5, G + 4.5, trunk[1] + 1.0])));
  if (tp) await page.mouse.click(tp.x, tp.y);
  await settle(page, 600);
  if (process.env.PROBE_DEBUG) console.log('  debug trunk toasts', await toasts(page), await page.evaluate(() => window.__game.selectedTool));
  const braced = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'tree_platform' && !(e.data.legs > 0)).map((e) => ({ y: e.y, data: e.data })));
  check(errors, braced.length === 1 && braced[0].data.ladder > 1, `a click on a trunk braced a platform against it (${JSON.stringify(braced)})`);
  await picture(page, 'tree-4-braced', [trunk[0] + 7, G + 6, trunk[1] + 8], [trunk[0], G + 4, trunk[1] + 1.5], { fov: 55 });
  await context.close();
}

// ---------------------------------------------------------------------------------------
// a campsite at night
// ---------------------------------------------------------------------------------------

async function campPass(browser, errors) {
  console.log('Campsite at night: fire, lights, tent, marshmallows, hammock, chairs, cooler');
  const { context, page } = await openGame(browser, { errors, label: 'camp' });
  await newWorld(page, 'flat');
  const G = await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.42); return g.world.heightAt(40, 40); });
  // tent and camp fire through the Bag and clicks
  await fromBag(page, 'Camping', 'Camping Tent');
  await clickBlockTop(page, 40, G, 38, { from: [40.5, 44.5] });
  await fromBag(page, 'Camping', 'Camp Fire');
  await clickBlockTop(page, 40, G, 42, { from: [40.5, 46.5] });
  const placed = await page.evaluate(() => window.__game.entities.all().map((e) => e.key));
  check(errors, placed.includes('tent') && placed.includes('campfire'), `tent and camp fire placed with clicks (${placed.join(', ')})`);
  // the rest of the campsite
  const ids = await page.evaluate((G) => {
    const g = window.__game, E = g.entities;
    const put = (key, x, z, rot, color) => { const e = E.place(key, x, G + 1, z, rot, color, {}, { history: false, fx: false }); return e ? e.uid : null; };
    return {
      chair1: put('camp_chair', 38, 43, 1, '#FF9CCB'),
      chair2: put('camp_chair', 42, 43, 3, '#A6D8FF'),
      lights: put('string_lights', 44, 38, 0, '#FFFFFF'),
      lights2: put('string_lights', 36, 38, 0, '#FFD1E6'),
      picnic: put('picnic_table', 45, 43, 3, '#FF9CCB'),
      cooler: put('cooler', 43, 45, 0),
      hammock: put('hammock', 35, 44, 0, '#C8B4FF'),
      bunk: put('camper_bunk', 48, 38, 0, '#C8B4FF'),
    };
  }, G);
  check(errors, Object.values(ids).every(Boolean), 'placed chairs, string lights, picnic table, cooler, hammock and a camper bunk');
  const fire = await page.evaluate(() => window.__game.entities.all().find((e) => e.key === 'campfire').uid);
  const tent = await page.evaluate(() => window.__game.entities.all().find((e) => e.key === 'tent').uid);
  await picture(page, 'camp-1-day', [40, G + 6, 53], [41, G + 1, 41], { fov: 55 });
  // night: fire light, glowing string lights
  await page.evaluate(() => window.__game.setDayTime(0.9));
  await settle(page, 600);
  const night = await page.evaluate(() => {
    const g = window.__game;
    const lit = g.entities.lights.filter((l) => l.intensity > 0).length;
    const e = g.entities.all().find((x) => x.key === 'campfire');
    const bl = g.world.getBlockLight ? g.world.getBlockLight(e.x, e.y, e.z) : -1;
    return { lit, bl, scale: e.lightScale };
  });
  check(errors, night.lit >= 1 && (night.bl < 0 || night.bl >= 12), `the camp fire lights the night (point lights ${night.lit}, block light ${night.bl}, flicker ${night.scale && night.scale.toFixed(2)})`);
  await picture(page, 'camp-2-night', [40, G + 5, 52], [41, G + 1, 41], { fov: 55, wait: 900 });
  await picture(page, 'camp-3-fire', [41.8, G + 2.2, 45], [40.5, G + 1.3, 42.3], { fov: 50 });
  // the marshmallow game: Hand-click the fire, Roast!, pull it out when golden
  await useTool(page, 'Hand');
  await tapEntity(page, fire, { stand: [40.5, G + 1.01, 44.6] });
  await wait(page, () => window.__game.ui.current === 'marshmallow', null, 8000).catch(() => {});
  check(errors, (await info(page)).panel === 'marshmallow', 'Hand-click on the camp fire opens the marshmallow game');
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Roast' }).click();
  await wait(page, () => window.__game.marshmallow.state.level > 0.62, null, 30000);
  await shot(page, 'camp-4-roasting', PREFIX);
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Pull out' }).click();
  await settle(page, 1600);
  const gold = await page.evaluate(() => window.__game.marshmallow.state);
  check(errors, gold.result === 'golden', `pulled out while golden: "${gold.result}"`);
  await shot(page, 'camp-5-golden', PREFIX);
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Save it' }).click();
  await settle(page, 400);
  const basket = await page.evaluate(() => (window.__game.profile.basket || {}).smores || 0);
  check(errors, basket === 1, `the s'more went into the basket (${basket})`);
  // a crispy one
  await tapEntity(page, fire, { stand: [40.5, G + 1.01, 44.6] });
  await wait(page, () => window.__game.ui.current === 'marshmallow', null, 8000).catch(() => {});
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Roast' }).click();
  await wait(page, () => window.__game.marshmallow.state.level > 0.95, null, 40000);
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Pull out' }).click();
  await settle(page, 1200);
  const crispy = await page.evaluate(() => window.__game.marshmallow.state);
  const msg = await page.locator('.od-mm-msg').textContent();
  check(errors, crispy.result === 'crispy' && /Crispy/.test(msg), `a burnt one is "crispy! still yummy" (${crispy.result}: ${msg})`);
  await shot(page, 'camp-6-crispy', PREFIX);
  await page.locator('.od-mm-btns .sw-btn', { hasText: 'Eat it' }).click();
  await settle(page, 400);
  const mev = await events(page, 'camp:marshmallow');
  check(errors, mev.length === 2 && mev[0].result === 'golden' && mev[1].result === 'crispy', `'camp:marshmallow' fired twice (${mev.map((e) => e.result)})`);
  const stickers = await page.evaluate(() => Object.keys(window.__game.profile.stickers || {}));
  check(errors, stickers.includes('smores_star'), "the S'mores Star sticker for a golden marshmallow");
  // the hammock: lie down and swing (no 'player:sleep': it is a rest, not bedtime)
  const sleepsBefore = (await events(page, 'player:sleep')).length;
  await tapEntity(page, ids.hammock, { local: [1.5, 0.7, 0.5], stand: [36.5, G + 1.01, 46.5] });
  await settle(page, 1500);
  const ham = await page.evaluate(() => { const g = window.__game, p = g.player; return { state: p.state, seat: p.seatEntity && p.seatEntity.key, roll: p.avatar.group.rotation.z }; });
  check(errors, ham.state === 'sleep' && ham.seat === 'hammock' && (await events(page, 'player:sleep')).length === sleepsBefore, `she lies in the hammock (${JSON.stringify(ham)})`);
  await picture(page, 'camp-7-hammock', [36.5, G + 2.6, 47.5], [36.5, G + 1.4, 44.5], { fov: 55 });
  await page.evaluate(() => window.__game.player.stand());
  // camp chair and picnic table
  await tapEntity(page, ids.chair2, { stand: [42.5, G + 1.01, 45.5] });
  let st = await info(page);
  check(errors, st.state === 'sit' && st.seat === 'camp_chair', `she sits in the camp chair (${st.state} ${st.seat})`);
  await page.evaluate(() => window.__game.player.stand());
  await tapEntity(page, ids.picnic, { stand: [48.5, G + 1.01, 44.5] });
  st = await info(page);
  check(errors, st.state === 'sit' && st.seat === 'picnic_table', `she sits at the picnic table (${st.state} ${st.seat})`);
  await page.evaluate(() => window.__game.player.stand());
  // the cooler: a juice box pops out
  await tapEntity(page, ids.cooler, { stand: [43.5, G + 1.01, 47.5] });
  await settle(page, 700);
  await shot(page, 'camp-8-cooler', PREFIX);
  await wait(page, () => [...document.querySelectorAll('.sw-toast')].some((t) => /juice/.test(t.textContent)), null, 20000).catch(() => {});
  check(errors, /juice/.test(await toasts(page)), `a juice box popped out of the cooler ("${await toasts(page)}")`);
  // string lights turn off and on
  const on0 = await page.evaluate((u) => window.__game.entities.byUid(u).data.on, ids.lights);
  await tapEntity(page, ids.lights, { local: [1.5, 1.4, 0.5], stand: [45.5, G + 1.01, 41.5] });
  const on1 = await page.evaluate((u) => window.__game.entities.byUid(u).data.on, ids.lights);
  await tapEntity(page, ids.lights, { local: [1.5, 1.4, 0.5] });
  const on2 = await page.evaluate((u) => window.__game.entities.byUid(u).data.on, ids.lights);
  check(errors, on0 !== false && on1 === false && on2 === true, `string lights switch off and on (${on0} ${on1} ${on2})`);
  // sleep in the tent: dreamy night, morning, Happy Camper sticker
  await tapEntity(page, tent, { stand: [40.5, G + 1.01, 40.6] });
  st = await info(page);
  check(errors, st.state === 'sleep' && st.seat === 'tent', `she sleeps in the tent (${st.state} ${st.seat})`);
  await wait(page, () => window.__game.time.dayTime > 0.2 && window.__game.time.dayTime < 0.4, null, 20000).catch(() => {});
  await settle(page, 2000);
  const morning = await page.evaluate(() => ({ t: window.__game.time.dayTime, stickers: Object.keys(window.__game.profile.stickers || {}) }));
  check(errors, morning.stickers.includes('happy_camper'), `morning in the tent, Happy Camper sticker (${morning.t.toFixed(2)})`);
  await picture(page, 'camp-9-tent-morning', [40.5, G + 2.0, 42.8], [40.5, G + 1.3, 38.7], { fov: 60 });
  await context.close();
}

// ---------------------------------------------------------------------------------------
// the salon chair
// ---------------------------------------------------------------------------------------

async function salonPass(browser, errors) {
  console.log('Salon chair: sit, spin, the Dress-Up Studio opens on Hair');
  const { context, page } = await openGame(browser, { errors, label: 'salon' });
  await newWorld(page, 'flat');
  const G = await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.42); return g.world.heightAt(40, 40); });
  const key = await fromBag(page, 'Bedroom', 'Salon Chair');
  check(errors, key === 'furn:salon_chair', `Bag -> Bedroom -> Salon Chair (${key})`);
  await clickBlockTop(page, 40, G, 38, { from: [40.5, 43.5] });
  const uid = await page.evaluate(() => { const e = window.__game.entities.all().find((x) => x.key === 'salon_chair'); return e ? e.uid : null; });
  check(errors, !!uid, 'a click placed the salon chair');
  if (!uid) { await context.close(); return; }
  await picture(page, 'salon-1-chair', [42.5, G + 2.5, 42.5], [40.5, G + 1.1, 38.5], { fov: 55 });
  await useTool(page, 'Hand');
  await tapEntity(page, uid, { local: [0.5, 0.8, 1.4], stand: [40.5, G + 1.01, 41.5] });
  await settle(page, 400);
  const sat = await info(page);
  check(errors, sat.state === 'sit' && sat.seat === 'salon_chair', `she sits in the salon chair (${sat.state})`);
  await shot(page, 'salon-2-spin', PREFIX);
  await wait(page, () => window.__game.ui.current === 'dressup', null, 20000).catch(() => {});
  await settle(page, 1200);
  const studio = await page.evaluate(() => ({ panel: window.__game.ui.current, tab: window.__game.dressup && window.__game.dressup.tab }));
  check(errors, studio.panel === 'dressup' && studio.tab === 'hair', `the Dress-Up Studio opened on the Hair tab (${JSON.stringify(studio)})`);
  await shot(page, 'salon-3-hair', PREFIX);
  await page.keyboard.press('Escape');
  await wait(page, () => !window.__game.ui.current, null, 10000).catch(() => {});
  await settle(page, 800);
  const after = await info(page);
  check(errors, after.state === 'sit' && after.seat === 'salon_chair', 'back in the salon chair after the Studio closes');
  await shot(page, 'salon-4-back', PREFIX);
  await context.close();
}

// ---------------------------------------------------------------------------------------
// iPad
// ---------------------------------------------------------------------------------------

async function touchPass(browser, errors) {
  console.log('iPad pass (1024x768 touch): Camping tab, camp fire, marshmallow, zip line');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'ipad' });
  await startWorld(page, 'flat', { tap: true });
  await recordEvents(page);
  const G = await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.42); return g.world.heightAt(40, 40); });
  // the Camping tab
  await page.locator('.sw-bagbtn').first().tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await page.locator('.sw-panel-wrap.sw-open .sw-tab2', { hasText: 'Camping' }).first().tap();
  await wait(page, () => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item img')].filter((i) => i.src).length >= 11, null, 30000).catch(() => {});
  await settle(page, 500);
  await shot(page, 'ipad-1-bag-camping', PREFIX);
  const names = await page.evaluate(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item')].map((c) => c.textContent.trim()));
  check(errors, ['Camping Tent', 'Camp Fire', 'Zip Line Tower', 'Tree Platform', 'Rope Bridge', 'Hammock', 'Cooler'].every((n) => names.some((x) => x.includes(n))), `Camping tab lists the gear (${names.join(', ')})`);
  await page.locator('.sw-panel-wrap.sw-open .sw-bag-close').first().tap();
  await wait(page, () => !window.__game.ui.current, null, 10000);
  await fromBag(page, 'Camping', 'Camp Fire', { touch: true, color: 1 });
  await clickBlockTop(page, 40, G, 40, { touch: true, from: [40.5, 44.5] });
  const fire = await page.evaluate(() => { const e = window.__game.entities.all().find((x) => x.key === 'campfire'); return e ? e.uid : null; });
  check(errors, !!fire, 'a tap placed the camp fire');
  if (fire) {
    await useTool(page, 'Hand', true);
    await tapEntity(page, fire, { touch: true, stand: [40.5, G + 1.01, 42.8] });
    await wait(page, () => window.__game.ui.current === 'marshmallow', null, 8000).catch(() => {});
    check(errors, (await info(page)).panel === 'marshmallow', 'a tap on the fire opens the marshmallow game');
    await page.locator('.od-mm-btns .sw-btn', { hasText: 'Roast' }).tap();
    await wait(page, () => window.__game.marshmallow.state.level > 0.6, null, 30000);
    await page.locator('.od-mm-btns .sw-btn', { hasText: 'Pull out' }).tap();
    await settle(page, 1400);
    await shot(page, 'ipad-2-marshmallow', PREFIX);
    const res = await page.evaluate(() => window.__game.marshmallow.state.result);
    check(errors, res === 'golden', `tapped "Pull out!" at golden (${res})`);
    await page.locator('.od-mm-btns .sw-btn', { hasText: 'Eat it' }).tap();
    await wait(page, () => !window.__game.ui.current, null, 5000).catch(() => {});
  }
  // zip line with a tap
  const t = await page.evaluate((G) => {
    const g = window.__game, E = g.entities;
    const a = E.place('zipline_tower', 30, G + 1, 50, 0, '#C8B4FF', {}, { history: true });
    const b = E.place('zipline_tower', 30, G + 1, 70, 2, '#FFE38F', {}, { history: true });
    return [a && a.uid, b && b.uid];
  }, G);
  await tapEntity(page, t[0], { touch: true, local: [1, 1.2, 1], stand: [31, G + 1.01, 53.5] });
  const started = await page.evaluate(() => !!window.__game.debug.outdoor.ride());
  check(errors, started, 'a tap on the tower starts the zip ride');
  await wait(page, () => { const r = window.__game.debug.outdoor.ride(); return !r || (r.phase === 'zip' && r.s > r.len * 0.4); }, null, 90000).catch(() => {});
  await shot(page, 'ipad-3-zip', PREFIX);
  await wait(page, () => !window.__game.debug.outdoor.ride(), null, 120000).catch(() => {});
  const done = await page.evaluate((b) => { const g = window.__game, e = g.entities.byUid(b); return { state: g.player.state, dy: g.player.position.y - (e.y + 3) }; }, t[1]);
  check(errors, done.state === 'walk' && Math.abs(done.dy) < 0.3, `landed on the far tower on the iPad (${JSON.stringify(done)})`);
  await context.close();
}

async function main() {
  const errors = [];
  const browser = await launch({ headed: 'headed' in args });
  try {
    if (want('zip')) await zipPass(browser, errors);
    if (want('tree')) await treePass(browser, errors);
    if (want('camp')) await campPass(browser, errors);
    if (want('salon')) await salonPass(browser, errors);
    if (want('touch')) await touchPass(browser, errors);
  } catch (err) {
    errors.push('[probe] ' + (err && err.stack ? err.stack : err));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
