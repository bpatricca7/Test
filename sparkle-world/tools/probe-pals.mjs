// "Pals" play test: more pets (turtle, horse, dog and cat breeds) and cool girl friends.
// Drives the real UI (Bag, adoption panel, pet and friend bubbles, the Friends panel, HUD
// buttons, the emote keys) with mouse clicks and touch taps.
//
//   node tools/probe-pals.mjs [--only=lineup|desktop|touch] [--headed]
//
// Screenshots: .shots/pals-*.png. Fails on any console error or failed check.

import { launch, openGame, startWorld, waitForPlay, waitIdle, shot, settle, finish, parseArgs } from './smoke.mjs';

const P = 'pals';
const errors = [];

function check(cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

async function trackEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    window.__palsEv = {};
    for (const n of ['pet:adopt', 'pet:pet', 'pet:ride', 'friend:invite', 'friend:talk', 'friend:treat', 'friend:style', 'friends:dance', 'emote', 'sticker:earned', 'time:morning']) {
      g.events.on(n, () => { window.__palsEv[n] = (window.__palsEv[n] || 0) + 1; });
    }
  });
}
const ev = (page, n) => page.evaluate((n) => (window.__palsEv && window.__palsEv[n]) || 0, n);

/** Wait for a condition in the page (polling), returning its last value. */
async function until(page, fn, arg, timeout = 20000) {
  try {
    const h = await page.waitForFunction(fn, arg, { timeout, polling: 200 });
    return await h.jsonValue();
  } catch {
    return page.evaluate(fn, arg);
  }
}

/** A clear patch of ground in view: page coords of its top face (and the cell). */
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
      const onTop = hit && hit.type === 'block' && hit.x === x && hit.z === z && ((hit.y === y && hit.face[1] === 1) || (hit.y === y + 1 && g.registry.blocks.props.replaceable[hit.id]));
      if (!onTop) continue;
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, cell: [x, y, z] };
    }
    return null;
  }, { dist, side });
}

/** Page point of a pet's or friend's body, and whether a pick there finds it. */
async function bodyPoint(page, kind, id) {
  return page.evaluate(([kind, id]) => {
    const g = window.__game;
    const o = kind === 'pet' ? g.pets.byId(id) : g.friends.byId(id);
    if (!o) return null;
    const b = o.box;
    const cx = (b.min.x + b.max.x) / 2, cy = b.min.y + (b.max.y - b.min.y) * 0.55, cz = (b.min.z + b.max.z) / 2;
    const r = g.renderer.domElement.getBoundingClientRect();
    const v = g.camera.position.clone().set(cx, cy, cz).project(g.camera);
    if (v.z > 1) return null;
    const hit = g.pick({ x: v.x, y: v.y });
    const ok = !!hit && hit.type === 'pickable' && hit.pickable.ref === o;
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, ok };
  }, [kind, id]);
}

/** Stand the player dist blocks from a point, looking at it. */
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
    g.player.yaw = Math.atan2(x - px, z - pz);
    g.cameraRig.yaw = Math.atan2(x - px, z - pz);
    g.cameraRig.pitch = pitch;
    g.cameraRig.distance = 4.5;
  }, [x, y, z, dist, pitch, first]);
  await settle(page, 450);
}

