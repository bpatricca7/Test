// Camping & salon life: the Hand-tool actions (sleep in a tent or camper bunk, roast a
// marshmallow at the camp fire, relax in a swinging hammock, sit at the picnic table, pop a
// juice box out of the cooler, spin in the salon chair and open the Dress-Up Studio on Hair),
// the per-piece animations (flickering flames and crackles, swinging hammock, twinkling
// string lights, the cooler lid, quilts tucking her in) and the marshmallow mini-game panel.

import * as THREE from 'three';
import { partsOf } from '../furniture/kit.js';
import { disposeObject } from '../../core/models.js';
import { clamp } from '../../core/util.js';
import { HAMMOCK, juiceBox } from './models-camp.js';
import { SALON_SEAT } from './models-salon.js';
import { basketAdd } from '../pets/kit.js';
import { FOOD } from '../food-models.js';

const JUICES = [['Apple', '#9BE8CF'], ['Grape', '#C8B4FF'], ['Berry', '#FF9CCB'], ['Orange', '#FFBFA0'], ['Lemonade', '#FFE38F']];

export function installCamp(game, sfx) {
  const E = game.entities;
  const anim = (e) => e.anim || (e.anim = {});
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const at = (e, x, y, z, out = new THREE.Vector3()) => E.localToWorld(e, x, y, z, out);
  const frontYaw = (e) => e.rot * (Math.PI / 2);
  const emit = (e, x, y, z, kind = 'sparkle', opts = {}) => {
    if (game.particles) game.particles.emit(kind, at(e, x, y, z, tmp), opts);
  };
  const seatedOn = (e, state = null) => {
    const p = game.player;
    return !!p && p.seatEntity === e && (state ? p.state === state : p.state === 'sit' || p.state === 'sleep');
  };
  const T = () => game.time.t;
  const camDist2 = (e) => (e.object3d ? game.camera.position.distanceToSquared(e.object3d.position) : 1e9);
  const playerDist = (e) => {
    const p = game.player;
    if (!p || !e.object3d) return 1e9;
    return p.position.distanceTo(e.object3d.position);
  };

  const actions = {};
  const def = (name, run, hint) => { actions[name] = { run, hint }; };

  // ---------- sleeping in tents and camper bunks ----------

  const baseSleep = E.actions.get('sleep');
  def('camp_sleep', (g, e, hit) => {
    const p = g.player;
    if (!p) return false;
    const wasAsleep = p.state === 'sleep' && p.seatEntity === e;
    let ok;
    if (baseSleep) ok = baseSleep.run(g, e, hit);
    else {
      // (no furniture sleep action: a simple nap)
      if (wasAsleep) { p.stand(); return true; }
      const s = e.def.sleepSpots ? e.def.sleepSpots[0] : e.def.sleepPos;
      p.sleepIn(e, at(e, s[0], s[1], s[2]), frontYaw(e));
      g.skipToMorning();
      ok = true;
    }
    if (ok !== false && !wasAsleep && p.state === 'sleep' && p.seatEntity === e) {
      sfx.crickets();
      setTimeout(() => sfx.crickets(), 1200);
      if (e.key === 'tent') g.award('happy_camper');
    }
    return ok;
  }, (g, e) => {
    if (baseSleep && baseSleep.hint) {
      const h = baseSleep.hint(g, e);
      if (h === 'Tap to sleep') return e.key === 'tent' ? 'Tap to sleep in the tent' : 'Tap to sleep';
      return h;
    }
    return seatedOn(e, 'sleep') ? 'Tap to get up' : 'Tap to sleep';
  });

  const cover = (e) => {
    const parts = partsOf(e);
    const asleep = seatedOn(e, 'sleep');
    const want = asleep ? (e.anim && e.anim.cover) || 'cover' : null;
    if (parts.cover) parts.cover.visible = want === 'cover';
    if (parts.cover2) parts.cover2.visible = want === 'cover2';
  };

  // ---------- camp fire: roast a marshmallow ----------

  def('roast', (g, e) => {
    const p = g.player;
    if (p && (p.state === 'walk' || p.state === 'emote')) {
      const c = at(e, 0.5, 0, 0.5, tmp2);
      p.yaw = Math.atan2(c.x - p.position.x, c.z - p.position.z);
    }
    emit(e, 0.5, 0.6, 0.5, 'sparkle', { count: 8, color: '#FFC76B' });
    sfx.crackle(1);
    if (g.ui && g.ui.hasPanel('marshmallow')) return g.ui.open('marshmallow', { entity: e });
    g.toast('Mmm, a cozy camp fire!', { icon: 'star' });
    return true;
  }, () => 'Tap to roast a marshmallow');

  // ---------- hammock ----------

  let inHammock = null;
  def('hammock', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sleep' && p.seatEntity === e) { p.stand(); g.audio.play('pop', { pitch: 1.1 }); return true; }
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    const [px, , pz] = HAMMOCK.PIVOT;
    p.sleepIn(e, at(e, px, HAMMOCK.BED_Y, pz), frontYaw(e) + Math.PI / 2, { quiet: true });
    anim(e).push = 1;
    inHammock = e;
    sfx.creak(0.9);
    emit(e, 1.5, 1.0, 0.5, 'heart', { count: 3 });
    emit(e, 1.5, 0.9, 0.5, 'sparkle', { count: 8 });
    const stats = g.profile.stats || (g.profile.stats = {});
    if (!stats.hammockNaps) g.toast('So relaxing! Swing, swing...', { icon: 'heart' });
    stats.hammockNaps = (stats.hammockNaps || 0) + 1;
    return true;
  }, (g, e) => (seatedOn(e, 'sleep') ? 'Tap to get up' : 'Tap to relax'));

  // ---------- picnic table: sit on the nearest bench spot, facing the table ----------

  const PICNIC_SEATS = [[0.55, 0.47, 0.22], [1.45, 0.47, 0.22], [0.55, 0.47, 1.78], [1.45, 0.47, 1.78]];
  def('picnic', (g, e, hit) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); g.audio.play('pop', { pitch: 1.1 }); return true; }
    let best = PICNIC_SEATS[0], bd = Infinity;
    const ref = hit && hit.point ? hit.point : p.position;
    for (const s of PICNIC_SEATS) {
      const d = at(e, s[0], s[1], s[2], tmp).distanceToSquared(ref);
      if (d < bd) { bd = d; best = s; }
    }
    p.sitOn(e, at(e, best[0], best[1], best[2]), frontYaw(e) + (best[2] > 1 ? Math.PI : 0));
    g.audio.play('pop', { pitch: 0.9 });
    emit(e, best[0], 0.9, best[2], 'sparkle', { count: 5 });
    return true;
  }, (g, e) => (seatedOn(e, 'sit') ? 'Tap to stand up' : 'Tap to sit'));

  // ---------- cooler: a juice box pops out ----------

  const fxGroup = new THREE.Group();
  fxGroup.name = 'outdoor-fx';
  const pops = [];
  def('cooler', (g, e) => {
    const a = anim(e);
    if (a.lid > 0.8) return true;
    a.lid = 2.4;
    sfx.pop();
    setTimeout(() => {
      if (!E.byUid(e.uid) || !game.world) return;
      const [name, color] = JUICES[Math.floor(Math.random() * JUICES.length)];
      if (!fxGroup.parent) game.scene.add(fxGroup);
      const obj = juiceBox(color);
      at(e, 0.5, 0.55, 0.5, obj.position);
      fxGroup.add(obj);
      pops.push({ obj, t: 0, from: obj.position.clone(), name, color });
      emit(e, 0.5, 0.6, 0.5, 'sparkle', { count: 12, color: '#DDF3FF' });
      g.audio.play('pop', { pitch: 1.3 });
    }, 280);
    return true;
  }, () => 'Tap for a juice box');

  function updatePops(dt) {
    const p = game.player;
    for (let i = pops.length - 1; i >= 0; i--) {
      const j = pops[i];
      j.t += dt;
      const t = j.t;
      if (t < 0.9) {
        // pop up and spin
        const k = t / 0.9;
        j.obj.position.set(j.from.x, j.from.y + Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * 0.9, j.from.z);
        j.obj.rotation.y += dt * 7;
        j.obj.scale.setScalar(Math.min(1.5, 0.3 + k * 2.5));
      } else if (t < 1.45 && p) {
        // fly to her hands
        const k = (t - 0.9) / 0.55;
        tmp.set(p.position.x, p.position.y + 1.1, p.position.z);
        j.obj.position.lerp(tmp, Math.min(1, k * 0.6 + 0.12));
        j.obj.rotation.y += dt * 4;
        j.obj.scale.setScalar(1.5 - k * 0.7);
      } else {
        if (p && game.particles) {
          game.particles.emit('heart', tmp.set(p.position.x, p.position.y + 1.5, p.position.z), { count: 4 });
          game.particles.emit('sparkle', tmp, { count: 8, color: j.color });
        }
        sfx.slurp();
        game.toast(`Yummy ${j.name.toLowerCase()} juice!`, { icon: 'heart', key: 'juice' });
        fxGroup.remove(j.obj);
        disposeObject(j.obj);
        pops.splice(i, 1);
      }
    }
  }

  // ---------- salon chair: sit, spin, and the Dress-Up Studio opens on Hair ----------

  let salonSeat = null;
  def('salon', (g, e) => {
    const p = g.player;
    if (!p) return false;
    const seated = p.state === 'sit' && p.seatEntity === e;
    if (!seated) {
      if (p.state === 'sit' || p.state === 'sleep') p.stand();
      p.sitOn(e, at(e, SALON_SEAT[0], SALON_SEAT[1], SALON_SEAT[2]), frontYaw(e) + Math.PI);
    }
    salonSeat = e;
    const a = anim(e);
    a.spin = 0;
    a.base = frontYaw(e) + Math.PI;
    a.open = true;
    sfx.swirl();
    emit(e, 0.5, 1.4, 1.36, 'sparkle', { count: 14, spread: 0.8 });
    return true;
  }, (g, e) => 'Tap for a new hairdo!');

  function openHairStudio() {
    const g = game;
    if (g.mode !== 'play') return;
    if (g.ui && g.ui.hasPanel('dressup')) g.ui.open('dressup', { tab: 'hair' });
    else if (g.actions && g.actions.has('dressup')) g.runAction('dressup');
    else g.toast('The Hair Salon is getting ready!', { icon: 'dress' });
  }

  // coming back from the Studio while still in the chair: a happy spin and sparkles
  game.events.on('ui:close', ({ panel }) => {
    if (panel !== 'dressup' || !salonSeat || !game.world) return;
    const e = salonSeat;
    if (!E.byUid(e.uid) || !seatedOn(e, 'sit')) return;
    const a = anim(e);
    a.spin = 0;
    a.open = false;
    sfx.dryer();
    setTimeout(() => {
      if (!E.byUid(e.uid)) return;
      emit(e, 0.5, 1.7, 1.36, 'sparkle', { count: 20, spread: 0.9 });
      emit(e, 0.5, 1.8, 1.36, 'heart', { count: 4 });
    }, 300);
  });

  for (const [name, h] of Object.entries(actions)) E.registerAction(name, h);

  // ---------- per-piece animations (def.update) ----------

  const updates = {
    tent: cover,
    camper_bunk: cover,
    campfire(e, dt) {
      const parts = partsOf(e);
      const f = parts.flames;
      const t = T() + e.uid * 1.7;
      if (f) {
        f.scale.y = 1 + 0.2 * Math.sin(t * 13.1) + 0.1 * Math.sin(t * 7.7);
        const sx = 1 + 0.08 * Math.sin(t * 9.3);
        f.scale.x = sx;
        f.scale.z = 2 - sx;
        f.rotation.y += dt * 0.7;
      }
      if (parts.tongueA) {
        parts.tongueA.scale.y = 1 + 0.4 * Math.sin(t * 15.3 + 1);
        parts.tongueA.rotation.z = 0.25 * Math.sin(t * 5.1);
      }
      if (parts.tongueB) {
        parts.tongueB.scale.y = 1 + 0.4 * Math.sin(t * 12.7 + 2);
        parts.tongueB.rotation.x = 0.25 * Math.sin(t * 4.3);
      }
      e.lightScale = 0.82 + 0.14 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 5.1);
      const a = anim(e);
      a.ember = (a.ember || 0) - dt;
      if (a.ember <= 0) {
        a.ember = 0.35 + Math.random() * 0.5;
        if (camDist2(e) < 28 * 28) {
          emit(e, 0.45 + Math.random() * 0.1, 0.5, 0.45 + Math.random() * 0.1, 'sparkle', { count: 1, color: Math.random() < 0.5 ? '#FFC76B' : '#FF9A3C', scale: 0.55, spread: 0.15 });
          if (Math.random() < 0.18) emit(e, 0.5, 0.8, 0.5, 'smoke_puff', { count: 1, scale: 0.45 });
        }
      }
      a.crack = (a.crack || 0) - dt;
      if (a.crack <= 0) {
        a.crack = 0.3 + Math.random() * 0.7;
        const d = playerDist(e);
        if (d < 10 && game.mode === 'play' && !game.paused) sfx.crackle(clamp(1.15 - d / 9, 0.1, 1));
      }
    },
    hammock(e, dt) {
      const bed = partsOf(e).bed;
      if (!bed) return;
      const a = anim(e);
      const p = game.player;
      const riding = !!p && p.state === 'sleep' && p.seatEntity === e;
      const target = riding ? 0.17 : 0.035;
      a.amp = (a.amp ?? target) + (target - (a.amp ?? target)) * Math.min(1, dt * 0.8);
      if (a.push > 0) { a.push = Math.max(0, a.push - dt); a.amp = Math.max(a.amp, 0.22 * a.push); }
      a.ph = (a.ph || e.uid) + dt * 1.7;
      const th = a.amp * Math.sin(a.ph);
      bed.rotation.x = th;
      if (riding) {
        const [px, py, pz] = HAMMOCK.PIVOT;
        const d = py - HAMMOCK.BED_Y;
        E.localToWorld(e, px, py - d * Math.cos(th), pz - d * Math.sin(th), p.position);
        if (p.avatar) {
          const grp = p.avatar.group;
          grp.position.copy(p.position);
          grp.rotation.order = 'YXZ';
          grp.rotation.z = th;
          inHammock = e;
        }
        if (Math.sign(Math.sin(a.ph)) !== Math.sign(Math.sin(a.ph - dt * 1.7)) && Math.random() < 0.5) sfx.creak(0.8 + Math.random() * 0.3);
      }
    },
    string_lights(e) {
      const parts = partsOf(e);
      if (!parts.twinkleA) return;
      const on = Math.sin(T() * 2.2 + e.uid) > 0;
      parts.twinkleA.visible = on;
      parts.twinkleB.visible = !on;
    },
    cooler(e, dt) {
      const lid = partsOf(e).lid;
      if (!lid) return;
      const a = anim(e);
      if (a.lid > 0) a.lid -= dt;
      const target = a.lid > 0 ? 1 : 0;
      a.lidT = (a.lidT ?? 0) + (target - (a.lidT ?? 0)) * Math.min(1, dt * 9);
      lid.rotation.x = -1.7 * a.lidT;
    },
    salon_chair(e, dt) {
      const chair = partsOf(e).chair;
      const a = anim(e);
      const p = game.player;
      const seated = seatedOn(e, 'sit');
      if (a.spin === undefined || a.spin >= 1) {
        if (chair && !seated) chair.rotation.y = 0;
        return;
      }
      a.spin = Math.min(1, a.spin + dt / 0.95);
      const k = a.spin;
      const turn = (1 - Math.pow(1 - k, 3)) * Math.PI * 2;
      if (chair) chair.rotation.y = turn;
      if (seated && p) {
        p.yaw = a.base + turn;
        if (p.avatar) p.avatar.group.rotation.y = p.yaw;
        if (Math.random() < dt * 6) emit(e, 0.5, 1.5, 1.36, 'sparkle', { count: 1, spread: 0.6 });
      }
      if (k >= 1) {
        if (chair) chair.rotation.y = 0;
        if (seated && p) p.yaw = a.base;
        if (a.open && seated) {
          a.open = false;
          emit(e, 0.5, 1.6, 1.36, 'star', { count: 8 });
          setTimeout(openHairStudio, 120);
        }
      }
    },
  };

  // ---------- the marshmallow mini-game ----------

  if (game.ui) installMarshmallow(game, sfx);

  return {
    actions,
    updates,
    update(dt) {
      if (pops.length) updatePops(dt);
      // hammock: undo her swing roll once she is out of it
      const p = game.player;
      if (inHammock && p && p.avatar && !(p.state === 'sleep' && p.seatEntity === inHammock)) {
        p.avatar.group.rotation.z = 0;
        inHammock = null;
      }
      if (salonSeat && !(p && p.seatEntity === salonSeat)) salonSeat = null;
    },
    unload() {
      for (const j of pops) { fxGroup.remove(j.obj); disposeObject(j.obj); }
      pops.length = 0;
      if (fxGroup.parent) fxGroup.parent.remove(fxGroup);
      inHammock = null;
      salonSeat = null;
    },
  };
}

