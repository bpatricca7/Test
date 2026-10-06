// Touch HUD at real tablet and phone sizes (Safari's bars shorten an iPad's screen): no two
// buttons, labels, slots or the joystick overlap, on the ground, flying, and playing with friends
// (Say shown, the walkie-talkie idle, "Jules bear is talking", pressed and the "Walkie off" badge, with its pressed
// rings, 22 px past the button), and in wave 4 (a beach world): a toy held (Squish! / Put away) and
// a present waiting (the Present button, the ring on the coin pill), swimming (Up / Down), the
// dolphin bubble and riding (Hop off, Jump), each alone and with friends (Say and the walkie).
// The life column (Hop off, Present, Squish!, ...) and the dolphin bubble count too.
// Console errors, page errors and failed requests fail a size too. Screenshots .shots/tmp-hudsizes-*.png.
//   node tools/probe-hud-sizes.mjs [tag] [--sizes=1180x700,1024x690] [--no-wave4]
import { launch, openGame, settle, startWorld, shot } from './smoke.mjs';

const TAG = process.argv[2] || 'now';
const SIZES = [
  [1180, 820], [1180, 740], [1180, 700], [1133, 744], [1133, 660], [1024, 768], [1024, 690],
  [1194, 834], [1194, 750], [1080, 810], [1080, 700], [1180, 640], [1366, 1024], [1366, 940], [820, 1180], [768, 1024], [744, 1133], [844, 390], [390, 844],
];

