// Shops & Sparkle Coins probe, through the real UI where it matters (Bag -> Shops tab, the
// Hand tool on a shop, the shop panel, the HUD Eat button, pet and friend bubbles).
//
//   desktop  1280x800: coins start at 100 and fly into the HUD pill from gems, cooking,
//            harvests, a sticker and the first pat of a pet (not the second); friends' actions
//            applied from the network earn nothing; the daily gift box; a Candy Shop from the
//            Bag with a color, Hand-tap -> buy a rainbow lollipop -> Hold -> Eat; the Ice Cream
//            Parlor builder: a triple-scoop sundae with toppings (price by parts), Hold, Eat;
//            the Ice Cream Truck and its Favorites; feed a pet and give a friend a treat;
//            treats on a table; save + reload; not enough coins
//   touch    iPad 1024x768 with taps: Bag -> Shops -> Ice Cream Truck shows "Pick a color!"
//            (the ghost click no longer picks one), place it, build a cone, buy, hold, eat
//   gift     a browser that is not automated (navigator.webdriver off): the daily gift pops up
//            by itself on entering a world, opens by itself, and only once a day
//
//   node tools/probe-shops.mjs [--only=desktop|touch|gift] [--headed]
// Screenshots: .shots/shops-*.png. Fails on any console error or failed check.

import { launch, openGame, startWorld, waitIdle, shot, settle, finish, attachErrorCollectors, waitForTitle, PAGE_URL } from './smoke.mjs';

const P = 'shops';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : null;
const want = (name) => !only || only.includes(name);
const errors = [];

function check(cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

const wait = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
/** Wait for a condition, but never throw: returns whether it came true. */
const until = (page, fn, arg, timeout = 20000) => wait(page, fn, arg, timeout).then(() => true, () => false);
const coins = (page) => page.evaluate(() => window.__game.profile.coins);
const count = (page, key) => page.evaluate((k) => (window.__game.profile.basket || {})[k] | 0, key);
const press = (loc, tap) => (tap ? loc.tap() : loc.click());

async function recordEvents(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (g.__shopEv) return;
    g.__shopEv = [];
    for (const name of ['coins:change', 'shop:buy', 'food:eat', 'pet:feed', 'friend:treat', 'sticker:earned', 'basket:change']) {
      g.events.on(name, (p) => g.__shopEv.push({
        name,
        reason: p && p.reason, delta: p && p.delta, item: p && p.item, price: p && p.price,
        food: p && p.food, sticker: p && p.sticker && p.sticker.id,
      }));
    }
  });
}
const events = (page, name) => page.evaluate((n) => window.__game.__shopEv.filter((e) => e.name === n), name);

async function useTool(page, name, tap = false) {
  await press(page.locator(`.sw-hud-right .sw-round[aria-label="${name}"]`).first(), tap);
  await until(page, (t) => window.__game.selectedTool === t, name.toLowerCase(), 5000);
}

/** Stand in front of a spot (dist blocks away along +z of it) and look at it. */
async function standBefore(page, x, y, z, { dist = 4, side = 0, yawOff = 0, pitch = 0.2, camDist = 4.5 } = {}) {
  await page.evaluate(([x, y, z, dist, side, yawOff, pitch, camDist]) => {
    const g = window.__game;
    if (g.player.flying) g.player.setFlying(false);
    const px = x + side, pz = z + dist;
    const h = g.world.heightAt(Math.floor(px), Math.floor(pz));
    g.player.teleport(px, h + 1.01, pz);
    g.player.velocity.set(0, 0, 0);
    const yaw = Math.atan2(x - px, z - pz);
    g.player.yaw = yaw;
    g.cameraRig.yaw = yaw + yawOff;
    g.cameraRig.pitch = pitch;
    g.cameraRig.distance = camDist;
  }, [x, y, z, dist, side, yawOff, pitch, camDist]);
  await settle(page, 500);
}

/** Turn to an entity and click / tap it with the current tool (checks the pick finds it). */
async function tapEntity(page, uid, tap = false) {
  const pt = await page.evaluate((uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    if (!e) return null;
    const b = e.pickable.box;
    const r = g.renderer.domElement.getBoundingClientRect();
    const c = b.getCenter(g.camera.position.clone());
    const tries = [[0, 0], [0, -0.3], [0, 0.3], [-0.5, 0], [0.5, 0], [0, -0.6]];
    for (const [dx, dy] of tries) {
      const v = g.camera.position.clone().set(c.x + dx, c.y + dy, c.z).project(g.camera);
      if (v.z > 1) continue;
      const h = g.pick({ x: v.x, y: v.y });
      if (h && h.type === 'pickable' && h.pickable.ref === e) {
        const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
        if (document.elementFromPoint(sx, sy) === g.renderer.domElement) return { x: sx, y: sy };
      }
    }
    return null;
  }, uid);
  if (!pt) return false;
  if (tap) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await settle(page, 250);
  return true;
}

