// Touch HUD at real tablet and phone sizes (Safari's bars shorten an iPad's screen): no two
// buttons, labels, slots or the joystick overlap, on the ground, flying, and playing with friends
// (Say shown, the walkie-talkie idle, "Jules bear is talking", pressed and the "Walkie off" badge, with its pressed
// rings, 22 px past the button). Screenshots .shots/tmp-hudsizes-*.png.
//   node tools/probe-hud-sizes.mjs [tag]
import { launch, openGame, settle, startWorld, shot } from './smoke.mjs';

const TAG = process.argv[2] || 'now';
const SIZES = [
  [1180, 820], [1180, 740], [1180, 700], [1133, 744], [1133, 660], [1024, 768], [1024, 690],
  [1194, 834], [1194, 750], [1080, 810], [1080, 700], [1180, 640], [1366, 1024], [1366, 940], [820, 1180], [768, 1024], [744, 1133], [844, 390], [390, 844],
];

const overlaps = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('.sw-hud .sw-round-face, .sw-hud .sw-slot, .sw-hud .sw-pill, .sw-hud .sw-round-label, .sw-wk:not([hidden]) .sw-wk-btn, .sw-wk:not([hidden]) .sw-wk-label, .sw-wk-off:not([hidden])')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
  const joy = document.querySelector('.sw-joy');
  if (joy && joy.offsetParent !== null && getComputedStyle(joy).display !== 'none') els.push(joy);
  // the walkie counts with the rings it sends out while pressed: 22 px past its button
  const grow = (e, r) => (e.classList.contains('sw-wk-btn') ? { left: r.left - 22, right: r.right + 22, top: r.top - 22, bottom: r.bottom + 22 } : r);
  const rects = els.map((e) => ({ e, r: grow(e, e.getBoundingClientRect()) }));
  const name = (e) => (e.closest('.sw-wk') ? 'walkie ' + e.className : (e.closest('.sw-round')?.getAttribute('aria-label') || e.getAttribute('aria-label') || e.className) + (e.classList.contains('sw-round-label') ? ' label' : ''));
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].e.closest('.sw-round') && rects[i].e.closest('.sw-round') === rects[j].e.closest('.sw-round')) continue;
      if (rects[i].e.closest('.sw-wk') && rects[i].e.closest('.sw-wk') === rects[j].e.closest('.sw-wk')) continue;
      const a = rects[i].r, b = rects[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`${name(rects[i].e)} x ${name(rects[j].e)}`);
    }
  }
  for (const { e, r } of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${name(e)} off screen`);
  const j = document.querySelector('.sw-touch .sw-round[aria-label="Jump"] .sw-round-face')?.getBoundingClientRect();
  return { out, jump: j && j.width ? `jump at ${Math.round(j.left)},${Math.round(j.top)} (bottom gap ${Math.round(innerHeight - j.bottom)})` : 'jump hidden' };
});

const browser = await launch({});
let bad = 0;
try {
  for (const [width, height] of SIZES) {
    const { context, page } = await openGame(browser, { errors: [], viewport: { width, height }, touch: true, label: `hud-${width}x${height}` });
    await page.evaluate(() => {
      const g = window.__game;
      for (const a of ['dressup', 'stickers', 'emotes']) if (!g.actions.has(a)) g.registerAction(a, () => g.toast(a));
    });
    await startWorld(page, 'meadow', { tap: true });
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
    const all = [...ground.out, ...fly.out.map((o) => 'flying: ' + o), ...friends];
    bad += all.length ? 1 : 0;
    console.log(`${width}x${height}: ${all.length ? 'OVERLAP ' + all.join('; ') : 'ok'} | ${ground.jump}`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(bad ? `${bad} sizes overlap` : 'all sizes clear');
if (bad) process.exitCode = 1;
