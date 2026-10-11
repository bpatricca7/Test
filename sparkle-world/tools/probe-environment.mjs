// Environment team probe: sky (sunrise, noon, sunset, night with stars + moon), every
// weather, rainbow, butterflies / fireflies close-up, gems (collect by walking), and the
// Sticker Book opened through the HUD. Fails on console errors like tools/smoke.mjs.
//
//   node tools/probe-environment.mjs [--only=sky,weather,life,gems,stickers] [--headed]

import { launch, openGame, startWorld, settle, shot, finish } from './smoke.mjs';

const PREFIX = 'environment';
const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const want = (k) => !only || only.has(k);

function check(errors, cond, message) {
  if (!cond) errors.push('[check] ' + message);
  else console.log('  ok: ' + message);
}

/** Point the camera: yaw (0 = +Z), pitch (positive looks down). */
async function look(page, yaw, pitch, distance = null) {
  await page.evaluate(([yaw, pitch, distance]) => {
    const r = window.__game.cameraRig;
    r.yaw = yaw;
    r.pitch = pitch;
    if (distance !== null) r.distance = distance;
  }, [yaw, pitch, distance]);
}

/** Aim the camera at the sun or moon (as far up as the third person camera allows). */
async function lookAtSky(page, what, distance = 3) {
  await page.evaluate(([what, distance]) => {
    const g = window.__game, u = g.sky.dome.uniforms;
    const d = what === 'moon' ? u.uMoonDir.value : u.uSunDir.value;
    const r = g.cameraRig;
    r.yaw = Math.atan2(d.x, d.z);
    r.pitch = Math.max(-0.9, -Math.asin(d.y) * 1.1);
    r.distance = distance;
  }, [what, distance]);
}

