// Avatar & Dress-Up probe: drives the Dress-Up Studio and the emote wheel through real clicks
// and taps, checks what they save and emit, and writes screenshots + avatar grids to
// .shots/avatar-*.png.
//
//   node tools/probe-avatar.mjs [--only=desktop|touch|grids] [--headed]

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  launch, openGame, waitForTitle, waitForPlay, waitIdle, startWorld, shot, settle, finish, SHOTS, parseArgs,
} from './smoke.mjs';

const PREFIX = 'avatar';

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

async function saveDataUrl(url, name) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  grid .shots/${PREFIX}-${name}.png`);
}

/** Render an avatar grid in the page (items built by `src`, a function body given g). */
async function grid(page, name, src, opts) {
  const url = await page.evaluate(async ([src, opts]) => {
    const g = window.__game;
    const items = new Function('g', src)(g);
    return g.debug.avatar.renderGrid(items, opts);
  }, [src, opts || {}]);
  await saveDataUrl(url, name);
}

const look = (page) => page.evaluate(() => window.__game.dressup.look);
const tabLoc = (page, key) => page.locator(`.sw-dtab[data-tab="${key}"]`);
const tileLoc = (page, name) => page.locator('.sw-dress-content .sw-dtile', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first();
const sectionLoc = (page, title) => page.locator('.sw-dress-content .sw-dsec').filter({ has: page.locator('.sw-dsec-title span', { hasText: new RegExp(`^${title}$`) }) });

async function waitThumbs(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const pics = [...document.querySelectorAll('.sw-dress-content .sw-dsec:not([hidden]) .sw-dtile:not(.sw-empty) .sw-dpic')];
    return pics.length > 0 && pics.every((p) => p.classList.contains('sw-ready'));
  }, null, { timeout }).catch(() => console.log('  (some thumbnails still rendering)'));
}

/** Turn the camera to look at her face from the front. */
async function faceCamera(page, { distance = 3.4, pitch = 0.18 } = {}) {
  await page.evaluate(([distance, pitch]) => {
    const g = window.__game;
    g.cameraRig.yaw = g.player.yaw + Math.PI;
    g.cameraRig.pitch = pitch;
    g.cameraRig.distance = distance;
  }, [distance, pitch]);
  await settle(page, 700);
}

// ---------------- desktop: the whole Studio flow ----------------

async function desktopPass(browser, errors) {
  console.log('Desktop pass (1280x800)');
  const { context, page } = await openGame(browser, { errors, label: 'desktop' });
  await page.evaluate(() => {
    const g = window.__game;
    window.__ev = { avatar: 0, outfit: 0, lastOutfit: null };
    g.events.on('avatar:changed', () => { window.__ev.avatar++; });
    g.events.on('outfit:changed', ({ look }) => { window.__ev.outfit++; window.__ev.lastOutfit = look; });
  });

  // title -> Dress Up
  await page.locator('.sw-title-small button', { hasText: 'Dress Up' }).click();
  await page.waitForFunction(() => window.__game.ui.current === 'dressup');
  await settle(page, 800);
  await waitThumbs(page);
  await shot(page, 'studio-desktop', PREFIX);

  // hair: pigtails, lavender, rainbow streaks
  await tabLoc(page, 'hair').click();
  await tileLoc(page, 'Pigtails').click();
  await sectionLoc(page, 'Hair color').locator('.sw-sw[aria-label="#C9A2FF"]').click();
  await sectionLoc(page, 'Second color').locator('.sw-sw[aria-label="Rainbow"]').click();
  await settle(page, 200);
  await sectionLoc(page, 'Color style').locator('.sw-dtile', { hasText: 'Streaks' }).click();
  let l = await look(page);
  check(errors, l.hair.style === 'pigtails' && l.hair.color === '#C9A2FF' && l.hair.color2 === 'rainbow' && l.hair.mix === 'streaks', `hair picked through the tiles and swatches (${JSON.stringify(l.hair)})`);
  await waitThumbs(page);
  await shot(page, 'studio-hair', PREFIX);

  // tops: a starry sky-blue hoodie
  await tabLoc(page, 'tops').click();
  await tileLoc(page, 'Hoodie').click();
  await sectionLoc(page, 'Color').locator('.sw-sw[aria-label="#6CC6FF"]').click();
  await sectionLoc(page, 'Pattern').locator('.sw-pat[aria-label="Stars"]').click();
  await sectionLoc(page, 'Pattern color').locator('.sw-sw[aria-label="#FFFFFF"]').click();
  l = await look(page);
  check(errors, l.top.type === 'hoodie' && l.top.color === '#6CC6FF' && l.top.pattern === 'stars', 'top type, color and pattern picked');

  // dresses: ball gown, then accessories
  await tabLoc(page, 'dresses').click();
  await tileLoc(page, 'Ball Gown').click();
  await sectionLoc(page, 'Color').locator('.sw-sw[aria-label="#C3A6FF"]').click();
  await tabLoc(page, 'hats').click();
  await tileLoc(page, 'Tiara').click();
  await tabLoc(page, 'back').click();
  await tileLoc(page, 'Fairy Wings').click();
  await tabLoc(page, 'hand').click();
  await tileLoc(page, 'Balloon').click();
  await tabLoc(page, 'shoes').click();
  await tileLoc(page, 'Sparkle Shoes').click();
  l = await look(page);
  check(errors, l.dress && l.dress.type === 'ballgown' && l.acc.head === 'tiara' && l.acc.back === 'fairy_wings' && l.acc.hand === 'balloon' && l.shoes.type === 'sparkle',
    'dress, tiara, fairy wings, balloon and sparkle shoes picked');
  check(errors, l.acc.headColor === '#FFD54A', `a tiara starts out golden (${l.acc.headColor})`);
  await waitThumbs(page);
  await settle(page, 1200);
  await shot(page, 'studio-gown', PREFIX);

  // drag on the preview to spin her
  const view = await page.locator('.sw-dress-view').boundingBox();
  const spin0 = await page.evaluate(() => window.__game.dressup.preview.spin);
  await page.mouse.move(view.x + view.width * 0.3, view.y + view.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(view.x + view.width * (0.3 + i * 0.04), view.y + view.height * 0.5);
  await page.mouse.up();
  await settle(page, 300);
  const spin1 = await page.evaluate(() => window.__game.dressup.preview.spin);
  check(errors, Math.abs(spin1 - spin0) > 0.5, `dragging the preview spins her (${spin0.toFixed(2)} -> ${spin1.toFixed(2)})`);
  await page.locator('.sw-dress-turn').click();
  await settle(page, 1500);
  await shot(page, 'studio-back-view', PREFIX);

  // outfits: save to slot 1, surprise, undo, wear a starter, wear slot 1
  await tabLoc(page, 'outfits').click();
  const saved = await look(page);
  await page.locator('.sw-dslot .sw-dtile').first().click();
  await settle(page, 300);
  const slot0 = await page.evaluate(() => window.__game.profile.outfits[0]);
  check(errors, slot0 && JSON.stringify(slot0) === JSON.stringify(saved), 'tapping an empty outfit slot saved the current look');
  await page.locator('button.sw-dress-surprise').click();
  const surprised = await look(page);
  check(errors, JSON.stringify(surprised) !== JSON.stringify(saved) && surprised.skin === saved.skin && surprised.name === saved.name,
    'Surprise me! changed the outfit (and kept skin + name)');
  await page.locator('button.sw-dress-undo').click();
  check(errors, JSON.stringify(await look(page)) === JSON.stringify(saved), 'Undo brought the saved look back');
  await tileLoc(page, 'Fairy').click();
  l = await look(page);
  check(errors, l.acc.back === 'fairy_wings' && l.acc.head === 'flower_crown' && l.bottom.type === 'tutu', 'wearing the Fairy starter outfit');
  await waitThumbs(page);
  await settle(page, 800);
  await shot(page, 'studio-outfits', PREFIX);
  await page.locator('.sw-dslot .sw-dtile').first().click();
  l = await look(page);
  check(errors, JSON.stringify(l) === JSON.stringify(saved), 'wearing saved outfit 1 again');

  // name field
  await page.locator('.sw-dress-name input').fill('Mia');
  await settle(page, 600);
  const name = await page.evaluate(() => [window.__game.profile.look.name, window.__game.profile.playerName]);
  check(errors, name[0] === 'Mia' && name[1] === 'Mia', `typing a name saves it (${name.join(', ')})`);

  // Done -> back to the title; events and profile
  await page.locator('button.sw-dress-done').click();
  await page.waitForFunction(() => window.__game.ui.current === 'title');
  const ev = await page.evaluate(() => window.__ev);
  check(errors, ev.outfit === 1 && ev.avatar >= 5 && ev.lastOutfit && ev.lastOutfit.name === 'Mia',
    `closing the Studio emitted outfit:changed once (avatar:changed ${ev.avatar}x)`);
  const prof = await page.evaluate(() => window.__game.profile.look);
  check(errors, prof.dress && prof.dress.type === 'ballgown' && prof.acc.head === 'tiara', 'profile.look holds the new outfit');

  // survives a reload
  await page.waitForTimeout(700);
  await page.reload();
  await waitForTitle(page);
  const after = await page.evaluate(() => ({ look: window.__game.profile.look, slot: window.__game.profile.outfits[0] }));
  check(errors, after.look.name === 'Mia' && after.look.acc.hand === 'balloon' && after.slot && after.slot.dress.type === 'ballgown', 'look and saved outfit persisted after reload');

  // into a world: the avatar wears it
  await startWorld(page, 'meadow');
  await settle(page, 600);
  const sigOk = await page.evaluate(() => {
    const g = window.__game;
    return g.player.avatar.signature === JSON.stringify(g.debug.avatar.look());
  });
  check(errors, sigOk, 'the in-world avatar wears the saved look');
  await faceCamera(page);
  await shot(page, 'world-front', PREFIX);

  // HUD Dress Up button -> Studio in the world -> pick bunny ears -> Done
  await page.locator('.sw-hud-tr button[aria-label="Dress Up"]').click();
  await page.waitForFunction(() => window.__game.ui.current === 'dressup');
  await tabLoc(page, 'hats').click();
  await tileLoc(page, 'Bunny Ears').click();
  await tabLoc(page, 'hair').click();
  await tileLoc(page, 'Space Buns').click();
  await page.locator('button.sw-dress-done').click();
  await page.waitForFunction(() => window.__game.ui.current === null && window.__game.mode === 'play');
  await settle(page, 400);
  const worn = await page.evaluate(() => ({ head: window.__game.player.avatar.look.acc.head, hair: window.__game.player.avatar.look.hair.style }));
  check(errors, worn.head === 'bunny_ears' && worn.hair === 'space_buns', 'changes made from the HUD Studio show on the in-world avatar');
  await faceCamera(page);
  await shot(page, 'world-bunny', PREFIX);

  // walking past the camera: hair, skirt and balloon swing
  await page.evaluate(() => { const g = window.__game; g.cameraRig.pitch = 0.15; g.cameraRig.distance = 4.2; });
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await shot(page, 'world-walk', PREFIX);
  await page.keyboard.up('d');
  await settle(page, 600);

  // emote wheel: G opens it, pictures render, clicking Dance plays it
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__game.ui.current === 'emotes');
  await page.waitForFunction(() => [...document.querySelectorAll('.sw-emo-face canvas')].every((c) => !c.hidden), null, { timeout: 20000 }).catch(() => {});
  await settle(page, 500);
  await shot(page, 'emote-wheel', PREFIX);
  await page.locator('.sw-emo-btn[data-emote="dance"]').click();
  await settle(page, 150);
  const st = await page.evaluate(() => ({ panel: window.__game.ui.current, state: window.__game.player.state, emote: window.__game.player.avatar.emoting }));
  check(errors, st.panel === null && st.state === 'emote' && st.emote === 'dance', `picking Dance closes the wheel and dances (${JSON.stringify(st)})`);
  await faceCamera(page);
  await shot(page, 'world-dance', PREFIX);
  await page.waitForTimeout(3600);
  // keyboard: G, then 6 = heart
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__game.ui.current === 'emotes');
  await page.keyboard.press('6');
  await settle(page, 900);
  const heart = await page.evaluate(() => window.__game.player.avatar.emoting);
  check(errors, heart === 'heart', 'key 6 in the wheel plays Heart hands');
  await shot(page, 'world-heart', PREFIX);
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__game.ui.current === 'emotes');
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__game.ui.current === null);
  console.log('  ok: G opens and closes the wheel');

  // bed + chair poses in daylight
  const poses = await page.evaluate(async () => {
    const g = window.__game, d = g.debug, p = g.player.position;
    g.setDayTime(0.4);
    const fx = Math.round(Math.sin(g.player.yaw)), fz = Math.round(Math.cos(g.player.yaw));
    const bx = Math.floor(p.x) + fx * 3 + (fz ? 2 : 0), bz = Math.floor(p.z) + fz * 3 + (fx ? 2 : 0);
    d.place('bed_single', bx, d.heightAt(bx, bz) + 1, bz, 0);
    const cx = Math.floor(p.x) + fx * 3 - (fz ? 2 : 0), cz = Math.floor(p.z) + fz * 3 - (fx ? 2 : 0);
    d.place('chair', cx, d.heightAt(cx, cz) + 1, cz, 0);
    const ents = d.entities();
    return { bed: ents.find((e) => e.key === 'bed_single'), chair: ents.find((e) => e.key === 'chair') };
  });
  if (poses.chair) {
    await page.evaluate((uid) => window.__game.debug.interact(uid), poses.chair.uid);
    await settle(page, 900);
    const s = await page.evaluate(() => window.__game.player.state);
    check(errors, s === 'sit', 'sitting on a chair');
    await faceCamera(page, { distance: 3, pitch: 0.25 });
    await shot(page, 'world-sit', PREFIX);
    await page.evaluate(() => window.__game.player.stand());
  }
  if (poses.bed) {
    await page.evaluate((uid) => window.__game.debug.interact(uid), poses.bed.uid);
    await page.waitForTimeout(3800);
    const s = await page.evaluate(() => window.__game.player.state);
    check(errors, s === 'sleep', 'lying in bed');
    await page.evaluate(() => { const g = window.__game; g.cameraRig.yaw = g.player.yaw + 2.4; g.cameraRig.pitch = 0.75; g.cameraRig.distance = 3.2; });
    await settle(page, 900);
    await shot(page, 'world-sleep', PREFIX);
    await page.evaluate(() => window.__game.player.stand());
  }

  // flying
  await page.evaluate(() => { const g = window.__game; g.player.setFlying(true); g.player.velocity.y = 4; });
  await settle(page, 900);
  await faceCamera(page, { distance: 3.6, pitch: 0.1 });
  await shot(page, 'world-fly', PREFIX);
  await page.evaluate(() => window.__game.player.setFlying(false));

  // a faded avatar (camera very close) renders with its own transparent materials
  const fade = await page.evaluate(() => {
    const g = window.__game, av = g.player.avatar;
    av.setOpacity(0.4);
    const o = av.opacity;
    g.renderer.render(g.scene, g.camera);
    av.setOpacity(1);
    g.renderer.render(g.scene, g.camera);
    return o;
  });
  check(errors, Math.abs(fade - 0.4) < 0.01, 'setOpacity fades the avatar (camera fade) without errors');

  // leaks: 60 random looks on the player's avatar, then back; textures stay bounded
  const mem = await page.evaluate(async () => {
    const g = window.__game, av = g.player.avatar, r = g.renderer.info.memory;
    const start = { geo: r.geometries, tex: r.textures, cache: g.debug.avatar.textures().textures };
    const orig = g.debug.avatar.look();
    for (let i = 0; i < 60; i++) {
      av.setLook(g.debug.avatar.random(1000 + i));
      await new Promise((res) => requestAnimationFrame(res));
    }
    av.setLook(orig);
    await new Promise((res) => setTimeout(res, 300));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) av.setLook(g.debug.avatar.random(i));
    const perLook = (performance.now() - t0) / 20;
    av.setLook(orig);
    await new Promise((res) => setTimeout(res, 300));
    const meshes = [];
    av.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    return { start, end: { geo: r.geometries, tex: r.textures, cache: g.debug.avatar.textures().textures }, perLook, meshes: meshes.length };
  });
  console.log(`  memory: geometries ${mem.start.geo} -> ${mem.end.geo}, textures ${mem.start.tex} -> ${mem.end.tex}, avatar texture cache ${mem.start.cache} -> ${mem.end.cache}; setLook ~${mem.perLook.toFixed(1)} ms; ${mem.meshes} meshes`);
  check(errors, mem.end.geo <= mem.start.geo + 4, 'no geometry leak after 60 looks');
  check(errors, mem.end.cache <= 90, 'avatar texture cache stays bounded');

  // opening + closing the Studio repeatedly does not pile up GPU memory
  const studio = await page.evaluate(async () => {
    const g = window.__game;
    const r = g.renderer.info.memory;
    const before = r.geometries;
    for (let i = 0; i < 4; i++) {
      g.runAction('dressup');
      await new Promise((res) => setTimeout(res, 400));
      g.ui.close();
      await new Promise((res) => setTimeout(res, 100));
    }
    return { before, after: r.geometries, panel: g.ui.current };
  });
  check(errors, studio.after <= studio.before + 2 && studio.panel === null, `Studio open/close x4 keeps the world renderer tidy (${studio.before} -> ${studio.after})`);
  await context.close();
}

// ---------------- phone + iPad ----------------

async function touchPass(browser, errors) {
  console.log('Phone pass (390x844, touch)');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 390, height: 844 }, touch: true, label: 'phone' });
  await page.locator('.sw-title-small button', { hasText: 'Dress Up' }).tap();
  await page.waitForFunction(() => window.__game.ui.current === 'dressup');
  await tabLoc(page, 'dresses').tap();
  await tileLoc(page, 'Princess Dress').tap();
  await sectionLoc(page, 'Color').locator('.sw-sw[aria-label="#FFD1E6"]').tap();
  await tabLoc(page, 'hats').tap();
  await tileLoc(page, 'Crown').tap();
  const l = await look(page);
  check(errors, l.dress && l.dress.type === 'princess' && l.acc.head === 'crown', 'taps on phone tabs, tiles and swatches work');
  await tabLoc(page, 'dresses').tap();
  await waitThumbs(page);
  await settle(page, 800);
  await shot(page, 'studio-phone', PREFIX);
  // nothing in the Studio is wider than the phone
  const overflow = await page.evaluate(() => document.querySelector('.sw-dress').scrollWidth - window.innerWidth);
  check(errors, overflow <= 0, 'the Studio fits the phone width');
  await tabLoc(page, 'outfits').tap();
  await waitThumbs(page);
  await shot(page, 'studio-phone-outfits', PREFIX);
  await page.locator('button.sw-dress-done').tap();
  await page.waitForFunction(() => window.__game.ui.current === 'title');

  // emote wheel from the HUD on the phone
  await startWorld(page, 'meadow', { tap: true });
  await settle(page, 500);
  await page.locator('.sw-hud-right button[aria-label="Emotes"]').tap();
  await page.waitForFunction(() => window.__game.ui.current === 'emotes');
  await page.waitForFunction(() => [...document.querySelectorAll('.sw-emo-face canvas')].every((c) => !c.hidden), null, { timeout: 20000 }).catch(() => {});
  await settle(page, 400);
  await shot(page, 'emote-wheel-phone', PREFIX);
  await page.locator('.sw-emo-btn[data-emote="twirl"]').tap();
  await settle(page, 200);
  const em = await page.evaluate(() => window.__game.player.avatar.emoting);
  check(errors, em === 'twirl', 'tapping Twirl in the wheel twirls');
  await context.close();

  console.log('iPad pass (1024x768, touch)');
  const ipad = await openGame(browser, { errors, viewport: { width: 1024, height: 768 }, touch: true, label: 'ipad' });
  await ipad.page.locator('.sw-title-small button', { hasText: 'Dress Up' }).tap();
  await ipad.page.waitForFunction(() => window.__game.ui.current === 'dressup');
  await tabLoc(ipad.page, 'back').tap();
  await tileLoc(ipad.page, 'Butterfly Wings').tap();
  await waitThumbs(ipad.page);
  await settle(ipad.page, 1200);
  await shot(ipad.page, 'studio-ipad', PREFIX);
  await ipad.context.close();
}

// ---------------- grids ----------------

async function gridsPass(browser, errors) {
  console.log('Avatar grids');
  const { context, page } = await openGame(browser, { errors, label: 'grids' });
  const outfitsSrc = `
    const s = g.debug.avatar.starters();
    const base = g.debug.avatar.look();
    const r1 = g.debug.avatar.random(7, { ...base, skin: '#8C5535', hair: { ...base.hair, color: '#1F1614' } });
    const r2 = g.debug.avatar.random(21, { ...base, skin: '#E4AE86', hair: { ...base.hair, color: '#EACB86' } });
    const looks = [...s.map((o, i) => ({ look: { ...o.look, skin: ['#F6D2B8','#C3845A','#FFE6D8','#6D4029','#E4AE86','#A96C45'][i], hair: { ...o.look.hair, color: ['#7A4A2A','#1F1614','#EACB86','#3B2419','#D9762F','#FF8CC6'][i] } }, label: o.name })), { look: r1, label: 'Surprise 1' }, { look: r2, label: 'Surprise 2' }];
    return looks`;
  await grid(page, 'outfits-front', `${outfitsSrc}.map((x) => ({ ...x, frame: { cy: 0.97, span: 2.25, yaw: 0.25, pitch: 0.1 } }));`, { cols: 4, size: 260 });
  await grid(page, 'outfits-back', `${outfitsSrc}.map((x) => ({ ...x, label: x.label + ' (back)', frame: { cy: 0.97, span: 2.25, yaw: Math.PI * 0.86, pitch: 0.1 } }));`, { cols: 4, size: 260 });
  await grid(page, 'hair-styles', `
    const base = g.debug.avatar.look();
    const colors = ['#7A4A2A','#1F1614','#EACB86','#D9762F','#FF8CC6','#C9A2FF','#3B2419','#A0592D','#7FD3FF','#F7E7B7','#9C7BFF','#5FE3C0'];
    return g.debug.avatar.hairStyles().map((s, i) => ({ look: { ...base, acc: { ...base.acc, head: 'none' }, hair: { style: s, color: colors[i], color2: i === 4 ? 'rainbow' : i === 10 ? '#FF8CC6' : null, mix: i === 10 ? 'ombre' : 'streaks' } }, label: s, frame: { cy: 1.3, span: 1.35, yaw: 0.7, pitch: 0.12 } }));`, { cols: 6, size: 220, aspect: 0.85 });
  await grid(page, 'emotes', `
    const b = g.debug.avatar.starters()[3].look;
    return [['wave',0.8],['dance',0.6],['twirl',0.5],['cartwheel',0.62],['jump',0.47],['heart',1.0],['sit',2]].map(([e,t]) => ({ look: b, label: e, pose: { emote: e, t }, frame: { cy: 1.05, span: 2.35, yaw: 0.3, pitch: 0.1 } }));`, { cols: 7, size: 200, aspect: 0.8 });
  await grid(page, 'poses', `
    const b = g.debug.avatar.starters()[0].look, c = g.debug.avatar.starters()[1].look;
    const f = (cy, span, yaw = 0.6, pitch = 0.15) => ({ cy, span, yaw, pitch });
    return [
      { look: c, label: 'walk', pose: { state: { onGround: true, speed: 4.3 }, t: 0.37 }, frame: f(0.95, 2.3, 1.2) },
      { look: c, label: 'run', pose: { state: { onGround: true, speed: 6.5 }, t: 0.5 }, frame: f(0.95, 2.3, 1.3) },
      { look: c, label: 'sit', pose: { state: { sitting: true }, t: 1.2 }, frame: f(0.45, 1.9, 0.9) },
      { look: b, label: 'sleep', pose: { state: { sleeping: true }, t: 1.5 }, frame: f(0.2, 2.2, 1.2, 0.9) },
      { look: c, label: 'swim', pose: { state: { swimming: true, speed: 2.8 }, t: 0.9 }, frame: f(0.95, 2.3, 1.2) },
      { look: b, label: 'fly', pose: { state: { flying: true, speed: 9 }, t: 1 }, frame: f(0.95, 2.3, 1.3) },
      { look: c, label: 'ride', pose: { state: { riding: true }, t: 1 }, frame: f(0.5, 1.9, 0.7) },
      { look: b, label: 'jump', pose: { state: { onGround: false, speed: 2 }, t: 0.3 }, frame: f(0.95, 2.3, 0.5) },
    ];`, { cols: 4, size: 230, aspect: 0.85 });
  await grid(page, 'accessories', `
    const b = { ...g.debug.avatar.look(), hair: { style: 'bob', color: '#7A4A2A', color2: null, mix: 'ombre' } };
    const out = [];
    for (const [k, c] of [['bow','#FF5FA2'],['tiara','#FFD54A'],['crown','#FFD54A'],['flower_crown','#FF8CC6'],['cat_ears','#FFD1E6'],['bunny_ears','#FFFFFF'],['unicorn_horn','#FFE58A'],['beanie','#FFFFFF'],['sun_hat','#FF8CC6'],['headband','#9C7BFF'],['witch_hat','#9C7BFF'],['halo','#FFD54A']]) out.push({ look: { ...b, acc: { ...b.acc, head: k, headColor: c } }, label: k, frame: { cy: 1.6, span: 1.3, yaw: 0.45, pitch: 0.14 } });
    for (const k of ['glasses','sunglasses','heart_glasses','star_glasses']) out.push({ look: { ...b, acc: { ...b.acc, head: 'none', face: k } }, label: k, frame: 'face' });
    for (const k of ['necklace','pearls','scarf','bowtie']) out.push({ look: { ...b, acc: { ...b.acc, head: 'none', neck: k, neckColor: k === 'pearls' ? '#FFFFFF' : k === 'necklace' ? '#FFD54A' : '#FF8CC6' } }, label: k, frame: 'neck' });
    for (const [k, c] of [['fairy_wings','#A5F0E6'],['butterfly_wings','#6CC6FF'],['angel_wings','#FFD1E6'],['backpack','#FFD43B'],['cape','#9C7BFF']]) out.push({ look: { ...b, acc: { ...b.acc, back: k, backColor: c } }, label: k, frame: 'back' });
    for (const k of ['wand','purse','balloon','teddy','ice_cream']) out.push({ look: { ...b, acc: { ...b.acc, hand: k } }, label: k, frame: 'hand' });
    return out;`, { cols: 6, size: 200, aspect: 0.85 });
  await grid(page, 'clothes', `
    const b = g.debug.avatar.look(); const out = [];
    const tops = ['tshirt','tank','hoodie','sweater','blouse','crop','jacket','sparkle_top'];
    tops.forEach((k, i) => out.push({ look: { ...b, top: { type: k, color: ['#FF8CC6','#6CC6FF','#9C7BFF','#FF6B6B','#FFF4E0','#3FD8B0','#FFD43B','#E6DDFF'][i], pattern: ['none','stars','hearts','stars','none','dots','none','rainbow'][i], patternColor: '#FFFFFF' } }, label: k, frame: 'torso' }));
    ['skirt','tutu','jeans','leggings','shorts','overalls','pleated'].forEach((k, i) => out.push({ look: { ...b, bottom: { type: k, color: ['#8E7CFF','#FF8CC6','#4D7CFF','#222230','#FFA94D','#6CC6FF','#E64980'][i], pattern: k === 'pleated' ? 'stripes' : k === 'skirt' ? 'flowers' : 'none', patternColor: '#FFFFFF' } }, label: k, frame: 'legs' }));
    ['sundress','party','princess','ballgown','overall_dress','mermaid'].forEach((k, i) => out.push({ look: { ...b, dress: { type: k, color: ['#FFD43B','#FF8CC6','#C3A6FF','#6CC6FF','#4D7CFF','#3FD8B0'][i], pattern: ['flowers','dots','hearts','stars','none','none'][i], patternColor: '#FFFFFF' } }, label: k, frame: 'dress' }));
    ['sneakers','boots','sandals','sparkle','rainboots','ballet','roller_skates'].forEach((k, i) => out.push({ look: { ...b, shoes: { type: k, color: ['#FF5FA2','#8B5E3C','#FFD43B','#C3A6FF','#FFD43B','#FF8CC6','#6CC6FF'][i] } }, label: k, frame: 'feet' }));
    return out;`, { cols: 7, size: 190, aspect: 0.85 });
  await grid(page, 'faces', `
    const b = { ...g.debug.avatar.look(), acc: { ...g.debug.avatar.look().acc, head: 'none' } };
    const skins = ['#FFE6D8','#F6D2B8','#E4AE86','#C3845A','#8C5535','#51301E'];
    const out = skins.map((s, i) => ({ look: { ...b, skin: s, eyes: { color: ['#3F7AC9','#5A3A28','#3C9A64','#8B6BD6','#2E1E14','#E0569A'][i], lashes: i !== 3 }, face: { blush: true, freckles: i === 1 || i === 3, smile: ['happy','grin','cat','open','happy','grin'][i] } }, label: s, frame: 'face' }));
    return out;`, { cols: 6, size: 200, aspect: 0.9 });
  await context.close();
}

async function main() {
  const opts = parseArgs();
  const errors = [];
  const browser = await launch(opts);
  try {
    if (!opts.only || opts.only === 'desktop') await desktopPass(browser, errors);
    if (!opts.only || opts.only === 'touch') await touchPass(browser, errors);
    if (!opts.only || opts.only === 'grids') await gridsPass(browser, errors);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();

export { waitForPlay, waitIdle };
