// Headless multiplayer acceptance tests (docs/MULTIPLAYER.md §15.2-15.3, AT1-AT22).
//
//   node tools/probe-multiplayer.mjs [--only=AT1,AT2,...] [--shots-prefix=net] [--headed] [--two]
//
// Three players, each in her own browser context (her own IndexedDB and profile):
//   Lily  host,  desktop 1280x800, mouse,  claude.ai member (can host)
//   Mia   guest, iPad 1024x768, touch,     view-level (never emits)
//   Zoe   guest, phone 390x844, touch,     view-level outside visitor (--two leaves her out)
// Every page gets a room.d.ts-faithful window.claude (tools/net/fake-claude.js) routed through
// one NetHub (tools/net/hub.mjs, the production room logic). The tests drive REAL clicks and
// taps for everything a child does (codes, keypad, knock card, building, panels, phrases) and
// use the debug API only to set up scenes, to read state and to check the results.
// Every test ends with equal hashes on all pages; the whole run needs zero console errors.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  launch, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle, settle, finish, screenPoint, PAGE_URL, SHOTS, ROOT,
} from './smoke.mjs';
import { NetHub } from './net/hub.mjs';
import { FakeClaudeHub } from './net/fake-claude.js';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const ONLY = arg('only') ? new Set(String(arg('only')).split(',').map((s) => s.trim().toUpperCase())) : null;
const PREFIX = arg('shots-prefix', 'net');
const HEADED = !!arg('headed');
const THREE = !arg('two');
const BIOME = arg('biome', 'flat');

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

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    screenshot ${path.relative(ROOT, file)}`);
  return file;
}

async function waitFor(page, fn, arg, { timeout = 20000, polling = 150, what = 'condition' } = {}) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling });
    return true;
  } catch (err) {
    console.log(`    (timed out waiting for ${what})`);
    return false;
  }
}

/** Real tap (touch pages) or click (mouse pages) on a locator. */
async function press(pl, locator) {
  const l = typeof locator === 'string' ? pl.page.locator(locator).first() : locator;
  await l.waitFor({ state: 'visible', timeout: 15000 });
  if (pl.touch) await l.tap();
  else await l.click();
}

const ACCOUNTS = { 'u-lily': 'Lily’s Mom (Parker family)', 'u-mia': 'Mia R.', 'u-zoe': 'zoe.visitor@example.com' };

const PLAYERS = [
  { key: 'host', name: 'Lily', uid: 'u-lily', level: 'interact', can: true, guest: false, viewport: { width: 1280, height: 800 }, touch: false, seed: 11 },
  { key: 'mia', name: 'Mia', uid: 'u-mia', level: 'view', can: null, guest: false, viewport: { width: 1024, height: 768 }, touch: true, seed: 29 },
  { key: 'zoe', name: 'Zoe', uid: 'u-zoe', level: 'view', can: null, guest: true, viewport: { width: 390, height: 844 }, touch: true, seed: 47 },
];

// ---------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------

const hub = new NetHub({
  clock: { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
  budget: { rate: 100000, burst: 100000 }, // the pages keep their own platform budget (fake-claude)
  maxPeers: 16,
  graceMs: 10000,
});
const fc = new FakeClaudeHub(hub);

async function openPlayer(browser, def) {
  const context = await browser.newContext({
    viewport: def.viewport,
    hasTouch: def.touch,
    isMobile: def.touch,
    deviceScaleFactor: def.touch ? 2 : 1,
  });
  await fc.addContext(context, { uid: def.uid, level: def.level, can: def.can, guest: def.guest, accounts: ACCOUNTS, label: def.key });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, def.key);
  await page.goto(PAGE_URL);
  await waitForTitle(page);
  await setupPage({ page, ...def });
  const pl = { ...def, context, page };
  return pl;
}

/** Name, look, quiet settings, the state trace and the storage spy (again after a reload). */
async function setupPage(pl) {
  await pl.page.evaluate(({ name, seed }) => {
    const g = window.__game;
    const look = g.debug.avatar.random(seed);
    look.name = name;
    g.profile.look = look;
    g.profile.playerName = name;
    g.profile.tutorialDone = true;
    // SwiftShader renders on the CPU: draw the 3D at 1x (the UI stays sharp)
    g.profile.settings.quality = 'low';
    g.applySettings();
    g.saveProfile(true);
    g.events.emit('avatar:changed', { look });
    g.events.emit('profile:changed', { profile: g.profile });
    const t0 = performance.now();
    window.__netTrace = [];
    g.events.on('net:state', (s) => window.__netTrace.push([Math.round(performance.now() - t0), s.state]));
    g.events.on('world:load', () => window.__netTrace.push([Math.round(performance.now() - t0), 'world:load']));
    window.__saves = [];
    const orig = g.store.saveWorld.bind(g.store);
    g.store.saveWorld = (save, ...rest) => {
      window.__saves.push(save && save.id);
      return orig(save, ...rest);
    };
  }, { name: pl.name, seed: pl.seed });
}

async function trace(pl) {
  return game(pl, () => (window.__netTrace || []).map(([t, s]) => `${(t / 1000).toFixed(1)}s ${s}`).join(', '));
}

const game = (pl, fn, arg) => pl.page.evaluate(fn, arg);

async function hashes(pl) {
  return game(pl, () => window.__game.debug.net.hash());
}

/** Wait until every page reports the same world hashes (and empty outboxes / predictions). */
async function converge(players, { timeout = 20000, what = 'equal hashes' } = {}) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    const hs = [];
    let quiet = true;
    for (const pl of players) {
      const r = await game(pl, () => {
        const d = window.__game.debug.net;
        return { h: d.hash(), pend: d.pend(), out: d.outbox(), state: d.state() };
      });
      hs.push(JSON.stringify(r.h));
      if (r.pend || r.out) quiet = false;
      last = r;
    }
    if (quiet && hs.every((h) => h === hs[0]) && hs[0] !== 'null') return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  const detail = [];
  for (const pl of players) detail.push(`${pl.key}: ${JSON.stringify(await game(pl, () => ({ h: window.__game.debug.net.hash(), pend: window.__game.debug.net.pend(), out: window.__game.debug.net.outbox(), st: window.__game.debug.net.state() })))}`);
  console.log('    ' + detail.join(' | '));
  return false;
}

async function resyncs(pl) {
  return game(pl, () => window.__game.debug.net.stats().resyncs || 0);
}

// ---------------------------------------------------------------------------------------
// flows through the real UI
// ---------------------------------------------------------------------------------------

/** Host: start a world, Menu -> Invite Friends; returns the 4 code words read from the tiles. */
async function hostMakesCode(host) {
  const p = host.page;
  await press(host, 'button.sw-btn:has-text("New World")');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
  if (BIOME !== 'meadow') await press(host, `.sw-panel-wrap.sw-open .sw-biome[data-biome="${BIOME}"]`);
  await press(host, 'button.sw-create');
  await waitForPlay(p);
  await waitIdle(p);
  await settle(p, 500);
  log(`  host world ready`);
  // Menu -> Invite Friends
  await press(host, '.sw-hud-tr button[aria-label="Menu"]');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-pause-invite');
  await settle(p, 500);
  await shot(p, 'pause-invite');
  await press(host, '.sw-panel-wrap.sw-open .sw-pause-invite');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-code-tiles:not(.sw-wait) .sw-net-tile[data-pic]', { timeout: 30000 });
  await settle(p, 400);
  const code = await p.$$eval('.sw-panel-wrap.sw-open .sw-net-code-tiles .sw-net-tile[data-pic]', (els) => els.map((e) => e.dataset.pic));
  return code;
}

/** Guest: Title -> Play with Friends -> Join a Code -> taps 4 pictures -> Go. */
async function guestTypesCode(guest, code, { shots = false } = {}) {
  const p = guest.page;
  await p.waitForSelector('button.sw-title-friends:not([hidden])', { timeout: 15000 });
  if (shots) await shot(p, `${guest.key}-title`);
  await press(guest, 'button.sw-title-friends');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-join');
  if (shots) await shot(p, `${guest.key}-start`);
  await press(guest, '.sw-panel-wrap.sw-open .sw-net-join');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-keypad');
  for (let k = 0; k < code.length; k++) {
    await press(guest, `.sw-panel-wrap.sw-open .sw-net-key[data-pic="${code[k]}"]`);
    if (shots && k === 1) await shot(p, `${guest.key}-keypad-2`);
  }
  if (shots) await shot(p, `${guest.key}-keypad-4`);
  await press(guest, '.sw-panel-wrap.sw-open .sw-net-go');
}

/** Host: the knock card appears; tap "Let in!". */
async function hostLetsIn(host, name, { shots = false } = {}) {
  const p = host.page;
  const card = p.locator('.sw-net-knock', { hasText: name });
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await settle(p, 300);
  if (shots) await shot(p, `knock-${name.toLowerCase()}`);
  await press(host, card.locator('.sw-net-yes'));
}

// ---------------------------------------------------------------------------------------
// the tests
// ---------------------------------------------------------------------------------------

const TESTS = [];
const test = (id, title, fn) => TESTS.push({ id, title, fn });

let host, mia, zoe;
let CODE = null;

test('AT1', 'make a code, join with the keypad, knock, let in; both see each other', async () => {
  const t0 = Date.now();
  CODE = await hostMakesCode(host);
  log(`  code: ${CODE.join(' ')}`);
  check(CODE.length === 4, 'the host reads 4 code pictures');
  await shot(host.page, 'players-host-waiting');
  await guestTypesCode(mia, CODE, { shots: true });
  await waitFor(mia.page, () => document.querySelector('.sw-net-joining:not([hidden])') !== null, null, { what: 'joining card' });
  await settle(mia.page, 300);
  await shot(mia.page, 'mia-joining');
  await hostLetsIn(host, 'Mia', { shots: true });
  const tLetIn = Date.now();
  const inPlay = await waitFor(mia.page, () => window.__game.mode === 'play' && !window.__game.loading && window.__game.debug.net.state() === 'g.live', null, { timeout: 120000, what: 'Mia in play' });
  check(inPlay, 'Mia is in Lily’s world');
  log(`  Mia in play ${((Date.now() - tLetIn) / 1000).toFixed(1)} s after "Let in!" (${((Date.now() - t0) / 1000).toFixed(1)} s from Invite Friends)`);
  log(`  Mia trace: ${await trace(mia)}`);
  await host.page.keyboard.press('Escape');
  const seen = await waitFor(host.page, () => window.__game.debug.net.remote().some((r) => r.name === 'Mia' && r.visible), null, { timeout: 15000, what: 'Mia avatar on host' });
  check(seen, 'the host sees Mia’s avatar');
  const seen2 = await waitFor(mia.page, () => window.__game.debug.net.remote().some((r) => r.name === 'Lily' && r.visible), null, { timeout: 15000, what: 'Lily avatar on Mia' });
  check(seen2, 'Mia sees Lily’s avatar');
  check(await converge([host, mia]), 'equal hashes');
  await settle(mia.page, 800);
  await shot(mia.page, 'mia-in-world');
  await shot(host.page, 'host-sees-mia');
});

// ---------------------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------------------

async function main() {
  const browser = await launch({ headed: HEADED });
  log(`opening ${THREE ? 3 : 2} players`);
  host = await openPlayer(browser, PLAYERS[0]);
  mia = await openPlayer(browser, PLAYERS[1]);
  if (THREE) zoe = await openPlayer(browser, PLAYERS[2]);
  await shot(host.page, 'title-host');
  if (zoe) await shot(zoe.page, 'title-phone');
  for (const t of TESTS) {
    if (ONLY && !ONLY.has(t.id) && t.id !== 'AT1') continue;
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
  }
  const st = fc.stats();
  log('hub: ' + JSON.stringify(hub.stats) + ' pages: ' + JSON.stringify(st));
  console.log('\nRESULTS');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.id} (${r.secs.toFixed(1)} s)`);
  await browser.close();
  hub.close();
  finish(errors);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
