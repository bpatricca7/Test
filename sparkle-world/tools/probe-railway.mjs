// Railway end to end (docs/MULTIPLAYER.md Addendum A, docs/DEPLOY-RAILWAY.md):
//
//   node tools/probe-railway.mjs [--no-build] [--headed] [--shots-prefix=railway]
//
// 1. `npm run build`, then starts `server/server.mjs` as its own process on a random free
//    port (exactly what Railway runs: `npm start` with $PORT).
// 2. Three browser contexts open http://localhost:<port>/ (not claude.ai: no window.claude),
//    so the game finds GET /api/net and picks the WebSocket transport by itself.
// 3. Lily (desktop) makes a code through the real UI; Rosie (iPad, touch) and June (phone,
//    touch) type it on the keypad; Lily taps "Let in!" twice; they build together (blocks,
//    a real tap, furniture, a door opened by a friend) and every page must show the same
//    world (equal hashes).
// 4. The server is killed with SIGKILL mid-session and started again on the same port: the
//    pages show "Reconnecting…", come back by themselves (same peers, same session), keep
//    building and end equal again.
// 5. The server is killed for good: after about a minute the pages end the session with the
//    friendly "Playing together stopped." card (no crash); the host keeps her world.
// Zero console errors are allowed, apart from the browser's own "WebSocket connection ...
// failed" lines while the server is down (counted and printed).

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launch, waitForTitle, settle, finish, ROOT, SHOTS } from './smoke.mjs';
import {
  sleep, game, until, press, tapWorld, setupPage, trace, hostMakesCode, guestTypesCode, hostLetsIn, waitLive, bringTo,
  closePanels, converge,
} from './net/mp-flows.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const PREFIX = arg('shots-prefix', 'railway');
const errors = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
let wsNoise = 0;

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

// ---------- the server process ----------

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

function killServer() {
  if (!server) return;
  server.kill('SIGKILL');
  server = null;
}

// ---------- players ----------

const PLAYERS = [
  { key: 'lily', name: 'Lily', viewport: { width: 1280, height: 800 }, touch: false, seed: 11 },
  { key: 'rosie', name: 'Rosie', viewport: { width: 1024, height: 768 }, touch: true, seed: 29 },
  { key: 'june', name: 'June', viewport: { width: 390, height: 844 }, touch: true, seed: 47 },
];

async function openPlayer(browser, def, url) {
  const context = await browser.newContext({ viewport: def.viewport, hasTouch: def.touch, isMobile: def.touch, deviceScaleFactor: def.touch ? 2 : 1 });
  const page = await context.newPage();
  const label = def.key;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/fonts\.(googleapis|gstatic)\.com/.test(text)) return;
    // the browser's own line for a WebSocket that could not connect (the server is down)
    if (/WebSocket connection to 'ws:\/\/[^']+\/r\/sw1-[a-z-]+\?s=[A-Za-z0-9]+' failed/.test(text) || /ERR_CONNECTION_REFUSED/.test(text)) {
      wsNoise++;
      return;
    }
    errors.push(`[${label}] console.error: ${text}`);
  });
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(req.url())) return;
    errors.push(`[${label}] request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`);
  });
  await page.goto(url);
  await waitForTitle(page);
  const pl = { ...def, context, page };
  await setupPage(pl);
  return pl;
}

// ---------- the run ----------

