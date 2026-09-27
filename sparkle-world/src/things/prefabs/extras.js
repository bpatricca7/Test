// Magic Build extras: two pieces that only the wave 2 Magic Builds place (hidden from the Bag).
//
//   big_slide / big_slide_tall  a long curvy slide from a roof deck or a treehouse porch down to
//                               the ground (or into a pool!). Hand-tap it (from the top, or from
//                               anywhere near: a sparkly hop takes her up) and she whooshes down
//                               sitting, with a rainbow trail. Standing still on its top lip
//                               for a moment starts it too.
//   lookout_telescope          a pastel telescope on a tripod: Hand-tap to peek through it
//                               (it sweeps round, sparkles fly far away, "I spy..." toasts).
//
// They are ordinary furniture (game.entities.define): saved with the world, undone with the
// build, removed with the Remove tool, batched with the rest of the furniture (static meshes).
// Frame: model space [0,w] x [0,h] x [0,d], front = +Z. A slide's entry is at the back top
// (z = 0, y = h: level with the deck it hangs from) and it runs toward its front.

import * as THREE from 'three';
import { Kit, partsOf } from '../furniture/kit.js';
import { createSfx } from '../furniture/sfx.js';
import { clamp } from '../../core/util.js';

export const SLIDE_COLORS = ['#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFE38F', '#FFBFA0'];
const SCOPE_COLORS = ['#A6D8FF', '#FF9CCB', '#C8B4FF', '#9BE8CF', '#FFE38F'];

// slide variants: [key, height (cells, = the deck's standing level above the slide's base), length]
export const SLIDES = [
  ['big_slide', 5, 7],
  ['big_slide_tall', 7, 9],
];

function lighten(hex, t) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color('#FFFFFF'), t);
  return '#' + c.getHexString();
}

/**
 * The chute's centre line in model space: a flat lip at the deck, a smooth cosine drop and a
 * gentle run-out. Returns { z: Float32Array, y: Float32Array, s: Float32Array (arc length), len }.
 */
export function slidePath(h, L) {
  const y0 = h + 0.02, y1 = 0.42;
  const zA = 0.08, zB = 0.8, zC = L - 1.25, zD = L - 0.1;
  const N = Math.max(16, Math.ceil((zD - zA) * 5));
  const z = new Float32Array(N + 1), y = new Float32Array(N + 1), s = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const zz = zA + ((zD - zA) * i) / N;
    let yy;
    if (zz <= zB) yy = y0;
    else if (zz >= zC) yy = y1;
    else yy = y1 + ((y0 - y1) * (1 + Math.cos((Math.PI * (zz - zB)) / (zC - zB)))) / 2;
    z[i] = zz;
    y[i] = yy;
    if (i > 0) s[i] = s[i - 1] + Math.hypot(zz - z[i - 1], yy - y[i - 1]);
  }
  return { z, y, s, len: s[N], N };
}

/** Point at arc length d along a path (model space) into out [x, y, z]. */
function pathAt(path, d, out) {
  const { z, y, s, N } = path;
  d = clamp(d, 0, path.len);
  let i = 1;
  while (i < N && s[i] < d) i++;
  const t = (d - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]);
  out[0] = 0.5;
  out[1] = y[i - 1] + (y[i] - y[i - 1]) * t;
  out[2] = z[i - 1] + (z[i] - z[i - 1]) * t;
  return out;
}

