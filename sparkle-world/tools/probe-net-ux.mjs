// Playing together: the review fixes a child sees, end to end over the real Railway relay
// (server/server.mjs on a random port, the WebSocket transport, the gate).
//
//   node tools/probe-net-ux.mjs [--no-build] [--headed] [--shots-prefix=netux]
//
// 1. A fresh device taps Play with Friends: "What's your name?" comes first (nobody plays as
//    the game's own "Lily").
// 2. Lily hosts through the pause menu's Play Together card; Mia (iPad, touch) types the code.
//    While she knocks, the relay shows her only the public keys of Lily's presence.
// 3. Lily pauses building: Mia hears it and sees the "Lily paused building" pill; on again.
// 4. Lily's Undo building for Mia: Mia hears "Lily tidied up..." (never silence).
// 5. Lily's page reloads and she taps Play (not Keep playing): "Your friends are waiting!"
//    opens the door again with the same code; the "before friends" copy stays the first one.
// 6. Stop playing; My Worlds shows a small "Before friends" with the copy's day; the confirm
//    shows the copy's picture; after going back, Undo brings the world back.
// 7. Building alone afterwards (saved) takes the "Before friends" copy away.
// Zero console errors.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launch, waitForTitle, settle, finish, ROOT, SHOTS, attachErrorCollectors } from './smoke.mjs';
import {
  sleep, game, until, press, setupPage, hostMakesCode, guestTypesCode, hostLetsIn, waitLive, bringTo, closePanels, converge,
} from './net/mp-flows.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const PREFIX = arg('shots-prefix', 'netux');
const errors = [];
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
  await pl.page.screenshot({ path: file });
  console.log(`    screenshot ${path.relative(ROOT, file)}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let server = null;
async function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SW_IDLE_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('    [server] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('    [server!] ' + d));
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) {
        server = child;
        return child;
      }
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('the server did not start');
}

const PLAYERS = [
  { key: 'lily', name: 'Lily', viewport: { width: 1280, height: 800 }, touch: false, seed: 11 },
  { key: 'mia', name: 'Mia', viewport: { width: 1024, height: 768 }, touch: true, seed: 29 },
  { key: 'ava', name: 'Ava', viewport: { width: 390, height: 844 }, touch: true, seed: 47, fresh: true },
];

async function openPlayer(browser, def, url) {
  const context = await browser.newContext({ viewport: def.viewport, hasTouch: def.touch, isMobile: def.touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, def.key);
  await page.goto(url);
  await waitForTitle(page, 120000);
  const pl = { ...def, context, page };
  if (!def.fresh) await setupPage(pl);
  else {
    // the toast spy only (her profile stays brand new)
    await game(pl, () => {
      window.__toasts = [];
      const g = window.__game, t = g.ui.toast.bind(g.ui);
      g.ui.toast = (text, opts) => { window.__toasts.push(String(text)); return t(text, opts); };
    });
  }
  return pl;
}

const toastsSince = (pl) => game(pl, () => window.__toasts.slice(window.__t0 || 0));
const markToasts = (pl) => game(pl, () => { window.__t0 = window.__toasts.length; });

async function main() {
  if (!arg('no-build')) {
    log('npm run build');
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  await startServer(port);
  const url = `http://localhost:${port}/play`; // the home page is at /, the game at /play
  log(`server up: ${url}`);
  const browser = await launch({ headed: !!arg('headed') });
  try {
    const lily = await openPlayer(browser, PLAYERS[0], url);
    const mia = await openPlayer(browser, PLAYERS[1], url);
    const ava = await openPlayer(browser, PLAYERS[2], url);

    // ----- 1. the name step on a brand-new device -----
    log('1. a brand-new device: the name comes first');
    await until(ava, () => !document.querySelector('button.sw-title-friends').hidden, null, 15000);
    check(await game(ava, () => window.__game.net.adapter.local().nm === 'Friend'), 'a new device shows others "Friend", not the game\'s own "Lily"');
    await press(ava, 'button.sw-title-friends');
    await ava.page.waitForSelector('.sw-dialog input.sw-input', { timeout: 15000 });
    await settle(ava.page, 1200);
    await shot(ava, 'ava-name-step');
    check(/What's your name/.test(await ava.page.locator('.sw-dialog h3').textContent()), 'the dialog asks "What\'s your name?"');
    await ava.page.locator('.sw-dialog input.sw-input').fill('Ava');
    await press(ava, '.sw-dialog button:has-text("That\'s me!")');
    await ava.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-join', { timeout: 15000 });
    const prof = await game(ava, () => ({ n: window.__game.profile.playerName, set: window.__game.profile.nameSet, nm: window.__game.net.adapter.local().nm }));
    check(prof.n === 'Ava' && prof.set === true && prof.nm === 'Ava', `her name is kept and shown to others (${JSON.stringify(prof)})`);
    await closePanels(ava);
    await ava.context.close();

    // ----- 2. hosting from the pause menu; Mia knocks behind the gate -----
    log('2. Lily: Menu -> Play Together -> Make a Code; Mia types it');
    const code = await hostMakesCode(lily, { shot, log });
    check(code.length === 4, `code ${code.join(' ')}`);
    await settle(lily.page, 900);
    await shot(lily, 'lily-players-panel');
    await guestTypesCode(mia, code);
    const knocking = await until(mia, () => window.__game.net.state === 'g.knocking', null, 30000);
    check(knocking, 'Mia is knocking');
    const seen = await game(mia, () => {
      const h = window.__game.net.session.transport.peers().find((p) => p.state.r === 'h');
      return h ? Object.keys(h.state).sort() : null;
    });
    check(seen && !seen.includes('nm') && !seen.includes('lk') && !seen.includes('p'), `before she is let in, Mia sees only public keys of Lily (${JSON.stringify(seen)})`);
    await hostLetsIn(lily, 'Mia');
    check(await waitLive(mia), 'Mia is in Lily\'s world');
    const named = await game(mia, () => window.__game.net.hostName);
    check(named === 'Lily', `once in, Lily's name is there (${named})`);
    await closePanels(lily);
    await bringTo(mia, lily, 2.5, 3);
    await settle(mia.page, 900);
    await shot(mia, 'mia-hud-players-icon');
    let c = await converge([lily, mia]);
    check(c.ok, `same world ${JSON.stringify(c.hash)} ${c.detail || ''}`);

    // ----- 3. building paused and on again -----
    log('3. Lily pauses building');
    await markToasts(mia);
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-rule-build');
    await settle(lily.page, 1200);
    await shot(lily, 'lily-players-rules');
    const ruleText = await lily.page.locator('.sw-panel-wrap.sw-open .sw-net-rule-build .sw-net-rule-name').textContent();
    check(ruleText === 'Players can build', `the switch says "Players can build" (${ruleText})`);
    await press(lily, '.sw-panel-wrap.sw-open .sw-net-rule-build');
    const pill = await until(mia, () => { const e = document.querySelector('.sw-net-away'); return e && !e.hidden && /paused building/.test(e.textContent) ? e.textContent : null; }, null, 15000);
    check(!!pill, `Mia sees the pill "${pill}"`);
    check((await toastsSince(mia)).some((t) => /Lily paused building/.test(t)), 'Mia hears "Lily paused building."');
    await settle(mia.page, 500);
    await shot(mia, 'mia-building-paused');
    await markToasts(mia);
    await press(lily, '.sw-panel-wrap.sw-open .sw-net-rule-build');
    check(await until(mia, () => window.__toasts.slice(window.__t0).some((t) => /You can build again/.test(t)), null, 15000), 'Mia hears "You can build again!"');
    check(await until(mia, () => document.querySelector('.sw-net-away').hidden, null, 10000), 'the pill goes away');
    await closePanels(lily);

    // ----- 4. Undo building: Mia hears it -----
    log('4. Mia builds; Lily undoes her building');
    await game(mia, () => {
      const g = window.__game, p = g.player.position;
      g.historyGroup(() => { for (let k = 0; k < 4; k++) g.placeBlock(Math.floor(p.x) + k, g.world.heightAt(Math.floor(p.x) + k, Math.floor(p.z) + 5) + 1, Math.floor(p.z) + 5, 'wool_pink'); });
    });
    c = await converge([lily, mia]);
    await markToasts(mia);
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await press(lily, '.sw-panel-wrap.sw-open .sw-net-row[data-seat="1"] .sw-net-undo');
    await lily.page.waitForSelector('.sw-dialog');
    await press(lily, '.sw-dialog button:has-text("Yes, undo")');
    const tidied = await until(mia, () => window.__toasts.slice(window.__t0).find((t) => /tidied up/.test(t)), null, 15000);
    check(!!tidied, `Mia hears "${tidied}"`);
    await settle(mia.page, 400);
    await shot(mia, 'mia-tidied');
    await closePanels(lily);
    c = await converge([lily, mia]);
    check(c.ok, `same world after Undo building ${c.detail || ''}`);

    // ----- 5. Lily reloads and taps Play: her friends are waiting -----
    log('5. Lily reloads and taps Play (not Keep playing)');
    // a block Lily builds while friends are here (it must go with "Before friends")
    const mark = await game(lily, () => {
      const g = window.__game, p = g.player.position;
      const x = Math.floor(p.x) - 3, z = Math.floor(p.z) - 3, y = g.world.heightAt(x, z) + 1;
      g.placeBlock(x, y, z, 'brick_pink');
      return [x, y, z];
    });
    await game(lily, () => window.__game.saveWorld({ thumbnail: false }));
    const bk = async () => game(lily, async () => (await window.__game.store.listBackups()).map((b) => b.backupAt).join(','));
    const bk0 = await bk();
    await lily.page.reload();
    await waitForTitle(lily.page, 120000);
    await setupPage(lily);
    const chip = lily.page.locator('.sw-title-chips .sw-net-chip--host');
    await chip.waitFor({ state: 'visible', timeout: 30000 });
    await settle(lily.page, 700);
    await shot(lily, 'lily-title-keep-playing');
    await press(lily, 'button.sw-title-play');
    const card = await until(lily, () => document.querySelector('.sw-net-msg[data-code="friends_waiting"]') !== null, null, 60000);
    check(card, 'Lily\'s world opens with "Your friends are waiting! Open your door again?"');
    await settle(lily.page, 600);
    await shot(lily, 'lily-friends-waiting');
    await press(lily, '.sw-net-msg .sw-net-reopen');
    check(await until(lily, () => window.__game.net.state === 'h.live', null, 60000), 'hosting again');
    const code2 = await game(lily, () => window.__game.net.code);
    check(JSON.stringify(code2) === JSON.stringify(code), 'with the same code');
    check(await until(mia, () => window.__game.net.state === 'g.live' && window.__game.net.session.guestCore.entered, null, 90000), 'Mia is back in without knocking');
    const bk1 = await bk();
    check(bk0 && bk0 === bk1, `the copy from before friends came is kept (${bk0} -> ${bk1})`);
    await bringTo(mia, lily, 2.5, 3);
    c = await converge([lily, mia], { timeout: 60000 });
    check(c.ok, `same world after coming back ${c.detail || ''}`);

    // ----- 6. Stop playing; Before friends; Undo -----
    log('6. Stop playing, then My Worlds: Before friends, and Undo');
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await press(lily, '.sw-panel-wrap.sw-open .sw-net-stop');
    await press(lily, '.sw-dialog button:has-text("Yes, stop")');
    await lily.page.waitForSelector('.sw-net-msg[data-code="summary"]', { timeout: 30000 });
    await press(lily, '.sw-net-msg .sw-net-msg-btn:has-text("Great")');
    await press(lily, '.sw-hud-tr button[aria-label="Menu"]');
    await press(lily, '.sw-panel-wrap.sw-open .sw-pause-exit');
    await until(lily, () => window.__game.mode === 'title', null, 30000);
    await press(lily, 'button.sw-btn:has-text("My Worlds")');
    await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-world .sw-net-before', { timeout: 15000 });
    await settle(lily.page, 900);
    await shot(lily, 'lily-my-worlds-before');
    const when = await lily.page.locator('.sw-world-before-when').first().textContent();
    check(/Copy from today/.test(when), `the button says which day the copy is from ("${when}")`);
    const big = await game(lily, () => {
      const b = document.querySelector('.sw-world .sw-net-before').getBoundingClientRect();
      const p = document.querySelector('.sw-world .sw-world-actions .sw-btn').getBoundingClientRect();
      return { b: Math.round(b.width), card: Math.round(document.querySelector('.sw-world').getBoundingClientRect().width), play: Math.round(p.width) };
    });
    check(big.b < big.card * 0.7, `"Before friends" is a small button, not a second Play (${JSON.stringify(big)})`);
    await press(lily, '.sw-panel-wrap.sw-open .sw-world .sw-net-before');
    await lily.page.waitForSelector('.sw-dialog img.sw-net-before-pic', { timeout: 10000 });
    await settle(lily.page, 1200);
    await shot(lily, 'lily-before-confirm');
    const txt = await lily.page.locator('.sw-dialog p').textContent();
    check(/also what you built/.test(txt), `the confirm says her own building goes too ("${txt}")`);
    await press(lily, '.sw-dialog button:has-text("Yes, go back")');
    await lily.page.waitForSelector('.sw-dialog:has-text("Are you really sure")');
    await press(lily, '.sw-dialog button:has-text("Yes, go back")');
    await lily.page.waitForSelector('.sw-net-msg[data-code="restored"]', { timeout: 30000 });
    await settle(lily.page, 500);
    await shot(lily, 'lily-restored-undo');
    const wid = await game(lily, async () => (await window.__game.store.listWorlds())[0].id);
    const gone = await game(lily, async () => (await window.__game.store.listBackups()).length);
    check(gone === 0, 'the copy is used up (the next hosting makes a fresh one)');
    await press(lily, '.sw-net-msg .sw-net-restore-undo');
    await until(lily, () => window.__toasts.some((t) => /Everything is back/.test(t)), null, 20000);
    const back = await game(lily, async ([id, x, y, z]) => {
      const g = window.__game;
      await g.loadWorld(id);
      return g.debug.getBlock(x, y, z);
    }, [wid, ...mark]);
    check(back === 'brick_pink', `Undo brings back what was there (${back})`);

    // ----- 7. building alone takes the copy away -----
    log('7. Lily hosts again (a fresh copy), stops, then builds alone');
    check(await game(lily, async () => (await window.__game.store.listBackups()).length) === 0, 'no copy after the restore and its undo');
    await press(lily, '.sw-hud-tr button[aria-label="Menu"]');
    await press(lily, '.sw-panel-wrap.sw-open .sw-pause-invite');
    await press(lily, '.sw-panel-wrap.sw-open .sw-net-invite');
    check(await until(lily, () => window.__game.net.state === 'h.live', null, 60000), 'hosting again (a new code)');
    check(await game(lily, async () => (await window.__game.store.listBackups()).length) === 1, 'a fresh "before friends" copy');
    await closePanels(lily);
    await game(lily, () => window.__game.net.leave({ quiet: true }));
    await until(lily, () => window.__game.net.state === 'idle', null, 20000);
    await game(lily, () => {
      const g = window.__game, p = g.player.position;
      const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 3;
      g.placeBlock(x, g.world.heightAt(x, z) + 1, z, 'wool_sky');
      return g.saveWorld({ thumbnail: false });
    });
    const dropped = await until(lily, async () => (await window.__game.store.listBackups()).length === 0, null, 15000);
    check(dropped, 'once her own building is saved, "Before friends" is gone (it would take her building away)');
    await game(lily, () => window.__game.exitToTitle());
    await press(lily, 'button.sw-btn:has-text("My Worlds")');
    await lily.page.waitForSelector('.sw-panel-wrap.sw-open .sw-world', { timeout: 15000 });
    await settle(lily.page, 700);
    check(await game(lily, () => !document.querySelector('.sw-world .sw-net-before')), 'My Worlds has no "Before friends" now');
    await closePanels(lily);
  } finally {
    await browser.close().catch(() => {});
    if (server) server.kill('SIGKILL');
  }
  finish(errors);
}

main().catch((err) => {
  errors.push('[fatal] ' + (err && err.stack ? err.stack : err));
  if (server) server.kill('SIGKILL');
  finish(errors);
});
