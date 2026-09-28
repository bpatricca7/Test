// Walkie-talkie tests (docs/MULTIPLAYER.md Addendum C, docs/teams/walkie.md):
//
//   node tools/test-walkie.mjs [--unit-only] [--no-build] [--headed] [--shots-prefix=walkie]
//
// (a) Node unit tests (tools/test-walkie-unit.mjs): ADPCM round trip (SNR), resampler, frame
//     format, and the relay's floor / caps / limits / gating over the real room logic.
// (b) End to end through the REAL Railway server: `npm run build`, server/server.mjs on a
//     random PORT (with SW_TEST_STATS=1 for /api/stats), Chromium with a fake microphone and
//     three pages:
//       Lily  host, desktop 1280x800 (mouse)  walkie turned on by a grown-up (wrong, then right)
//       Rosie friend, iPad 1024x768 (touch)   walkie turned on by a grown-up
//       June  friend, phone 390x844 (touch)   walkie OFF (later turned on for the phone shots)
//     Lily holds the button 2 s: Rosie receives and schedules the audio, June receives ZERO
//     voice bytes (her page and the server's counters); the microphone track stops on
//     release; two presses at once: one talks, the other hears "busy"; the 15 s cap cuts a
//     long press; per-player Mute (a friend for herself, the host for everyone) and the host's
//     "Mute everyone". Zero console errors. Screenshots: the grown-up check, the HUD button
//     while talking (desktop, iPad, phone), the speaking badge, the Players panel controls.
//     Before the three pages: a stranger who guessed the code (the real net core and a raw
//     socket, copying a friend's device id into her presence) is never let in without a tap,
//     sees no names (the room's gate) and gets 0 voice bytes; a let-in page that hides its
//     walkie (no presence wk) gets 0 bytes;
//     the grown-up check's wait survives reloads; the playback chain keeps a full-scale blast
//     from clipping and close to the level of normal talking (an OfflineAudioContext render).

import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { waitForTitle, waitForPlay, waitIdle, settle, finish, ROOT, SHOTS, CHROMIUM, LAUNCH_ARGS, PAGE_URL } from './smoke.mjs';
import {
  sleep, game, until, press, setupPage, hostMakesCode, guestTypesCode, hostLetsIn, waitLive, bringTo, closePanels,
} from './net/mp-flows.mjs';
import { runUnit } from './test-walkie-unit.mjs';
import { NetSession } from '../src/net/session.js';
import { WsTransport } from '../src/net/ws-transport.js';
import { roomNameFor } from '../src/net/protocol.js';
import { FakeAdapter } from './net/fake-adapter.mjs';
import { W as WIRE, F_START, F_END, packFrame } from '../src/net/walkie/wire.js';
import { AdpcmEncoder, decodeAdpcm } from '../src/net/walkie/adpcm.js';
import { levelFrame, LIMITER, VOICE_GAIN, limiterTrim } from '../src/net/walkie/player.js';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const PREFIX = arg('shots-prefix', 'walkie');
const errors = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const numbers = {};
let passed = 0;

function check(cond, message) {
  if (cond) {
    passed++;
    console.log('    ok: ' + message);
  } else {
    console.log('    FAIL: ' + message);
    errors.push('[check] ' + message);
  }
  return !!cond;
}

async function shot(pl, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  // SwiftShader on a busy machine can take a while to paint a frame: wait longer, try twice
  for (let k = 0; k < 2; k++) {
    try {
      await pl.page.screenshot({ path: file, timeout: 60000 });
      console.log(`    screenshot ${path.relative(ROOT, file)}`);
      return;
    } catch (err) {
      console.log(`    (screenshot ${name} slow: ${String(err.message).split('\n')[0]})`);
      await sleep(2000);
    }
  }
  errors.push(`[shot] could not take ${name}`);
}

// ---------- the server ----------

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
  // server/server.mjs as its own program (exactly what `npm start` runs on Railway); its path
  // travels in the environment, so a `pkill -f server.mjs` by another tool on a shared machine
  // cannot stop this run's server halfway
  const main = path.join(ROOT, 'server', 'server.mjs');
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'process.argv[1] = process.env.SW_MAIN; await import(process.env.SW_MAIN_URL);'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SW_TEST_STATS: '1', SW_MAIN: main, SW_MAIN_URL: pathToFileURL(main).href },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, sig) => {
    if (server === child) errors.push(`[server] stopped by itself during the run (code ${code}, signal ${sig})`);
  });
  const lines = [];
  child.stdout.on('data', (d) => { lines.push(String(d)); process.stdout.write('    [server] ' + d); });
  child.stderr.on('data', (d) => { lines.push(String(d)); process.stdout.write('    [server!] ' + d); });
  child.lines = lines;
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) {
        server = child;
        return child;
      }
    } catch {}
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('the server did not start');
}

async function serverStats(port) {
  return (await fetch(`http://127.0.0.1:${port}/api/stats`)).json();
}

// ---------- pages ----------

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
    const where = (msg.location() && msg.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(text) || /fonts\.(googleapis|gstatic)\.com/.test(where)) return;
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

const W = (pl) => game(pl, () => window.__game.debug.walkie.state());
const WS = (pl) => game(pl, () => window.__game.debug.walkie.stats());

/** Turn the camera toward a friend's drawn avatar (for the speaking badge pictures). */
async function face(pl, name) {
  await until(pl, (n) => window.__game.net.remote.list().some((f) => f.name === n && f.visible), name, 6000, 100);
  await game(pl, (n) => {
    const g = window.__game;
    const f = g.net.remote.list().find((x) => x.name === n);
    if (!f) return;
    const q = g.player.position;
    g.cameraRig.yaw = Math.atan2(f.pos[0] - q.x, f.pos[2] - q.z);
    g.cameraRig.pitch = 0.25;
  }, name);
  await settle(pl.page, 500);
}

/** Players panel -> the Mute button on `peer`'s row (opens the panel if needed). */
async function tapMute(pl, peer) {
  const sel = `.sw-panel-wrap.sw-open .sw-net-row[data-peer="${peer}"] .sw-wk-mute`;
  for (let k = 0; k < 3; k++) {
    const open = await game(pl, () => window.__game.ui.current === 'mp-players');
    if (!open) await press(pl, '.sw-hud-tr button.sw-playersbtn');
    try {
      await pl.page.locator(sel).first().waitFor({ state: 'visible', timeout: 5000 });
      await settle(pl.page, 300);
      await press(pl, sel, { timeout: 5000 });
      return;
    } catch (err) {
      const why = await game(pl, (p) => ({ current: window.__game.ui.current, state: window.__game.net.state, rows: [...document.querySelectorAll('.sw-net-row')].map((r) => [r.dataset.peer, !!r.querySelector('.sw-wk-mute')]), want: p }), peer);
      console.log(`    (retry: Mute on ${peer} not ready: ${JSON.stringify(why)})`);
      await shot(pl, `debug-mute-${k}`);
    }
  }
  throw new Error(`${pl.key}: no Mute button for ${peer}`);
}

