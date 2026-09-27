// Furniture & home life probe: builds a furnished dollhouse (bedroom, living room, kitchen,
// bathroom) in a flat world, screenshots it by day and by night with the lamps on, lays out
// a showroom of every piece, and exercises the actions through real clicks and taps:
// doors, lamps, piano, storybook, TV, sleeping in the canopy and bunk beds, walking up
// stairs, climbing ladders, bouncing on the trampoline, swinging, sliding, painting...
//
// Also: an iPad and a phone pass (Bag, colors, taps, piano), and a candle and a cupcake put
// on the top of every piece that declares a surface (coffee table, piano, fireplace mantel...).
//
//   node tools/probe-furniture.mjs [--only=showroom|house|actions|touch|tops] [--headed]

import { launch, openGame, startWorld, waitIdle, shot, settle, finish, screenPoint } from './smoke.mjs';

const PREFIX = 'furniture';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only || null;

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

/** Free camera for screenshots: stop the rig and look from `from` at `to`. */
async function camera(page, from, to, fov = 60) {
  await page.evaluate(([from, to, fov]) => {
    const g = window.__game;
    if (!g.__rigUpdate) g.__rigUpdate = g.cameraRig.update.bind(g.cameraRig);
    g.cameraRig.update = () => {};
    g.camera.position.set(...from);
    g.camera.fov = fov;
    g.camera.updateProjectionMatrix();
    g.camera.lookAt(...to);
  }, [from, to, fov]);
}

async function freeCameraOff(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__rigUpdate) g.cameraRig.update = g.__rigUpdate;
    g.__rigUpdate = null;
    g.camera.fov = 70;
    g.camera.updateProjectionMatrix();
    g.cameraRig.snap();
  });
}

async function cleanView(page, on) {
  await page.evaluate((on) => {
    let s = document.getElementById('probe-clean');
    if (on && !s) {
      s = document.createElement('style');
      s.id = 'probe-clean';
      s.textContent = '.sw-hud, .sw-toasts, .sw-hint { display: none !important; }';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  }, on);
}

async function place(page, key, x, y, z, rot = 0, color = null, data = {}) {
  return page.evaluate(([key, x, y, z, rot, color, data]) => {
    const e = window.__game.entities.place(key, x, y, z, rot, color, data, { history: false, fx: false });
    return e ? e.uid : null;
  }, [key, x, y, z, rot, color, data]);
}

async function fill(page, x0, y0, z0, x1, y1, z1, key) {
  return page.evaluate(([x0, y0, z0, x1, y1, z1, key]) => {
    const g = window.__game, w = g.world;
    const id = g.registry.blocks.idOf(key);
    if (id < 0) return 0;
    let n = 0;
    w.batch(() => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { w.set(x, y, z, id, { record: false }); n++; }
    });
    return n;
  }, [x0, y0, z0, x1, y1, z1, key]);
}

async function setup(page) {
  await startWorld(page, 'flat');
  await page.evaluate(() => {
    const g = window.__game;
    g.profile.settings.timeFrozen = true;
    g.setDayTime(0.42);
  });
  await settle(page, 400);
}

// ---------------- showroom ----------------

async function showroom(page, errors) {
  console.log('Showroom: every piece');
  const G = 17;
  const layout = await page.evaluate((G) => {
    const g = window.__game;
    const cats = ['bedroom', 'living', 'lights', 'kitchen', 'bathroom', 'building', 'garden', 'fun'];
    const defs = [...g.registry.furniture.values()];
    const rows = [];
    let z = 30;
    const placed = [];
    const failed = [];
    for (const cat of cats) {
      const list = defs.filter((d) => d.category === cat);
      let x = 30;
      let depth = 1;
      for (const d of list) {
        const [w, h, dd] = d.size;
        const ax = x + Math.floor((w - 1) / 2);
        const az = z + dd - 1;
        let ay = G;
        let e = null;
        if (d.placeOn === 'ceiling') {
          // a little ceiling beam to hang from
          const id = g.registry.blocks.idOf('planks_white');
          g.world.set(ax, G + 2, az, id, { record: false });
          ay = G + 1;
        } else if (d.placeOn === 'wall') {
          const id = g.registry.blocks.idOf('planks_pink');
          for (let yy = G; yy < G + h + 1; yy++) g.world.set(ax, yy, az - 1, id, { record: false });
          ay = d.key === 'mirror' || d.key === 'ladder' || d.key === 'tree_house_ladder' ? G : G + 1;
          if (d.key === 'window_frame' || d.key === 'flower_box' || d.key === 'towel_rack' || d.key === 'picture_frame' || d.key === 'clock') ay = G;
        }
        e = g.entities.place(d.key, ax, ay, az, 0, null, {}, { history: false, fx: false, force: false });
        if (!e) failed.push(d.key);
        else placed.push({ key: d.key, x: ax, z: az, w, h, d: dd, x0: x });
        x += w + 1;
        depth = Math.max(depth, dd);
      }
      rows.push({ cat, z, depth, xEnd: x });
      z += depth + 8;
    }
    return { rows, placed, failed };
  }, G);
  check(errors, layout.failed.length === 0, `placed ${layout.placed.length} pieces in the showroom${layout.failed.length ? ' (failed: ' + layout.failed.join(', ') + ')' : ''}`);
  await page.evaluate(() => window.__game.player.teleport(20, 18, 20));
  await waitIdle(page);
  await cleanView(page, true);
  const xMax = Math.max(...layout.rows.map((r) => r.xEnd));
  const zEnd = layout.rows[layout.rows.length - 1].z + 3;
  const cx = (30 + xMax) / 2, cz = (30 + zEnd) / 2;
  await camera(page, [cx, 52, zEnd + 20], [cx, 17, cz + 1], 55);
  await settle(page, 900);
  await shot(page, 'showroom-all', PREFIX);
  // close-ups: a few pieces at a time
  for (const r of layout.rows) {
    const items = layout.placed.filter((p) => r.z <= p.z && p.z < r.z + r.depth + 1);
    let group = [];
    let n = 0;
    const flush = async () => {
      if (!group.length) return;
      const x0 = group[0].x0, x1 = group[group.length - 1].x0 + group[group.length - 1].w;
      const gx = (x0 + x1) / 2;
      const span = Math.max(4, x1 - x0);
      const tall = Math.max(...group.map((p) => p.h));
      const dist = Math.min(6.5, span * 0.62 + 1.5);
      await camera(page, [gx, G + tall * 0.6 + dist * 0.45, r.z + r.depth + dist * 0.8], [gx, G + tall * 0.35, r.z + r.depth / 2], 55);
      await settle(page, 350);
      await shot(page, `showroom-${r.cat}-${++n}`, PREFIX);
      group = [];
    };
    for (const it of items) {
      group.push(it);
      const width = it.x0 + it.w - group[0].x0;
      if (group.length >= 5 || width >= 9) await flush();
    }
    await flush();
  }
  await cleanView(page, false);
  await freeCameraOff(page);
  return layout;
}

// ---------------- the dollhouse ----------------

const HOUSE = { y: 17, z0: 40, z1: 47, rooms: [
  { name: 'bedroom', x0: 36, x1: 44, wall: ['wallpaper_hearts', 'wool_pink'], floor: ['planks_pink'] },
  { name: 'living', x0: 44, x1: 52, wall: ['wallpaper_stars', 'wool_purple', 'planks_white'], floor: ['planks_oak'] },
  { name: 'kitchen', x0: 52, x1: 60, wall: ['tile_kitchen', 'wool_yellow', 'planks_white'], floor: ['tile_kitchen', 'planks_white'] },
  { name: 'bathroom', x0: 60, x1: 68, wall: ['tile_bath', 'wool_sky'], floor: ['tile_bath', 'wool_white'] },
] };