// ======================================================================================
// Marshmallow mini-game: hold it over the fire, pull it out when it is golden.
// ======================================================================================

const MM_CSS = /* css */ `
.od-mm { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.od-mm-stage { position: relative; width: min(540px, 100%); aspect-ratio: 2 / 1; border-radius: 22px; overflow: hidden; border: 4px solid #fff; box-shadow: 0 6px 18px var(--sw-shadow); background: #2E2350; }
.od-mm-stage canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.od-mm-meter { position: relative; width: min(540px, 100%); height: 34px; display: flex; border-radius: 17px; overflow: visible; border: 4px solid #fff; box-shadow: 0 3px 10px var(--sw-shadow); }
.od-mm-zone { display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: var(--sw-ink); white-space: nowrap; }
.od-mm-zone svg { width: 16px; height: 16px; margin-right: 3px; }
.od-mm-zone.soft { background: linear-gradient(90deg, #FFFDF6, #FFEFC9); border-radius: 13px 0 0 13px; }
.od-mm-zone.gold { background: linear-gradient(90deg, #F9D78E, #EDB45E); color: #7A4A12; }
.od-mm-zone.gold svg { color: #FFF6C8; }
.od-mm-zone.crispy { background: linear-gradient(90deg, #C9853F, #6B4430); color: #FFF1DC; border-radius: 0 13px 13px 0; }
.od-mm-marker { position: absolute; top: -12px; width: 26px; height: 50px; margin-left: -13px; left: 0; pointer-events: none; }
.od-mm-marker::before { content: ''; position: absolute; left: 8px; top: 8px; width: 10px; height: 38px; border-radius: 5px; background: #fff; box-shadow: 0 0 0 3px var(--sw-pink), 0 3px 8px var(--sw-shadow); }
.od-mm-marker::after { content: ''; position: absolute; left: 3px; top: 0; border: 10px solid transparent; border-top: 12px solid var(--sw-pink); }
.od-mm-msg { min-height: 34px; font-size: 22px; font-weight: 700; color: var(--sw-lav); text-align: center; }
.od-mm-msg.od-gold { color: #E08A00; animation: sw-pop .4s var(--sw-bounce); }
.od-mm-btns { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.od-mm-btns .sw-btn { min-width: 150px; }
@media (max-width: 600px) { .od-mm-msg { font-size: 18px; } .od-mm-btns .sw-btn { min-width: 120px; } }
`;