/** Page point of a pet's or friend's body (checks the pick finds it). */
async function tapBody(page, kind, id, tap = false) {
  for (let i = 0; i < 5; i++) {
    const at = await page.evaluate(([kind, id]) => {
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
    if (at && at.ok) {
      if (tap) await page.touchscreen.tap(at.x, at.y);
      else await page.mouse.click(at.x, at.y);
      return true;
    }
    await settle(page, 300);
  }
  return false;
}

/** The top face of a ground block a few blocks in front of her, in view (page point + cell). */
async function groundPoint(page, dist = 5) {
  return page.evaluate((dist) => {
    const g = window.__game, p = g.player.position, yaw = g.cameraRig.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const r = g.renderer.domElement.getBoundingClientRect();
    for (let dd = 0; dd < 5; dd++) {
      for (const s of [0, 1, -1, 2, -2]) {
        const d = dist + dd * 0.8;
        const x = Math.floor(p.x + fx * d + rx * s), z = Math.floor(p.z + fz * d + rz * s);
        const y = g.world.heightAt(x, z);
        const v = g.camera.position.clone().set(x + 0.5, y + 1, z + 0.5).project(g.camera);
        if (v.z > 1 || Math.abs(v.x) > 0.8 || v.y < -0.75 || v.y > 0.8) continue;
        const hit = g.pick({ x: v.x, y: v.y });
        const onTop = hit && hit.type === 'block' && hit.x === x && hit.z === z && ((hit.y === y && hit.face[1] === 1) || (hit.y === y + 1 && g.registry.blocks.props.replaceable[hit.id]));
        if (!onTop) continue;
        const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
        if (document.elementFromPoint(sx, sy) !== g.renderer.domElement) continue;
        return { x: sx, y: sy, cell: [x, y, z] };
      }
    }
    return null;
  }, dist);
}

/** Bag -> tab -> item (-> color). Returns whether the color step showed and stayed. */
async function fromBag(page, tab, item, { tap = false, color = 1 } = {}) {
  await press(page.locator('.sw-bagbtn').first(), tap);
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  await press(page.locator('.sw-panel-wrap.sw-open .sw-tab2', { hasText: tab }).first(), tap);
  await settle(page, 300);
  await page.waitForFunction(() => document.querySelectorAll('.sw-panel-wrap.sw-open .sw-item img[src^="data:"]').length >= 3, null, { timeout: 30000 }).catch(() => {});
  await shot(page, tap ? 't1-bag-shops-tab' : '5-bag-shops-tab', P);
  await press(page.locator('.sw-panel-wrap.sw-open .sw-item', { hasText: item }).first(), tap);
  await settle(page, 700);
  const step = await page.evaluate(() => !!window.__game.ui.current && document.querySelectorAll('.sw-panel-wrap.sw-open .sw-color-opt').length);
  if (step) {
    await page.waitForFunction(() => document.querySelectorAll('.sw-color-opt img[src^="data:"]').length >= 4, null, { timeout: 30000 }).catch(() => {});
    if (tap) await shot(page, 't2-color-step', P);
    await press(page.locator('.sw-panel-wrap.sw-open .sw-color-opt').nth(color), tap);
  }
  await until(page, () => !window.__game.ui.current, null, 5000);
  return !!step;
}

/** Look at her from the front, close, holding what she holds (pictures). */
async function faceHer(page, { dist = 2.3, pitch = 0.12, side = 0.35 } = {}) {
  await page.evaluate(([dist, pitch, side]) => {
    const g = window.__game;
    // turn her round (away from the shop she faced), then look at her from the front
    g.player.yaw += Math.PI;
    g.cameraRig.yaw = g.player.yaw + Math.PI + side;
    g.cameraRig.pitch = pitch;
    g.cameraRig.distance = dist;
  }, [dist, pitch, side]);
  await settle(page, 700);
}

/** Buy through the open shop panel: click a candy / favorite card or the builder's Buy. */
async function clickBuy(page, selector, tap) {
  await press(page.locator(`.sw-panel-wrap.sw-open[data-panel="shop"] ${selector}`).first(), tap);
  await until(page, () => !!document.querySelector('.sw-panel-wrap.sw-open .sh-sheet:not([hidden])'), null, 5000);
}

async function placeNear(page, key, dx, dz, rot = 0) {
  return page.evaluate(([key, dx, dz, rot]) => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz, y = g.world.heightAt(x, z) + 1;
    const e = g.entities.place(key, x, y, z, rot, null, {}, { history: true });
    return e ? { uid: e.uid, x, y, z } : null;
  }, [key, dx, dz, rot]);
}

/** Place a shop k*6 blocks along another one's row (same facing). */
async function placeBeside(page, refUid, key, k) {
  return page.evaluate(([refUid, key, k]) => {
    const g = window.__game, E = g.entities, ref = E.byUid(refUid);
    const a = E.localToWorld(ref, 1.5 + 6 * k, 0, 1.5);
    const x = Math.floor(a.x), z = Math.floor(a.z), y = g.world.heightAt(x, z) + 1;
    const e = E.place(key, x, y, z, ref.rot, null, {}, { history: true });
    return e ? { uid: e.uid, x, y, z } : null;
  }, [refUid, key, k]);
}

async function waitPanel(page, name, timeout = 8000) {
  return until(page, (n) => window.__game.ui.current === n, name, timeout);
}

async function waitPictures(page, sel, n, timeout = 40000) {
  return until(page, ([sel, n]) => document.querySelectorAll(sel).length >= n, [sel, n], timeout);
}

// =====================================================================================
// desktop
// =====================================================================================

async function desktopPass(browser) {
  console.log('Desktop pass (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await startWorld(page, 'flat');
  await recordEvents(page);
  await settle(page, 600);

  // ----- coins: 100 to start, the HUD pill -----
  check(await coins(page) === 100, 'a new profile starts with 100 Sparkle Coins');
  const pill = page.locator('.sw-hud .sw-coins');
  check(await pill.isVisible(), 'the coins pill shows in the HUD');
  check((await pill.textContent()).trim() === '100', 'the pill says 100');
  await shot(page, '1-coins-pill', P);

  // ----- earning: every gain flies into the pill -----
  await page.evaluate(() => window.__game.events.emit('gem:collect', { count: 1, total: 12 }));
  await settle(page, 380);
  check(await page.locator('.sh-fly-layer .sh-coin').count() > 0, 'coins fly toward the pill after a gem');
  await shot(page, '2-coins-fly', P);
  await until(page, () => window.__game.coins.shown === 110 && document.querySelector('.sw-hud .sw-coins').textContent.trim() === '110', null, 8000);
  check(await coins(page) === 110 && (await pill.textContent()).trim() === '110', 'a gem gives +10 and the pill counts up to 110');
  const delta = async (reason) => (await events(page, 'coins:change')).filter((e) => e.reason === reason).map((e) => e.delta);
  await page.evaluate(() => {
    const g = window.__game;
    g.events.emit('cook:done', { recipe: { key: 'cupcake' } });
    g.events.emit('garden:harvest', { plant: null, crop: 'carrot', count: 2 });
  });
  check((await delta('cook')).join() === '5', 'cooking gives +5');
  check((await delta('harvest')).join() === '3', 'harvesting gives +3');
  // (cooking and harvesting also earned their first stickers: +20 each)
  check((await delta('sticker')).length === 2 && (await delta('sticker')).every((d) => d === 20), 'each new sticker gives +20');
  // a real sticker from building: the First Block
  const s0 = await coins(page);
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3;
    g.debug.select('block:planks_pink');
    g.debug.useAt(x, g.world.heightAt(x, z), z);
  });
  check(await until(page, (c) => window.__game.profile.coins === c + 20, s0, 4000), 'the First Block sticker gives +20');
  // pets: +2 for the first pat of each pet each day, not the second
  const petId = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    return g.debug.pets.adopt('puppy', null, 'Biscuit', p.x + 2, p.y, p.z + 1);
  });
  const afterAdopt = await coins(page); // adopting earns the Best Friends sticker (+20)
  await page.evaluate((id) => window.__game.debug.pets.pet(id), petId);
  check(await coins(page) === afterAdopt + 2, 'the first pat of Biscuit today gives +2');
  await page.evaluate((id) => window.__game.debug.pets.pet(id), petId);
  check(await coins(page) === afterAdopt + 2, 'a second pat the same day gives nothing more');
  // friends' actions applied from the network (multiplayer) earn nothing
  const before = await coins(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.net = { remoteApplying: true };
    g.events.emit('gem:collect', { count: 2, total: 12 });
    g.events.emit('cook:done', { recipe: { key: 'pizza' } });
    delete g.net;
  });
  check(await coins(page) === before, 'no coins while game.net.remoteApplying (friends\' actions)');
  const reasons = (await events(page, 'coins:change')).map((e) => e.reason);
  check(['gem', 'cook', 'harvest', 'sticker', 'pet'].every((r) => reasons.includes(r)), `coins:change reasons: ${[...new Set(reasons)].join(', ')}`);
  await until(page, () => window.__game.coins.shown === window.__game.profile.coins && !document.querySelector('.sh-fly-layer .sh-coin'), null, 8000);

  // the stickers' coins fly out of their pops; let them finish first
  await until(page, () => !document.querySelector('.sw-stkpop') && window.__game.coins.shown === window.__game.profile.coins, null, 20000);
  // ----- the daily gift (automated browsers only get it when asked) -----
  check(!(await page.evaluate(() => window.__game.debug.shops.giftShowing())), 'no surprise gift pops up for an automated browser');
  await page.evaluate(() => window.__game.debug.shops.gift(true));
  await page.waitForSelector('.sh-gift .sh-gift-box', { timeout: 5000 });
  await settle(page, 900);
  await shot(page, '3-daily-gift', P);
  const giftBefore = await coins(page);
  await page.locator('.sh-gift .sh-gift-box').click({ force: true });
  check(await until(page, (c) => window.__game.profile.coins === c + 25, giftBefore, 4000), 'opening the gift gives +25');
  await settle(page, 420);
  await shot(page, '4-gift-open', P);
  check(await page.evaluate(() => /^\d{4}-\d\d-\d\d$/.test(window.__game.profile.coinGiftDay || '')), 'today is remembered (one gift a day)');
  await until(page, () => !document.querySelector('.sh-gift') && window.__game.coins.shown === window.__game.profile.coins, null, 8000);

  // ----- a Candy Shop from the Bag (Shops tab, a color), placed with a click -----
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.35; g.cameraRig.distance = 4.5; });
  await settle(page, 400);
  const colorStep = await fromBag(page, 'Shops', 'Candy Shop', { color: 1 });
  check(colorStep, 'the Candy Shop shows "Pick a color!"');
  check(await page.evaluate(() => window.__game.hotbar.slots[window.__game.hotbar.index] === 'furn:candy_shop'), 'the Candy Shop is in the hotbar');
  const gp = await groundPoint(page, 6);
  check(!!gp, 'a clear spot on the ground to place it');
  if (gp) await page.mouse.click(gp.x, gp.y);
  await settle(page, 400);
  const candy = await page.evaluate(() => {
    const e = window.__game.entities.all().find((e) => e.key === 'candy_shop');
    return e ? { uid: e.uid, x: e.x, y: e.y, z: e.z, rot: e.rot, color: e.color } : null;
  });
  check(!!candy, 'the Candy Shop is placed with a click');
  if (!candy) return context.close();
  check(candy.color === '#C8B4FF', `in the color she picked (${candy.color})`);
  await page.evaluate(() => window.__game.setDayTime(0.42));
  await standBefore(page, candy.x + 0.5, candy.y, candy.z + 0.5, { dist: 0, side: 0 });
  // stand in front of its counter (front = toward her), a little to the side for the picture
  await page.evaluate((c) => {
    const g = window.__game, E = g.entities, e = E.byUid(c.uid);
    const f = E.localToWorld(e, 1.5, 0, 3.6);
    g.player.teleport(f.x, e.y + 0.01, f.z);
    const t = E.localToWorld(e, 1.5, 1.2, 1);
    g.player.yaw = Math.atan2(t.x - f.x, t.z - f.z);
    g.cameraRig.yaw = g.player.yaw + 0.5;
    g.cameraRig.pitch = 0.1;
    g.cameraRig.distance = 4.2;
  }, candy);
  await settle(page, 900);
  await shot(page, '5-candy-shop', P);

  // ----- Hand-tap the shop: the panel with Coco -----
  await useTool(page, 'Hand');
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.player.yaw; g.cameraRig.pitch = 0.15; g.cameraRig.distance = 3.5; });
  await settle(page, 400);
  check(await tapEntity(page, candy.uid), 'Hand-tap on the Candy Shop');
  check(await waitPanel(page, 'shop'), 'the shop panel opens');
  check(await page.evaluate(() => window.__game.debug.shops.state().kind === 'candy'), 'as the Candy Shop');
  check(await page.locator('.sw-panel-wrap.sw-open .sh-item').count() >= 18, `18+ candies (${await page.locator('.sw-panel-wrap.sw-open .sh-item').count()})`);
  await waitPictures(page, '.sw-panel-wrap.sw-open .sh-item img[src^="data:"]', 18);
  await until(page, () => !!document.querySelector('.sw-panel-wrap.sw-open .sh-keeper canvas'), null, 15000);
  check(await page.locator('.sw-panel-wrap.sw-open .sh-keeper canvas').count() === 1, 'Coco the shopkeeper (an avatar portrait)');
  check((await page.locator('.sw-panel-wrap.sw-open .sh-say').textContent()).length > 5, 'with a speech bubble');
  await settle(page, 400);
  await shot(page, '6-candy-panel', P);

  // buy a rainbow lollipop (6)
  await clickBuy(page, '.sh-item[data-key="treat_rainbow_lollipop"]');
  const spent = (await events(page, 'coins:change')).filter((e) => e.reason === 'shop').map((e) => e.delta);
  check(spent.join() === '-6', 'the Rainbow Lollipop costs 6 coins');
  check(await count(page, 'treat_rainbow_lollipop') === 1, 'it is in the basket (treat_rainbow_lollipop)');
  const buys = await events(page, 'shop:buy');
  check(buys.length === 1 && buys[0].item === 'treat_rainbow_lollipop' && buys[0].price === 6, "'shop:buy' { item, price }");
  check(await page.evaluate(() => window.__game.stickers.has('sweet_tooth')), 'the Sweet Tooth sticker');
  await settle(page, 500);
  await shot(page, '7-candy-bought', P);

  // Hold it
  await page.locator('.sw-panel-wrap.sw-open .sh-sheet .sh-hold').click();
  await until(page, () => !window.__game.ui.current, null, 4000);
  check(await page.evaluate(() => window.__game.treats.held === 'treat_rainbow_lollipop'), 'she holds the lollipop');
  check(await page.evaluate(() => {
    const av = window.__game.player.avatar, h = av.held;
    let p = h && h.parent;
    while (p && p !== av.bones.elbowR) p = p.parent;
    return !!h && p === av.bones.elbowR;
  }), 'the treat model is attached to her hand bone');
  check(await until(page, () => { const b = document.querySelector('.sh-hud-eat'); return !!b && !b.hidden && b.offsetWidth > 0; }, null, 3000), 'the HUD shows Eat while she holds it');
  await faceHer(page);
  await shot(page, '8-hold-lollipop', P);

  // Eat it (HUD button): three bites, hearts, yum
  const eat0 = (await events(page, 'food:eat')).length;
  await page.locator('.sh-hud-eat').click();
  check(await page.evaluate(() => window.__game.treats.eating), 'she eats it');
  await settle(page, 700);
  await shot(page, '9-eating', P);
  check(await until(page, () => !window.__game.treats.eating, null, 45000), 'all gone after three bites');
  check((await events(page, 'food:eat')).length === eat0 + 1, "'food:eat' once");
  check(await count(page, 'treat_rainbow_lollipop') === 0, 'the basket is one lollipop lighter');
  check(await page.evaluate(() => !window.__game.player.avatar.held && !window.__game.treats.held), 'her hand is empty again');

  // ----- the Ice Cream Parlor: build a triple-scoop sundae -----
  const parlor = await placeBeside(page, candy.uid, 'ice_cream_parlor', 1);
  check(!!parlor, 'an Ice Cream Parlor');
  await page.evaluate((c) => {
    const g = window.__game, E = g.entities, e = E.byUid(c.uid);
    const f = E.localToWorld(e, 1.5, 0, 3.4);
    g.player.teleport(f.x, e.y + 0.01, f.z);
    const t = E.localToWorld(e, 1.5, 1, 1);
    g.player.yaw = Math.atan2(t.x - f.x, t.z - f.z);
    g.cameraRig.yaw = g.player.yaw - 0.45;
    g.cameraRig.pitch = 0.08;
    g.cameraRig.distance = 4.4;
  }, parlor);
  await settle(page, 900);
  await shot(page, '10-ice-cream-parlor', P);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.player.yaw; g.cameraRig.pitch = 0.12; g.cameraRig.distance = 3.5; });
  await settle(page, 400);
  // the candy panel's shopkeeper portrait already used the shared stage: count contexts now
  const ctxBefore = await page.evaluate(() => window.__game.diag.contexts.created);
  await useTool(page, 'Hand');
  check(await tapEntity(page, parlor.uid), 'Hand-tap on the parlor');
  check(await waitPanel(page, 'shop'), 'the parlor opens');
  check(await page.evaluate(() => window.__game.debug.shops.state().view === 'build'), 'on Build Your Own');
  await waitPictures(page, '.sw-panel-wrap.sw-open .sh-opt img[src^="data:"]', 6);
  check(await page.locator('.sw-panel-wrap.sw-open .sh-stage canvas').count() === 1, 'a live 3D preview (the shared stage canvas)');
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-style="sundae"]').click();
  await settle(page, 900);
  await shot(page, '11a-builder-style', P);
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="scoops"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="mint"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="uni"]').click();
  check(await page.locator('.sw-panel-wrap.sw-open .sh-slot.sh-full').count() === 3, 'three scoops');
  await settle(page, 900);
  await shot(page, '11b-builder-scoops', P);
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="tops"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="cherry"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="whipped"]').click();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="sauce"]').click();
  const st = await page.evaluate(() => window.__game.debug.shops.state().spec);
  check(st.style === 'sundae' && st.flavors.join() === 'straw,mint,uni' && st.tops === 'scwh', `the sundae spec (${JSON.stringify(st)})`);
  const want = 6 + 3 * 3 + 1 + 1 + 2 + 2;
  const tag = (await page.locator('.sw-panel-wrap.sw-open .sh-tag').textContent()).trim();
  check(tag === String(want), `priced by parts: sundae 6 + 3 scoops 9 + toppings 6 = ${want} (tag says ${tag})`);
  const ctxAfter = await page.evaluate(() => window.__game.diag.contexts.created);
  check(ctxAfter === ctxBefore, `no new WebGL context for the preview (${ctxBefore} -> ${ctxAfter} created)`);
  await settle(page, 1200);
  await shot(page, '11-builder-sundae', P);
  const sundaeKey = await page.evaluate(() => window.__game.debug.shops.key(window.__game.debug.shops.state().spec));
  const n1 = (await events(page, 'coins:change')).length;
  await clickBuy(page, '.sh-buy');
  const paid = (await events(page, 'coins:change')).slice(n1).filter((e) => e.reason === 'shop').map((e) => e.delta);
  check(paid.join() === String(-want), `the sundae costs ${want}`);
  check(await count(page, sundaeKey) === 1, `in the basket as ${sundaeKey}`);
  await settle(page, 300);
  await page.locator('.sw-panel-wrap.sw-open .sh-sheet .sh-hold').click();
  await until(page, () => !window.__game.ui.current, null, 4000);
  check(await page.evaluate((k) => window.__game.treats.held === k, sundaeKey), 'she holds the triple-scoop sundae');
  await faceHer(page, { dist: 2.2, side: -0.4 });
  await shot(page, '12-hold-sundae', P);
  await page.locator('.sh-hud-eat').click();
  check(await until(page, (k) => !window.__game.treats.eating && !(window.__game.profile.basket || {})[k], sundaeKey, 45000), 'and eats it all up');

  // ----- the Ice Cream Truck and its Favorites -----
  const truck = await placeBeside(page, candy.uid, 'ice_cream_truck', -1);
  check(!!truck, 'an Ice Cream Truck (3x2)');
  await page.evaluate((c) => {
    const g = window.__game, E = g.entities, e = E.byUid(c.uid);
    const f = E.localToWorld(e, 1.8, 0, 4.6);
    g.player.teleport(f.x, e.y + 0.01, f.z);
    const t = E.localToWorld(e, 1.5, 1.2, 1);
    g.player.yaw = Math.atan2(t.x - f.x, t.z - f.z);
    g.cameraRig.yaw = g.player.yaw + 0.55;
    g.cameraRig.pitch = 0.1;
    g.cameraRig.distance = 4.6;
  }, truck);
  await settle(page, 900);
  await shot(page, '13-ice-cream-truck', P);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.player.yaw; g.cameraRig.pitch = 0.12; g.cameraRig.distance = 3.4; });
  await settle(page, 400);
  await useTool(page, 'Hand');
  check(await tapEntity(page, truck.uid), 'Hand-tap on the truck');
  check(await waitPanel(page, 'shop'), 'the truck opens');
  await page.locator('.sw-panel-wrap.sw-open .sh-tab[data-view="favs"]').click();
  await waitPictures(page, '.sw-panel-wrap.sw-open .sh-favs .sh-item img[src^="data:"]', 4);
  check(await page.locator('.sw-panel-wrap.sw-open .sh-favs .sh-item').count() === 4, '4 ready-made favorites');
  await settle(page, 300);
  await shot(page, '14-truck-favorites', P);
  const fav = await page.evaluate(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sh-favs .sh-item')].map((b) => b.dataset.key));
  await clickBuy(page, `.sh-favs .sh-item[data-key="${fav[0]}"]`);
  await page.locator('.sw-panel-wrap.sw-open .sh-sheet .sh-more').click();
  await clickBuy(page, `.sh-favs .sh-item[data-key="${fav[3]}"]`);
  check(await count(page, fav[0]) === 1 && await count(page, fav[3]) === 1, 'bought the Unicorn Dream and the Mango Pop');
  await page.locator('.sw-panel-wrap.sw-open .sw-close').click();
  await until(page, () => !window.__game.ui.current, null, 4000);
  // a few candies more to share (like the panel does)
  await page.evaluate(() => { const d = window.__game.debug.shops; d.buy('treat_cake_pop'); d.buy('treat_macarons'); d.buy('treat_gummy_bears'); });
  await until(page, () => !window.__game.ui.current, null, 2000);

  // ----- feed a pet: Hold from the Basket, then Build-tap the pet -----
  // out in the open, in front of the row of shops
  await page.evaluate((c) => {
    const g = window.__game, E = g.entities, e = E.byUid(c.uid);
    const f = E.localToWorld(e, 1.5, 0, 11);
    const t = E.localToWorld(e, 1.5, 0, 20);
    g.player.teleport(f.x, g.world.heightAt(Math.floor(f.x), Math.floor(f.z)) + 1.01, f.z);
    g.player.yaw = Math.atan2(t.x - f.x, t.z - f.z);
  }, candy);
  // Mia comes over now (her Best Friends Forever sticker pops while Biscuit eats)
  const fid = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const a = g.player.yaw + 1.1;
    return g.debug.friends.invite('mia', p.x + Math.sin(a) * 2.8, p.y, p.z + Math.cos(a) * 2.8);
  });
  await page.evaluate((id) => { const g = window.__game; g.debug.friends.setMode(id, 'stay'); const f = g.friends.byId(id); f.stop(); f.attention = 5; }, fid);
  await page.evaluate((id) => {
    const g = window.__game, pet = g.pets.byId(id), p = g.player.position;
    g.debug.pets.setMode(id, 'stay');
    pet.pos.set(p.x + Math.sin(g.player.yaw) * 2.2, p.y, p.z + Math.cos(g.player.yaw) * 2.2);
    g.cameraRig.yaw = g.player.yaw;
    g.cameraRig.pitch = 0.4;
    g.cameraRig.distance = 3.6;
  }, petId);
  await settle(page, 500);
  await page.locator('.lf-hud [data-action="basket"]').click();
  await waitPanel(page, 'basket');
  check(await page.locator('.sw-panel-wrap.sw-open .lf-section', { hasText: 'Sweet Treats' }).count() === 1, 'the Basket has a Sweet Treats group');
  await waitPictures(page, '.sw-panel-wrap.sw-open .lf-food img[src^="data:"]', 5);
  await settle(page, 700);
  await shot(page, '15-basket-sweets', P);
  await page.locator('.sw-panel-wrap.sw-open .lf-food[data-food="treat_cake_pop"] .lf-act-hold').click();
  await until(page, () => window.__game.treats.held === 'treat_cake_pop', null, 4000);
  check(await page.evaluate(() => window.__game.selectedTool === 'build'), 'holding it selects the Build tool (tap a pet, a friend or a table)');
  const feed0 = (await events(page, 'pet:feed')).length;
  check(await tapBody(page, 'pet', petId), 'Build-tap on Biscuit');
  check(await until(page, (n) => window.__game.__shopEv.filter((e) => e.name === 'pet:feed').length > n, feed0, 4000), 'Biscuit is fed');
  const fed = (await events(page, 'pet:feed')).pop();
  check(fed && fed.food === 'treat_cake_pop', `the cake pop (${fed && fed.food})`);
  check(await count(page, 'treat_cake_pop') === 0 && await until(page, () => !window.__game.treats.held, null, 2000), 'the last cake pop left her hand');
  await settle(page, 600);
  await shot(page, '16-feed-pet', P);

  // ----- give a friend a treat (her bubble -> Treat -> the macarons) -----
  await until(page, () => !document.querySelector('.sw-stkpop') && window.__game.coins.shown === window.__game.profile.coins, null, 20000);
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), p = g.player.position;
    f.stop(); f.attention = 5;
    g.player.yaw = Math.atan2(f.pos.x - p.x, f.pos.z - p.z);
    g.cameraRig.yaw = g.player.yaw;
    g.cameraRig.pitch = 0.25;
    g.cameraRig.distance = 3.4;
  }, fid);
  await settle(page, 500);
  await useTool(page, 'Hand');
  check(await tapBody(page, 'friend', fid), 'Hand-tap on Mia');
  await page.waitForSelector('.pl-bubble.pl-on', { timeout: 5000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Treat"]').click();
  await page.waitForSelector('.pl-bubble.pl-on .sw-round[aria-label="Macarons"]', { timeout: 4000 });
  await page.locator('.pl-bubble.pl-on .sw-round[aria-label="Macarons"]').click();
  const treat = await until(page, () => window.__game.__shopEv.some((e) => e.name === 'friend:treat' && e.food === 'treat_macarons'), null, 4000);
  check(treat, 'Mia gets the macarons');
  check(await page.evaluate((id) => { const f = window.__game.friends.byId(id); return !!f.food && f.food.name === 'treat:treat_macarons'; }, fid), 'she holds our macarons model (game.treats.model)');
  check(await count(page, 'treat_macarons') === 0, 'from the basket');
  await page.evaluate((id) => {
    const g = window.__game, f = g.friends.byId(id), p = g.player.position;
    g.cameraRig.yaw = Math.atan2(f.pos.x - p.x, f.pos.z - p.z) + 0.75;
    g.cameraRig.pitch = 0.1;
    g.cameraRig.distance = 3.2;
  }, fid);
  await settle(page, 700);
  await shot(page, '17-friend-treat', P);

  // ----- treats on a table (a candy and a build-your-own ice cream) -----
  // Biscuit and Mia step aside (so nothing stands in front of the table)
  await page.evaluate(([pid, fid]) => {
    const g = window.__game, p = g.player.position, pet = g.pets.byId(pid), f = g.friends.byId(fid);
    pet.pos.set(p.x - 3, p.y, p.z - 3);
    f.pos.set(p.x + 3, p.y, p.z - 3);
  }, [petId, fid]);
  const table = await placeNear(page, 'table_long', 0, 3);
  check(!!table, 'a table');
  await standBefore(page, table.x + 0.5, table.y, table.z + 0.5, { dist: -2.6, pitch: 0.55, camDist: 3 });
  const onTable = async (key) => {
    await page.evaluate((k) => window.__game.treats.hold(k, { quiet: true }), key);
    await settle(page, 200);
    const pt = await page.evaluate((uid) => {
      const g = window.__game, E = g.entities, e = E.byUid(uid);
      const r = g.renderer.domElement.getBoundingClientRect();
      // the top of a table cell that has nothing on it yet
      for (const [cx, cy, cz] of e.cells) {
        if (E.at(cx, cy + 1, cz)) continue;
        for (const [dx, dz] of [[0, 0], [0.12, 0.1], [-0.12, -0.1], [0.15, -0.12]]) {
          const v = g.camera.position.clone().set(cx + 0.5 + dx, cy + e.def.surface - 0.01, cz + 0.5 + dz).project(g.camera);
          const h = g.pick({ x: v.x, y: v.y });
          if (h && h.type === 'pickable' && h.pickable.ref === e && h.face && h.face[1] === 1 && Math.floor(h.point.x) === cx && Math.floor(h.point.z) === cz) {
            return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
          }
        }
      }
      return null;
    }, table.uid);
    if (pt) await page.mouse.click(pt.x, pt.y);
    await settle(page, 300);
    return !!pt;
  };
  check(await onTable(fav[0]), 'Build-tap the table with the Unicorn Dream');
  check(await onTable('treat_gummy_bears'), 'and with the gummy bears');
  const tops = await page.evaluate(() => window.__game.entities.all().filter((e) => e.key.startsWith('food_treat')).map((e) => ({ key: e.key, food: e.data.food, rests: e.restsOn })));
  check(tops.some((t) => t.key === 'food_treat_ic' && t.food === fav[0] && t.rests === table.uid), 'the ice cream stands on the table (food_treat_ic)');
  check(tops.some((t) => t.key === 'food_treat_gummy_bears' && t.rests === table.uid), 'the gummy bears too (food_treat_gummy_bears)');
  check(await count(page, fav[0]) === 0, 'placing it took it from the basket');
  await page.evaluate((t) => {
    const g = window.__game, e = g.entities.byUid(t.uid), b = e.pickable.box;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const p = g.player.position;
    g.player.teleport(cx + 2.2, p.y, cz + 1.4);
    g.player.yaw = Math.atan2(cx - (cx + 2.2), cz - (cz + 1.4));
    g.cameraRig.yaw = g.player.yaw + 0.55;
    g.cameraRig.pitch = 0.42;
    g.cameraRig.distance = 2.1;
  }, table);
  await settle(page, 900);
  await shot(page, '18-table-treats', P);

  // ----- save + reload: coins, the basket's ice cream, the table ice cream -----
  const coinsBefore = await coins(page);
  const popKey = fav[3];
  const worldId = await page.evaluate(async () => { const g = window.__game; await g.debug.save(); return g.world.meta.id; });
  await page.evaluate(() => window.__game.debug.exitToTitle());
  await until(page, () => window.__game.mode === 'title', null, 30000);
  await page.evaluate((id) => window.__game.debug.loadWorld(id), worldId);
  await until(page, () => window.__game.mode === 'play' && !window.__game.loading, null, 90000);
  await waitIdle(page);
  check(await coins(page) === coinsBefore, `coins kept (${coinsBefore})`);
  check(await count(page, popKey) === 1, `the Mango Pop is still in the basket (${popKey})`);
  check(await page.evaluate((k) => { const it = window.__game.registry.items.get('food:' + k); return !!it && !it.hidden; }, popKey), 'and in the Bag (Food tab)');
  check(await page.evaluate((k) => window.__game.entities.all().some((e) => e.key === 'food_treat_ic' && e.data.food === k), fav[0]), 'the ice cream on the table came back');
  check(await page.locator('.sw-hud .sw-coins').isVisible(), 'the coins pill after reload');

  // ----- not enough coins: a kind word, nothing spent -----
  await page.evaluate(() => window.__game.debug.shops.setCoins(2));
  await page.evaluate(() => window.__game.debug.shops.open('candy'));
  await waitPanel(page, 'shop');
  await page.locator('.sw-panel-wrap.sw-open .sh-item[data-key="treat_heart_chocolates"]').click();
  await settle(page, 300);
  check(await coins(page) === 2, 'the heart chocolates (15) are too dear with 2 coins: nothing spent');
  check(/more coins/.test(await page.locator('.sw-panel-wrap.sw-open .sh-say').textContent()), 'Coco says how many more coins she needs');
  await shot(page, '19-not-enough', P);
  await page.locator('.sw-panel-wrap.sw-open .sw-close').click();
  await context.close();
}

// =====================================================================================
// touch (iPad)
// =====================================================================================

async function touchPass(browser) {
  console.log('Touch pass (iPad 1024x768)');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'touch' });
  await startWorld(page, 'flat', { tap: true });
  await recordEvents(page);
  await settle(page, 600);
  check(await page.locator('.sw-hud .sw-coins').isVisible(), 'the coins pill on the iPad');
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.35; g.cameraRig.distance = 4.5; });
  await settle(page, 300);
  const step = await fromBag(page, 'Shops', 'Ice Cream Truck', { tap: true, color: 2 });
  check(step, 'tapping the Ice Cream Truck shows "Pick a color!" (the tap\'s click does not pick one)');
  check(await page.evaluate(() => window.__game.hotbar.colors[window.__game.hotbar.index] === window.__game.registry.items.get('furn:ice_cream_truck').colors[2]), 'the color she tapped');
  const gp = await groundPoint(page, 6);
  if (gp) await page.touchscreen.tap(gp.x, gp.y);
  await settle(page, 500);
  const truck = await page.evaluate(() => { const e = window.__game.entities.all().find((e) => e.key === 'ice_cream_truck'); return e ? { uid: e.uid } : null; });
  check(!!truck, 'the truck is placed with a tap');
  if (!truck) return context.close();
  await page.evaluate((c) => {
    const g = window.__game, E = g.entities, e = E.byUid(c.uid);
    const f = E.localToWorld(e, 1.8, 0, 4.2);
    g.player.teleport(f.x, e.y + 0.01, f.z);
    const t = E.localToWorld(e, 1.5, 1.2, 1);
    g.player.yaw = Math.atan2(t.x - f.x, t.z - f.z);
    g.cameraRig.yaw = g.player.yaw + 0.5;
    g.cameraRig.pitch = 0.1;
    g.cameraRig.distance = 4.4;
  }, truck);
  await settle(page, 900);
  await shot(page, 't3-truck', P);
  await useTool(page, 'Hand', true);
  await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.player.yaw; g.cameraRig.pitch = 0.12; g.cameraRig.distance = 3.4; });
  await settle(page, 400);
  check(await tapEntity(page, truck.uid, true), 'tap on the truck with the Hand');
  check(await waitPanel(page, 'shop'), 'the truck panel opens');
  await waitPictures(page, '.sw-panel-wrap.sw-open .sh-opt img[src^="data:"]', 6);
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-style="cone"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="scoops"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="choc"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-flavor[data-flavor="bday"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-stepbtn[data-step="tops"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="sprinkles"]').tap();
  await page.locator('.sw-panel-wrap.sw-open .sh-opt[data-top="gummies"]').tap();
  await settle(page, 1200);
  await shot(page, 't4-builder', P);
  const key = await page.evaluate(() => window.__game.debug.shops.key(window.__game.debug.shops.state().spec));
  check(/^treat_ic_cone_straw-choc-bday_sg$/.test(key), `a triple cone with sprinkles and gummy bears (${key})`);
  await page.locator('.sw-panel-wrap.sw-open .sh-buy').tap();
  await until(page, () => !!document.querySelector('.sw-panel-wrap.sw-open .sh-sheet:not([hidden])'), null, 5000);
  const paid = (await events(page, 'coins:change')).filter((e) => e.reason === 'shop').map((e) => e.delta);
  check(paid.join() === String(-(3 + 9 + 1 + 2)), 'bought with a tap (cone 3 + 3 scoops 9 + toppings 3)');
  await page.locator('.sw-panel-wrap.sw-open .sh-sheet .sh-hold').tap();
  await until(page, () => !window.__game.ui.current, null, 4000);
  check(await page.evaluate((k) => window.__game.treats.held === k, key), 'she holds it');
  await faceHer(page, { dist: 2.3, side: 0.4 });
  await shot(page, 't5-hold', P);
  await page.locator('.sh-hud-eat').tap();
  // (the bites run on game time: slow on SwiftShader at iPad resolution)
  check(await until(page, (k) => !window.__game.treats.eating && !(window.__game.profile.basket || {})[k], key, 45000), 'Eat (tap): all gone');
  await context.close();
}