async function main() {
  if (!arg('no-build')) {
    log('npm run build');
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  await startServer(port);
  const url = `http://localhost:${port}/`;
  log(`server up: ${url}`);
  const info = await (await fetch(`http://127.0.0.1:${port}/api/net`)).json();
  check(info.ok === true && typeof info.build === 'string', `/api/net answers ${JSON.stringify(info)}`);

  const browser = await launch({ headed: !!arg('headed') });
  try {
    const [lily, rosie, june] = [
      await openPlayer(browser, PLAYERS[0], url),
      await openPlayer(browser, PLAYERS[1], url),
      await openPlayer(browser, PLAYERS[2], url),
    ];
    for (const pl of [lily, rosie, june]) {
      const kind = await until(pl, () => window.__game.net.kind, null, 10000);
      check(kind === 'ws', `${pl.key}: the game picked the WebSocket transport by itself (${kind})`);
    }
    await until(lily, () => !document.querySelector('button.sw-title-friends').hidden, null, 10000);
    await settle(lily.page, 600);
    await shot(lily, 'title');

    // ----- Lily makes a code; Rosie and June join through the keypad -----
    log('Lily makes a code');
    const code = await hostMakesCode(lily, { log });
    check(code.length === 4, `code ${code.join(' ')}`);
    const where = await lily.page.locator('.sw-net-code .sw-net-note').textContent();
    check(where.includes(`localhost:${port}`), `the grown-ups' note names this website ("${where.trim()}")`);
    await shot(lily, 'code');
    for (const g of [rosie, june]) {
      log(`${g.name} joins`);
      await guestTypesCode(g, code);
      const small = await hostLetsIn(lily, g.name);
      check(small === '', `no account names on Railway (small print "${small}")`);
      check(await waitLive(g), `${g.name} is in Lily's world`);
      log(`  ${g.name}: ${await trace(g)}`);
    }
    await closePanels(lily);
    await bringTo(rosie, lily, 2.5, 3);
    await bringTo(june, lily, -2.5, 2.5);
    let c = await converge([lily, rosie, june]);
    check(c.ok, `everyone sees the same world after joining ${JSON.stringify(c.hash)} ${c.detail}`);

    // ----- build together -----
    log('building together');
    const spot = await game(lily, () => { const q = window.__game.player.position; return { x: Math.floor(q.x), y: Math.floor(q.y), z: Math.floor(q.z) }; });
    const door = await game(lily, ({ x, z }) => {
      const g = window.__game;
      for (let k = 0; k < 5; k++) g.placeBlock(x + 4 + k, g.world.heightAt(x + 4 + k, z - 4) + 1, z - 4, 'brick_pink');
      const h = g.world.heightAt(x - 4, z - 4);
      const e = g.entities.place('door', x - 4, h + 1, z - 4, 0, null, {});
      return e ? e.uid : 0;
    }, spot);
    await game(rosie, ({ x, z }) => {
      const g = window.__game;
      g.historyGroup(() => { for (let k = 0; k < 10; k++) g.placeBlock(x + k, g.world.heightAt(x + k, z + 6) + 1, z + 6, 'wool_sky'); });
      g.entities.place('bed_single', x + 3, g.world.heightAt(x + 3, z + 9) + 1, z + 9, 1, null, {});
    }, spot);
    // June: a real tap with the Build tool on the ground in front of her
    await game(june, () => { const g = window.__game; g.debug.select('block:wool_yellow'); g.setTool('build'); });
    const target = await game(june, () => { const g = window.__game, p = g.player.position; const x = Math.floor(p.x) + 2, z = Math.floor(p.z) - 2; return [x + 0.5, g.world.heightAt(x, z) + 1, z + 0.5, x, z]; });
    const before = await game(june, ([, , , x, z]) => window.__game.world.heightAt(x, z), target);
    await tapWorld(june, target.slice(0, 3), 0.7);
    const placed = await until(june, ([, , , x, z, h]) => window.__game.world.heightAt(x, z) > h, [...target, before], 5000);
    check(placed, 'June placed a block with a real tap');
    // Rosie opens Lily's door
    await game(rosie, (uid) => { const g = window.__game; g.setTool('hand'); return g.debug.interact(uid); }, door);
    c = await converge([lily, rosie, june]);
    check(c.ok, `everyone sees the same world after building ${JSON.stringify(c.hash)} ${c.detail}`);
    check(await game(lily, (uid) => window.__game.entities.byUid(uid)?.data?.open === true, door), 'Rosie opened Lily\'s door (open on Lily\'s page)');
    await game(rosie, () => window.__game.setTool('build'));
    await settle(rosie.page, 600);
    await shot(rosie, 'rosie-building');

    // ----- the server is killed mid-session and comes back -----
    log('kill -9 the server');
    killServer();
    const noise0 = wsNoise;
    const shown = await until(rosie, () => { const e = document.querySelector('.sw-net-pill'); return e && !e.hidden && /Reconnecting/.test(e.textContent); }, null, 15000, 200);
    check(shown, 'Rosie sees "Reconnecting…" while the server is gone');
    await shot(rosie, 'reconnecting');
    // she keeps building while offline (predicted, queued in her presence)
    await game(rosie, ({ x, z }) => {
      const g = window.__game;
      for (let k = 0; k < 4; k++) g.placeBlock(x + k, g.world.heightAt(x + k, z + 12) + 1, z + 12, 'glass');
    }, spot);
    await sleep(3000);
    log('start the server again');
    await startServer(port);
    const back = await until(rosie, () => { const e = document.querySelector('.sw-net-pill'); return e && e.hidden; }, null, 40000, 300);
    check(back, '"Reconnecting…" goes away by itself');
    for (const pl of [lily, rosie, june]) {
      const st = await until(pl, () => ['h.live', 'g.live'].includes(window.__game.net.state) ? window.__game.net.state : null, null, 60000);
      check(!!st, `${pl.key} is still playing together (${st})`);
    }
    await game(june, ({ x, z }) => {
      const g = window.__game;
      for (let k = 0; k < 4; k++) g.placeBlock(x - 3 - k, g.world.heightAt(x - 3 - k, z + 2) + 1, z + 2, 'wool_yellow');
    }, spot);
    c = await converge([lily, rosie, june], { timeout: 60000 });
    check(c.ok, `everyone sees the same world after the server came back ${JSON.stringify(c.hash)} ${c.detail}`);
    const glass = await game(lily, ({ x, z }) => [0, 1, 2, 3].every((k) => window.__game.debug.getBlock(x + k, window.__game.world.heightAt(x + k, z + 12), z + 12) === 'glass'), spot);
    check(glass, 'the blocks Rosie built while the server was down reached Lily');
    log(`  browser WebSocket connection lines while the server was down: ${wsNoise - noise0}`);
    const res = await Promise.all([rosie, june].map((pl) => game(pl, () => window.__game.debug.net.stats().resyncs)));
    log(`  resyncs after the restart: ${JSON.stringify(res)}`);

    // ----- the server goes away for good -----
    log('kill -9 the server for good');
    killServer();
    const t0 = Date.now();
    const guestCard = await until(rosie, () => window.__game.net.state === 'idle' && document.querySelector('.sw-net-msg') !== null ? document.querySelector('.sw-net-msg .sw-net-msg-text').textContent : null, null, 120000, 500);
    check(!!guestCard, `Rosie gets a friendly card after ${((Date.now() - t0) / 1000).toFixed(0)} s: "${guestCard}"`);
    const hostCard = await until(lily, () => window.__game.net.state === 'idle' && document.querySelector('.sw-net-msg') !== null ? document.querySelector('.sw-net-msg .sw-net-msg-text').textContent : null, null, 60000, 500);
    check(!!hostCard, `Lily gets a friendly card: "${hostCard}"`);
    check(await game(lily, () => window.__game.mode === 'play' && !!window.__game.world), 'Lily is still in her own world');
    const rosieMode = await game(rosie, () => window.__game.mode);
    check(rosieMode === 'title', `Rosie is back on her title screen (${rosieMode})`);
    await settle(rosie.page, 600);
    await shot(rosie, 'stopped-guest');
    await shot(lily, 'stopped-host');
    await shot(june, 'stopped-phone');
  } finally {
    await browser.close().catch(() => {});
    killServer();
  }
  log(`browser WebSocket connection lines while the server was down (not errors of the game): ${wsNoise}`);
  finish(errors);
}

main().catch((err) => {
  errors.push('[fatal] ' + (err && err.stack ? err.stack : err));
  killServer();
  finish(errors);
});