async function skyPass(page, errors) {
  console.log('Sky');
  // hover a few blocks up in first person, so only sky and landscape are in the picture
  const home = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const home = [p.x, p.y, p.z];
    g.weather && g.weather.set('sunny', { instant: true });
    g.player.setFlying(true);
    g.player.teleport(p.x, g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 7, p.z);
    g.cameraRig.setMode('first');
    return home;
  });
  const times = [['sunrise', 0.255, -0.12], ['noon', 0.5, -0.3], ['sunset', 0.74, -0.12], ['night', 0.02, -0.5]];
  for (const [name, t, pitch] of times) {
    await page.evaluate((t) => window.__game.debug.setTime(t), t);
    await look(page, name === 'sunrise' ? Math.PI * 0.7 : name === 'sunset' ? -Math.PI * 0.7 : Math.PI, pitch, 5);
    await settle(page, 700);
    await shot(page, `sky-${name}`, PREFIX);
  }
  // the moon (with its sleepy face) and stars, looking up at it
  await page.evaluate(() => window.__game.debug.setTime(0.9));
  await settle(page, 200);
  await lookAtSky(page, 'moon');
  await settle(page, 700);
  await shot(page, 'sky-moon', PREFIX);
  const u = await page.evaluate(() => {
    const g = window.__game;
    return { daylight: g.blockUniforms.uDaylight.value, ambient: g.blockUniforms.uAmbient.value, phase: g.timeOfDay && g.timeOfDay.phase };
  });
  check(errors, Math.abs(u.daylight - 0.4) < 0.02 && Math.abs(u.ambient - 0.22) < 0.02, `night light floor kept (daylight ${u.daylight.toFixed(2)}, ambient ${u.ambient.toFixed(2)})`);
  check(errors, u.phase === 'night', `time phase at night is "${u.phase}"`);
  // a shooting star streaking over the night sky
  await page.evaluate(() => {
    const g = window.__game;
    g.cameraRig.yaw = Math.PI; g.cameraRig.pitch = -0.6;
    g.sky.shootingStar(Math.PI);
  });
  await settle(page, 350);
  await shot(page, 'sky-shooting-star', PREFIX);
  // stay out under the stars: Night Owl comes after a few seconds of stargazing
  const owl = await page.waitForFunction(() => window.__game.stickers.has('night_owl'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  check(errors, owl, 'Night Owl sticker after stargazing a while');
  await page.evaluate((home) => {
    const g = window.__game;
    g.cameraRig.setMode('third');
    g.player.setFlying(false);
    g.player.teleport(...home);
  }, home);
}

async function weatherPass(page, errors) {
  console.log('Weather');
  const events = await page.evaluate(() => {
    const g = window.__game;
    g.__envWeatherEvents = [];
    g.events.on('weather:change', (e) => g.__envWeatherEvents.push(e.weather));
    g.debug.setTime(0.45);
    return g.weather ? g.weather.kinds : null;
  });
  check(errors, Array.isArray(events) && events.join() === 'sunny,cloudy,rain,snow,rainbow', `game.weather.kinds = ${events}`);
  for (const kind of ['cloudy', 'rain', 'snow', 'rainbow']) {
    // the first change fades in for real; the rest jump (the software renderer is slow)
    await page.evaluate((k) => window.__game.weather.set(k, { instant: k !== 'cloudy' }), kind);
    await look(page, Math.PI, kind === 'rainbow' ? -0.3 : 0.05, 5);
    // let the fade finish (fx moves a few % per frame)
    await page.waitForFunction((k) => {
      const w = window.__game.weather, fx = w.fx;
      return k === 'rain' ? fx.rain > 0.98 : k === 'snow' ? fx.snow > 0.98 : k === 'rainbow' ? fx.rainbow > 0.98 : fx.overcast > 0.48;
    }, kind, { timeout: 60000 });
    await settle(page, 900);
    await shot(page, `weather-${kind}`, PREFIX);
  }
  // candy sprinkle rain (pretend this world is Candy Land)
  await page.evaluate(() => {
    const g = window.__game;
    g.__realBiome = g.world.meta.biome;
    g.world.meta.biome = 'candy';
    g.weather.set('rain');
  });
  await settle(page, 1500);
  const sprinkles = await page.evaluate(() => window.__game.weather.sprinkles);
  check(errors, sprinkles === true, 'rain in Candy Land is sprinkle rain');
  await look(page, Math.PI, 0.25, 4);
  await settle(page, 400);
  await shot(page, 'weather-sprinkles', PREFIX);
  const saved = await page.evaluate(async () => {
    const g = window.__game;
    g.world.meta.biome = g.__realBiome;
    g.weather.set('snow', { instant: true });
    await g.debug.save();
    const s = await g.store.loadWorld(g.world.meta.id);
    return s && s.systems && s.systems.weather;
  });
  check(errors, saved && saved.current === 'snow', `weather saved per world (${JSON.stringify(saved)})`);
  const evs = await page.evaluate(() => window.__game.__envWeatherEvents);
  check(errors, evs.includes('rain') && evs.includes('rainbow'), `weather:change events (${evs.join(', ')})`);
  await page.evaluate(() => window.__game.weather.set('sunny', { instant: true }));
}

async function lifePass(page, errors) {
  console.log('Particles & ambient life');
  await page.evaluate(() => { const g = window.__game; g.weather.set('sunny', { instant: true }); g.debug.setTime(0.42); });
  // a zoo of every particle kind in a row in front of the player
  const kinds = await page.evaluate(() => {
    const g = window.__game, p = g.player.position, r = g.cameraRig;
    r.yaw = Math.PI; r.pitch = 0.1; r.distance = 4.5;
    return g.particles.kinds;
  });
  check(errors, ['sparkle', 'heart', 'star', 'bubble', 'splash', 'zzz', 'note', 'leaf', 'petal', 'confetti', 'rainbow_trail', 'smoke_puff'].every((k) => kinds.includes(k)), `all particle kinds exist (${kinds.length})`);
  await settle(page, 300);
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const list = ['sparkle', 'heart', 'star', 'bubble', 'note', 'zzz', 'petal', 'leaf', 'confetti', 'rainbow_trail', 'smoke_puff', 'gem', 'snowflake', 'magic'];
    list.forEach((k, i) => {
      const x = p.x - 4.2 + (i % 7) * 1.4, y = p.y + (i < 7 ? 2.8 : 1.2), z = p.z - 5;
      g.particles.emit(k, [x, y, z], { count: k === 'confetti' ? 16 : 5, spread: 0.6, speed: 0.25, life: 3 });
    });
  });
  await settle(page, 350);
  await shot(page, 'particles-zoo', PREFIX);
  const alive = await page.evaluate(() => window.__game.particles.alive());
  check(errors, alive > 30 && alive <= 800, `particle pool in use: ${alive} (max 800)`);

  // butterflies by day, close up
  const spawned = await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const x = Math.floor(p.x), z = Math.floor(p.z) - 3, y = g.world.heightAt(x, z);
    let n = 0;
    for (let i = 0; i < 5; i++) if (g.ambient.spawnButterfly(x + (i % 3) - 1, y, z - Math.floor(i / 3))) n++;
    const r = g.cameraRig;
    r.yaw = Math.PI; r.pitch = 0.18; r.distance = 2.6;
    return n;
  });
  check(errors, spawned >= 4, `butterflies came to the flowers (${spawned})`);
  await settle(page, 1800);
  await shot(page, 'butterflies', PREFIX);
  // one resting right in front of the lens
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position, r = g.cameraRig;
    r.setMode('first');
    r.yaw = Math.PI; r.pitch = 0.35;
    const b = g.ambient.butterflies.list.find((q) => q.on);
    b.rest = 60; b.x = p.x; b.y = p.y + 1.05; b.z = p.z - 1.1; b.yaw = 0.6; b.scale = 1;
    const c = g.ambient.butterflies.list.filter((q) => q.on)[1];
    if (c) { c.rest = 60; c.x = p.x + 0.7; c.y = p.y + 1.25; c.z = p.z - 1.6; c.yaw = -1.2; c.scale = 1; }
  });
  await settle(page, 900);
  await shot(page, 'butterfly-closeup', PREFIX);
  await page.evaluate(() => window.__game.cameraRig.setMode('third'));

  // fireflies at night
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    g.debug.setTime(0.95);
    for (const b of g.ambient.butterflies.list) b.leaving = true;
    const x = Math.floor(p.x), z = Math.floor(p.z) - 3, y = g.world.heightAt(x, z);
    for (let i = 0; i < 14; i++) g.ambient.spawnFirefly(x + (i % 5) - 2, y, z - Math.floor(i / 5));
    const r = g.cameraRig;
    r.yaw = Math.PI; r.pitch = 0.05; r.distance = 3;
  });
  await settle(page, 2500);
  await shot(page, 'fireflies', PREFIX);
  const counts = await page.evaluate(() => window.__game.ambient.count());
  check(errors, counts.fireflies >= 10, `fireflies glowing at night (${counts.fireflies})`);
  await page.evaluate(() => window.__game.debug.setTime(0.45));
}