/** Big curvy slide model: chute with rails, a hoop at the top with a heart, white legs. */
export function bigSlideModel(color, h, L) {
  const k = new Kit();
  const path = slidePath(h, L);
  const inner = lighten(color, 0.35);
  const rail = '#FFFFFF';
  const W = 0.84, X = (1 - W) / 2;
  for (let i = 1; i <= path.N; i++) {
    const za = path.z[i - 1], ya = path.y[i - 1], zb = path.z[i], yb = path.y[i];
    const dz = zb - za, dy = ya - yb;
    const len = Math.hypot(dz, dy) + 0.03;
    const ang = Math.atan2(dy, dz);
    const opts = { rot: [ang, 0, 0], pivot: [0.5, ya, za] };
    k.box(W, 0.07, len, inner, X, ya - 0.07, za, opts);
    k.box(W + 0.02, 0.05, len, color, X - 0.01, ya - 0.12, za, opts);
    for (const x of [X - 0.02, 1 - X - 0.07]) {
      k.box(0.09, 0.3, len, color, x, ya - 0.1, za, opts);
      k.box(0.11, 0.05, len, rail, x - 0.01, ya + 0.2, za, opts);
    }
  }
  // legs under the chute (not under the lip: the deck holds that end)
  const legs = [];
  for (let d = path.len * 0.34; d < path.len - 0.6; d += 1.9) legs.push(d);
  const p = [0, 0, 0];
  for (const d of legs) {
    pathAt(path, d, p);
    if (p[1] < 0.5) continue;
    for (const x of [X + 0.04, 1 - X - 0.12]) k.box(0.08, p[1] - 0.12, 0.08, rail, x, 0, p[2] - 0.04);
    k.box(W - 0.1, 0.06, 0.06, rail, X + 0.05, Math.min(p[1] * 0.45, 1.2), p[2] - 0.03);
  }
  // end: a little bumper so she stops softly
  const zEnd = path.z[path.N];
  k.box(W, 0.12, 0.06, color, X, 0.3, zEnd - 0.04);
  // the hoop at the top with a heart
  const yTop = h;
  for (const x of [X - 0.02, 1 - X - 0.06]) k.box(0.08, 1.35, 0.08, rail, x, yTop, 0.12);
  k.box(W + 0.08, 0.1, 0.1, color, X - 0.04, yTop + 1.35, 0.11);
  const heart = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  k.pixels(heart, 0.06, { X: '#FF6FB0' }, 0.5 - 0.21, yTop + 1.47, 0.12, { depth: 0.05 });
  k.box(0.1, 0.1, 0.1, '#FFD66B', 0.45, yTop + 1.88, 0.11);
  k.hitbox(0, 0.2, 0, 1, h + 0.25, L);
  return k.build();
}

/** Telescope on a tripod; its tube (part 'tube') can sweep round. */
export function telescopeModel(color) {
  const k = new Kit();
  const leg = '#FFFFFF';
  const head = [0.5, 0.92, 0.5];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    k.stick([0.5 + Math.cos(a) * 0.36, 0, 0.5 + Math.sin(a) * 0.36], head, 0.06, leg);
  }
  k.ball(0.09, '#FFD66B', head[0], head[1], head[2]);
  const tube = k.part('tube', head[0], head[1] + 0.05, head[2]);
  const tilt = 0.42; // radians up from level
  const rot = [Math.PI / 2 - tilt, 0, 0];
  const dir = [0, Math.sin(tilt), Math.cos(tilt)];
  const at = (d) => [dir[0] * d, dir[1] * d, dir[2] * d];
  const b = at(-0.32);
  tube.cyl(0.1, 0.78, color, b[0], b[1], b[2], 14, { rot });
  const r1 = at(0.4);
  tube.cyl(0.125, 0.12, '#FFD66B', r1[0], r1[1], r1[2], 14, { rot });
  const r2 = at(0.02);
  tube.cyl(0.108, 0.06, '#FFFFFF', r2[0], r2[1], r2[2], 14, { rot });
  const lens = at(0.52);
  tube.cyl(0.1, 0.02, '#BFE8FF', lens[0], lens[1], lens[2], 14, { rot });
  const eye = at(-0.44);
  tube.cyl(0.05, 0.14, '#7A6A9A', eye[0], eye[1], eye[2], 10, { rot });
  const star = ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '.XX.XX.', 'X.....X'];
  tube.pixels(star, 0.035, { X: '#FFD66B' }, 0.095, 0.02, -0.05, { plane: 'xy', depth: 0.02 });
  k.hitbox(0.15, 0, 0.15, 0.85, 1.35, 0.85);
  return k.build();
}

const SPY_DAY = [
  'I spy a rainbow far away!',
  'I can see the whole world from here!',
  'I spy a butterfly on a flower!',
  'I can see my house!',
  'Wow! Fluffy clouds up close!',
  'I spy a sparkly gem!',
];
const SPY_NIGHT = [
  'Twinkle twinkle! So many stars!',
  'I can see the moon smiling!',
  'I spy a shooting star! Make a wish!',
  'The stars are so sparkly tonight!',
];