/** Center of the walkie button (page px). */
async function buttonCenter(pl) {
  const box = await pl.page.locator('.sw-wk:not([hidden]) .sw-wk-btn').boundingBox();
  if (!box) throw new Error(`${pl.key}: no walkie button`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Hold the walkie button (mouse or a real touch) and return a release function. */
async function hold(pl) {
  const c = await buttonCenter(pl);
  if (pl.touch) {
    const cdp = pl.cdp || (pl.cdp = await pl.context.newCDPSession(pl.page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 7 }] });
    return async () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await pl.page.mouse.move(c.x, c.y);
  await pl.page.mouse.down();
  return async () => pl.page.mouse.up();
}

/** Settings -> Walkie-talkie (grown-ups) -> the grown-up check: one wrong answer, then right. */
async function grownUpTurnsOn(pl, { wrongFirst = true, shotName = null, fromPause = false } = {}) {
  const p = pl.page;
  if (fromPause) {
    await press(pl, '.sw-hud-tr button[aria-label="Menu"]');
    await press(pl, '.sw-panel-wrap.sw-open button:has-text("Settings")');
  } else await press(pl, 'button.sw-tile:has-text("Settings")');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-wk-setrow');
  const row = p.locator('.sw-panel-wrap.sw-open .sw-wk-setrow');
  await row.scrollIntoViewIfNeeded();
  check((await row.locator('.sw-wk-switch').getAttribute('aria-checked')) === 'false', `${pl.name}: Settings shows "Walkie-talkie (grown-ups)", off`);
  await press(pl, row.locator('.sw-wk-switch'));
  await p.waitForSelector('.sw-gate .sw-gate-qtext');
  const typeAnswer = async (n) => {
    for (const d of String(n)) await press(pl, `.sw-gate .sw-gate-key[data-d="${d}"]`);
    await press(pl, '.sw-gate .sw-gate-ok');
  };
  const problem = async () => {
    const t = await p.locator('.sw-gate .sw-gate-qtext').textContent();
    const m = /(\d+)\s*×\s*(\d+)/.exec(t);
    return [Number(m[1]), Number(m[2])];
  };
  let [a, b] = await problem();
  check(a >= 13 && a <= 19 && b >= 6 && b <= 9, `${pl.name}: the grown-up check asks ${a} × ${b}`);
  if (wrongFirst) {
    await typeAnswer(a * b + 1);
    await until(pl, () => /Not quite/.test(document.querySelector('.sw-gate-msg')?.textContent || ''), null, 3000, 100);
    const msg = await p.locator('.sw-gate-msg').textContent();
    check(/Not quite/.test(msg), `${pl.name}: a wrong answer: "${msg}"`);
    check(!(await game(pl, () => window.__game.debug.walkie.state().enabled)), `${pl.name}: still off after a wrong answer`);
    [a, b] = await problem();
  }
  // show the answer half typed for the picture
  const ans = String(a * b);
  await press(pl, `.sw-gate .sw-gate-key[data-d="${ans[0]}"]`);
  await settle(p, 400);
  if (shotName) await shot(pl, shotName);
  for (const d of ans.slice(1)) await press(pl, `.sw-gate .sw-gate-key[data-d="${d}"]`);
  await press(pl, '.sw-gate .sw-gate-ok');
  const on = await until(pl, () => window.__game.debug.walkie.state().enabled && !document.querySelector('.sw-gate'), null, 5000, 100);
  check(!!on, `${pl.name}: the right answer turns the walkie on for this device`);
  const saved = await game(pl, () => window.__game.profile.settings.walkie);
  check(saved && saved.on === true && typeof saved.at === 'number', `${pl.name}: saved as profile.settings.walkie ${JSON.stringify(saved)}`);
  if (shotName) {
    await p.locator('.sw-panel-wrap.sw-open .sw-wk-setrow').scrollIntoViewIfNeeded();
    await settle(p, 500);
    await shot(pl, `settings-on-${pl.key}`);
  }
  await press(pl, '.sw-panel-wrap.sw-open .sw-close'); // back to the title / the pause menu
}

/** The first press explains the microphone: OK -> the browser grants (fake UI) -> ready. */
async function firstPressMicCard(pl, shotName = null) {
  const pre = await W(pl);
  check(!pre.micSeen, `${pl.name}: the microphone card was never shown on this device (browser permission: ${pre.micState})`);
  const release = await hold(pl);
  await sleep(150);
  await release();
  await pl.page.waitForSelector('.sw-wk-card', { timeout: 5000 });
  await settle(pl.page, 500);
  if (shotName) await shot(pl, shotName);
  check(true, `${pl.name}: the first press shows the microphone card`);
  await press(pl, '.sw-wk-card .sw-wk-card-ok');
  const ready = await until(pl, () => { const s = window.__game.debug.walkie.state(); return s.micState === 'ready' && s.micSeen; }, null, 8000, 100);
  check(!!ready, `${pl.name}: microphone allowed ("Ready! Hold the walkie button and talk.")`);
  const tracks = await game(pl, () => window.__game.debug.walkie.state().micLive);
  check(tracks === false, `${pl.name}: the permission check left no microphone open`);
}

// ---------- a stranger who guessed the code (Node: the real net core over the real server) ----------

async function strangerTests(port) {
  log('a stranger who guessed the code copies a friend\'s device id');
  const url = `ws://127.0.0.1:${port}`;
  const mk = (name, device, guest) => {
    const adapter = new FakeAdapter({ name, empty: !!guest, rand: Math.random });
    const session = new NetSession({
      adapter, build: 'test',
      transport: () => new WsTransport({ url, uid: device }),
      options: { compression: false, autoAdmit: false },
    });
    adapter.session = session;
    return { name, adapter, session };
  };
  const H = mk('Lily', 'lilyDeviceSecret00000001', false);
  const R = mk('Rosie', 'rosieDeviceSecret0000002', true);
  const knocks = [];
  H.session.on('knock', (k) => {
    knocks.push(k);
    if (knocks.length === 1 && k.name === 'Rosie') H.session.admit(k.peer); // the host taps "Let in!" for Rosie
  });
  const WSN = (await import('ws')).WebSocket;
  let X = null;
  try {
    check(await H.session.host(), 'Lily hosts (real NetSession over WsTransport)');
    await R.session.join(H.session.code);
    const end = Date.now() + 20000;
    while (R.session.state !== 'g.live' && Date.now() < end) await sleep(100);
    check(R.session.state === 'g.live', 'Rosie is let in with a tap');
    const ht = H.session.transport;
    const rt = R.session.transport;
    const hostPeer = ht.selfId();
    const rosiePeer = rt.selfId();
    const rosieUid = rt.peers().find((p) => p.self).uid;

    // the stranger: a raw socket in the same room (she guessed the code), no device secret
    X = { json: [], bin: 0, binBytes: 0, peers: new Map(), self: null, closed: null };
    X.ws = new WSN(`${url}/r/${roomNameFor(H.session.code)}?s=strangerSecret${Math.random().toString(36).slice(2)}xxxx`);
    X.ws.on('message', (d, isBinary) => {
      if (isBinary) {
        X.bin++;
        X.binBytes += d.length;
        return;
      }
      const f = JSON.parse(String(d));
      X.json.push(f);
      if (f.t !== 'p') return;
      if (f.self) X.self = f.self;
      if (f.reset) X.peers.clear();
      for (const e of f.j || []) X.peers.set(e.peer, { ...e.state, _by: e.by });
      for (const [p, patch] of f.u || []) {
        const st = X.peers.get(p) || {};
        for (const k in patch) if (patch[k] === null) delete st[k]; else st[k] = patch[k];
        X.peers.set(p, st);
      }
    });
    X.ws.on('close', (c) => (X.closed = c));
    X.send = (o) => X.ws.send(o instanceof Uint8Array ? o : JSON.stringify(o));
    const xEnd = Date.now() + 5000;
    while (!(X.self && X.peers.has(rosiePeer)) && Date.now() < xEnd) await sleep(50);
    const hs = X.peers.get(hostPeer);
    const rs = X.peers.get(rosiePeer);
    check(rs && (rs.uid === rosieUid || rs._by === rosieUid), `the stranger can read Rosie's device id (${rosieUid}) from the room`);
    // she knocks with Rosie's id and name, and says "walkie on" without any grown-up check
    X.send({ t: 's', patch: { v: hs.v, pv: hs.pv, r: 'g', uid: rosieUid, nm: 'Rosie', lk: '', kn: 1, zc: 0, ep: hs.ep, wk: 1 } });
    X.send({ t: 'v', k: 'on', h: hostPeer });
    const kEnd = Date.now() + 12000;
    while (Date.now() < kEnd && knocks.length < 2) await sleep(100);
    await sleep(500);
    const adm = X.peers.get(hostPeer)?.adm || [];
    check(!adm.some((e) => e[0] === X.self), `with Rosie's copied device id the stranger is NOT let in (host adm ${JSON.stringify(adm.map((e) => e[1]))})`);
    const card = knocks.find((k) => k.peer === X.self);
    check(!!card && card.uid !== rosieUid, `the host gets a normal knock card for her instead (its id is the room's stamp for her connection, ${card && card.uid}, never a presence value)`);
    check(!X.peers.get(rosiePeer)?.nm && !X.peers.get(hostPeer)?.nm && !X.json.some((f) => f.t === 'b'), 'before a "Let in!" the gate shows her no names and no messages');
    check(X.json.some((f) => f.t === 'v' && f.k === 'hi' && f.ok === false), 'the server does not count the stranger in the game (hi.ok false)');

    // Rosie's page says "voice on" but does not show it (no presence wk): the badge would say "walkie off"
    const hostJson = [];
    ht.voiceIn = (m) => { if (!(m instanceof ArrayBuffer)) hostJson.push(m); };
    let rBin = 0;
    rt.voiceIn = (m) => { if (m instanceof ArrayBuffer) rBin++; };
    ht.setState({ wk: 1 });
    ht.flushState();
    ht.sendVoice({ t: 'v', k: 'on', h: hostPeer });
    rt.sendVoice({ t: 'v', k: 'on', h: hostPeer });
    await sleep(400);
    const press = async () => {
      hostJson.length = 0;
      ht.sendVoice({ t: 'v', k: 'req' });
      await sleep(200);
      const enc = new AdpcmEncoder();
      for (let k = 0; k < 12; k++) {
        const e = enc.encode(new Int16Array(WIRE.FRAME_SAMPLES).map((_, i) => Math.round(6000 * Math.sin(i / 7))));
        ht.sendVoice(packFrame(k === 0 ? F_START : k === 11 ? F_END : 0, k, e.pred, e.index, e.data));
        await sleep(80);
      }
      await sleep(400);
      return hostJson.some((f) => f.k === 'go');
    };
    check(await press(), 'Lily talks (12 frames)');
    check(rBin === 0, `Rosie's page said "voice on" but shows "walkie off" (no wk): she received ${rBin} frames`);
    rt.setState({ wk: 1 });
    rt.flushState();
    await sleep(900);
    check(await press(), 'Lily talks again');
    check(rBin === 12, `with her walkie shown (wk:1), Rosie receives all ${rBin} frames`);
    check(X.bin === 0 && X.binBytes === 0, `the stranger received ${X.bin} voice frames (${X.binBytes} B)`);
    X.json.length = 0;
    X.send({ t: 'v', k: 'req' });
    await sleep(300);
    const no = X.json.find((f) => f.t === 'v' && (f.k === 'no' || f.k === 'go'));
    check(no && no.k === 'no' && no.why === 'group', `the stranger cannot talk (${JSON.stringify(no)})`);
    const st = await serverStats(port);
    const xp = st.voicePeers.find((p) => p.peer === X.self);
    check(xp && xp.bytesOut === 0, `server: 0 voice bytes sent to the stranger (${JSON.stringify(xp)})`);
    numbers.stranger = { knockCards: knocks.length, strangerFrames: X.bin, rosieFrames: rBin };
  } finally {
    try { X?.ws.close(); } catch {}
    await R.session.leave({ quiet: true }).catch(() => {});
    await H.session.leave({ quiet: true }).catch(() => {});
    await sleep(300);
  }
}

// ---------- the grown-up check's wait survives reloads ----------

async function gateReloadTest(browser, url) {
  log('the grown-up check: wrong answers are saved (a reload does not skip the wait)');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`[gate] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = (msg.location() && msg.location().url) || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(msg.text()) || /fonts\.(googleapis|gstatic)\.com/.test(where)) return; // web fonts (offline here), as in openPlayer
    errors.push(`[gate] console.error: ${msg.text()}`);
  });
  const pl = { key: 'gate', name: 'Gate', page, context, touch: false, seed: 5 };
  const openGate = async () => {
    await press(pl, 'button.sw-tile:has-text("Settings")');
    await page.waitForSelector('.sw-panel-wrap.sw-open .sw-wk-setrow');
    await press(pl, '.sw-panel-wrap.sw-open .sw-wk-setrow .sw-wk-switch');
    await page.waitForSelector('.sw-gate .sw-gate-qtext');
  };
  const wrong = async () => {
    const t = await page.locator('.sw-gate .sw-gate-qtext').textContent();
    const m = /(\d+)\s*×\s*(\d+)/.exec(t);
    for (const d of String(Number(m[1]) * Number(m[2]) + 1)) await press(pl, `.sw-gate .sw-gate-key[data-d="${d}"]`);
    await press(pl, '.sw-gate .sw-gate-ok');
    await sleep(200);
  };
  const reload = async () => {
    await page.reload();
    await waitForTitle(page);
    await page.waitForFunction(() => window.__game && window.__game.net && window.__game.net.available !== null, null, { timeout: 15000 });
  };
  try {
    await page.goto(url);
    await waitForTitle(page);
    await setupPage(pl);
    await page.waitForFunction(() => window.__game.net.available !== null, null, { timeout: 15000 });
    await openGate();
    await wrong();
    await wrong();
    const saved = await game(pl, () => window.__game.profile.settings.walkieWrong);
    check(saved && saved.n === 2, `2 wrong answers are saved at once (${JSON.stringify(saved)})`);
    await reload();
    await openGate();
    await wrong();
    const st = await game(pl, () => ({ lock: window.__game.profile.settings.walkieLock || 0, now: Date.now(), locked: !!document.querySelector('.sw-gate-key')?.disabled, msg: document.querySelector('.sw-gate-msg')?.textContent }));
    check(st.locked && st.lock - st.now > 50000, `2 wrong, a reload, 1 more: the pad waits (${Math.round((st.lock - st.now) / 1000)} s, "${st.msg}")`);
    await shot(pl, 'gate-wait');
    await reload();
    await openGate();
    await sleep(300);
    const again = await game(pl, () => ({ locked: !!document.querySelector('.sw-gate-key')?.disabled, enabled: window.__game.debug.walkie.state().enabled }));
    check(again.locked && !again.enabled, 'after another reload the pad still waits, and the walkie is still off');
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------- the playback chain's loudness (Chromium OfflineAudioContext) ----------

async function loudnessTest(browser) {
  log('playback loudness: a full-scale blast vs. normal talking');
  const rate = WIRE.RATE;
  const n = rate; // 1 s
  // what a modified page could send: a full-scale square wave, through the real codec and leveller
  const enc = new AdpcmEncoder();
  const blast = new Float32Array(n);
  let g = 1;
  for (let at = 0; at < n; at += WIRE.FRAME_SAMPLES) {
    const e = enc.encode(new Int16Array(WIRE.FRAME_SAMPLES).map((_, i) => ((at + i) % 16 < 8 ? 32767 : -32768)));
    const pcm = decodeAdpcm(e.data, e.pred, e.index, WIRE.FRAME_SAMPLES);
    const raw = pcm.slice();
    g = levelFrame(pcm, g);
    blast.set(pcm.subarray(0, Math.min(pcm.length, n - at)), at);
    if (at === 0) numbers.blastRawPeak = +Math.max(...raw.map(Math.abs)).toFixed(2);
  }
  // normal talking, about -20 dBFS (the leveller leaves it as it is)
  const speech = new Float32Array(n);
  for (let i = 0; i < n; i++) speech[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.05 * Math.sin((2 * Math.PI * 660 * i) / rate) + 0.03 * Math.sin((2 * Math.PI * 1320 * i) / rate);
  for (let at = 0, gs = 1; at < n; at += WIRE.FRAME_SAMPLES) gs = levelFrame(speech.subarray(at, at + WIRE.FRAME_SAMPLES), gs);
  // the raw blast without the leveller (what the old chain played)
  const rawBlast = new Float32Array(n).map((_, i) => (i % 16 < 8 ? 1 : -1));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const r = await page.evaluate(async ({ blast, speech, rawBlast, lim, trim, gain }) => {
      async function run(data, voiceChain) {
        const sr = 48000;
        const len = Math.ceil((data.length / 16000) * sr);
        const c = new OfflineAudioContext(1, len, sr);
        // the game's master (src/core/audio.js): gain 1 -> compressor -12 dB, 4:1
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 4;
        comp.connect(c.destination);
        const master = c.createGain();
        master.connect(comp);
        const bus = c.createGain();
        if (voiceChain) {
          bus.gain.value = gain;
          const l = c.createDynamicsCompressor();
          l.threshold.value = lim.threshold;
          l.knee.value = lim.knee;
          l.ratio.value = lim.ratio;
          l.attack.value = lim.attack;
          l.release.value = lim.release;
          const t = c.createGain();
          t.gain.value = trim;
          bus.connect(l);
          l.connect(t);
          t.connect(master);
        } else {
          bus.gain.value = 1.35; // the chain before (VOICE_GAIN 1.35, no limiter)
          bus.connect(master);
        }
        const buf = c.createBuffer(1, data.length, 16000);
        buf.getChannelData(0).set(data);
        const s = c.createBufferSource();
        s.buffer = buf;
        s.connect(bus);
        s.start();
        const out = (await c.startRendering()).getChannelData(0);
        let pk = 0;
        let ss = 0;
        const from = Math.floor(out.length / 4);
        for (let i = from; i < out.length; i++) {
          pk = Math.max(pk, Math.abs(out[i]));
          ss += out[i] * out[i];
        }
        return { peak: +pk.toFixed(3), rmsDb: +(10 * Math.log10(ss / (out.length - from))).toFixed(1) };
      }
      return {
        blastBefore: await run(rawBlast, false), speechBefore: await run(speech, false),
        blast: await run(blast, true), speech: await run(speech, true),
      };
    }, { blast: Array.from(blast), speech: Array.from(speech), rawBlast: Array.from(rawBlast), lim: LIMITER, trim: limiterTrim(), gain: VOICE_GAIN });
    numbers.loudness = r;
    const gap = r.blast.rmsDb - r.speech.rmsDb;
    const gapBefore = r.blastBefore.rmsDb - r.speechBefore.rmsDb;
    check(r.blast.peak < 1, `a full-scale blast no longer clips: peak ${r.blast.peak} (before: ${r.blastBefore.peak})`);
    check(gap <= 9, `a blast is at most ${gap.toFixed(1)} dB louder than normal talking (before: ${gapBefore.toFixed(1)} dB)`);
    check(Math.abs(r.speech.rmsDb - (r.speechBefore.rmsDb - 20 * Math.log10(1.35))) < 1.5, `normal talking keeps its level (${r.speech.rmsDb} dB; before ${r.speechBefore.rmsDb} dB with the old 1.35 gain)`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ---------- family accounts: the Family page's walkie switch (docs/ACCOUNTS.md §8.3, §8.4) ----------
// (1) the relay alone (voice.mjs + rooms.mjs): an account link carries `allowed`, is told
//     {k:'perm'}, and switching it off releases her floor at once; (2) through the real server
//     in this process with a fake `accounts` (tools/fake-accounts.mjs): a player whose grown-up
//     did not switch the walkie on gets 0 voice bytes and cannot talk; a switch turned off
//     mid-game reaches her within a second, even if her page keeps saying {k:'on'} with wk:1;
//     turned on again, the perm frame arrives and she hears and talks.

const voiceFrame = (seq) => packFrame(seq === 0 ? F_START : 0, seq & 0xffff, 0, 0, new Uint8Array(WIRE.FRAME_SAMPLES / 2).fill(0x35));

async function accountRelayUnit() {
  log('accounts: the voice relay alone (allowed, perm, setAllowed)');
  const { RoomRegistry } = await import('../server/rooms.mjs');
  const { VoiceRelay } = await import('../server/voice.mjs');
  let t = 1000;
  const registry = new RoomRegistry({ gate: true, now: () => t });
  const relay = new VoiceRelay({ registry, now: () => t });
  const room = 'sw1-heart-star-moon-cat';
  const mk = (peer, claims) => {
    const box = { json: [], bytes: 0 };
    registry.join(room, peer, () => {}, { by: 'd-' + peer, claims });
    box.link = relay.link(room, peer, { json: (f) => box.json.push(f), binary: (b) => ((box.bytes += b.length), true), kick: () => {} }, claims ? { walkie: claims.walkie } : undefined);
    return box;
  };
  const acct = (nickname, walkie) => ({ familyId: 'f-' + nickname, playerId: 'p-' + nickname, nickname, canHost: true, canBuild: true, walkie });
  const H = mk('host', acct('Lily', true));
  const R = mk('rosie', acct('Rosie', true));
  const J = mk('june', acct('June', false));
  const L = mk('legacy', null);
  check(JSON.stringify(H.json) === '[{"t":"v","k":"perm","walkie":1}]' && JSON.stringify(J.json) === '[{"t":"v","k":"perm","walkie":0}]' && L.json.length === 0, 'account links are told their walkie permission when made (legacy links: nothing, as before)');
  registry.handle(room, 'host', { t: 's', patch: { r: 'h', wk: 1, adm: [['rosie', 1], ['june', 2], ['legacy', 3]] } });
  for (const p of ['rosie', 'june', 'legacy']) registry.handle(room, p, { t: 's', patch: { r: 'g', wk: 1 } });
  check(registry.rooms.get(room).members.get('june').state.wk === undefined, "June's wk:1 was dropped by the room (no walkie switch)");
  for (const b of [H, R, J, L]) b.link.control({ k: 'on' });
  check(J.json.at(-1).k === 'hi' && J.json.at(-1).ok === false, 'June is not counted in the game for voice (hi ok:false)');
  let mark = H.json.length;
  H.link.control({ k: 'req' });
  check(H.json.slice(mark).some((f) => f.k === 'go'), 'Lily may talk');
  for (let k = 0; k < 5; k++) {
    t += 80;
    H.link.binary(voiceFrame(k));
  }
  check(R.bytes > 0 && L.bytes > 0 && J.bytes === 0, `Rosie and the legacy friend hear her (${R.bytes} B), June gets 0 bytes`);
  J.link.control({ k: 'req' });
  check(J.json.at(-1).k === 'no' && J.json.at(-1).why === 'off', "June cannot talk ('off')");
  // switched off in the middle of Lily's press: her floor goes at once
  t += 80;
  check(relay.setAllowed(H.link, false) === true, 'setAllowed(false) changes it');
  check(H.json.some((f) => f.k === 'cut' && f.why === 'off') && H.json.at(-1).k === 'perm' && H.json.at(-1).walkie === 0, "Lily's press is cut ('off') and her page is told perm 0");
  check(R.json.at(-1).k === 'talk' && R.json.at(-1).by === null, 'the others learn that nobody talks now');
  const before = R.bytes;
  H.link.control({ k: 'on' });
  H.link.control({ k: 'req' });
  for (let k = 5; k < 10; k++) {
    t += 80;
    H.link.binary(voiceFrame(k));
  }
  check(R.bytes === before && H.json.at(-1).k === 'no', `her page says on and req again and sends frames: nobody gets a byte (${R.bytes - before} B), she hears no`);
  check(relay.setAllowed(H.link, false) === false && relay.setAllowed(H.link, true) === true && H.json.at(-1).walkie === 1, 'on again: perm 1');
  t += 3000;
  H.link.control({ k: 'on' });
  mark = H.json.length;
  H.link.control({ k: 'req' });
  check(H.json.slice(mark).some((f) => f.k === 'go'), 'she may talk again');
  check(relay.stats().revoked === 1, 'counted');
  for (const b of [H, R, J, L]) b.link.close();
  relay.stop();
}

async function accountServerVoice() {
  log('accounts: the walkie switch through the real server (fake accounts in this process)');
  const { createServer } = await import('../server/server.mjs');
  const { createFakeAccounts } = await import('./fake-accounts.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const WSN = (await import('ws')).WebSocket;
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-walkie-acct-'));
  const page = path.join(dir, 'page.html');
  writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
  const fake = await createFakeAccounts({ mode: 'required' });
  const app = createServer({ accounts: fake, htmlPath: page, siteDir: path.join(dir, 'none'), log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  const room = 'sw1-heart-star-moon-cat';
  const open = (cookie, p, name) => new Promise((resolve) => {
    const box = { name, json: [], bytes: 0, lastByteAt: 0, self: null, closed: null };
    box.ws = new WSN(`ws://127.0.0.1:${port}/r/${room}?s=${name}-secret-00000000000&d=${name}-device-0000000000&p=${p}`, { headers: { Cookie: cookie } });
    box.ws.on('message', (d, bin) => {
      if (bin) {
        box.bytes += d.length;
        box.lastByteAt = Date.now();
        return;
      }
      const f = JSON.parse(d.toString());
      if (f.t === 'p' && f.self) box.self = f.self;
      box.json.push(f);
    });
    box.ws.on('close', (c) => (box.closed = c));
    box.ws.on('error', () => {});
    box.ws.on('open', () => resolve(box));
  });
  const send = (b, f) => b.ws.send(JSON.stringify(f));
  const waitUntil = async (cond, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(20);
    return cond();
  };
  const fams = ['Lily', 'Rosie', 'June'].map((n) => {
    const f = fake.addFamily({ plan: 'active', consent: 'verified' });
    const p = fake.addPlayer(f, { nickname: n, friends: true, walkie: n !== 'June' });
    return { f, p, s: fake.addSession(f, { kind: 'device' }) };
  });
  const [lily, rosie, june] = await Promise.all(fams.map((x, k) => open(x.s.cookie, x.p, ['lily', 'rosie', 'june'][k])));
  let talking = null;
  try {
    await waitUntil(() => lily.self && rosie.self && june.self);
    send(lily, { t: 's', patch: { v: 1, r: 'h', nm: 'Lily', wk: 1, adm: [[rosie.self, 1], [june.self, 2]] } });
    for (const b of [rosie, june]) send(b, { t: 's', patch: { v: 1, r: 'g', nm: b.name, wk: 1 } });
    await sleep(200);
    for (const b of [lily, rosie, june]) send(b, { t: 'v', k: 'on' });
    await sleep(200);
    send(lily, { t: 'v', k: 'req' });
    check(await waitUntil(() => lily.json.some((f) => f.t === 'v' && f.k === 'go')), 'Lily (walkie switched on by her grown-up) may talk');
    let seq = 0;
    talking = setInterval(() => {
      if (lily.ws.readyState === 1) lily.ws.send(voiceFrame(seq++));
    }, 80);
    check(await waitUntil(() => rosie.bytes > 3000), `Rosie hears her (${rosie.bytes} B)`);
    check(june.bytes === 0, "June (her grown-up's switch is off) gets 0 voice bytes, although her page said on and wk:1");
    // Rosie's grown-up switches the walkie off on the Family page, while Lily talks and Rosie's
    // page keeps saying "on" with its badge
    const nag = setInterval(() => {
      send(rosie, { t: 'v', k: 'on' });
      send(rosie, { t: 's', patch: { wk: 1 } });
    }, 100);
    const t0 = Date.now();
    fake.setPlayer(fams[1].p, { walkie: false });
    const told = await waitUntil(() => rosie.json.some((f) => f.t === 'v' && f.k === 'perm' && f.walkie === 0), 2000);
    const permMs = Date.now() - t0;
    await sleep(1500);
    clearInterval(nag);
    const lateMs = rosie.lastByteAt - t0;
    check(told && permMs < 1000, `Rosie's page is told perm 0 in ${permMs} ms`);
    check(lateMs < 1000, `no voice byte reaches Rosie later than 1 s after the switch (the last one ${lateMs} ms after)`);
    const bytesAfter = rosie.bytes;
    await sleep(500);
    check(rosie.bytes === bytesAfter, 'and none at all afterwards, although her page keeps saying on and wk:1');
    send(rosie, { t: 'v', k: 'req' });
    check(await waitUntil(() => rosie.json.filter((f) => f.t === 'v' && f.k === 'no').some((f) => f.why === 'off')), "she cannot talk ('off')");
    const badge = () => {
      let st = null;
      for (const f of lily.json) {
        if (f.t !== 'p') continue;
        for (const e of f.j || []) if (e.peer === rosie.self) st = { ...e.state };
        for (const [pp, patch] of f.u || []) if (pp === rosie.self) {
          st = { ...(st || {}) };
          for (const k in patch) patch[k] === null ? delete st[k] : (st[k] = patch[k]);
        }
      }
      return st;
    };
    check(badge() && badge().wk === undefined, 'Lily sees "walkie off" on Rosie (no wk in her presence)');
    // on again: the perm frame arrives, her page says on and shows the badge, she hears
    fake.setPlayer(fams[1].p, { walkie: true });
    check(await waitUntil(() => rosie.json.filter((f) => f.t === 'v' && f.k === 'perm').at(-1)?.walkie === 1, 2000), 'switched on again: perm 1 arrives');
    send(rosie, { t: 's', patch: { wk: 1 } });
    send(rosie, { t: 'v', k: 'on' });
    const b0 = rosie.bytes;
    check(await waitUntil(() => rosie.bytes > b0 + 2000, 3000), `she hears Lily again (${rosie.bytes - b0} B)`);
    clearInterval(talking);
    talking = null;
    send(lily, { t: 'v', k: 'end' });
    await sleep(300);
    // Rosie talks now; switched off mid-press, her floor is released at once
    let mark = rosie.json.length;
    send(rosie, { t: 'v', k: 'req' });
    check(await waitUntil(() => rosie.json.slice(mark).some((f) => f.t === 'v' && f.k === 'go'), 3000), 'Rosie may talk');
    let rs = 0;
    const rTalk = setInterval(() => rosie.ws.readyState === 1 && rosie.ws.send(voiceFrame(rs++)), 80);
    await waitUntil(() => lily.bytes > 1500);
    fake.setPlayer(fams[1].p, { walkie: false });
    check(await waitUntil(() => rosie.json.some((f) => f.t === 'v' && f.k === 'cut' && f.why === 'off'), 1000), "her press is cut ('off') within a second");
    check(await waitUntil(() => lily.json.filter((f) => f.t === 'v' && f.k === 'talk').at(-1)?.by === null, 1000), 'Lily learns nobody talks');
    await sleep(300);
    const lb = lily.bytes;
    await sleep(600);
    clearInterval(rTalk);
    check(lily.bytes === lb, 'nothing more of Rosie reaches Lily');
    const st = app.stats();
    numbers.accountWalkie = { permMs, lastByteAfterMs: lateMs, revoked: st.voice.revoked, walkieChanged: st.walkieChanged };
  } finally {
    if (talking) clearInterval(talking);
    for (const b of [lily, rosie, june]) b.ws.terminate();
    await app.close();
  }
}