const LEVELS = { gold: 0.5, crispy: 0.82, max: 1.3 };
const SPEED = 0.23; // level per second over the fire
const COLORS = [[0, '#FFFDF6'], [0.35, '#FFEFC9'], [0.5, '#F9D78E'], [0.66, '#EDB45E'], [0.82, '#C9853F'], [1.05, '#8A5A34'], [1.3, '#5A3A2A']];

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const COLOR_RGB = COLORS.map(([v, h]) => [v, hexRgb(h)]);
function mmColor(level) {
  let i = 0;
  while (i < COLOR_RGB.length - 2 && level > COLOR_RGB[i + 1][0]) i++;
  const [v0, c0] = COLOR_RGB[i], [v1, c1] = COLOR_RGB[i + 1];
  const t = clamp((level - v0) / (v1 - v0), 0, 1);
  return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * t)},${Math.round(c0[1] + (c1[1] - c0[1]) * t)},${Math.round(c0[2] + (c1[2] - c0[2]) * t)})`;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function installMarshmallow(game, sfx) {
  const ui = game.ui;
  ui.addStyles(MM_CSS);
  const st = {
    phase: 'ready', level: 0, t: 0, raf: 0, last: 0, entity: null, result: null, done: 0,
    stars: [], sparks: [], canvas: null, ctx: null, w: 0, h: 0, sizzle: 0, keyOff: null,
  };
  for (let i = 0; i < 26; i++) st.stars.push([Math.random(), Math.random() * 0.55, Math.random() * 6.3, 0.6 + Math.random()]);
  let els = null;

  function layout() {
    const c = st.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(100, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    st.w = w;
    st.h = h;
  }

  function setButtons(kind) {
    const b = els.btns;
    b.innerHTML = '';
    const add = (icon, label, variant, fn) => {
      const btn = ui.button({ icon, label, variant, size: 'big', onClick: fn });
      b.appendChild(btn);
      return btn;
    };
    if (kind === 'ready') add('play', 'Roast!', 'pink', startRoast).dataset.mm = 'roast';
    else if (kind === 'roast') add('star', 'Pull out!', 'sun', pullOut).dataset.mm = 'pull';
    else if (kind === 'done') {
      add('heart', 'Eat it!', 'pink', eatIt).dataset.mm = 'eat';
      if (FOOD.smores) add('plus', 'Save it', 'mint', saveIt).dataset.mm = 'save';
      add('play', 'Again!', 'lav', reset).dataset.mm = 'again';
    }
  }

  function message(text, gold = false) {
    els.msg.textContent = text;
    els.msg.classList.toggle('od-gold', gold);
  }

  function reset() {
    st.phase = 'ready';
    st.level = 0;
    st.t = 0;
    st.result = null;
    st.done = 0;
    st.sparks.length = 0;
    message('Tap Roast! Then pull it out when it is golden!');
    setButtons('ready');
    moveMarker();
  }

  function startRoast() {
    if (st.phase !== 'ready') return;
    st.phase = 'roast';
    st.t = 0;
    message('Watch it toast...');
    setButtons('roast');
    sfx.sizzle(1);
  }

  function pullOut() {
    if (st.phase !== 'roast') return;
    const lv = st.level;
    const result = lv < LEVELS.gold ? 'soft' : lv < LEVELS.crispy ? 'golden' : 'crispy';
    st.result = result;
    st.phase = 'done';
    st.done = 0;
    if (result === 'golden') {
      message('Perfect! Golden and gooey!', true);
      sfx.yay();
      game.audio.play('success', { volume: 0.7 });
      game.award('smores_star');
      for (let i = 0; i < 24; i++) st.sparks.push(spark(true));
    } else if (result === 'soft') {
      message('Soft and squishy! Still yummy!');
      game.audio.play('pop');
    } else {
      message('Crispy! Still yummy!');
      game.audio.play('pop', { pitch: 0.8 });
    }
    const stats = game.profile.stats || (game.profile.stats = {});
    stats.marshmallows = (stats.marshmallows || 0) + 1;
    if (result === 'golden') stats.goldenMarshmallows = (stats.goldenMarshmallows || 0) + 1;
    game.saveProfile();
    game.events.emit('camp:marshmallow', { result, entity: st.entity });
    setButtons('done');
    moveMarker();
  }

  function eatIt() {
    ui.close();
    game.audio.play('eat');
    const p = game.player;
    if (p && game.particles) {
      const v = new THREE.Vector3(p.position.x, p.position.y + 1.5, p.position.z);
      game.particles.emit('heart', v, { count: 6 });
      game.particles.emit('sparkle', v, { count: 10, color: '#FFE3A8' });
    }
    game.toast("Mmm! A yummy s'more!", { icon: 'heart', key: 'smore' });
    game.events.emit('food:eat', { food: 'smores' });
  }

  function saveIt() {
    ui.close();
    const n = basketAdd(game, 'smores', 1);
    game.audio.play('chime');
    game.toast(n > 1 ? `S'more saved! You have ${n} in your basket.` : "S'more saved in your basket!", { icon: 'heart', key: 'smore' });
  }

  function moveMarker() {
    const k = clamp(st.level / LEVELS.max, 0, 1);
    els.marker.style.left = `${k * 100}%`;
  }

  function spark(gold = false) {
    return {
      x: 0.5 + (Math.random() - 0.5) * (gold ? 0.3 : 0.12),
      y: gold ? 0.36 : 0.72,
      vx: (Math.random() - 0.5) * (gold ? 0.5 : 0.06),
      vy: gold ? -0.2 - Math.random() * 0.35 : -0.12 - Math.random() * 0.12,
      life: gold ? 1.2 : 1.6,
      t: 0,
      gold,
    };
  }

  function tick(now) {
    st.raf = 0;
    if (ui.current !== 'marshmallow') return;
    const dt = Math.min(0.05, Math.max(0, (now - (st.last || now)) / 1000));
    st.last = now;
    st.t += dt;
    if (st.phase === 'roast') {
      st.level = Math.min(LEVELS.max, st.level + SPEED * dt);
      st.sizzle -= dt;
      if (st.sizzle <= 0) {
        st.sizzle = 0.45;
        sfx.sizzle(0.8);
      }
      const inGold = st.level >= LEVELS.gold && st.level < LEVELS.crispy;
      if (inGold && !els.msg.classList.contains('od-gold')) message('Now! It is golden!', true);
      else if (st.level >= LEVELS.crispy && els.msg.classList.contains('od-gold')) message('Getting crispy...');
      if (st.level >= LEVELS.max) pullOut();
      moveMarker();
    } else if (st.phase === 'done') st.done += dt;
    if (Math.random() < dt * 9) st.sparks.push(spark(false));
    draw(dt);
    st.raf = requestAnimationFrame(tick);
  }

  function draw(dt) {
    const g = st.ctx, W = st.w, H = st.h;
    if (!g) return;
    const u = H / 100; // 100 units tall
    const t = st.t;
    // night sky, stars, moon, hills
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2B1F52');
    sky.addColorStop(0.7, '#6A4A9C');
    sky.addColorStop(1, '#8E6BB8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (const [x, y, ph, s] of st.stars) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.3 + ph));
      g.fillStyle = `rgba(255,246,216,${a})`;
      g.beginPath();
      g.arc(x * W, y * H, s * u * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#FFF4C4';
    g.beginPath();
    g.arc(W * 0.12, H * 0.2, 9 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2B1F52';
    g.beginPath();
    g.arc(W * 0.12 + 4 * u, H * 0.2 - 2.5 * u, 8 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3F6F5A';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, H * 0.84);
    g.quadraticCurveTo(W * 0.3, H * 0.74, W * 0.55, H * 0.83);
    g.quadraticCurveTo(W * 0.8, H * 0.9, W, H * 0.8);
    g.lineTo(W, H);
    g.fill();
    // warm glow round the fire
    const cx = W * 0.5, base = H * 0.92;
    const glowR = 42 * u * (1 + 0.05 * Math.sin(t * 9));
    const glowG = g.createRadialGradient(cx, base - 12 * u, 0, cx, base - 12 * u, glowR);
    glowG.addColorStop(0, 'rgba(255,190,110,0.55)');
    glowG.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = glowG;
    g.fillRect(cx - glowR, base - 12 * u - glowR, glowR * 2, glowR * 2);
    // logs and stones
    g.fillStyle = '#9C6B4A';
    for (const s of [-1, 1]) {
      g.save();
      g.translate(cx, base - 3 * u);
      g.rotate(s * 0.35);
      rr(g, -18 * u, -2.5 * u, 36 * u, 5 * u, 2.5 * u);
      g.fill();
      g.restore();
    }
    const stoneCols = ['#E6E0F5', '#FFE3F0', '#DDF3FF'];
    for (let i = 0; i < 7; i++) {
      g.fillStyle = stoneCols[i % 3];
      g.beginPath();
      g.ellipse(cx + (i - 3) * 8 * u, base + 2 * u, 5 * u, 3.5 * u, 0, 0, Math.PI * 2);
      g.fill();
    }
    // flames (three layers of wobbling teardrops)
    const flame = (w, h, col, ph) => {
      const wob = Math.sin(t * 11 + ph) * 0.12 + Math.sin(t * 7 + ph * 2) * 0.08;
      const fh = h * (1 + wob);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(cx - w, base - 4 * u);
      g.bezierCurveTo(cx - w * 1.1, base - fh * 0.5, cx - w * 0.3 + wob * 10 * u, base - fh * 0.8, cx + wob * 14 * u, base - fh);
      g.bezierCurveTo(cx + w * 0.3 + wob * 10 * u, base - fh * 0.8, cx + w * 1.1, base - fh * 0.5, cx + w, base - 4 * u);
      g.closePath();
      g.fill();
    };
    flame(15 * u, 40 * u, '#FF9A3C', 0);
    flame(10 * u, 30 * u, '#FFD35C', 1.3);
    flame(5.5 * u, 18 * u, '#FFF6C8', 2.1);
    // sparks
    for (let i = st.sparks.length - 1; i >= 0; i--) {
      const s = st.sparks[i];
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.t > s.life) { st.sparks.splice(i, 1); continue; }
      const a = 1 - s.t / s.life;
      g.fillStyle = s.gold ? `rgba(255,217,90,${a})` : `rgba(255,199,107,${a})`;
      g.beginPath();
      g.arc(s.x * W, s.y * H, (s.gold ? 2.2 : 1.2) * u, 0, Math.PI * 2);
      g.fill();
    }
    // the stick and the marshmallow: over the fire while roasting, lifted up otherwise
    const over = st.phase === 'roast' ? 1 : 0;
    st.over = (st.over ?? 0) + (over - (st.over ?? 0)) * Math.min(1, dt * 8);
    const mx = cx + (1 - st.over) * 14 * u, my = base - (30 + (1 - st.over) * 20) * u + Math.sin(t * 2) * 0.8 * u;
    if (st.phase !== 'done' || st.done < 0.35) {
      g.strokeStyle = '#C99A6B';
      g.lineWidth = 3 * u;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(W * 0.98, H * 0.98);
      g.lineTo(mx + 6 * u, my + 2 * u);
      g.stroke();
      drawMallow(g, mx, my, u, st.level, t, st.phase === 'done' ? 1 - st.done / 0.35 : 1);
    }
    if (st.phase === 'done') drawSmore(g, cx + 40 * u, H * 0.52, u, st.done, st.level, t);
  }

  function drawMallow(g, x, y, u, level, t, alpha) {
    g.save();
    g.globalAlpha = clamp(alpha, 0, 1);
    const w = 22 * u, h = 18 * u;
    if (level >= LEVELS.gold && level < LEVELS.crispy) {
      const halo = g.createRadialGradient(x, y, 0, x, y, 22 * u);
      halo.addColorStop(0, 'rgba(255,236,150,0.8)');
      halo.addColorStop(1, 'rgba(255,236,150,0)');
      g.fillStyle = halo;
      g.fillRect(x - 22 * u, y - 22 * u, 44 * u, 44 * u);
    }
    g.fillStyle = mmColor(level);
    rr(g, x - w / 2, y - h / 2, w, h, 7 * u);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    rr(g, x - w / 2 + 3 * u, y - h / 2 + 2 * u, w * 0.5, 4 * u, 2 * u);
    g.fill();
    if (level > 0.9) {
      g.fillStyle = 'rgba(70,40,25,0.55)';
      for (const [dx, dy, r] of [[-5, 4, 2.2], [4, -3, 1.8], [6, 5, 1.5], [-2, -5, 1.2]]) {
        g.beginPath();
        g.arc(x + dx * u, y + dy * u, r * u * clamp((level - 0.9) * 3, 0, 1), 0, Math.PI * 2);
        g.fill();
      }
    }
    // face: sparkly eyes, blush and a smile (a big grin when golden)
    const ink = level > 1.0 ? '#FFF1DC' : '#3A1F4D';
    const blink = Math.sin(t * 1.7) > 0.97;
    for (const s of [-1, 1]) {
      g.fillStyle = ink;
      g.beginPath();
      if (blink) g.ellipse(x + s * 4.5 * u, y - 1 * u, 1.6 * u, 0.5 * u, 0, 0, Math.PI * 2);
      else g.ellipse(x + s * 4.5 * u, y - 1 * u, 1.5 * u, 2 * u, 0, 0, Math.PI * 2);
      g.fill();
      if (!blink) {
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.arc(x + s * 4.5 * u + 0.5 * u, y - 1.8 * u, 0.6 * u, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(255,120,170,0.55)';
      g.beginPath();
      g.ellipse(x + s * 7.5 * u, y + 2.2 * u, 2 * u, 1.2 * u, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = ink;
    g.lineWidth = 1 * u;
    g.lineCap = 'round';
    g.beginPath();
    const grin = level >= LEVELS.gold && level < LEVELS.crispy ? 2.4 : 1.6;
    g.arc(x, y + 1.2 * u, grin * u, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.restore();
  }

  function drawSmore(g, x, y, u, k, level, t) {
    const appear = clamp((k - 0.2) / 0.5, 0, 1);
    if (appear <= 0) return;
    const drop = clamp((k - 0.45) / 0.35, 0, 1);
    const s = 1 + Math.sin(Math.min(1, k * 1.5) * Math.PI) * 0.08;
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.globalAlpha = appear;
    // plate
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(0, 16 * u, 26 * u, 5 * u, 0, 0, Math.PI * 2);
    g.fill();
    // bottom cracker, chocolate, squished marshmallow, top cracker dropping in
    const cracker = (cy) => {
      g.fillStyle = '#D9A066';
      rr(g, -18 * u, cy - 4 * u, 36 * u, 8 * u, 2 * u);
      g.fill();
      g.fillStyle = '#B87E45';
      for (const dx of [-10, -3, 4, 11]) {
        g.beginPath();
        g.arc(dx * u, cy, 0.9 * u, 0, Math.PI * 2);
        g.fill();
      }
    };
    cracker(11 * u);
    g.fillStyle = '#7A4A2A';
    rr(g, -15 * u, 4 * u, 30 * u, 4 * u, 1.5 * u);
    g.fill();
    g.fillStyle = mmColor(level);
    rr(g, -16 * u, -3 * u, 32 * u, 8 * u, 4 * u);
    g.fill();
    cracker((-8 - (1 - drop) * 20) * u);
    g.restore();
    if (drop >= 1) {
      // twinkles round the finished s'more
      for (let i = 0; i < 4; i++) {
        const a = t * 2 + i * 1.57;
        const r = (28 + Math.sin(t * 3 + i) * 3) * u;
        const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r * 0.5;
        g.fillStyle = '#FFF6C8';
        g.beginPath();
        g.moveTo(sx, sy - 3 * u);
        g.lineTo(sx + 1 * u, sy - 1 * u);
        g.lineTo(sx + 3 * u, sy);
        g.lineTo(sx + 1 * u, sy + 1 * u);
        g.lineTo(sx, sy + 3 * u);
        g.lineTo(sx - 1 * u, sy + 1 * u);
        g.lineTo(sx - 3 * u, sy);
        g.lineTo(sx - 1 * u, sy - 1 * u);
        g.closePath();
        g.fill();
      }
    }
  }

  ui.registerPanel('marshmallow', {
    title: 'Roast a Marshmallow!',
    icon: 'star',
    width: 620,
    build(container) {
      const root = ui.el('div', 'od-mm');
      const stage = ui.el('div', 'od-mm-stage');
      const canvas = ui.el('canvas');
      stage.appendChild(canvas);
      canvas.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (st.phase === 'roast') pullOut();
        else if (st.phase === 'ready') startRoast();
      });
      const meter = ui.el('div', 'od-mm-meter');
      const soft = ui.el('div', 'od-mm-zone soft', 'Soft');
      const gold = ui.el('div', 'od-mm-zone gold');
      gold.innerHTML = ui.icon('star');
      gold.appendChild(ui.el('span', '', 'Golden'));
      const crispy = ui.el('div', 'od-mm-zone crispy', 'Crispy');
      soft.style.width = `${(LEVELS.gold / LEVELS.max) * 100}%`;
      gold.style.width = `${((LEVELS.crispy - LEVELS.gold) / LEVELS.max) * 100}%`;
      crispy.style.width = `${((LEVELS.max - LEVELS.crispy) / LEVELS.max) * 100}%`;
      const marker = ui.el('div', 'od-mm-marker');
      meter.append(soft, gold, crispy, marker);
      const msg = ui.el('div', 'od-mm-msg');
      const btns = ui.el('div', 'od-mm-btns');
      root.append(stage, meter, msg, btns);
      container.appendChild(root);
      st.canvas = canvas;
      st.ctx = canvas.getContext('2d');
      els = { msg, btns, marker };
    },
    onOpen(args) {
      st.entity = (args && args.entity) || null;
      reset();
      requestAnimationFrame(() => {
        if (ui.current !== 'marshmallow') return;
        layout();
        st.last = 0;
        if (!st.raf) st.raf = requestAnimationFrame(tick);
      });
      const onKey = (ev) => {
        if (ui.current !== 'marshmallow' || ui.dialogOpen) return;
        if (ev.code === 'Space' || ev.code === 'Enter') {
          ev.preventDefault();
          if (st.phase === 'ready') startRoast();
          else if (st.phase === 'roast') pullOut();
        }
      };
      window.addEventListener('keydown', onKey, true);
      st.keyOff = () => window.removeEventListener('keydown', onKey, true);
      st.onResize = () => layout();
      window.addEventListener('resize', st.onResize);
    },
    onClose() {
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
      if (st.keyOff) st.keyOff();
      st.keyOff = null;
      if (st.onResize) window.removeEventListener('resize', st.onResize);
      st.onResize = null;
      st.entity = null;
    },
  });

  game.marshmallow = {
    get state() { return { phase: st.phase, level: st.level, result: st.result }; },
    roast: () => startRoast(),
    pull: () => pullOut(),
    setLevel(v) { st.level = v; },
  };
}
