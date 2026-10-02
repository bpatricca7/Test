// Headless multiplayer acceptance tests (docs/MULTIPLAYER.md §15.2-15.3, AT1-AT22).
//
//   node tools/probe-multiplayer.mjs [--until=AT9] [--shots-prefix=net] [--biome=flat] [--headed]
//
// Three players, each in her own browser context (her own IndexedDB and profile):
//   Lily   host,  desktop 1280x800, mouse,  a claude.ai member who can host ('interact')
//   Rosie  guest, iPad 1024x768, touch,     view-level (never emits)
//   June   guest, phone 390x844, touch,     view-level outside visitor (joins in AT11)
// Every page gets a room.d.ts-faithful window.claude (tools/net/fake-claude.js) routed through
// one NetHub (tools/net/hub.mjs, the production room logic in server/rooms.mjs).
//
// The tests drive REAL clicks and taps for what a child does (Play with Friends, the keypad,
// the knock card, a hold-drag stroke, the door, the Remove tool, Undo, Players, Undo building,
// Send home, Say, emotes, resume chips, Save & Exit) and use the debug API to set up scenes
// and to read results. Each test ends with equal hashes on every page in the session; the run
// needs zero console errors. The tests run in order: later ones build on the session.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, attachErrorCollectors, waitForTitle, settle, finish, PAGE_URL, SHOTS, ROOT } from './smoke.mjs';
import { NetHub } from './net/hub.mjs';
import { FakeClaudeHub } from './net/fake-claude.js';
import * as flows from './net/mp-flows.mjs';
import * as codec from '../src/net/codec.js';
import { C as NETC } from '../src/net/protocol.js';

const { sleep, game, until, press, tapWorld, setupPage, trace, waitLive, bringTo, closePanels, VIEW } = flows;

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const UNTIL = arg('until') ? String(arg('until')).toUpperCase() : null;
const PREFIX = arg('shots-prefix', 'net');
const HEADED = !!arg('headed');
const BIOME = arg('biome', 'flat');
// touch pages at 1x by default: SwiftShader composites every page on the CPU (--dsf=2 for crisp shots)
const DSF = Number(arg('dsf', 1)) || 1;

const errors = [];
const results = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

function check(cond, message) {
  if (cond) console.log('    ok: ' + message);
  else {
    console.log('    FAIL: ' + message);
    errors.push('[check] ' + message);
  }
  return !!cond;
}

async function shot(pl, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await pl.page.screenshot({ path: file, timeout: 120000 });
  console.log(`    screenshot ${path.relative(ROOT, file)}`);
  return file;
}

const ACCOUNTS = { 'u-lily': 'Parker family (Mom)', 'u-rosie': 'Rosie R.', 'u-june': 'june.visitor@example.com' };

const PLAYERS = [
  { key: 'lily', name: 'Lily', uid: 'u-lily', level: 'interact', can: true, guest: false, viewport: { width: 1280, height: 800 }, touch: false, seed: 11 },
  { key: 'rosie', name: 'Rosie', uid: 'u-rosie', level: 'view', can: null, guest: false, viewport: { width: 1024, height: 768 }, touch: true, seed: 29 },
  { key: 'june', name: 'June', uid: 'u-june', level: 'view', can: null, guest: true, viewport: { width: 390, height: 844 }, touch: true, seed: 47 },
];

// ---------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------

const hub = new NetHub({
  clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
  budget: { rate: 100000, burst: 100000 }, // each page keeps the platform budget itself (fake-claude)
  maxPeers: 16,
  graceMs: 10000,
});
const fc = new FakeClaudeHub(hub);

async function openPlayer(browser, def) {
  const context = await browser.newContext({ viewport: def.viewport, hasTouch: def.touch, isMobile: def.touch, deviceScaleFactor: def.touch ? DSF : 1 });
  await fc.addContext(context, { uid: def.uid, level: def.level, can: def.can, guest: def.guest, accounts: ACCOUNTS, label: def.key });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, def.key);
  const pl = { ...def, context, page };
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForTitle(page, 180000);
  await setupPage(pl);
  return pl;
}

/** Reload a player's page (as a real reload: the old document leaves its rooms). */
async function reloadPlayer(pl) {
  const t0 = Date.now();
  await pl.page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await waitForTitle(pl.page, 180000);
  await setupPage(pl);
  log(`  ${pl.key} reloaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function toasts(pl) {
  return game(pl, () => window.__toasts.slice());
}

/** Wait until every guest applied everything and nothing is pending, then compare all pages. */
async function converge(players, label, timeout = 45000) {
  const r = await flows.converge(players, { timeout });
  if (r.detail) console.log(`    ${label}: ${r.detail}`);
  return check(r.ok, `${label}: equal hashes, entities, plants, pets, NPC friends and zip links on ${players.map((p) => p.key).join(', ')} ${JSON.stringify(r.hash)}`);
}

async function resyncs(pl) {
  return game(pl, () => window.__game.debug.net.stats().resyncs || 0);
}

/** AT14 / AT15: sends, sizes and refusals seen so far (page stats reset on a reload). */
async function budgetCheck(label, players) {
  const st = fc.stats();
  check(st.filter((s) => s.label !== 'lily').every((s) => s.emits === 0), `${label} AT14: the hub saw 0 emits from guest pages (${JSON.stringify(st)})`);
  for (const pl of players) {
    const s = await game(pl, () => window.__swFakeStats());
    check(s.maxPerSec <= 80 && s.reportErrors === 0 && s.dropped === 0, `${label} AT15 ${pl.key}: at most ${s.maxPerSec} sends in any second (limit 80), no reportError, nothing dropped (${s.emits} emits, ${s.presence} presence)`);
    check(s.maxEmit <= 3900 && s.maxPresence <= 3900, `${label} AT15 ${pl.key}: largest emit ${s.maxEmit} B, largest presence ${s.maxPresence} B (<= 3,900)`);
    check(Object.keys(s.rejects).length === 0, `${label} AT15 ${pl.key}: the platform refused nothing (${JSON.stringify(s.rejects)})`);
  }
  check(hub.violations.length === 0, `${label} AT15: no room rule broken (${JSON.stringify(hub.violations.slice(0, 3))})`);
}

/** AT16: a guest never stores the host's world. */
async function savesCheck(label, guests) {
  for (const pl of guests) {
    const ids = await game(pl, () => window.__saves);
    check(ids.every((id) => !String(id).startsWith('net-')), `${label} AT16 ${pl.key}: never stored the host's world (${ids.length} saves: ${JSON.stringify(ids.slice(0, 4))})`);
  }
}

/** No HUD button may be the top element under itself while a panel / card is open. */
async function nothingShowsThrough(pl, label) {
  const bad = await game(pl, () => {
    const out = [];
    for (const b of document.querySelectorAll('.sw-hud button, .lf-hud button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const top = document.elementFromPoint(cx, cy);
      if (top && b.contains(top)) out.push(b.getAttribute('aria-label') || b.className);
    }
    return out;
  });
  return check(bad.length === 0, `${label}: no HUD button shows through (${JSON.stringify(bad)})`);
}

/** In a session (Players, Say, the connection pill): no HUD controls overlap, all on screen. */
async function hudFits(pl, label) {
  const out = await game(pl, () => {
    const els = [...document.querySelectorAll('.sw-hud .sw-round-face, .sw-hud .sw-slot, .sw-hud .sw-pill, .lf-hud .sw-round-face')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
    const joy = document.querySelector('.sw-joy');
    if (joy && joy.offsetParent !== null && getComputedStyle(joy).display !== 'none') els.push(joy);
    const rects = els.map((e) => ({ e, r: e.getBoundingClientRect() }));
    const res = [];
    const name = (e) => e.closest('.sw-round')?.getAttribute('aria-label') || e.getAttribute('aria-label') || e.className;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) res.push(`${name(rects[i].e)} x ${name(rects[j].e)}`);
      }
    }
    for (const { e, r } of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) res.push(`${name(e)} off screen`);
    return res;
  });
  return check(out.length === 0, `${label}: HUD controls in a session do not overlap and stay on screen${out.length ? ' (' + out.join('; ') + ')' : ''}`);
}

/** The open panel card / cards fit the screen (nothing clipped). */
async function fits(pl, selector, label) {
  const r = await game(pl, (sel) => {
    const out = [];
    for (const e of document.querySelectorAll(sel)) {
      const b = e.getBoundingClientRect();
      if (!b.width) continue;
      out.push([Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]);
    }
    return { out, w: innerWidth, h: innerHeight };
  }, selector);
  const ok = r.out.length > 0 && r.out.every(([l, t, rr, bb]) => l >= -1 && t >= -1 && rr <= r.w + 1 && bb <= r.h + 1);
  return check(ok, `${label}: ${selector} fits ${r.w}x${r.h} ${JSON.stringify(r.out.slice(0, 3))}`);
}