// =====================================================================================
// the daily gift, as a real (not automated) browser sees it
// =====================================================================================

async function giftPass(browser) {
  console.log('Gift pass (not automated, 1280x800)');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const page = await context.newPage();
  attachErrorCollectors(page, errors, 'gift');
  await page.goto(PAGE_URL);
  await waitForTitle(page);
  // a returning player (the first-time tips already done)
  await page.evaluate(() => { const g = window.__game; g.profile.tutorialDone = true; g.saveProfile(true); });
  await page.evaluate(() => window.__game.debug.newWorld({ biome: 'flat' }));
  await until(page, () => window.__game.mode === 'play' && !window.__game.loading, null, 90000);
  await waitIdle(page);
  check(await until(page, () => !!document.querySelector('.sh-gift .sh-gift-box'), null, 20000), 'the daily gift pops up by itself');
  await settle(page, 900);
  await shot(page, '20-gift-auto', P);
  const c0 = await coins(page);
  check(await until(page, (c) => window.__game.profile.coins === c + 25, c0, 20000), 'untouched, it opens by itself: +25');
  await until(page, () => !document.querySelector('.sh-gift'), null, 20000);
  const worldId = await page.evaluate(async () => { await window.__game.debug.save(); return window.__game.world.meta.id; });
  await page.evaluate(() => window.__game.debug.exitToTitle());
  await until(page, () => window.__game.mode === 'title', null, 30000);
  await page.evaluate((id) => window.__game.debug.loadWorld(id), worldId);
  await until(page, () => window.__game.mode === 'play' && !window.__game.loading, null, 90000);
  await waitIdle(page);
  await settle(page, 3500);
  check(!(await page.evaluate(() => !!document.querySelector('.sh-gift'))), 'no second gift the same day');
  await context.close();
}

async function main() {
  const browser = await launch({ headed: 'headed' in args });
  try {
    if (want('desktop')) await desktopPass(browser);
    if (want('touch')) await touchPass(browser);
    if (want('gift')) await giftPass(browser);
  } catch (err) {
    errors.push('[probe] ' + (err && err.stack ? err.stack : err));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