async function openBag(page, tab, tap = false) {
  const press = (l) => (tap ? l.tap() : l.click());
  await press(page.locator('.sw-bagbtn').first());
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

async function press(page, locator, tap) {
  if (tap) await locator.tap(); else await locator.click();
}

/** Tap / click a friend or a pet with the current tool (retrying while it moves a little). */
async function tapBody(page, kind, id, tap = false) {
  for (let i = 0; i < 4; i++) {
    const at = await bodyPoint(page, kind, id);
    if (at && at.ok) {
      if (tap) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
      return true;
    }
    await settle(page, 300);
  }
  return false;
}

/** Keep a friend still and in front of the camera (for clicks). */
async function holdFriend(page, id) {
  await page.evaluate((id) => { const f = window.__game.friends.byId(id); if (f) { f.attention = 3; f.stop(); } }, id);
}

// ---------------------------------------------------------------- lineup

async function lineup(browser) {
  console.log('Lineup pass (every pet, breed and coat)');
  const { context, page } = await openGame(browser, { errors, label: 'lineup' });
  await page.evaluate(() => window.__game.debug.newWorld({ biome: 'flat', name: 'Pet Parade' }));
  await waitForPlay(page);
  await waitIdle(page);
  await page.evaluate(() => { window.__game.setDayTime(0.34); });
  const batches = [
    ['dogs', [['puppy', null]]],
    ['cats', [['kitty', null]]],
    ['turtles-horses', [['turtle', null], ['horse', null]]],
    ['all-species', [['puppy', 'golden'], ['kitty', 'ginger'], ['bunny', 'snowball'], ['panda', 'classic'], ['duckling', 'sunny'], ['turtle', 'rainbow'], ['pony', 'strawberry'], ['unicorn', 'pearl'], ['horse', 'palomino']]],
  ];
  let total = 0;
  for (const [name, list] of batches) {
    const res = await page.evaluate((list) => {
      const g = window.__game, d = g.debug.pets;
      for (const p of g.pets.pets.slice()) g.pets.remove(p);
      const p = g.player.position;
      const cx = Math.floor(p.x) + 0.5, cz = Math.floor(p.z) + 0.5;
      // small pets in rows of five, the big ones (ponies, unicorns, horses) behind them
      const small = [], big = [];
      for (const [s, v] of list) {
        const spec = g.registry.pets.get(s);
        const vs = v ? [spec.variants.find((x) => x.key === v)] : spec.variants;
        for (const vv of vs) (spec.rideable ? big : small).push([s, vv]);
      }
      const rows = [];
      for (let i = 0; i < small.length; i += 5) rows.push({ list: small.slice(i, i + 5), gap: 1.35, depth: 1.5 });
      for (let i = 0; i < big.length; i += 5) rows.push({ list: big.slice(i, i + 5), gap: 2.3, depth: 2.6 });
      const out = [];
      let z = cz + 4.2;
      rows.forEach((row) => {
        row.list.forEach(([s, v], i) => {
          const x = cx + (i - (row.list.length - 1) / 2) * row.gap;
          const y = g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01;
          const pet = g.pets.adopt(s, v.key, v.name, [x, y, z], { fx: false, opts: s === 'horse' && i % 2 ? { braids: true } : null });
          if (!pet) return;
          pet.yaw = Math.PI;
          pet._think = () => { pet.anim.pose = 'stand'; pet.lookAtPlayer = false; };
          out.push(d.info(pet.id));
        });
        z += row.depth;
      });
      g.cameraRig.setMode('first');
      g.cameraRig.yaw = 0;
      g.cameraRig.pitch = big.length ? 0.14 : 0.3;
      return out;
    }, list);
    total += res.length;
    const merged = res.filter((r) => r.merged && r.meshes <= 4).length;
    check(merged === res.length, `${name}: every pet is one merged mesh (+ shadow and tag) (${merged}/${res.length})`);
    await settle(page, 3600);
    await page.evaluate(() => { for (const p of window.__game.pets.pets) { p.yaw = Math.PI; p.anim.happy = 2; } });
    await settle(page, 350);
    await shot(page, `lineup-${name}`, P);
  }
  const species = await page.evaluate(() => [...window.__game.registry.pets.keys()]);
  check(species.includes('turtle') && species.includes('horse'), `species include turtle and horse (${species.join(' ')})`);
  const breeds = await page.evaluate(() => {
    const r = window.__game.registry.pets;
    return { dogs: r.get('puppy').variants.filter((v) => v.group === 'breeds').map((v) => v.key), cats: r.get('kitty').variants.filter((v) => v.group === 'breeds').map((v) => v.key) };
  });
  check(['retriever', 'dalmatian', 'corgi', 'poodle', 'husky'].every((k) => breeds.dogs.includes(k)), `dog breeds: ${breeds.dogs.join(', ')}`);
  check(['tabby', 'siamese', 'calico', 'persian', 'black'].every((k) => breeds.cats.includes(k)), `cat breeds: ${breeds.cats.join(', ')}`);
  console.log(`  ${total} pets shown`);
  await context.close();
}

// ---------------------------------------------------------------- desktop

async function adoptViaUI(page, label, variant, { braids = false, shotName = null, side = 0 } = {}) {
  await openBag(page, 'Pets');
  await pickBagItem(page, label);
  const gp = await groundPoint(page, { dist: 4.2, side });
  if (!gp) throw new Error('no clear ground for ' + label);
  await page.mouse.click(gp.x, gp.y);
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="adopt"] .lf-variant');
  await page.locator(`.sw-panel-wrap.sw-open .lf-variant[data-variant="${variant}"]`).click();
  if (braids) await page.locator('.sw-panel-wrap.sw-open .lf-opt[data-braids="1"]').click();
  await settle(page, 900);
  if (shotName) await shot(page, shotName, P);
  const before = await page.evaluate(() => window.__game.pets.pets.length);
  await page.locator('.sw-panel-wrap.sw-open .lf-adopt-go').click();
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
  const pet = await page.evaluate(() => { const p = window.__game.pets.pets[window.__game.pets.pets.length - 1]; return { id: p.id, species: p.species, variant: p.variant, opts: p.opts, n: window.__game.pets.pets.length }; });
  check(pet.n === before + 1, `adopted a ${pet.species} (${pet.variant}${pet.opts.braids ? ', braided mane' : ''}) through the Bag`);
  return pet;
}

