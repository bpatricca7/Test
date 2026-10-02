// Keeping her worlds safe on the website (src/core/keepsafe.js, src/ui/keepsafe.js,
// docs/teams/keepsafe.md), end to end through the real server:
//
//   node tools/probe-keepsafe.mjs [--no-build] [--headed] [--shots-prefix=keepsafe] [--only=devices]
//
// 1. `npm run build`, then starts server/server.mjs on a random free port (its own process;
//    only that process is stopped at the end, by its PID).
// 2. No "Add to Home Screen" anything: no web app manifest or home-screen app tags on the game
//    page or the home page, no manifest or new icons served, no such words in the game.
// 3. Desktop Chrome: navigator.storage.persist() is asked at boot and again at the first key
//    press; the answer is in profile.keepsafe and in diag.report(). A new player is not nagged.
// 4. The backup card: after faking lastBackupAt 8 days ago it shows once on the title, "Not
//    now" waits 7 days, it never shows in a world (a quick Play, or asking while playing), and
//    "Save a copy" downloads one backup file with every world and her look (captured).
// 5. A fresh profile (new context) opens that file: worlds, look, coins and stickers come back.
//    Opening it again with a changed world asks in-page (Keep the one here / Use the one in the
//    file / Keep both); an unchanged world is skipped; a single-world file that is already here
//    says so ("They are just the same.").
// 6. iPad Safari (UA + touch), in landscape and portrait, iPadOS that says "Macintosh", and an
//    iPhone: the card shows even when the browser says the storage is kept (the 7-day rule);
//    a Home Screen app (navigator.standalone) and a Mac with no touch do not get it; storage
//    granted on desktop: no card.
// 7. file:// and a claude.ai stand-in (window.claude.use): no card, no persist() call, no
//    "Save all".
// Zero console errors, page errors or failed requests (Google Fonts ignored).

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launch, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle, settle, finish, ROOT, SHOTS, PAGE_URL } from './smoke.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const P = arg('shots-prefix', 'keepsafe');
const DAY = 86400000;
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

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${P}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    screenshot ${path.relative(ROOT, file)}`);
}

// ---------- the server (our own process only) ----------

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
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('    [server] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('    [server!] ' + d));
  server = child;
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

function stopServer() {
  if (server && server.exitCode === null) {
    try {
      process.kill(server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

// ---------- pages ----------

const UA = {
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

/**
 * A page on `url`. persist: 'denied' | 'granted' (navigator.storage answers that and counts the
 * calls in window.__ks) or null (the browser's own answer, still counted). standalone: a Home
 * Screen app (navigator.standalone = true). touchPoints: navigator.maxTouchPoints. claude: a
 * claude.ai stand-in (window.claude.use resolves nothing).
 */
async function open(browser, url, { label, viewport = { width: 1280, height: 800 }, touch = false, ua = null, persist = 'denied', standalone = false, touchPoints = null, claude = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1, acceptDownloads: true, ...(ua ? { userAgent: ua } : {}) });
  await context.addInitScript(({ persist, standalone, touchPoints, claude }) => {
    const calls = (window.__ks = { persist: 0, persisted: 0 });
    const s = navigator.storage;
    if (s) {
      const realPersist = s.persist && s.persist.bind(s);
      const realPersisted = s.persisted && s.persisted.bind(s);
      const def = (name, fn) => Object.defineProperty(s, name, { value: fn, configurable: true });
      def('persisted', () => { calls.persisted++; return persist ? Promise.resolve(persist === 'granted') : realPersisted(); });
      def('persist', () => { calls.persist++; return persist ? Promise.resolve(persist === 'granted') : realPersist(); });
    }
    if (standalone) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    if (touchPoints !== null) Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => touchPoints, configurable: true });
    if (claude) window.claude = { use: async () => null };
  }, { persist, standalone, touchPoints, claude });
  const page = await context.newPage();
  attachErrorCollectors(page, errors, label);
  await page.goto(url);
  await waitForTitle(page);
  return { context, page };
}

const game = (page, fn, arg) => page.evaluate(fn, arg);

async function newWorld(page, name) {
  await game(page, (n) => window.__game.debug.newWorld({ name: n, biome: 'meadow', size: 'cozy' }), name);
  await waitForPlay(page);
  await waitIdle(page);
  await game(page, () => window.__game.exitToTitle());
  await waitForTitle(page);
}

/** Pretend the last copy in a file was `days` ago (and no "Not now" is waiting). */
async function ageBackup(page, days) {
  await game(page, async (d) => {
    const g = window.__game;
    const st = g.keepsafe.state;
    st.lastBackupAt = d === null ? 0 : Date.now() - d * 86400000;
    st.snoozeUntil = 0;
    await g.saveProfile(true);
  }, days);
}

async function reload(page) {
  await page.reload();
  await waitForTitle(page);
}

/** Wait up to ms for the backup card; true when it is on screen. */
async function cardShows(page, ms = 4000) {
  return page.waitForSelector('.sw-dialog.ks-card', { state: 'visible', timeout: ms }).then(() => true, () => false);
}

async function noHomeScreenUi(page, label) {
  const r = await game(page, () => ({
    words: /home screen/i.test(document.body.innerText),
    manifest: !!document.querySelector('link[rel="manifest"], meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]'),
  }));
  check(!r.words && !r.manifest, `${label}: no "Add to Home Screen" words or web-app tags in the game`);
}

async function ksState(page) {
  return game(page, () => {
    const g = window.__game;
    return { calls: { ...window.__ks }, active: g.keepsafe.active, persisted: g.keepsafe.persisted, state: g.profile.keepsafe ? { ...g.profile.keepsafe } : null, diag: g.diag.report().storage };
  });
}

async function run() {
  if (!arg('no-build')) {
    log('building');
    const b = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  await startServer(port);
  const base = `http://127.0.0.1:${port}`;
  const PLAY = `${base}/play`;
  await mkdir(SHOTS, { recursive: true });

  // ---------------------------------------------------------------- 2. no home-screen app
  log('No "Add to Home Screen": no manifest, no web-app tags, no new icons');
  const gameHtml = await (await fetch(PLAY)).text();
  const homeHtml = await (await fetch(`${base}/`)).text();
  const tagRe = /rel=["']manifest["']|apple-mobile-web-app|mobile-web-app-capable/i;
  check(!tagRe.test(gameHtml), 'the game page has no manifest link or web-app tags');
  check(!tagRe.test(homeHtml), 'the home page has no manifest link or web-app tags');
  for (const p of ['/manifest.webmanifest', '/manifest.json', '/site.webmanifest', '/img/icon-192.png', '/img/icon-512.png']) {
    check((await fetch(base + p)).status === 404, `${p} is not served`);
  }

  const browser = await launch({ headed: !!arg('headed') });
  try {
    const backupFile = path.join(SHOTS, `${P}-backup.json`);
    let s;
    // --only=devices: the iPhone/iPad, file:// and claude.ai cases with the backup file of an earlier run
    if (arg('only') !== 'devices') {
      // -------------------------------------------------------------- 3. desktop Chrome
      log('Desktop Chrome: persist() at boot and at the first key press');
      const A = await open(browser, PLAY, { label: 'desktop' });
      await game(A.page, () => window.__game.keepsafe.ready);
      s = await ksState(A.page);
      check(s.active, 'the website version: keepsafe is on');
      check(s.calls.persisted >= 1 && s.calls.persist === 1, `persist() asked once at boot (persisted() ${s.calls.persisted}, persist() ${s.calls.persist})`);
      check(s.state && s.state.persisted === false && s.state.askedAt > 0, 'the answer is in profile.keepsafe (persisted: false, askedAt)');
      await A.page.keyboard.press('Shift');
      await A.page.waitForFunction(() => window.__ks.persist >= 2, null, { timeout: 3000 }).catch(() => {});
      await game(A.page, () => window.__game.keepsafe.ready);
      s = await ksState(A.page);
      check(s.calls.persist === 2, `asked again at her first key press (persist() ${s.calls.persist})`);
      check(s.diag && s.diag.keepsafe && s.diag.keepsafe.persisted === false && s.diag.keepsafe.asks === 2 && s.diag.keepsafe.host === 'web', `diag.report().storage.keepsafe says so (${JSON.stringify(s.diag && s.diag.keepsafe)})`);
      await A.page.keyboard.press('Shift');
      await settle(A.page, 300);
      check((await ksState(A.page)).calls.persist === 2, 'later key presses do not ask again');
      await noHomeScreenUi(A.page, 'desktop');

      log('Two worlds, a new look, coins and a sticker');
      await newWorld(A.page, 'Rainbow Meadow');
      await newWorld(A.page, 'Cupcake Village');
      const mine = await game(A.page, async () => {
        const g = window.__game, p = g.profile;
        p.look.hair = { ...p.look.hair, style: 'space_buns', color: '#9C7BFF' };
        p.look.top = { ...p.look.top, color: '#3FD8B0' };
        p.look.name = 'Mia';
        p.playerName = 'Mia';
        p.coins = 777;
        p.stickers = { ...p.stickers, first_block: p.stickers.first_block || new Date().toISOString() };
        g.events.emit('avatar:changed', { look: p.look });
        await g.saveProfile(true);
        return { look: JSON.stringify(p.look), worlds: (await g.store.listWorlds()).map((w) => w.name).sort() };
      });
      check(mine.worlds.length === 2, `two worlds here (${mine.worlds.join(', ')})`);

      log('A new player is not nagged');
      await ageBackup(A.page, null);
      await reload(A.page);
      check(!(await cardShows(A.page, 3500)), 'worlds made today and no copy yet: no card');

      log('The backup card after 8 days');
      await ageBackup(A.page, 8);
      await reload(A.page);
      check(await cardShows(A.page), 'the card shows on the title');
      await settle(A.page, 700);
      await shot(A.page, 'card-desktop');
      const cardText = await A.page.locator('.ks-card').innerText();
      check(/It's been a while!/.test(cardText) && /Save a copy of your worlds\?/.test(cardText), 'it says "It\'s been a while! Save a copy of your worlds?"');
      check((await A.page.locator('.ks-card .ks-shot').count()) === 2, 'it shows her two worlds\' pictures');
      await A.page.locator('.ks-card button', { hasText: 'Not now' }).click();
      await A.page.waitForSelector('.ks-card', { state: 'detached', timeout: 3000 }).catch(() => {});
      s = await ksState(A.page);
      check(s.state.snoozeUntil > Date.now() + 6.9 * DAY && s.state.snoozeUntil < Date.now() + 7.1 * DAY, '"Not now" waits 7 days');
      check((await A.page.locator('.ks-card').count()) === 0, 'the card is gone');
      await reload(A.page);
      check(!(await cardShows(A.page, 3500)), 'after "Not now": no card on the next visit');

      log('Never in a world');
      await ageBackup(A.page, 8);
      await A.page.reload();
      // a quick Play, as soon as the title is there (before the card)
      await A.page.waitForFunction(() => window.__game && window.__game.ui && window.__game.ui.current === 'title' && !document.querySelector('.sw-title-play').hidden, null, { timeout: 30000, polling: 50 });
      await game(A.page, () => document.querySelector('.sw-title-play').click());
      await waitForPlay(A.page);
      await settle(A.page, 2500);
      check((await A.page.locator('.ks-card').count()) === 0, 'a quick Play: no card in the world');
      check(!(await game(A.page, () => window.__game.keepsafe.remind({ force: true }))), 'asking while playing shows nothing');
      check((await A.page.locator('.ks-card').count()) === 0, 'still no card in the world');
      await game(A.page, () => window.__game.exitToTitle());
      await waitForTitle(A.page);
      check(await cardShows(A.page), 'back on the title: the card');

      log('"Save a copy": one file with every world');
      const dl = A.page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await A.page.locator('.ks-card button', { hasText: 'Save a copy' }).click();
      const d = await dl;
      check(d && /^Glimmer World backup \d{4}-\d\d-\d\d\.json$/.test(d.suggestedFilename()), `downloaded "${d && d.suggestedFilename()}"`);
      let backup = null;
      if (d) {
        await d.saveAs(backupFile);
        backup = JSON.parse(await readFile(backupFile, 'utf8'));
      }
      check(backup && backup.format === 'sparkle-world-backup' && backup.worlds.length === 2 && backup.worlds.every((w) => w.blocks && w.size && w.thumbnail), `the file has both worlds (${backup && backup.worlds.map((w) => w.name).join(', ')})`);
      check(backup && JSON.stringify(backup.profile.look) === mine.look && backup.profile.coins === 777 && backup.profile.stickers.first_block, 'and her look, coins and stickers');
      check(backup && !('settings' in backup.profile) && !('net' in backup.profile) && !('keepsafe' in backup.profile), 'but not this device\'s settings or ids');
      await A.page.waitForFunction(() => /Saved a copy of your worlds!/.test(document.querySelector('.sw-toasts').textContent), null, { timeout: 4000 }).catch(() => {});
      check(/Saved a copy of your worlds!/.test(await game(A.page, () => document.querySelector('.sw-toasts').textContent)), 'a happy toast');
      s = await ksState(A.page);
      check(Math.abs(s.state.lastBackupAt - Date.now()) < 60000, 'lastBackupAt is now');
      await reload(A.page);
      check(!(await cardShows(A.page, 3500)), 'right after a copy: no card');

      log('Saving one world to a file counts too; "Save all" in My Worlds');
      await ageBackup(A.page, 8);
      await A.page.locator('.sw-title2 button', { hasText: 'My Worlds' }).click();
      await A.page.waitForSelector('.sw-panel-wrap.sw-open .sw-world img');
      check(await A.page.locator('.sw-save-all').isVisible(), 'My Worlds has "Save all" on the website');
      const dl1 = A.page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await A.page.locator('.sw-world button[aria-label="Save to a file"]').first().click();
      const d1 = await dl1;
      const worldFile = path.join(SHOTS, `${P}-one-world.json`);
      if (d1) await d1.saveAs(worldFile);
      await settle(A.page, 400);
      s = await ksState(A.page);
      check(d1 && Math.abs(s.state.lastBackupAt - Date.now()) < 60000, 'one world saved to a file: lastBackupAt is now');
      const dl2 = A.page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await A.page.locator('.sw-save-all').click();
      const d2 = await dl2;
      check(d2 && /backup/.test(d2.suggestedFilename()), '"Save all" downloads a backup too');
      await settle(A.page, 300);
      await shot(A.page, 'worlds-save-all');
      await A.context.close();

      // -------------------------------------------------------------- 5. a fresh profile
      log('A fresh profile opens the backup');
      const B = await open(browser, PLAY, { label: 'fresh' });
      const freshLook = await game(B.page, () => JSON.stringify(window.__game.profile.look));
      await B.page.locator('.sw-title2 button', { hasText: 'My Worlds' }).click();
      await B.page.waitForSelector('.sw-panel-wrap.sw-open .sw-empty');
      let chooser = B.page.waitForEvent('filechooser');
      await B.page.locator('.sw-panel-wrap.sw-open .sw-empty button', { hasText: 'Open a file' }).click();
      await (await chooser).setFiles(backupFile);
      await B.page.waitForFunction(() => document.querySelectorAll('.sw-world').length === 2, null, { timeout: 10000 }).catch(() => {});
      await settle(B.page, 600);
      const back = await game(B.page, async () => {
        const g = window.__game;
        return { worlds: (await g.store.listWorlds()).map((w) => w.name).sort(), look: JSON.stringify(g.profile.look), name: g.profile.playerName, coins: g.profile.coins, sticker: !!g.profile.stickers.first_block, toast: document.querySelector('.sw-toasts').textContent };
      });
      check(back.worlds.join() === mine.worlds.join(), `both worlds are back (${back.worlds.join(', ')})`);
      check(back.look === mine.look && back.look !== freshLook && back.name === 'Mia', 'her look and name are back');
      check(back.coins === 777 && back.sticker, 'her coins and sticker are back');
      check(/Your worlds are back!/.test(back.toast), 'toast: "Your worlds are back!"');
      await shot(B.page, 'restored');

      log('Opening it again: a changed world asks, an unchanged one is skipped');
      const changedId = await game(B.page, async () => {
        const g = window.__game;
        const w = (await g.store.listWorlds()).find((m) => m.name === 'Rainbow Meadow');
        const save = await g.store.loadWorld(w.id);
        // a newer copy of the same world: she walked on a bit
        save.player = { ...save.player, x: save.player.x + 1 };
        save.updatedAt = Date.now();
        await g.store.saveWorld(save);
        return w.id;
      });
      const openFile = async (file) => {
        const ch = B.page.waitForEvent('filechooser');
        await B.page.locator('.sw-open-file').click();
        await (await ch).setFiles(file);
      };
      await game(B.page, () => window.__game.ui.open('worlds'));
      await openFile(backupFile);
      const asked = await B.page.waitForSelector('.sw-dialog.ks-conflict', { timeout: 5000 }).then(() => true, () => false);
      check(asked, 'a world that is already here (and changed): an in-page question');
      await settle(B.page, 500);
      await shot(B.page, 'conflict-desktop');
      const q = await game(B.page, () => ({
        text: document.querySelector('.ks-conflict').innerText,
        dialogs: document.querySelectorAll('.sw-dialog').length,
        newer: document.querySelector('.ks-side.ks-newer') && document.querySelector('.ks-side.ks-newer').dataset.side,
      }));
      check(/\u201CRainbow Meadow\u201D is already here/.test(q.text) && /Here now/.test(q.text) && /In the file/.test(q.text), 'it shows both: "Here now" and "In the file"');
      check(q.newer === 'mine', 'the one here is marked "Newer"');
      check(/Keep the one here/.test(q.text) && /Use the one in the file/.test(q.text) && /Keep both/.test(q.text), 'three answers');
      await B.page.locator('.ks-conflict button', { hasText: 'Keep the one here' }).click();
      await B.page.waitForFunction(() => /You have all these worlds already!/.test(document.querySelector('.sw-toasts').textContent), null, { timeout: 5000 }).catch(() => {});
      const fileAt = backup.worlds.find((w) => w.id === changedId);
      let after = await game(B.page, async (id) => { const w = await window.__game.store.loadWorld(id); return { n: (await window.__game.store.listWorlds()).length, player: JSON.stringify(w.player), dialogs: document.querySelectorAll('.ks-conflict').length }; }, changedId);
      check(after.n === 2 && fileAt && after.player !== JSON.stringify(fileAt.player) && after.dialogs === 0, 'only one question (the unchanged world was skipped); "Keep the one here" kept hers');

      await openFile(backupFile);
      await B.page.waitForSelector('.sw-dialog.ks-conflict', { timeout: 5000 });
      await B.page.locator('.ks-conflict button', { hasText: 'Keep both' }).click();
      await B.page.waitForFunction(() => document.querySelectorAll('.sw-world').length === 3, null, { timeout: 5000 }).catch(() => {});
      after = await game(B.page, async () => (await window.__game.store.listWorlds()).map((w) => w.name).sort());
      check(after.length === 3 && after.includes('Rainbow Meadow (copy)'), `"Keep both": a copy (${after.join(', ')})`);

      await openFile(backupFile);
      await B.page.waitForSelector('.sw-dialog.ks-conflict', { timeout: 5000 });
      await B.page.locator('.ks-conflict button', { hasText: 'Use the one in the file' }).click();
      await B.page.waitForFunction(() => /Your worlds are back!/.test(document.querySelector('.sw-toasts').textContent), null, { timeout: 5000 }).catch(() => {});
      after = await game(B.page, async (id) => {
        const w = await window.__game.store.loadWorld(id);
        return { n: (await window.__game.store.listWorlds()).length, spawn: JSON.stringify(w.spawn), player: JSON.stringify(w.player) };
      }, changedId);
      check(after.n === 3 && fileAt && after.player === JSON.stringify(fileAt.player), '"Use the one in the file" put the file\'s world back');

      log('A single-world file that is already here');
      if (d1) {
        // the one-world file came from the first device; put that exact world here first
        const one = JSON.parse(await readFile(worldFile, 'utf8'));
        await game(B.page, async (save) => { await window.__game.store.saveWorld(save); }, one.save);
        const n0 = await game(B.page, async () => (await window.__game.store.listWorlds()).length);
        await game(B.page, () => window.__game.ui.open('worlds'));
        await openFile(worldFile);
        await B.page.waitForSelector('.sw-dialog.ks-conflict', { timeout: 5000 });
        const t = await B.page.locator('.ks-conflict').innerText();
        check(/They are just the same\./.test(t) && /Keep both/.test(t) && /OK/.test(t), 'it says "They are just the same." (OK / Keep both)');
        await B.page.locator('.ks-conflict button', { hasText: 'OK' }).click();
        await settle(B.page, 500);
        check((await game(B.page, async () => (await window.__game.store.listWorlds()).length)) === n0, 'OK: nothing added');
      }
      await B.context.close();

    }
    // -------------------------------------------------------------- 6. iPhone / iPad
    const backupText = await readFile(backupFile, 'utf8');
    const seed = async (page) => {
      await game(page, async (text) => { await window.__game.store.importAll(text, {}); }, backupText);
    };
    const touchCase = async ({ name, viewport, ua, persist = 'granted', standalone = false, touchPoints = null, expect, shots = [] }) => {
      log(`${name} (${viewport.width}x${viewport.height})`);
      const C = await open(browser, PLAY, { label: name, viewport, touch: touchPoints === null || touchPoints > 0, ua, persist, standalone, touchPoints });
      await seed(C.page);
      await ageBackup(C.page, 8);
      await reload(C.page);
      const shown = await cardShows(C.page, expect ? 4000 : 3500);
      check(shown === expect, `${name}: ${expect ? 'the card shows' : 'no card'}${persist === 'granted' ? ' (the browser says the storage is kept)' : ''}`);
      await noHomeScreenUi(C.page, name);
      for (const [vp, label] of shots) {
        if (vp) await C.page.setViewportSize(vp);
        await settle(C.page, 900);
        await shot(C.page, label);
      }
      if (shown && expect) {
        // the card pops in (software WebGL can make that slow here): measure it once it stands
        await C.page.waitForFunction(() => document.querySelector('.ks-card').getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 15000 }).catch(() => {});
        const r = await C.page.evaluate(() => {
          const c = document.querySelector('.ks-card').getBoundingClientRect();
          const bs = [...document.querySelectorAll('.ks-card button')].map((b) => b.getBoundingClientRect());
          return { inside: c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 0.5 && c.bottom <= innerHeight + 0.5, big: bs.every((b) => b.height >= 44 && b.width >= 44), at: [c.left, c.top, c.right, c.bottom, innerWidth, innerHeight].map(Math.round).join(','), bs: bs.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(' ') };
        });
        check(r.inside && r.big, `${name}: the card fits the screen and its buttons are big (card ${r.at}; buttons ${r.bs})`);
      }
      return C;
    };
    const ipad = await touchCase({ name: 'ipad', viewport: { width: 1024, height: 768 }, ua: UA.ipad, expect: true, shots: [[null, 'card-ipad-landscape'], [{ width: 768, height: 1024 }, 'card-ipad-portrait']] });
    check((await ksState(ipad.page)).diag.keepsafe.ios === true, 'ipad: diag says ios');
    await ipad.context.close();
    const iphone = await touchCase({ name: 'iphone', viewport: { width: 390, height: 844 }, ua: UA.iphone, expect: true, shots: [[null, 'card-iphone']] });
    // the conflict question on a phone
    await iphone.page.locator('.ks-card button', { hasText: 'Not now' }).tap();
    await game(iphone.page, () => window.__game.ui.open('worlds'));
    const chP = iphone.page.waitForEvent('filechooser');
    await game(iphone.page, async () => {
      const g = window.__game;
      const w = (await g.store.listWorlds())[0];
      const save = await g.store.loadWorld(w.id);
      save.updatedAt = Date.now();
      await g.store.saveWorld(save);
    });
    await iphone.page.locator('.sw-open-file').tap();
    await (await chP).setFiles(backupFile);
    await iphone.page.waitForSelector('.sw-dialog.ks-conflict', { timeout: 5000 });
    await settle(iphone.page, 600);
    await shot(iphone.page, 'conflict-iphone');
    const fitsP = await iphone.page.evaluate(() => {
      const c = document.querySelector('.ks-conflict').getBoundingClientRect();
      return c.left >= 0 && c.right <= innerWidth + 0.5 && c.top >= 0 && c.bottom <= innerHeight + 0.5 && document.documentElement.scrollWidth <= innerWidth;
    });
    check(fitsP, 'iphone: the question fits the screen');
    await iphone.page.locator('.ks-conflict button', { hasText: 'Keep the one here' }).tap();
    await iphone.context.close();
    const macPad = await touchCase({ name: 'ipados-as-mac', viewport: { width: 1180, height: 820 }, ua: UA.mac, touchPoints: 5, expect: true });
    await macPad.context.close();
    const app = await touchCase({ name: 'home-screen-app', viewport: { width: 1024, height: 768 }, ua: UA.ipad, standalone: true, expect: false });
    await app.context.close();
    const mac = await touchCase({ name: 'mac-safari', viewport: { width: 1280, height: 800 }, ua: UA.mac, touchPoints: 0, expect: false });
    await mac.context.close();
    const kept = await touchCase({ name: 'desktop-kept', viewport: { width: 1280, height: 800 }, ua: null, touchPoints: 0, expect: false });
    await kept.context.close();

    log('The browser\'s own answer (no stand-in): nothing throws');
    const R = await open(browser, PLAY, { label: 'real', persist: null });
    await game(R.page, () => window.__game.keepsafe.ready);
    s = await ksState(R.page);
    check(s.calls.persisted >= 1 && (s.state.persisted === true || s.state.persisted === false), `recorded the real answer (persisted: ${s.state.persisted})`);
    await R.context.close();

    // -------------------------------------------------------------- 7. file:// and claude.ai
    for (const [name, url, opts] of [['file', PAGE_URL, {}], ['claude-stand-in', PLAY, { claude: true }]]) {
      log(`${name}: nothing at all`);
      const X = await open(browser, url, { label: name, ...opts });
      await seed(X.page);
      await game(X.page, async () => {
        const g = window.__game;
        g.profile.keepsafe = { lastBackupAt: Date.now() - 8 * 86400000, snoozeUntil: 0 };
        await g.saveProfile(true);
      });
      await reload(X.page);
      check(!(await cardShows(X.page, 3500)), `${name}: no card`);
      s = await ksState(X.page);
      check(!s.active && s.calls.persist === 0 && s.calls.persisted === 0, `${name}: keepsafe off, persist() never called`);
      check(s.diag.keepsafe && s.diag.keepsafe.host === (name === 'file' ? 'file' : 'claude') && !('persisted' in s.diag.keepsafe), `${name}: diag says only where it runs`);
      await X.page.keyboard.press('Shift');
      await settle(X.page, 300);
      check((await ksState(X.page)).calls.persist === 0, `${name}: a key press asks nothing either`);
      await X.page.locator('.sw-title2 button', { hasText: 'My Worlds' }).click();
      await X.page.waitForSelector('.sw-panel-wrap.sw-open .sw-world');
      check((await X.page.locator('.sw-save-all').count()) === 0, `${name}: no "Save all"`);
      await noHomeScreenUi(X.page, name);
      await X.context.close();
    }
  } finally {
    await browser.close();
  }
}

// our server goes with us, whatever happens (a stray promise must not leave it running)
process.on('exit', stopServer);
process.on('unhandledRejection', (err) => errors.push('[probe] unhandled: ' + (err && err.stack ? err.stack : err)));
try {
  await run();
} catch (err) {
  errors.push('[probe] ' + (err && err.stack ? err.stack : err));
} finally {
  stopServer();
}
finish(errors);
process.exit(process.exitCode || 0);