async function buildHouse(page, errors) {
  console.log('Dollhouse: bedroom, living room, kitchen, bathroom');
  const res = await page.evaluate((H) => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const pick = (keys) => keys.find((k) => B.idOf(k) >= 0);
    const set = (x, y, z, key) => w.set(x, y, z, B.idOf(key), { record: false });
    const Y = H.y;
    w.batch(() => {
      // clear the lot; floors, 3-high walls (open at the front like a dollhouse), a ceiling
      // strip along the back for hanging lamps
      for (let x = H.rooms[0].x0 - 4; x <= 80; x++) for (let z = H.z0 - 6; z <= H.z1 + 8; z++) for (let y = Y; y < Y + 8; y++) set(x, y, z, 'air');
      for (const r of H.rooms) {
        const wall = pick(r.wall), floor = pick(r.floor);
        for (let x = r.x0; x <= r.x1; x++) for (let z = H.z0; z <= H.z1 + 1; z++) set(x, Y - 1, z, floor);
        for (let y = Y; y < Y + 3; y++) {
          for (let x = r.x0; x <= r.x1; x++) set(x, y, H.z0, wall);
          for (let z = H.z0; z <= H.z1; z++) { set(r.x0, y, z, wall); set(r.x1, y, z, wall); }
        }
        for (let x = r.x0; x <= r.x1; x++) for (let z = H.z0; z <= H.z0 + 1; z++) set(x, Y + 3, z, wall);
      }
      // doorways between rooms, window holes in the back wall
      for (const x of [44, 52, 60]) for (const y of [Y, Y + 1]) set(x, y, 45, 'air');
      for (const x of [37, 48, 57, 65]) set(x, Y + 1, H.z0, 'air');
      // stairs tower east of the house: a platform 4 up, with steps filled underneath
      for (let x = 72; x <= 75; x++) for (let z = 36; z <= 41; z++) for (let y = Y; y < Y + 4; y++) set(x, y, z, 'planks_oak');
      for (let k = 1; k < 4; k++) for (let y = Y; y < Y + k; y++) set(72, y, 45 - k, 'planks_oak');
      // a wall to lean the ladders on
      for (let y = Y; y < Y + 4; y++) for (let x = 77; x <= 79; x++) set(x, y, 42, 'planks_pink');
    });
    const E = g.entities;
    const out = { ok: [], bad: [] };
    const put = (key, x, y, z, rot = 0, color = null, data = {}) => {
      const e = E.place(key, x, y, z, rot, color, data, { history: false, fx: false });
      (e ? out.ok : out.bad).push(key + '@' + [x, y, z].join(','));
      return e ? e.uid : null;
    };
    const ids = {};
    // bedroom (x 37..43)
    ids.canopy = put('bed_canopy', 38, Y, 42, 0, '#FF9CCB');
    ids.nightstand = put('nightstand', 40, Y, 41, 0, '#FFFFFF');
    ids.bedLamp = put('table_lamp', 40, Y + 1, 41, 0, '#FFE38F');
    ids.picture = put('picture_frame', 41, Y + 1, 41, 0, '#FFFFFF', { art: 0 });
    ids.bunk = put('bed_bunk', 42, Y, 42, 0, '#C8B4FF');
    ids.wardrobe = put('wardrobe', 37, Y, 45, 1, '#FFFFFF');
    ids.rugHeart = put('rug_heart', 39, Y, 46, 0, '#FF9CCB');
    ids.toyChest = put('toy_chest', 43, Y, 47, 3, '#9BE8CF');
    ids.bookshelf = put('bookshelf', 43, Y, 44, 3, '#FFFFFF');
    ids.teddy = put('teddy_bear', 43, Y + 1, 44, 3, '#E7BE8C');
    ids.window1 = put('window_frame', 37, Y + 1, 40, 0, '#FFFFFF');
    for (const x of [37, 40, 41]) put('fairy_lights', x, Y + 2, 41, 0, null);
    ids.petBed = put('pet_bed', 41, Y, 47, 0, '#C8B4FF');
    // living room (x 45..51)
    ids.piano = put('piano', 45, Y, 41, 0, '#FFFFFF');
    ids.fireplace = put('fireplace', 47, Y, 41, 0, '#FFB8C8');
    ids.candle = put('candle', 47, Y + 2, 41, 0, '#FF9CCB');
    ids.window2 = put('window_frame', 48, Y + 1, 40, 0, '#FFFFFF');
    ids.bookshelfTall = put('bookshelf_tall', 49, Y, 41, 0, '#E7BE8C');
    ids.clock = put('clock', 50, Y + 2, 41, 0, '#A6D8FF');
    ids.tv = put('tv', 45, Y, 45, 1, '#FF9CCB');
    ids.sofa = put('sofa', 51, Y, 44, 3, '#C8B4FF');
    ids.rugRound = put('rug_round', 47, Y, 45, 0, '#A6D8FF');
    ids.coffee = put('coffee_table', 47, Y, 45, 0, '#FFFFFF');
    ids.plant = put('plant_pot', 48, Y + 1, 45, 0, '#FFE38F');
    ids.floorLamp = put('floor_lamp', 51, Y, 46, 3, '#FF9CCB');
    ids.beanbag = put('beanbag', 46, Y, 47, 0, '#9BE8CF');
    ids.armchair = put('armchair', 50, Y, 47, 2, '#FFE38F');
    ids.lampCeiling1 = put('lamp_ceiling', 48, Y + 2, 41, 0, '#FFE38F');
    // kitchen (x 53..59)
    ids.fridge = put('fridge', 53, Y, 41, 0, '#A6D8FF');
    ids.counter1 = put('counter', 54, Y, 41, 0, '#FFFFFF');
    ids.stove = put('stove', 55, Y, 41, 0, '#FFFFFF');
    ids.sink = put('sink_kitchen', 56, Y, 41, 0, '#FFFFFF');
    ids.counter2 = put('counter', 57, Y, 41, 0, '#FFFFFF');
    ids.oven = put('oven', 58, Y, 41, 0, '#FFC4DD');
    ids.counter3 = put('counter', 59, Y, 41, 0, '#FFFFFF');
    ids.cake = put('cake_stand', 54, Y + 1, 41, 0, '#FF9CCB');
    ids.fruit = put('fruit_bowl', 59, Y + 1, 41, 0, '#A6D8FF');
    ids.table = put('table_long', 55, Y, 45, 0, '#FF9CCB');
    ids.chair1 = put('chair', 55, Y, 44, 0, '#FF9CCB');
    ids.chair2 = put('chair', 56, Y, 44, 0, '#C8B4FF');
    ids.chair3 = put('chair', 55, Y, 46, 2, '#9BE8CF');
    ids.chair4 = put('chair', 56, Y, 46, 2, '#FFE38F');
    ids.tableCandle = put('candle', 56, Y + 1, 45, 0, '#FFFFFF');
    ids.stool = put('stool', 59, Y, 45, 0, '#FF9CCB');
    ids.lampCeiling2 = put('lamp_ceiling', 56, Y + 2, 41, 0, '#FF9CCB');
    ids.window3 = put('window_frame', 57, Y + 1, 40, 0, '#FFFFFF');
    // bathroom (x 61..67)
    ids.tub = put('bathtub', 61, Y, 42, 0, '#FF9CCB');
    ids.towels = put('towel_rack', 62, Y + 1, 41, 0, '#FF9CCB');
    ids.toilet = put('toilet', 63, Y, 41, 0, '#C8B4FF');
    ids.bathSink = put('sink_bath', 64, Y, 41, 0, '#A6D8FF');
    ids.mirror = put('mirror', 64, Y + 1, 41, 0, '#FF9CCB');
    ids.window4 = put('window_frame', 65, Y + 1, 40, 0, '#FFFFFF');
    ids.shower = put('shower', 67, Y, 41, 0, '#A6D8FF');
    ids.bathMat = put('bath_mat', 61, Y, 43, 0, '#A6D8FF');
    ids.bathPlant = put('plant_pot', 66, Y, 41, 0, '#9BE8CF', { bloom: true });
    ids.lampCeiling3 = put('lamp_ceiling', 62, Y + 2, 41, 0, '#A6D8FF');
    // doors between rooms
    ids.door1 = put('door', 44, Y, 45, 1, '#FFFFFF');
    ids.door2 = put('door_pink', 52, Y, 45, 1, '#FF9CCB');
    ids.door3 = put('door_glass', 60, Y, 45, 1, '#FFFFFF');
    // front garden
    ids.post1 = put('lantern_post', 35, Y, 49, 0, '#C8B4FF');
    ids.post2 = put('lantern_post', 69, Y, 49, 0, '#C8B4FF');
    ids.mailbox = put('mailbox', 42, Y, 50, 0, '#FF9CCB');
    ids.balloons = put('balloon_bunch', 53, Y, 50, 0, '#FF9CCB');
    ids.bench = put('bench', 58, Y, 50, 0, '#9BE8CF');
    for (let x = 36; x <= 68; x++) if (x !== 47) put('fence', x, Y, 52, 0, '#FFFFFF');
    ids.gate = put('gate', 47, Y, 52, 0, '#FFFFFF');
    // stairs tower + ladders
    for (let k = 0; k < 4; k++) ids['stairs' + k] = put('stairs', 72, Y + k, 45 - k, 0, '#FF9CCB');
    ids.ladder = put('ladder', 78, Y, 43, 0, '#E7BE8C');
    for (let k = 1; k < 4; k++) put('ladder', 78, Y + k, 43, 0, '#E7BE8C');
    return { ...out, ids };
  }, HOUSE);
  check(errors, res.bad.length === 0, `furnished the dollhouse with ${res.ok.length} pieces${res.bad.length ? ' (could not place: ' + res.bad.join(' ') + ')' : ''}`);
  await waitIdle(page);
  return res.ids;
}

