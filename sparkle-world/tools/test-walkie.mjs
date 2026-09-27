// Walkie-talkie tests (docs/MULTIPLAYER.md Addendum B, docs/teams/walkie.md):
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

import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { waitForTitle, settle, finish, ROOT, SHOTS, CHROMIUM, LAUNCH_ARGS } from './smoke.mjs';
import {
  sleep, game, until, press, setupPage, hostMakesCode, guestTypesCode, hostLetsIn, waitLive, bringTo, closePanels,
} from './net/mp-flows.mjs';
import { runUnit } from './test-walkie-unit.mjs';

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
  await pl.page.screenshot({ path: file });
  console.log(`    screenshot ${path.relative(ROOT, file)}`);
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
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SW_TEST_STATS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
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

// ---------- the run ----------

async function main() {
  // (a) unit
  log('unit tests');
  const unit = await runUnit({ check, log });
  numbers.snr = unit.snr;
  numbers.codecBytesPerSecond = unit.bytesPerSecond;
  if (arg('unit-only')) return;

  // (b) end to end
  if (!arg('no-build')) {
    log('npm run build');
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  await startServer(port);
  const url = `http://localhost:${port}/`;
  log(`server up: ${url}`);
  const head = await fetch(url, { method: 'HEAD' });
  const pp = head.headers.get('permissions-policy') || '';
  check(/microphone=\(self\)/.test(pp) && /camera=\(\)/.test(pp) && /geolocation=\(\)/.test(pp), `Permissions-Policy: "${pp}" (microphone for this site only; camera and the rest off)`);

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: !arg('headed'),
    args: [...LAUNCH_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
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
    await sleep(900);
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
    check(tie.filter((x) => x.talk === 'talking').length === 1 && s3b.voice.busy - s3a.voice.busy === 1, `a tie at the same millisecond: the server gives the walkie to one (${tie.map((x) => x.talk).join(' / ')}) and answers "busy" to the other (${s3b.voice.busy - s3a.voice.busy})`);
    check(tie.filter((x) => x.micLive).length === 1, 'only the talker\'s microphone is open');
    for (const pl of [lily, rosie]) await game(pl, () => window.__game.debug.walkie.release('race'));
    await sleep(1200);

    // ----- Rosie talks (iPad); Lily hears -----
    log('Rosie talks from the iPad');
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
    check(Number(secsLeft) <= 3, `the ring counts down (${secsLeft} s left after 13 s)`);
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
    // Rosie mutes Lily for herself (Players panel)
    await press(rosie, '.sw-hud-tr button.sw-playersbtn');
    await rosie.page.waitForSelector(`.sw-panel-wrap.sw-open .sw-net-row[data-peer="${lilyId}"] .sw-wk-mute`);
    await settle(rosie.page, 500);
    await press(rosie, `.sw-panel-wrap.sw-open .sw-net-row[data-peer="${lilyId}"] .sw-wk-mute`);
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
    await press(rosie, '.sw-hud-tr button.sw-playersbtn');
    await press(rosie, `.sw-panel-wrap.sw-open .sw-net-row[data-peer="${lilyId}"] .sw-wk-mute`);
    await closePanels(rosie);
    // the host mutes Rosie for everyone
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await lily.page.waitForSelector(`.sw-panel-wrap.sw-open .sw-net-row[data-peer="${rosieId}"] .sw-wk-mute`);
    await press(lily, `.sw-panel-wrap.sw-open .sw-net-row[data-peer="${rosieId}"] .sw-wk-mute`);
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
    await press(lily, '.sw-hud-tr button.sw-playersbtn');
    await press(lily, `.sw-panel-wrap.sw-open .sw-net-row[data-peer="${rosieId}"] .sw-wk-mute`);
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
    if (server) server.kill('SIGKILL');
  }
}

main()
  .catch((err) => {
    errors.push('[fatal] ' + (err && err.stack ? err.stack : err));
    if (server) server.kill('SIGKILL');
  })
  .finally(() => {
    console.log('\nnumbers ' + JSON.stringify(numbers, null, 1));
    console.log(`${passed} checks passed, ${errors.length} problems`);
    finish(errors);
  });
