// Day & night: a gradient sky dome with a soft glowing sun, pastel sunrises and sunsets
// (peach / pink / lavender), a deep indigo night with twinkling pastel stars, a pastel nebula,
// a sleepy moon with phases (by game.time.day), shooting stars, and fluffy voxel clouds
// drifting overhead. Drives the shared light: game.blockUniforms (uDaylight 0.4 night .. 1
// day, uAmbient 0.22 .. 0.6, sky/fog colors), scene fog and the Lambert lights. Emits
// 'time:morning' / 'time:night' when the clock crosses 0.25 / 0.78 (a night slept through with
// skipToMorning() is quiet: no 'time:night'). Weather (weather.js) tints all of it through
// game.weather.fx. Biome defs may carry sky: { top, horizon, mid?, fog?, sunset?, nightTop?,
// cloud? } (hex).
//
// Also sets game.timeOfDay = { phase: 'dawn'|'day'|'dusk'|'night', daylight, night, dusk,
// label, key, icon() } (the HUD time pill shows icon()) and game.sky (environment internals:
// dome, clouds, stars, moon, shooting star; weather.js uses game.sky.setRainbow).

import * as THREE from 'three';
import { smoothstep, clamp, hexToRgb, hashString } from '../core/util.js';
import { createDome, createStars, createMoon, createShootingStar } from './sky.js';
import { createClouds } from './clouds.js';
import { timeIcon, TIME_LABELS } from './env-icons.js';

const MORNING_AT = 0.25;
const NIGHT_AT = 0.78;

const DEFAULT_SKY = { top: '#5FB8FF', horizon: '#CDEFFF' };
const NIGHT = { top: '#0E1346', mid: '#22286F', horizon: '#3E3A8E' };
const SUNRISE = { top: '#8E9BEB', mid: '#F0B8DA', horizon: '#FFD4AA', dusk: '#FFB892', glow: '#FFE2A8', sun: '#FFF0CC' };
const SUNSET = { top: '#6C64D4', mid: '#E29FDC', horizon: '#FFB7A4', dusk: '#FF9DB8', glow: '#FFC592', sun: '#FFDDB8' };
const DAY_SUN = '#FFFCEB', DAY_GLOW = '#FFF3BF';
// moon phases by day (0.5 = full); the new moon is skipped so there is always a moon to see
const PHASES = [0.5, 0.61, 0.73, 0.85, 0.15, 0.27, 0.39];

const CLOUD_DAY = ['#FFFFFF', '#F3F3FF', '#DEDDF3'];
const CLOUD_DUSK = ['#FFE6D8', '#F9CBDD', '#C3ACE3'];
const CLOUD_NIGHT = ['#4E5194', '#414483', '#34366F'];
const CLOUD_GREY = ['#F0F0F8', '#DCDEEC', '#B5B8D4'];

/** Raw sRGB (0..1) color from hex, like the block shader expects. */
function raw(hex, out = new THREE.Color()) {
  const [r, g, b] = hexToRgb(hex);
  out.r = r / 255; out.g = g / 255; out.b = b / 255;
  return out;
}

function mix(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

/** Soft grey-lavender version of a color (overcast weather), mixed in by t. */
function overcast(c, t, lift) {
  if (t <= 0) return c;
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 + lift;
  c.r += (l * 0.96 - c.r) * t;
  c.g += (l * 0.96 - c.g) * t;
  c.b += (Math.min(1, l * 1.1) - c.b) * t;
  return c;
}

const palette = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, raw(v)]));