async function houseShots(page, tag) {
  await cleanView(page, true);
  await page.evaluate(() => { window.__game.__reach = window.__game.reach; window.__game.reach = -2; });
  await camera(page, [52, 33, 66], [52, 17, 43], 50);
  await settle(page, 900);
  await shot(page, `house-${tag}`, PREFIX);
  for (const r of HOUSE.rooms) {
    const cx = (r.x0 + r.x1) / 2;
    await camera(page, [cx, 24, 53.5], [cx, 17.3, 43.5], 55);
    await settle(page, 500);
    await shot(page, `room-${r.name}-${tag}`, PREFIX);
  }
  await page.evaluate(() => { window.__game.reach = window.__game.__reach; });
  await cleanView(page, false);
}

// ---------------- actions through real clicks ----------------

/** Stand in front of an entity, turn the camera to it; returns the world point aimed at. */
async function aim(page, uid, { dist = 2.6, local = null, floor = 17, back = false } = {}) {
  return page.evaluate(([uid, dist, local, floor, back]) => {
    const g = window.__game, E = g.entities, e = E.byUid(uid);
    const [w, , d] = e.def.size;
    const front = E.localToWorld(e, w / 2, 0, back ? -dist : d + dist);
    g.player.teleport(front.x, floor + 0.02, front.z);
    const t = local ? E.localToWorld(e, local[0], local[1], local[2]) : e.pickable.box.getCenter(front.clone());
    const p = g.player.position;
    const head = p.y + 1.75;
    g.cameraRig.yaw = Math.atan2(t.x - p.x, t.z - p.z);
    g.cameraRig.pitch = Math.atan2(head - t.y, Math.hypot(t.x - p.x, t.z - p.z)) * 0.9;
    g.cameraRig.distance = 3.5;
    g.cameraRig.snap();
    // keep the target in the middle band of the screen, clear of the hotbar and HUD buttons
    const v = t.clone();
    for (let i = 0; i < 16; i++) {
      v.copy(t).project(g.camera);
      if (v.y < -0.3) g.cameraRig.pitch += 0.06;
      else if (v.y > 0.4) g.cameraRig.pitch -= 0.06;
      else if (v.x > 0.55) g.cameraRig.yaw -= 0.06;
      else if (v.x < -0.55) g.cameraRig.yaw += 0.06;
      else break;
      g.cameraRig.snap();
    }
    return [t.x, t.y, t.z];
  }, [uid, dist, local, floor, back]);
}

/** Tap an entity with the current tool through the real input (mouse click or touch tap). */
async function tapEntity(page, uid, opts = {}) {
  const t = await aim(page, uid, opts);
  await settle(page, 400);
  const pt = await page.evaluate(([uid, t]) => {
    const g = window.__game;
    if (!window.__tapHook) {
      window.__tapHook = true;
      g.input.on('tap', (e) => {
        const h = g.pick({ x: e.x, y: e.y });
        window.__lastTap = { x: e.x, y: e.y, hit: h && (h.key || (h.pickable && h.pickable.ref && h.pickable.ref.key)), paused: g.paused, tool: g.selectedTool };
      });
    }
    // hold the camera still until the tap has landed (it eases in beside walls)
    if (!g.__tapRig) {
      g.__tapRig = g.cameraRig.update;
      g.cameraRig.update = () => {};
    }
    const r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(t[0], t[1], t[2]).project(g.camera);
    const nudges = [[0, 0], [0, 0.04], [0, -0.04], [0.04, 0], [-0.04, 0], [0, 0.09], [0, -0.09], [0.09, 0], [-0.09, 0]];
    for (const [dx, dy] of nudges) {
      const ndc = { x: v.x + dx, y: v.y + dy };
      const h = g.pick(ndc);
      if (h && h.type === 'pickable' && h.pickable.ref && h.pickable.ref.uid === uid) {
        const px = r.left + ((ndc.x + 1) / 2) * r.width, py = r.top + ((1 - ndc.y) / 2) * r.height;
        // the HUD (hotbar, round buttons) may cover that spot: the canvas must get the tap
        if (document.elementFromPoint(px, py) !== g.renderer.domElement) continue;
        return { x: px, y: py };
      }
    }
    return null;
  }, [uid, t]);
  const release = () => page.evaluate(() => {
    const g = window.__game;
    if (g.__tapRig) { g.cameraRig.update = g.__tapRig; g.__tapRig = null; }
  });
  if (!pt) {
    await release();
    console.log(`  (could not get a clear tap on entity ${uid} ${await page.evaluate((uid) => window.__game.entities.byUid(uid).key, uid)})`);
    return false;
  }
  if (opts.touch) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await settle(page, 60);
  await release();
  await settle(page, opts.wait ?? 250);
  return true;
}