async function inviteViaBag(page, key, { first = true, tap = false, side = 0 } = {}) {
  if (first) {
    await openBag(page, 'Fun', tap);
    await pickBagItem(page, 'Invite a Friend', tap);
  }
  await tool(page, 'Build', tap);
  const gp = await groundPoint(page, { dist: 4, side });
  if (!gp) throw new Error('no clear ground to invite ' + key);
  if (tap) await page.touchscreen.tap(gp.x, gp.y); else await page.mouse.click(gp.x, gp.y);
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="friends"] .pl-invite');
  return gp;
}

async function pickFriendCard(page, key, tap = false) {
  const before = await page.evaluate(() => window.__game.friends.friends.length);
  await press(page, page.locator(`.sw-panel-wrap.sw-open[data-panel="friends"] .pl-invite[data-friend="${key}"]`), tap);
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
  const f = await page.evaluate((key) => { const f = window.__game.friends.byKey(key); return f ? { id: f.id, name: f.name, n: window.__game.friends.friends.length } : null; }, key);
  check(f && f.n === before + 1, `invited ${f ? f.name : key} with the friend card`);
  return f;
}

async function desktop(browser) {
  console.log('Desktop pass (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await startWorld(page, 'flat');
  await trackEvents(page);
  await page.evaluate(() => { window.__game.setDayTime(0.34); });
  await settle(page, 500);

  // ----- adopt a turtle, a braided horse and a corgi through the Bag -----
  const turtle = await adoptViaUI(page, 'Turtle', 'rainbow', { shotName: 'adopt-turtle', side: -1 });
  check(turtle.species === 'turtle' && turtle.variant === 'rainbow', 'the rainbow turtle is home');
  await page.evaluate((id) => { const g = window.__game; g.pets.setMode(g.pets.byId(id), 'stay', { quiet: true }); g.player.teleport(g.player.position.x + 3, g.player.position.y, g.player.position.z); }, turtle.id);
  const horse = await adoptViaUI(page, 'Horse', 'palomino', { braids: true, shotName: 'adopt-horse' });
  check(horse.species === 'horse' && horse.opts.braids === true, 'the palomino horse has a braided mane');
  await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.x + 3, g.player.position.y, g.player.position.z); });
  const corgi = await adoptViaUI(page, 'Puppy', 'corgi', { shotName: 'adopt-breeds', side: 1 });
  check(corgi.variant === 'corgi', 'a corgi puppy from the Breeds list');
  const groups = await page.evaluate(() => window.__game.pets.pets.length);
  check(groups === 3, '3 pets adopted');
  check(await ev(page, 'pet:adopt') === 3, 'pet:adopt fired for each');
  check(await page.evaluate(() => !!window.__game.profile.stickers.shell_buddy), 'Shell Buddy sticker for the turtle');

  // ----- ride the horse: bigger and faster than a pony -----
  const hp = await page.evaluate((id) => {
    const g = window.__game, p = g.pets.byId(id), pl = g.player.position;
    const x = pl.x + 2, z = pl.z + 5;
    p.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
    g.pets.setMode(p, 'stay', { quiet: true });
    return [p.pos.x, p.pos.y, p.pos.z];
  }, horse.id);
  await faceTarget(page, hp[0], hp[1], hp[2], 4.2, 0.25);
  await tool(page, 'Hand');
  check(await tapBody(page, 'pet', horse.id), 'Hand-tapped the horse');
  await page.waitForSelector('.lf-bubble.lf-on .sw-round[aria-label="Ride"]', { timeout: 4000 });
  await page.locator('.lf-bubble.lf-on .sw-round[aria-label="Ride"]').click();
  await settle(page, 300);
  const riding = await page.evaluate(() => ({ state: window.__game.player.state, rider: window.__game.pets.rider && window.__game.pets.rider.species }));
  check(riding.state === 'ride' && riding.rider === 'horse', 'Ride button mounts the horse');
  check(await page.evaluate(() => !!window.__game.profile.stickers.giddy_up), 'Giddy Up! sticker earned');
  await page.mouse.move(640, 700);
  await page.keyboard.down('w');
  await page.waitForTimeout(1800);
  const speed = await page.evaluate(() => window.__game.pets.rider.hs);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.pets.rider.yaw - Math.PI / 2 + 0.3; g.cameraRig.pitch = 0.1; g.cameraRig.distance = 7; });
  await page.waitForTimeout(700);
  await shot(page, 'horse-ride', P);
  await page.keyboard.up('w');
  const seat = await page.evaluate(() => window.__game.player.position.y - window.__game.pets.rider.pos.y);
  check(speed > 7.4, `the horse gallops faster than a pony (${speed.toFixed(1)} blocks/s, a pony trots 7.4)`);
  check(Math.abs(seat - 1.4) < 0.25, `she sits high in the saddle (${seat.toFixed(2)})`);
  await page.locator('.lf-hud .sw-round[data-action="hopoff"]').click();
  await settle(page, 300);
  check(await page.evaluate(() => window.__game.player.state !== 'ride'), 'Hop off');

  // ----- tickle the turtle: it hides in its shell, then peeks out -----
  const tp = await page.evaluate(([id, hid]) => {
    const g = window.__game, p = g.pets.byId(id), pl = g.player.position;
    const h = g.pets.byId(hid);
    h.teleport(pl.x + 6, pl.y, pl.z - 6, false);
    const x = pl.x - 4, z = pl.z + 4;
    p.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
    return [p.pos.x, p.pos.y, p.pos.z];
  }, [turtle.id, horse.id]);
  await faceTarget(page, tp[0], tp[1], tp[2], 2.2, 0.62, true);
  await tool(page, 'Remove');
  check(await tapBody(page, 'pet', turtle.id), 'Remove-tool tapped the turtle');
  await settle(page, 650);
  const hid = await page.evaluate((id) => window.__game.debug.pets.info(id), turtle.id);
  check(hid.hide > 0.6, `the turtle hides in its shell (hide ${hid.hide.toFixed(2)})`);
  check(await page.evaluate(() => window.__game.pets.pets.length) === 3, 'the Remove tool never removes a pet');
  await shot(page, 'turtle-hides', P);
  await until(page, (id) => window.__game.debug.pets.info(id).hide < 0.1, turtle.id, 25000);
  check(await page.evaluate((id) => window.__game.debug.pets.info(id).hide < 0.1, turtle.id), 'and peeks back out');
  await page.evaluate(() => window.__game.cameraRig.setMode('third'));
  await tool(page, 'Hand');

  // ----- a pool: the turtle swims fast -----
  const pool = await page.evaluate((id) => {
    const g = window.__game, pl = g.player.position;
    const x0 = Math.floor(pl.x) + 3, z0 = Math.floor(pl.z) - 6, y = g.world.heightAt(x0, z0);
    const water = g.registry.blocks.idOf('water');
    g.world.batch(() => {
      for (let x = x0; x < x0 + 12; x++) for (let z = z0; z < z0 + 4; z++) for (let yy = y - 1; yy <= y; yy++) g.world.set(x, yy, z, water, { record: false });
    });
    const p = g.pets.byId(id);
    p.teleport(x0 + 1.5, y + 0.3, z0 + 2, false);
    p.mode = 'home';
    p.home = [x0 + 11, y + 1, z0 + 2];
    return [x0, y, z0];
  }, turtle.id);
  await faceTarget(page, pool[0] + 6, pool[1], pool[2] + 2, 6, 0.4);
  await until(page, (id) => { const p = window.__game.pets.byId(id); return p.swimming && p.hs > 3.2; }, turtle.id, 8000);
  const swim = await page.evaluate((id) => { const p = window.__game.pets.byId(id); return { swimming: p.swimming, hs: p.hs }; }, turtle.id);
  check(swim.swimming && swim.hs > 3.2, `the turtle swims fast (${swim.hs.toFixed(1)} blocks/s; it walks 2.1)`);
  await shot(page, 'turtle-swims', P);
  await page.evaluate((id) => { const g = window.__game; g.pets.setMode(g.pets.byId(id), 'stay', { quiet: true }); }, turtle.id);

  // ----- friends: invite three through the Bag and the Friends button -----
  await page.evaluate(() => {
    const g = window.__game, pl = g.player.position;
    // the pets wait by the pool
    for (const p of g.pets.pets) g.pets.setMode(p, 'stay', { quiet: true });
    g.player.teleport(pl.x, pl.y, pl.z + 12);
    g.cameraRig.setMode('third');
  });
  await settle(page, 500);
  await inviteViaBag(page, 'mia');
  await until(page, () => document.querySelectorAll('.sw-panel-wrap.sw-open .pl-invite img[src^="data:"]').length >= 10, null, 25000);
  await settle(page, 300);
  await shot(page, 'friends-panel', P);
  const mia = await pickFriendCard(page, 'mia');
  check(await ev(page, 'friend:invite') === 1, 'friend:invite fired');
  await settle(page, 1200);
  await shot(page, 'friend-arrives', P);
  check(await page.evaluate(() => !!window.__game.profile.stickers.bff), 'Best Friends Forever sticker');
  // the Invite item stays in the hotbar: tap the ground again for Zoe
  await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.x + 2.5, g.player.position.y, g.player.position.z); });
  await settle(page, 300);
  await inviteViaBag(page, 'zoe', { first: false, side: 1 });
  const zoe = await pickFriendCard(page, 'zoe');
  // the Friends HUD button: Ava pops in right in front of her
  await page.locator('.lf-hud .sw-round[data-action="friends"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="friends"] .pl-card');
  check(await page.locator('.sw-panel-wrap.sw-open .pl-card').count() === 2, 'the Friends panel lists 2 friends');
  const ava = await pickFriendCard(page, 'ava');
  check(!!(mia && zoe && ava), 'three friends are here');
  const ids = [mia.id, zoe.id, ava.id];

  // ----- talk -----
  await page.evaluate((ids) => {
    const g = window.__game, pl = g.player.position;
    ids.forEach((id, i) => {
      const f = g.friends.byId(id);
      const x = pl.x - 1.6 + i * 1.6, z = pl.z + 3.2;
      f.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
      f.mode = 'stay';
      f.yaw = Math.PI;
    });
    g.cameraRig.yaw = 0;
    g.player.yaw = 0;
    g.cameraRig.pitch = 0.3;
    g.cameraRig.distance = 5;
  }, ids);
  await settle(page, 800);
  await tool(page, 'Hand');
  await holdFriend(page, mia.id);
  check(await tapBody(page, 'friend', mia.id), 'Hand-tapped Mia');
  await page.waitForSelector('.pl-bubble.pl-on', { timeout: 4000 });
  const btns = await page.locator('.pl-bubble.pl-on .sw-round').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(['Talk', 'Follow me', 'Dance', 'Treat', 'Dress up'].every((l) => btns.includes(l)), `bubble buttons: ${btns.join(', ')}`);
  const talk0 = await ev(page, 'friend:talk');
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Talk"]').click();
  await settle(page, 500);
  const said = await page.locator('.pl-bubble.pl-on .pl-bubble-line').textContent();
  check(await ev(page, 'friend:talk') > talk0 && said && said.length > 3, `Mia talks: "${said}"`);
  await shot(page, 'friend-talk', P);
  const lines = await page.evaluate(() => window.__game.debug.friends.lines());
  check(lines >= 60, `${lines} different friend lines`);

  // ----- dance together -----
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Dance"]').click();
  const dancers = await until(page, () => window.__game.friends.friends.filter((f) => f.avatar.emoting === 'dance').length >= 3 && window.__game.friends.friends.length, null, 5000);
  const nd = await page.evaluate(() => window.__game.friends.friends.filter((f) => f.avatar.emoting === 'dance').length);
  check(nd >= 3, `everyone dances together (${nd} friends dancing, she dances: ${await page.evaluate(() => window.__game.player.avatar.emoting)})`);
  void dancers;
  await page.mouse.click(640, 560);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = 0.55; g.cameraRig.pitch = 0.2; g.cameraRig.distance = 6.5; });
  await settle(page, 900);
  await shot(page, 'dance-party', P);
  check(await page.evaluate(() => !!window.__game.profile.stickers.dance_party), 'Dance Party sticker');
  await until(page, () => !window.__game.player.avatar.emoting && window.__game.friends.friends.every((f) => !f.avatar.emoting), null, 8000);

  // ----- her emote from the keyboard: friends mirror it -----
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.3; g.cameraRig.distance = 5; });
  await page.keyboard.press('g');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="emotes"]', { timeout: 4000 }).catch(() => null);
  await page.keyboard.press('6');
  const mirrored = await until(page, () => window.__game.friends.friends.filter((f) => f.avatar.emoting === 'heart').length >= 2, null, 5000);
  check(!!mirrored, 'friends copy her heart-hands emote');
  await settle(page, 600);
  await shot(page, 'friends-mirror', P);
  await until(page, () => window.__game.friends.friends.every((f) => !f.avatar.emoting), null, 8000);

  // ----- give Zoe a treat -----
  await holdFriend(page, zoe.id);
  check(await tapBody(page, 'friend', zoe.id), 'Hand-tapped Zoe');
  await page.waitForSelector('.pl-bubble.pl-on', { timeout: 4000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Treat"]').click();
  await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Cookie"]', { timeout: 3000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Cookie"]').click();
  await settle(page, 900);
  const eating = await page.evaluate((id) => { const f = window.__game.friends.byId(id); return { eating: f.eatT > 0, food: !!f.food }; }, zoe.id);
  check(eating.eating && eating.food, 'Zoe eats the cookie (it is in her hand)');
  check(await ev(page, 'friend:treat') === 1, 'friend:treat fired');
  await page.mouse.click(640, 560);
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), pl = g.player.position;
    const dx = pl.x - f.pos.x, dz = pl.z - f.pos.z, d = Math.hypot(dx, dz) || 1;
    g.player.teleport(f.pos.x + (dx / d) * 1.9, pl.y, f.pos.z + (dz / d) * 1.9);
    g.cameraRig.setMode('first');
    g.cameraRig.yaw = Math.atan2(-dx, -dz);
    g.cameraRig.pitch = 0.12;
  }, zoe.id);
  await settle(page, 700);
  await shot(page, 'friend-treat', P);
  await page.evaluate(() => window.__game.cameraRig.setMode('third'));
  await until(page, (id) => window.__game.friends.byId(id).eatT <= 0, zoe.id, 25000);
  check(await page.evaluate((id) => !window.__game.friends.byId(id).food, zoe.id), 'she finished it (the treat is gone)');

  // ----- dress Ava up -----
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.3; g.cameraRig.distance = 5; });
  await settle(page, 400);
  await holdFriend(page, ava.id);
  check(await tapBody(page, 'friend', ava.id), 'Hand-tapped Ava');
  await page.waitForSelector('.pl-bubble.pl-on', { timeout: 4000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Dress up"]').click();
  await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Princess"]', { timeout: 3000 });
  await shot(page, 'friend-style-menu', P);
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Princess"]').click();
  await settle(page, 300);
  const dressed = await page.evaluate((id) => window.__game.friends.byId(id).look.dress, ava.id);
  check(dressed && dressed.type === 'ballgown', 'Ava wears the Princess ball gown');
  const hair0 = await page.evaluate((id) => window.__game.friends.byId(id).look.hair.style, ava.id);
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="New hair"]').click();
  await settle(page, 300);
  const hair1 = await page.evaluate((id) => window.__game.friends.byId(id).look.hair.style, ava.id);
  check(hair1 !== hair0, `new hair: ${hair0} -> ${hair1}`);
  const sig0 = await page.evaluate((id) => JSON.stringify(window.__game.friends.byId(id).look), ava.id);
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Surprise!"]').click();
  await settle(page, 300);
  check(await page.evaluate(([id, s]) => JSON.stringify(window.__game.friends.byId(id).look) !== s, [ava.id, sig0]), 'Surprise! gives a new outfit');
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Twins!"]').click();
  await settle(page, 1200);
  const twins = await page.evaluate((id) => { const g = window.__game; return JSON.stringify(g.friends.byId(id).look.top) === JSON.stringify(g.profile.look.top); }, ava.id);
  check(twins, 'Twins! copies her outfit');
  await page.mouse.click(640, 560);
  // side by side, matching outfits
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), pl = g.player.position;
    f.teleport(pl.x + 1.1, pl.y, pl.z, false);
    f.yaw = Math.PI;
    f.attention = 4;
    g.player.yaw = Math.PI;
    g.cameraRig.yaw = 0.15;
    g.cameraRig.distance = 3.6;
    g.cameraRig.pitch = 0.12;
  }, ava.id);
  await settle(page, 900);
  await shot(page, 'friend-twins', P);
  await page.mouse.click(640, 560);

  // ----- Follow me -----
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.3; g.cameraRig.distance = 5; });
  await settle(page, 400);
  await holdFriend(page, mia.id);
  check(await tapBody(page, 'friend', mia.id), 'Hand-tapped Mia again');
  await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Follow me"]', { timeout: 4000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Follow me"]').click();
  check(await page.evaluate((id) => window.__game.friends.byId(id).mode === 'follow', mia.id), 'Mia follows her');
  await page.mouse.click(640, 560);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = Math.PI; g.player.yaw = Math.PI; });
  await page.keyboard.down('s');
  await page.waitForTimeout(2200);
  await page.keyboard.up('s');
  const miaNear = await until(page, (id) => window.__game.friends.byId(id).distToPlayer() < 4.5, mia.id, 8000);
  check(!!miaNear, 'Mia kept up with her walk');
  await page.evaluate((id) => { const g = window.__game; g.friends.setMode(g.friends.byId(id), 'home', { quiet: true }); }, mia.id);

  // ----- a cozy sleepover set: a sofa, an armchair, beds and lamps -----
  const set = await page.evaluate((ids) => {
    const g = window.__game, d = g.debug, pl = g.player.position;
    const cx = Math.floor(pl.x), cz = Math.floor(pl.z) + 5, y = g.world.heightAt(cx, cz) + 1;
    d.place('rug_heart', cx, y, cz + 1, 2);
    d.place('sofa', cx, y, cz, 2, '#FF8CC6');
    d.place('armchair', cx + 2, y, cz, 2, '#C3A6FF');
    d.place('floor_lamp', cx - 2, y, cz, 2);
    d.place('bed_single', cx - 3, y, cz + 5, 2, '#FFB6D9');
    d.place('bed_canopy', cx, y, cz + 5, 2);
    d.place('bed_single', cx + 3, y, cz + 5, 2, '#B8E1FF');
    d.place('bed_single', cx + 6, y, cz + 5, 2, '#FFE58A');
    d.place('floor_lamp', cx - 5, y, cz + 5, 2);
    ids.forEach((id, i) => {
      const f = g.friends.byId(id);
      f.teleport(cx - 1 + i, y + 0.01, cz - 3, false);
      f.mode = 'home';
      f.home = [cx, y, cz - 2];
    });
    return [cx, y, cz];
  }, ids);
  await settle(page, 400);
  for (const id of ids) await page.evaluate((id) => window.__game.debug.friends.sit(id), id);
  const sitting = await until(page, () => window.__game.friends.friends.filter((f) => f.act === 'sit').length >= 3, null, 30000);
  const ns = await page.evaluate(() => window.__game.friends.friends.filter((f) => f.act === 'sit').map((f) => f.name));
  check(!!sitting && ns.length >= 3, `friends sit on the sofa and the armchair (${ns.join(', ')})`);
  await faceTarget(page, set[0] + 0.5, set[1], set[2], 4.2, 0.25);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.distance = 5.5; });
  await settle(page, 900);
  await shot(page, 'friends-sofa', P);

  // ----- night: friends go to bed -----
  await page.evaluate(() => {
    const g = window.__game;
    g.setDayTime(0.86);
    for (const f of g.friends.friends) { f.sitLeft = 0; f.thinkT = 0; }
  });
  const asleep = await until(page, () => window.__game.friends.friends.filter((f) => f.act === 'sleep' && f.bed && !f.bed.ground).length >= 3, null, 40000);
  const sl = await page.evaluate(() => window.__game.friends.friends.map((f) => `${f.name}:${f.act}`));
  check(!!asleep, `friends sleep in the beds at night (${sl.join(', ')})`);
  await page.evaluate(([x, y, z]) => {
    const g = window.__game;
    g.player.teleport(x + 1.5, y + 0.01, z + 1.6);
    g.cameraRig.setMode('third');
    g.cameraRig.yaw = 0.35;
    g.cameraRig.pitch = 0.62;
    g.cameraRig.distance = 5;
  }, set);
  await settle(page, 1500);
  await shot(page, 'friends-sleep-night', P);

  // ----- she sleeps too (the free bed): morning wakes everyone -----
  const freeBed = await page.evaluate(([x, y, z]) => { const e = window.__game.entities.at(x + 6, y, z + 5); return e ? e.uid : null; }, set);
  check(freeBed !== null, 'a free bed for her');
  const morning0 = await ev(page, 'time:morning');
  await page.evaluate((uid) => window.__game.debug.interact(uid), freeBed);
  await until(page, (n) => (window.__palsEv['time:morning'] || 0) > n, morning0, 20000);
  await until(page, () => window.__game.friends.friends.every((f) => f.act !== 'sleep'), null, 10000);
  const awake = await page.evaluate(() => window.__game.friends.friends.map((f) => f.act));
  check(awake.every((a) => a !== 'sleep'), `good morning: every friend is up (${awake.join(', ')})`);
  check(await page.evaluate(() => !!window.__game.profile.stickers.sleepover), 'Sleepover sticker');
  await settle(page, 1500);

  // ----- LOD: far away friends are hidden -----
  const far = await page.evaluate(() => {
    const g = window.__game, pl = g.player.position;
    const x = Math.min(g.world.sx - 4, pl.x + 60), z = pl.z;
    g.player.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z);
    return x;
  });
  void far;
  await until(page, () => window.__game.friends.friends.every((f) => f.mode === 'follow' || !f.group.visible), null, 5000);
  const hidden = await page.evaluate(() => window.__game.friends.friends.filter((f) => f.mode !== 'follow').map((f) => f.group.visible));
  check(hidden.every((v) => !v), 'friends more than 40 blocks away are hidden');
  await page.evaluate(([x, y, z]) => window.__game.player.teleport(x + 0.5, y + 0.01, z - 3), set);
  await settle(page, 600);

  // ----- six friends max -----
  const more = await page.evaluate(() => {
    const d = window.__game.debug.friends;
    return ['lilyrose', 'maya', 'chloe', 'nia'].map((k) => d.invite(k));
  });
  check(more.slice(0, 3).every(Boolean) && more[3] === null, 'up to 6 friends; the 7th is politely refused');
  const calls = await page.evaluate(() => window.__game.debug.info().calls);
  console.log(`  draw calls with 6 friends around: ${calls}`);

  // ----- save & reload -----
  const before = await page.evaluate(() => ({
    friends: window.__game.friends.friends.map((f) => [f.key, f.name, JSON.stringify(f.look)]).sort(),
    horse: window.__game.pets.pets.find((p) => p.species === 'horse').opts,
    id: window.__game.world.meta.id,
  }));
  await page.evaluate(() => window.__game.debug.save());
  await page.evaluate((id) => window.__game.debug.loadWorld(id), before.id);
  await waitForPlay(page);
  await waitIdle(page);
  const after = await page.evaluate(() => ({
    friends: window.__game.friends.friends.map((f) => [f.key, f.name, JSON.stringify(f.look)]).sort(),
    horse: (window.__game.pets.pets.find((p) => p.species === 'horse') || {}).opts,
  }));
  check(JSON.stringify(after.friends) === JSON.stringify(before.friends), `6 friends and their outfits come back after a reload (${after.friends.length})`);
  check(after.horse && after.horse.braids === true, 'the horse keeps its braided mane');
  await settle(page, 800);
  await shot(page, 'reloaded', P);
  await context.close();
}

