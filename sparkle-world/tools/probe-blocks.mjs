// Block library & world types probe (team "blocks").
//
//   node tools/probe-blocks.mjs [--only=sheets,gallery,biomes,bench,ui] [--biomes=meadow,candy] [--seed=7]
//
// - sheets:  texture contact sheets (every tile at 5x) and every block's Bag icon
// - gallery: every block placed in rows in a flat world, shot by day and by night
// - biomes:  every world type from the spawn (real HUD view) and from high above
// - bench:   Big-world generation time per biome, determinism, gem spots, spawn safety
// - ui:      New World wizard -> Everything Land through real clicks; Bag tabs + placing a
//            candy block with real clicks; Hand-tapping the Music Block
// Screenshots go to .shots/blocks-*.png. Fails on any console error.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, openGame, waitForPlay, waitIdle, shot, settle, finish, SHOTS, screenPoint } from './smoke.mjs';

const PREFIX = 'blocks';
const ALL_BIOMES = ['meadow', 'candy', 'beach', 'snow', 'fairy', 'flat', 'mix'];
const CANONICAL = `grass dirt stone cobble sand water snow ice log_oak leaves_oak leaves_cherry log_birch
planks_oak planks_pink planks_white planks_lavender planks_mint glass glass_pink glass_heart
brick_red brick_pink brick_white quartz marble frosting_pink frosting_white
cookie chocolate candy_cane lollipop_block moss mushroom_glow
crystal_pink crystal_blue lamp_block lantern sea_lantern farmland farmland_wet flower_rose flower_tulip
flower_daisy flower_sunflower flower_lavender flower_poppy grass_tall cloud rainbow shell
coral palm_log palm_leaves pine_leaves snow_leaves wallpaper_hearts
wallpaper_stars wallpaper_stripes wallpaper_flowers tile_kitchen tile_bath roof_red
roof_blue roof_pink hay slab_oak`.split(/\s+/).filter(Boolean)
  .concat(['red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'sky', 'blue', 'purple', 'magenta', 'pink', 'white', 'lightgray', 'gray', 'black', 'brown'].flatMap((c) => ['wool_' + c, 'carpet_' + c]));

function parse() {
  const o = { only: null, biomes: ALL_BIOMES, seed: 7, size: 'cozy' };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'only') o.only = new Set(v.split(','));
    if (k === 'biomes') o.biomes = v.split(',');
    if (k === 'seed') o.seed = Number(v);
    if (k === 'size') o.size = v;
  }
  return o;
}

function check(errors, cond, msg) {
  if (!cond) errors.push('[check] ' + msg);
  else console.log('  ok: ' + msg);
}

