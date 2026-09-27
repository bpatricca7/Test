// Pets / Garden / Cooking play test ("life" team). Drives the real UI (Bag, adoption panel,
// pet bubble, Pets panel, Basket, Cooking panel) with mouse clicks and touch taps.
//
//   node tools/probe-life.mjs [--only=desktop|touch] [--headed]
//
// Screenshots: .shots/life-*.png. Fails on any console error or failed check.

import { launch, openGame, startWorld, waitForPlay, waitIdle, waitForTitle, shot, settle, finish, parseArgs } from './smoke.mjs';

const P = 'life';
let errors = [];

function check(cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

/** Count our events in the page. */
async function trackEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    window.__lifeEv = {};
    for (const n of ['pet:adopt', 'pet:pet', 'pet:feed', 'pet:ride', 'garden:plant', 'garden:harvest', 'cook:done', 'food:eat', 'basket:change']) {
      g.events.on(n, () => { window.__lifeEv[n] = (window.__lifeEv[n] || 0) + 1; });
    }
  });
}
const ev = (page, n) => page.evaluate((n) => (window.__lifeEv && window.__lifeEv[n]) || 0, n);

/** A clear patch of ground in view: returns page coords of its top face (and the cell). */
async function groundPoint(page, { dist = 4, side = 0 } = {}) {
  return page.evaluate(({ dist, side }) => {
    const g = window.__game, p = g.player.position, yaw = g.cameraRig.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const r = g.renderer.domElement.getBoundingClientRect();
    const tries = [];
    for (let dd = 0; dd < 5; dd++) for (const ss of [0, 1, -1, 2, -2]) tries.push([dist + dd * 0.8, side + ss]);
    for (const [d, s] of tries) {
      const x = Math.floor(p.x + fx * d + rx * s), z = Math.floor(p.z + fz * d + rz * s);
      const y = g.world.heightAt(x, z);
      const v = g.camera.position.clone().set(x + 0.5, y + 1, z + 0.5).project(g.camera);
      if (v.z > 1 || Math.abs(v.x) > 0.8 || v.y < -0.75 || v.y > 0.8) continue;
      const hit = g.pick({ x: v.x, y: v.y });
      // the ground block's top, or a flower / grass tuft standing on it
      const onTop = hit && hit.type === 'block' && hit.x === x && hit.z === z && ((hit.y === y && hit.face[1] === 1) || (hit.y === y + 1 && g.registry.blocks.props.replaceable[hit.id]));
      if (!onTop) continue;
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, cell: [x, y, z] };
    }
    return null;
  }, { dist, side });
}

/** Aim at a pet and return the page point of its body (if a pick there finds it). */
async function petPoint(page, id) {
  return page.evaluate((id) => {
    const g = window.__game, pet = g.pets.byId(id);
    if (!pet) return null;
    const b = pet.box;
    const cx = (b.min.x + b.max.x) / 2, cy = b.min.y + (b.max.y - b.min.y) * 0.55, cz = (b.min.z + b.max.z) / 2;
    const r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(cx, cy, cz).project(g.camera);
    if (v.z > 1) return null;
    const hit = g.pick({ x: v.x, y: v.y });
    const ok = !!hit && hit.type === 'pickable' && hit.pickable.ref === pet;
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, ok };
  }, id);
}

/** Stand the player a few blocks from a pet, looking at it, with the pet staying still. */
async function faceTarget(page, x, y, z, dist = 3.2, pitch = 0.35, first = false) {
  await page.evaluate(([x, y, z, dist, pitch, first]) => {
    const g = window.__game;
    g.cameraRig.setMode(first ? 'first' : 'third');
    const p = g.player.position;
    let dx = p.x - x, dz = p.z - z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const px = x + dx * dist, pz = z + dz * dist;
    const h = g.world.heightAt(Math.floor(px), Math.floor(pz));
    g.player.teleport(px, h + 1.01, pz);
    g.cameraRig.yaw = Math.atan2(x - px, z - pz);
    g.cameraRig.pitch = pitch;
    g.cameraRig.distance = 4.5;
  }, [x, y, z, dist, pitch, first]);
  await settle(page, 450);
}

async function openBag(page, tab, tap = false) {
  const press = (l) => (tap ? l.tap() : l.click());
  await press(page.locator('.sw-bagbtn').first());
  // the merged Bag calls its tabs .sw-tab2 (the core Bag had .sw-tab)
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="bag"] :is(.sw-tab, .sw-tab2)');
  await press(page.locator('.sw-panel-wrap.sw-open :is(.sw-tab, .sw-tab2)', { hasText: tab }).first());
  await settle(page, 250);
}

async function pickBagItem(page, name, tap = false) {
  const l = page.locator('.sw-panel-wrap.sw-open[data-panel="bag"] .sw-item', { hasText: name }).first();
  await l.waitFor();
  if (tap) await l.tap(); else await l.click();
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
}

async function tool(page, name, tap = false) {
  const l = page.locator(`.sw-hud-right .sw-round[aria-label="${name}"]`).first();
  if (tap) await l.tap(); else await l.click();
  await settle(page, 150);
}

// ---------------------------------------------------------------- desktop

async function adoptViaUI(page, species, speciesName, variantIndex, name, side) {
  await openBag(page, 'Pets');
  await pickBagItem(page, speciesName);
  const gp = await groundPoint(page, { dist: 4.2, side });
  if (!gp) throw new Error('no clear ground for ' + species);
  await page.mouse.click(gp.x, gp.y);
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="adopt"] .lf-variant');
  await settle(page, 300);
  await page.locator('.sw-panel-wrap.sw-open .lf-variant').nth(variantIndex).click();
  await page.locator('.sw-panel-wrap.sw-open .lf-name').fill(name);
  await settle(page, 250);
  return gp;
}

