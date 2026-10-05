// Squishy toys and mystery presents probe (the squish team doc §14.3), through the real UI where
// it matters (the coin pill, the Present button, taps on the present, the Bag, Squish!, the
// shelf) and the debug API (game.debug.squish) to set scenes up and read results.
//
//   desktop  B1-B13 (1280 x 800): the shelf from the coin pill, the drop, the unwrap, holding,
//            placing, hand exclusivity, the shelf's press and hold, the Glitter round, words,
//            Read Aloud, Girl / Boy / Mix, the ring never follows spending
//   touch    C1-C6: iPad 1024 x 1366 and 1366 x 1024, phones 390 x 844 and 360 x 780
//   world    W1-W3: the beach, toys on the floor, a table and the Toy Shelf, save and reload,
//            Remove and Undo, big enough on an iPad
//   save     E1-E6: old profiles, the rich fixture, reloads around tap 3, backup files, a 409
//   mp       M1-M4: two players (FakeClaudeHub + NetHub)
//   grids    F6: the owner-review pictures (.shots/squish-*.png)
//   cost     F1-F5: draw calls, the systems stage, thumbnails, geometry
//
//   node tools/probe-squish.mjs [--only=desktop,touch,world,save,mp,grids,cost] [--headed]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, openGame, attachErrorCollectors, waitForTitle, waitIdle, shot, settle, finish, screenPoint, PAGE_URL, ROOT, SHOTS } from './smoke.mjs';

const PREFIX = 'squish';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : null;
const want = (name) => !only || only.includes(name);
const IPAD = { width: 1024, height: 1366 };
const WORDS = /buy|price|cost|rare|chance|\bher\b|\bshe\b|[$€£]/i;

function check(errors, cond, message) {
  if (!cond) {
    errors.push('[check] ' + message);
    console.log('  FAIL: ' + message);
  } else console.log('  ok: ' + message);
  return !!cond;
}

const wait = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const waitOk = (page, fn, arg, timeout) => wait(page, fn, arg, timeout).then(() => true, () => false);
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const sq = (page) => ev(page, () => window.__game.debug.squish.state());

/** A fresh profile's page in a world (debug newWorld), tips done, low quality, toasts recorded. */
async function setup(page, biome = 'meadow', { presents = true } = {}) {
  await ev(page, () => {
    const g = window.__game;
    g.profile.tutorialDone = true;
    g.profile.settings.quality = 'low'; // SwiftShader: the 3D at 1x
    g.applySettings();
  });
  await ev(page, (b) => window.__game.debug.newWorld({ biome: b }), biome);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await record(page);
  if (presents) await ev(page, () => window.__game.debug.squish.presents(true));
  await wait(page, () => !!window.__game.debug.squish.state().base, null, 20000);
}

async function record(page) {
  await ev(page, () => {
    const g = window.__game;
    if (g.__probe) return;
    g.__probe = { events: [] };
    for (const name of ['present:ready', 'squish:get', 'squish:squeeze', 'sticker:earned', 'entity:place', 'entity:use']) {
      g.events.on(name, (p) => g.__probe.events.push({ name, key: p && (p.key || (p.entity && p.entity.key) || (p.sticker && p.sticker.id)) || null, ready: p && p.ready }));
    }
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => {
      window.__toasts.push(String(text));
      return toast(text, opts);
    };
    window.__spoken = [];
    const speak = g.speak;
    g.speak = (text, force) => {
      window.__spoken.push(String(text));
      return speak && speak(text, force);
    };
  });
}

const events = (page, name) => ev(page, (n) => window.__game.__probe.events.filter((e) => e.name === n), name);
const toastSeen = (page, re, timeout = 6000) => waitOk(page, (src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, timeout);
const closeAll = (page) => ev(page, () => { const ui = window.__game.ui; for (let i = 0; i < 4 && ui.current; i++) ui.close(); });

/** Earn coins through a real source and wait until they have landed in the pill. */
async function earn(page, n) {
  await ev(page, (n) => window.__game.coins.add(n, 'gift', { fly: false }), n);
  await wait(page, () => window.__game.coins.shown === window.__game.coins.value, null, 15000);
  await settle(page, 200);
}

/** Visible text nodes inside the selectors. */
const textsOf = (page, sels) => ev(page, (sels) => {
  const out = [];
  for (const s of sels) for (const el of document.querySelectorAll(s)) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) out.push(n.textContent.trim());
    for (const a of el.querySelectorAll('[aria-label]')) out.push(a.getAttribute('aria-label'));
  }
  return out;
}, sels);

/** Click the stage of the open panel (real pointer events). */
async function clickStage(page, sel = '.sw-panel-wrap.sw-open .sq-stage') {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
}