async function saveDataUrl(name, dataUrl) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  screenshot ${path.relative(path.dirname(SHOTS), file)}`);
}

/** Render the scene from a free camera (no HUD), with fog pushed far away. */
async function freeShot(page, name, { pos, look, fov = 60, far = true }) {
  await settle(page, 250);
  const url = await page.evaluate(({ pos, look, fov, far }) => {
    const g = window.__game;
    const cam = g.camera.clone();
    cam.fov = fov;
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.lookAt(look[0], look[1], look[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const bu = g.blockUniforms, fog = g.scene.fog;
    const saved = [bu.uFogNear.value, bu.uFogFar.value, fog.near, fog.far];
    if (far) { bu.uFogNear.value = 230; bu.uFogFar.value = 420; fog.near = 230; fog.far = 420; }
    g.renderer.render(g.scene, cam);
    const out = g.renderer.domElement.toDataURL('image/png');
    [bu.uFogNear.value, bu.uFogFar.value, fog.near, fog.far] = saved;
    return out;
  }, { pos, look, fov, far });
  await saveDataUrl(name, url);
}

async function newWorld(page, opts) {
  await page.evaluate((o) => window.__game.debug.newWorld(o), opts);
  await waitForPlay(page);
  await waitIdle(page);
  await settle(page, 500);
}

// ---------------- sheets ----------------

async function sheets(page) {
  const list = await page.evaluate(async () => {
    const g = window.__game, B = g.registry.blocks;
    const out = [];
    const keys = [...B.painters.keys()];
    const Z = 6, cell = 16 * Z, pad = 10, cols = 10, labelH = 16, per = 60;
    for (let s = 0; s * per < keys.length; s++) {
      const part = keys.slice(s * per, (s + 1) * per);
      const rows = Math.ceil(part.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * (cell + pad) + pad;
      c.height = rows * (cell + pad + labelH) + pad;
      const x = c.getContext('2d');
      x.fillStyle = '#FFF8FC'; x.fillRect(0, 0, c.width, c.height);
      x.imageSmoothingEnabled = false;
      part.forEach((k, i) => {
        const cx = pad + (i % cols) * (cell + pad), cy = pad + Math.floor(i / cols) * (cell + pad + labelH);
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
          x.fillStyle = (xx + yy) % 2 ? '#D8D0E4' : '#EEE8F4';
          x.fillRect(cx + xx * cell / 4, cy + yy * cell / 4, cell / 4, cell / 4);
        }
        x.drawImage(B.tileCanvas(k), cx, cy, cell, cell);
        x.fillStyle = '#3A1F4D'; x.font = '12px sans-serif';
        x.fillText(k.slice(0, 15), cx, cy + cell + 13);
      });
      out.push({ name: `tiles-${s + 1}`, dataUrl: c.toDataURL('image/png') });
    }
    const tabs = ['nature', 'building', 'colors', 'candy', 'glass', 'lights', 'garden', 'fun'];
    const items = [];
    for (const t of tabs) for (const it of g.registry.items.byCategory(t)) if (it.kind === 'block') items.push([t, it]);
    const icon = 64, ic = 14, perIcons = 112;
    for (let s = 0; s * perIcons < items.length; s++) {
      const part = items.slice(s * perIcons, (s + 1) * perIcons);
      const rows = Math.ceil(part.length / ic);
      const c = document.createElement('canvas');
      c.width = ic * (icon + 20) + 10; c.height = rows * (icon + 30) + 10;
      const x = c.getContext('2d');
      x.fillStyle = '#FFF8FC'; x.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < part.length; i++) {
        const [t, it] = part[i];
        const url = await g.registry.items.iconFor(it.key);
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
        const cx = 10 + (i % ic) * (icon + 20), cy = 10 + Math.floor(i / ic) * (icon + 30);
        x.drawImage(img, cx, cy, icon, icon);
        x.fillStyle = '#3A1F4D'; x.font = '10px sans-serif';
        x.fillText(it.name.slice(0, 15), cx, cy + icon + 10);
        x.fillStyle = '#9C7BFF'; x.fillText(t, cx, cy + icon + 21);
      }
      out.push({ name: `icons-${s + 1}`, dataUrl: c.toDataURL('image/png') });
    }
    return out;
  });
  for (const s of list) await saveDataUrl(s.name, s.dataUrl);
}

// ---------------- library checks ----------------

async function libraryChecks(page, errors) {
  const r = await page.evaluate((canon) => {
    const g = window.__game, B = g.registry.blocks;
    const all = B.all();
    const tabs = ['nature', 'building', 'colors', 'candy', 'glass', 'lights', 'garden', 'fun'];
    const counts = Object.fromEntries(tabs.map((t) => [t, g.registry.items.byCategory(t).filter((i) => i.kind === 'block').length]));
    return {
      total: all.length,
      visible: all.filter((d) => !d.hidden).length,
      missing: canon.filter((k) => !B.has(k)),
      badCat: all.filter((d) => !d.hidden && !tabs.includes(d.category)).map((d) => d.key),
      unnamed: all.filter((d) => !d.name || /_/.test(d.name)).map((d) => d.key),
      noPainter: [...new Set(all.flatMap((d) => [0, 1, 2, 3, 4, 5].map((f) => B.faceTile(d, f))))].filter((t) => t && !B.painters.has(t)),
      lights: all.filter((d) => d.light > 0).map((d) => `${d.key}:${d.light}`),
      counts,
    };
  }, CANONICAL);
  console.log(`  blocks: ${r.total} registered (${r.visible} in the Bag); per tab ${JSON.stringify(r.counts)}`);
  console.log(`  glowing: ${r.lights.join(' ')}`);
  check(errors, r.total >= 130, `at least 130 blocks (${r.total})`);
  check(errors, r.total <= 230, `leaves room for other teams under the 255 id limit (${r.total})`);
  check(errors, r.missing.length === 0, `every canonical key exists${r.missing.length ? ' (missing ' + r.missing.join(', ') + ')' : ''}`);
  check(errors, r.badCat.length === 0, `every visible block sits in a block tab${r.badCat.length ? ' (' + r.badCat.join(', ') + ')' : ''}`);
  check(errors, r.unnamed.length === 0, `every block has a friendly name${r.unnamed.length ? ' (' + r.unnamed.join(', ') + ')' : ''}`);
  check(errors, r.noPainter.length === 0, `every face has a painted tile${r.noPainter.length ? ' (' + r.noPainter.join(', ') + ')' : ''}`);
  check(errors, Object.values(r.counts).every((n) => n >= 10), 'every block tab has at least 10 blocks');
}

// ---------------- gallery ----------------

async function gallery(page) {
  await newWorld(page, { biome: 'flat', size: 'cozy', seed: 3, name: 'Block Gallery' });
  const layout = await page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.registry.blocks;
    const tabs = ['nature', 'building', 'colors', 'candy', 'glass', 'lights', 'garden', 'fun'];
    const y = 17, x0 = 40, z0 = 40, perRow = 26;
    let row = 0;
    const tabRow = {};
    w.batch(() => {
      // clear the area (flat worlds have a few flowers)
      for (let z = z0 - 4; z < z0 + 60; z++) for (let x = x0 - 4; x < x0 + perRow * 2 + 4; x++) for (let yy = 17; yy < 22; yy++) w.set(x, yy, z, 0, { record: false });
      for (const t of tabs) {
        const defs = B.all().filter((d) => d.category === t && !d.hidden);
        tabRow[t] = row;
        for (let i = 0; i < defs.length; i++) {
          if (i > 0 && i % perRow === 0) row++;
          const x = x0 + (i % perRow), z = z0 + row * 2;
          w.set(x, y, z, defs[i].id, { record: false });
        }
        row += 1;
      }
    });
    g.player.teleport(x0 + perRow + 6, 17, z0 - 6);
    return { x0, z0, rows: row, perRow, tabRow };
  });
  await waitIdle(page);
  const { x0, z0, rows, perRow, tabRow } = layout;
  const cx = x0 + perRow / 2, depth = rows * 2;
  const views = [
    ['gallery-day', 0.5, { pos: [cx, 36, z0 - 4], look: [cx, 16, z0 + depth * 0.5], fov: 62 }],
    ['gallery-front', 0.5, { pos: [cx, 24, z0 - 9], look: [cx, 17, z0 + 7], fov: 60 }],
    ['gallery-middle', 0.5, { pos: [cx, 24, z0 + depth * 0.35 - 9], look: [cx, 17, z0 + depth * 0.35 + 7], fov: 60 }],
    ['gallery-back', 0.5, { pos: [cx, 24, z0 + depth * 0.7 - 9], look: [cx, 17, z0 + depth * 0.7 + 7], fov: 60 }],
  ];
  const lz = z0 + tabRow.lights * 2;
  views.push(['gallery-night', 0.92, { pos: [cx, 36, z0 - 4], look: [cx, 16, z0 + depth * 0.5], fov: 62 }]);
  views.push(['gallery-night-lights', 0.92, { pos: [x0 + 8, 22, lz - 8], look: [x0 + 8, 17, lz + 3], fov: 60 }]);
  for (const [name, time, v] of views) {
    await page.evaluate((t) => window.__game.setDayTime(t), time);
    await settle(page, 400);
    await freeShot(page, name, v);
  }
  await page.evaluate(() => window.__game.setDayTime(0.4));
}

// ---------------- biomes ----------------

async function biomes(page, opts, errors) {
  for (const biome of opts.biomes) {
    await newWorld(page, { biome, size: opts.size, seed: opts.seed, name: 'Probe ' + biome });
    const tag = opts.size === 'cozy' ? biome : `${biome}-${opts.size}`;
    const info = await page.evaluate(() => {
      const g = window.__game, w = g.world;
      return { spawn: w.meta.spawn, sx: w.sx, sz: w.sz, gems: (w.gemSpots || []).length, p: g.player.position.toArray() };
    });
    await page.evaluate(() => window.__game.setDayTime(0.42));
    await settle(page, 700);
    await shot(page, `biome-${tag}-spawn`, PREFIX);
    const c = info.sx / 2;
    await freeShot(page, `biome-${tag}-aerial`, { pos: [c, Math.min(70, 30 + info.sx * 0.4), info.sz + info.sx * 0.3], look: [c, 18, c - 6], fov: 62 });
    await freeShot(page, `biome-${tag}-low`, { pos: [c + 3, info.spawn[1] + 14, c + 26], look: [c, info.spawn[1] + 2, c - 22], fov: 65 });
    if (biome === 'fairy' || biome === 'candy' || biome === 'meadow') {
      await page.evaluate(() => window.__game.setDayTime(0.93));
      await settle(page, 700);
      await freeShot(page, `biome-${tag}-night`, { pos: [c + 3, info.spawn[1] + 12, c + 24], look: [c, info.spawn[1] + 1, c - 22], fov: 65 });
    }
    // a close look at the waterfall (meadow, fairy)
    const fall = await page.evaluate(() => {
      const g = window.__game, w = g.world, water = g.registry.blocks.idOf('water');
      let best = null;
      for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
        let run = 0;
        for (let y = w.sy - 2; y > 1; y--) {
          if (w.get(x, y, z) === water) { run++; if (run >= 4 && y + run - 1 > w.waterLevel + 2 && (!best || y + run > best[1] + best[3])) best = [x, y, z, run]; } else run = 0;
        }
      }
      return best;
    });
    await page.evaluate(() => window.__game.setDayTime(0.42));
    await settle(page, 900);
    if (fall) {
      const [fx, fy, fz, run] = fall;
      const sp = info.spawn;
      const dx = sp[0] - fx, dz = sp[2] - fz, dl = Math.hypot(dx, dz) || 1;
      await freeShot(page, `biome-${tag}-waterfall`, { pos: [fx + (dx / dl) * 13, fy + run * 0.5 + 5, fz + (dz / dl) * 13], look: [fx, fy + run * 0.4, fz], fov: 60 });
    }
    check(errors, info.gems >= 20 && info.gems <= 30, `${biome}: ${info.gems} gem spots`);
  }
}

// ---------------- bench ----------------

async function bench(page, opts, errors) {
  for (const biome of ALL_BIOMES) {
    const r = await page.evaluate(({ b, s }) => {
      const g = window.__game, W = g.worldgen;
      const a = W.benchmark(b, 'big', s);
      const again = W.benchmark(b, 'big', s);
      const other = W.benchmark(b, 'big', s + 1);
      const cozy = W.benchmark(b, 'cozy', s);
      // gem spots must be air; the spawn must be a free standing spot
      const w = W.generate(b, 'big', s);
      const air = (w.gemSpots || []).every(([x, y, z]) => w.get(x, y, z) === 0);
      const sp = a.spawn.map(Math.floor);
      const solid = g.registry.blocks.props.solid;
      const spawnOk = solid[w.get(sp[0], sp[1] - 1, sp[2])] === 1 && w.get(sp[0], sp[1], sp[2]) === 0 && w.get(sp[0], sp[1] + 1, sp[2]) === 0;
      return { genMs: a.genMs, genMs2: again.genMs, lightMs: a.lightMs, cozyMs: cozy.genMs, same: a.hash === again.hash, differs: a.hash !== other.hash, gems: a.gems, cozyGems: cozy.gems, air, spawnOk, spawn: a.spawn };
    }, { b: biome, s: opts.seed });
    const best = Math.min(r.genMs, r.genMs2);
    console.log(`  ${biome.padEnd(7)} big: gen ${best} ms (light ${r.lightMs} ms), cozy gen ${r.cozyMs} ms, gems ${r.gems}/${r.cozyGems}, spawn ${r.spawn.map((v) => v.toFixed(1)).join(',')}`);
    check(errors, best < 1500, `${biome}: Big world generates in ${best} ms (< 1500)`);
    check(errors, r.same && r.differs, `${biome}: same seed -> same world, other seed -> another world`);
    check(errors, r.gems >= 20 && r.gems <= 30 && r.cozyGems >= 20 && r.cozyGems <= 30 && r.air, `${biome}: 20-30 gem spots in air cells`);
    check(errors, r.spawnOk, `${biome}: spawn is a safe standing spot`);
  }
}

// ---------------- real UI ----------------

async function ui(page, errors) {
  // New World wizard -> Everything Land through real clicks
  await page.evaluate(() => window.__game.exitToTitle());
  await page.waitForFunction(() => window.__game.ui.current === 'title');
  await settle(page, 400);
  await page.locator('button.sw-btn', { hasText: 'New World' }).first().click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
  const cards = await page.locator('.sw-biome').count();
  check(errors, cards === 7, `New World shows 7 world types (${cards})`);
  await page.locator('.sw-biome', { hasText: 'Everything Land' }).first().click();
  await settle(page, 400);
  await shot(page, 'ui-newworld', PREFIX);
  await page.locator('button.sw-create').click();
  await waitForPlay(page);
  await waitIdle(page);
  const biome = await page.evaluate(() => window.__game.world.meta.biome);
  check(errors, biome === 'mix', `Create! made an Everything Land world (${biome})`);
  await settle(page, 600);
  await shot(page, 'ui-mix-spawn', PREFIX);

  // Bag: visit every block tab, pick the Lollipop Swirl from Candy with a click
  await page.locator('.sw-bagbtn').click();
  await page.waitForSelector('.sw-panel-wrap.sw-open .sw-item img[src]', { timeout: 15000 });
  const tabCounts = {};
  for (const label of ['Nature', 'Building', 'Colors', 'Candy', 'Glass & Windows', 'Lights', 'Garden', 'Fun & Toys']) {
    await page.locator('.sw-tab', { hasText: label }).first().click();
    await settle(page, 250);
    tabCounts[label] = await page.locator('.sw-panel-wrap.sw-open .sw-item').count();
    if (label === 'Nature' || label === 'Fun & Toys' || label === 'Glass & Windows') {
      await settle(page, 900);
      await shot(page, `ui-bag-${label.split(' ')[0].toLowerCase()}`, PREFIX);
    }
  }
  await page.locator('.sw-tab', { hasText: 'Candy' }).first().click();
  await settle(page, 900);
  await shot(page, 'ui-bag-candy', PREFIX);
  await page.locator('.sw-item', { hasText: 'Lollipop Swirl' }).first().click();
  console.log('  Bag tab sizes: ' + JSON.stringify(tabCounts));
  check(errors, Object.values(tabCounts).every((n) => n >= 10), 'every visited Bag tab is well filled');
  await settle(page, 400);
  if (await page.locator('.sw-panel-wrap.sw-open').count()) await page.keyboard.press('Escape');
  const slot = await page.evaluate(() => window.__game.hotbar.slots[window.__game.hotbar.index]);
  check(errors, slot === 'block:lollipop_block', `clicking Lollipop Swirl put it in the hotbar (${slot})`);

  // place it with a real click on the ground ahead
  const target = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    g.setTool('build');
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 3), z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 3);
    return [x, g.world.heightAt(x, z), z];
  });
  const pt = await screenPoint(page, target[0] + 0.5, target[1] + 1, target[2] + 0.5);
  const before = await page.evaluate(() => window.__game.profile.stats.blocksPlaced || 0);
  if (pt) {
    await page.mouse.click(pt.x, pt.y);
    await settle(page, 400);
  }
  const placed = await page.evaluate(() => {
    const g = window.__game, w = g.world, id = g.registry.blocks.idOf('lollipop_block');
    let n = 0;
    for (let i = 0; i < w.blocks.length; i++) if (w.blocks[i] === id) n++;
    return { n, stats: g.profile.stats.blocksPlaced || 0 };
  });
  check(errors, placed.stats > before && placed.n >= 1, `a real click placed a Lollipop Swirl block (${placed.n})`);

  // the Music Block plays a note when Hand-tapped
  const mb = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x + Math.sin(g.cameraRig.yaw) * 3) + 1, z = Math.floor(p.z + Math.cos(g.cameraRig.yaw) * 3);
    const y = g.world.heightAt(x, z) + 1;
    g.debug.place('music_block', x, y, z);
    window.__notes = 0;
    g.events.on('piano:note', () => { window.__notes++; });
    g.setTool('hand');
    return [x, y, z];
  });
  await settle(page, 300);
  const mp = await screenPoint(page, mb[0] + 0.5, mb[1] + 0.6, mb[2] + 0.5);
  if (mp) await page.mouse.click(mp.x, mp.y);
  await settle(page, 300);
  let notes = await page.evaluate(() => window.__notes);
  console.log(`  music block: ${notes ? 'a real click played ' + notes + ' note(s)' : 'click missed, using the Hand tool directly'}`);
  if (!notes) {
    // the click may have hit something in front of it; use the Hand tool directly
    notes = await page.evaluate(([x, y, z]) => {
      const g = window.__game;
      g.interact({ type: 'block', x, y, z, id: g.world.get(x, y, z), face: [0, 1, 0] });
      return window.__notes;
    }, mb);
  }
  check(errors, notes >= 1, 'Hand on the Music Block plays a note');
  await page.evaluate(() => window.__game.setTool('build'));
}

async function main() {
  const opts = parse();
  const want = (k) => !opts.only || opts.only.has(k);
  const errors = [];
  const browser = await launch();
  try {
    const { page } = await openGame(browser, { errors, label: 'blocks' });
    await libraryChecks(page, errors);
    if (want('sheets')) await sheets(page);
    if (want('bench')) await bench(page, opts, errors);
    if (want('gallery')) await gallery(page);
    if (want('biomes')) await biomes(page, opts, errors);
    if (want('ui')) await ui(page, errors);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