// ---------------------------------------------------------------- touch (iPad)

async function touch(browser) {
  console.log('Touch pass (iPad 1024x768)');
  const { context, page } = await openGame(browser, { errors, label: 'touch', viewport: { width: 1024, height: 768 }, touch: true });
  await startWorld(page, 'meadow', { tap: true });
  await trackEvents(page);
  await page.evaluate(() => { window.__game.setDayTime(0.36); });
  await settle(page, 500);
  // a friend from the Bag
  await inviteViaBag(page, 'nia', { tap: true });
  await settle(page, 400);
  await shot(page, 'touch-friends-panel', P);
  const nia = await pickFriendCard(page, 'nia', true);
  await settle(page, 1200);
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), pl = g.player.position;
    const x = pl.x + Math.sin(g.cameraRig.yaw) * 3, z = pl.z + Math.cos(g.cameraRig.yaw) * 3;
    f.teleport(x, g.world.heightAt(Math.floor(x), Math.floor(z)) + 1.01, z, false);
    f.mode = 'stay';
    g.cameraRig.pitch = 0.3;
  }, nia.id);
  await settle(page, 600);
  await tool(page, 'Hand', true);
  await holdFriend(page, nia.id);
  check(await tapBody(page, 'friend', nia.id, true), 'tapped Nia');
  await page.waitForSelector('.pl-bubble.pl-on', { timeout: 4000 });
  await settle(page, 300);
  await shot(page, 'touch-friend-bubble', P);
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Follow me"]').tap();
  check(await page.evaluate((id) => window.__game.friends.byId(id).mode === 'follow', nia.id), 'Follow me (tap)');
  await holdFriend(page, nia.id);
  check(await tapBody(page, 'friend', nia.id, true), 'tapped Nia again');
  await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Dance"]', { timeout: 4000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Dance"]').tap();
  const danced = await until(page, (id) => window.__game.friends.byId(id).avatar.emoting === 'dance', nia.id, 5000);
  check(!!danced, 'Nia dances (tap)');
  await settle(page, 600);
  await shot(page, 'touch-dance', P);
  // a horse to ride
  await page.evaluate(() => { const g = window.__game; g.player.teleport(g.player.position.x + 3, g.player.position.y + 0.5, g.player.position.z); });
  await settle(page, 400);
  await openBag(page, 'Pets', true);
  await pickBagItem(page, 'Horse', true);
  await tool(page, 'Build', true);
  const gp = await groundPoint(page, { dist: 4.5 });
  check(!!gp, 'ground for the horse');
  if (gp) {
    await page.touchscreen.tap(gp.x, gp.y);
    await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="adopt"] .lf-variant');
    await page.locator('.sw-panel-wrap.sw-open .lf-variant[data-variant="pinto"]').tap();
    await settle(page, 600);
    await shot(page, 'touch-adopt-horse', P);
    await page.locator('.sw-panel-wrap.sw-open .lf-adopt-go').tap();
    await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 5000 });
    const horse = await page.evaluate(() => { const p = window.__game.pets.pets.find((q) => q.species === 'horse'); return p ? p.id : null; });
    check(!!horse, 'adopted a pinto horse with taps');
    await page.evaluate((id) => { const g = window.__game; g.pets.setMode(g.pets.byId(id), 'stay', { quiet: true }); }, horse);
    await tool(page, 'Hand', true);
    const hp = await page.evaluate((id) => { const p = window.__game.pets.byId(id).pos; return [p.x, p.y, p.z]; }, horse);
    await faceTarget(page, hp[0], hp[1], hp[2], 4.2, 0.25);
    check(await tapBody(page, 'pet', horse, true), 'tapped the horse');
    await page.waitForSelector('.lf-bubble.lf-on .sw-round[aria-label="Ride"]', { timeout: 4000 });
    await page.locator('.lf-bubble.lf-on .sw-round[aria-label="Ride"]').tap();
    await settle(page, 600);
    check(await page.evaluate(() => window.__game.player.state === 'ride'), 'riding the horse (tap)');
    await shot(page, 'touch-ride', P);
    await page.locator('.lf-hud .sw-round[data-action="hopoff"]').tap();
    await settle(page, 300);
    check(await page.evaluate(() => window.__game.player.state !== 'ride'), 'Hop off (tap)');
  }
  await context.close();
}

// ----------------------------------------------------------------

const opts = parseArgs();
const browser = await launch({ headed: opts.headed });
try {
  if (!opts.only || opts.only === 'lineup') await lineup(browser);
  if (!opts.only || opts.only === 'desktop') await desktop(browser);
  if (!opts.only || opts.only === 'touch') await touch(browser);
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
  finish(errors);
}