const overlaps = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('.sw-hud .sw-round-face, .sw-hud .sw-slot, .sw-hud .sw-pill, .sw-hud .sw-round-label, .lf-hud .sw-round:not([hidden]) .sw-round-face, .lf-hud .sw-round:not([hidden]) .sw-round-label, .lf-bubble.lf-on, .sw-wk:not([hidden]) .sw-wk-btn, .sw-wk:not([hidden]) .sw-wk-label, .sw-wk-off:not([hidden])')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
  const joy = document.querySelector('.sw-joy');
  if (joy && joy.offsetParent !== null && getComputedStyle(joy).display !== 'none') els.push(joy);
  // the walkie counts with the rings it sends out while pressed: 22 px past its button
  const grow = (e, r) => (e.classList.contains('sw-wk-btn') ? { left: r.left - 22, right: r.right + 22, top: r.top - 22, bottom: r.bottom + 22 } : r);
  const rects = els.map((e) => ({ e, raw: e.getBoundingClientRect(), r: grow(e, e.getBoundingClientRect()) }));
  const name = (e) => (e.closest('.sw-wk') ? 'walkie ' + e.className : e.classList.contains('lf-bubble') ? `bubble(${e.dataset.owner})` : (e.closest('.sw-round')?.getAttribute('aria-label') || e.getAttribute('aria-label') || e.className) + (e.classList.contains('sw-round-label') ? ' label' : ''));
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].e.closest('.sw-round') && rects[i].e.closest('.sw-round') === rects[j].e.closest('.sw-round')) continue;
      if (rects[i].e.closest('.sw-wk') && rects[i].e.closest('.sw-wk') === rects[j].e.closest('.sw-wk')) continue;
      const a = rects[i].r, b = rects[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`${name(rects[i].e)} x ${name(rects[j].e)}`);
    }
  }
  // on screen: the controls themselves (the walkie's rings may run past the edge)
  for (const { e, raw: r } of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${name(e)} off screen`);
  const j = document.querySelector('.sw-touch .sw-round[aria-label="Jump"] .sw-round-face')?.getBoundingClientRect();
  return { out, jump: j && j.width ? `jump at ${Math.round(j.left)},${Math.round(j.top)} (bottom gap ${Math.round(innerHeight - j.bottom)})` : 'jump hidden' };
});

// alone (Say and the walkie hidden) and with friends (Say, the walkie idle with its rings)
async function bothWays(page, label, out) {
  for (const friends of [false, true]) {
    await page.evaluate((friends) => {
      const g = window.__game;
      const say = document.querySelector('.sw-saybtn');
      if (say) say.hidden = !friends;
      g.net.walkie.view = () => (friends ? { show: 'button', state: 'idle', who: null, left: 9, speaking: [] } : { show: 'none', speaking: [] });
      g.net.walkie.ui.update();
    }, friends);
    await settle(page, 300);
    const r = await overlaps(page);
    out.push(...r.out.map((o) => `${label}${friends ? ' with friends' : ''}: ${o}`));
  }
}

const waitFor = (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);

// wave 4: a toy held and a present waiting (on the sand), swimming, the dolphin bubble, riding
async function wave4(page, size) {
  const out = [];
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.ocean.popups(true); // the dolphin bubble on an automated page
    g.debug.squish.presents(true); // the Present button and the ring
    g.debug.squish.give('pf_dolphin');
    g.squish.hold('pf_dolphin', false, { quiet: true });
  });
  const toNext = await page.evaluate(() => window.__game.debug.squish.state().toNext);
  await page.evaluate((n) => window.__game.coins.add(n, 'gift', { fly: false }), toNext);
  const ready = await waitFor(page, () => ['present', 'squish', 'squish-away'].every((a) => { const b = document.querySelector(`.lf-hud .sw-round[data-action="${a}"]`); return b && !b.hidden; }), null, 6000);
  if (!ready) out.push('toy and present: Present / Squish! / Put away did not all show');
  await waitFor(page, () => !document.querySelector('.sq-drop'), null, 12000); // the present flies to its button
  await bothWays(page, 'toy and present', out);
  await shot(page, `hudsizes-${TAG}-toy-${size}`, 'tmp');
  // swimming: kept at the surface of the deep water (the probe-ocean float)
  await page.evaluate(() => {
    const g = window.__game, pl = g.player, m = g.ocean.map;
    const up = pl.update.bind(pl);
    pl.update = (dt) => {
      up(dt);
      if (pl.state === 'ride') return;
      const t = m.top(pl.position.x, pl.position.z);
      if (t >= 0 && pl.position.y < t + 0.1) { pl.position.y = t + 0.1; if (pl.velocity.y < 0) pl.velocity.y = 0; }
    };
    const d = g.debug.ocean.deepSpot();
    g.debug.ocean.clear();
    g.debug.ocean.autoSpawn(false);
    g.player.setFlying(false);
    g.player.teleport(d[0], d[1], d[2]);
  });
  const swim = await waitFor(page, () => window.__game.player.seaSwim && [...document.querySelectorAll('.sw-touch .sw-flybtn')].filter((e) => e.offsetParent).length === 2, null, 15000);
  if (!swim) out.push('swimming: Up / Down did not show');
  await settle(page, 500);
  await bothWays(page, 'swimming', out);
  await shot(page, `hudsizes-${TAG}-swim-${size}`, 'tmp');
  // the dolphin bubble (a dolphin just ahead, tapped)
  await page.evaluate(() => {
    const g = window.__game, d = g.debug.ocean, p = g.player.position, yaw = g.cameraRig.yaw;
    d.spawn('dolphin', p.x + Math.sin(yaw) * 3.5, p.y, p.z + Math.cos(yaw) * 3.5, { n: 2 });
  });
  await settle(page, 300);
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const l = g.debug.ocean.list('dolphin').filter((r) => r.role === 'wild');
    l.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    if (l[0]) g.debug.ocean.tapRec('dolphin', l[0].i);
  });
  const bub = await waitFor(page, () => !!document.querySelector('.oc-bubble.lf-on'), null, 4000);
  if (!bub) out.push('the dolphin bubble did not open');
  await waitFor(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  await bothWays(page, 'dolphin bubble', out);
  await shot(page, `hudsizes-${TAG}-bubble-${size}`, 'tmp');
  // riding: Hop off in the life column, Jump (the dolphin leaps)
  if (bub) await page.locator('.oc-bubble.lf-on .oc-ride').tap();
  // the tap must reach the dolphin at once (it swims under her: state 'mount'). The mount lasts
  // 0.4 s of game time, but one game frame counts at most 0.05 s (core/game.js), and this machine
  // without a GPU draws about 1.4 frames a second at 1366x940, so those 8 frames take up to about
  // 7 s here (an instrumented run: tap at 11.1 s, the ride at 18.1 s). So the ride itself gets
  // 30 s; a tap that never reaches the dolphin still fails at 3 s.
  const tapped = bub && await waitFor(page, () => window.__game.ocean.riding || window.__game.debug.ocean.list('dolphin').some((r) => r.state === 'mount'), null, 3000);
  if (bub && !tapped) out.push('riding: the Ride tap did not reach the dolphin');
  const rode = tapped && await waitFor(page, () => window.__game.ocean.riding && (() => { const b = document.querySelector('.lf-hud .sw-round[data-action="seahop"]'); return b && !b.hidden; })(), null, 30000);
  if (tapped && !rode) out.push('riding: the ride did not start');
  await waitFor(page, () => !document.querySelector('.sw-stkpop'), null, 15000);
  await settle(page, 400);
  await bothWays(page, 'riding', out);
  await shot(page, `hudsizes-${TAG}-ride-${size}`, 'tmp');
  return out;
}

let bad = 0;
const WAVE4 = !process.argv.includes('--no-wave4');
const only = (process.argv.find((a) => a.startsWith('--sizes=')) || '').slice(8).split(',').filter(Boolean);
for (const [width, height] of SIZES) {
  if (only.length && !only.includes(`${width}x${height}`)) continue;
  // a fresh browser for each size (one browser for all of them ran out of room on this machine);
  // a browser that dies under load gets one more go
  for (let attempt = 1; attempt <= 2; attempt++) {
  const browser = await launch({});
  // console errors, page errors and failed requests count as a failure too (the gate allows none)
  const errors = [];
  try {
    const { context, page } = await openGame(browser, { errors, viewport: { width, height }, touch: true, label: `hud-${width}x${height}` });
    await page.evaluate(() => {
      const g = window.__game;
      for (const a of ['dressup', 'stickers', 'emotes']) if (!g.actions.has(a)) g.registerAction(a, () => g.toast(a));
    });
    // wave 4 needs the sea: a beach world (the land HUD is the same as the meadow's)
    await startWorld(page, WAVE4 ? 'beach' : 'meadow', { tap: true });
    await settle(page, 700);
    const ground = await overlaps(page);
    await shot(page, `hudsizes-${TAG}-${width}x${height}`, 'tmp');
    await page.locator('.sw-hud .sw-round[aria-label="Fly"]').tap();
    await settle(page, 400);
    const fly = await overlaps(page);
    await shot(page, `hudsizes-${TAG}-fly-${width}x${height}`, 'tmp');
    await page.locator('.sw-hud .sw-round[aria-label="Fly"]').tap();
    await settle(page, 400);
    // playing with friends: Say shows, and the walkie-talkie (stand-in views: idle, a friend
    // with a long name talking, and pressed)
    const friends = [];
    for (const state of ['idle', 'busy', 'talking', 'badge']) {
      await page.evaluate((state) => {
        const g = window.__game;
        const say = document.querySelector('.sw-saybtn');
        if (say) say.hidden = false;
        // 'badge': her walkie is off while a friend's is on (the small "Walkie off" badge)
        g.net.walkie.view = () => (state === 'badge' ? { show: 'badge', state: 'off', speaking: [] }
          : { show: 'button', state, who: state === 'busy' ? { peer: 'x', name: 'Jules bear', color: '#9C7BFF' } : null, left: 9, speaking: [] });
        g.net.walkie.ui.update();
      }, state);
      await settle(page, 300);
      const r = await overlaps(page);
      friends.push(...r.out.map((o) => `walkie ${state}: ${o}`));
      if (state === 'busy' || state === 'talking') await shot(page, `hudsizes-${TAG}-walkie-${state}-${width}x${height}`, 'tmp');
    }
    const sea = WAVE4 ? await wave4(page, `${width}x${height}`) : [];
    const all = [...ground.out, ...fly.out.map((o) => 'flying: ' + o), ...friends, ...sea];
    const errs = errors.slice(); // taken before closing, which cancels requests still loading
    await context.close();
    bad += all.length || errs.length ? 1 : 0;
    console.log(`${width}x${height}: ${all.length ? 'OVERLAP ' + all.join('; ') : 'ok'} | ${ground.jump} | ${errs.length} console errors, page errors or failed requests`);
    for (const e of errs) console.log('  ' + e);
    break;
  } catch (err) {
    if (attempt === 2 || !/closed|crash/i.test(String(err && err.message))) throw err;
    console.log(`${width}x${height}: the test browser died (${String(err.message).split('\n')[0].slice(0, 80)}), once more`);
  } finally {
    await browser.close().catch(() => {});
  }
  }
}
console.log(bad ? `${bad} sizes overlap or had errors` : 'all sizes clear, no console errors, page errors or failed requests');
if (bad) process.exitCode = 1;