const ent = (page, uid) => page.evaluate((uid) => {
  const e = window.__game.entities.byUid(uid);
  return e ? { key: e.key, data: { ...e.data }, x: e.x, y: e.y, z: e.z } : null;
}, uid);
const playerInfo = (page) => page.evaluate(() => {
  const p = window.__game.player;
  return { x: p.position.x, y: p.position.y, z: p.position.z, state: p.state, seat: p.seatEntity ? p.seatEntity.uid : null };
});
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.sw-toast')].map((t) => t.textContent).join(' | '));

async function extras(page) {
  return page.evaluate(() => {
    const g = window.__game, E = g.entities, w = g.world, B = g.registry.blocks;
    const Y = 17;
    const put = (key, x, y, z, rot = 0, color = null, data = {}) => {
      const e = E.place(key, x, y, z, rot, color, data, { history: false, fx: false });
      return e ? e.uid : null;
    };
    const ids = {};
    ids.swing = put('swing', 38, Y, 57, 0, '#FF9CCB');
    ids.slide = put('slide', 44, Y, 58, 0, '#C8B4FF');
    ids.trampoline = put('trampoline', 50, Y, 57, 0, '#9BE8CF');
    ids.easel = put('easel', 55, Y, 56, 0, '#E7BE8C');
    ids.dollhouse = put('dollhouse', 59, Y, 56, 0, '#FF9CCB');
    ids.well = put('well', 64, Y, 57, 0, '#FF9CCB');
    ids.fountain = put('fountain', 68, Y, 57, 0);
    ids.birdHouse = put('bird_house', 72, Y, 56, 0, '#A6D8FF');
    ids.picnic = put('picnic_blanket', 38, Y, 62, 0, '#FF9CCB');
    // a little pond for the pool float
    const water = B.idOf('water');
    w.batch(() => {
      for (let x = 48; x <= 52; x++) for (let z = 61; z <= 64; z++) {
        w.set(x, Y - 1, z, water, { record: false });
        w.set(x, Y - 2, z, water, { record: false });
      }
    });
    return ids;
  });
}

async function freeShot(page, name, from, to, wait = 500, { showPlayer = false } = {}) {
  await cleanView(page, true);
  await page.evaluate(() => { window.__game.__reach = window.__game.reach; window.__game.reach = -2; });
  await camera(page, from, to, 55);
  await page.evaluate((show) => { const a = window.__game.player.avatar; if (a) a.group.visible = show; }, showPlayer);
  await settle(page, wait);
  await shot(page, name, PREFIX);
  await page.evaluate(() => { window.__game.reach = window.__game.__reach; });
  await freeCameraOff(page);
  await cleanView(page, false);
}