// ---------- the run ----------

async function main() {
  // (a) unit
  log('unit tests');
  const unit = await runUnit({ check, log });
  numbers.snr = unit.snr;
  numbers.codecBytesPerSecond = unit.bytesPerSecond;
  // with family accounts (Node only: the relay alone, then the real server in this process)
  await accountRelayUnit();
  await accountServerVoice();
  if (arg('unit-only')) return;

  // (b) end to end
  if (!arg('no-build')) {
    log('npm run build');
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  await startServer(port);
  const url = `http://localhost:${port}/play`; // the home page is at /, the game at /play
  log(`server up: ${url}`);
  const head = await fetch(url, { method: 'HEAD' });
  const pp = head.headers.get('permissions-policy') || '';
  check(/microphone=\(self\)/.test(pp) && /camera=\(\)/.test(pp) && /geolocation=\(\)/.test(pp), `Permissions-Policy: "${pp}" (microphone for this site only; camera and the rest off)`);
  await strangerTests(port);

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: !arg('headed'),
    args: [...LAUNCH_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    await loudnessTest(browser);
    await gateReloadTest(browser, url);

    // ----- where the walkie must not exist: alone from a file, inside claude.ai -----
    log('no walkie alone (file://) or inside claude.ai (room transport)');
    for (const [label, where, init] of [
      ['alone (file://)', PAGE_URL, null],
      // a stand-in for claude.ai's window.claude: the game picks the room transport
      ['claude.ai', url, () => { window.claude = { use: async (n) => (n === 'room' ? { join: async () => { throw Object.assign(new Error('no'), { code: 'not_permitted' }); } } : null) }; }],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage();
      page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
      await page.goto(where);
      await waitForTitle(page);
      await page.waitForFunction(() => window.__game.net.available !== null, null, { timeout: 15000 });
      const pl = { key: label, touch: false, page, context: ctx };
      await press(pl, 'button.sw-tile:has-text("Settings")');
      await page.waitForSelector('.sw-panel-wrap.sw-open .sw-set-row');
      const r = await page.evaluate(() => ({
        kind: window.__game.net.kind, row: !!document.querySelector('.sw-wk-setrow'),
        exists: window.__game.debug.walkie.state().exists, btn: !document.querySelector('.sw-wk').hidden,
      }));
      check(!r.row && !r.exists && !r.btn, `${label}: transport ${r.kind}, no walkie (no Settings row, no button)`);
      await ctx.close();
    }

    // ----- alone on the Railway site (/play): only the grown-ups' Settings row (so a grown-up
    // can turn it on before a game); in a world alone no button, no badge, no microphone, and
    // M does nothing until a code is live -----
    log('alone at /play: the Settings row only');
    {
      const solo = await openPlayer(browser, { key: 'solo', name: 'Poppy', viewport: { width: 1280, height: 800 }, touch: false, seed: 53 }, url);
      const kind = await until(solo, () => window.__game.net.kind, null, 10000);
      check(kind === 'ws', `alone at /play: WebSocket transport (${kind})`);
      await grownUpTurnsOn(solo, { wrongFirst: false });
      await press(solo, 'button.sw-btn:has-text("New World")');
      await solo.page.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
      await press(solo, '.sw-panel-wrap.sw-open .sw-biome[data-biome="flat"]');
      await press(solo, 'button.sw-create');
      await waitForPlay(solo.page);
      await waitIdle(solo.page);
      await settle(solo.page, 500);
      await solo.page.keyboard.down('m');
      await sleep(900);
      const r = await game(solo, () => {
        const s = window.__game.debug.walkie.state();
        const shown = (sel) => !!document.querySelector(sel) && !document.querySelector(sel).hidden;
        return { mode: window.__game.mode, enabled: s.enabled, live: s.live, show: s.view.show, talk: s.talk, micLive: s.micLive, micSeen: s.micSeen, card: !!document.querySelector('.sw-wk-card'), btn: shown('.sw-wk'), off: shown('.sw-wk-off') };
      });
      await solo.page.keyboard.up('m');
      const tx = (await WS(solo)).tx;
      check(r.mode === 'play' && r.enabled && !r.live, `alone at /play in a world: walkie on for this device, nothing live (${JSON.stringify(r)})`);
      check(!r.btn && !r.off && r.show === null, 'alone at /play: no walkie button, no "Walkie off" badge');
      check(r.talk === 'idle' && !r.micLive && !r.micSeen && !r.card && tx.presses === 0, `alone at /play: holding M does nothing (talk ${r.talk}, no microphone card, microphone never live, ${tx.presses} presses)`);
      await solo.context.close();
    }

    const [lily, rosie, june] = [
      await openPlayer(browser, PLAYERS[0], url),
      await openPlayer(browser, PLAYERS[1], url),
      await openPlayer(browser, PLAYERS[2], url),
    ];
    const all = [lily, rosie, june];
    for (const pl of all) {
      const kind = await until(pl, () => window.__game.net.kind, null, 10000);
      check(kind === 'ws', `${pl.key}: WebSocket transport (${kind})`);
    }

    // ----- grown-ups turn the walkie on (Lily, Rosie); June's stays off -----
    log('grown-up checks');
    await grownUpTurnsOn(lily, { shotName: 'gate-desktop' });
    await grownUpTurnsOn(rosie, { shotName: 'gate-ipad' });
    check(!(await W(june)).enabled, 'June: walkie off (no grown-up check)');

    // ----- no walkie before playing together -----
    for (const pl of all) {
      const ui = await game(pl, () => ({ btn: !!document.querySelector('.sw-wk') && !document.querySelector('.sw-wk').hidden, off: !!document.querySelector('.sw-wk-off') && !document.querySelector('.sw-wk-off').hidden }));
      check(!ui.btn && !ui.off, `${pl.key}: no walkie UI before playing together`);
    }

    // ----- a game together -----
    log('Lily makes a code');
    const code = await hostMakesCode(lily, { log });
    check(code.length === 4, `code ${code.join(' ')}`);
    for (const g of [rosie, june]) {
      await guestTypesCode(g, code);
      await hostLetsIn(lily, g.name);
      check(await waitLive(g), `${g.name} is in Lily's world`);
    }
    await closePanels(lily);
    await bringTo(rosie, lily, 2.5, 3);
    await bringTo(june, lily, -2.5, 2.5);
    // everyone faces Lily (for the speaking badge)
    for (const pl of [rosie, june]) {
      await game(pl, () => {
        const g = window.__game;
        const me = g.debug.net.players().find((p) => p.host);
        const q = g.player.position;
        if (me && me.pos) {
          g.cameraRig.yaw = Math.atan2(me.pos[0] - q.x, me.pos[2] - q.z);
          g.cameraRig.pitch = 0.25;
        }
      });
    }
    await game(lily, () => {
      const g = window.__game;
      const r = g.debug.net.players().find((p) => !p.you && p.name === 'Rosie');
      const q = g.player.position;
      if (r && r.pos) {
        g.cameraRig.yaw = Math.atan2(r.pos[0] - q.x, r.pos[2] - q.z);
        g.cameraRig.pitch = 0.25;
      }
    });

    // walkie UI only where it belongs
    const shown = async (pl) => until(pl, () => !document.querySelector('.sw-wk').hidden, null, 8000, 150);
    check(!!(await shown(lily)), 'Lily (host, walkie on): the walkie button is in the HUD');
    check(!!(await shown(rosie)), 'Rosie (walkie on): the walkie button is in the HUD');
    const juneUI = await until(june, () => ({ btn: !document.querySelector('.sw-wk').hidden, off: !document.querySelector('.sw-wk-off').hidden }), null, 1000);
    const juneBadge = await until(june, () => !document.querySelector('.sw-wk-off').hidden, null, 8000, 150);
    check(!juneUI.btn && !!juneBadge, `June (walkie off): no walkie button, only the small "Walkie off" badge`);
    await settle(june.page, 400);
    await shot(june, 'hud-walkie-off-phone');
    const inGame = await until(rosie, () => window.__game.debug.walkie.state().inGame, null, 8000, 150);
    check(!!inGame, 'Rosie: the server counts her in Lily\'s game (voice on)');
    check(!(await W(june)).declared, 'June never told the server "voice on"');

    // ----- first press: the microphone card -----
    log('first presses: the microphone card');
    await firstPressMicCard(lily, 'mic-card-desktop');
    await firstPressMicCard(rosie, 'mic-card-ipad');

    // ----- Lily talks 2 s -----
    log('Lily holds the walkie 2 s');
    const juneBefore = await WS(june);
    const rosieBefore = await WS(rosie);
    const lilyBefore = await WS(lily);
    const sBefore = await serverStats(port);
    let release = await hold(lily);
    const t0 = Date.now();
    const talking = await until(lily, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    check(!!talking, 'Lily: talking (the server gave her the walkie)');
    const micOn = await until(lily, () => window.__game.debug.walkie.state().micLive, null, 3000, 50);
    check(!!micOn, 'Lily: the microphone is open while she holds the button');
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    const rosieSees = await until(rosie, () => {
      const s = window.__game.debug.walkie.state();
      const b = document.querySelector('.sw-wk-speak:not([hidden])');
      return s.view.state === 'busy' && b ? document.querySelector('.sw-wk-label').textContent : null;
    }, null, 3000, 100);
    check(/Lily is talking/.test(rosieSees || ''), `Rosie sees "${rosieSees}" and a speaking badge over Lily`);
    await sleep(Math.max(0, 2000 - (Date.now() - t0)));
    await release();
    const held = Date.now() - t0;
    const off = await until(lily, () => {
      const s = window.__game.debug.walkie.state();
      return s.talk === 'idle' && !s.micLive && s.micTracks.length > 0 && s.micTracks.every((x) => x === 'ended') ? s.micTracks : null;
    }, null, 2000, 20);
    check(!!off, `Lily let go: every microphone track stopped at once (${JSON.stringify(off)})`);
    await sleep(800);
    const lilyAfter = await WS(lily);
    const rosieAfter = await WS(rosie);
    const juneAfter = await WS(june);
    const sAfter = await serverStats(port);
    const txBytes = lilyAfter.tx.bytes - lilyBefore.tx.bytes;
    const txFrames = lilyAfter.tx.frames - lilyBefore.tx.frames;
    const rxFrames = rosieAfter.rx.frames - rosieBefore.rx.frames;
    const scheduled = rosieAfter.player.scheduled - rosieBefore.player.scheduled;
    const samples = rosieAfter.player.samples - rosieBefore.player.samples;
    numbers.press2s = { heldMs: held, txFrames, txBytes, rxFrames, scheduled, secondsScheduled: +(samples / 16000).toFixed(2) };
    numbers.bytesPerSecondPerTalker = Math.round(txBytes / ((lilyAfter.tx.samples - lilyBefore.tx.samples) / 16000));
    check(txFrames >= 18, `Lily sent ${txFrames} frames (${txBytes} B) in a ${held} ms press`);
    check(rxFrames >= txFrames - 1 && scheduled >= txFrames - 2, `Rosie received ${rxFrames} frames and scheduled ${scheduled} buffers (${(samples / 16000).toFixed(2)} s of voice)`);
    check(rosieAfter.player.bursts > rosieBefore.player.bursts, 'Rosie heard the squelch and the press as one burst');
    check(juneAfter.rx.frames === juneBefore.rx.frames && juneAfter.rx.bytes === 0, `June (walkie off) received ZERO voice bytes (${juneAfter.rx.bytes} B, ${juneAfter.rx.frames} frames)`);
    const juneId = await game(june, () => window.__game.net.session.transport.selfId());
    const rosieId = await game(rosie, () => window.__game.net.session.transport.selfId());
    const lilyId = await game(lily, () => window.__game.net.session.transport.selfId());
    const jp = sAfter.voicePeers.find((x) => x.peer === juneId);
    const rp = sAfter.voicePeers.find((x) => x.peer === rosieId);
    check(!!jp && jp.bytesOut === 0 && jp.framesOut === 0 && jp.on === false, `server: 0 voice bytes sent to June (${JSON.stringify(jp)})`);
    check(!!rp && rp.bytesOut > 0, `server: ${rp && rp.bytesOut} voice bytes relayed to Rosie`);
    const relayed = sAfter.voice.bytesRelayed - sBefore.voice.bytesRelayed;
    check(relayed === txBytes, `server relayed exactly Lily's ${txBytes} B once (to Rosie only): ${relayed} B`);
    numbers.serverAfterFirstPress = { framesIn: sAfter.voice.framesIn, bytesIn: sAfter.voice.bytesIn, bytesRelayed: sAfter.voice.bytesRelayed };

    // ----- pictures while Lily talks -----
    await face(rosie, 'Lily');
    await sleep(400);
    release = await hold(lily);
    await until(lily, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    await sleep(1200);
    await shot(lily, 'hud-talking-desktop');
    await shot(rosie, 'speaking-badge-ipad');

    // ----- someone presses while Lily talks -----
    log('Rosie presses while Lily talks');
    await until(rosie, () => window.__game.debug.walkie.state().floorBy !== null, null, 3000, 50);
    const rb = await WS(rosie);
    const rRelease = await hold(rosie);
    const busy = await until(rosie, () => /Lily is talking/.test(document.querySelector('.sw-wk-label').textContent) ? document.querySelector('.sw-wk-label').textContent : null, null, 3000, 50);
    const ra = await WS(rosie);
    check(!!busy && ra.tx.busy > rb.tx.busy, `Rosie presses while Lily talks: "${busy}" and a busy boop`);
    check((await W(rosie)).talk === 'idle' && !(await W(rosie)).micLive, 'Rosie\'s microphone never opened (Lily has the walkie)');
    await rRelease();
    await sleep(400);
    await release();
    await sleep(1200);

    // ----- two press at the same moment: the server picks one -----
    log('Lily and Rosie press at the same moment');
    const s2a = await serverStats(port);
    const [relL, relR] = await Promise.all([hold(lily), hold(rosie)]);
    await sleep(1500);
    const both = [await W(lily), await W(rosie)];
    const talkers = both.filter((x) => x.talk === 'talking').length;
    const s2b = await serverStats(port);
    const refused = (s2b.voice.busy - s2a.voice.busy) + ((await WS(lily)).tx.busy + (await WS(rosie)).tx.busy);
    check(talkers === 1, `exactly one of them talks (${both.map((x) => x.talk).join(' / ')})`);
    check(refused > 0 && both.filter((x) => x.micLive).length === 1, `the other one heard "busy" (server busy answers: ${s2b.voice.busy - s2a.voice.busy}) and has no microphone open`);
    await relL();
    await relR();
    await sleep(1200);
    // the exact same millisecond (scheduled in both pages): the server decides, one gets "busy"
    const s3a = await serverStats(port);
    const at = await game(lily, () => Date.now() + 700);
    await Promise.all([lily, rosie].map((pl) => game(pl, (t) => { setTimeout(() => window.__game.debug.walkie.press('race'), Math.max(0, t - Date.now())); }, at)));
    await sleep(2200);
    const tie = [await W(lily), await W(rosie)];
    const s3b = await serverStats(port);
    const tieBusy = s3b.voice.busy - s3a.voice.busy;
    const tieGrants = s3b.voice.grants - s3a.voice.grants;
    // a busy SwiftShader page may run its timer a frame late; then her page already knows who
    // talks and refuses by itself (no request at all); either way the server granted ONE press
    check(tie.filter((x) => x.talk === 'talking').length === 1 && tieGrants === 1, `a tie at the same millisecond: one talks (${tie.map((x) => x.talk).join(' / ')}), the server granted exactly one press and answered "busy" ${tieBusy} time(s) (the other page refused by itself when it already knew)`);
    numbers.tie = { serverBusy: tieBusy, serverGrants: tieGrants };
    check(tie.filter((x) => x.micLive).length === 1, 'only the talker\'s microphone is open');
    for (const pl of [lily, rosie]) await game(pl, () => window.__game.debug.walkie.release('race'));
    await sleep(1200);

    // ----- Rosie talks (iPad); Lily hears -----
    log('Rosie talks from the iPad');
    await face(lily, 'Rosie');
    const lb = await WS(lily);
    release = await hold(rosie);
    await until(rosie, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    await sleep(1200);
    await shot(rosie, 'hud-talking-ipad');
    const lilySees = await until(lily, () => document.querySelector('.sw-wk-speak:not([hidden])') ? document.querySelector('.sw-wk-label').textContent : null, null, 3000, 100);
    check(/Rosie is talking/.test(lilySees || ''), `Lily sees "${lilySees}" with a badge over Rosie`);
    await shot(lily, 'speaking-badge-desktop');
    await sleep(300);
    await release();
    await sleep(900);
    const la = await WS(lily);
    check(la.player.scheduled - lb.player.scheduled >= 15, `Lily heard Rosie (${la.player.scheduled - lb.player.scheduled} buffers)`);
    check(!(await W(rosie)).micLive, 'Rosie let go: her microphone is off');

    // ----- the 15 s cap -----
    log('a long press: the 15 s cap');
    const capBefore = await WS(rosie);
    const capTx0 = await WS(lily);
    release = await hold(lily);
    await until(lily, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    const capStart = Date.now();
    await sleep(13000);
    const secsLeft = await game(lily, () => document.querySelector('.sw-wk-secs').textContent);
    check(Number(secsLeft) >= 1 && Number(secsLeft) <= 4, `the ring counts down (${secsLeft} s left after 13 s)`);
    await shot(lily, 'hud-countdown-desktop');
    const capped = await until(lily, () => window.__game.debug.walkie.state().talk === 'capped', null, 5000, 50);
    const capAt = Date.now() - capStart;
    check(!!capped, `the press was cut at ${(capAt / 1000).toFixed(1)} s while the button was still held`);
    check(!(await W(lily)).micLive, 'the microphone closed at the cap');
    await sleep(300);
    await shot(lily, 'hud-capped-desktop');
    await release();
    await sleep(900);
    const capAfter = await WS(rosie);
    const capTx1 = await WS(lily);
    const capSecs = (capTx1.tx.samples - capTx0.tx.samples) / 16000;
    check(capSecs <= 15.01 && capSecs >= 14.3, `Lily sent ${capSecs.toFixed(2)} s of voice in that press (15 s cap)`);
    check((capAfter.player.samples - capBefore.player.samples) / 16000 <= 15.01, `Rosie played ${((capAfter.player.samples - capBefore.player.samples) / 16000).toFixed(2)} s`);
    check((await W(lily)).talk === 'idle', 'after letting go the walkie is ready again');

    // ----- mutes -----
    log('mutes');
    // the Players panel must stay put while nothing changes (a redraw could swallow a tap)
    await press(rosie, '.sw-hud-tr button.sw-playersbtn');
    await rosie.page.waitForSelector('.sw-panel-wrap.sw-open .sw-net-players-body .sw-net-row');
    await sleep(1200);
    const redraws = await game(rosie, async () => {
      const body = document.querySelector('.sw-panel-wrap.sw-open .sw-net-players-body');
      let n = 0;
      const mo = new MutationObserver((recs) => { n += recs.length; });
      mo.observe(body, { childList: true });
      await new Promise((r) => setTimeout(r, 3000));
      mo.disconnect();
      return n;
    });
    check(redraws === 0, `the open Players panel does not redraw by itself (${redraws} changes in 3 s)`);
    // Rosie mutes Lily for herself (Players panel)
    await tapMute(rosie, lilyId);
    await settle(rosie.page, 400);
    await shot(rosie, 'players-guest-muted-lily');
    await closePanels(rosie);
    const m0 = await WS(rosie);
    const s0 = await serverStats(port);
    await sleep(900); // past the cooldown
    release = await hold(lily);
    await until(lily, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    await sleep(1200);
    await release();
    await sleep(600);
    const m1 = await WS(rosie);
    const s1 = await serverStats(port);
    const rp0 = s0.voicePeers.find((x) => x.peer === rosieId);
    const rp1 = s1.voicePeers.find((x) => x.peer === rosieId);
    check(m1.player.scheduled === m0.player.scheduled && m1.rx.frames === m0.rx.frames && rp1.bytesOut === rp0.bytesOut, `Rosie muted Lily: nothing played, nothing even sent to her (${rp1.bytesOut - rp0.bytesOut} B)`);
    await tapMute(rosie, lilyId);
    await closePanels(rosie);
    // the host mutes Rosie for everyone
    await tapMute(lily, rosieId);
    const rosieMuted = await until(rosie, () => window.__game.debug.walkie.state().view.state === 'muted', null, 4000, 100);
    check(!!rosieMuted, 'the host muted Rosie: Rosie\'s walkie rests ("Walkie resting")');
    await settle(lily.page, 600);
    await shot(lily, 'players-host-mute-controls');
    await closePanels(lily);
    await settle(rosie.page, 300);
    await shot(rosie, 'hud-muted-by-host-ipad');
    const rm0 = await WS(rosie);
    release = await hold(rosie);
    await sleep(700);
    await release();
    const rm1 = await WS(rosie);
    check(rm1.tx.frames === rm0.tx.frames && !(await W(rosie)).micLive, 'Rosie presses anyway: no microphone, nothing sent');
    await tapMute(lily, rosieId);
    // "Mute everyone"
    await press(lily, '.sw-panel-wrap.sw-open .sw-wk-muteall');
    const quiet = await until(rosie, () => window.__game.debug.walkie.state().view.state === 'quiet', null, 4000, 100);
    check(!!quiet, '"Mute everyone": Rosie\'s walkie rests');
    check((await W(lily)).view.state === 'quiet', '"Mute everyone": the host\'s own walkie rests too');
    await settle(lily.page, 500);
    await shot(lily, 'players-host-mute-everyone');
    await closePanels(lily);
    const q0 = await WS(rosie);
    const ql0 = await WS(lily);
    release = await hold(lily);
    await sleep(700);
    await release();
    const q1 = await WS(rosie);
    const ql1 = await WS(lily);
    check(q1.rx.frames === q0.rx.frames && ql1.tx.frames === ql0.tx.frames && !(await W(lily)).micLive, 'nobody talks while the walkies rest (no microphone, nothing sent)');
    await settle(rosie.page, 200);
    await shot(rosie, 'hud-quiet-ipad');
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await press(lily, '.sw-panel-wrap.sw-open .sw-wk-muteall');
    await closePanels(lily);
    const back = await until(rosie, () => window.__game.debug.walkie.state().view.state === 'idle', null, 4000, 100);
    check(!!back, 'walkies back on: Rosie\'s button says "Hold to talk"');

    // ----- June's grown-up turns hers on (phone shots) -----
    log('June\'s grown-up turns the walkie on (phone)');
    await grownUpTurnsOn(june, { wrongFirst: false, shotName: 'gate-phone', fromPause: true });
    await closePanels(june);
    check(!!(await shown(june)), 'June: now the walkie button appears');
    await firstPressMicCard(june, 'mic-card-phone');
    await sleep(900);
    const rj0 = await WS(rosie);
    release = await hold(june);
    await until(june, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
    await sleep(1400);
    await shot(june, 'hud-talking-phone');
    await release();
    await sleep(900);
    const rj1 = await WS(rosie);
    check(rj1.player.scheduled > rj0.player.scheduled, `Rosie heard June (${rj1.player.scheduled - rj0.player.scheduled} buffers)`);
    // June (walkie on) sees Lily's badge from her phone
    release = await hold(lily);
    await until(june, () => !!document.querySelector('.sw-wk-speak:not([hidden])'), null, 4000, 100);
    await settle(june.page, 300);
    await shot(june, 'speaking-badge-phone');
    await release();
    await sleep(500);
    // other screen shapes: a phone held sideways, an iPad held upright
    for (const [pl, vp, name] of [[june, { width: 844, height: 390 }, 'hud-talking-phone-sideways'], [rosie, { width: 768, height: 1024 }, 'hud-talking-ipad-portrait']]) {
      await pl.page.setViewportSize(vp);
      await settle(pl.page, 900);
      await sleep(900);
      release = await hold(pl);
      await until(pl, () => window.__game.debug.walkie.state().talk === 'talking', null, 4000, 50);
      await sleep(1000);
      await shot(pl, name);
      await release();
      await pl.page.setViewportSize(pl.viewport);
      await settle(pl.page, 600);
    }
    await press(june, '.sw-hud-tr button.sw-playersbtn');
    await settle(june.page, 700);
    await shot(june, 'players-phone');
    await closePanels(june);

    // ----- turning off is one tap -----
    await press(june, '.sw-hud-tr button[aria-label="Menu"]');
    await press(june, '.sw-panel-wrap.sw-open button:has-text("Settings")');
    await june.page.waitForSelector('.sw-panel-wrap.sw-open .sw-wk-setrow');
    await press(june, '.sw-panel-wrap.sw-open .sw-wk-setrow .sw-wk-switch');
    const offAgain = await until(june, () => !window.__game.debug.walkie.state().enabled && !document.querySelector('.sw-gate'), null, 3000, 100);
    check(!!offAgain, 'June: turning the walkie off is one tap (no question)');
    await closePanels(june);
    const offDeclared = await until(june, () => window.__game.debug.walkie.state().declared === null, null, 3000, 100);
    check(!!offDeclared, 'June told the server "voice off"');

    // final server numbers
    const fin = await serverStats(port);
    numbers.server = fin.voice;
    const logs = server.lines.join('');
    check(!/Lily|Rosie|June|sw1-/.test(logs), 'the server log names no child and no code');
  } finally {
    await browser.close().catch(() => {});
    const s = server;
    server = null;
    if (s) s.kill('SIGKILL');
  }
}

main()
  .catch((err) => {
    errors.push('[fatal] ' + (err && err.stack ? err.stack : err));
    const s = server;
    server = null;
    if (s) s.kill('SIGKILL');
  })
  .finally(() => {
    console.log('\nnumbers ' + JSON.stringify(numbers, null, 1));
    console.log(`${passed} checks passed, ${errors.length} problems`);
    finish(errors);
  });