async function gemPass(page, errors) {
  console.log('Gems');
  const info = await page.evaluate(() => {
    const g = window.__game;
    g.weather.set('sunny', { instant: true });
    g.debug.setTime(0.4);
    return { total: g.world.gemTotal, list: g.gems.list(), stat: g.profile.stats.gems || 0 };
  });
  check(errors, info.total >= 20 && info.total <= 30, `world.gemTotal = ${info.total}`);
  check(errors, new Set(info.list.map((g) => g.color)).size >= 4, `gems come in ${new Set(info.list.map((g) => g.color)).size} colors`);
  // stand 3 blocks from the nearest gem on open ground and look at it
  const target = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const gems = g.gems.list().filter((q) => !q.found);
    // prefer a gem on flat open ground (the same level all the way there)
    for (const flat of [true, false]) for (const gem of gems) {
      for (const [dx, dz] of [[0, 3], [3, 0], [0, -3], [-3, 0]]) {
        const x = gem.x + dx, z = gem.z + dz;
        const h = w.heightAt(x, z);
        if (h < 0 || Math.abs(h + 1 - gem.y) > (flat ? 0 : 1)) continue;
        // the path must be clear at feet and head height
        let clear = true;
        for (let s = 1; s < 3; s++) {
          const px = gem.x + Math.sign(dx) * s, pz = gem.z + Math.sign(dz) * s;
          if (flat && w.heightAt(px, pz) !== h) clear = false;
          for (const yy of [gem.y, gem.y + 1]) if (g.registry.blocks.props.solid[w.get(px, yy, pz)]) clear = false;
        }
        if (!clear) continue;
        g.player.teleport(x + 0.5, h + 1, z + 0.5);
        g.cameraRig.yaw = Math.atan2(-dx, -dz);
        g.cameraRig.pitch = 0.3;
        g.cameraRig.distance = 3.5;
        return { ...gem, stand: [x + 0.5, h + 1, z + 0.5] };
      }
    }
    return null;
  });
  check(errors, !!target, 'found a gem to walk to');
  if (!target) return;
  await settle(page, 900);
  await shot(page, 'gems', PREFIX);
  // close-up of the gem
  await page.evaluate(() => { const r = window.__game.cameraRig; r.setMode('first'); r.pitch = 0.25; });
  await settle(page, 600);
  await shot(page, 'gem-closeup', PREFIX);
  await page.evaluate(() => window.__game.cameraRig.setMode('third'));
  // the radar beam from the nearest gem (step back first)
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position, r = g.cameraRig;
    p.x += Math.sin(r.yaw) * -6; p.z += Math.cos(r.yaw) * -6;
    p.y = g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1;
    g.gems.radar();
    r.pitch = 0.15; r.distance = 4;
  });
  await settle(page, 1500);
  await shot(page, 'gem-radar', PREFIX);
  // walk into it with the keyboard (from the spot 3 blocks away)
  await page.evaluate((t) => {
    const g = window.__game;
    g.player.teleport(...t.stand);
    const p = g.player.position;
    const dx = t.x + 0.5 - p.x, dz = t.z + 0.5 - p.z;
    g.cameraRig.yaw = Math.atan2(dx, dz);
  }, target);
  await settle(page, 300);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((t) => window.__game.gems.list().some((q) => q.x === t.x && q.z === t.z && q.found), target, { timeout: 30000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  await settle(page, 400);
  await shot(page, 'gem-collect', PREFIX);
  const after = await page.evaluate((t) => {
    const g = window.__game;
    return {
      found: g.gems.list().find((q) => q.x === t.x && q.z === t.z).found,
      count: g.gems.found(),
      stat: g.profile.stats.gems || 0,
      hud: document.querySelector('.sw-gems span') && document.querySelector('.sw-gems span').textContent,
    };
  }, target);
  check(errors, after.found && after.count === 1, `walked into the gem and collected it (found ${after.count})`);
  check(errors, after.stat === info.stat + 1 && after.hud === String(after.stat), `gem counter went up (stats ${after.stat}, HUD ${after.hud})`);
  const saved = await page.evaluate(async () => {
    const g = window.__game;
    await g.debug.save();
    const s = await g.store.loadWorld(g.world.meta.id);
    return s.systems.collectibles.gems.filter((q) => q[4]).length;
  });
  check(errors, saved === 1, `collected gems saved per world (${saved})`);
}

async function stickerPass(page, errors) {
  console.log('Stickers');
  const before = await page.evaluate(() => ({ n: window.__game.stickers.count(), total: window.__game.stickers.total() }));
  // earn a few through their real events, plus a couple directly
  await page.evaluate(() => {
    const g = window.__game;
    g.events.emit('photo:taken', {});
    g.events.emit('player:swim', {});
    g.events.emit('pet:adopt', { pet: {} });
    g.events.emit('garden:harvest', {});
    for (const id of ['sweet_dreams', 'little_chef', 'unicorn_rider', 'magic_builder', 'gem_hunter']) g.award(id);
  });
  await page.waitForSelector('.sw-stkpop canvas', { timeout: 5000 });
  await settle(page, 700);
  await shot(page, 'sticker-popup', PREFIX);
  const earned = await page.evaluate(() => window.__game.stickers.count());
  check(errors, earned >= before.n + 8, `stickers earned (${before.n} -> ${earned} of ${before.total})`);
  check(errors, before.total >= 21, `all DESIGN.md sticker ids registered (${before.total})`);
  // let the popups fly away, then open the book with the HUD button
  await page.waitForFunction(() => !document.querySelector('.sw-stkpop'), null, { timeout: 60000 });
  await page.locator('.sw-hud-tr .sw-round', { hasText: 'Stickers' }).click();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="stickers"] .sw-stk canvas');
  await settle(page, 700);
  await shot(page, 'stickerbook', PREFIX);
  const book = await page.evaluate(() => ({
    count: document.querySelector('.sw-sb-count').textContent,
    locked: document.querySelectorAll('.sw-panel-wrap.sw-open .sw-stk--locked').length,
    got: document.querySelectorAll('.sw-panel-wrap.sw-open .sw-stk--got').length,
    hint: [...document.querySelectorAll('.sw-stk--locked .sw-stk-sub')].map((e) => e.textContent)[0],
  }));
  check(errors, /\d+ of \d+ stickers/.test(book.count), `progress reads "${book.count}"`);
  check(errors, book.got > 0 && book.locked > 0 && !!book.hint, `earned and locked stickers on the pages (hint: "${book.hint}")`);
  await page.locator('.sw-sb-next').click();
  await settle(page, 700);
  await shot(page, 'stickerbook-page2', PREFIX);
  await page.locator('.sw-panel-wrap.sw-open .sw-stk--got').first().click();
  await settle(page, 600);
  await shot(page, 'stickerbook-detail', PREFIX);
  const detailShown = await page.evaluate(() => !document.querySelector('.sw-sb-detail').hidden);
  check(errors, detailShown, 'tapping a sticker shows it big');
  await page.locator('.sw-sb-detail .sw-btn').click();
  await page.keyboard.press('Escape');
  await settle(page, 300);
  const closed = await page.evaluate(() => window.__game.ui.current);
  check(errors, closed === null, `Esc closes the book (${closed})`);
}