async function actionsPass(page, errors, ids) {
  console.log('Actions through real clicks');
  Object.assign(ids, await extras(page));
  await waitIdle(page);
  const info = await page.evaluate(() => window.__game.debug.info());
  console.log(`  (fps ~${info.fps}, ${info.calls} draw calls, ${info.triangles} triangles, ${await page.evaluate(() => window.__game.entities.all().length)} pieces)`);
  // pick the Hand tool with the real HUD button
  await page.locator('.sw-round', { hasText: 'Hand' }).first().click();
  check(errors, await page.evaluate(() => window.__game.selectedTool === 'hand'), 'Hand tool picked from the HUD');

  // lamp on / off
  const lamp0 = (await ent(page, ids.bedLamp)).data.on;
  await tapEntity(page, ids.bedLamp);
  const lamp1 = (await ent(page, ids.bedLamp)).data.on;
  await tapEntity(page, ids.bedLamp);
  const lamp2 = (await ent(page, ids.bedLamp)).data.on;
  check(errors, lamp0 !== false && lamp1 === false && lamp2 === true, 'tapping the table lamp turns it off and on again');

  // door: open, walk through, close, blocked
  const doorTapped = await tapEntity(page, ids.door1, { dist: 2.2, back: true });
  const open = (await ent(page, ids.door1)).data.open;
  await settle(page, 700);
  const walk = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    p.teleport(42.5, 17.02, 45.5);
    g.cameraRig.yaw = Math.PI / 2; // forward = +X
    return { x0: p.position.x };
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.player.position.x > 44.6, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const through = await playerInfo(page);
  check(errors, doorTapped && open === true && through.x > 44.6, `tapping the door opens it, and an open door lets you walk through (x ${walk.x0.toFixed(1)} -> ${through.x.toFixed(1)})`);
  await page.evaluate(() => window.__game.player.teleport(47.5, 17.02, 44.5));
  await freeShot(page, 'door-open', [48.5, 19.3, 46.8], [44, 18, 45], 600);
  await tapEntity(page, ids.door1, { dist: 2.2, back: true });
  await settle(page, 700);
  await page.evaluate(() => window.__game.player.teleport(47.5, 17.02, 44.5));
  await freeShot(page, 'door-closed', [48.5, 19.3, 46.8], [44, 18, 45], 400);
  const blocked = await page.evaluate(() => {
    const p = window.__game.player;
    p.teleport(42.5, 17.02, 45.5);
    window.__game.cameraRig.yaw = Math.PI / 2;
    return p.position.x;
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => {
    const p = window.__game.player.position, w = window.__walk || (window.__walk = { x: p.x, n: 0 });
    if (Math.abs(p.x - w.x) < 0.002) w.n++; else { w.n = 0; w.x = p.x; }
    return w.n > 8;
  }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const stopped = await playerInfo(page);
  check(errors, (await ent(page, ids.door1)).data.open === false && stopped.x < 44.05 && stopped.x > 43.3, `a closed door blocks the way (x ${blocked.toFixed(1)} -> ${stopped.x.toFixed(2)})`);

  // piano panel: real key clicks, a song, follow-the-glow
  const notes0 = await page.evaluate(() => window.__game.profile.stats.notesPlayed || 0);
  await tapEntity(page, ids.piano);
  const pianoOpen = await page.evaluate(() => window.__game.ui.current === 'piano');
  check(errors, pianoOpen, 'tapping the piano opens the Piano panel');
  if (pianoOpen) {
    for (const n of [60, 64, 67, 72]) await page.locator(`.sw-wkey[data-note="${n}"]`).click();
    await page.locator('.sw-bkey[data-note="66"]').click();
    const notes1 = await page.evaluate(() => window.__game.profile.stats.notesPlayed || 0);
    check(errors, notes1 - notes0 === 5, `clicking piano keys plays notes (${notes1 - notes0} notes, 'piano:note' emitted)`);
    await page.locator('.sw-song-listen[data-song="twinkle"]').click();
    await page.waitForTimeout(1300);
    await shot(page, 'piano-panel', PREFIX);
    await page.locator('.sw-song-turn[data-song="birthday"]').click();
    const glow = await page.evaluate(() => { const el = document.querySelector('.sw-next'); return el ? Number(el.dataset.note) : null; });
    if (glow) await page.locator(`[data-note="${glow}"].sw-next`).click();
    const glow2 = await page.evaluate(() => { const el = document.querySelector('.sw-next'); return el ? Number(el.dataset.note) : null; });
    check(errors, glow === 67 && glow2 === 67, `"My turn" makes the next key glow (${glow} then ${glow2})`);
    await page.keyboard.press('KeyA');
    await page.keyboard.press('Escape');
  }

  // storybook
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 3000 }).catch(() => {});
  const shelfTapped = await tapEntity(page, ids.bookshelf, { wait: 400 });
  const bookOpen = await page.evaluate(() => window.__game.ui.current === 'book');
  const why = bookOpen ? '' : await page.evaluate(() => JSON.stringify({ panel: window.__game.ui.current, paused: window.__game.paused, tool: window.__game.selectedTool }));
  check(errors, bookOpen, `tapping the bookshelf opens the Storybook ${why} tapped=${shelfTapped} last=${await page.evaluate(() => JSON.stringify(window.__lastTap || null))}`);
  if (bookOpen) {
    await settle(page, 300);
    await shot(page, 'book-shelf', PREFIX);
    await page.locator('.sw-bookcard[data-story="strawberry"]').click();
    await settle(page, 300);
    await shot(page, 'book-page1', PREFIX);
    for (let i = 0; i < 3; i++) await page.locator('.sw-book-next').click();
    await settle(page, 300);
    await shot(page, 'book-page4', PREFIX);
    const text = await page.evaluate(() => document.querySelector('.sw-reader-text').textContent);
    check(errors, /strawberry/i.test(text), `turning pages shows the story ("${text}")`);
    await page.locator('.sw-book-next').click();
    await page.locator('.sw-book-more').click();
    await page.locator('.sw-bookcard[data-story="cloud"]').click();
    for (let i = 0; i < 3; i++) await page.locator('.sw-book-next').click();
    await settle(page, 300);
    await shot(page, 'book-rainbow', PREFIX);
    await page.keyboard.press('Escape');
  }

  // TV channels
  await tapEntity(page, ids.tv);
  const ch1 = (await ent(page, ids.tv)).data.ch;
  await freeShot(page, 'tv-bunnies', [49.2, 19.2, 45.6], [45.6, 18.3, 45.5], 900);
  await tapEntity(page, ids.tv);
  await tapEntity(page, ids.tv);
  const ch3 = (await ent(page, ids.tv)).data.ch;
  await freeShot(page, 'tv-stars', [49.2, 19.2, 45.6], [45.6, 18.3, 45.5], 1400);
  await tapEntity(page, ids.tv);
  check(errors, ch1 === 1 && ch3 === 3 && (await ent(page, ids.tv)).data.ch === 0, 'tapping the TV flips through 3 shows and turns it off');

  // fireplace, clock, window, picture, cooking & dress-up (fallbacks), toy chest, mailbox
  await tapEntity(page, ids.fireplace);
  const fireOff = (await ent(page, ids.fireplace)).data.on === false;
  await tapEntity(page, ids.fireplace);
  check(errors, fireOff && (await ent(page, ids.fireplace)).data.on !== false, 'the fireplace goes out and lights again');
  await tapEntity(page, ids.clock, { dist: 3 });
  const clockToast = await toasts(page);
  check(errors, /o'clock|past|quarter/.test(clockToast), `the kitty clock tells the time ("${clockToast.slice(0, 80)}")`);
  await tapEntity(page, ids.window2, { dist: 3 });
  check(errors, (await ent(page, ids.window2)).data.open === false, 'tapping the window closes its curtains');
  await tapEntity(page, ids.picture, { dist: 3 });
  check(errors, (await ent(page, ids.picture)).data.art === 1, 'tapping the picture shows a new painting');
  await tapEntity(page, ids.stove);
  const cookPanel = await page.evaluate(() => window.__game.ui.current);
  const cookToast = await toasts(page);
  check(errors, cookPanel === 'cooking' || /Cooking/.test(cookToast), `the stove opens cooking (or a friendly toast): ${cookPanel || cookToast.slice(0, 60)}`);
  if (cookPanel) await page.keyboard.press('Escape');
  await tapEntity(page, ids.wardrobe, { wait: 800 });
  const dressPanel = await page.evaluate(() => window.__game.ui.current);
  const dressToast = await toasts(page);
  check(errors, !!dressPanel || /Dress-Up/.test(dressToast), `the wardrobe opens the Dress-Up Studio (or a friendly toast): ${dressPanel || dressToast.slice(0, 60)}`);
  if (dressPanel) await page.keyboard.press('Escape');
  await tapEntity(page, ids.toyChest, { wait: 700 });
  check(errors, await page.evaluate(() => { const fx = window.__game.scene.getObjectByName('furniture-fx'); return !!fx && fx.children.length > 0; }), 'the toy chest pops out a toy');
  await freeShot(page, 'toy-chest', [41.5, 19.6, 49.8], [43, 17.8, 47], 100);
  await tapEntity(page, ids.mailbox);
  const letter = await page.evaluate(() => window.__game.ui.current === 'letter' && document.querySelector('.sw-letter-paper').textContent);
  check(errors, !!letter, `the mailbox has a kind letter (${letter ? letter.slice(0, 60) : 'none'})`);
  if (letter) {
    await settle(page, 700);
    await shot(page, 'letter', PREFIX);
    await page.locator('.sw-letter-thanks').click();
  }
  check(errors, (await ent(page, ids.mailbox)).data.mail === false, 'the mailbox flag goes down after reading');
  await page.evaluate(() => window.__game.events.emit('time:morning', { day: 2 }));
  check(errors, (await ent(page, ids.mailbox)).data.mail === true, 'a new letter arrives in the morning');

  // bath and shower
  await tapEntity(page, ids.tub);
  const bath = await playerInfo(page);
  check(errors, bath.state === 'sit' && bath.seat === ids.tub, 'tapping the bathtub: bubble bath time');
  await freeShot(page, 'bath', [63.4, 19.9, 45.4], [61.5, 17.5, 42.2], 900, { showPlayer: true });
  await page.evaluate(() => window.__game.player.stand());
  await tapEntity(page, ids.shower);
  const showerOn = await page.evaluate((uid) => { const e = window.__game.entities.byUid(uid); return !!e.anim && e.anim.water > 0; }, ids.shower);
  check(errors, showerOn, 'the shower runs water');
  await freeShot(page, 'shower', [65.5, 19.6, 45], [67.2, 18, 41.4], 200);
  await tapEntity(page, ids.bathSink);
  await tapEntity(page, ids.toilet);

  // sleeping in the princess canopy bed
  await page.evaluate(() => window.__game.setDayTime(0.86));
  await tapEntity(page, ids.canopy, { wait: 50 });
  await page.waitForTimeout(1150);
  await shot(page, 'sleep-canopy-dream', PREFIX);
  await page.waitForTimeout(3600);
  const slept = await page.evaluate(() => ({ t: window.__game.time.dayTime, state: window.__game.player.state }));
  const morning = await toasts(page);
  check(errors, slept.state === 'sleep' && slept.t > 0.25 && slept.t < 0.32 && /Good morning/.test(morning), `slept in the canopy bed until morning (${slept.t.toFixed(3)}; "${morning.slice(0, 40)}")`);
  await shot(page, 'sleep-canopy-morning', PREFIX);
  await freeShot(page, 'sleep-canopy', [40.2, 20.6, 46.5], [39, 17.6, 41.8], 300, { showPlayer: true });
  const hint = await page.evaluate((uid) => { const g = window.__game; const e = g.entities.byUid(uid); return e.pickable.hint(g); }, ids.canopy);
  check(errors, hint === 'Tap to get up', `in bed the hint says "${hint}"`);
  await page.evaluate(() => window.__game.player.stand());

  // bunk bed: the top bunk
  await page.evaluate(() => window.__game.setDayTime(0.86));
  const bunkTop = await tapEntity(page, ids.bunk, { local: [0.5, 1.72, 1.2], wait: 50 });
  await page.waitForTimeout(600);
  const bunk = await playerInfo(page);
  check(errors, bunkTop && bunk.state === 'sleep' && bunk.y > 18.3, `tapping the top bunk sleeps up top (y ${bunk.y.toFixed(2)})`);
  await page.waitForTimeout(4200);
  await freeShot(page, 'sleep-bunk', [40.6, 20.9, 46.2], [42.5, 18.4, 41.8], 300, { showPlayer: true });
  await page.evaluate(() => window.__game.player.stand());

  // walking up the stairs
  await page.evaluate(() => {
    const g = window.__game;
    g.player.teleport(72.5, 17.02, 47.4);
    g.cameraRig.yaw = Math.PI; // forward = -Z
    g.cameraRig.pitch = 0.25;
  });
  await settle(page, 200);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.player.position.y > 18.4, null, { timeout: 8000, polling: 50 }).catch(() => {});
  await shot(page, 'stairs-walk', PREFIX);
  await page.waitForFunction(() => window.__game.player.position.y > 20.95 && window.__game.player.position.z < 41.8, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await page.keyboard.up('KeyW');
  await settle(page, 300);
  const top = await playerInfo(page);
  check(errors, top.y > 20.9, `walked up the stairs onto the platform (y ${top.y.toFixed(2)})`);
  await shot(page, 'stairs-top', PREFIX);

  // ladder: tap to climb
  await tapEntity(page, ids.ladder, { dist: 2 });
  await page.waitForFunction(() => window.__game.player.position.y > 20.95 && window.__game.player.onGround, null, { timeout: 10000, polling: 100 }).catch(() => {});
  const climbed = await playerInfo(page);
  check(errors, climbed.y > 20.9, `tapping the ladder climbs to the top (y ${climbed.y.toFixed(2)})`);

  // trampoline
  await page.evaluate(() => {
    window.__maxY = 0;
    window.__stopMax = false;
    const tick = () => { window.__maxY = Math.max(window.__maxY, window.__game.player.position.y); if (!window.__stopMax) requestAnimationFrame(tick); };
    tick();
  });
  await tapEntity(page, ids.trampoline, { wait: 50 });
  await page.waitForFunction(() => window.__maxY > 19.5, null, { timeout: 6000, polling: 100 }).catch(() => {});
  const maxY = await page.evaluate(() => { window.__stopMax = true; return window.__maxY; });
  check(errors, maxY > 19.5, `the trampoline bounces you up high (max y ${maxY.toFixed(2)})`);
  await shot(page, 'trampoline', PREFIX);
  await page.waitForFunction(() => window.__game.player.onGround, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await page.evaluate(() => { const p = window.__game.player; p.velocity.set(0, 0, 0); });

  // swing
  const swingTapped = await tapEntity(page, ids.swing);
  await page.waitForFunction((uid) => {
    const e = window.__game.entities.byUid(uid);
    return Math.abs(e.object3d.children[0].userData.parts.seat.rotation.x) > 0.15;
  }, ids.swing, { timeout: 8000, polling: 100 }).catch(() => {});
  const sw = await page.evaluate((uid) => {
    const e = window.__game.entities.byUid(uid);
    const seat = e.object3d.children[0].userData.parts.seat;
    return { rot: seat.rotation.x, state: window.__game.player.state };
  }, ids.swing);
  check(errors, sw.state === 'sit' && Math.abs(sw.rot) > 0.02, `the swing really swings (tapped ${swingTapped}, ${sw.state}, seat angle ${sw.rot.toFixed(2)})`);
  await shot(page, 'swing', PREFIX);
  await page.evaluate(() => window.__game.player.stand());

  // slide
  await tapEntity(page, ids.slide, { local: [0.5, 1.0, 2.2], wait: 100 });
  const onTop = await playerInfo(page);
  await page.waitForFunction(() => window.__game.player.position.y < 18.0, null, { timeout: 8000, polling: 50 }).catch(() => {});
  await shot(page, 'slide', PREFIX);
  await page.waitForFunction(() => window.__game.player.state === 'walk', null, { timeout: 10000, polling: 100 }).catch(() => {});
  const slid = await playerInfo(page);
  check(errors, onTop.y > 18.2 && slid.state === 'walk' && slid.y < 17.6, `slid down the slide (top y ${onTop.y.toFixed(2)} -> ${slid.state} at y ${slid.y.toFixed(2)})`);

  // easel painting
  await tapEntity(page, ids.easel);
  const easelOpen = await page.evaluate(() => window.__game.ui.current === 'easel');
  check(errors, easelOpen, 'tapping the easel opens the painting panel');
  if (easelOpen) {
    const before = (await ent(page, ids.easel)).data.pic || '';
    await page.locator('.sw-paint[data-color="10"]').click();
    const box = await page.locator('.sw-easel-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    for (let i = 0; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), box.y + box.height * (0.2 + i * 0.05));
    await page.mouse.up();
    await page.locator('.sw-paint[data-color="1"]').click();
    await page.locator('.sw-easel-tools .sw-btn', { hasText: 'Fill' }).click();
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.1);
    await shot(page, 'easel-panel', PREFIX);
    await page.locator('.sw-easel-done').click();
    const after = (await ent(page, ids.easel)).data.pic || '';
    check(errors, after.length === 256 && after !== before, 'painting on the easel hangs the picture on it');
    await freeShot(page, 'easel', [55.5, 19, 59.4], [55.5, 18.2, 56.5], 400);
  }

  // dollhouse, balloons, bird, wishing well, teddy...
  await tapEntity(page, ids.dollhouse);
  await settle(page, 700);
  check(errors, (await ent(page, ids.dollhouse)).data.open === true, 'the dollhouse front swings open');
  await freeShot(page, 'dollhouse-open', [60.3, 19.4, 59.8], [60, 17.9, 56.4], 300);
  const tapped = [];
  for (const k of ['balloons', 'birdHouse', 'well', 'teddy', 'fountain', 'petBed', 'towels', 'plant', 'cake', 'beanbag', 'sofa']) {
    if (await tapEntity(page, ids[k], { dist: 2.6 })) tapped.push(k);
  }
  check(errors, tapped.length >= 10, `tapped ${tapped.join(', ')}`);
  check(errors, (await ent(page, ids.plant)).data.bloom === true, 'watering the plant makes it bloom');

  // pool float on the pond (Build tool)
  const float = await page.evaluate(() => {
    const g = window.__game;
    g.debug.select('furn:pool_float');
    g.debug.useAt(50, 14, 62);
    const e = g.entities.all().filter((x) => x.key === 'pool_float').pop();
    return e ? { y: e.y, water: e.data.water } : null;
  });
  check(errors, !!float && float.water === true && float.y === 16, `the pool float floats on the pond (${JSON.stringify(float)})`);

  // fences join up; a table (with a lamp) stands on a rug
  const fence = await page.evaluate(() => {
    const g = window.__game;
    g.debug.select('furn:fence');
    for (let x = 60; x <= 63; x++) g.debug.useAt(x, 16, 66);
    const e = g.entities.all().find((x) => x.key === 'fence' && x.x === 61 && x.z === 66);
    return e ? e.data.conn : null;
  });
  check(errors, fence === 3 || fence === 12, `fences join up with their neighbours (conn ${fence})`);
  const rug = await page.evaluate(() => {
    const g = window.__game;
    const r = g.entities.place('rug_round', 39, 17, 67, 0, null, {}, { fx: false });
    const t = g.entities.place('table_round', 39, 17, 67, 0, null, {}, { fx: false });
    const l = g.entities.place('table_lamp', 39, 18, 67, 0, null, {}, { fx: false });
    return !!r && !!t && !!l && g.entities.at(39, 17, 67) === t;
  });
  check(errors, rug, 'a table (with a lamp) stands on a rug');

  // ladder: press forward while touching it to climb
  await page.evaluate(() => {
    const g = window.__game;
    g.setTool('build');
    g.player.teleport(78.5, 17.02, 44.2);
    g.cameraRig.yaw = Math.PI; // forward = -Z, into the ladder
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.player.position.y > 18.5, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const climbedW = await playerInfo(page);
  check(errors, climbedW.y > 18.5, `holding forward against the ladder climbs it (y ${climbedW.y.toFixed(2)})`);

  // save, load the world again: door, easel painting, mailbox and TV state come back
  const before = await page.evaluate((ids) => {
    const g = window.__game, E = g.entities;
    E.setData(E.byUid(ids.door2), { open: true });
    E.setData(E.byUid(ids.tv), { ch: 2, on: true });
    return { id: g.world.meta.id, n: E.all().length, keys: E.all().map((e) => e.uid + ':' + e.key), pic: E.byUid(ids.easel).data.pic, mail: E.byUid(ids.mailbox).data.mail };
  }, ids);
  await page.evaluate(() => window.__game.debug.save());
  await page.evaluate((id) => window.__game.debug.loadWorld(id), before.id);
  await waitIdle(page);
  const after = await page.evaluate((ids) => {
    const E = window.__game.entities;
    return {
      keys: E.all().map((e) => e.uid + ':' + e.key),
      n: E.all().length, door: E.byUid(ids.door2) && E.byUid(ids.door2).data.open, tv: E.byUid(ids.tv) && E.byUid(ids.tv).data.ch,
      pic: E.byUid(ids.easel) && E.byUid(ids.easel).data.pic, mail: E.byUid(ids.mailbox) && E.byUid(ids.mailbox).data.mail,
      doorCollider: E.byUid(ids.door2) && E.byUid(ids.door2).colliders.map((b) => +(b.max.x - b.min.x).toFixed(2)),
    };
  }, ids);
  check(errors, after.n === before.n && after.door === true && after.tv === 2 && after.pic === before.pic && after.mail === before.mail,
    `the house comes back after saving and loading (${after.n}/${before.n} pieces${after.n !== before.n ? ' missing ' + before.keys.filter((k) => !after.keys.includes(k)).join(' ') : ''}, door open ${after.door}, TV channel ${after.tv}, painting kept ${after.pic === before.pic})`);
  await freeShot(page, 'reloaded-living', [48, 22.5, 53.5], [48, 17.8, 43.5], 900);
}

// ---------------- iPad: Bag, color picker, taps ----------------

async function touchPass(browser, errors) {
  console.log('iPad pass (1024x768 touch): Bag, colors, taps on furniture');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'ipad' });
  await startWorld(page, 'flat', { tap: true });
  await page.evaluate(() => { const g = window.__game; g.profile.settings.timeFrozen = true; g.setDayTime(0.42); });
  await settle(page, 500);
  // the Bag: Bedroom tab with rendered thumbnails
  await page.locator('.sw-bagbtn').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await page.locator('.sw-tab2', { hasText: 'Bedroom' }).tap();
  await page.waitForFunction(() => [...document.querySelectorAll('.sw-item img')].filter((i) => i.src).length >= 10, null, { timeout: 20000 }).catch(() => {});
  await settle(page, 600);
  await shot(page, 'ipad-bag-bedroom', PREFIX);
  const thumbs = await page.evaluate(() => [...document.querySelectorAll('.sw-item')].map((c) => ({ name: c.textContent, ok: !!c.querySelector('img').src })));
  check(errors, thumbs.length >= 16 && thumbs.every((t) => t.ok), `Bedroom tab shows ${thumbs.length} pieces with 3D thumbnails`);
  // colors: the Princess Bed in every color
  await page.locator('.sw-item', { hasText: 'Princess Bed' }).tap();
  await page.waitForFunction(() => document.querySelectorAll('.sw-color-opt img[src]').length >= 5, null, { timeout: 20000 }).catch(() => {});
  await settle(page, 500);
  await shot(page, 'ipad-bag-colors', PREFIX);
  await page.locator('.sw-color-opt').nth(1).tap();
  const slot = await page.evaluate(() => ({ key: window.__game.hotbar.slots[window.__game.hotbar.index], color: window.__game.hotbar.colors[window.__game.hotbar.index] }));
  check(errors, slot.key === 'furn:bed_canopy' && slot.color === '#C8B4FF', `picked the lilac Princess Bed (${slot.key} ${slot.color})`);
  // other tabs render too
  for (const tab of ['Living Room', 'Kitchen', 'Bathroom', 'Fun & Toys']) {
    await page.locator('.sw-bagbtn').tap();
    await page.locator('.sw-tab2', { hasText: tab }).tap();
    await page.waitForFunction(() => [...document.querySelectorAll('.sw-item img')].every((i) => i.src), null, { timeout: 20000 }).catch(() => {});
    await settle(page, 300);
    if (tab === 'Living Room' || tab === 'Fun & Toys') await shot(page, `ipad-bag-${tab.split(' ')[0].toLowerCase()}`, PREFIX);
    await page.locator('.sw-panel-wrap.sw-open .sw-bag-close').tap();
  }
  // place the bed with a real tap on the ground (Build tool), 4 blocks ahead
  const ground = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    g.cameraRig.pitch = 0.55;
    g.cameraRig.snap();
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 4), z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 4);
    return [x, g.world.heightAt(x, z), z];
  });
  await settle(page, 300);
  const pt = await screenPoint(page, ground[0] + 0.5, ground[1] + 1, ground[2] + 0.5);
  await page.touchscreen.tap(pt.x, pt.y);
  await settle(page, 600);
  const bed = await page.evaluate(() => window.__game.entities.all().find((e) => e.key === 'bed_canopy'));
  check(errors, !!bed, 'a tap with the Build tool placed the Princess Bed');
  if (bed) {
    const uid = await page.evaluate(() => window.__game.entities.all().find((e) => e.key === 'bed_canopy').uid);
    // Hand tool from the HUD, then tap the bed: sleep
    await page.locator('.sw-round', { hasText: 'Hand' }).first().tap();
    await page.evaluate(() => window.__game.setDayTime(0.85));
    const ok = await tapEntity(page, uid, { touch: true, dist: 2.2, floor: ground[1] + 1, wait: 400 });
    const st = await playerInfo(page);
    check(errors, ok && st.state === 'sleep', `tapping the Princess Bed on the iPad: sleeping (${st.state})`);
    await page.waitForTimeout(4400);
    await shot(page, 'ipad-morning', PREFIX);
    await page.evaluate(() => window.__game.player.stand());
  }
  // a piano: tap it, tap keys with fingers
  const pianoUid = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + 5, z = Math.floor(p.z) - 4;
    const e = g.entities.place('piano', x, g.world.heightAt(x, z) + 1, z, 0, '#FFC4DD', {}, { history: false });
    return e ? e.uid : null;
  });
  if (pianoUid) {
    const n0 = await page.evaluate(() => window.__game.profile.stats.notesPlayed || 0);
    const ok = await tapEntity(page, pianoUid, { touch: true, floor: ground[1] + 1 });
    const open = await page.evaluate(() => window.__game.ui.current === 'piano');
    check(errors, ok && open, 'tapping the piano on the iPad opens the keyboard');
    if (open) {
      for (const n of [60, 62, 64, 65, 67]) await page.locator(`.sw-wkey[data-note="${n}"]`).tap();
      const n1 = await page.evaluate(() => window.__game.profile.stats.notesPlayed || 0);
      check(errors, n1 - n0 === 5, `finger taps on the keys play notes (${n1 - n0})`);
      await shot(page, 'ipad-piano', PREFIX);
      await page.locator('.sw-panel-wrap.sw-open .sw-close').tap();
    }
  }
  // key sizes: every piano key and panel button is at least 44 px
  const small = await page.evaluate(() => {
    const out = [];
    for (const sel of ['.sw-wkey', '.sw-song .sw-btn', '.sw-bookcard', '.sw-paint']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.width < 40 || r.height < 40)) out.push(sel + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    return out;
  });
  check(errors, small.length === 0, `touch targets are big enough${small.length ? ' (' + small.slice(0, 4).join(', ') + ')' : ''}`);
  await context.close();

  // a phone: the piano's song buttons stay inside their cards and each one can be tapped
  console.log('Phone pass (390x844 touch): piano songs');
  const phone = await openGame(browser, { errors, viewport: { width: 390, height: 844 }, touch: true, label: 'phone' });
  await phone.page.evaluate(() => window.__game.debug.newWorld({ biome: 'flat', size: 'cozy' }));
  await phone.page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 90000 });
  await waitIdle(phone.page);
  await phone.page.evaluate(() => {
    const g = window.__game, y = g.world.heightAt(60, 60) + 1;
    const e = g.entities.place('piano', 60, y, 64, 2, null, {}, { history: false });
    g.debug.interact(e.uid);
  });
  await phone.page.waitForFunction(() => window.__game.ui.current === 'piano', null, { timeout: 5000 }).catch(() => {});
  await settle(phone.page, 800);
  const songBtns = await phone.page.evaluate(() => [...document.querySelectorAll('.sw-song')].flatMap((c) => {
    const cr = c.getBoundingClientRect();
    return [...c.querySelectorAll('button')].map((b) => {
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = r.left >= cr.left - 1 && r.right <= cr.right + 1 && r.left >= 0 && r.right <= innerWidth && b.contains(top);
      return ok ? null : `${c.querySelector('.sw-song-name').textContent}/${b.textContent.trim()} ${Math.round(r.left)}-${Math.round(r.right)}`;
    });
  }).filter(Boolean));
  check(errors, songBtns.length === 0, `phone piano: every song button sits inside its card and can be tapped${songBtns.length ? ' (' + songBtns.join(', ') + ')' : ''}`);
  await phone.page.locator('.sw-song-turn[data-song="twinkle"]').tap();
  await settle(phone.page, 300);
  const following = await phone.page.evaluate(() => !!document.querySelector('.sw-wkey.sw-next, .sw-bkey.sw-next'));
  check(errors, following, 'phone piano: tapping Twinkle Twinkle\'s "My turn" lights the first key');
  await shot(phone.page, 'phone-piano', PREFIX);
  await phone.context.close();
}