// ---------------------------------------------------------------------------------------
// flows through the real UI (tools/net/mp-flows.mjs), with this probe's checks
// ---------------------------------------------------------------------------------------

const hostMakesCode = (host) => flows.hostMakesCode(host, { biome: BIOME, shot, log });

async function guestTypesCode(guest, code, { shots = false } = {}) {
  await flows.guestTypesCode(guest, code, {
    shot: shots ? shot : null,
    onKeypad: shots ? async (g) => {
      await settle(g.page, 600);
      await shot(g, `${g.key}-keypad-4`);
      await fits(g, '.sw-panel-wrap.sw-open .sw-card', `${g.key} keypad`);
      await fits(g, '.sw-panel-wrap.sw-open .sw-net-key', `${g.key} keypad keys`);
      const small = await game(g, () => Math.min(...[...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-net-key')].map((k) => k.getBoundingClientRect().width)));
      check(small >= (g.viewport.width < 400 ? 80 : 88) - 0.5, `${g.key}: keypad buttons are big (${small} px)`);
    } : null,
  });
}

async function hostLetsIn(host, name, { shots = false, account = null, visitor = false } = {}) {
  const small = await flows.hostLetsIn(host, name, { shot: shots ? shot : null });
  if (account) check(small.includes(account), `the knock card shows the account name in small print ("${small}")`);
  if (visitor) check(small.includes('visitor'), 'the knock card says "visitor"');
}

// ---------------------------------------------------------------------------------------
// the tests
// ---------------------------------------------------------------------------------------

const TESTS = [];
const test = (id, title, fn) => TESTS.push({ id, title, fn });

let lily, rosie, june;
let BROWSER = null;
let CODE = null;
const spot = {};

test('AT1', 'Lily makes a code, Rosie joins on the keypad (touch), Lily lets her in; they see each other', async () => {
  const t0 = Date.now();
  CODE = await hostMakesCode(lily);
  log(`  code: ${CODE.join(' ')}`);
  check(CODE.length === 4, 'the host reads 4 code pictures from the Players panel');
  await shot(lily, 'players-host-waiting');
  await fits(lily, '.sw-panel-wrap.sw-open .sw-card', 'host Players panel');
  await guestTypesCode(rosie, CODE, { shots: true });
  const knocking = await until(rosie, () => document.querySelector('.sw-net-joining[data-phase="knocking"]:not([hidden])') !== null, null, 20000);
  check(knocking, 'Rosie sees "Knock knock! Waiting for Lily to say yes…"');
  await settle(rosie.page, 600);
  await shot(rosie, 'rosie-knocking');
  await hostLetsIn(lily, 'Rosie', { shots: true, account: 'Rosie R.' });
  const tLetIn = Date.now();
  check(await waitLive(rosie), 'Rosie is in Lily’s world');
  log(`  Rosie in play ${((Date.now() - tLetIn) / 1000).toFixed(1)} s after "Let in!" (${((Date.now() - t0) / 1000).toFixed(1)} s after "Invite Friends"; SwiftShader meshing dominates)`);
  log(`  Rosie trace: ${await trace(rosie)}`);
  await closePanels(lily);
  check(await until(lily, () => window.__game.debug.net.remote().some((r) => r.name === 'Rosie' && r.visible), null, 20000), 'Lily sees Rosie’s avatar');
  check(await until(rosie, () => window.__game.debug.net.remote().some((r) => r.name === 'Lily' && r.visible && r.tag), null, 20000), 'Rosie sees Lily’s avatar with her name tag');
  check((await toasts(rosie)).some((t) => /You're in Lily's world/.test(t)), 'Rosie hears "You\'re in Lily\'s world!"');
  check(await until(lily, () => window.__toasts.some((t) => /Rosie is here/.test(t)), null, 15000), 'Lily hears "Rosie is here!"');
  const hud = await game(rosie, () => ({ players: !document.querySelector('.sw-playersbtn').hidden, count: document.querySelector('.sw-playersbtn .sw-count').textContent, say: !document.querySelector('.sw-saybtn').hidden }));
  check(hud.players && hud.count === '2' && hud.say, `Rosie's HUD shows Players (2) and Say (${JSON.stringify(hud)})`);
  await hudFits(rosie, 'iPad (Rosie)');
  // the same iPad in portrait (768x1024): the name and the counts are two rows
  await rosie.page.setViewportSize({ width: 768, height: 1024 });
  await settle(rosie.page, 900);
  await hudFits(rosie, 'iPad portrait (Rosie)');
  await shot(rosie, 'rosie-portrait-in-world');
  await rosie.page.setViewportSize(rosie.viewport);
  await settle(rosie.page, 600);
  await hudFits(lily, 'desktop (Lily)');
  await converge([lily, rosie], 'AT1');
  const p = await game(lily, () => { const q = window.__game.player.position; return { x: Math.floor(q.x), y: Math.floor(q.y), z: Math.floor(q.z) }; });
  Object.assign(spot, p);
  await bringTo(rosie, lily, 3, 3);
  await settle(rosie.page, 1500);
  await game(rosie, () => { const g = window.__game; g.cameraRig.yaw += Math.PI; g.cameraRig.pitch = 0.3; });
  await settle(rosie.page, 1000);
  await shot(rosie, 'rosie-in-world');
  await shot(lily, 'lily-sees-rosie');
});

test('AT2', 'Rosie paints a hold-drag stroke with real touch events, then Undo', async () => {
  const before = await game(lily, () => window.__game.world.blocks.slice().length);
  void before;
  const count = (pl) => game(pl, () => {
    const g = window.__game, w = g.world, id = g.registry.blocks.idOf('wool_yellow');
    const out = [];
    for (let i = 0; i < w.blocks.length; i++) if (w.blocks[i] === id) out.push(i);
    return out;
  });
  await game(rosie, () => {
    const g = window.__game;
    g.debug.select('block:wool_yellow');
    g.setTool('build');
    g.cameraRig.pitch = 0.75;
  });
  await settle(rosie.page, 800);
  const c0 = await count(rosie);
  const cdp = await rosie.context.newCDPSession(rosie.page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const vp = rosie.viewport;
  // hold still on the ground, then drag right and up (toward the horizon: more ground per pixel)
  const x0 = vp.width * 0.45, y0 = vp.height * 0.84;
  await touch('touchStart', [[x0, y0]]);
  await sleep(750);
  for (let i = 1; i <= 44; i++) {
    await touch('touchMove', [[x0 + i * 7, y0 - i * 10]]);
    await sleep(40);
  }
  await touch('touchEnd', []);
  const tEnd = Date.now();
  await settle(rosie.page, 300);
  const c1 = await count(rosie);
  const painted = c1.filter((i) => !c0.includes(i));
  check(painted.length >= 10, `Rosie's stroke painted ${painted.length} cells`);
  const seen = await until(lily, (cells) => { const w = window.__game.world, id = window.__game.registry.blocks.idOf('wool_yellow'); return cells.every((i) => w.blocks[i] === id); }, painted, 15000, 100);
  log(`  Lily saw the stroke ${((Date.now() - tEnd) / 1000).toFixed(2)} s after the finger lifted`);
  check(seen, `Lily sees all ${painted.length} painted cells`);
  await shot(rosie, 'rosie-stroke');
  await press(rosie, '.sw-undobtn');
  const gone = await until(lily, (cells) => { const w = window.__game.world, id = window.__game.registry.blocks.idOf('wool_yellow'); return cells.every((i) => w.blocks[i] !== id); }, painted, 15000, 100);
  check(gone, 'after Rosie’s Undo the stroke is gone on Lily’s page too');
  const c2 = await count(rosie);
  check(c2.length === c0.length, 'one Undo took back the whole stroke on Rosie’s page');
  await converge([lily, rosie], 'AT2');
});

test('AT3', 'Rosie places a bed and turns it before the host answered', async () => {
  const r = await game(rosie, ({ x, z }) => {
    const g = window.__game, E = g.entities;
    const h = g.world.heightAt(x + 5, z - 3);
    const bed = E.place('bed_single', x + 5, h + 1, z - 3, 0, null, {});
    if (bed) E.rotate(bed);
    return bed ? { uid: bed.uid, rot: bed.rot } : null;
  }, spot);
  check(r && r.uid >= 1000001 && r.uid < 2000000, `the bed's uid is in Rosie's seat range (${r && r.uid})`);
  await converge([lily, rosie], 'AT3');
  const onHost = await game(lily, (uid) => { const e = window.__game.entities.byUid(uid); return e ? e.rot : null; }, r.uid);
  check(onHost === r.rot, `the same turned bed on both pages (rot ${onHost})`);
  spot.bed = r.uid;
});

test('AT4', 'careful friends: Rosie opens Lily’s door (allowed) and tries to remove Lily’s wall (protected)', async () => {
  const setup = await game(lily, ({ x, z }) => {
    const g = window.__game, E = g.entities;
    const hx = x - 3, hz = z + 6;
    const h = g.world.heightAt(hx, hz);
    const door = E.place('door', hx, h + 1, hz, 0, null, {});
    const wall = [];
    for (let k = 1; k <= 3; k++) {
      g.placeBlock(hx + k, h + 1, hz, 'brick_red');
      wall.push([hx + k, h + 1, hz]);
    }
    return { door: door ? door.uid : 0, wall };
  }, spot);
  check(setup.door > 0, 'Lily built a door and a little brick wall');
  await converge([lily, rosie], 'AT4 setup');
  // Rosie walks up and taps the door with the Hand tool (a real tap on the door)
  const d = await game(rosie, (uid) => { const e = window.__game.entities.byUid(uid); window.__game.player.teleport(e.x + 0.5, e.y, e.z - 2.5); window.__game.setTool('hand'); const b = e.pickable.box; return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2]; }, setup.door);
  await tapWorld(rosie, d, 0.15);
  const open = await until(lily, (uid) => window.__game.entities.byUid(uid)?.data?.open === true, setup.door, 10000);
  check(open, 'Rosie opened Lily’s door (it is open on Lily’s page)');
  // Remove tool on a wall brick: protected
  await game(rosie, () => { window.__game.__t0 = window.__toasts.length; window.__game.setTool('remove'); });
  const brick = setup.wall[1];
  await tapWorld(rosie, [brick[0] + 0.5, brick[1] + 0.5, brick[2] + 0.5], 0.2);
  const tRm = Date.now();
  const back = await until(rosie, ([x, y, z]) => window.__game.debug.getBlock(x, y, z) === 'brick_red' && window.__game.debug.net.pend() === 0, brick, 10000, 100);
  log(`  the brick came back on Rosie's page ${((Date.now() - tRm) / 1000).toFixed(2)} s after her tap`);
  check(back, 'Lily’s brick came back on Rosie’s page');
  const ts = await game(rosie, () => window.__toasts.slice(window.__game.__t0));
  check(ts.filter((t) => /That's someone else's! Build your own next to it/.test(t)).length === 1, `one "That's someone else's! Build your own next to it." toast (${JSON.stringify(ts)})`);
  await settle(rosie.page, 200);
  await shot(rosie, 'rosie-protected');
  await game(rosie, () => window.__game.setTool('build'));
  await converge([lily, rosie], 'AT4');
  spot.door = setup.door;
});

test('AT5', 'Rosie builds a Flower Cottage, then Undo; Lily’s Undo history is untouched', async () => {
  const hist = await game(lily, () => window.__game.history.length);
  const n0 = await game(lily, () => window.__game.entities.all().length);
  const ok = await game(rosie, ({ x, z }) => !!window.__game.prefabs.place('cottage', x + 16, z + 4, { animate: true }), spot);
  check(ok, 'Rosie starts the Flower Cottage magic');
  const built = await until(lily, (n) => window.__game.entities.all().length > n + 5, n0, 60000);
  check(built, 'the cottage with its furniture appears on Lily’s page');
  await converge([lily, rosie], 'AT5 cottage');
  check(await game(lily, (h) => window.__game.history.length === h, hist), 'Lily’s Undo history is unchanged');
  check(await until(rosie, () => window.__toasts.some((t) => /Ta-da|ready/i.test(t)), null, 10000), 'Rosie hears "Ta-da! Your house is ready!"');
  await shot(rosie, 'rosie-cottage');
  await press(rosie, '.sw-undobtn');
  const gone = await until(lily, (n) => window.__game.entities.all().length <= n, n0, 60000);
  check(gone, 'Rosie’s Undo takes the cottage away on Lily’s page');
  await converge([lily, rosie], 'AT5 undo');
  check(await game(lily, (h) => window.__game.history.length === h, hist), 'Lily’s Undo history is still unchanged');
  // the host's own Sparkle Camper, furnished, arrives for her friend
  const u0 = await game(lily, () => window.__game.entities.all().length);
  await game(lily, ({ x, z }) => window.__game.prefabs.place('sparkle_camper', x - 26, z - 6, { animate: false }), spot);
  const u1 = await game(lily, () => window.__game.entities.all().length);
  check(u1 - u0 > 20, `Lily's Sparkle Camper is furnished (${u1 - u0} pieces)`);
  await converge([lily, rosie], 'AT5 camper');
});

test('AT6', 'garden: Rosie plants and waters carrots, Lily grows them, Rosie harvests into her basket', async () => {
  const bed = { x: spot.x + 7, z: spot.z - 9 };
  const planted = await game(rosie, ({ x, z }) => {
    const g = window.__game;
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const h = g.world.heightAt(x + k, z);
      if (g.debug.garden.plant('carrot', x + k, h, z)) n++;
    }
    g.setSlot(g.hotbar.index, 'tool:watering_can');
    g.debug.garden.water(x, g.world.heightAt(x, z), z);
    return n;
  }, bed);
  check(planted === 2, `Rosie planted 2 carrots (${planted})`);
  await converge([lily, rosie], 'AT6 planted');
  await game(lily, () => window.__game.debug.garden.grow(400));
  await converge([lily, rosie], 'AT6 grown');
  const ripe = await game(rosie, () => window.__game.garden.all().filter((p) => p.stage === 3 && p.crop === 'carrot').length);
  check(ripe === 2, `Rosie sees 2 ripe carrots (${ripe})`);
  const b0 = await game(rosie, () => window.__game.profile.basket.carrot | 0);
  const hb = await game(lily, () => window.__game.profile.basket.carrot | 0);
  await game(rosie, ({ x, z }) => {
    const g = window.__game;
    for (const p of g.garden.all()) if (p.stage === 3 && p.z === z && p.x >= x && p.x < x + 2) g.debug.garden.harvest(p.x, p.y, p.z);
  }, bed);
  await converge([lily, rosie], 'AT6 harvested');
  const b1 = await game(rosie, () => window.__game.profile.basket.carrot | 0);
  check(b1 >= b0 + 2, `Rosie's basket got her carrots (${b0} -> ${b1})`);
  check(await game(lily, () => window.__game.profile.basket.carrot | 0) === hb, 'Lily’s basket is unchanged');
});

test('AT17', 'Say bubbles and emotes show on the other page within a second', async () => {
  await bringTo(rosie, lily, 2.5, 3);
  await settle(rosie.page, 600);
  await press(rosie, '.sw-saybtn');
  await rosie.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-phrase');
  await settle(rosie.page, 900);
  await shot(rosie, 'rosie-say-panel');
  await fits(rosie, '.sw-panel-wrap.sw-open .sw-card', 'Say panel (iPad)');
  await nothingShowsThrough(rosie, 'Say panel (iPad)');
  await press(rosie, '.sw-panel-wrap.sw-open .sw-net-phrase[data-id="0"]');
  const t0 = Date.now(); // from the tap (Playwright's own wait for a still button is not counted)
  const seen = await until(lily, () => window.__game.debug.net.remote().some((r) => r.name === 'Rosie' && r.bubble === 'Hi!'), null, 5000, 50);
  const dt = (Date.now() - t0) / 1000;
  check(seen && dt < 1.5, `Lily sees Rosie's "Hi!" bubble after ${dt.toFixed(2)} s`);
  // Lily looks at Rosie for the picture
  const r = await game(lily, () => window.__game.debug.net.remote().find((x) => x.name === 'Rosie').pos);
  await game(lily, ([x, y, z]) => { const g = window.__game, p = g.player.position; g.cameraRig.yaw = Math.atan2(x - p.x, z - p.z) + 0.35; g.cameraRig.pitch = 0.2; }, r);
  await settle(lily.page, 700);
  await shot(lily, 'lily-sees-bubble');
  // Lily's emote wheel (G, then Dance): Rosie sees her dance
  await lily.page.keyboard.press('g');
  await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-emo-btn[data-emote="dance"]');
  await press(lily, '.sw-panel-wrap.sw-open .sw-emo-btn[data-emote="dance"]');
  const t1 = Date.now();
  const danced = await until(rosie, () => window.__game.debug.net.remote().some((x) => x.name === 'Lily' && x.emote === 'dance'), null, 5000, 50);
  const dt1 = (Date.now() - t1) / 1000;
  check(danced && dt1 < 1.5, `Rosie sees Lily dance after ${dt1.toFixed(2)} s`);
  await closePanels(lily);
  // the keyboard shortcut T opens Say on the desktop
  await lily.page.keyboard.press('t');
  check(await until(lily, () => window.__game.ui.current === 'mp-say', null, 3000), 'T opens the Say panel');
  await settle(lily.page, 700);
  await shot(lily, 'lily-say-panel');
  await lily.page.keyboard.press('Escape');
});

test('HELD', 'a treat in Rosie’s hand shows in her avatar’s hand on Lily’s page, and Lily’s in hers on Rosie’s', async () => {
  // the real shops: Rosie gets a Unicorn Dream sundae (its key has '-' between the flavors)
  // and holds it; Lily (the host) holds a lollipop
  const give = (pl, spec) => game(pl, (sp) => {
    const g = window.__game, sh = g.debug.shops;
    const key = typeof sp === 'string' ? sp : sh.key(sp);
    window.__hotbarBefore = { slots: g.hotbar.slots.slice(), colors: g.hotbar.colors.slice(), index: g.hotbar.index };
    g.profile.basket = g.profile.basket || {};
    g.profile.basket[key] = (g.profile.basket[key] | 0) + 1;
    g.events.emit('basket:change', { basket: g.profile.basket, key, delta: 1 });
    return g.treats.hold(key, { quiet: true }) && g.treats.held === key ? key : null;
  }, spec);
  const rosieKey = await give(rosie, { style: 'sundae', flavors: ['uni', 'cotton', 'gum'], tops: 'scw' });
  check(rosieKey === 'treat_ic_sundae_uni-cotton-gum_scw', `Rosie holds her Unicorn Dream (${rosieKey})`);
  const seen = await until(lily, (k) => {
    const r = window.__game.debug.net.remote().find((x) => x.name === 'Rosie');
    return r && r.held === k && r.inHand === 'treat:' + k ? r : null;
  }, rosieKey, 8000);
  check(!!seen, `Lily sees the Unicorn Dream in Rosie's hand (${seen ? seen.held + ' / ' + seen.inHand : JSON.stringify(await game(lily, () => window.__game.debug.net.remote().map((x) => [x.name, x.held, x.inHand])))})`);
  const lilyKey = await give(lily, 'treat_lollipop');
  check(lilyKey === 'treat_lollipop', `Lily holds a lollipop (${lilyKey})`);
  const seenL = await until(rosie, () => {
    const r = window.__game.debug.net.remote().find((x) => x.name === 'Lily');
    return r && r.held === 'treat_lollipop' && r.inHand === 'treat:treat_lollipop' ? r : null;
  }, null, 8000);
  check(!!seenL, `Rosie sees the lollipop in Lily's hand (${seenL ? seenL.inHand : JSON.stringify(await game(rosie, () => window.__game.debug.net.remote().map((x) => [x.name, x.held, x.inHand])))})`);
  // each camera turns to the friend, close, so the treat in her hand is in the picture
  const face = (pl, name) => game(pl, (nm) => {
    const g = window.__game, r = g.debug.net.remote().find((x) => x.name === nm);
    if (!r) return false;
    const p = g.player.position;
    g.cameraRig.yaw = Math.atan2(r.pos[0] - p.x, r.pos[2] - p.z) + 0.35;
    g.cameraRig.pitch = 0.15;
    return true;
  }, name);
  await face(lily, 'Rosie');
  await face(rosie, 'Lily');
  await settle(lily.page, 900);
  await shot(lily, 'lily-sees-held-treat');
  await shot(rosie, 'rosie-sees-held-treat');
  // Eat and Put away join the life column while she holds a treat
  await hudFits(rosie, 'iPad holding a treat (Rosie)');
  await hudFits(lily, 'desktop holding a treat (Lily)');
  // putting them away empties both hands on the other page too
  const putAway = (pl) => game(pl, () => {
    const g = window.__game, b = window.__hotbarBefore;
    const ok = g.treats.putAway();
    // her hotbar as it was before the test (the treat took the selected slot)
    if (b) {
      b.slots.forEach((k, i) => { if (g.hotbar.slots[i] !== k) g.setSlot(i, k, b.colors[i]); });
      g.setSlot(b.index, b.slots[b.index], b.colors[b.index]);
    }
    return ok && g.treats.held === null;
  });
  check(await putAway(rosie), 'Rosie puts her sundae away');
  check(await putAway(lily), 'Lily puts her lollipop away');
  const gone = await until(lily, () => { const r = window.__game.debug.net.remote().find((x) => x.name === 'Rosie'); return r && !r.held && !r.inHand; }, null, 8000);
  check(gone, 'Rosie put her sundae away: her hand is empty on Lily’s page');
  const goneL = await until(rosie, () => { const r = window.__game.debug.net.remote().find((x) => x.name === 'Lily'); return r && !r.held && !r.inHand; }, null, 8000);
  check(goneL, 'Lily put her lollipop away: her hand is empty on Rosie’s page');
});

test('LOOKS', 'boy looks travel: Rosie wears Space Explorer (number 23, bold brows); Lily invites Leo and Rosie sees him', async () => {
  // Rosie changes her look the way the Studio does (profile + avatar:changed)
  const mine = await game(rosie, () => {
    const g = window.__game;
    const o = g.debug.avatar.starters().find((s) => s.key === 'space').look;
    g.profile.look = { ...o, top: { ...o.top, num: 23 }, face: { ...o.face, brows: 'bold' } };
    g.saveProfile();
    g.events.emit('avatar:changed', { look: g.profile.look });
    return g.debug.avatar.look();
  });
  const want = codec.packLook(mine);
  const t0 = Date.now();
  const lk = await until(lily, (w) => {
    const r = window.__game.debug.net.remote().find((x) => x.name === 'Rosie');
    return r && r.lk === w ? r.lk : null;
  }, want, 8000);
  const dt = (Date.now() - t0) / 1000;
  check(lk === want && dt < 5, `Lily gets Rosie's new look token within 5 s (${dt.toFixed(1)} s)`);
  const theirs = codec.unpackLook(lk || '', 'Rosie');
  check(theirs.hair.style === 'fauxhawk' && theirs.top.num === 23 && theirs.face.brows === 'bold', `Rosie's avatar on Lily's page: faux hawk, number 23, bold brows (${theirs.hair.style}, ${theirs.top.num}, ${theirs.face.brows})`);
  // Lily's NPC friend Leo shows on Rosie's page with the same look; styling him is Lily's
  const here = await game(lily, () => { const p = window.__game.player.position; return { x: p.x, y: p.y, z: p.z }; });
  const leo = await game(lily, ({ x, y, z }) => window.__game.debug.friends.invite('leo', x - 3, y + 0.5, z + 3), here);
  check(!!leo, 'Lily invited Leo');
  await converge([lily, rosie], 'LOOKS Leo');
  const lilyLeo = await game(lily, (id) => JSON.stringify(window.__game.friends.byId(id).look), leo);
  const rosieLeo = await until(rosie, (id) => { const f = window.__game.friends.byId(id); return f ? JSON.stringify(f.look) : null; }, leo, 15000);
  check(rosieLeo === lilyLeo, 'Rosie sees Leo with the same look as on Lily’s page');
  const t = await game(rosie, (id) => {
    const g = window.__game;
    const n = window.__toasts.length;
    g.debug.friends.style(id, 'surprise');
    return window.__toasts.slice(n);
  }, leo);
  check(t.some((x) => x === "That's Lily's friend! Ask Lily to help."), `dressing up Leo on Rosie's page is refused kindly (${JSON.stringify(t)})`);
  await converge([lily, rosie], 'LOOKS end');
});

test('AT18', 'time and weather: Lily sets rain and night; Rosie sleeps in her bed; morning for both', async () => {
  await game(lily, () => {
    const g = window.__game;
    g.weather.set('rain', { manual: true });
    g.setDayTime(0.9);
  });
  const follows = await until(rosie, () => window.__game.weather.current === 'rain' && (window.__game.time.dayTime > 0.8 || window.__game.time.dayTime < 0.2), null, 15000);
  check(follows, 'Rosie follows Lily’s rain and night');
  // Settings on a guest: no weather wand, no clock
  await rosie.page.evaluate(() => window.__game.ui.open('settings'));
  await settle(rosie.page, 900);
  const rows = await game(rosie, () => document.querySelector('.sw-panel-wrap.sw-open').textContent);
  check(!/Weather wand/.test(rows) && !/Time of day/.test(rows), 'Rosie’s Settings have no weather wand and no time of day');
  await shot(rosie, 'rosie-settings');
  await closePanels(rosie);
  const day0 = await game(lily, () => window.__game.time.day);
  // Rosie lies down in her bed (Hand tool)
  await game(rosie, (uid) => { const g = window.__game; g.setTool('hand'); return g.debug.interact(uid); }, spot.bed);
  const morning = await until(lily, (d) => window.__game.time.day > d && window.__game.time.dayTime > 0.2 && window.__game.time.dayTime < 0.4, day0, 30000);
  check(morning, 'after Rosie slept it is morning on Lily’s page');
  const hostClock = await game(lily, () => window.__game.time.day + window.__game.time.dayTime);
  const guestClock = await until(rosie, (h) => { const t = window.__game.time.day + window.__game.time.dayTime; return Math.abs(t - h) < 0.03 ? t : null; }, hostClock, 10000);
  check(!!guestClock, `both clocks show the same morning (${hostClock.toFixed(3)}, ${guestClock ? guestClock.toFixed(3) : await game(rosie, () => (window.__game.time.day + window.__game.time.dayTime).toFixed(3))})`);
  check(await until(lily, () => window.__toasts.some((t) => /Rosie went to sleep/.test(t)), null, 5000), 'Lily hears "Rosie went to sleep. Good morning, everyone!"');
  await game(rosie, () => { const g = window.__game; if (g.player.state === 'sleep') g.player.stand(); g.setTool('build'); });
  await game(lily, () => window.__game.weather.set('sunny', { manual: true }));
  await converge([lily, rosie], 'AT18');
});

test('AT19', 'pets: Lily’s pets move on Rosie’s page; Rosie may pet but not adopt or ride', async () => {
  const ids = await game(lily, ({ x, y, z }) => {
    const g = window.__game;
    return [g.debug.pets.adopt('puppy', null, 'Biscuit', x + 1.5, y + 0.5, z - 1.5), g.debug.pets.adopt('horse', null, 'Star', x - 2.5, y + 0.5, z - 2.5)];
  }, spot);
  check(ids.every(Boolean), 'Lily adopted a puppy and a horse');
  await converge([lily, rosie], 'AT19 adopt');
  const x1 = await game(lily, (id) => { const g = window.__game, p = g.pets.byId(id); p.teleport(p.pos.x + 3, p.pos.y, p.pos.z, false); g.pets.setMode(p, 'stay', { quiet: true }); return p.pos.x; }, ids[0]);
  check(await until(rosie, ([id, x]) => { const p = window.__game.pets.byId(id); return p && Math.abs(p.pos.x - x) < 0.6; }, [ids[0], x1], 15000), 'the puppy moves on Rosie’s page (a puppet of Lily’s)');
  const r = await game(rosie, ([pup, horse]) => {
    const g = window.__game;
    const t0 = window.__toasts.length;
    const petted = g.pets.petPet(g.pets.byId(pup));
    const rode = g.pets.mount(g.pets.byId(horse));
    return { petted, rode, riding: g.player.state === 'ride', toasts: window.__toasts.slice(t0) };
  }, ids);
  check(r.petted === true, 'Rosie can pet Lily’s puppy (local hearts)');
  check(r.rode === false && !r.riding && r.toasts.some((t) => /That's Lily's pet! Ask Lily to help/.test(t)), `riding Lily's horse is refused kindly (${JSON.stringify(r.toasts)})`);
  // NPC friends are Lily's too: Rosie sees them
  const npc = await game(lily, ({ x, y, z }) => window.__game.debug.friends.invite('nia', x + 3.5, y + 0.5, z - 3.5), spot);
  check(!!npc, 'Lily invited Nia (an NPC friend)');
  await converge([lily, rosie], 'AT19 NPC friend');
  const seen = await until(rosie, (id) => { const f = window.__game.friends.byId(id); return f && f.group.visible; }, npc, 15000);
  check(seen, 'Rosie sees Nia (the NPC friend) in Lily’s world');
  spot.pets = ids;
});

test('ZIP', 'Lily rides a zip line; Rosie sees her hanging and moving', async () => {
  const towers = await game(lily, ({ x, z }) => {
    const g = window.__game, E = g.entities, def = E.defs.get('zipline_tower');
    const out = [];
    for (const [dx, dz] of [[-8, 14], [-26, 14], [-8, 18], [-28, 18]]) {
      if (out.length === 2) break;
      const h = g.world.heightAt(x + dx, z + dz);
      if (out.length === 1 && Math.abs(out[0].x - (x + dx)) < 6) continue;
      if (!E.canPlace(def, x + dx, h + 1, z + dz, 0)) continue;
      const e = E.place('zipline_tower', x + dx, h + 1, z + dz, 0, null, {});
      if (e) out.push({ uid: e.uid, x: e.x, y: e.y, z: e.z });
    }
    return out;
  }, spot);
  check(towers.length === 2, 'Lily built two zip towers');
  await converge([lily, rosie], 'ZIP towers');
  await game(rosie, (t) => { const g = window.__game; g.player.teleport(t.x - 8, t.y, t.z - 6); }, towers[0]);
  await game(lily, (t) => { const g = window.__game; g.player.teleport(t.x + 1, t.y + 3.2, t.z + 1); }, towers[0]);
  await settle(lily.page, 400);
  const started = await game(lily, (uid) => window.__game.debug.outdoor.zip(uid), towers[0].uid);
  check(!!started, 'Lily starts a zip ride');
  const hang = await until(rosie, () => {
    const r = window.__game.debug.net.remote().find((x) => x.name === 'Lily');
    return r && r.st === 'l' ? r.pos : null;
  }, null, 20000, 100);
  check(!!hang, 'Rosie sees Lily holding the zip line (st l)');
  if (hang) {
    await game(rosie, ([x, y, z]) => { const g = window.__game, p = g.player.position; g.cameraRig.yaw = Math.atan2(x - p.x, z - p.z); g.cameraRig.pitch = -0.05; }, hang);
    await settle(rosie.page, 500);
    await shot(rosie, 'rosie-sees-zip');
    const moved = await until(rosie, (p0) => {
      const r = window.__game.debug.net.remote().find((x) => x.name === 'Lily');
      return r && Math.hypot(r.pos[0] - p0[0], r.pos[2] - p0[2]) > 2;
    }, hang, 90000, 200); // the ride runs on game time: slow frames in SwiftShader make it long
    check(moved, 'Lily moves along the cable on Rosie’s page');
  }
  await until(lily, () => !window.__game.debug.outdoor.ride(), null, 120000);
  await game(lily, (p) => { window.__game.player.teleport(p.x + 0.5, p.y + 1, p.z + 0.5); window.__game.unstickPlayer(); }, spot);
  await bringTo(rosie, lily, 2.5, 3);
  await converge([lily, rosie], 'ZIP');
});

test('AT7', 'Undo building: Lily takes back Rosie’s building; her own later work stays; her Undo brings it back', async () => {
  const mine = await game(rosie, ({ x, z }) => {
    const g = window.__game, E = g.entities;
    const cells = [];
    for (let k = 0; k < 4; k++) {
      const h = g.world.heightAt(x + 2 + k, z - 6);
      g.placeBlock(x + 2 + k, h + 1, z - 6, 'planks_pink');
      cells.push([x + 2 + k, h + 1, z - 6]);
    }
    const h = g.world.heightAt(x + 3, z - 8);
    const chair = E.place('chair', x + 3, h + 1, z - 8, 0, null, {});
    return { cells, chair: chair ? chair.uid : 0 };
  }, spot);
  await converge([lily, rosie], 'AT7 Rosie built');
  // Lily builds on top of Rosie's planks afterwards (kept by Undo building)
  const hostCell = await game(lily, (c) => { const g = window.__game; g.placeBlock(c[0], c[1] + 1, c[2], 'glass'); return [c[0], c[1] + 1, c[2]]; }, mine.cells[0]);
  await converge([lily, rosie], 'AT7 Lily built');
  await press(lily, '.sw-playersbtn');
  await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-row[data-seat="1"] .sw-net-undo');
  await settle(lily.page, 800);
  await shot(lily, 'players-host-with-rosie');
  await nothingShowsThrough(lily, 'Players panel (desktop)');
  await press(lily, '.sw-panel-wrap.sw-open .sw-net-row[data-seat="1"] .sw-net-undo');
  await lily.page.waitForSelector('.sw-dialog');
  await settle(lily.page, 500);
  await shot(lily, 'undo-building-confirm');
  await press(lily, '.sw-dialog button:has-text("Yes, undo")');
  const gone = await until(rosie, ({ cells, chair }) => {
    const g = window.__game;
    return cells.every(([x, y, z]) => g.debug.getBlock(x, y, z) !== 'planks_pink') && !g.entities.byUid(chair);
  }, mine, 20000);
  check(gone, 'Rosie’s planks and chair are gone (on her own page too)');
  check(await game(rosie, ([x, y, z]) => window.__game.debug.getBlock(x, y, z) === 'glass', hostCell), 'Lily’s glass block built after them is still there');
  await converge([lily, rosie], 'AT7 undone');
  await closePanels(lily);
  await press(lily, '.sw-undobtn');
  const back = await until(rosie, ({ cells, chair }) => {
    const g = window.__game;
    return cells.every(([x, y, z]) => g.debug.getBlock(x, y, z) === 'planks_pink') && !!g.entities.byUid(chair);
  }, mine, 20000);
  check(back, 'Lily’s own Undo brings Rosie’s building back');
  await converge([lily, rosie], 'AT7 back');
});

test('AT11', 'June joins from a phone after 300 edits (a visitor: the knock card says so)', async () => {
  await game(lily, ({ x, z }) => {
    const g = window.__game;
    const keys = ['planks_pink', 'wool_sky', 'glass', 'brick_red', 'wool_yellow'];
    let n = 0;
    for (let a = 0; a < 20 && n < 300; a++) {
      for (let b = 0; b < 15 && n < 300; b++) {
        const X = x - 30 + a, Z = z + 20 + b;
        const h = g.world.heightAt(X, Z);
        if (g.placeBlock(X, h + 1, Z, keys[(a + b) % keys.length], { fx: false })) n++;
      }
    }
    return n;
  }, spot);
  await converge([lily, rosie], 'AT11 300 edits');
  june = await openPlayer(BROWSER, PLAYERS[2]);
  await settle(june.page, 800);
  await shot(june, 'title-phone');
  const t0 = Date.now();
  await guestTypesCode(june, CODE, { shots: true });
  await until(june, () => document.querySelector('.sw-net-joining[data-phase="knocking"]:not([hidden])') !== null, null, 20000);
  await settle(june.page, 600);
  await shot(june, 'june-knocking');
  await hostLetsIn(lily, 'June', { shots: true, account: 'june.visitor@example.com', visitor: true });
  check(await waitLive(june), 'June is in Lily’s world');
  const tr = await trace(june);
  log(`  June trace: ${tr}`);
  const m = /(\d+\.\d)s g\.loading.*?(\d+\.\d)s snapshot (\d+) chunks/.exec(tr);
  if (m) check(Number(m[2]) - Number(m[1]) < 5, `the snapshot arrived in ${(Number(m[2]) - Number(m[1])).toFixed(1)} s (${m[3]} chunks)`);
  log(`  June in play ${((Date.now() - t0) / 1000).toFixed(1)} s after tapping Go (world meshing in SwiftShader included)`);
  await bringTo(june, lily, -2.5, 2.5);
  await converge([lily, rosie, june], 'AT11');
  await settle(june.page, 1500);
  await shot(june, 'june-in-world');
  await hudFits(june, 'phone (June)');
  // her phone held sideways (844x390): one top row, the life column above the joystick, the
  // tools at the right edge with Jump under them, the hotbar between the joystick and Jump
  await june.page.setViewportSize({ width: 844, height: 390 });
  await settle(june.page, 1200);
  await hudFits(june, 'phone sideways (June)');
  await shot(june, 'june-sideways');
  await june.page.setViewportSize(june.viewport);
  await settle(june.page, 900);
  await press(june, '.sw-playersbtn');
  await june.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-row[data-seat="2"]');
  await settle(june.page, 1200);
  await shot(june, 'june-players');
  await fits(june, '.sw-panel-wrap.sw-open .sw-card', 'Players panel (phone)');
  await nothingShowsThrough(june, 'Players panel (phone)');
  await closePanels(june);
  await press(june, '.sw-saybtn');
  await june.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-phrase');
  await settle(june.page, 900);
  await shot(june, 'june-say-panel');
  await fits(june, '.sw-panel-wrap.sw-open .sw-card', 'Say panel (phone)');
  await press(june, '.sw-panel-wrap.sw-open .sw-net-phrase[data-id="10"]');
  check(await until(rosie, () => window.__game.debug.net.remote().some((r) => r.name === 'June' && r.bubble === 'Race you!'), null, 5000, 100), 'Rosie sees June say "Race you!"');
  check((await resyncs(rosie)) === 0 && (await resyncs(june)) === 0, 'no resyncs so far (fault-free play)');
  await savesCheck('after AT11', [rosie, june]);
  await budgetCheck('after AT11', [lily, rosie, june]);
});

test('AT9', 'chaos: 30% drops, 0-800 ms delays, reordering, 5% duplicates; 60 s of edits by all three', async () => {
  hub.dropRate = 0.3;
  hub.dupRate = 0.05;
  hub.delayMs = [0, 800];
  const r0 = await Promise.all([rosie, june].map(resyncs));
  const work = async (pl, seed) => {
    await game(pl, ({ seed, x, z }) => {
      const g = window.__game, E = g.entities;
      let s = seed >>> 0;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const keys = ['planks_pink', 'wool_sky', 'glass', 'wool_yellow', 'brick_pink'];
      const furn = ['chair', 'table_round', 'floor_lamp', 'bed_single'];
      const mine = [];
      window.__chaos = setInterval(() => {
        const X = x - 12 + Math.floor(rnd() * 24), Z = z - 12 + Math.floor(rnd() * 24);
        const h = g.world.heightAt(X, Z);
        const r = rnd();
        if (r < 0.45) g.placeBlock(X, h + 1, Z, keys[Math.floor(rnd() * keys.length)], { fx: false });
        else if (r < 0.6) g.removeBlock(X, h, Z, { fx: false });
        else if (r < 0.7) g.historyGroup(() => { for (let k = 0; k < 6; k++) g.placeBlock(X + k, g.world.heightAt(X + k, Z) + 1, Z, 'wool_sky', { fx: false }); });
        else if (r < 0.8) { const e = E.place(furn[Math.floor(rnd() * furn.length)], X, h + 1, Z, Math.floor(rnd() * 4), null, {}); if (e) mine.push(e.uid); }
        else if (r < 0.87 && mine.length) { const e = E.byUid(mine[Math.floor(rnd() * mine.length)]); if (e) E.rotate(e); }
        else if (r < 0.93 && mine.length) { const e = E.byUid(mine.splice(Math.floor(rnd() * mine.length), 1)[0]); if (e) E.remove(e); }
        else g.undo();
      }, 350);
    }, { seed, x: spot.x, z: spot.z });
  };
  await work(lily, 1);
  await work(rosie, 2);
  await work(june, 3);
  await sleep(60000);
  for (const pl of [lily, rosie, june]) await game(pl, () => clearInterval(window.__chaos));
  hub.dropRate = 0;
  hub.dupRate = 0;
  hub.delayMs = [0, 0];
  log('  quiet now');
  await converge([lily, rosie, june], 'AT9', 60000);
  const r1 = await Promise.all([rosie, june].map(resyncs));
  check(r1[0] === r0[0] && r1[1] === r0[1], `no resyncs under chaos (${JSON.stringify(r0)} -> ${JSON.stringify(r1)})`);
  const hs = await game(lily, () => window.__game.debug.net.stats().host.stats);
  log(`  host: ${hs.batches} batches, ${hs.executed} executed, ${hs.rejected} rejected ${JSON.stringify(hs.rejectCodes)}, ${hs.fixes} fixes, ${hs.snapshots} snapshots, dupExec ${hs.dupExec}`);
  check(hs.dupExec === 0, 'every guest entry ran exactly once');
});

test('AT10', 'Rosie loses the connection for 5 s during a castle build: "Reconnecting…", then everything catches up', async () => {
  const n0 = await game(lily, () => window.__game.entities.all().length);
  fc.partition(rosie.page, 5000);
  fc.partition(june.page, 5000);
  await game(lily, ({ x, z }) => window.__game.prefabs.place('princess_castle', x + 30, z - 30, { animate: false }), spot);
  // June's pill is watched at the same time (her 5 s are not over while Rosie's shots are taken)
  const phoneP = until(june, () => !document.querySelector('.sw-net-pill').hidden, null, 8000, 100);
  const shown = await until(rosie, () => !document.querySelector('.sw-net-pill').hidden && /Reconnecting/.test(document.querySelector('.sw-net-pill').textContent), null, 8000, 100);
  check(shown, 'Rosie’s HUD shows "Reconnecting…"');
  if (shown) await shot(rosie, 'rosie-reconnecting');
  if (shown) await hudFits(rosie, 'iPad with "Reconnecting…"');
  const shownPhone = await phoneP;
  check(shownPhone, 'June\u2019s phone shows "Reconnecting…" too');
  if (shownPhone && (await game(june, () => !document.querySelector('.sw-net-pill').hidden))) {
    await shot(june, 'june-reconnecting');
    await hudFits(june, 'phone with "Reconnecting…"');
  }
  const hidden = await until(rosie, () => document.querySelector('.sw-net-pill').hidden, null, 20000, 200);
  check(hidden, '"Reconnecting…" goes away when she is back');
  check(await game(lily, (n) => window.__game.entities.all().length > n, n0), 'the castle was built');
  await converge([lily, rosie, june], 'AT10');
  await budgetCheck('after AT10', [lily, rosie, june]);
  await savesCheck('after AT10', [rosie, june]);
});

test('AT20', 'safety net: a cell changed behind the game’s back on Rosie’s page is fixed by a resync', async () => {
  const r0 = await resyncs(rosie);
  await game(rosie, ({ x, y, z }) => {
    const g = window.__game, w = g.world;
    const i = (y * w.sz + z) * w.sx + x;
    return g.debug.net.corruptCell(i, g.registry.blocks.idOf('gold_block') || g.registry.blocks.idOf('glass'));
  }, { x: spot.x + 11, y: spot.y + 6, z: spot.z + 11 });
  // the host keeps building a little (the check runs on new hashes, every 10 s)
  const t0 = Date.now();
  let fixed = false;
  while (Date.now() - t0 < 40000) {
    await game(lily, ({ x, z, k }) => { const g = window.__game; const h = g.world.heightAt(x - 5 + (k % 9), z - 14); g.placeBlock(x - 5 + (k % 9), h + 1, z - 14, 'wool_sky'); }, { x: spot.x, z: spot.z, k: Math.floor((Date.now() - t0) / 3000) });
    if ((await resyncs(rosie)) > r0) {
      fixed = true;
      break;
    }
    await sleep(3000);
  }
  check(fixed, `Rosie resynced ${((Date.now() - t0) / 1000).toFixed(1)} s after the corruption`);
  check(await waitLive(rosie), 'Rosie is back in play after the resync');
  await converge([lily, rosie, june], 'AT20');
});

test('REJOIN', 'June reloads her page and taps "Join Lily" on the title: straight back in (no knock card)', async () => {
  await reloadPlayer(june);
  const chip = june.page.locator('.sw-title-chips .sw-net-chip--guest');
  await chip.waitFor({ state: 'visible', timeout: 15000 });
  const label = await chip.textContent();
  check(/Join Lily/.test(label), `the title shows "Join Lily" (${label.trim()})`);
  await settle(june.page, 800);
  await shot(june, 'june-title-chip');
  const k0 = await game(lily, () => window.__knockEvents);
  await press(june, chip);
  check(await waitLive(june), 'June is back in Lily’s world');
  check((await game(lily, () => window.__knockEvents)) === k0, 'no knock card was needed (a friend let in before)');
  await bringTo(june, lily, -2.5, 2.5);
  await converge([lily, rosie, june], 'REJOIN');
});

/**
 * A guest after her host went away and came back: either she followed by herself (the host
 * was back within the 60 s grace) or, if the host took longer, she got the kind "went home"
 * card and taps "Join Lily" on the title. Returns which way she came back.
 */
async function guestReturns(pl, epoch0, timeout = 200000) {
  const end = Date.now() + timeout;
  for (;;) {
    const s = await game(pl, (e) => {
      const g = window.__game, gc = g.net.session.guestCore;
      if (g.mode === 'play' && !g.loading && g.net.state === 'g.live' && gc && gc.epoch !== e) return 'followed';
      if (g.mode === 'title' && g.net.state === 'idle' && document.querySelector('.sw-net-msg')) return 'card';
      if (g.mode === 'title' && g.net.state === 'idle' && document.querySelector('.sw-title-chips .sw-net-chip--guest') && !g.ui.current?.startsWith?.('mp-')) return 'chip';
      return null;
    }, epoch0);
    if (s === 'followed') return s;
    if (s === 'card' || s === 'chip') {
      if (s === 'card') {
        const text = await pl.page.locator('.sw-net-msg .sw-net-msg-text').textContent();
        log(`  ${pl.key} waited longer than the host's 60 s grace (SwiftShader); she sees "${text}" and taps "Join Lily"`);
        await press(pl, '.sw-net-msg .sw-net-msg-btn');
      }
      await press(pl, '.sw-title-chips .sw-net-chip--guest');
      return (await waitLive(pl)) ? 'chip' : null;
    }
    if (Date.now() > end) return null;
    await sleep(500);
  }
}

test('AT12', 'Lily\u2019s page reloads; "Keep playing" opens the door again; everyone catches up', async () => {
  // an edit Lily's local save has kept
  const cell = await game(lily, ({ x, z }) => { const g = window.__game; const h = g.world.heightAt(x + 4, z + 9); g.placeBlock(x + 4, h + 1, z + 9, 'brick_pink'); return [x + 4, h + 1, z + 9]; }, spot);
  await converge([lily, rosie, june], 'AT12 before');
  await game(lily, () => window.__game.saveWorld({ thumbnail: false }));
  const ep0 = await game(rosie, () => window.__game.net.session.guestCore.epoch);
  const backupAt = async () => game(lily, async () => (await window.__game.store.listBackups()).map((b) => b.backupAt).join(','));
  const bk0 = await backupAt();
  // SwiftShader draws every page on the CPU: while Lily's page reloads, her friends' pages are
  // slowed down so her reload takes about as long as on a real tablet (her friends only wait
  // for 60 s before they are told she went home; that path is covered too, see guestReturns)
  const throttles = [];
  for (const pl of [rosie, june]) {
    const cdp = await pl.context.newCDPSession(pl.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    throttles.push(cdp);
  }
  const t0 = Date.now();
  try {
    await reloadPlayer(lily);
    const chip = lily.page.locator('.sw-title-chips .sw-net-chip--host');
    await chip.waitFor({ state: 'visible', timeout: 30000 });
    check(/Keep playing/.test(await chip.textContent()), 'Lily\u2019s title shows "Keep playing"');
    // her friends wait HOST_AWAY_GRACE for her with the "little break" pill; a reload slower than
    // that (SwiftShader, every page drawn by one CPU) rightly tells them she went home instead,
    // and guestReturns() below brings them back through that card
    const back = Date.now() - t0;
    const rosieSees = await until(rosie, () => {
      const a = document.querySelector('.sw-net-away');
      if (a && !a.hidden) return 'break';
      return document.querySelector('.sw-net-msg[data-code="host_gone"]') ? 'went home' : null;
    }, null, 15000);
    if (back < NETC.HOST_AWAY_GRACE - 5000) check(rosieSees === 'break', `Rosie sees "Lily is taking a little break\u2026" (${rosieSees || 'nothing'})`);
    else check(!!rosieSees, `Rosie sees "Lily is taking a little break\u2026" or, as Lily took ${(back / 1000).toFixed(0)} s (over the ${NETC.HOST_AWAY_GRACE / 1000} s grace), that she went home (${rosieSees || 'nothing'})`);
    // her title's first 3D frame (shader compile) can hold her page for a while: let it finish
    await flows.drawn(lily);
    await press(lily, chip, { timeout: 60000 });
    check(await until(lily, () => window.__game.net.state === 'h.live', null, 150000), 'Lily is hosting again with the same code');
    log(`  Lily hosting again ${((Date.now() - t0) / 1000).toFixed(1)} s after the reload started`);
  } finally {
    // (always: a failure here must not leave her friends' pages slowed down for the next tests)
    for (const cdp of throttles) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
  }
  const code2 = await game(lily, () => window.__game.net.code);
  check(JSON.stringify(code2) === JSON.stringify(CODE), 'the same code');
  const bk1 = await backupAt();
  check(bk0 && bk1 === bk0, `"Keep playing" keeps the copy from before friends came (backupAt ${bk0} -> ${bk1})`);
  check(await until(lily, () => window.__toasts.some((t) => /door is open again/.test(t)), null, 5000), 'Lily hears "Your door is open again!" (no panel over her world)');
  await settle(lily.page, 600);
  await shot(lily, 'lily-keep-playing');
  for (const pl of [rosie, june]) {
    const how = await guestReturns(pl, ep0);
    check(!!how, `${pl.name} is back in Lily's world with the new epoch (${how})`);
  }
  check((await game(lily, () => window.__knockEvents)) === 0, 'nobody had to knock again (friends from before are let in)');
  check(await game(lily, ([x, y, z]) => window.__game.debug.getBlock(x, y, z) === 'brick_pink', cell), 'Lily\u2019s world kept the edit from before the reload');
  await bringTo(rosie, lily, 2.5, 3);
  await bringTo(june, lily, -2.5, 2.5);
  await converge([lily, rosie, june], 'AT12');
});

test('AT13', 'a new version: every page reloads; the title chips bring everyone back', async () => {
  fc.newVersion();
  await Promise.all([lily, rosie, june].map((pl) => reloadPlayer(pl)));
  const hc = lily.page.locator('.sw-title-chips .sw-net-chip--host');
  await hc.waitFor({ state: 'visible', timeout: 30000 });
  let chips = true;
  for (const pl of [rosie, june]) {
    try {
      await pl.page.locator('.sw-title-chips .sw-net-chip--guest').waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      chips = false;
    }
  }
  check(chips, 'Lily sees "Keep playing"; Rosie and June see "Join Lily"');
  await settle(rosie.page, 600);
  await shot(rosie, 'rosie-title-join-chip');
  await press(lily, hc);
  check(await until(lily, () => window.__game.net.state === 'h.live', null, 150000), 'Lily hosts again');
  for (const pl of [rosie, june]) await press(pl, '.sw-title-chips .sw-net-chip--guest');
  for (const pl of [rosie, june]) check(await waitLive(pl), `${pl.name} is back in Lily's world`);
  check((await game(lily, () => window.__knockEvents)) === 0, 'nobody had to knock again');
  await bringTo(rosie, lily, 2.5, 3);
  await bringTo(june, lily, -2.5, 2.5);
  await converge([lily, rosie, june], 'AT13');
});

test('AT8', 'Send home: Rosie goes to the title with a kind message; knocking again is refused', async () => {
  await closePanels(lily);
  await press(lily, '.sw-playersbtn');
  await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-row[data-seat="1"] .sw-net-kick');
  await press(lily, '.sw-panel-wrap.sw-open .sw-net-row[data-seat="1"] .sw-net-kick');
  await lily.page.waitForSelector('.sw-dialog');
  await press(lily, '.sw-dialog button:has-text("Yes, send home")');
  const home = await until(rosie, () => window.__game.mode === 'title' && document.querySelector('.sw-net-msg[data-code="kicked"]') !== null, null, 30000);
  check(home, 'Rosie is on the title with "Time to go home! Let\'s play in your own world."');
  await settle(rosie.page, 700);
  await shot(rosie, 'rosie-sent-home');
  await nothingShowsThrough(rosie, 'message card');
  await fits(rosie, '.sw-net-msg', 'message card (iPad)');
  await press(rosie, '.sw-net-msg .sw-net-msg-btn');
  // she tries again: refused at once
  await guestTypesCode(rosie, CODE);
  const refused = await until(rosie, () => document.querySelector('.sw-net-msg[data-code="kicked"]') !== null, null, 30000);
  check(refused, 'her knock is refused (no knock card for Lily)');
  check(!(await game(lily, () => document.querySelector('.sw-net-knock') !== null)), 'Lily saw no knock card');
  await press(rosie, '.sw-net-msg .sw-net-msg-btn');
  await closePanels(rosie);
  await closePanels(lily);
  await converge([lily, june], 'AT8');
});

test('AT21', 'screenshots in portrait (768x1024): keypad, knock, Players, bubble, Say, message', async () => {
  await rosie.page.setViewportSize({ width: 768, height: 1024 });
  await settle(rosie.page, 800);
  await press(rosie, 'button.sw-title-friends');
  await press(rosie, '.sw-panel-wrap.sw-open .sw-net-join');
  await rosie.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-keypad:not([hidden])');
  for (const w of ['heart', 'star']) await press(rosie, `.sw-panel-wrap.sw-open .sw-net-key[data-pic="${w}"]`);
  await settle(rosie.page, 700);
  await shot(rosie, 'portrait-keypad');
  await fits(rosie, '.sw-panel-wrap.sw-open .sw-card', 'keypad (portrait)');
  await closePanels(rosie);
  await rosie.page.setViewportSize({ width: 1024, height: 768 });
  // June's phone: her friend's bubble and a message card size
  const r = await game(june, () => window.__game.debug.net.remote().find((x) => x.name === 'Lily')?.pos);
  if (r) await game(june, ([x, y, z]) => { const g = window.__game, p = g.player.position; g.cameraRig.yaw = Math.atan2(x - p.x, z - p.z) + 0.3; g.cameraRig.pitch = 0.2; }, r);
  await game(lily, () => window.__game.debug.net.say(7));
  await settle(june.page, 900);
  await shot(june, 'june-sees-bubble');
  await game(june, () => window.__game.net.ui.showMessage('host_away', { host: 'Lily' }));
  await settle(june.page, 600);
  await shot(june, 'june-message-card');
  await fits(june, '.sw-net-msg', 'message card (phone)');
  await game(june, () => window.__game.net.ui.closeMessage());
});

test('BUDGET', 'AT14 / AT15 / AT16: guests never emit; budgets and sizes held; guests never store the host’s world', async () => {
  await budgetCheck('end', [lily, rosie, june]);
  await savesCheck('end', [rosie, june]);
  const basket = await game(rosie, async () => (await window.__game.store.loadProfile())?.basket?.carrot | 0);
  check(basket >= 2, `AT16: Rosie's own profile kept her carrots (${basket})`);
});

test('END', 'Lily: Save & Exit ends playing together kindly (June goes home; Lily gets "Everything is saved")', async () => {
  await press(lily, '.sw-hud-tr button[aria-label="Menu"]');
  await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-pause-exit');
  await settle(lily.page, 900);
  await shot(lily, 'pause-host');
  await press(lily, '.sw-panel-wrap.sw-open .sw-pause-exit');
  const summary = await until(lily, () => window.__game.mode === 'title' && document.querySelector('.sw-net-msg[data-code="summary"]') !== null, null, 30000);
  check(summary, 'Lily is on the title with "Playing together is over! Everything is saved."');
  await settle(lily.page, 700);
  await shot(lily, 'lily-summary');
  const gone = await until(june, () => window.__game.mode === 'title' && document.querySelector('.sw-net-msg[data-code="ended"]') !== null, null, 30000);
  check(gone, 'June is on the title with "Lily went home. The world is saved at Lily’s house!"');
  await settle(june.page, 700);
  await shot(june, 'june-host-ended');
  await press(lily, '.sw-net-msg .sw-net-msg-btn:has-text("Great")');
  // My Worlds offers "Before friends"
  await press(lily, 'button.sw-btn:has-text("My Worlds")');
  await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-world .sw-net-before', { timeout: 15000 });
  await settle(lily.page, 900);
  await shot(lily, 'my-worlds-before-friends');
  check(true, 'My Worlds shows "Before friends" on Lily’s world');
  await closePanels(lily);
  check(!(await game(lily, () => window.__game.profile.net && window.__game.profile.net.lastHost)), 'no "Keep playing" chip after a goodbye');
});

test('AT22', 'playing alone afterwards: old-save uids keep counting up; no session, nothing sent', async () => {
  const r = await game(lily, async () => {
    const g = window.__game;
    const worlds = await g.store.listWorlds();
    await g.loadWorld(worlds[0].id);
    const p = g.player.position;
    const E = g.entities, def = E.defs.get('chair');
    const placed = [];
    for (let dx = -12; dx <= 12 && placed.length < 2; dx += 2) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) - 6;
      const y = g.world.heightAt(x, z) + 1;
      if (!E.canPlace(def, x, y, z, 0)) continue;
      const e = E.place('chair', x, y, z, 0, null, {}, { history: true });
      if (e) placed.push(e.uid);
    }
    return { a: placed[0], b: placed[1], state: g.net.state, next: E.nextUid };
  });
  check(r.a > 0 && r.b === r.a + 1 && r.b < 1e6, `single-player uids count up below 1,000,000 (${r.a}, ${r.b})`);
  check(r.state === 'idle', 'no session is running');
});

// ---------------------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------------------

async function main() {
  const browser = await launch({ headed: HEADED });
  log('opening Lily (desktop) and Rosie (iPad); June (phone) arrives in AT11');
  BROWSER = browser;
  lily = await openPlayer(browser, PLAYERS[0]);
  rosie = await openPlayer(browser, PLAYERS[1]);
  await settle(lily.page, 800);
  await shot(lily, 'title-desktop');
  for (const t of TESTS) {
    log(`${t.id}: ${t.title}`);
    const before = errors.length;
    const s = Date.now();
    try {
      await t.fn();
    } catch (err) {
      errors.push(`[${t.id}] ${err.stack || err.message}`);
      console.log('    ERROR ' + (err.stack || err.message));
    }
    results.push({ id: t.id, ok: errors.length === before, secs: (Date.now() - s) / 1000 });
    if (UNTIL && t.id === UNTIL) break;
  }
  log('hub: ' + JSON.stringify(hub.stats));
  console.log('\nRESULTS');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.id} (${r.secs.toFixed(1)} s)`);
  console.log(`  total ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  await browser.close();
  hub.close();
  finish(errors);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