async function touchPass(browser, errors) {
  console.log('Phone: sticker book + weather');
  const { context, page } = await openGame(browser, { errors, viewport: { width: 390, height: 844 }, touch: true, label: 'env-touch' });
  await startWorld(page, 'meadow', { tap: true });
  await page.evaluate(() => {
    const g = window.__game;
    for (const id of ['first_block', 'sweet_dreams', 'best_friends', 'night_owl', 'rainbow_maker']) g.profile.stickers[id] = new Date().toISOString();
    g.debug.setTime(0.74);
    g.weather.set('rainbow', { instant: true });
  });
  await settle(page, 800);
  await shot(page, 'phone-sunset-rainbow', PREFIX);
  await page.locator('.sw-hud-tr .sw-round', { hasText: 'Stickers' }).tap();
  await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="stickers"] .sw-stk canvas');
  await settle(page, 700);
  await shot(page, 'phone-stickerbook', PREFIX);
  const small = await page.evaluate(() => [...document.querySelectorAll('.sw-panel-wrap.sw-open .sw-stk, .sw-sb-nav .sw-btn')]
    .filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
  check(errors, small === 0, 'sticker book touch targets are at least 44 px');
  await page.locator('.sw-sb-next').tap();
  await settle(page, 600);
  await shot(page, 'phone-stickerbook-page2', PREFIX);
  await context.close();
}