// ---------------- table tops: things stand on every surface ----------------

async function tableTopsPass(browser, errors) {
  console.log('Table tops: a candle and a cupcake on every piece with a top, by real clicks');
  const { context, page } = await openGame(browser, { errors, label: 'tops' });
  await setup(page);
  const keys = await page.evaluate(() => [...window.__game.entities.defs.values()].filter((d) => typeof d.surface === 'number').map((d) => d.key));
  const failed = [];
  for (const key of keys) {
    for (const item of ['furn:candle', 'food:cupcake']) {
      const r = await page.evaluate(([key, item]) => {
        const g = window.__game, E = g.entities;
        for (const e of E.all()) E.remove(e, { history: false, fx: false, events: false });
        g.setTool('build');
        g.player.teleport(72.5, 17.02, 60.5);
        const e = E.place(key, 72, 17, 63, 2, null, {}, { history: false, fx: false });
        if (item.startsWith('food:') && g.debug.cooking) g.debug.cooking.give(item.slice(5), 1);
        g.debug.select(item);
        const b = e.pickable.box;
        const t = [(b.min.x + b.max.x) / 2, b.max.y - 0.01, (b.min.z + b.max.z) / 2];
        const p = g.player.position;
        g.cameraRig.yaw = Math.atan2(t[0] - p.x, t[2] - p.z);
        g.cameraRig.pitch = 0.8;
        g.cameraRig.snap();
        return { uid: e.uid, t };
      }, [key, item]);
      if (!r || !r.uid) { failed.push(`${key}: not placed`); continue; }
      await settle(page, 350);
      const at = await screenPoint(page, ...r.t);
      const face = at && await page.evaluate(([x, y]) => {
        const g = window.__game, rr = g.renderer.domElement.getBoundingClientRect();
        const h = g.pick({ x: ((x - rr.left) / rr.width) * 2 - 1, y: -(((y - rr.top) / rr.height) * 2 - 1) });
        return h && h.type === 'pickable' ? h.face[1] : null;
      }, [at.x, at.y]);
      if (!at || face !== 1) { failed.push(`${key}: could not aim at its top`); continue; }
      await page.mouse.click(at.x, at.y);
      await settle(page, 250);
      const out = await page.evaluate(([uid, item]) => {
        const g = window.__game, want = item === 'furn:candle' ? 'candle' : 'food_cupcake';
        const e = g.entities.all().find((x) => x.key === want);
        const table = g.entities.byUid(uid);
        return e ? { on: e.restsOn === uid, feet: +(e.y + e.yOffset).toFixed(2), top: +(table.y + table.def.surface).toFixed(2) } : null;
      }, [r.uid, item]);
      if (!out || !out.on || Math.abs(out.feet - out.top) > 0.02) failed.push(`${key} <- ${item}: ${JSON.stringify(out)}`);
    }
  }
  check(errors, !failed.length, `a candle and a cupcake stand on the top of all ${keys.length} pieces with a surface (${keys.join(' ')})${failed.length ? ': ' + failed.join('; ') : ''}`);
  // a picture of the low and the tall ones with things on top
  await page.evaluate(() => {
    const g = window.__game, E = g.entities;
    for (const e of E.all()) E.remove(e, { history: false, fx: false, events: false });
    const row = [['coffee_table', 66], ['piano', 70], ['fireplace', 74], ['bookshelf_tall', 78]];
    for (const [k, x] of row) {
      const t = E.place(k, x, 17, 63, 0, null, {}, { history: false, fx: false });
      const top = t.y + t.def.size[1];
      E.place('candle', x, top, 63, 0, null, {}, { history: false, fx: false });
      E.place('plant_pot', x + 1, top, 63, 0, null, {}, { history: false, fx: false });
    }
  });
  await camera(page, [72.5, 21, 71.5], [72.5, 17.6, 63]);
  await shot(page, 'table-tops', PREFIX);
  await freeCameraOff(page);
  await context.close();
}

async function main() {
  const errors = [];
  const browser = await launch({ headed: !!args.headed });
  try {
    if (only !== 'touch' && only !== 'tops') {
    const { context, page } = await openGame(browser, { errors, label: 'furniture' });
    await setup(page);
    if (!only || only === 'showroom') await showroom(page, errors);
    if (!only || only === 'house' || only === 'actions') {
      const ids = await buildHouse(page, errors);
      await page.evaluate(() => window.__game.player.teleport(50.5, 17.1, 49.5));
      await houseShots(page, 'day');
      await page.evaluate(() => window.__game.setDayTime(0.9));
      await settle(page, 1500);
      await houseShots(page, 'night');
      await page.evaluate(() => window.__game.setDayTime(0.42));
      await freeCameraOff(page);
      if (!only || only === 'actions') await actionsPass(page, errors, ids);
    }
    await context.close();
    }
    if (!only || only === 'touch') await touchPass(browser, errors);
    if (!only || only === 'tops') await tableTopsPass(browser, errors);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