async function desktop(browser) {
  console.log('Desktop pass (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await startWorld(page, 'flat');
  await trackEvents(page);
  await page.evaluate(() => { window.__game.setDayTime(0.35); });
  await settle(page, 500);

  // ----- adopt all seven species through the Bag + adoption panel -----
  const species = [
    ['puppy', 'Puppy', 0, 'Biscuit'], ['kitty', 'Kitty', 2, 'Luna'], ['bunny', 'Bunny', 3, 'Clover'],
    ['panda', 'Panda', 0, 'Mochi'], ['duckling', 'Duckling', 0, 'Nugget'], ['pony', 'Pony', 1, 'Buttercup'],
    ['unicorn', 'Unicorn', 0, 'Sprinkles'],
  ];
  let i = 0;
  for (const [key, label, variant, name] of species) {
    const before = await page.evaluate(() => window.__game.pets.pets.length);
    await adoptViaUI(page, key, label, variant, name, (i % 3) - 1);
    if (key === 'unicorn' || key === 'puppy') {
      await settle(page, 900);
      await shot(page, `adopt-${key}`, P);
    }
    await page.locator('.sw-panel-wrap.sw-open .lf-adopt-go').click();
    await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
    const after = await page.evaluate(() => window.__game.pets.pets.map((p) => [p.species, p.name, p.variant]));
    check(after.length === before + 1 && after[after.length - 1][0] === key && after[after.length - 1][1] === name,
      `adopted a ${key} named ${name} (${after[after.length - 1] && after[after.length - 1][2]}) through the Bag`);
    if (key === 'puppy') {
      await settle(page, 700);
      await shot(page, 'adopted-confetti', P);
    }
    // keep this one out of the way for the next taps
    await page.evaluate(() => { const g = window.__game; const p = g.pets.pets[g.pets.pets.length - 1]; g.pets.setMode(p, 'stay', { quiet: true }); });
    await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.x + 3, g.player.position.y, g.player.position.z); });
    await settle(page, 300);
    i++;
  }
  check(await ev(page, 'pet:adopt') === 7, 'pet:adopt fired for every adoption');

  // ----- a lineup of every species with variants (plus five more variants) -----
  await page.evaluate(() => {
    const g = window.__game, d = g.debug.pets;
    const extra = [['kitty', 'ginger', 'Mittens'], ['puppy', 'spotty', 'Pepper'], ['unicorn', 'blossom', 'Twinkle'], ['bunny', 'snowball', 'Poppy'], ['duckling', 'bubblegum', 'Pip']];
    for (const [s, v, n] of extra) d.adopt(s, v, n);
  });
  const lineup = await page.evaluate(() => {
    const g = window.__game;
    const pets = g.pets.pets;
    const p = g.player.position;
    const cx = Math.floor(p.x) + 0.5, cz = Math.floor(p.z) + 6;
    const y = g.world.heightAt(Math.floor(cx), Math.floor(cz)) + 1.01;
    const order = ['pony', 'puppy', 'kitty', 'bunny', 'duckling', 'panda', 'unicorn'];
    const sorted = pets.slice().sort((a, b) => order.indexOf(a.species) - order.indexOf(b.species));
    sorted.forEach((pet, k) => {
      const row = pet.spec.rideable ? 1 : 0;
      const idx = sorted.filter((q) => (q.spec.rideable ? 1 : 0) === row).indexOf(pet);
      const n = sorted.filter((q) => (q.spec.rideable ? 1 : 0) === row).length;
      const gap = row ? 1.6 : 1.05;
      pet.mode = 'stay';
      pet.teleport(cx + (idx - (n - 1) / 2) * gap, y, cz + row * 1.6, false);
      pet.yaw = Math.PI;
      pet.idleFor = 0;
      pet.anim.pose = 'stand';
      void k;
    });
    g.player.teleport(cx, y, cz - 5.2);
    g.cameraRig.setMode('first');
    g.cameraRig.yaw = 0;
    g.cameraRig.pitch = 0.16;
    return pets.length;
  });
  check(lineup === 12, `12 pets in the world (${lineup})`);
  await settle(page, 1400);
  await page.evaluate(() => { for (const p of window.__game.pets.pets) { p.yaw = Math.PI; p.anim.pose = 'stand'; p.anim.happy = 2; } window.__game.cameraRig.yaw = 0; });
  await settle(page, 350);
  await shot(page, 'pets-lineup', P);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.setMode('third'); g.cameraRig.distance = 4.5; });
  // a 13th pet is politely refused
  const refused = await page.evaluate(() => window.__game.debug.pets.adopt('puppy', 'golden', 'Extra'));
  check(refused === null, 'a 13th pet is refused (max 12 per world)');

  // ----- pet + feed the unicorn through the bubble -----
  const uni = await page.evaluate(() => window.__game.pets.pets.find((p) => p.species === 'unicorn').id);
  const uniPos = await page.evaluate((id) => {
    const g = window.__game, p = g.pets.byId(id), pl = g.player.position;
    const x = pl.x - 7, z = pl.z - 3;
    p.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
    p.yaw = 0;
    return [p.pos.x, p.pos.y, p.pos.z];
  }, uni);
  await faceTarget(page, uniPos[0] + 1, uniPos[1], uniPos[2] + 3, 3.6, 0.3, true);
  await tool(page, 'Hand');
  let at = await petPoint(page, uni);
  check(at && at.ok, 'the unicorn is under the pointer');
  const petted0 = await ev(page, 'pet:pet');
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.lf-bubble.lf-on', { timeout: 3000 });
  check(await ev(page, 'pet:pet') === petted0 + 1, 'Hand tap pets the unicorn (pet:pet)');
  await settle(page, 350);
  await shot(page, 'pet-bubble', P);
  await page.locator('.lf-bubble.lf-on .sw-round[aria-label="Feed"]').click();
  await settle(page, 200);
  await page.locator('.lf-bubble.lf-on .sw-round').first().click();
  await settle(page, 700);
  check(await ev(page, 'pet:feed') === 1, 'fed the unicorn a treat from the bubble (pet:feed)');
  await shot(page, 'pet-eating', P);
  await settle(page, 1800);

  // ----- ride the unicorn: rainbow trail, gentle flying, hop off -----
  await faceTarget(page, ...uniPos, 3.4, 0.3, false);
  await page.evaluate((id) => window.__game.pets.setMode(window.__game.pets.byId(id), 'follow'), uni);
  at = await petPoint(page, uni);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.lf-bubble.lf-on .sw-round[aria-label="Ride"]', { timeout: 3000 });
  await page.locator('.lf-bubble.lf-on .sw-round[aria-label="Ride"]').click();
  await settle(page, 300);
  const riding = await page.evaluate(() => ({ state: window.__game.player.state, rider: !!window.__game.pets.rider }));
  check(riding.state === 'ride' && riding.rider, 'Ride button mounts the unicorn');
  check(await ev(page, 'pet:ride') === 1, 'pet:ride fired');
  const stickers = await page.evaluate(() => !!window.__game.profile.stickers.unicorn_rider);
  check(stickers, 'unicorn_rider sticker earned');
  const start = await page.evaluate(() => { const p = window.__game.pets.rider.pos; return [p.x, p.y, p.z]; });
  await page.mouse.move(640, 700);
  await page.keyboard.down('w');
  await page.waitForTimeout(1300);
  await page.keyboard.down('Space');
  await page.waitForTimeout(1300);
  await page.keyboard.up('w');
  await page.keyboard.up('Space');
  // watch from the side while she glides across the sky
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.pets.rider.yaw - Math.PI / 2; g.cameraRig.pitch = 0.05; g.cameraRig.distance = 6; });
  await page.keyboard.down('a');
  await page.waitForTimeout(1300);
  await shot(page, 'unicorn-rainbow', P);
  await page.keyboard.up('a');
  const moved = await page.evaluate(([x, y, z]) => { const p = window.__game.pets.rider.pos; return { d: Math.hypot(p.x - x, p.z - z), up: p.y - y, py: window.__game.player.position.y - p.y }; }, start);
  check(moved.d > 3, `rode ${moved.d.toFixed(1)} blocks`);
  check(moved.up > 1.5, `the unicorn flew up ${moved.up.toFixed(1)} blocks`);
  check(Math.abs(moved.py - 1.03) < 0.2, 'the rider sits on the saddle');
  await page.waitForTimeout(2600);
  // a quick double-tap of Space (the fly shortcut) keeps her in the saddle
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  await page.keyboard.press('Space');
  await settle(page, 300);
  const still = await page.evaluate(() => ({ state: window.__game.player.state, flying: window.__game.player.flying }));
  check(still.state === 'ride' && !still.flying, `double-tapping Space while riding does not throw her off (${still.state})`);
  await page.locator('.lf-hud .sw-round[data-action="hopoff"]').click();
  await settle(page, 300);
  const off = await page.evaluate(() => ({ state: window.__game.player.state, rider: !!window.__game.pets.rider }));
  check(off.state !== 'ride' && !off.rider, `Hop off button dismounts (${off.state})`);

  // ----- everyone follows her on a walk (camera looking back at them) -----
  await page.evaluate(() => {
    const g = window.__game;
    for (const p of g.pets.pets) { if (p.mode !== 'follow') g.pets.setMode(p, 'follow', { quiet: true }); }
    g.cameraRig.setMode('third');
    g.cameraRig.distance = 6;
    g.cameraRig.pitch = 0.35;
  });
  await settle(page, 1500);
  await page.keyboard.down('s');
  await page.waitForTimeout(2600);
  await shot(page, 'pets-follow', P);
  await page.keyboard.up('s');
  const follow = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return g.pets.pets.filter((q) => Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < 10).length;
  });
  check(follow >= 10, `pets follow her on a walk (${follow} of 12 close by)`);

  // ----- a little pond: the duckling floats, the puppy paddles, both climb out -----
  const pond = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x0 = Math.floor(p.x) + 3, z0 = Math.floor(p.z) - 1, y = g.world.heightAt(x0, z0);
    for (let x = x0; x < x0 + 4; x++) for (let z = z0; z < z0 + 4; z++) {
      g.world.setKey(x, y, z, 'water', { record: false });
      g.world.setKey(x, y - 1, z, 'water', { record: false });
      g.world.setKey(x, y + 1, z, 'air', { record: false });
    }
    const duck = g.pets.pets.find((q) => q.species === 'duckling');
    const pup = g.pets.pets.find((q) => q.species === 'puppy');
    g.pets.setMode(duck, 'stay', { quiet: true });
    g.pets.setMode(pup, 'stay', { quiet: true });
    duck.teleport(x0 + 1.5, y + 0.2, z0 + 1.5, false);
    pup.teleport(x0 + 2.6, y + 0.2, z0 + 2.4, false);
    return { x0, z0, y, duck: duck.id, pup: pup.id };
  });
  await faceTarget(page, pond.x0 + 2, pond.y, pond.z0 + 2, 4.2, 0.45, true);
  await settle(page, 1800);
  await shot(page, 'pets-swim', P);
  const swim = await page.evaluate((pd) => {
    const g = window.__game, d = g.pets.byId(pd.duck), u = g.pets.byId(pd.pup);
    return { duck: d.swimming, pup: u.swimming, dy: d.pos.y - pd.y, uy: u.pos.y - pd.y };
  }, pond);
  check(swim.duck && swim.pup && swim.dy > -0.6 && swim.uy > -0.9, `pets float and paddle in water (duck ${swim.dy.toFixed(2)}, puppy ${swim.uy.toFixed(2)})`);
  await page.evaluate((pd) => { const g = window.__game; g.pets.setMode(g.pets.byId(pd.duck), 'follow', { quiet: true }); g.pets.setMode(g.pets.byId(pd.pup), 'follow', { quiet: true }); g.cameraRig.setMode('third'); }, pond);
  await page.evaluate((pd) => { const g = window.__game; g.player.teleport(pd.x0 - 4, pd.y + 1.01, pd.z0 + 2); }, pond);
  await page.waitForFunction((pd) => {
    const g = window.__game;
    return [pd.duck, pd.pup].every((id) => !g.pets.byId(id).swimming);
  }, pond, { timeout: 15000 }).catch(() => {});
  const out = await page.evaluate((pd) => [pd.duck, pd.pup].map((id) => window.__game.pets.byId(id).swimming), pond);
  check(out.every((sw) => !sw), 'pets climbed out of the pond to follow her');

  // ----- Pets panel -----
  await page.locator('.lf-hud .sw-round[data-action="pets"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="pets"] .lf-pet');
  await settle(page, 900);
  await shot(page, 'pets-panel', P);
  await page.locator('.sw-panel-wrap.sw-open .lf-pet').first().locator('button', { hasText: 'Call' }).click();
  await settle(page, 200);
  await page.keyboard.press('Escape');

  // ----- a pet bed at night (a stand-in bed if the Furniture team's is not here) -----
  const bedAt = await page.evaluate(() => {
    const g = window.__game;
    const pup = g.pets.pets.find((q) => q.species === 'puppy');
    for (const q of g.pets.pets) if (q !== pup) g.pets.setMode(q, 'stay', { quiet: true });
    const p = g.player.position;
    const x = Math.floor(p.x) + 22, z = Math.floor(p.z) + 8, y = g.world.heightAt(x, z) + 1;
    g.player.teleport(x + 0.5, y + 0.01, z - 3.5);
    g.debug.select('furn:pet_bed');
    g.debug.useAt(x, y - 1, z);
    const bed = g.entities.all().find((e) => e.key === 'pet_bed');
    g.pets.setMode(pup, 'follow', { quiet: true });
    pup.teleport(x + 1.5, y + 0.01, z - 1, false);
    g.debug.setTime(0.9);
    return bed ? [bed.x, bed.y, bed.z] : null;
  });
  check(!!bedAt, 'placed a pet bed from the Bag item');
  await page.waitForFunction(() => window.__game.pets.pets.some((p) => p.inBed && p.state === 'sleep'), null, { timeout: 20000 }).catch(() => {});
  const sleeper = await page.evaluate(() => { const p = window.__game.pets.pets.find((q) => q.inBed); return p ? [p.name, p.pos.x, p.pos.y, p.pos.z] : null; });
  check(!!sleeper, `a pet curled up in the pet bed at night (${sleeper && sleeper[0]})`);
  if (sleeper) {
    await faceTarget(page, sleeper[1], sleeper[2], sleeper[3], 3.4, 0.62, true);
    await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw += 0.25; g.setTool('build'); g.setSlot(g.hotbar.index, null); });
    await settle(page, 1800);
    await shot(page, 'pet-bed-night', P);
  }
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.setTime(0.3);
    g.cameraRig.setMode('third');
    for (const q of g.pets.pets) g.pets.setMode(q, 'follow', { quiet: true });
  });
  await settle(page, 2500);
  const awake = await page.evaluate(() => window.__game.pets.pets.every((p) => !p.inBed));
  check(awake, 'pets wake up in the morning');

  // ----- the bed is removed while a pet sleeps in it: the pet hops out (no mid-air naps) -----
  const bedGone = await page.evaluate(async () => {
    const g = window.__game;
    const until = async (fn, ms) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return false;
    };
    g.debug.setTime(0.9);
    const slept = await until(() => g.pets.pets.some((p) => p.inBed), 25000);
    const pet = g.pets.pets.find((p) => p.inBed);
    if (!slept || !pet) return { slept: false };
    g.entities.remove(g.entities.byUid(pet.bedUid));
    await until(() => !pet.inBed, 3000);
    const s = { slept: true, inBed: pet.inBed, state: pet.state, bedUid: pet.bedUid, claims: g.pets.bedClaims.size };
    g.debug.setTime(0.3);
    return s;
  });
  check(bedGone.slept && !bedGone.inBed && bedGone.state !== 'sleep' && bedGone.bedUid === null && bedGone.claims === 0,
    `a sleeping pet hops out when its bed is removed (${JSON.stringify(bedGone)})`);
  await settle(page, 600);

  // ----- garden: plant through the Bag, water, grow, harvest -----
  await page.evaluate(() => {
    const g = window.__game;
    for (const p of g.pets.pets) g.pets.setMode(p, 'home', { quiet: true });
    const p = g.player.position;
    const x = p.x - 10, z = p.z - 16;
    g.player.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z);
    g.cameraRig.yaw = 0;
    g.cameraRig.pitch = 0.55;
    g.cameraRig.distance = 4.5;
  });
  await settle(page, 600);
  await tool(page, 'Build');
  const planted = [];
  for (const [seed, side] of [['Carrot Seeds', 0], ['Strawberry Seeds', 1], ['Sunflower Seeds', -1], ['Rose Seeds', 2]]) {
    await openBag(page, 'Garden');
    await pickBagItem(page, seed);
    const gp = await groundPoint(page, { dist: 3, side });
    if (!gp) { check(false, 'ground for ' + seed); continue; }
    await page.mouse.click(gp.x, gp.y);
    await settle(page, 350);
    planted.push(gp.cell);
  }
  const plants = await page.evaluate(() => window.__game.debug.garden.plants());
  check(plants.length === 4, `planted 4 seeds through the Bag (${plants.map((p) => p.crop).join(', ')})`);
  const farmland = await page.evaluate((cells) => cells.map(([x, y, z]) => window.__game.debug.getBlock(x, y, z)), planted);
  check(farmland.every((k) => k === 'farmland'), `grass was tilled into farmland (${farmland.join(', ')})`);
  check(await ev(page, 'garden:plant') === 4, 'garden:plant fired 4 times');
  // a few more crops for the kitchen (pumpkin, blueberry, watermelon, tulip) next to them
  await page.evaluate(([x, y, z]) => {
    const d = window.__game.debug.garden;
    d.plant('pumpkin', x + 1, y, z + 1); d.plant('blueberry', x - 1, y, z + 1); d.plant('watermelon', x, y, z + 2); d.plant('tulip', x + 2, y, z + 1);
  }, planted[0]);
  const gardenView = async () => {
    await page.evaluate(([x, y, z]) => {
      const g = window.__game;
      const cx = x + 0.5, cz = z + 1.5;
      g.player.teleport(cx - 2.6, y + 1.01, cz - 2.6);
      g.cameraRig.setMode('first');
      g.cameraRig.yaw = Math.atan2(2.6, 2.6);
      g.cameraRig.pitch = 0.62;
    }, planted[0]);
    await settle(page, 300);
  };
  const thirdView = async () => {
    await page.evaluate(([x, y, z]) => {
      const g = window.__game;
      g.cameraRig.setMode('third');
      g.player.teleport(x + 0.5, y + 1.01, z - 3.2);
      g.cameraRig.yaw = 0;
      g.cameraRig.pitch = 0.55;
      g.cameraRig.distance = 4.5;
    }, planted[0]);
    await settle(page, 300);
  };
  await gardenView();
  await settle(page, 500);
  await shot(page, 'garden-0-seeds', P);
  await thirdView();
  // water with the can (Bag -> Watering Can -> tap the carrot)
  await openBag(page, 'Garden');
  await pickBagItem(page, 'Watering Can');
  const carrotTop = await page.evaluate(([x, y, z]) => {
    const g = window.__game, r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(x + 0.5, y + 1.1, z + 0.5).project(g.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, planted[0]);
  await page.mouse.click(carrotTop.x, carrotTop.y);
  await settle(page, 600);
  await shot(page, 'garden-water', P);
  const wet = await page.evaluate(([x, y, z]) => ({ block: window.__game.debug.getBlock(x, y, z), plant: window.__game.debug.garden.plants().find((p) => p.x === x && p.z === z) }), planted[0]);
  check(wet.block === 'farmland_wet' && wet.plant && wet.plant.wet, `watering darkened the farmland (${wet.block}) and wet the plant`);
  await settle(page, 900);
  await gardenView();
  for (const [secs, stage] of [[55, 1], [55, 2], [60, 3]]) {
    await page.evaluate((s) => window.__game.debug.garden.grow(s), secs);
    await settle(page, stage === 3 ? 2200 : 900);
    await shot(page, `garden-${stage}`, P);
    const st = await page.evaluate(() => window.__game.debug.garden.plants().map((p) => p.stage));
    check(st.filter((s) => s >= stage).length >= 4, `garden reached stage ${stage} (${st.join(',')})`);
  }
  await page.evaluate(() => window.__game.debug.garden.grow(200));
  await thirdView();
  await settle(page, 500);
  // harvest the carrot with the Hand
  await tool(page, 'Hand');
  const carrots0 = await page.evaluate(() => window.__game.profile.basket.carrot || 0);
  const carrotAt = await page.evaluate(([x, y, z]) => {
    const g = window.__game, r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(x + 0.5, y + 1.3, z + 0.5).project(g.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, planted[0]);
  await page.mouse.click(carrotAt.x, carrotAt.y);
  await settle(page, 350);
  await shot(page, 'garden-harvest', P);
  const carrots1 = await page.evaluate(() => window.__game.profile.basket.carrot || 0);
  check(carrots1 === carrots0 + 2, `harvested 2 carrots into the basket (${carrots0} -> ${carrots1})`);
  check(await ev(page, 'garden:harvest') === 1, 'garden:harvest fired');
  // harvest the rest (strawberries regrow, flowers become bouquets)
  await page.evaluate(() => {
    const d = window.__game.debug.garden;
    for (const p of d.plants()) if (p.stage === 3) d.harvest(p.x, p.y, p.z);
  });
  const basket = await page.evaluate(() => ({ ...window.__game.profile.basket }));
  check(basket.strawberry >= 3 && basket.rose >= 1 && basket.pumpkin >= 1, `crops and bouquets in the basket (${JSON.stringify(basket)})`);
  const regrow = await page.evaluate(() => window.__game.debug.garden.plants().filter((p) => p.crop === 'strawberry' || p.crop === 'blueberry').map((p) => p.stage));
  check(regrow.length === 2 && regrow.every((s) => s === 2), 'berry bushes stay and regrow after picking');
  await settle(page, 800);
  await shot(page, 'garden-after', P);

  // ----- cooking: two recipes through the panel -----
  await tool(page, 'Build');
  await page.locator('.lf-hud .sw-round[data-action="basket"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="basket"] .lf-food');
  await settle(page, 800);
  await shot(page, 'basket', P);
  await page.locator('.sw-panel-wrap.sw-open .lf-open-cook').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="cooking"] .lf-recipe img[src]');
  await settle(page, 1200);
  await shot(page, 'cook-book', P);

  async function cookRecipe(key, steps, stirBy) {
    await page.locator(`.sw-panel-wrap.sw-open .lf-recipe[data-recipe="${key}"]`).click();
    await page.waitForSelector('.sw-panel-wrap.sw-open .lf-ing');
    await settle(page, 300);
    // a wrong ingredient first: it wiggles and nothing goes in
    const wrong = await page.evaluate((first) => [...document.querySelectorAll('.sw-panel-wrap.sw-open .lf-ing')].map((b) => b.dataset.ing).find((k) => k !== first), steps[0]);
    await page.locator(`.sw-panel-wrap.sw-open .lf-ing[data-ing="${wrong}"]`).click();
    await settle(page, 200);
    let n = 0;
    for (const s of steps) {
      await page.locator(`.sw-panel-wrap.sw-open .lf-ing[data-ing="${s}"]`).click();
      await page.waitForTimeout(700);
      n++;
      if (n === 2) await shot(page, `cook-${key}-add`, P);
    }
    await page.waitForSelector('.sw-panel-wrap.sw-open .lf-hearts', { timeout: 5000 });
    const layers = await page.evaluate(() => document.querySelectorAll('.sw-panel-wrap.sw-open .lf-layer').length);
    check(layers === steps.length, `${key}: ${layers} ingredients went into the bowl in order`);
    const box = await page.locator('.sw-panel-wrap.sw-open .lf-bowl').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
    if (stirBy === 'circles') {
      await page.mouse.move(cx + 60, cy);
      await page.mouse.down();
      for (let a = 0; a <= Math.PI * 2 * 3.3; a += 0.3) {
        await page.mouse.move(cx + Math.cos(a) * 60, cy + Math.sin(a) * 40);
        await page.waitForTimeout(16);
        if (Math.abs(a - Math.PI * 2) < 0.15) await shot(page, `cook-${key}-stir`, P);
      }
      await page.mouse.up();
    } else {
      for (let t = 0; t < 8; t++) {
        await page.mouse.click(cx + (t % 2 ? 20 : -20), cy);
        await page.waitForTimeout(120);
      }
    }
    await page.waitForSelector('.sw-panel-wrap.sw-open .lf-cook-go', { timeout: 5000 });
    await page.locator('.sw-panel-wrap.sw-open .lf-cook-go').click();
    await page.waitForTimeout(1500);
    await shot(page, `cook-${key}-cooking`, P);
    await page.waitForSelector('.sw-panel-wrap.sw-open .lf-done .lf-result-title', { timeout: 8000 });
    await settle(page, 900);
    await shot(page, `cook-${key}-done`, P);
  }

  const cooked0 = await ev(page, 'cook:done');
  await cookRecipe('cupcake', ['flour', 'sugar', 'egg', 'milk', 'sprinkles'], 'circles');
  const cupcakes = await page.evaluate(() => window.__game.profile.basket.cupcake || 0);
  check(cupcakes === 2, `2 cupcakes in the basket (${cupcakes})`);
  await page.locator('.sw-panel-wrap.sw-open .lf-done button', { hasText: 'Recipes' }).click();
  await settle(page, 400);
  await cookRecipe('carrot_soup', ['carrot', 'carrot', 'water', 'cream'], 'taps');
  const soup = await page.evaluate(() => ({ soup: window.__game.profile.basket.carrot_soup || 0, carrots: window.__game.profile.basket.carrot || 0 }));
  check(soup.soup === 1 && soup.carrots === 0, `carrot soup cooked from 2 garden carrots (${JSON.stringify(soup)})`);
  check(await ev(page, 'cook:done') === cooked0 + 2, 'cook:done fired twice');
  const chef = await page.evaluate(() => !!window.__game.profile.stickers.little_chef);
  check(chef, 'little_chef sticker earned');
  await page.locator('.sw-panel-wrap.sw-open .lf-done button', { hasText: 'Done' }).click();
  await settle(page, 300);

  // ----- eat from the basket -----
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.2; g.cameraRig.yaw += Math.PI; });
  await page.locator('.lf-hud .sw-round[data-action="basket"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .lf-food[data-food="cupcake"]');
  await settle(page, 500);
  console.log('  (panel before basket-full shot: ' + await page.evaluate(() => window.__game.ui.current) + ')');
  await shot(page, 'basket-full', P);
  await page.locator('.sw-panel-wrap.sw-open .lf-food[data-food="cupcake"] .lf-act-eat').click();
  await settle(page, 700);
  await shot(page, 'eat', P);
  await settle(page, 1500);
  const ate = await page.evaluate(() => ({ n: window.__game.profile.basket.cupcake || 0 }));
  check(ate.n === 1 && await ev(page, 'food:eat') === 1, `ate a cupcake (food:eat, ${ate.n} left)`);

  // ----- put food on a table -----
  const table = await page.evaluate(() => {
    const g = window.__game, p = g.player.position, yaw = g.cameraRig.yaw;
    const x = Math.floor(p.x + Math.sin(yaw) * 3), z = Math.floor(p.z + Math.cos(yaw) * 3);
    const y = g.world.heightAt(x, z) + 1;
    g.debug.place('table_round', x, y, z);
    const t = g.entities.at(x, y, z);
    return t ? { uid: t.uid, x, y, z } : null;
  });
  check(!!table, 'a table to put food on');
  await page.locator('.lf-hud .sw-round[data-action="basket"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .lf-food[data-food="cupcake"]');
  await page.locator('.sw-panel-wrap.sw-open .lf-food[data-food="cupcake"] .lf-act-table').click();
  await settle(page, 300);
  await faceTarget(page, table.x + 0.5, table.y, table.z + 0.5, 2.8, 0.55);
  const tableTop = await page.evaluate((t) => {
    const g = window.__game, r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(t.x + 0.5, t.y + 0.82, t.z + 0.5).project(g.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, table);
  await page.mouse.click(tableTop.x, tableTop.y);
  await settle(page, 600);
  const onTable = await page.evaluate((uid) => window.__game.entities.all().filter((e) => e.key === 'food_cupcake').map((e) => ({ restsOn: e.restsOn, y: e.y })), table.uid);
  check(onTable.length === 1 && onTable[0].restsOn === table.uid, 'the cupcake stands on the table');
  const left = await page.evaluate(() => window.__game.profile.basket.cupcake || 0);
  check(left === 0, 'placing it took it out of the basket');
  // a bouquet in a vase too
  await page.evaluate((t) => {
    const g = window.__game;
    g.debug.place('table_round', t.x + 1, t.y, t.z);
    g.entities.place('food_rose', t.x + 1, t.y + 1, t.z, 0);
    g.debug.place('table_round', t.x - 1, t.y, t.z);
    g.debug.cooking.give('birthday_cake', 1);
    g.entities.place('food_birthday_cake', t.x - 1, t.y + 1, t.z, 0);
  }, table);
  await settle(page, 800);
  await shot(page, 'table-food', P);
  // Hand-tap the cupcake on the table: she eats it
  await tool(page, 'Hand');
  const foodUid = await page.evaluate(() => window.__game.entities.all().find((e) => e.key === 'food_cupcake').uid);
  await page.evaluate((uid) => window.__game.debug.interact(uid), foodUid);
  await settle(page, 400);
  const gone = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key === 'food_cupcake').length);
  check(gone === 0 && await ev(page, 'food:eat') === 2, 'Hand-tap eats the cupcake on the table');

  // ----- Bag food tab lists what we own -----
  await openBag(page, 'Food');
  await settle(page, 600);
  const foodNames = await page.evaluate(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item-name')].map((e) => e.textContent));
  check(foodNames.some((n) => /Carrot Soup/.test(n)) && foodNames.includes('Recipe Book'), `Bag Food tab lists owned food (${foodNames.join(', ')})`);
  await shot(page, 'bag-food', P);
  await page.keyboard.press('Escape');

  // ----- save, reload, everything is still there -----
  const saved = await page.evaluate(() => window.__game.debug.save());
  check(saved && saved.ok, 'world saved');
  const counts = await page.evaluate(() => ({ pets: window.__game.pets.pets.length, plants: window.__game.debug.garden.plants().length, soup: window.__game.profile.basket.carrot_soup }));
  const worldId = await page.evaluate(() => window.__game.world.meta.id);
  await page.reload();
  await waitForTitle(page);
  await page.evaluate((id) => window.__game.loadWorld(id), worldId);
  await waitForPlay(page);
  await waitIdle(page);
  await settle(page, 800);
  const back = await page.evaluate(() => ({ pets: window.__game.pets.pets.length, names: window.__game.pets.pets.map((p) => p.name), plants: window.__game.debug.garden.plants().length, soup: window.__game.profile.basket.carrot_soup, vase: window.__game.entities.all().some((e) => e.key === 'food_rose') }));
  check(back.pets === counts.pets && back.names.includes('Sprinkles'), `pets came back after reload (${back.pets})`);
  check(back.plants === counts.plants, `garden came back after reload (${back.plants})`);
  check(back.soup === counts.soup && back.vase, 'basket and table food came back after reload');
  await shot(page, 'reloaded', P);
  await context.close();
}

// ---------------------------------------------------------------- touch (iPad, then a phone)

async function touch(browser) {
  console.log('Touch pass (iPad 1024x768, hasTouch)');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'ipad' });
  await startWorld(page, 'meadow', { tap: true });
  await trackEvents(page);
  await page.evaluate(() => window.__game.setDayTime(0.4));
  await settle(page, 500);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.5; });
  await settle(page, 300);
  // adopt a kitty with taps
  await openBag(page, 'Pets', true);
  await pickBagItem(page, 'Kitty', true);
  const gp = await groundPoint(page, { dist: 3.5, side: 0 });
  check(!!gp, 'a clear patch of ground to tap');
  if (gp) {
    await page.touchscreen.tap(gp.x, gp.y);
    await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="adopt"] .lf-variant');
    await settle(page, 900);
    await page.locator('.sw-panel-wrap.sw-open .lf-variant').nth(3).tap();
    await settle(page, 700);
    await shot(page, 'ipad-adopt', P);
    await page.locator('.sw-panel-wrap.sw-open .sw-chip').nth(1).tap();
    await page.locator('.sw-panel-wrap.sw-open .lf-adopt-go').tap();
    await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
  }
  const kitty = await page.evaluate(() => window.__game.pets.pets[0] && { id: window.__game.pets.pets[0].id, species: window.__game.pets.pets[0].species, variant: window.__game.pets.pets[0].variant });
  check(kitty && kitty.species === 'kitty' && kitty.variant === 'midnight', `adopted a Midnight kitty with taps (${kitty && kitty.variant})`);
  // pet it with the Hand tool and give it a treat
  if (kitty) {
    await page.evaluate((id) => window.__game.pets.setMode(window.__game.pets.byId(id), 'stay'), kitty.id);
    const pos = await page.evaluate((id) => { const p = window.__game.pets.byId(id); return [p.pos.x, p.pos.y, p.pos.z]; }, kitty.id);
    await faceTarget(page, ...pos, 4.2, 0.38, true);
    await tool(page, 'Hand', true);
    const at = await petPoint(page, kitty.id);
    check(at && at.ok, 'the kitty is under the finger');
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForSelector('.lf-bubble.lf-on', { timeout: 3000 });
    await settle(page, 300);
    await shot(page, 'ipad-bubble', P);
    await page.locator('.lf-bubble.lf-on .sw-round[aria-label="Feed"]').tap();
    await page.locator('.lf-bubble.lf-on .sw-round').first().tap();
    await settle(page, 400);
    check(await ev(page, 'pet:pet') >= 1 && await ev(page, 'pet:feed') === 1, 'tap petted and fed the kitty');
  }
  // plant a rose with taps
  await tool(page, 'Build', true);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw += Math.PI / 2; g.cameraRig.pitch = 0.6; });
  await settle(page, 300);
  await openBag(page, 'Garden', true);
  await pickBagItem(page, 'Rose Seeds', true);
  const gp2 = await groundPoint(page, { dist: 3, side: 0 });
  if (gp2) await page.touchscreen.tap(gp2.x, gp2.y);
  await settle(page, 400);
  check(await ev(page, 'garden:plant') === 1, 'planted a rose with a tap');
  // the Basket HUD button with a tap
  await page.locator('.lf-hud .sw-round[data-action="basket"]').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="basket"]');
  await settle(page, 500);
  await shot(page, 'ipad-basket', P);
  // HUD must not show through the open panel
  const onTop = await page.evaluate(() => [...document.querySelectorAll('.lf-hud button')].filter((el) => el.offsetParent).filter((el) => {
    const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && el.contains(hit);
  }).length);
  check(onTop === 0, 'life HUD buttons stay under open panels');
  await page.locator('.sw-panel-wrap.sw-open .sw-close').tap();
  await context.close();

  console.log('Touch pass (phone 390x844): cooking panel');
  const ph = await openGame(browser, { errors, viewport: { width: 390, height: 844 }, touch: true, label: 'phone' });
  const pg = ph.page;
  await pg.evaluate(() => window.__game.debug.newWorld({ biome: 'flat', name: 'Phone Kitchen' }));
  await waitForPlay(pg);
  await waitIdle(pg);
  await trackEvents(pg);
  await pg.evaluate(() => window.__game.ui.open('cooking', { station: 'fridge' }));
  await pg.waitForSelector('.sw-panel-wrap.sw-open .lf-recipe img[src]');
  await pg.waitForFunction(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .lf-recipe img')].slice(0, 12).every((i) => i.style.visibility === 'visible'), null, { timeout: 15000 }).catch(() => {});
  await settle(pg, 400);
  await shot(pg, 'phone-cook-book', P);
  await pg.locator('.sw-panel-wrap.sw-open .lf-recipe[data-recipe="ice_cream"]').tap();
  for (const s of ['milk', 'cream', 'sugar', 'sprinkles']) {
    await pg.locator(`.sw-panel-wrap.sw-open .lf-ing[data-ing="${s}"]`).tap();
    await pg.waitForTimeout(650);
  }
  await shot(pg, 'phone-cook-bowl', P);
  const b = await pg.locator('.sw-panel-wrap.sw-open .lf-bowl').boundingBox();
  for (let t = 0; t < 8; t++) {
    await pg.touchscreen.tap(b.x + b.width / 2 + (t % 2 ? 15 : -15), b.y + b.height * 0.6);
    await pg.waitForTimeout(120);
  }
  await pg.waitForSelector('.sw-panel-wrap.sw-open .lf-cook-go', { timeout: 5000 });
  await pg.locator('.sw-panel-wrap.sw-open .lf-cook-go').tap();
  await pg.waitForTimeout(1400);
  await shot(pg, 'phone-cook-freeze', P);
  await pg.waitForSelector('.sw-panel-wrap.sw-open .lf-done .lf-result-title', { timeout: 8000 });
  await settle(pg, 800);
  await shot(pg, 'phone-cook-done', P);
  check(await ev(pg, 'cook:done') === 1, 'cooked ice cream on a phone with taps');
  await pg.locator('.sw-panel-wrap.sw-open .lf-eat-now').tap();
  await settle(pg, 900);
  await shot(pg, 'phone-eat', P);
  check(await ev(pg, 'food:eat') === 1, 'ate it right away from the result screen');
  await ph.context.close();
}

async function main() {
  const opts = parseArgs();
  const browser = await launch(opts);
  try {
    if (opts.only !== 'touch') await desktop(browser);
    if (opts.only !== 'desktop') await touch(browser);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