async function main() {
  const errors = [];
  const browser = await launch({ headed: args.includes('--headed') });
  try {
    const { context, page } = await openGame(browser, { errors, label: 'env' });
    if (want('stickers')) {
      // the Sticker Book also opens from the title screen, and closing it goes back there
      await page.locator('button.sw-btn', { hasText: 'Stickers' }).first().click();
      await page.waitForSelector('.sw-panel-wrap.sw-open[data-panel="stickers"] .sw-stk canvas');
      await settle(page, 500);
      await shot(page, 'stickerbook-title', PREFIX);
      await page.locator('.sw-panel-wrap.sw-open[data-panel="stickers"] .sw-close').click();
      await settle(page, 300);
      const back = await page.evaluate(() => window.__game.ui.current);
      check(errors, back === 'title', `closing the book from the title returns to the title (${back})`);
    }
    await startWorld(page, 'meadow');
    await settle(page, 600);
    if (want('sky')) await skyPass(page, errors);
    if (want('weather')) await weatherPass(page, errors);
    if (want('life')) await lifePass(page, errors);
    if (want('gems')) await gemPass(page, errors);
    if (want('stickers')) await stickerPass(page, errors);
    await context.close();
    if (want('touch')) await touchPass(browser, errors);
  } catch (err) {
    errors.push('[probe] ' + (err.stack || err.message || String(err)));
  } finally {
    await browser.close();
  }
  finish(errors);
}

main();