async function cleanView(page, on) {
  await ev(page, (on) => {
    let s = document.getElementById('probe-clean');
    if (on && !s) {
      s = document.createElement('style');
      s.id = 'probe-clean';
      s.textContent = '.sw-hud, .sw-toasts, .sw-hint, .lf-hud, .sw-stkpop, .sq-drop, .sq-pilltip, .pl-bubble { display: none !important; }';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  }, on);
}

/** A picture from `from` looking at `to` (the rig paused), with the HUD hidden. */
async function picture(page, name, from, to, { ms = 900, fov = 50 } = {}) {
  await cleanView(page, true);
  await ev(page, ([from, to, fov]) => {
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
  const file = await shot(page, name, PREFIX);
  await ev(page, () => {
    const g = window.__game;
    g.cameraRig.update = g.__rigUpdate;
    g.reach = g.__reach;
    g.camera.fov = 70;
    g.camera.updateProjectionMatrix();
    g.cameraRig.snap();
  });
  await cleanView(page, false);
  return file;
}

/** A flat pad of blocks in front of the player (x0..x0+w, z0..z0+d at height y), cleared above. */
const flatPad = (page, w = 12, d = 10) => ev(page, ([w, d]) => {
  const g = window.__game, p = g.player.position;
  const x0 = Math.floor(p.x) - Math.floor(w / 2), z0 = Math.floor(p.z) + 2, y = Math.floor(p.y) - 1;
  for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
    g.world.set(x, y, z, g.registry.blocks.idOf('grass'), { record: false });
    for (let k = 1; k < 6; k++) g.world.set(x, y + k, z, 0, { record: false });
  }
  for (const e of [...g.entities.all()]) if (e.x >= x0 && e.x < x0 + w && e.z >= z0 && e.z < z0 + d) g.entities.remove(e, { history: false, fx: false });
  return { x0, z0, y: y + 1 };
}, [w, d]);

const placeAt = (page, key, x, y, z, rot = 0, color = null) => ev(page, ([key, x, y, z, rot, color]) => {
  const e = window.__game.entities.place(key, x, y, z, rot, color, {}, { history: true, fx: false });
  return e ? { uid: e.uid, y: e.y, yOffset: e.yOffset, restsOn: e.restsOn } : null;
}, [key, x, y, z, rot, color]);

/** Turn the camera toward an entity and return the page position of its pick box centre. */
async function aimAt(page, uid, dx = 0) {
  const c = await ev(page, ([uid, dx]) => {
    const g = window.__game, e = g.entities.byUid(uid), b = e.pickable.box;
    const cx = (b.min.x + b.max.x) / 2 + dx, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    const p = g.player.position;
    g.cameraRig.yaw = Math.atan2(cx - p.x, cz - p.z);
    g.cameraRig.pitch = 0.5;
    return [cx, cy, cz];
  }, [uid, dx]);
  await settle(page, 400);
  return screenPoint(page, ...c);
}

// =====================================================================================
// desktop
// =====================================================================================

async function desktopPass(browser, errors) {
  console.log('\n[desktop] 1280 x 800, a fresh profile');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await setup(page);

  // B1 the shelf from the coin pill, the path, the tip card, 48 mysteries
  await ev(page, () => window.__game.ui.open('bag'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab2');
  c(await page.locator('.sw-tab[data-tab=squish]').count() === 0, 'B1 no Squish Toys tab in the Bag before the first toy');
  await closeAll(page);
  const pill = page.locator('.sw-hud .sw-coins');
  c(await pill.evaluate((el) => el.tagName) === 'BUTTON', 'B1 the coin pill is a button');
  await pill.click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-shelf');
  const b1 = await ev(page, () => ({
    title: document.querySelector('.sw-panel-wrap.sw-open .sw-card-title').textContent,
    count: document.querySelector('.sq-count').textContent,
    togo: document.querySelector('.sq-togo') && document.querySelector('.sq-togo').textContent,
    tip: !!document.querySelector('.sq-tip'),
    cubbies: document.querySelectorAll('.sq-cubby').length,
    mysteries: document.querySelectorAll('.sq-cubby.sq-mystery .sq-q').length,
    names: document.querySelectorAll('.sq-cubby.sq-mystery .sq-name').length,
    label: document.querySelector('.sq-cubby.sq-mystery').getAttribute('aria-label'),
  }));
  c(/Squish Shelf/.test(b1.title) && /0 of 48/.test(b1.count), `B1 "Squish Shelf", "0 of 48" (${b1.title} / ${b1.count})`);
  c(b1.togo === '50 to go!', `B1 the path says "50 to go!" (${b1.togo})`);
  c(b1.tip, 'B1 the one-time tip card');
  c(b1.cubbies === 48 && b1.mysteries === 48 && b1.names === 0 && b1.label === 'Still a mystery', `B1 48 silhouettes with a "?" and no word (${b1.cubbies}, ${b1.mysteries})`);
  await shot(page, 'b1-shelf-first', PREFIX);
  await page.locator('.sq-tip button').click();
  await closeAll(page);
  await pill.click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-shelf');
  c(!(await page.locator('.sq-tip').count()), 'B1 no tip card on the second open');
  await closeAll(page);

  // B2 earn 50 through a real source: ready, the button, the drop waits for the Bag
  const coins0 = await ev(page, () => ({ c: window.__game.coins.value, e: window.__game.profile.stats.coinsEarned || 0 }));
  await ev(page, () => window.__game.ui.open('bag'));
  await earn(page, 50);
  let s = await sq(page);
  c(s.ready === 1, `B2 earned 50: one present ready (${s.ready})`);
  c((await events(page, 'present:ready')).length >= 1, 'B2 present:ready fired');
  c(await waitOk(page, () => { const b = document.querySelector('.lf-hud .sw-round[data-action="present"]'); return b && !b.hidden; }, null, 5000), 'B2 the Present button shows');
  const presentSvg = await ev(page, () => document.querySelector('.lf-hud .sw-round[data-action="present"] .sw-round-face svg').outerHTML);
  c(/M3\.6 10\.2h16\.8/.test(presentSvg), 'B2 with the present icon');
  await settle(page, 3000);
  c(!(await page.locator('.sq-drop').count()), 'B2 no drop while the Bag is open');
  await closeAll(page);
  c(await waitOk(page, () => !!document.querySelector('.sq-drop'), null, 4500), 'B2 the Bag closed: the drop comes within 3 s');
  const dropText = await ev(page, () => document.querySelector('.sq-drop').innerText);
  c(/Mystery present!/.test(dropText) && /Tap me!/.test(dropText) && !/A present for you!/.test(dropText), `B2 "Mystery present!" / "Tap me!", not the daily gift's words (${dropText.replace(/\n/g, ' / ')})`);
  await settle(page, 600);
  await shot(page, 'b2-drop', PREFIX);
  c(await waitOk(page, () => !document.querySelector('.sq-drop'), null, 9500), 'B2 left alone it flies to the Present button');
  c(await ev(page, () => !document.querySelector('.lf-hud .sw-round[data-action="present"]').hidden), 'B2 the button is still there');

  // B3 the Present button, three real clicks on the present
  await page.locator('.lf-hud .sw-round[data-action="present"]').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
  c(await ev(page, () => !!document.querySelector('.sq-finger')), 'B3 the pointing finger on the first-ever present');
  await settle(page, 400);
  await shot(page, 'unwrap-1', PREFIX);
  for (let i = 0; i < 3; i++) {
    await clickStage(page);
    await settle(page, 700);
    if (i < 2) await shot(page, `unwrap-${i + 2}`, PREFIX);
  }
  c(await waitOk(page, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 8000), 'B3 three clicks: the reveal');
  await settle(page, 1500);
  await shot(page, 'unwrap-4', PREFIX);
  const b3 = await ev(page, () => document.querySelector('.sq-say').innerText);
  c(/NEW!/.test(b3) && /Strawberry Puffum!/.test(b3), `B3 "NEW!" and "Strawberry Puffum!" (${b3.replace(/\n/g, ' / ')})`);
  c(/A Puffum! Press it and it puffs back up\./.test(b3), 'B3 the first Puffum: what a Puffum does');
  s = await sq(page);
  c(!!s.got.pf_strawberry, 'B3 got.pf_strawberry is set');
  const coins1 = await ev(page, () => ({ c: window.__game.coins.value, e: window.__game.profile.stats.coinsEarned || 0 }));
  // the only coins since: the 50 earned and +20 for each new sticker (First Present!)
  const stk = (await events(page, 'sticker:earned')).length;
  c(coins1.c === coins0.c + 50 + 20 * stk && coins1.e === coins0.e + 50 + 20 * stk, `B3 opening took no coins (${JSON.stringify(coins0)} -> ${JSON.stringify(coins1)}, ${stk} sticker)`);
  c(await ev(page, () => window.__game.stickers.has('squish_first')), 'B3 the "First Present!" sticker');
  c((await ev(page, () => window.__spoken)).includes('Strawberry Puffum'), 'B11 Read Aloud: the reveal speaks the name');
  await page.locator('.sw-panel-wrap.sw-open .sw-close').click();
  c(await waitOk(page, () => !!document.querySelector('.sq-pilltip'), null, 9000), 'B3 on close (after the sticker pop): "Your toys live here!" once');
  c(await ev(page, () => !document.querySelector('.sw-stkpop')), 'B3 the pill tip never shows with the sticker pop');
  c(/Your toys live here!/.test(await ev(page, () => document.querySelector('.sq-pilltip') ? document.querySelector('.sq-pilltip').innerText : '')), 'B3 the pill tip says it');
  await shot(page, 'pill-tip', PREFIX);
  await page.mouse.click(640, 300);
  c(await waitOk(page, () => !document.querySelector('.sq-pilltip'), null, 2000), 'B3 the pill tip goes on the next tap');

  // B4 close after 2 taps: nothing changes; the ghost tap; three fast taps are queued
  await earn(page, 60);
  s = await sq(page);
  c(s.ready === 1, `B4 another present (${s.ready})`);
  await ev(page, () => window.__game.debug.squish.open());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
  await settle(page, 400);
  await clickStage(page);
  await settle(page, 700);
  await clickStage(page);
  await settle(page, 700);
  await closeAll(page);
  s = await sq(page);
  c(s.ready === 1 && Object.keys(s.got).length === 1, 'B4 closed after 2 taps: still ready, nothing opened');
  await ev(page, () => window.__game.debug.squish.open());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
  await clickStage(page);
  c((await ev(page, () => window.__game.debug.squish.panels.unwrapState().taps)) === 0, 'B4 a tap within 300 ms of opening does not count');
  await settle(page, 350);
  for (let i = 0; i < 3; i++) {
    await clickStage(page);
    await page.waitForTimeout(80);
  }
  c(await waitOk(page, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 8000), 'B4 three fast taps 80 ms apart open the present (queued, none lost)');
  s = await sq(page);
  c(Object.keys(s.got).length === 2 && !!s.got.pf_dolphin, `B4 the 2nd present on Mix is the Dolphin Puffum (${Object.keys(s.got)})`);
  await closeAll(page);

  // B5 the Bag tab, holding, Squish!, Put away
  await ev(page, () => window.__game.ui.open('bag'));
  await page.waitForSelector('.sw-tab[data-tab=squish]');
  const tabs = await ev(page, () => [...document.querySelectorAll('.sw-tab')].map((t) => t.dataset.tab));
  c(tabs[tabs.indexOf('fun') + 1] === 'squish', `B5 Squish Toys sits right after Fun & Toys (${tabs.join(',')})`);
  await page.locator('.sw-tab[data-tab=squish]').click();
  await settle(page, 400);
  const bag = await ev(page, () => ({ items: [...document.querySelectorAll('.sw-bag-grid .sw-item')].map((e) => e.dataset.key), btn: !!document.querySelector('.sq-bagbtn .sq-shelfbtn') }));
  c(bag.btn, 'B5 a Squish Shelf button at the top of the tab');
  c(JSON.stringify(bag.items.sort()) === JSON.stringify(['furn:squish_pf_dolphin', 'furn:squish_pf_strawberry', 'furn:toy_shelf']), `B5 exactly the owned toys and the Toy Shelf (${bag.items})`);
  await shot(page, 'bag-tab', PREFIX);
  await page.locator('.sw-bag-grid .sw-item[data-key="furn:squish_pf_strawberry"]').click();
  await wait(page, () => !window.__game.ui.current, null, 5000);
  c(await waitOk(page, () => window.__game.player.avatar.held && window.__game.player.avatar.held.name === 'squish:pf_strawberry', null, 3000), 'B5 the toy is in her hand (squish:pf_strawberry)');
  c(await waitOk(page, () => { const b = document.querySelector('.lf-hud .sw-round[data-action="squish"]'); return b && !b.hidden; }, null, 3000), 'B5 Squish! shows');
  const sb = await page.locator('.lf-hud .sw-round[data-action="squish"]').boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  const t0 = Date.now();
  let early = 9, late = 9;
  for (;;) {
    await page.waitForTimeout(50);
    const sy = await ev(page, () => window.__game.debug.squish.handSy());
    const dt = Date.now() - t0;
    if (dt <= 200) early = Math.min(early, sy);
    if (dt >= 550) { late = sy; break; }
  }
  await page.mouse.up();
  c(early < 0.6, `B5 Squish! pressed: squashed within 0.2 s (sy ${early.toFixed(2)})`);
  c(late < 0.6, `B5 still flat at 550 ms (sy ${late.toFixed(2)})`);
  c(await waitOk(page, () => window.__game.debug.squish.handSy() > 0.97, null, 3500), 'B5 released: it rises again by 3 s');
  await page.locator('.lf-hud .sw-round[data-action="squish-away"]').click();
  c(await waitOk(page, () => !window.__game.player.avatar.held && !window.__game.hotbar.slots.includes('furn:squish_pf_strawberry'), null, 3000), 'B5 Put away clears the slot and the hand');
  c(await toastSeen(page, /^All put away!$/), 'B5 "All put away!"');

  // B6 a table, then the toy on its top; a Hand tap squishes it
  const pad = await flatPad(page);
  const tx = pad.x0 + 6, tz = pad.z0 + 3;
  await placeAt(page, 'table_round', tx, pad.y, tz);
  const toy = await placeAt(page, 'squish_pf_strawberry', tx, pad.y + 1, tz);
  c(!!toy && toy.restsOn && Math.abs(toy.yOffset - (0.82 - 1)) < 0.01, `B6 the toy stands on the table top (${JSON.stringify(toy)})`);
  c(await toastSeen(page, /You put it down! It's still in your Bag\./), 'B6 the first placement: "You put it down! It\'s still in your Bag."');
  await ev(page, () => window.__game.setTool('hand'));
  const at = await aimAt(page, toy.uid);
  await page.mouse.move(at.x, at.y);
  await settle(page, 300);
  const hint = await ev(page, () => document.querySelector('.sw-hint') && !document.querySelector('.sw-hint').hidden ? document.querySelector('.sw-hint').textContent : '');
  c(hint === 'Tap to squish!', `B6 the hint says "Tap to squish!" (${hint})`);
  await page.mouse.click(at.x, at.y);
  let dip = 9;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(40);
    dip = Math.min(dip, await ev(page, (uid) => { const e = window.__game.entities.byUid(uid); const m = e && e.object3d && e.object3d.children[0]; const t = m && m.userData.parts && m.userData.parts.toy; return t ? t.scale.y : 1; }, toy.uid));
  }
  c(dip < 0.7, `B6 a Hand tap: the toy squashes (sy ${dip.toFixed(2)})`);
  c(await waitOk(page, (uid) => { const e = window.__game.entities.byUid(uid); return e && !e._squish; }, toy.uid, 4000), 'B6 and rises back');
  await shot(page, 'b6-table', PREFIX);

  // B7 hand exclusivity: a toy, a treat, the toy again, 20 times
  const b7 = await ev(page, async () => {
    const g = window.__game;
    const treat = 'treat_lolly';
    const keys = Object.keys(g.registry.items.map ? Object.fromEntries(g.registry.items.map) : {}).filter((k) => k.startsWith('food:treat_'));
    const tk = keys.includes('food:' + treat) ? treat : (keys[0] || 'food:treat_x').slice(5);
    g.profile.basket = g.profile.basket || {};
    g.profile.basket[tk] = 5;
    g.events.emit('basket:change', { key: tk, delta: 5 });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 3; i++) await frame();
    const geo0 = g.renderer.info.memory.geometries;
    let maxKids = 0, wrong = 0;
    const bone = () => { let b = null; g.player.avatar.group.traverse((o) => { if (o.name === 'held') b = o; }); return b; };
    for (let i = 0; i < 20; i++) {
      g.squish.hold('pf_strawberry', false, { quiet: true });
      for (let k = 0; k < 2; k++) await frame();
      if (!g.player.avatar.held || g.player.avatar.held.name !== 'squish:pf_strawberry') wrong++;
      maxKids = Math.max(maxKids, bone() ? bone().children.length : 0);
      g.treats.hold(tk, { quiet: true });
      for (let k = 0; k < 2; k++) await frame();
      if (!g.player.avatar.held || !/^treat:/.test(g.player.avatar.held.name)) wrong++;
      maxKids = Math.max(maxKids, bone() ? bone().children.length : 0);
    }
    g.squish.hold('pf_strawberry', false, { quiet: true });
    for (let k = 0; k < 4; k++) await frame();
    return { wrong, maxKids, geo0, geo1: g.renderer.info.memory.geometries, tk };
  });
  c(b7.wrong === 0 && b7.maxKids <= 1, `B7 20 swaps: the hand always holds the selected one, at most 1 object (${JSON.stringify(b7)})`);
  c(b7.geo1 <= b7.geo0 + 2, `B7 geometries return to the start (${b7.geo0} -> ${b7.geo1})`);
  await ev(page, () => window.__game.squish.putAway());

  // B8 the shelf: tabs, the stage, press and hold, Hold it with the Hand tool, NEW! tags
  await ev(page, () => window.__game.debug.squish.give('st_bubblegum'));
  await ev(page, () => window.__game.ui.open('squish'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-grid');
  const counts = {};
  for (const tab of ['all', 'puff', 'stretch']) {
    await page.locator(`.sq-tabs button[data-tab=${tab}]`).click();
    counts[tab] = await page.locator('.sq-cubby').count();
  }
  c(counts.all === 48 && counts.puff === 24 && counts.stretch === 24, `B8 tabs filter: All 48, Puffums 24, Stretchums 24 (${JSON.stringify(counts)})`);
  await page.locator('.sq-tabs button[data-tab=all]').click();
  // the shared stage: its one canvas is made on first use; opening again makes no new context
  await page.locator('.sq-cubby[data-key=pf_strawberry]').click();
  await page.waitForSelector('.sq-detail .sq-stage canvas', { timeout: 10000 });
  const ctx0 = await ev(page, () => { window.__stageCanvas = document.querySelector('.sq-detail .sq-stage canvas'); return window.__game.diag.contexts.created; });
  await page.locator('.sq-detail .sw-btn', { hasText: 'Back' }).click();
  await page.locator('.sq-cubby[data-key=pf_strawberry]').click();
  await page.waitForSelector('.sq-detail .sq-stage canvas', { timeout: 10000 });
  const ctx1 = await ev(page, () => ({ same: document.querySelector('.sq-detail .sq-stage canvas') === window.__stageCanvas, created: window.__game.diag.contexts.created }));
  c(ctx1.same && ctx1.created === ctx0, `B8 the detail card uses the shared stage: the same canvas, no new WebGL context (${ctx0} -> ${ctx1.created})`);
  await settle(page, 600);
  const st = await page.locator('.sq-detail .sq-stage').boundingBox();
  const press = async (ms) => {
    await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    const held = await ev(page, () => window.__game.debug.squish.panels.shownSy());
    await page.mouse.up();
    return held;
  };
  const puffHeld = await press(600);
  c(puffHeld < 0.6, `B8 a 600 ms press on a Puffum keeps it flat (sy ${puffHeld.toFixed(2)})`);
  c(await waitOk(page, () => window.__game.debug.squish.panels.shownSy() > 0.97, null, 3500), 'B8 released: it rises');
  await shot(page, 'detail-puffum', PREFIX);
  await page.locator('.sq-detail .sw-btn', { hasText: 'Back' }).click();
  await page.locator('.sq-cubby[data-key=st_bubblegum]').click();
  await page.waitForSelector('.sq-detail .sq-stage canvas', { timeout: 10000 });
  await settle(page, 500);
  const stretchHeld = await press(600);
  c(stretchHeld > 1.3, `B8 a 600 ms press on a Stretchum stretches it (sy ${stretchHeld.toFixed(2)})`);
  c(await waitOk(page, () => Math.abs(window.__game.debug.squish.panels.shownSy() - 1) < 0.02, null, 3000), 'B8 released: it wobbles back');
  const ent0 = await ev(page, () => window.__game.entities.all().length);
  await page.locator('.sq-detail .sw-btn', { hasText: 'Hold it' }).click();
  c(await waitOk(page, () => !window.__game.ui.current && window.__game.selectedTool === 'hand' && window.__game.squish.held() === 'squish_st_bubblegum', null, 3000), 'B8 Hold it: the panel closes, she holds it, the Hand tool is on');
  await page.mouse.click(640, 520);
  await settle(page, 400);
  c((await ev(page, () => window.__game.entities.all().length)) === ent0, 'B8 a world tap then places nothing');
  await ev(page, () => window.__game.squish.putAway());
  // NEW! tags: stay after a 1 s open, go after a 2.5 s open, or a cubby tap
  await ev(page, () => { window.__game.debug.squish.give('pf_dino'); window.__game.debug.squish.give('pf_unicorn'); });
  await ev(page, () => window.__game.ui.open('squish'));
  await settle(page, 1000);
  await closeAll(page);
  let seen = (await sq(page)).seen;
  c(!seen.pf_dino && !seen.pf_unicorn, 'B8 NEW! tags stay after a 1 s open');
  await ev(page, () => window.__game.ui.open('squish'));
  await page.locator('.sq-cubby[data-key=pf_dino]').click();
  seen = (await sq(page)).seen;
  c(seen.pf_dino && !seen.pf_unicorn, 'B8 a cubby tap clears its NEW!');
  await page.locator('.sq-detail .sw-btn', { hasText: 'Back' }).click();
  await settle(page, 2600);
  await closeAll(page);
  seen = (await sq(page)).seen;
  c(seen.pf_unicorn, 'B8 a 2.5 s open clears every NEW! on screen');

  // B13 the ring: a spend never moves it; earning does, as the coins land (first fill it part way)
  const togo13 = (await sq(page)).toNext;
  await earn(page, Math.max(1, togo13 - 60));
  const r0 = await ev(page, () => window.__game.squish.ring());
  c(r0.frac > 0 && r0.frac < 1, `B13 the ring is part way (${r0.frac})`);
  await ev(page, () => window.__game.coins.spend(30, 'shop'));
  await settle(page, 400);
  const r1 = await ev(page, () => window.__game.squish.ring());
  c(r1.frac === r0.frac, `B13 a spend of 30: the ring is unchanged (${r0.frac} -> ${r1.frac})`);
  await ev(page, () => window.__game.coins.add(10, 'gift'));
  c(await waitOk(page, (f) => window.__game.squish.ring().frac > f, r1.frac, 8000), 'B13 earning 10 moves it as the coins land');

  // B9 the Glitter round
  await ev(page, () => window.__game.debug.squish.giveAll());
  await earn(page, (await sq(page)).toNext);
  await ev(page, () => window.__game.debug.squish.open());
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
  await settle(page, 400);
  for (let i = 0; i < 3; i++) { await ev(page, () => window.__game.debug.squish.tapPresent()); await settle(page, 650); }
  c(await waitOk(page, () => { const r = document.querySelector('.sq-pickrow'); return r && !r.hidden && r.children.length > 0; }, null, 5000), 'B9 the pick row shows');
  c(/Pick a toy to make sparkly!/.test(await ev(page, () => document.querySelector('.sq-say').innerText)), 'B9 "Pick a toy to make sparkly!"');
  await settle(page, 1200);
  await shot(page, 'glitter-pick', PREFIX);
  await ev(page, () => window.__game.debug.squish.pick('pf_dino'));
  c(await waitOk(page, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 5000), 'B9 picked');
  const b9 = await ev(page, () => document.querySelector('.sq-say').innerText);
  c(/Now it sparkles!/.test(b9) && /Dino Puffum!/.test(b9) && !/NEW!/.test(b9), `B9 "Now it sparkles!" / "Dino Puffum!", no "NEW!" (${b9.replace(/\n/g, ' / ')})`);
  c(!!(await sq(page)).glit.pf_dino, 'B9 the Dino is sparkly');
  await settle(page, 1200);
  await shot(page, 'glitter-reveal', PREFIX);
  await ev(page, () => window.__game.ui.open('squish'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-counts');
  c(/Glitter 1 of 48/.test(await ev(page, () => document.querySelector('.sq-counts').innerText)), 'B9 the shelf shows "Glitter 1 of 48"');
  await closeAll(page);
  await ev(page, () => window.__game.debug.squish.giveAll({ glitter: true }));
  await settle(page, 400);
  s = await sq(page);
  const ring = await ev(page, () => window.__game.squish.ring());
  c(s.ready === 0 && ring.state === 'done', `B9 everything: no present ready, the ring shows the star (${ring.state})`);
  c(await ev(page, () => document.querySelector('.sw-coins-ring .sq-ring-star').getAttribute('display') === 'inline'), 'B9 the ring\'s gold star');
  await ev(page, () => window.__game.ui.open('squish'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-champ');
  c(/You found every toy! You are a Squish Champion!/.test(await ev(page, () => document.querySelector('.sq-champ').innerText)), 'B9 the champion line');
  c(await waitOk(page, () => window.__game.stickers.has('squish_all'), null, 3000), 'B9 the "Squish Champion" sticker');
  await shot(page, 'shelf-champion', PREFIX);
  await closeAll(page);

  // B10 words: every visible text in the drop, both panels, the HUD buttons, tips and hints
  const words = await ev(page, () => window.__probeWords || []);
  const scan = [...words, ...(await textsOf(page, ['.lf-hud', '.sw-hud .sw-coins']))];
  await ev(page, () => window.__game.ui.open('squish'));
  scan.push(...(await textsOf(page, ['.sw-panel-wrap.sw-open'])));
  await closeAll(page);
  scan.push(dropText, b3, b9, 'Your toys live here!');
  scan.push(...(await ev(page, () => window.__toasts.filter((t) => /toy|Squish|put|Bag|holding/i.test(t)))));
  const bad = scan.filter((x) => WORDS.test(x));
  c(bad.length === 0, `B10 no prices, chances or pronouns in ${scan.length} texts (${bad.slice(0, 3).join(' | ')})`);
  await context.close();

  // B12 Girl / Boy / Mix: the first present and the cushion; nothing stored
  for (const [style, first, cushion] of [['boy', 'pf_dino', '#A6D8FF'], ['girl', 'pf_unicorn', '#FFB8D6'], [null, 'pf_strawberry', '#D8C8FF']]) {
    const { context: cx, page: p2 } = await openGame(browser, { errors, label: 'style-' + (style || 'mix') });
    if (style) await ev(p2, (s) => window.__game.store.deviceSet('surpriseStyle', s), style);
    await setup(p2);
    await earn(p2, 50);
    await ev(p2, () => window.__game.debug.squish.open());
    await p2.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
    const cu = await ev(p2, () => window.__game.debug.squish.panels.unwrapState().cushion);
    for (let i = 0; i < 3; i++) { await ev(p2, () => window.__game.debug.squish.tapPresent()); await settle(p2, 600); }
    await wait(p2, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 8000).catch(() => {});
    const got = Object.keys((await sq(p2)).got);
    const stored = await ev(p2, () => JSON.stringify(window.__game.profile).includes('surpriseStyle'));
    c(got[0] === first && cu === cushion && !stored, `B12 ${style || 'mix'}: the first present is ${first} (${got[0]}), the cushion ${cushion} (${cu}), nothing stored`);
    if (style === 'boy') await shot(p2, 'unwrap-boy', PREFIX);
    await cx.close();
  }
}

// =====================================================================================
// touch
// =====================================================================================

async function touchPass(browser, errors) {
  console.log('\n[touch] iPad and phones');
  const c = (cond, msg) => check(errors, cond, msg);
  for (const vp of [IPAD, { width: 1366, height: 1024 }, { width: 390, height: 844 }]) {
    const phone = vp.width < 500;
    const label = `${vp.width}x${vp.height}`;
    const { context, page } = await openGame(browser, { errors, viewport: vp, touch: true, label: 'touch-' + label });
    await setup(page);
    // C1 the pill: a big enough tap box, a tap opens the shelf, the text is still the number
    const pb = await ev(page, () => {
      const el = document.querySelector('.sw-hud .sw-coins'), r = el.getBoundingClientRect(), ring = el.querySelector('.sw-coins-ring').getBoundingClientRect();
      const cx = r.left + r.width / 2;
      // the tap box: the pill and its invisible margin (::after), measured by hit tests
      const inPill = (n) => !!n && (n === el || el.contains(n));
      let top = r.top, bottom = r.bottom;
      for (let d = 1; d <= 6 && inPill(document.elementFromPoint(cx, r.top - d)); d++) top = r.top - d;
      for (let d = 1; d <= 6 && inPill(document.elementFromPoint(cx, r.bottom + d)); d++) bottom = r.bottom + d;
      return { w: r.width, h: bottom - top, ring: ring.width, text: el.textContent };
    });
    c(pb.w >= 44 && pb.h >= 44, `C1 ${label}: the coin pill's tap box is at least 44 x 44 (${pb.w.toFixed(0)} x ${pb.h.toFixed(0)})`);
    c(/^\d+$/.test(pb.text), `C1 ${label}: the pill's text is only the number ("${pb.text}")`);
    c(pb.ring >= (phone ? 24 : 28) - 0.5, `C1 ${label}: the ring is ${pb.ring.toFixed(0)} px (${phone ? 24 : 28} wanted)`);
    await page.locator('.sw-hud .sw-coins').tap();
    c(await waitOk(page, () => window.__game.ui.current === 'squish', null, 4000), `C1 ${label}: a tap opens the shelf`);
    if (await page.locator('.sq-tip button').count()) await page.locator('.sq-tip button').tap();
    await settle(page, 1200);
    // C3 no horizontal scroll, cubbies at least 72 px
    const c3 = await ev(page, () => {
      const body = document.querySelector('.sw-panel-wrap.sw-open .sw-card-body'), card = document.querySelector('.sw-panel-wrap.sw-open .sw-card');
      const cub = [...document.querySelectorAll('.sq-cubby')].map((e) => e.getBoundingClientRect().width);
      return { over: Math.max(body.scrollWidth - body.clientWidth, card.scrollWidth - card.clientWidth, document.documentElement.scrollWidth - innerWidth), min: Math.min(...cub) };
    });
    c(c3.over <= 1 && c3.min >= 72, `C3 ${label}: the shelf fits (overflow ${c3.over} px), cubbies at least 72 px (${c3.min.toFixed(0)})`);
    await shot(page, phone ? 'shelf-phone' : vp.width === 1024 ? 'shelf-ipad' : 'shelf-ipad-wide', PREFIX);
    await closeAll(page);
    // C2 three taps open a present; Hold it; Squish! and Present clear of the joystick
    await earn(page, 110);
    c(await waitOk(page, () => { const b = document.querySelector('.lf-hud .sw-round[data-action="present"]'); return b && !b.hidden; }, null, 4000), `C2 ${label}: the Present button`);
    await page.locator('.lf-hud .sw-round[data-action="present"]').tap();
    await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
    await settle(page, 400);
    const stb = await page.locator('.sw-panel-wrap.sw-open .sq-stage').boundingBox();
    for (let i = 0; i < 3; i++) {
      await page.touchscreen.tap(stb.x + stb.width / 2, stb.y + stb.height / 2);
      await settle(page, 650);
    }
    c(await waitOk(page, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 8000), `C2 ${label}: three taps open it`);
    await settle(page, 1200);
    if (vp.width === 1024) await shot(page, 'unwrap-ipad', PREFIX);
    if (phone) await shot(page, 'unwrap-phone', PREFIX);
    await page.locator('.sq-btns .sw-btn', { hasText: 'Hold it' }).tap();
    await wait(page, () => !window.__game.ui.current && !!window.__game.squish.held(), null, 5000);
    await settle(page, 600);
    const lay = await ev(page, () => {
      const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      return { joy: r('.sw-joy'), squish: r('.lf-hud .sw-round[data-action="squish"]'), present: r('.lf-hud .sw-round[data-action="present"]'), away: r('.lf-hud .sw-round[data-action="squish-away"]') };
    });
    const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    c(lay.squish && !hit(lay.squish, lay.joy) && !hit(lay.present, lay.joy) && !hit(lay.away, lay.joy), `C2 ${label}: Squish!, Put away and Present are clear of the joystick (${JSON.stringify(lay)})`);
    await shot(page, phone ? 'hud-phone' : 'hud-' + label, PREFIX);
    // C5 at phone width: three different pictures (labels are hidden)
    if (phone) {
      const svgs = await ev(page, () => ['present', 'squish', 'squish-away'].map((a) => document.querySelector(`.lf-hud .sw-round[data-action="${a}"] .sw-round-face svg`).outerHTML));
      c(new Set(svgs).size === 3, 'C5 390 px: Present, Squish! and Put away are three different pictures');
    }
    // C4 the Bag's ghost click: choosing a toy places nothing under the finger
    await ev(page, () => window.__game.squish.putAway());
    const n0 = await ev(page, () => window.__game.entities.all().length);
    await page.locator('.sw-bagbtn').first().tap();
    await page.waitForSelector('.sw-panel-wrap.sw-open .sw-tab[data-tab=squish]');
    await page.locator('.sw-tab[data-tab=squish]').tap();
    await settle(page, 300);
    await page.locator('.sw-bag-grid .sw-item[data-key^="furn:squish_"]').first().tap();
    await settle(page, 700);
    c((await ev(page, () => window.__game.entities.all().length)) === n0, `C4 ${label}: choosing a toy in the Bag places none under the finger`);
    await closeAll(page);
    // C6 a 700 ms press on the shelf stage: no callout, no selection
    if (!phone) {
      await ev(page, () => window.__game.ui.open('squish'));
      await page.locator('.sq-cubby:not(.sq-mystery)').first().tap();
      await page.waitForSelector('.sq-detail .sq-stage');
      await settle(page, 500);
      const b = await page.locator('.sq-detail .sq-stage').boundingBox();
      const cdp = await context.newCDPSession(page);
      await ev(page, () => { window.__ctx = 0; document.addEventListener('contextmenu', () => window.__ctx++, true); });
      const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      await page.waitForTimeout(700);
      const syHeld = await ev(page, () => window.__game.debug.squish.panels.shownSy());
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const c6 = await ev(page, () => ({ sel: String(getSelection()), ctx: window.__ctx, ta: getComputedStyle(document.querySelector('.sq-detail .sq-stage')).touchAction }));
      c(c6.sel === '' && c6.ta === 'none', `C6 ${label}: a 700 ms press selects nothing (touch-action ${c6.ta}, contextmenu ${c6.ctx}, held sy ${syHeld && syHeld.toFixed(2)})`);
      await closeAll(page);
    }
    await context.close();
  }
  // C3 at 360 wide
  const { context, page } = await openGame(browser, { errors, viewport: { width: 360, height: 780 }, touch: true, label: 'touch-360' });
  await setup(page);
  await ev(page, () => window.__game.ui.open('squish'));
  await page.waitForSelector('.sw-panel-wrap.sw-open .sq-grid');
  await settle(page, 1200);
  const c3 = await ev(page, () => {
    const body = document.querySelector('.sw-panel-wrap.sw-open .sw-card-body');
    const cub = [...document.querySelectorAll('.sq-cubby')].map((e) => e.getBoundingClientRect().width);
    const br = body.getBoundingClientRect();
    const wide = [...body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > br.right + 1).slice(0, 4).map((e) => e.className || e.tagName);
    return { over: Math.max(body.scrollWidth - body.clientWidth, document.documentElement.scrollWidth - innerWidth), min: Math.min(...cub), wide };
  });
  check(errors, c3.over <= 1 && c3.min >= 72, `C3 360 px: no horizontal scroll (${c3.over}), cubbies ${c3.min.toFixed(0)} px ${c3.over > 1 ? JSON.stringify(c3.wide) : ''}`);
  await shot(page, 'shelf-360', PREFIX);
  await context.close();
}

// =====================================================================================
// world
// =====================================================================================

async function worldPass(browser, errors) {
  console.log('\n[world] the beach: toys on the floor, a table and the Toy Shelf');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, viewport: IPAD, touch: false, label: 'world' });
  await setup(page, 'beach');
  await ev(page, () => { const d = window.__game.debug.squish; d.give('pf_strawberry'); d.give('st_bubblegum'); d.give('pf_whale'); });
  const pad = await flatPad(page);
  const y = pad.y;
  const floor = await placeAt(page, 'squish_pf_strawberry', pad.x0 + 3, y, pad.z0 + 3);
  await placeAt(page, 'table_round', pad.x0 + 5, y, pad.z0 + 3);
  const onTable = await placeAt(page, 'squish_st_bubblegum', pad.x0 + 5, y + 1, pad.z0 + 3);
  const shelf = await placeAt(page, 'toy_shelf', pad.x0 + 8, y, pad.z0 + 3, 0, '#FF9CCB');
  const onShelf = await placeAt(page, 'squish_pf_whale', pad.x0 + 8, y + 1, pad.z0 + 3);
  const sh = await ev(page, ([a, b]) => { const E = window.__game.entities; const s = E.byUid(a), t = E.byUid(b); return { s: s.y + (s.yOffset || 0), t: t.y + (t.yOffset || 0) }; }, [shelf.uid, onShelf.uid]);
  c(floor && onTable && onShelf && Math.abs(sh.t - (sh.s + 0.98)) < 0.01, `W1 on the floor, a table and the Toy Shelf (shelf top ${sh.s + 0.98}, toy ${sh.t})`);
  const before = await ev(page, () => window.__game.entities.all().filter((e) => /^squish|toy_shelf/.test(e.key)).map((e) => [e.key, e.x, e.y, e.z, +(e.yOffset || 0).toFixed(3)]).sort().join(';'));
  await picture(page, 'world-beach', [pad.x0 + 5.5, y + 2.6, pad.z0 + 7.5], [pad.x0 + 5.5, y + 0.6, pad.z0 + 3.5]);
  const id = await ev(page, async () => { await window.__game.saveWorld({ thumbnail: false }); return window.__game.world.meta.id; });
  await page.reload();
  await waitForTitle(page);
  await ev(page, (id) => window.__game.debug.loadWorld(id), id);
  await page.waitForFunction(() => window.__game.mode === 'play' && !window.__game.loading, null, { timeout: 120000, polling: 250 });
  await waitIdle(page);
  await record(page);
  const after = await ev(page, () => window.__game.entities.all().filter((e) => /^squish|toy_shelf/.test(e.key)).map((e) => [e.key, e.x, e.y, e.z, +(e.yOffset || 0).toFixed(3)]).sort().join(';'));
  c(before === after && after.split(';').length === 4, `W1 saved and reloaded in place (${after})`);

  // W2 Remove and Undo; the profile does not change
  const prof0 = await ev(page, () => JSON.stringify(window.__game.profile.squish));
  const r = await ev(page, () => {
    const g = window.__game, E = g.entities;
    const e = E.all().find((x) => x.key === 'squish_pf_strawberry');
    const uid = e.uid;
    E.remove(e, { history: true });
    const gone = !E.byUid(uid);
    g.undo();
    return { gone, back: !!E.byUid(uid) };
  });
  c(r.gone && r.back, 'W2 Remove and Undo of a placed toy');
  c(prof0 === (await ev(page, () => JSON.stringify(window.__game.profile.squish))), 'W2 the profile did not change');

  // W3 at the default camera on a 1024 px iPad: a placed Stretchum is at least 44 px tall; a Hand
  // tap 0.3 blocks beside it (inside its cell) still squishes it
  const st = await ev(page, () => {
    const g = window.__game, e = g.entities.all().find((x) => x.key === 'squish_st_bubblegum');
    return { uid: e.uid, x: e.x, y: e.y, z: e.z };
  });
  await ev(page, (st) => {
    const g = window.__game;
    g.player.teleport(st.x + 0.5, st.y + 0.1, st.z + 1.8); // she stands by the table
    g.cameraRig.yaw = Math.PI;
    g.cameraRig.pitch = 0.32;
    g.cameraRig.snap && g.cameraRig.snap();
  }, st);
  await settle(page, 900);
  const h = await ev(page, (uid) => {
    const g = window.__game, e = g.entities.byUid(uid);
    const THREE = g.camera.position.constructor;
    let lo = Infinity, hi = -Infinity;
    const box = { min: { y: e.y + (e.yOffset || 0) }, max: { y: e.y + (e.yOffset || 0) + g.debug.squish.toyHeight('st_bubblegum') } };
    for (const yy of [box.min.y, box.max.y]) {
      const v = new THREE(e.x + 0.5, yy, e.z + 0.5).project(g.camera);
      const py = (1 - v.y) / 2 * g.renderer.domElement.getBoundingClientRect().height;
      lo = Math.min(lo, py);
      hi = Math.max(hi, py);
    }
    return hi - lo;
  }, st.uid);
  c(h >= 44, `W3 a placed Stretchum is ${h.toFixed(0)} px tall on a 1024 px iPad (44 wanted)`);
  await ev(page, () => window.__game.setTool('hand'));
  const p = await screenPoint(page, st.x + 0.8, st.y + 0.55 - 0.18, st.z + 0.5);
  const hitOk = await ev(page, ([x, y, uid]) => {
    const g = window.__game, r = g.renderer.domElement.getBoundingClientRect();
    const hit = g.pick({ x: ((x - r.left) / r.width) * 2 - 1, y: -(((y - r.top) / r.height) * 2 - 1) });
    return !!hit && hit.type === 'pickable' && hit.pickable.ref && hit.pickable.ref.uid === uid;
  }, [p.x, p.y, st.uid]);
  await page.mouse.click(p.x, p.y);
  c(hitOk && await waitOk(page, (uid) => { const e = window.__game.entities.byUid(uid); return e && !!e._squish; }, st.uid, 1500), 'W3 a Hand tap 0.3 blocks beside it still squishes it');
  await shot(page, 'world-ipad', PREFIX);
  await context.close();
}

// =====================================================================================
// save
// =====================================================================================

async function loadFixture(browser, errors, file, label) {
  const fx = JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
  const profile = fx.profile || fx;
  const ctx = await openGame(browser, { errors, label });
  await ev(ctx.page, async (p) => {
    const g = window.__game;
    for (const k of Object.keys(g.profile)) delete g.profile[k];
    Object.assign(g.profile, JSON.parse(JSON.stringify(p)));
    await g.store.saveProfile(p);
  }, profile);
  await ctx.page.reload();
  await waitForTitle(ctx.page);
  await settle(ctx.page, 600);
  return { ...ctx, profile };
}

async function savePass(browser, errors) {
  console.log('\n[save] old profiles, the rich fixture, reloads, backups, a 409');
  const c = (cond, msg) => check(errors, cond, msg);

  // E1 an old profile without coinsEarned
  {
    const { context, page, profile } = await loadFixture(browser, errors, 'tools/fixtures/boys-old-profile.json', 'old-boys');
    const t = await ev(page, () => ({ squish: 'squish' in window.__game.profile, hello: document.querySelector('.sw-hello') ? document.querySelector('.sw-hello').textContent : '', upd: window.__game.profile.updatedAt }));
    await settle(page, 1500);
    const saved = await ev(page, async () => { const p = await window.__game.store.loadProfile(); return { squish: !!(p && p.squish), upd: p && p.updatedAt }; });
    // (other modules may tidy an old profile at the title; the squishy toys add nothing there)
    c(!t.squish && !saved.squish, `E1 nothing of the squishy toys is made or saved on the title screen (saved again: ${saved.upd !== profile.updatedAt})`);
    c(t.hello.includes('Hi, Lily!'), `E1 "Hi, Lily!" (${t.hello})`);
    await setup(page, 'meadow');
    const s = await sq(page);
    const p = await ev(page, () => ({ coins: window.__game.profile.coins, stickers: Object.keys(window.__game.profile.stickers).sort().join(), look: JSON.stringify(window.__game.profile.look.hair) }));
    c(s.base && s.base.coins === 0 && s.ready === 0, `E1 after the first world load: base 0, ready 0 (${JSON.stringify(s.base)})`);
    c(p.coins === 100 && p.stickers === Object.keys(profile.stickers).sort().join() && p.look === JSON.stringify(profile.look.hair), 'E1 coins (100), stickers and look unchanged');
    await ev(page, () => window.__game.ui.open('squish'));
    c(await waitOk(page, () => document.querySelector('.sq-togo') && document.querySelector('.sq-togo').textContent === '50 to go!', null, 4000), 'E1 the shelf says "50 to go!"');
    await context.close();
  }
  // E2 the old-world fixture's profile (coinsEarned 60)
  {
    const { context, page } = await loadFixture(browser, errors, 'tools/fixtures/old-world-96565e4.json', 'old-world');
    await setup(page, 'meadow', { presents: false });
    const s = await sq(page);
    c(s.ready === 1, `E2 coinsEarned 60: one present ready (${s.ready})`);
    await context.close();
  }
  // E3 the rich fixture: exactly 3 ready, nothing else changed
  {
    const { context, page, profile } = await loadFixture(browser, errors, 'tools/fixtures/squish-rich-profile.json', 'rich');
    await setup(page, 'meadow', { presents: false });
    const s = await sq(page);
    c(s.ready === 3, `E3 about 2,000 earned: exactly 3 ready (${s.ready}, earned ${s.earned})`);
    const now = await ev(page, () => window.__game.profile);
    const same = ['look', 'outfits', 'coins', 'stickers', 'basket', 'playerName'].filter((k) => JSON.stringify(now[k]) !== JSON.stringify(profile[k]));
    c(same.length === 0 && now.stats.coinsEarned === profile.stats.coinsEarned, `E3 nothing else in the profile changed (${same.join(',') || 'look, outfits, coins, stickers, basket, name'})`);
    // E4 open one and reload within 100 ms of tap 3: the toy stays; between tap 2 and 3: still ready
    await ev(page, () => window.__game.debug.squish.open());
    await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
    for (let i = 0; i < 2; i++) { await ev(page, () => window.__game.debug.squish.tapPresent()); await settle(page, 600); }
    await page.reload();
    await waitForTitle(page);
    let p = await ev(page, () => window.__game.profile.squish);
    c(Object.keys(p.got || {}).length === 0, 'E4 a reload between tap 2 and 3: nothing opened');
    await setup(page, 'meadow', { presents: false });
    c((await sq(page)).ready === 3, 'E4 and the present is still ready');
    await ev(page, () => window.__game.debug.squish.open());
    await page.waitForSelector('.sw-panel-wrap.sw-open .sq-unwrap');
    for (let i = 0; i < 2; i++) { await ev(page, () => window.__game.debug.squish.tapPresent()); await settle(page, 600); }
    await ev(page, () => window.__game.debug.squish.tapPresent());
    await page.waitForTimeout(90);
    await page.reload();
    await waitForTitle(page);
    p = await ev(page, () => window.__game.profile.squish);
    c(Object.keys(p.got || {}).length === 1, `E4 a reload 90 ms after tap 3: the toy is kept (${Object.keys(p.got || {})})`);
    await context.close();
  }
  // E5 "Save a copy" then "Open a file": toys come back; both sets kept; a file without squish
  {
    const { context, page } = await openGame(browser, { errors, label: 'backup' });
    await setup(page, 'meadow', { presents: false });
    await ev(page, () => { const d = window.__game.debug.squish; d.give('pf_whale'); d.give('st_heart'); });
    const text = await ev(page, async () => window.__game.store.exportAll(window.__game.profile));
    const file = path.join(SHOTS, 'squish-backup.json');
    await writeFile(file, typeof text === 'string' ? text : JSON.stringify(text));
    const fileNo = path.join(SHOTS, 'squish-backup-nosquish.json');
    const parsed = JSON.parse(typeof text === 'string' ? text : JSON.stringify(text));
    delete parsed.profile.squish;
    await writeFile(fileNo, JSON.stringify(parsed));
    await context.close();
    const openFile = async (pg, f) => {
      await ev(pg, () => window.__game.ui.open('worlds'));
      const btn = pg.locator('.sw-panel-wrap.sw-open button:visible', { hasText: 'Open a file' }).first();
      await btn.waitFor({ timeout: 15000 });
      const ch = pg.waitForEvent('filechooser', { timeout: 15000 });
      ch.catch(() => {});
      await btn.click();
      await (await ch).setFiles(f);
      await settle(pg, 1500);
      const q = pg.locator('.sw-dialog button').first();
      if (await q.count()) await q.click().catch(() => {});
      await settle(pg, 800);
    };
    const B = await openGame(browser, { errors, label: 'restore-fresh' });
    await openFile(B.page, file);
    let got = await ev(B.page, () => Object.keys((window.__game.profile.squish && window.__game.profile.squish.got) || {}).sort());
    c(got.join() === 'pf_whale,st_heart', `E5 restored onto a fresh profile: the toys come back (${got})`);
    await B.context.close();
    const C = await openGame(browser, { errors, label: 'restore-other' });
    await setup(C.page, 'meadow', { presents: false });
    await ev(C.page, () => window.__game.debug.squish.give('pf_dino'));
    await ev(C.page, () => window.__game.exitToTitle());
    await waitForTitle(C.page);
    await openFile(C.page, file);
    got = await ev(C.page, () => Object.keys(window.__game.profile.squish.got).sort());
    c(got.join() === 'pf_dino,pf_whale,st_heart', `E5 restored onto a profile with other toys: both sets kept (${got})`);
    const n0 = await ev(C.page, () => { window.__pc = 0; window.__game.events.on('profile:changed', () => window.__pc++); return JSON.stringify(window.__game.profile.squish); });
    await ev(C.page, () => window.__game.ui.close());
    await openFile(C.page, fileNo);
    const n1 = await ev(C.page, () => ({ s: JSON.stringify(window.__game.profile.squish), pc: window.__pc }));
    c(n1.s === n0 && n1.pc === 0, `E5 a file without squish: no change, no profile:changed (${n1.pc})`);
    await C.context.close();
  }
  // E6 a 409 merge during play (store.onProfile) with one more toy: the tab shows it within 1.5 s
  {
    const { context, page } = await openGame(browser, { errors, label: 'merge-409' });
    await setup(page, 'meadow', { presents: false });
    await ev(page, () => window.__game.debug.squish.give('pf_dino'));
    const t0 = Date.now();
    await ev(page, () => {
      const g = window.__game;
      const merged = JSON.parse(JSON.stringify(g.profile));
      merged.squish.got.st_cloud = new Date().toISOString();
      merged.stats.coinsEarned = (merged.stats.coinsEarned || 0) + 180; // 2 opened, 3 reached: 1 ready
      merged.updatedAt = Date.now() + 1000;
      // what src/account/index.js does with a 409 (Object.assign, no profile:changed)
      Object.assign(g.profile, JSON.parse(JSON.stringify(merged)));
    });
    const ok = await waitOk(page, () => !window.__game.registry.items.get('furn:squish_st_cloud').hidden, null, 3000);
    c(ok && Date.now() - t0 < 2000, `E6 the Squish Toys tab shows the merged toy within 1.5 s (${Date.now() - t0} ms)`);
    c((await sq(page)).ready === 1, 'E6 and ready is recounted');
    await context.close();
  }
}

// =====================================================================================
// mp
// =====================================================================================

async function mpPass(browser, errors) {
  console.log('\n[mp] Lily hosts, Rosie joins');
  const c = (cond, msg) => check(errors, cond, msg);
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
    return pl;
  };
  const lily = await open({ key: 'lily', name: 'Lily', uid: 'u-lily', level: 'interact', can: true, guest: false, viewport: { width: 1280, height: 800 }, touch: false, seed: 11 });
  const rosie = await open({ key: 'rosie', name: 'Rosie', uid: 'u-rosie', level: 'view', can: null, guest: false, viewport: { width: 1024, height: 768 }, touch: true, seed: 29 });
  const converge = async (players, label) => {
    const r = await flows.converge(players, { timeout: 60000 });
    return c(r.ok, `${label}: equal hashes and entities${r.detail ? ' (' + r.detail + ')' : ''}`);
  };
  const code = await flows.hostMakesCode(lily, { biome: 'flat' });
  await flows.guestTypesCode(rosie, code);
  await flows.hostLetsIn(lily, 'Rosie');
  c(await waitLive(rosie), 'Rosie is in Lily\'s world');
  await closePanels(lily);
  await bringTo(rosie, lily, 2, 2);
  await converge([lily, rosie], 'start');

  // M1 Lily holds the Splashy Whale: Rosie sees it in Lily's hand; put away: gone
  await game(lily, () => { const g = window.__game; g.debug.squish.give('pf_whale'); g.squish.hold('pf_whale'); });
  c(await until(rosie, () => window.__game.debug.net.remote().some((r) => r.name === 'Lily' && r.inHand === 'squish:pf_whale'), null, 12000), 'M1 Rosie sees the Splashy Whale in Lily\'s hand (squish:pf_whale)');
  await settle(rosie.page, 600);
  await shot(rosie.page, 'mp-rosie-sees-whale', PREFIX);
  await game(lily, () => window.__game.squish.putAway());
  c(await until(rosie, () => window.__game.debug.net.remote().some((r) => r.name === 'Lily' && !r.inHand), null, 12000), 'M1 put away: gone from her hand on Rosie\'s page');

  // M2 Rosie places a toy she owns in Lily's world: Lily sees it
  const rt = await game(rosie, () => {
    const g = window.__game;
    g.debug.squish.give('st_heart');
    const p = g.player.position;
    const x = Math.floor(p.x) + 2, z = Math.floor(p.z) + 2, y = g.world.heightAt(x, z) + 1;
    const e = g.entities.place('squish_st_heart', x, y, z, 0, null, {});
    return e ? e.uid : null;
  });
  c(!!rt && await until(lily, (uid) => !!window.__game.entities.byUid(uid) && window.__game.entities.byUid(uid).key === 'squish_st_heart', rt, 12000), 'M2 Rosie\'s toy appears in Lily\'s world');
  await converge([lily, rosie], 'M2');

  // M3 Rosie opens a present during the session: Lily's profile, coins and stickers unchanged
  const lily0 = await game(lily, () => JSON.stringify({ c: window.__game.profile.coins, s: window.__game.profile.stickers, q: window.__game.profile.squish }));
  await game(rosie, async () => {
    const g = window.__game;
    g.coins.add(Math.max(1, g.debug.squish.state().toNext), 'gift', { fly: false });
    await new Promise((r) => setTimeout(r, 300));
    g.debug.squish.open();
  });
  await until(rosie, () => window.__game.ui.current === 'present', null, 5000);
  for (let i = 0; i < 3; i++) { await game(rosie, () => window.__game.debug.squish.tapPresent()); await rosie.page.waitForTimeout(650); }
  c(await until(rosie, () => window.__game.debug.squish.panels.unwrapState().phase === 'shown', null, 8000), 'M3 Rosie opens a present');
  await game(rosie, () => window.__game.ui.close());
  const rs = await game(rosie, () => Object.keys(window.__game.profile.squish.got).length);
  const lily1 = await game(lily, () => JSON.stringify({ c: window.__game.profile.coins, s: window.__game.profile.stickers, q: window.__game.profile.squish }));
  c(lily0 === lily1 && rs >= 2, `M3 Lily's profile, coins and stickers are unchanged; the toy is Rosie's (${rs} toys)`);

  // M4 Lily's Hand tap on Rosie's toy sends no journal or ops message
  await converge([lily, rosie], 'M4 before');
  const sent0 = fc.stats().find((s) => s.label === 'lily');
  const e0 = sent0 ? sent0.emits : 0;
  await game(lily, (uid) => { const g = window.__game; g.setTool('hand'); return g.debug.interact(uid); }, rt);
  await lily.page.waitForTimeout(1000);
  const sent1 = fc.stats().find((s) => s.label === 'lily');
  c(sent1 && sent1.emits === e0, `M4 a Hand tap on a friend's toy: no journal or ops message (${e0} -> ${sent1 && sent1.emits})`);
  for (const pl of [lily, rosie]) {
    const s = await game(pl, () => window.__swFakeStats());
    c(s.maxPresence <= 3900 && Object.keys(s.rejects).length === 0, `${pl.key}: presence at most ${s.maxPresence} B, no refusals`);
  }
  for (const pl of [lily, rosie]) await pl.context.close();
  hub.close?.();
}

// =====================================================================================
// grids (owner review pictures)
// =====================================================================================

async function gridsPass(browser, errors) {
  console.log('\n[grids] the owner-review pictures');
  const { context, page } = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }).then(async (cx) => {
    const pg = await cx.newPage();
    attachErrorCollectors(pg, errors, 'grids');
    await pg.goto(PAGE_URL);
    await waitForTitle(pg);
    return { context: cx, page: pg };
  });
  await setup(page, 'meadow', { presents: false });
  await ev(page, () => { window.__game.setDayTime(0.42); });
  // toys in a row-per-line grid, one block apart, seen from the front so the faces show
  const grid = async (name, keys, { glitter = false, cols = 12 } = {}) => {
    const rows = Math.ceil(keys.length / cols);
    const pad = await flatPad(page, cols + 4, rows + 10);
    await ev(page, ([keys, pad, glitter, cols]) => {
      const g = window.__game;
      keys.forEach((k, i) => {
        const x = pad.x0 + 2 + (i % cols), z = pad.z0 + 2 + Math.floor(i / cols);
        g.entities.place((glitter ? 'squishg_' : 'squish_') + k, x, pad.y, z, 0, null, {}, { history: false, fx: false });
      });
      // she stands out of the picture
      g.player.teleport(pad.x0 + 2, pad.y + 0.1, pad.z0 - 6);
    }, [keys, pad, glitter, cols]);
    const cx = pad.x0 + 2 + cols / 2, zf = pad.z0 + 2 + rows;
    const file = await picture(page, name, [cx, pad.y + 2.2 + rows * 0.55, zf + 4.2 + rows * 0.5], [cx, pad.y + 0.15, pad.z0 + 2 + rows / 2], { fov: 50, ms: 1800 });
    await ev(page, () => { const g = window.__game; for (const e of [...g.entities.all()]) if (/^squish/.test(e.key)) g.entities.remove(e, { history: false, fx: false }); });
    return file;
  };
  const keys = await ev(page, () => window.__game.debug.squish.order(null));
  const files = [];
  files.push(await grid('all', keys.slice(0, 48)));
  files.push(await grid('glitter', keys.slice(0, 48), { glitter: true }));
  files.push(await grid('sea', ['pf_dolphin', 'pf_mermaid', 'pf_seadragon', 'pf_whale', 'pf_octopus', 'pf_shark', 'st_ocean', 'st_starfish', 'st_shell'], { cols: 9 }));
  files.push(await grid('sea-glitter', ['pf_dolphin', 'pf_mermaid', 'pf_seadragon', 'pf_whale', 'pf_octopus', 'pf_shark', 'st_ocean', 'st_starfish', 'st_shell'], { cols: 9, glitter: true }));
  // a close look at each toy (the review sheet): pictures of all 48 on one page, plain and sparkly
  for (const glitter of [false, true]) {
    await ev(page, async (glitter) => {
      const g = window.__game, d = g.debug.squish;
      const keys = d.order(null).slice(0, 48);
      const urls = await Promise.all(keys.map((k) => g.squish.toyIcon(k, glitter)));
      const names = keys.map((k) => g.registry.items.get('furn:squish_' + k).name);
      const el = document.createElement('div');
      el.id = 'probe-sheet';
      el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#FFF7FB;display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;font:600 13px system-ui;color:#3A1F4D;text-align:center;overflow:hidden';
      urls.forEach((u, i) => { const c = document.createElement('div'); c.innerHTML = `<img src="${u}" style="width:118px;height:118px"><div>${names[i]}</div>`; el.appendChild(c); });
      document.body.appendChild(el);
    }, glitter);
    await settle(page, 800);
    files.push(await shot(page, glitter ? 'sheet-glitter' : 'sheet', PREFIX));
    await ev(page, () => document.getElementById('probe-sheet').remove());
  }
  // the world: toys on a table and on the Toy Shelf in all 4 colors
  const pad = await flatPad(page, 14, 8);
  await ev(page, (pad) => {
    const g = window.__game, d = g.debug.squish;
    const cols = ['#E7BE8C', '#FFFFFF', '#A6D8FF', '#FF9CCB'];
    const toys = ['pf_strawberry', 'st_bubblegum', 'pf_unicorn', 'pf_dino', 'st_gold', 'pf_dolphin', 'st_heart', 'pf_panda'];
    for (const t of toys) d.give(t);
    cols.forEach((c, i) => {
      const x = pad.x0 + 1 + i * 3, z = pad.z0 + 3;
      g.entities.place('toy_shelf', x, pad.y, z, 0, c, {}, { history: false, fx: false });
      g.entities.place('squish_' + toys[i * 2], x, pad.y + 1, z, 0, null, {}, { history: false, fx: false });
      g.entities.place('squish_' + toys[i * 2 + 1], x + 1, pad.y + 1, z, 0, null, {}, { history: false, fx: false });
    });
    g.entities.place('table_round', pad.x0 + 6, pad.y, pad.z0 + 6, 0, null, {}, { history: false, fx: false });
    g.entities.place('squish_pf_strawberry', pad.x0 + 6, pad.y + 1, pad.z0 + 6, 0, null, {}, { history: false, fx: false });
  }, pad);
  files.push(await picture(page, 'world', [pad.x0 + 6, pad.y + 3.2, pad.z0 + 12], [pad.x0 + 5.5, pad.y + 0.6, pad.z0 + 4], { fov: 50, ms: 1500 }));
  // holding: a close camera on her hand
  await ev(page, () => { const g = window.__game; g.debug.squish.give('pf_unicorn'); g.squish.hold('pf_unicorn', false, { quiet: true }); });
  await settle(page, 600);
  const hp = await ev(page, () => { const p = window.__game.player.position, y = window.__game.cameraRig.yaw; return [p.x, p.y, p.z, y]; });
  files.push(await picture(page, 'hand', [hp[0] + Math.sin(hp[3]) * 2.2 + 0.6, hp[1] + 1.6, hp[2] + Math.cos(hp[3]) * 2.2], [hp[0], hp[1] + 1.0, hp[2]], { fov: 40, ms: 900 }));
  // sticker art
  await ev(page, () => {
    const g = window.__game;
    const el = document.createElement('div');
    el.id = 'probe-stk';
    el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff;display:flex;gap:24px;align-items:center;justify-content:center';
    for (const id of ['squish_first', 'squish_ten', 'squish_all', 'squish_squeeze']) {
      const c = g.stickers.canvas(id);
      c.style.width = '220px';
      c.style.height = '220px';
      const w = document.createElement('div');
      w.style.cssText = 'text-align:center;font:700 20px system-ui;color:#3A1F4D';
      w.append(c, Object.assign(document.createElement('div'), { textContent: g.registry.stickers.get(id).name }));
      el.appendChild(w);
    }
    document.body.appendChild(el);
  });
  await settle(page, 600);
  files.push(await shot(page, 'sticker-art', PREFIX));
  await ev(page, () => document.getElementById('probe-stk').remove());
  check(errors, files.every(Boolean), `F6 ${files.length} pictures written`);
  await context.close();
}

// =====================================================================================
// cost
// =====================================================================================

const drawCallsOf = (page, view) => page.evaluate(async (view) => {
  const g = window.__game;
  const rig = g.cameraRig.update;
  g.cameraRig.update = () => {};
  g.camera.position.set(view[0] + 7, view[1] + 6, view[2] - 7);
  g.camera.lookAt(view[0], view[1], view[2]);
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  await frame();
  await frame();
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await frame();
    samples.push(g.renderer.info.render.calls);
  }
  g.cameraRig.update = rig;
  return samples.sort((a, b) => a - b)[2];
}, view);

async function costPass(browser, errors) {
  console.log('\n[cost] draw calls, the systems stage, thumbnails, geometry');
  const c = (cond, msg) => check(errors, cond, msg);
  const { context, page } = await openGame(browser, { errors, label: 'cost' });
  await setup(page, 'meadow', { presents: false });
  await ev(page, () => { window.__game.debug.squish.giveAll({ glitter: true }); window.__game.setDayTime(0.42); });
  const pad = await flatPad(page, 16, 10);
  const view = [pad.x0 + 8, pad.y, pad.z0 + 4];
  await settle(page, 1000);
  const idle0 = await drawCallsOf(page, view);
  // F1 60 placed idle toys: 48 opaque, 12 see-through
  await ev(page, (pad) => {
    const g = window.__game, d = g.debug.squish;
    const keys = d.order(null);
    const see = ['st_gold', 'st_rainbow', 'st_galaxy', 'st_lime', 'st_grape', 'st_ocean'];
    const opaque = keys.filter((k) => !see.includes(k));
    const list = [...opaque, ...opaque.slice(0, 6), ...see, ...see].slice(0, 60);
    list.forEach((k, i) => {
      const glitter = i >= 42 && i < 48;
      g.entities.place((glitter ? 'squishg_' : 'squish_') + k, pad.x0 + 1 + (i % 15), pad.y, pad.z0 + 1 + Math.floor(i / 15) * 2, 0, null, {}, { history: false, fx: false });
    });
  }, pad);
  await settle(page, 1500);
  const idle1 = await drawCallsOf(page, view);
  c(idle1 - idle0 <= 14, `F1 60 placed idle toys add ${idle1 - idle0} draw calls (14 at most; ${idle0} -> ${idle1})`);
  await ev(page, () => { const g = window.__game, e = g.entities.all().find((x) => x.key === 'squish_pf_strawberry'); g.entities.use(e, null); });
  await settle(page, 150);
  const sq1 = await drawCallsOf(page, view);
  c(sq1 - idle1 <= 1, `F1 squishing one adds ${sq1 - idle1} (1 at most)`);
  await settle(page, 3000);
  const sq2 = await drawCallsOf(page, view);
  c(sq2 <= idle1, `F1 back to the idle count within 3 s (${sq2})`);
  // F2 holding a toy adds at most 2
  await ev(page, () => window.__game.squish.hold('pf_unicorn', false, { quiet: true }));
  await settle(page, 600);
  const pv = await ev(page, () => { const p = window.__game.player.position; return [p.x, p.y + 1, p.z]; });
  const h0 = await drawCallsOf(page, pv);
  await ev(page, () => window.__game.squish.putAway());
  await settle(page, 400);
  const h1 = await drawCallsOf(page, pv);
  c(h0 - h1 <= 2, `F2 holding a toy adds ${h0 - h1} draw calls (2 at most)`);
  // F3 the systems stage with 60 idle toys: at most idle + 0.3 ms over 120 frames
  const stage = await ev(page, async () => {
    const g = window.__game;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const time = async () => {
      let sum = 0;
      for (let i = 0; i < 120; i++) {
        const t = performance.now();
        g.entities.update(1 / 60);
        const sys = g.getSystem('squish-presents');
        sys.update(1 / 60);
        sum += performance.now() - t;
        if (i % 10 === 0) await frame();
      }
      return sum / 120;
    };
    const withToys = await time();
    const removed = [];
    for (const e of [...g.entities.all()]) if (/^squish/.test(e.key)) { removed.push([e.key, e.x, e.y, e.z]); g.entities.remove(e, { history: false, fx: false }); }
    const without = await time();
    for (const [k, x, y, z] of removed) g.entities.place(k, x, y, z, 0, null, {}, { history: false, fx: false });
    return { withToys, without };
  });
  c(stage.withToys - stage.without <= 0.3, `F3 entities + squish systems with 60 idle toys: ${stage.withToys.toFixed(3)} ms vs ${stage.without.toFixed(3)} ms a frame (+0.3 at most)`);
  // F4 the shelf with all 96: no frame over 1 s, all thumbnails within 20 s
  const f4 = await ev(page, async () => {
    const g = window.__game;
    const n0 = g.diag.longFrames.length;
    const t0 = performance.now();
    g.ui.open('squish');
    const keys = g.debug.squish.order(null).slice(0, 48);
    let shownMs = 0;
    const all = Promise.all(keys.map((k) => g.squish.toyIcon(k, true)));
    let allDone = false;
    all.then(() => { allDone = true; });
    for (;;) {
      const missing = document.querySelectorAll('.sq-cubby .sq-ph').length;
      if (!missing && !shownMs) shownMs = performance.now() - t0;
      if ((shownMs && allDone) || performance.now() - t0 > 40000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const ms = performance.now() - t0;
    const missing = document.querySelectorAll('.sq-cubby .sq-ph').length;
    const lf = g.diag.longFrames.slice(n0);
    const worst = Math.max(0, ...lf.map((f) => f.ms));
    const worstStages = JSON.stringify((lf.find((f) => f.ms === worst) || {}).stages || {});
    g.ui.close();
    return { worst, worstStages, frames: lf.map((f) => f.ms).join(','), ms, shownMs, missing, maxJob: Math.round(g.thumbs.stats.maxJobMs) };
  });
  c(f4.worst < 1000 && f4.missing === 0 && f4.ms < 20000, `F4 the shelf with 96 owned: worst frame ${f4.worst.toFixed(0)} ms, the 48 on screen in ${(f4.shownMs / 1000).toFixed(1)} s, all 96 thumbnails in ${(f4.ms / 1000).toFixed(1)} s (longest job ${f4.maxJob} ms)${f4.worst >= 1000 ? ' worst: ' + f4.worstStages : ''} frames ${f4.frames}`);
  // F5 geometry: the shelf and the present panel 10 times
  const f5 = await ev(page, async () => {
    const g = window.__game;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const cycle = async () => {
      g.ui.open('squish');
      await frame();
      const c = document.querySelector('.sq-cubby:not(.sq-mystery)');
      if (c) c.click();
      for (let i = 0; i < 3; i++) await frame();
      g.ui.close();
      g.debug.squish.open();
      for (let i = 0; i < 3; i++) await frame();
      g.ui.close();
      await frame();
    };
    await cycle();
    await cycle();
    const geo0 = g.renderer.info.memory.geometries;
    for (let i = 0; i < 10; i++) await cycle();
    const geo1 = g.renderer.info.memory.geometries;
    return { geo0, geo1, pivot: g.debug.squish.stagePivot() };
  });
  c(f5.pivot === 0, `F5 nothing is left under the preview pivot (${f5.pivot})`);
  c(f5.geo1 - f5.geo0 <= 4, `F5 opening and closing the shelf and the present 10 times: geometries ${f5.geo0} -> ${f5.geo1} (4 at most)`);
  await context.close();
}

// =====================================================================================

const errors = [];
const browser = await launch({ headed: !!args.headed });
try {
  if (want('desktop')) await desktopPass(browser, errors);
  if (want('touch')) await touchPass(browser, errors);
  if (want('world')) await worldPass(browser, errors);
  if (want('save')) await savePass(browser, errors);
  if (want('mp')) await mpPass(browser, errors);
  if (want('grids')) await gridsPass(browser, errors);
  if (want('cost')) await costPass(browser, errors);
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
} finally {
  await browser.close();
  finish(errors);
}