export function install(game) {
  const scene = game.scene;
  const dome = createDome(scene);
  const stars = createStars(scene);
  const moon = createMoon(scene);
  const shoot = createShootingStar(scene);
  const clouds = createClouds(scene);
  const u = dome.uniforms;
  scene.fog = new THREE.Fog(0xcdefff, 40, 140);

  const night = palette(NIGHT), sunrise = palette(SUNRISE), sunset = palette(SUNSET);
  const day = { top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color() };
  const nightTop = new THREE.Color();
  const duskHorizon = { rise: new THREE.Color(), set: new THREE.Color() };
  const cloudTint = new THREE.Color(1, 1, 1);
  let cloudTintAmt = 0;
  const cDay = CLOUD_DAY.map((h) => raw(h)), cDusk = CLOUD_DUSK.map((h) => raw(h));
  const cNight = CLOUD_NIGHT.map((h) => raw(h)), cGrey = CLOUD_GREY.map((h) => raw(h));
  const daySun = raw(DAY_SUN), dayGlow = raw(DAY_GLOW);
  const top = new THREE.Color(), mid = new THREE.Color(), horizon = new THREE.Color(), tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const moonTint = new THREE.Color(0.8, 0.82, 1.2), white = new THREE.Color(1, 1, 1), warm = new THREE.Color(1, 0.86, 0.76);
  const rainTint = new THREE.Color(0.9, 0.92, 1.0);
  const sunDir = u.uSunDir.value, moonDir = u.uMoonDir.value;
  const lightDir = new THREE.Vector3();
  let lastAbs = null;
  let fogBase = null;
  let nextShoot = 8;
  let wished = false;
  let keyPhase = '', keyWeather = '', keySprinkles = false;

  const setBiomeSky = (world = game.world) => {
    const biome = world ? game.registry.biomes.get(world.meta.biome) : null;
    const sky = { ...DEFAULT_SKY, ...((biome && biome.sky) || {}) };
    raw(sky.top, day.top);
    raw(sky.horizon, day.horizon);
    if (sky.mid) raw(sky.mid, day.mid);
    else mix(day.mid, day.horizon, day.top, 0.5);
    nightTop.copy(sky.nightTop ? raw(sky.nightTop) : night.top);
    raw(sky.sunset || SUNSET.horizon, duskHorizon.set);
    raw(sky.sunrise || SUNRISE.horizon, duskHorizon.rise);
    fogBase = sky.fog ? raw(sky.fog) : null;
    cloudTintAmt = sky.cloud ? 0.55 : 0;
    if (sky.cloud) raw(sky.cloud, cloudTint);
    lastAbs = null;
    if (world) {
      clouds.uniforms.uBaseY.value = world.sy + 3;
      clouds.setSeed(world.meta.seed ?? hashString(world.meta.id || 'w'));
    }
    clouds.mesh.visible = !!world;
    wished = false;
  };
  setBiomeSky();

  // Compile every environment shader once, behind the loading screen, so night falling,
  // fireflies waking up or the first rainbow never stall a frame (first use of a shader
  // program can take a while on slower devices).
  let warmed = false;
  const warmUp = () => {
    if (warmed || !game.renderer.compile) return;
    warmed = true;
    const hidden = [];
    scene.traverse((o) => {
      if (o.userData.envWarm && !o.visible) { hidden.push(o); o.visible = true; }
    });
    const current = dome.mesh.material;
    const r = game.renderer;
    const vp = new THREE.Vector4(), sc = new THREE.Vector4();
    r.getViewport(vp);
    r.getScissor(sc);
    const scissorOn = r.getScissorTest();
    try {
      // one tiny (1 x 1 pixel) draw of everything also uploads textures and buffers
      r.setViewport(0, 0, 1, 1);
      r.setScissor(0, 0, 1, 1);
      r.setScissorTest(true);
      for (const m of dome.allVariants()) {
        dome.mesh.material = m;
        r.compile(scene, game.camera);
        r.render(scene, game.camera);
      }
    } catch (err) {
      console.warn('[daynight] shader warm-up skipped', err);
    }
    r.setViewport(vp);
    r.setScissor(sc);
    r.setScissorTest(scissorOn);
    dome.mesh.material = current;
    for (const o of hidden) o.visible = false;
  };
  game.events.on('world:unload', () => {
    shoot.stop();
    setBiomeSky(null); // back to the default sky, no clouds (title screen)
  });

  const tod = {
    phase: 'day', daylight: 1, night: 0, dusk: 0, label: TIME_LABELS.day, key: '',
    icon() {
      const w = game.weather;
      return timeIcon(tod.phase, w ? w.current : 'sunny', { sprinkles: !!(w && w.sprinkles) });
    },
  };
  game.timeOfDay = tod;
  game.sky = {
    dome, stars, moon, shoot, clouds,
    /** Rainbow strength 0..1 and the horizontal direction its bow stands in. */
    setRainbow(amount, dirX = null, dirZ = null) {
      u.uRainbow.value = amount;
      if (dirX !== null) u.uRainbowC.value.set(dirX, -0.16, dirZ).normalize();
    },
    /** A shooting star now (lookYaw: somewhere in front of a camera looking that way). */
    shootingStar(lookYaw = null) { shoot.launch(Math.random, lookYaw); },
  };

  const cloudOuts = [clouds.uniforms.uTopCol.value, clouds.uniforms.uSideCol.value, clouds.uniforms.uBotCol.value];
  const cloudColors = (dayF, dusk, oc, rain) => {
    const outs = cloudOuts;
    for (let i = 0; i < 3; i++) {
      const c = outs[i];
      mix(c, cNight[i], cDay[i], dayF);
      mix(c, c, cDusk[i], dusk * 0.85);
      if (cloudTintAmt) {
        tmp2.copy(c).multiply(cloudTint);
        mix(c, c, tmp2, cloudTintAmt * (0.4 + 0.6 * dayF));
      }
      tmp.copy(cGrey[i]).multiplyScalar(0.35 + 0.65 * dayF);
      if (rain > 0) tmp.multiplyScalar(1 - 0.12 * rain);
      mix(c, c, tmp, oc * 0.85);
    }
  };

  game.addSystem({
    name: 'daynight',
    onWorldLoad: () => {
      setBiomeSky(); // game.world is set: biome palette, cloud seed and height
      warmUp();
    },
    update(dt) {
      const cam = game.camera.position;
      dome.mesh.position.copy(cam);
      stars.pivot.position.copy(cam);
      const tm = game.time;
      const d = tm.dayTime;
      const fx = game.weather && game.weather.fx;
      const oc = fx ? fx.overcast : 0;
      const rain = fx ? fx.rain : 0;
      const snow = fx ? fx.snow : 0;

      // sun & moon paths: the sun rises in the east (+x), arcs over the -z side (where a new
      // player looks) and sets in the west; the moon follows the opposite arc
      const ang = (d - 0.25) * Math.PI * 2;
      const elev = Math.sin(ang);
      sunDir.set(Math.cos(ang) * 0.88, elev, -0.36).normalize();
      moonDir.set(-Math.cos(ang) * 0.9, -elev * 0.8, -0.75).normalize();
      const dayF = smoothstep(-0.1, 0.22, elev);
      const nightF = 1 - smoothstep(-0.3, 0.02, elev);
      const dusk = 1 - smoothstep(0.0, 0.36, Math.abs(elev - 0.04));
      const pal = d < 0.5 ? sunrise : sunset;
      const duskH = d < 0.5 ? duskHorizon.rise : duskHorizon.set;

      mix(top, nightTop, day.top, dayF);
      mix(mid, night.mid, day.mid, dayF);
      mix(horizon, night.horizon, day.horizon, dayF);
      mix(top, top, pal.top, dusk * 0.55);
      mix(mid, mid, pal.mid, dusk * 0.85);
      mix(horizon, horizon, duskH, dusk * 0.9);
      const lift = 0.06 * dayF + snow * 0.2 * dayF;
      overcast(top, oc * 0.8, lift);
      overcast(mid, oc * 0.8, lift);
      overcast(horizon, oc * 0.75, lift);
      if (fogBase && dayF > 0) mix(horizon, horizon, fogBase, dayF * (1 - dusk) * 0.6);
      u.uTop.value.copy(top);
      u.uMid.value.copy(mid);
      u.uHorizon.value.copy(horizon);
      u.uDuskColor.value.copy(pal.dusk);
      mix(u.uGlowColor.value, dayGlow, pal.glow, dusk);
      mix(u.uSunColor.value, daySun, pal.sun, dusk);
      u.uDay.value = smoothstep(-0.2, 0.05, elev);
      u.uNight.value = nightF;
      u.uDusk.value = dusk * (1 - 0.8 * oc);
      u.uOvercast.value = oc;
      u.uTime.value = tm.t;
      dome.choose();

      // stars turn slowly with the night; hidden by clouds
      stars.points.rotation.y = d * Math.PI * 2;
      stars.uniforms.uNight.value = Math.pow(nightF, 1.4) * (1 - 0.92 * oc);
      stars.pivot.visible = stars.uniforms.uNight.value > 0.01;
      stars.uniforms.uTime.value = tm.t;
      stars.uniforms.uPixel.value = game.renderer.getPixelRatio();

      // the moon: a billboard far away, phase by day number
      const mAbove = smoothstep(-0.06, 0.08, moonDir.y);
      moon.uniforms.uAlpha.value = mAbove * (1 - dayF * 0.8) * (1 - 0.85 * oc);
      moon.uniforms.uPhase.value = PHASES[((tm.day - 1) % PHASES.length + PHASES.length) % PHASES.length];
      moon.mesh.visible = moon.uniforms.uAlpha.value > 0.01;
      if (moon.mesh.visible) {
        moon.mesh.position.copy(moonDir).multiplyScalar(400).add(cam);
        moon.mesh.quaternion.copy(game.camera.quaternion);
        moon.mesh.scale.setScalar(2 * 1.9 * 24);
      }

      // shooting stars now and then on clear nights
      if (game.mode === 'play' && nightF > 0.8 && oc < 0.5 && !game.paused) {
        nextShoot -= dt;
        if (nextShoot <= 0 && !shoot.active) {
          shoot.launch();
          nextShoot = 9 + Math.random() * 16;
          if (!wished && game.player && game.player.state !== 'sleep') {
            wished = true;
            game.toast('A shooting star! Make a wish!', { icon: 'star', color: 'lav' });
            game.audio.play('magic', { volume: 0.5 });
          }
        }
      }
      shoot.update(dt, cam);

      // clouds: fill the sky with the weather, drift with the wind
      if (clouds.mesh.visible) {
        // clear nights show a few more gaps for the moon and stars
        clouds.uniforms.uCoverage.value = (fx ? fx.cloud : 0.42) - 0.08 * nightF * (1 - oc);
        clouds.update(dt, cam, 1 + oc * 1.2);
        cloudColors(dayF, dusk, oc, rain);
      }

      // block shader + scene fog share the horizon color (raw sRGB in the block shader)
      const bu = game.blockUniforms;
      const worldR = game.world ? Math.max(game.world.sx, game.world.sz) : 144;
      const ground = game.world ? Math.max(game.world.waterLevel || 0, 16) : 20;
      const liftY = Math.max(0, cam.y - ground - 14);
      const wet = Math.max(rain, snow * 0.8);
      let far = clamp(worldR * 0.95, 120, 200) * (1 - 0.3 * wet) + liftY * 1.6;
      const near = far * (0.3 - 0.12 * wet) + liftY * 0.6;
      far = Math.max(far, near + 30);
      if (bu) {
        // nights stay a gentle, readable indigo; grey weather dims a little, never gloomy
        bu.uDaylight.value = Math.max(0.4, (0.4 + 0.6 * dayF) * (1 - 0.13 * oc));
        bu.uAmbient.value = clamp((0.22 + 0.38 * dayF) * (1 - 0.06 * oc), 0.22, 0.6);
        mix(tmp, moonTint, white, dayF);
        mix(tmp, tmp, warm, dusk * 0.6 * (1 - oc));
        if (oc > 0) mix(tmp, tmp, rainTint, oc * 0.6);
        bu.uSkyColor.value.copy(tmp);
        bu.uFogColor.value.copy(horizon);
        bu.uFogNear.value = near;
        bu.uFogFar.value = far;
      }
      // horizon is raw sRGB; convert for three's color-managed fog/background
      scene.fog.color.setRGB(horizon.r, horizon.g, horizon.b, THREE.SRGBColorSpace);
      scene.fog.near = near;
      scene.fog.far = far;
      if (scene.background && scene.background.isColor) scene.background.copy(scene.fog.color);
      const CU = clouds.uniforms;
      CU.uFogColor.value.copy(horizon);
      CU.uFogNear.value = far * 0.75;
      CU.uFogFar.value = far * 1.7 + 60;

      // Lambert lights: sun by day, a soft lavender moonlight at night
      const L = game.lights;
      L.hemi.intensity = (0.6 + 1.35 * dayF) * (1 - 0.14 * oc);
      L.hemi.color.setRGB(0.75 + 0.25 * dayF, 0.78 + 0.22 * dayF, 1, THREE.SRGBColorSpace);
      const sunI = 1.7 * dayF * (1 - 0.55 * oc);
      const moonI = 0.32 * nightF * (1 - 0.6 * oc);
      L.sun.intensity = Math.max(sunI, moonI);
      const w = smoothstep(0.25, 0.75, dayF);
      lightDir.copy(moonDir).lerp(sunDir, w);
      if (lightDir.lengthSq() < 1e-4) lightDir.set(0, 1, 0);
      L.sun.position.copy(lightDir.normalize());
      if (w >= 0.5) L.sun.color.setRGB(1, 0.95 - 0.1 * dusk, 0.88 - 0.12 * dusk, THREE.SRGBColorSpace);
      else L.sun.color.setRGB(0.78, 0.8, 1, THREE.SRGBColorSpace);
      game.audio.setNight(dayF < 0.4);

      // time of day for the HUD
      const phase = d >= 0.2 && d < 0.3 ? 'dawn' : d >= 0.3 && d < 0.7 ? 'day' : d >= 0.7 && d < 0.8 ? 'dusk' : 'night';
      tod.phase = phase;
      tod.label = TIME_LABELS[phase];
      tod.daylight = dayF;
      tod.night = nightF;
      tod.dusk = dusk;
      const wk = game.weather ? game.weather.current : 'sunny';
      const spr = !!(game.weather && game.weather.sprinkles);
      if (phase !== keyPhase || wk !== keyWeather || spr !== keySprinkles) {
        keyPhase = phase; keyWeather = wk; keySprinkles = spr;
        tod.key = phase + ':' + wk + (spr ? '*' : '');
      }

      // morning / night events when the clock crosses them (a night slept through with
      // skipToMorning() is quiet: no time:night, so no "saw the stars" without stars)
      if (game.mode === 'play') {
        const abs = tm.day + d;
        if (lastAbs !== null && abs > lastAbs) {
          if (Math.floor(abs - MORNING_AT) > Math.floor(lastAbs - MORNING_AT)) game.events.emit('time:morning', { day: tm.day });
          if (Math.floor(abs - NIGHT_AT) > Math.floor(lastAbs - NIGHT_AT) && !tm.quietNight) game.events.emit('time:night', {});
        }
        tm.quietNight = false;
        lastAbs = abs;
      }
    },
  });
}
