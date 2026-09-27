// Weather: game.weather = { current, kinds, info, fx, sprinkles, set(kind, opts) }.
//   kinds: 'sunny' 'cloudy' 'rain' 'snow' 'rainbow'. set() fades to the new weather over a few
//   seconds, emits 'weather:change' { weather } and is saved per world (system 'weather').
//   Rain in the Candy Land biome (or any biome whose sky sets sprinkles: true) is sprinkle rain:
//   colorful candy sprinkles. The weather also changes by itself now and then (mostly sunny;
//   the snow biome snows a lot). Everything is gentle: soft rain sound, no thunder.
// fx (read by daynight.js): smoothed 0..1 amounts { cloud (cloud coverage 0.42..1.1),
//   overcast, rain, snow, rainbow }.

import * as THREE from 'three';
import { Heightmap, createPrecip, createRipples } from './precip.js';
import { weatherIcon } from './env-icons.js';

const KINDS = ['sunny', 'cloudy', 'rain', 'snow', 'rainbow'];
const TARGET = {
  sunny: { cloud: 0.42, overcast: 0, rain: 0, snow: 0, rainbow: 0 },
  cloudy: { cloud: 0.9, overcast: 0.5, rain: 0, snow: 0, rainbow: 0 },
  rain: { cloud: 1.1, overcast: 0.82, rain: 1, snow: 0, rainbow: 0 },
  snow: { cloud: 1.0, overcast: 0.55, rain: 0, snow: 1, rainbow: 0 },
  rainbow: { cloud: 0.5, overcast: 0, rain: 0, snow: 0, rainbow: 1 },
};
// candy sprinkle rain is a happy rain: a brighter sky
const SPRINKLE_TARGET = { cloud: 1.0, overcast: 0.3, rain: 1, snow: 0, rainbow: 0 };
const RATE = { cloud: 0.14, overcast: 0.22, rain: 0.28, snow: 0.22, rainbow: 0.3 };
const NAMES = { sunny: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', rainbow: 'Rainbow' };
const WEIGHTS = {
  default: { sunny: 6, cloudy: 2.2, rain: 1.6, rainbow: 0.8, snow: 0 },
  snow: { sunny: 3, cloudy: 1.6, rain: 0, rainbow: 0.4, snow: 5 },
  candy: { sunny: 5, cloudy: 1.2, rain: 2.4, rainbow: 1.6, snow: 0 },
  beach: { sunny: 8, cloudy: 1.5, rain: 1, rainbow: 1, snow: 0 },
  fairy: { sunny: 5, cloudy: 1.4, rain: 1.2, rainbow: 1.8, snow: 0 },
};
const DURATION = { sunny: [150, 300], cloudy: [60, 120], rain: [50, 90], snow: [100, 170], rainbow: [45, 75] };
const MANUAL_HOLD = 6 * 60; // a weather she picked herself stays a good while
const ANNOUNCE = {
  rain: ['Pitter-patter! It is raining!', 'sparkle'],
  sprinkles: ['Sprinkle rain! So sweet!', 'star'],
  snow: ['Look, it is snowing!', 'sparkle'],
  rainbow: ['Look! A rainbow!', 'star'],
};
const RAINBOW_HEX = ['#FF8C8C', '#FFB86B', '#FFE066', '#8EE08A', '#7CCBFF', '#B69CFF', '#FF9DE2'];
const RAINBOW_RGB = RAINBOW_HEX.map((h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; });

export function install(game) {
  const fx = { cloud: TARGET.sunny.cloud, overcast: 0, rain: 0, snow: 0, rainbow: 0 };
  const heightmap = new Heightmap();
  const rainLayer = createPrecip(game.scene, heightmap, { count: 2200, box: [34, 22, 34], mode: 0 });
  const snowLayer = createPrecip(game.scene, heightmap, { count: 1500, box: [30, 20, 30], mode: 1 });
  const ripples = createRipples(game.scene);
  let clock = 0;
  let timer = DURATION.sunny[0];
  let splashAcc = 0, sparkleAcc = 0, plinkAt = 0;
  const pos = new THREE.Vector3();
  let sound = null;

  const biomeKey = () => (game.world && game.world.meta ? game.world.meta.biome : 'meadow');
  const biomeDef = () => game.registry.biomes.get(biomeKey()) || null;
  const isSprinkly = () => {
    const b = biomeDef();
    return biomeKey() === 'candy' || !!(b && b.sky && b.sky.sprinkles);
  };

  const weather = {
    current: 'sunny',
    kinds: KINDS.slice(),
    info: Object.fromEntries(KINDS.map((k) => [k, { key: k, name: NAMES[k], icon: weatherIcon(k) }])),
    fx,
    sprinkles: false,
    auto: true,
    /**
     * Change the weather. opts: { instant (no fade), manual (default true: picked by the
     * player, so it stays a while), announce (toast), silent (no event) }.
     */
    set(kind, { instant = false, manual = true, announce = false, silent = false } = {}) {
      if (!TARGET[kind]) return false;
      const changed = kind !== weather.current;
      weather.current = kind;
      weather.sprinkles = kind === 'rain' && isSprinkly();
      weather.info.rain.name = isSprinkly() ? 'Sprinkles' : 'Rain';
      timer = manual ? MANUAL_HOLD : duration(kind);
      if (kind === 'rainbow' && (changed || instant)) aimRainbow();
      if (instant) Object.assign(fx, weather.sprinkles ? SPRINKLE_TARGET : TARGET[kind]);
      if (changed && announce && game.mode === 'play') {
        const a = ANNOUNCE[weather.sprinkles ? 'sprinkles' : kind];
        if (a) game.toast(a[0], { icon: a[1], color: kind === 'rainbow' ? 'pink' : 'sky' });
        if (kind === 'rainbow') game.audio.play('magic', { volume: 0.7 });
      }
      if (changed && !silent) game.events.emit('weather:change', { weather: kind });
      return true;
    },
    /** Weather the biome likes (used for new worlds). */
    startingWeather() {
      return biomeKey() === 'snow' ? 'snow' : 'sunny';
    },
  };
  game.weather = weather;

  function duration(kind) {
    const [a, b] = DURATION[kind] || [90, 150];
    return a + Math.random() * (b - a);
  }

  /** Put the rainbow where she is looking, so it is never missed. */
  function aimRainbow() {
    const yaw = game.cameraRig ? game.cameraRig.yaw : Math.PI;
    if (game.sky) game.sky.setRainbow(game.sky.dome.uniforms.uRainbow.value, Math.sin(yaw), Math.cos(yaw));
  }

  function pickNext() {
    const b = biomeDef();
    const w = { ...(WEIGHTS[biomeKey()] || WEIGHTS.default), ...((b && b.weather) || {}) };
    // rainbows need the sun: only by day
    const day = !game.timeOfDay || game.timeOfDay.daylight > 0.5;
    if (!day) w.rainbow = 0;
    if (weather.current === 'rain' && day && Math.random() < 0.55) return 'rainbow';
    if (weather.current !== 'sunny') w[weather.current] = 0;
    else w.sunny *= 0.35;
    let total = 0;
    for (const k of KINDS) total += Math.max(0, w[k] || 0);
    let r = Math.random() * total;
    for (const k of KINDS) {
      r -= Math.max(0, w[k] || 0);
      if (r <= 0) return k;
    }
    return 'sunny';
  }

  // ---------- rain sound: filtered noise + soft drips (musical plinks for sprinkles) ----------

  function ensureSound() {
    const a = game.audio;
    if (sound && sound.ctx !== a.ctx) stopSound(); // the audio engine made a new context
    if (sound || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return sound;
    try {
      const ctx = a.ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // soft pink-ish noise
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029591;
        b1 = 0.985 * b1 + w * 0.032534;
        b2 = 0.95 * b2 + w * 0.048056;
        d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(lp).connect(gain).connect(a.sfxGain);
      src.start();
      sound = { src, hp, lp, gain, ctx, vol: -1, roofed: null };
    } catch (err) {
      console.warn('[weather] rain sound unavailable', err);
      sound = null;
    }
    return sound;
  }

  function stopSound() {
    if (!sound) return;
    try { sound.src.stop(); } catch { /* already stopped */ }
    for (const n of [sound.src, sound.hp, sound.lp, sound.gain]) {
      try { if (n) n.disconnect(); } catch { /* already */ }
    }
    sound = null;
  }

  function plink(sprinkly, vol) {
    const a = game.audio;
    if (!a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return;
    const ctx = a.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const penta = [0, 2, 4, 7, 9, 12, 14, 16];
    const f = sprinkly ? 440 * Math.pow(2, (72 + penta[Math.floor(Math.random() * penta.length)] - 69) / 12) : 1600 + Math.random() * 1800;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    if (!sprinkly) o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (sprinkly ? 0.35 : 0.07));
    o.connect(g).connect(a.sfxGain);
    if (a.track) a.track(o, g); // disconnected when it ends
    o.start(t);
    o.stop(t + 0.4);
  }

  // ---------- keep the heightmap in step with building ----------

  const onBlock = ({ x, z }) => heightmap.setColumn(x, z);
  game.events.on('block:place', onBlock);
  game.events.on('block:remove', onBlock);
  // a friend's building arrives silently (multiplayer guest): rain stops falling inside her new roof
  game.events.on('net:applied', ({ cells }) => {
    if (!heightmap.world) return;
    if (!cells) {
      heightmap.attach(heightmap.world, game.registry.blocks.props);
      return;
    }
    for (let k = 0; k + 2 < cells.length; k += 3) heightmap.setColumn(cells[k], cells[k + 2]);
  });

  game.addSystem({
    name: 'weather',
    onWorldLoad(world) {
      heightmap.attach(world, game.registry.blocks.props);
      ripples.clear();
      weather.set(weather.startingWeather(), { instant: true, manual: false, silent: true });
    },
    onWorldUnload() {
      heightmap.detach();
      ripples.clear();
      stopSound();
      weather.set('sunny', { instant: true, manual: false, silent: true });
    },
    serialize() {
      return { current: weather.current, timer: Math.round(timer) };
    },
    deserialize(data) {
      if (!data || !TARGET[data.current]) return;
      weather.set(data.current, { instant: true, manual: false, silent: true });
      if (Number.isFinite(data.timer)) timer = Math.max(20, data.timer);
    },
    update(dt) {
      clock += dt;
      const target = weather.sprinkles ? SPRINKLE_TARGET : TARGET[weather.current];
      for (const k in RATE) {
        const v = fx[k], t = target[k], step = RATE[k] * dt;
        fx[k] = v < t ? Math.min(t, v + step) : Math.max(t, v - step);
      }
      const playing = game.mode === 'play' && !!game.world;
      const low = game.profile.settings.quality === 'low';
      const tod = game.timeOfDay;
      const dayF = tod ? tod.daylight : 1;
      const light = 0.5 + 0.5 * dayF;
      const cam = game.camera.position;

      if (playing && weather.auto && !game.paused) {
        timer -= dt;
        if (timer <= 0) weather.set(pickNext(), { manual: false, announce: true });
      }

      rainLayer.uniforms.uMode.value = weather.sprinkles ? 2 : 0;
      rainLayer.update(clock, cam, playing ? fx.rain : 0, light, low);
      snowLayer.update(clock, cam, playing ? fx.snow : 0, 0.65 + 0.35 * dayF, low);
      if (game.sky) game.sky.setRainbow(fx.rainbow * (0.45 + 0.55 * dayF));
      if (!playing) {
        ripples.update(clock, light);
        return;
      }
      if (fx.rain > 0 || fx.snow > 0) heightmap.tick(3);

      // splashes where the rain lands (ripple rings, a few droplets)
      const p = game.player ? game.player.position : cam;
      if (fx.rain > 0.05) {
        splashAcc += dt * 34 * fx.rain * (low ? 0.5 : 1);
        while (splashAcc >= 1) {
          splashAcc -= 1;
          const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 11;
          const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
          const w = game.world;
          if (x < 0 || z < 0 || x >= w.sx || z >= w.sz) continue;
          const top = heightmap.top(x, z);
          const fx0 = x + 0.15 + Math.random() * 0.7, fz0 = z + 0.15 + Math.random() * 0.7;
          const onWater = game.registry.blocks.props.shape[w.get(x, top, z)] === 5;
          const y = top + (onWater ? 0.9 : 1.02);
          if (weather.sprinkles) {
            const c = RAINBOW_RGB[Math.floor(Math.random() * RAINBOW_RGB.length)];
            ripples.spawn(fx0, y, fz0, clock, c[0], c[1], c[2]);
          } else {
            ripples.spawn(fx0, y, fz0, clock);
          }
          if (Math.random() < 0.18 && game.particles) {
            pos.set(fx0, y + 0.05, fz0);
            game.particles.emit('splash', pos, { count: 3, scale: 0.55, spread: 0.1 });
          }
        }
      }
      ripples.update(clock, light);

      // rainbow sparkles drifting around her
      if (fx.rainbow > 0.4 && game.particles) {
        sparkleAcc += dt * 5 * fx.rainbow * dayF;
        while (sparkleAcc >= 1) {
          sparkleAcc -= 1;
          const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 9;
          pos.set(p.x + Math.cos(a) * r, p.y + 1 + Math.random() * 4, p.z + Math.sin(a) * r);
          game.particles.emit('sparkle', pos, { count: 1, color: RAINBOW_HEX[Math.floor(Math.random() * RAINBOW_HEX.length)], scale: 1.3, spread: 0 });
        }
      }

      // gentle rain sound (quieter and muffled under a roof)
      const want = fx.rain * (game.paused ? 0.5 : 1);
      if (want > 0.01) {
        const s = ensureSound();
        if (s) {
          const px = Math.floor(p.x), pz = Math.floor(p.z);
          const roofed = heightmap.world && heightmap.top(px, pz) > p.y + 1.8;
          const t = game.audio.ctx.currentTime;
          const vol = (weather.sprinkles ? 0.07 : 0.16) * want * (roofed ? 0.55 : 1);
          // retarget only when it changes (a new automation event every frame piles up)
          if (Math.abs(vol - s.vol) > 0.004 || roofed !== s.roofed) {
            s.vol = vol;
            s.roofed = roofed;
            s.gain.gain.setTargetAtTime(vol, t, 0.4);
            s.lp.frequency.setTargetAtTime(roofed ? 650 : 1500, t, 0.4);
          }
          if (clock > plinkAt) {
            plinkAt = clock + (weather.sprinkles ? 0.18 : 0.08) + Math.random() * 0.35;
            plink(weather.sprinkles, (weather.sprinkles ? 0.035 : 0.02) * want * (roofed ? 0.5 : 1));
          }
        }
      } else if (sound) {
        if (sound.vol !== 0) {
          sound.vol = 0;
          sound.gain.gain.setTargetAtTime(0, game.audio.ctx.currentTime, 0.3);
        }
        if (fx.rain <= 0) stopSound();
      }
    },
  });
}
