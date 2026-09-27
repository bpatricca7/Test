// Menus team probe: title (desktop, iPad, phone), New World wizard, My Worlds (save to a file,
// open a file, delete), the Bag (tabs, search, colors, long-press, drag to hotbar, recently
// used), Settings, photo polaroid, the tutorial, keyboard help, joystick dead zone and pinch
// zoom. Everything goes through real clicks / taps / keys where feasible.
//
//   node tools/probe-menus.mjs [--only=desktop|touch] [--headed]
// Screenshots: .shots/menus-*.png

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, openGame, waitForTitle, waitForPlay, waitIdle, shot, settle, finish, startWorld, parseArgs, SHOTS } from './smoke.mjs';

const P = 'menus';
const opts = parseArgs();
const errors = [];

function check(cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

const btn = (page, text) => page.locator('.sw-panel-wrap.sw-open button.sw-btn', { hasText: text }).first();

/** Visible HUD controls that overlap each other (they should never). */
async function hudOverlaps(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('.sw-hud .sw-round-face, .sw-hud .sw-slot, .sw-hud .sw-pill')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
    const joy = document.querySelector('.sw-joy');
    if (joy && joy.offsetParent !== null && getComputedStyle(joy).display !== 'none') els.push(joy);
    const rects = els.map((e) => ({ e, r: e.getBoundingClientRect() }));
    const out = [];
    const name = (e) => e.closest('.sw-round')?.getAttribute('aria-label') || e.getAttribute('aria-label') || e.className;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) out.push(`${name(rects[i].e)} x ${name(rects[j].e)}`);
      }
    }
    // everything inside the screen
    for (const { e, r } of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${name(e)} off screen`);
    return out;
  });
}

// =======================================================================================
// desktop
// =======================================================================================
async function desktop(browser) {
  console.log('Desktop (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await settle(page, 1200);
  const title = await page.evaluate(() => ({
    backdrop: !!window.__game.scene.getObjectByName('title-backdrop'),
    hello: document.querySelector('.sw-hello')?.textContent,
    play: !document.querySelector('.sw-title-play')?.hidden,
  }));
  check(title.backdrop, 'title shows the live 3D island backdrop');
  check(/Hi, Lily!/.test(title.hello || ''), `title greets the player (${title.hello})`);
  check(!title.play, 'Play is hidden while there are no worlds');
  await shot(page, 'title-desktop', P);

  // ----- My Worlds, empty: a friendly nudge
  await page.locator('.sw-title2 button', { hasText: 'My Worlds' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-empty img[src]');
  await settle(page, 300);
  await shot(page, 'worlds-empty', P);
  check(await page.locator('.sw-empty button', { hasText: 'New World' }).count() === 1, 'empty My Worlds offers New World');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ui.current === 'title');

  // ----- music: the first tap starts it, the title plays the menu tune
  await page.mouse.click(640, 790);
  await page.waitForFunction(() => window.__game.audio._playing === 'menu', null, { timeout: 5000 }).catch(() => {});
  const mus = await page.evaluate(() => ({ on: window.__game.audio.musicOn, playing: window.__game.audio._playing, song: !!window.__game.audio._song }));
  check(mus.on && mus.playing === 'menu' && mus.song, `title plays the menu music (${mus.playing})`);

  // ----- settings from the title: name, sliders, quiet
  await page.locator('.sw-title2 button', { hasText: 'Settings' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="settings"]');
  await settle(page, 300);
  await btn(page, 'Change').click();
  await page.waitForSelector('.sw-dialog .sw-input');
  await page.locator('.sw-dialog .sw-input').fill('Mia');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__game.ui.dialogOpen);
  await settle(page, 600);
  // drag the music slider's knob to the right
  const music = page.locator('.sw-range[aria-label="Music volume"]');
  await music.scrollIntoViewIfNeeded();
  await settle(page, 200);
  const box = await music.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width * (0.5 + i * 0.06), box.y + box.height / 2);
  await page.mouse.up();
  await page.locator('.sw-switch[aria-label="Quiet"]').click();
  await settle(page, 300);
  await shot(page, 'settings-title', P);
  const s1 = await page.evaluate(() => ({ ...window.__game.profile.settings, name: window.__game.profile.playerName, look: window.__game.profile.look.name }));
  check(s1.name === 'Mia' && s1.look === 'Mia', `name changed in Settings (${s1.name})`);
  check(s1.music > 0.6, `music slider moved (${s1.music.toFixed(2)})`);
  check(s1.muted === true, 'Quiet switch mutes');
  await page.locator('.sw-switch[aria-label="Quiet"]').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ui.current === 'title');
  const hello2 = await page.evaluate(() => document.querySelector('.sw-hello').textContent);
  check(/Mia/.test(hello2), `title greeting uses the new name (${hello2})`);

  // ----- new world wizard
  await page.locator('.sw-title2 button', { hasText: 'New World' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
  const name0 = await page.locator('.sw-nw-name .sw-input').inputValue();
  await page.locator('.sw-dice').click();
  const name1 = await page.locator('.sw-nw-name .sw-input').inputValue();
  check(name0.startsWith("Mia's") && name1 !== name0 && name1.startsWith("Mia's"), `name suggestion + new idea dice ("${name0}" -> "${name1}")`);
  const arts = await page.evaluate(() => [...document.querySelectorAll('.sw-biome-art')].map((i) => i.naturalWidth));
  check(arts.length >= 2 && arts.every((w) => w > 100), `every biome card has a painted preview (${arts.length})`);
  await page.locator('.sw-biome', { hasText: 'Builder Flat' }).click();
  await page.locator('.sw-size[aria-label="Big"]').click();
  await page.locator('.sw-size[aria-label="Cozy"]').click();
  await settle(page, 400);
  await shot(page, 'newworld', P);
  const chosen = await page.evaluate(() => document.querySelector('.sw-biome.sw-sel')?.dataset.biome);
  check(chosen === 'flat', 'picked the Builder Flat card');
  await page.locator('button.sw-create').click();
  await page.waitForSelector('.sw-loading.sw-open .sw-loading-sub span', { timeout: 10000 });
  await shot(page, 'loading', P);
  await waitForPlay(page);
  await waitIdle(page);
  const w = await page.evaluate(() => ({ ...window.__game.world.meta, backdrop: !!window.__game.scene.getObjectByName('title-backdrop'), fov: window.__game.camera.fov, view: window.__game.camera.view && window.__game.camera.view.enabled }));
  check(w.biome === 'flat' && w.name === name1, `created "${w.name}" (${w.biome})`);
  check(!w.backdrop && w.fov === 70 && !w.view, 'title backdrop disposed and the camera restored');
  await settle(page, 600);
  await shot(page, 'hud-desktop', P);
  // music follows the clock (day -> night) and fades between tunes
  await page.waitForFunction(() => window.__game.audio._playing === 'day', null, { timeout: 5000 }).catch(() => {});
  const day = await page.evaluate(() => window.__game.audio._playing);
  await page.evaluate(() => window.__game.setDayTime(0.92));
  await page.waitForFunction(() => window.__game.audio._playing === 'night', null, { timeout: 6000 }).catch(() => {});
  const night = await page.evaluate(() => window.__game.audio._playing);
  check(day === 'day' && night === 'night', `music mood follows day and night (${day} -> ${night})`);
  await page.evaluate(() => window.__game.setDayTime(0.35));

  // ----- keyboard help
  await page.keyboard.press('h');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="help"] .sw-key');
  await settle(page, 300);
  await shot(page, 'help-keys', P);
  await btn(page, 'Touch').click();
  await settle(page, 200);
  await shot(page, 'help-touch', P);
  await btn(page, 'Got it!').click();
  await page.waitForFunction(() => !window.__game.ui.current);

  // ----- tutorial (automatic tips are skipped for automated browsers; the action shows them)
  await page.evaluate(() => window.__game.runAction('tutorial'));
  await page.waitForSelector('.sw-tut:not([hidden]) .sw-tut-card');
  await settle(page, 900);
  await shot(page, 'tutorial-1', P);
  // walk forward until the tip notices (headless WebGL can be slow, so no fixed time)
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => document.querySelector('.sw-tut-card.sw-yay'), null, { timeout: 12000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => /Tap|Click/.test(document.querySelector('.sw-tut-text').textContent), null, { timeout: 6000 }).catch(() => {});
  const t2 = await page.evaluate(() => document.querySelector('.sw-tut-text').textContent);
  check(/build/i.test(t2), `walking finished tip 1 (now: "${t2}")`);
  // build by clicking the ground in front
  await page.evaluate(() => { window.__game.cameraRig.pitch = 0.5; });
  await settle(page, 300);
  const vp = page.viewportSize();
  await page.mouse.click(vp.width * 0.5, vp.height * 0.72);
  await page.waitForFunction(() => /Bag/.test(document.querySelector('.sw-tut-text').textContent), null, { timeout: 8000 }).catch(() => {});
  const t3 = await page.evaluate(() => document.querySelector('.sw-tut-text').textContent);
  check(/Bag/.test(t3), `building finished tip 2 (now: "${t3}")`);
  await shot(page, 'tutorial-3', P);
  await page.keyboard.press('b');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="bag"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /Hand/.test(document.querySelector('.sw-tut-text').textContent), null, { timeout: 8000 }).catch(() => {});
  await page.locator('.sw-hud .sw-round[aria-label="Hand"]').click();
  await page.waitForFunction(() => /saves/.test(document.querySelector('.sw-tut-text').textContent), null, { timeout: 8000 }).catch(() => {});
  await settle(page, 900);
  await shot(page, 'tutorial-5', P);
  await page.locator('.sw-tut-next').click();
  const tutDone = await page.evaluate(() => ({ done: window.__game.profile.tutorialDone, hidden: document.querySelector('.sw-tut').hidden }));
  check(tutDone.done && tutDone.hidden, 'tutorial walked through all 5 tips and is remembered');
  await page.evaluate(() => window.__game.setTool('build'));

  // ----- the Bag
  await page.keyboard.press('b');
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src]');
  await settle(page, 1200);
  await shot(page, 'bag-desktop', P);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.sw-tab2')].map((t) => t.textContent.trim()));
  check(tabs.length >= 6, `Bag has picture tabs (${tabs.join(', ')})`);
  await page.locator('.sw-tab2', { hasText: 'Colors' }).click();
  await settle(page, 600);
  await shot(page, 'bag-colors-tab', P);
  await page.locator('.sw-bag-search input').click();
  await page.keyboard.type('rose');
  await page.waitForFunction(() => /Found/.test(document.querySelector('.sw-bag-main').textContent), null, { timeout: 4000 }).catch(() => {});
  await settle(page, 600);
  await shot(page, 'bag-search', P);
  const found = await page.evaluate(() => [...document.querySelectorAll('.sw-bag-main .sw-item-name')].map((e) => e.textContent));
  check(found.includes('Rose'), `search "rose" finds the Rose (${found.join(', ')})`);
  await page.locator('.sw-bag-clear').click();
  // colorful furniture: the color step
  await page.locator('.sw-tab2', { hasText: 'Bedroom' }).click();
  await settle(page, 300);
  await page.locator('.sw-bag-grid .sw-item', { hasText: 'Bed' }).first().click();
  await page.waitForSelector('.sw-color-opt img[src]');
  await settle(page, 1500);
  await shot(page, 'bag-pick-color', P);
  const picked = await page.evaluate(() => document.querySelectorAll('.sw-color-opt')[2].style.getPropertyValue('--c'));
  await page.locator('.sw-color-opt').nth(2).click();
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 4000 });
  const slot = await page.evaluate(() => ({ key: window.__game.hotbar.slots[window.__game.hotbar.index], color: window.__game.hotbar.colors[window.__game.hotbar.index], idx: window.__game.hotbar.index }));
  check(slot.key === 'furn:bed_single' && slot.color === picked, `picked a bed color -> hotbar slot ${slot.idx + 1} (${slot.color})`);
  // long-press keeps the Bag open and moves on to the next slot
  await page.keyboard.press('b');
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src]');
  await page.locator('.sw-tab2', { hasText: 'Glass' }).click();
  await settle(page, 400);
  const before = await page.evaluate(() => window.__game.hotbar.index);
  const gl = await page.locator('.sw-bag-grid .sw-item').first().boundingBox();
  await page.mouse.move(gl.x + gl.width / 2, gl.y + gl.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await settle(page, 400);
  const lp = await page.evaluate((b) => ({ open: window.__game.ui.current, key: window.__game.hotbar.slots[b], idx: window.__game.hotbar.index }), before);
  check(lp.open === 'bag' && /glass/.test(lp.key || '') && lp.idx === (before + 1) % 9, `long-press put ${lp.key} in slot ${before + 1} and kept browsing`);
  // drag an item onto hotbar slot 9
  await page.locator('.sw-tab2', { hasText: 'Lights' }).click();
  await settle(page, 400);
  const lamp = await page.locator('.sw-bag-grid .sw-item').first().boundingBox();
  const slot9 = await page.locator('.sw-bag-slot').nth(8).boundingBox();
  await page.mouse.move(lamp.x + lamp.width / 2, lamp.y + lamp.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(lamp.x + lamp.width / 2 + ((slot9.x + slot9.width / 2 - lamp.x - lamp.width / 2) * i) / 12, lamp.y + lamp.height / 2 + ((slot9.y + slot9.height / 2 - lamp.y - lamp.height / 2) * i) / 12);
    await page.waitForTimeout(20);
  }
  await shot(page, 'bag-drag', P);
  await page.mouse.up();
  await settle(page, 400);
  const dragged = await page.evaluate(() => window.__game.hotbar.slots[8]);
  check(/lamp|lantern/.test(dragged || ''), `dragged a light onto slot 9 (${dragged})`);
  await page.locator('.sw-tab2', { hasText: 'Nature' }).click();
  await settle(page, 800);
  const recent = await page.evaluate(() => document.querySelectorAll('.sw-bag-recent .sw-item').length);
  check(recent >= 3, `"Recently used" row shows ${recent} things`);
  await shot(page, 'bag-recent', P);
  await page.keyboard.press('Escape');

  // ----- photo
  await page.keyboard.press('p');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="photo"]', { timeout: 8000 });
  await settle(page, 800);
  await shot(page, 'photo-polaroid', P);
  await page.locator('.sw-frame-btn[data-frame="stars"]').click();
  await settle(page, 300);
  await shot(page, 'photo-stars', P);
  const dlPhoto = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.locator('.sw-photo-save').click();
  const dl = await dlPhoto;
  check(dl && /\.png$/.test(dl.suggestedFilename()), `photo saved as a file (${dl && dl.suggestedFilename()})`);
  if (dl) {
    await mkdir(SHOTS, { recursive: true });
    await dl.saveAs(path.join(SHOTS, `${P}-photo-saved.png`));
  }
  const st = await page.evaluate(() => !!window.__game.profile.stickers.photographer);
  check(st, 'photo:taken earned the Photographer sticker');
  await page.locator('.sw-photo-again').click();
  await page.waitForFunction(() => window.__game.ui.current === 'photo', null, { timeout: 8000 });
  // a selfie: the camera turns round to her face
  await page.locator('.sw-photo-selfie').click();
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, 'photo-selfie-smile', P);
  await page.waitForFunction(() => window.__game.ui.current === 'photo', null, { timeout: 8000 });
  await page.locator('.sw-frame-btn[data-frame="flowers"]').click();
  await settle(page, 700);
  await shot(page, 'photo-selfie', P);
  const rigOk = await page.evaluate(() => !Object.prototype.hasOwnProperty.call(window.__game.cameraRig, 'update'));
  check(rigOk, 'selfie gives the camera back afterwards');
  await page.locator('.sw-photo-done').click();

  // ----- settings in play: time of day, quality
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="pause"]');
  await settle(page, 700);
  await shot(page, 'pause', P);
  // stand-in weather system (the environment team's game.weather after the merge)
  await page.evaluate(() => {
    const g = window.__game;
    if (!g.weather) g.weather = { current: 'sunny', kinds: ['sunny', 'cloudy', 'rain', 'snow', 'rainbow'], set(k) { this.current = k; g.events.emit('weather:change', { weather: k }); } };
    // spy on speech so read-aloud can be checked
    window.__spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => window.__spoken.push(u.text);
  });
  await btn(page, 'Settings').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="settings"]');
  await page.locator('.sw-seg-btn[data-value="rain"]').click();
  const wx = await page.evaluate(() => window.__game.weather.current);
  check(wx === 'rain', `weather wand calls game.weather.set (${wx})`);
  const ra = page.locator('.sw-switch[aria-label="Read words out loud"]');
  if (await ra.count()) {
    await ra.click();
    await page.evaluate(() => window.__game.toast('Hello there!'));
    await settle(page, 200);
    const spoken = await page.evaluate(() => window.__spoken);
    check(spoken.some((t) => /Hello there/.test(t)), `read words out loud speaks toasts (${spoken.length} said)`);
    await ra.click();
  }
  await page.locator('.sw-seg-btn', { hasText: 'Sunset' }).click();
  await page.locator('.sw-seg-btn', { hasText: 'Fast' }).click();
  await settle(page, 600);
  await shot(page, 'settings-play', P);
  const s2 = await page.evaluate(() => ({ t: window.__game.time.dayTime, q: window.__game.profile.settings.quality, pr: window.__game.renderer.getPixelRatio() }));
  check(s2.t > 0.7 && s2.t < 0.76 && s2.q === 'low', `sunset + Fast quality (dayTime ${s2.t.toFixed(2)}, ${s2.q})`);
  await page.locator('.sw-seg-btn', { hasText: 'Pretty' }).click();
  await page.keyboard.press('Escape'); // back to pause
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="pause"]');
  await btn(page, 'Save & Exit').click();
  await waitForTitle(page);
  await settle(page, 800);
  const back = await page.evaluate(() => ({ backdrop: !!window.__game.scene.getObjectByName('title-backdrop'), play: !document.querySelector('.sw-title-play').hidden, last: document.querySelector('.sw-title-last').textContent }));
  check(back.backdrop && back.play, `back on the title: island rebuilt, Play continues "${back.last}"`);
  await shot(page, 'title-return', P);

  // ----- my worlds: save to a file, open a file, delete
  await page.locator('.sw-title2 button', { hasText: 'My Worlds' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-world img');
  await settle(page, 400);
  await shot(page, 'worlds', P);
  const dlWorld = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.locator('.sw-world button[aria-label="Save to a file"]').first().click();
  const wd = await dlWorld;
  check(wd && /\.json$/.test(wd.suggestedFilename()), `world saved to a file (${wd && wd.suggestedFilename()})`);
  let file = null;
  if (wd) {
    file = path.join(SHOTS, `${P}-world.json`);
    await wd.saveAs(file);
    const text = await readFile(file, 'utf8');
    check(JSON.parse(text).format === 'sparkle-world', 'the file is a Sparkle World save');
  }
  const count0 = await page.locator('.sw-world').count();
  if (file) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.sw-open-file').click();
    await (await chooser).setFiles(file);
    await page.waitForFunction((n) => document.querySelectorAll('.sw-world').length === n + 1, count0, { timeout: 8000 }).catch(() => {});
    await settle(page, 600);
    await shot(page, 'worlds-imported', P);
    check(await page.locator('.sw-world').count() === count0 + 1, 'opened the file: the world is in My Worlds again');
    // a file that is not a world
    const bad = path.join(SHOTS, `${P}-not-a-world.json`);
    await writeFile(bad, '{"hello":"world"}');
    const chooser2 = page.waitForEvent('filechooser');
    await page.locator('.sw-open-file').click();
    await (await chooser2).setFiles(bad);
    await page.waitForFunction(() => /not a Sparkle World/.test(document.querySelector('.sw-toasts').textContent), null, { timeout: 5000 }).catch(() => {});
    const toast = await page.evaluate(() => document.querySelector('.sw-toasts').textContent);
    check(/not a Sparkle World/.test(toast), 'a wrong file gets a friendly message');
    // delete the imported copy (two in-page questions)
    await page.locator('.sw-world.sw-new button[aria-label="Delete"], .sw-world button[aria-label="Delete"]').first().click();
    await page.locator('.sw-dialog button', { hasText: 'Yes, delete' }).click();
    await page.locator('.sw-dialog button', { hasText: 'Yes, delete' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.sw-world').length === n, count0, { timeout: 5000 }).catch(() => {});
    check(await page.locator('.sw-world').count() === count0, 'deleted a world after asking twice');
  }
  await context.close();
}

// =======================================================================================
// touch devices
// =======================================================================================
async function touchDevice(browser, { name, viewport, deep = false }) {
  console.log(`Touch ${name} (${viewport.width}x${viewport.height})`);
  const { context, page } = await openGame(browser, { errors, viewport, touch: true, label: name });
  await settle(page, 1200);
  await shot(page, `title-${name}`, P);
  const tb = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.sw-title2 button')].filter((b) => b.offsetParent);
    return els.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  });
  check(tb.every((b) => b.in && b.h >= 44 && b.w >= 44), `${name}: title buttons are big and on screen (${tb.map((b) => b.t).join(', ')})`);
  // the other teams' buttons exist after the merge: stand in for them so the layout is real
  await page.evaluate(() => {
    const g = window.__game;
    for (const a of ['dressup', 'stickers', 'emotes']) if (!g.actions.has(a)) g.registerAction(a, () => g.toast(a));
  });
  await startWorld(page, 'meadow', {
    tap: true,
    onPanel: async (p) => {
      await settle(p, 500);
      await shot(p, `newworld-${name}`, P);
      // Create! is on screen without scrolling (it sticks to the bottom of the wizard card)
      const cr = await p.evaluate(() => {
        const r = document.querySelector('.sw-create').getBoundingClientRect();
        const body = document.querySelector('.sw-panel-wrap.sw-open .sw-card-body').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(Math.min(innerHeight, body.bottom)) };
      });
      check(cr.top >= 0 && cr.bottom <= cr.limit + 1, `${name}: Create! is on screen without scrolling (${cr.top}..${cr.bottom} of ${cr.limit})`);
    },
  });
  await settle(page, 900);
  await shot(page, `hud-${name}`, P);
  // flying swaps Jump for Up / Down
  await page.locator('.sw-hud .sw-round[aria-label="Fly"]').tap();
  await settle(page, 500);
  const ovFly = await hudOverlaps(page);
  check(ovFly.length === 0, `${name}: flying HUD controls do not overlap${ovFly.length ? ' (' + ovFly.join('; ') + ')' : ''}`);
  await shot(page, `hud-fly-${name}`, P);
  await page.locator('.sw-hud .sw-round[aria-label="Fly"]').tap();
  await settle(page, 300);
  const ov = await hudOverlaps(page);
  check(ov.length === 0, `${name}: HUD controls do not overlap${ov.length ? ' (' + ov.join('; ') + ')' : ''}`);

  if (deep) {
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
    const joy = await page.evaluate(() => { const r = document.querySelector('.sw-joy').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    // a tiny wiggle inside the dead zone does not walk
    const p0 = await page.evaluate(() => ({ ...window.__game.player.position }));
    await touch('touchStart', [[joy.x, joy.y]]);
    for (let i = 0; i < 10; i++) { await touch('touchMove', [[joy.x + 4, joy.y - 4]]); await page.waitForTimeout(40); }
    await touch('touchEnd', []);
    const p1 = await page.evaluate(() => ({ ...window.__game.player.position }));
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, `${name}: a tiny joystick wiggle stays still (dead zone)`);
    // a real push walks
    await touch('touchStart', [[joy.x, joy.y]]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[joy.x, joy.y - i * 6]]); await page.waitForTimeout(30); }
    await page.waitForTimeout(600);
    await shot(page, `joystick-${name}`, P);
    await touch('touchEnd', []);
    const p2 = await page.evaluate(() => ({ ...window.__game.player.position }));
    check(Math.hypot(p2.x - p1.x, p2.z - p1.z) > 0.8, `${name}: pushing the joystick walks (${Math.hypot(p2.x - p1.x, p2.z - p1.z).toFixed(2)} blocks)`);
    // two-finger pinch zooms the camera
    const d0 = await page.evaluate(() => window.__game.cameraRig.distance);
    // on open sky/ground, away from the HUD buttons
    const cx = viewport.width * (viewport.height > viewport.width ? 0.46 : 0.6), cy = viewport.height * (viewport.height > viewport.width ? 0.32 : 0.42);
    const hist0 = await page.evaluate(() => window.__game.history.length);
    // fingers spread apart (along the longer side of the screen)
    const tall = viewport.height > viewport.width;
    const at = (d) => (tall ? [[cx, cy - d], [cx, cy + d]] : [[cx - d, cy], [cx + d, cy]]);
    await touch('touchStart', at(30));
    for (let i = 1; i <= 10; i++) { await touch('touchMove', at(30 + i * 12)); await page.waitForTimeout(30); }
    await touch('touchEnd', []);
    await settle(page, 300);
    const d1 = await page.evaluate(() => window.__game.cameraRig.distance);
    const hist1 = await page.evaluate(() => window.__game.history.length);
    check(d1 < d0 - 0.5, `${name}: pinch zooms in (${d0.toFixed(1)} -> ${d1.toFixed(1)})`);
    check(hist1 === hist0, `${name}: pinching never builds by accident`);
    // tutorial bubble on touch
    await page.evaluate(() => window.__game.runAction('tutorial'));
    await page.waitForSelector('.sw-tut:not([hidden]) .sw-tut-card');
    await settle(page, 600);
    await shot(page, `tutorial-${name}`, P);
    const tutText = await page.evaluate(() => document.querySelector('.sw-tut-text').textContent);
    check(/joystick/i.test(tutText), `${name}: tutorial talks about the joystick ("${tutText}")`);
    await page.locator('.sw-tut-skip').tap();
    // help shows touch pictures
    await page.locator('.sw-hud .sw-round[aria-label="Help"]').tap();
    await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="help"] .sw-help-card');
    await settle(page, 300);
    await shot(page, `help-${name}`, P);
    await page.locator('.sw-panel-wrap.sw-open button.sw-btn', { hasText: 'Got it!' }).tap();
  }

  // the Bag by touch
  await page.locator('.sw-bagbtn').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src]', { timeout: 15000 });
  await settle(page, 1200);
  await shot(page, `bag-${name}`, P);
  const bagFits = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.sw-bag-head > *, .sw-bag-slot')];
    return els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; });
  });
  check(bagFits, `${name}: the Bag header and hotbar fit the screen`);
  await page.locator('.sw-bag-grid .sw-item').nth(1).tap();
  await page.waitForFunction(() => !window.__game.ui.current, null, { timeout: 4000 }).catch(() => {});
  const closed = await page.evaluate(() => window.__game.ui.current);
  check(!closed, `${name}: tapping an item puts it in the hotbar and closes the Bag`);
  // photo by touch
  await page.locator('.sw-hud .sw-round[aria-label="Photo"]').tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="photo"]', { timeout: 8000 });
  await settle(page, 800);
  await shot(page, `photo-${name}`, P);
  await page.locator('.sw-photo-done').tap();
  await context.close();
}

async function main() {
  const browser = await launch(opts);
  try {
    if (opts.only !== 'touch') await desktop(browser);
    if (opts.only !== 'desktop') {
      await touchDevice(browser, { name: 'ipad', viewport: { width: 1024, height: 768 }, deep: true });
      await touchDevice(browser, { name: 'ipad-air', viewport: { width: 1180, height: 820 } });
      await touchDevice(browser, { name: 'ipad-portrait', viewport: { width: 820, height: 1180 } });
      await touchDevice(browser, { name: 'ipad-mini-portrait', viewport: { width: 768, height: 1024 } });
      await touchDevice(browser, { name: 'phone', viewport: { width: 390, height: 844 }, deep: true });
    }
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