export function installExtras(game) {
  const E = game.entities;
  if (!E || E.defs.has('lookout_telescope')) return;
  const sfx = createSfx(game);
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const p3 = [0, 0, 0];
  const TRAIL = { count: 2 };
  const shown = { slide: false };

  /** World -> model-space point of an entity (inverse of entities.localToWorld). */
  function toLocal(e, wx, wy, wz, out) {
    const [w, , d] = e.def.size;
    const ai = Math.floor((Math.max(1, w | 0) - 1) / 2);
    const dx = wx - (e.x + 0.5), dz = wz - (e.z + 0.5);
    let a, b;
    switch (e.rot & 3) {
      case 1: a = -dz; b = dx; break; // inverse of rot 1 = rot 3
      case 2: a = -dx; b = -dz; break;
      case 3: a = dz; b = -dx; break;
      default: a = dx; b = dz;
    }
    out[0] = a + ai + 0.5;
    out[1] = wy - e.y - (e.yOffset || 0);
    out[2] = b + d - 0.5;
    return out;
  }

  // ---------- the big slides ----------

  const paths = new Map();
  for (const [key, h, L] of SLIDES) {
    const path = slidePath(h, L);
    paths.set(key, path);
    E.define({
      key, name: 'Big Slide', category: 'fun', size: [1, h, L], colors: SLIDE_COLORS,
      build: (c) => bigSlideModel(c || SLIDE_COLORS[0], h, L),
      // a lip at the top to stand on; the rest of the chute is open (she only rides it)
      colliders: [[0.08, h - 0.12, 0, 0.92, h + 0.02, 0.78]],
      actions: ['big_slide'],
      update: (e, dt) => updateSlide(e, dt),
    });
    const item = game.registry.items.get('furn:' + key);
    if (item) item.hidden = true;
  }

  function startSlide(e) {
    const p = game.player;
    if (!p || !game.world) return false;
    const path = paths.get(e.key);
    const top = pathAt(path, 0.15, p3);
    const seat = E.localToWorld(e, top[0], top[1] + 0.06, top[2], v1);
    const far = p.position.distanceTo(seat) > 2.6;
    if (far && game.particles) game.particles.emit('sparkle', v2.set(p.position.x, p.position.y + 1, p.position.z), { count: 14, spread: 0.6 });
    if (p.flying) p.setFlying(false);
    p.sitOn(e, seat, e.rot * (Math.PI / 2));
    e.anim = { t: -0.3, trail: 0, whee: false, still: 0 };
    if (game.particles) game.particles.emit('sparkle', seat, { count: 12, spread: 0.5 });
    game.audio.play('jump');
    return true;
  }

  function endSlide(e) {
    const p = game.player;
    const path = paths.get(e.key);
    // where she comes off: the end of the run-out (over the pool water for the camper)
    const end = pathAt(path, path.len - 0.35, p3);
    const w = E.localToWorld(e, end[0], end[1], end[2], v1);
    e.anim = { t: null, still: 0 };
    if (!p || p.seatEntity !== e) return;
    p.stand();
    const ph = game.physics;
    const wet = ph && ph.liquidAt && ph.liquidAt(w.x, w.y - 0.15, w.z);
    if (wet) {
      // splash! land in the pool rather than on its rim
      p.position.set(w.x, w.y - 0.2, w.z);
      p.velocity.set(0, -2.5, 0);
      if (game.particles) game.particles.emit('splash', w, { count: 22, spread: 0.8 });
      game.audio.play('splash');
    } else if (game.particles) {
      game.particles.emit('star', w, { count: 10, spread: 0.6 });
    }
    game.audio.play('success', { volume: 0.45 });
    if (!shown.slide) {
      shown.slide = true;
      game.toast('Wheee! What a big slide!', { icon: 'star', key: 'big-slide' });
    }
  }

  function updateSlide(e, dt) {
    const p = game.player;
    const a = e.anim;
    if (!p || game.mode !== 'play') return;
    if (a && a.t !== null && a.t !== undefined) {
      if (p.seatEntity !== e || p.state !== 'sit') {
        e.anim = { t: null, still: 0 };
        return;
      }
      if (game.paused) return;
      const path = paths.get(e.key);
      const dur = clamp(path.len / 5.2, 1.1, 2.3);
      a.t += dt / dur;
      const t = clamp(a.t, 0, 1);
      const k = t * t * (1.6 - 0.6 * t); // speeds up, then eases into the run-out
      pathAt(path, 0.15 + (path.len - 0.15) * k, p3);
      E.localToWorld(e, p3[0], p3[1] + 0.06, p3[2], p.position);
      p.velocity.set(0, 0, 0);
      if (a.t > 0 && !a.whee) {
        a.whee = true;
        sfx.whee();
        game.audio.play('whoosh', { volume: 0.45, pitch: 1.2 });
      }
      a.trail -= dt;
      if (a.t > 0 && a.trail <= 0 && game.particles) {
        a.trail = 0.05;
        game.particles.emit('rainbow_trail', v2.set(p.position.x, p.position.y + 0.3, p.position.z), TRAIL);
      }
      if (a.t >= 1) endSlide(e);
      return;
    }
    // standing still on the top lip for a moment starts the ride too
    if (p.state !== 'walk' || !p.onGround || game.paused) {
      if (a) a.still = 0;
      return;
    }
    const pos = p.position;
    if (Math.abs(pos.x - e.x) > 12 || Math.abs(pos.z - e.z) > 12) return;
    const [, h] = e.def.size;
    toLocal(e, pos.x, pos.y, pos.z, p3);
    const onLip = p3[0] > 0.05 && p3[0] < 0.95 && p3[2] > -0.2 && p3[2] < 0.85 && Math.abs(p3[1] - h) < 0.3;
    const still = Math.hypot(p.velocity.x, p.velocity.z) < 0.3;
    const st = a || (e.anim = { t: null, still: 0 });
    st.still = onLip && still ? st.still + dt : 0;
    if (st.still > 0.35) startSlide(e);
  }

  E.registerAction('big_slide', {
    run(g, e) {
      const p = g.player;
      if (!p) return false;
      if (p.seatEntity === e && p.state === 'sit') return true; // already whooshing
      return startSlide(e);
    },
    hint: (g, e) => (g.player && g.player.seatEntity === e ? null : 'Tap to slide!'),
  });

  // ---------- the lookout telescope ----------

  E.define({
    key: 'lookout_telescope', name: 'Telescope', category: 'fun', size: [1, 1, 1], colors: SCOPE_COLORS,
    build: (c) => telescopeModel(c || SCOPE_COLORS[0]),
    colliders: [[0.2, 0, 0.2, 0.8, 1.2, 0.8]],
    actions: ['telescope'],
    update: (e, dt) => {
      const a = e.anim;
      if (!a || a.t === null || a.t === undefined) return;
      a.t += dt;
      const tube = partsOf(e).tube;
      const t = a.t / 2.4;
      if (tube) {
        tube.rotation.y = Math.sin(t * Math.PI * 2) * 0.55 * (1 - t);
        tube.rotation.x = -Math.sin(t * Math.PI) * 0.12;
      }
      if (a.t >= 2.4) {
        if (tube) tube.rotation.set(0, 0, 0);
        e.anim = null;
      }
    },
  });
  const scopeItem = game.registry.items.get('furn:lookout_telescope');
  if (scopeItem) scopeItem.hidden = true;

  E.registerAction('telescope', {
    run(g, e) {
      const p = g.player;
      if (!p) return false;
      if (p.state === 'sit' || p.state === 'sleep') p.stand();
      e.anim = { t: 0 };
      const night = g.blockUniforms ? g.blockUniforms.uDaylight.value < 0.7 : false;
      const list = night ? SPY_NIGHT : SPY_DAY;
      const text = list[Math.floor(Math.random() * list.length)];
      g.audio.play('chime');
      g.audio.play('sparkle', { volume: 0.6 });
      if (g.particles) {
        const lens = E.localToWorld(e, 0.5, 1.25, 0.95, v1);
        g.particles.emit('star', lens, { count: 8, spread: 0.3 });
        // twinkles far out where the telescope points
        const far = E.localToWorld(e, 0.5, 6, 18, v2);
        g.particles.emit(night ? 'star' : 'sparkle', far, { count: 26, spread: 3, scale: 2 });
      }
      g.toast(text, { icon: night ? 'moon' : 'star', key: 'telescope' });
      const stats = g.profile.stats || (g.profile.stats = {});
      stats.telescopeLooks = (stats.telescopeLooks || 0) + 1;
      return true;
    },
    hint: () => 'Tap to look!',
  });

  game.events.on('world:load', () => { shown.slide = false; });
}
