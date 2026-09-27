// Home life: every Hand-tool action for furniture (sit, sleep, doors, lamps, piano, TV,
// cooking, dress-up, bath, shower, toys...), the per-piece animations (def.update) and the
// 'furniture' system that runs ladders, trampolines, the swing, the slide and toy pop-ups.

import * as THREE from 'three';
import { partsOf, Kit } from './kit.js';
import { animateWater } from './paint.js';
import { drawChannel, CHANNELS } from './tv.js';
import { DOOR_OPEN_ANGLE } from './models-structure.js';
import { SWING_PIVOT, SWING_ROPE, SLIDE_TOP, SLIDE_END } from './models-garden.js';
import { HEART_ROWS, STAR_ROWS } from './palette.js';
import { SHAPES } from '../../core/registry.js';
import { disposeObject } from '../../core/models.js';
import { icon } from '../../ui/icons.js';

const GATE_OPEN = -Math.PI / 2 + 0.1;

function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

const SLEEP_CSS = /* css */ `
.sw-sleep-moon { position: absolute; top: 14%; left: 50%; transform: translateX(-50%); width: 96px; height: 96px; color: #FFF4B8; filter: drop-shadow(0 0 18px rgba(255,240,170,.8)); animation: sw-float 3s ease-in-out infinite; }
.sw-sleep-moon svg { width: 100%; height: 100%; }
.sw-sleep-sub { position: absolute; top: 62%; left: 0; right: 0; text-align: center; font-size: 30px; font-weight: 700; color: #E6DDFF; text-shadow: 0 0 14px rgba(200,180,255,.7); }
.sw-sleep-z { position: absolute; left: 58%; top: 34%; font-size: 40px; font-weight: 700; color: #FFF6D8; opacity: 0; animation: sw-zfloat 2.4s ease-out infinite; }
@keyframes sw-zfloat { 0% { transform: translate(0, 0) scale(.6); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(60px, -90px) scale(1.3); opacity: 0; } }
`;

export function installLife(game, sfx) {
  const E = game.entities;
  const ui = game.ui;
  if (ui) ui.addStyles(SLEEP_CSS);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const at = (e, x, y, z) => E.localToWorld(e, x, y, z);
  const atTmp = (e, x, y, z) => E.localToWorld(e, x, y, z, tmp);
  const frontYaw = (e) => e.rot * (Math.PI / 2);
  const anim = (e) => e.anim || (e.anim = {});
  const emit = (e, x, y, z, kind = 'sparkle', opts = {}) => {
    if (game.particles) game.particles.emit(kind, atTmp(e, x, y, z), opts);
  };
  const dims = (e) => e.def.size;
  const center = (e, y = 0.6) => [dims(e)[0] / 2, y, dims(e)[2] / 2];
  const nameOf = () => (game.profile.look && game.profile.look.name) || game.profile.playerName || 'friend';
  const seatedOn = (e) => !!game.player && game.player.seatEntity === e && (game.player.state === 'sit' || game.player.state === 'sleep');

  function nearestSpot(entity, spots, hit) {
    if (spots.length === 1 || !hit || !hit.point) return spots[0];
    let best = spots[0], bd = Infinity;
    for (const s of spots) {
      const d = atTmp(entity, s[0], s[1], s[2]).distanceToSquared(hit.point);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  const actions = {};
  const def = (name, run, hint) => { actions[name] = { run, hint }; };

  // ---------- sitting & sleeping ----------

  def('sit', (g, e, hit) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); g.audio.play('pop', { pitch: 1.1 }); return true; }
    const s = nearestSpot(e, e.def.seats || [e.def.seat || [0.5, 0.5, 0.5]], hit);
    p.sitOn(e, at(e, s[0], s[1], s[2]), frontYaw(e));
    g.audio.play('pop', { pitch: 0.9 });
    if (e.key === 'beanbag') { sfx.fluff(); anim(e).squish = 1; }
    emit(e, s[0], s[1] + 0.4, s[2], 'sparkle', { count: 5 });
    return true;
  }, (g, e) => (seatedOn(e) ? 'Tap to stand up' : 'Tap to sit'));

  let sleeping = false;
  def('sleep', (g, e, hit) => {
    const p = g.player;
    if (!p || sleeping) return false;
    if (p.state === 'sleep' && p.seatEntity === e) { p.stand(); g.audio.play('pop', { pitch: 1.1 }); return true; }
    const spots = e.def.sleepSpots || [e.def.sleepPos || [0.5, 0.45, 1]];
    const s = nearestSpot(e, spots, hit);
    p.sleepIn(e, at(e, s[0], s[1], s[2]), frontYaw(e));
    anim(e).cover = spots.indexOf(s) === 1 ? 'cover2' : 'cover';
    sleeping = true;
    sfx.tune([[72, 1], [76, 1], [79, 2], [77, 1], [74, 1], [72, 3]], 0.34);
    emit(e, s[0], s[1] + 0.5, s[2] - 0.6, 'zzz', { count: 4 });
    emit(e, s[0], s[1] + 0.6, s[2], 'star', { count: 6 });
    const name = nameOf();
    const wake = () => {
      sleeping = false;
      g.toast(`Good morning, ${name}!`, { icon: 'sun', big: true });
      g.audio.play('success');
      sfx.chirp();
      g.award('sweet_dreams');
      if (game.entities.byUid(e.uid)) {
        emit(e, s[0], s[1] + 1.0, s[2], 'star', { count: 10 });
        emit(e, s[0], s[1] + 0.8, s[2], 'sparkle', { count: 14 });
      }
    };
    if (g.ui && g.ui.transition) {
      g.ui.transition({ text: 'Zzz…', stars: true, hold: 1900 }, () => g.skipToMorning()).then(wake);
      // decorate the dreamy fade: a glowing moon, floating z's and a sweet-dreams line
      const f = g.ui.fader;
      if (f) {
        const moon = g.ui.el('div', 'sw-sleep-moon');
        moon.innerHTML = icon('moon');
        f.appendChild(moon);
        for (let i = 0; i < 3; i++) {
          const z = g.ui.el('div', 'sw-sleep-z', 'z');
          z.style.animationDelay = `${i * 0.7}s`;
          f.appendChild(z);
        }
        f.appendChild(g.ui.el('div', 'sw-sleep-sub', `Sweet dreams, ${name}!`));
      }
    } else {
      g.skipToMorning();
      wake();
    }
    return true;
  }, (g, e) => (sleeping ? null : game.player && game.player.state === 'sleep' && game.player.seatEntity === e ? 'Tap to get up' : 'Tap to sleep'));

  // ---------- lights, doors, windows ----------

  def('lamp', (g, e) => {
    const on = e.data.on === false;
    E.setData(e, { on });
    g.audio.play(on ? 'chime' : 'click');
    const lp = e.def.lightPos || center(e);
    emit(e, lp[0], lp[1], lp[2], on ? 'sparkle' : 'smoke_puff', { count: on ? 8 : 3, scale: on ? 1 : 0.5 });
    return true;
  }, (g, e) => (e.data.on === false ? 'Tap to turn on' : 'Tap to turn off'));

  def('door', (g, e) => {
    const leaf = partsOf(e).leaf;
    if (leaf) anim(e).door = leaf.rotation.y;
    const open = !e.data.open;
    E.setData(e, { open });
    if (!open) unstick(e);
    sfx.creak(open);
    emit(e, 0.5, e.def.size[1] * 0.5, 0.5, 'sparkle', { count: 6 });
    return true;
  }, (g, e) => (e.data.open ? 'Tap to close' : 'Tap to open'));

  /** A door or gate closing on her: step her out to the nearest free spot. */
  function unstick(e) {
    const p = game.player, ph = game.physics;
    if (!p || !ph || p.state !== 'walk') return;
    const pos = p.position;
    if (!ph.bodyBlocked(pos.x, pos.y + 0.01, pos.z, p.halfW, p.height)) return;
    const spot = p.findStandSpot(pos.x, pos.y, pos.z, e);
    if (spot) {
      pos.set(spot[0], spot[1], spot[2]);
      p.velocity.set(0, 0, 0);
    }
  }

  def('window', (g, e) => {
    E.setData(e, { open: !e.data.open });
    sfx.fluff();
    emit(e, 0.5, 0.6, 0.3, 'sparkle', { count: 5 });
    return true;
  }, (g, e) => (e.data.open ? 'Tap to close the curtains' : 'Tap to open the curtains'));

  def('dollhouse', (g, e) => {
    const f = partsOf(e).front;
    if (f) anim(e).door = f.rotation.y;
    const open = !e.data.open;
    E.setData(e, { open });
    sfx.creak(open);
    if (open) { emit(e, 1, 1, 0.8, 'sparkle', { count: 14 }); g.audio.play('magic', { volume: 0.6 }); }
    return true;
  }, (g, e) => (e.data.open ? 'Tap to close' : 'Tap to peek inside'));

  // ---------- music, TV, books, painting, letters ----------

  def('piano', (g, e) => (g.ui && g.ui.hasPanel('piano') ? g.ui.open('piano', { entity: e }) : false), () => 'Tap to play piano');

  def('tv', (g, e) => {
    const ch = ((e.data.ch | 0) + 1) % CHANNELS.length;
    E.setData(e, { ch, on: ch > 0 });
    anim(e).label = 2.5;
    sfx.blip(ch > 0);
    emit(e, 1, 1.3, 0.7, ch > 0 ? 'star' : 'sparkle', { count: 6 });
    return true;
  }, (g, e) => {
    const ch = e.data.ch | 0;
    return ch === 0 ? 'Tap to watch TV' : ch === CHANNELS.length - 1 ? 'Tap to turn off' : 'Tap for the next show';
  });

  def('book', (g, e) => {
    emit(e, ...center(e, 0.8), 'sparkle', { count: 8 });
    return g.ui && g.ui.hasPanel('book') ? g.ui.open('book', { entity: e }) : false;
  }, () => 'Tap to read a story');

  def('easel', (g, e) => (g.ui && g.ui.hasPanel('easel') ? g.ui.open('easel', { entity: e }) : false), () => 'Tap to paint');

  def('mailbox', (g, e) => {
    if (e.data.mail === false) {
      g.toast('No letters right now. Check again tomorrow!', { icon: 'heart' });
      g.audio.play('click');
      return true;
    }
    const flag = partsOf(e).flag;
    if (flag) anim(e).flag = flag.rotation.x;
    E.setData(e, { mail: false });
    g.audio.play('chime');
    emit(e, 0.5, 1.0, 0.6, 'heart', { count: 5 });
    if (g.ui && g.ui.hasPanel('letter')) g.ui.open('letter', { entity: e });
    return true;
  }, (g, e) => (e.data.mail === false ? 'Tap the mailbox' : 'You have a letter!'));

  // ---------- kitchen & dress-up ----------

  def('cook', (g, e) => {
    const station = e.def.station || 'stove';
    const a = anim(e);
    if (e.key === 'fridge') { a.open = 2.2; sfx.creak(true); emit(e, 0.5, 1.2, 1.0, 'sparkle', { count: 10, color: '#DFF4FF' }); }
    else if (e.key === 'stove' || e.key === 'oven') emit(e, 0.3, 1.2, 0.4, 'smoke_puff', { count: 5, scale: 0.6 });
    emit(e, 0.5, 1.0, 0.6, 'sparkle', { count: 8 });
    if (g.ui && g.ui.hasPanel('cooking')) {
      const open = () => g.ui.open('cooking', { entity: e, station });
      if (e.key === 'fridge') setTimeout(() => { if (g.mode === 'play') open(); }, 350);
      else open();
    } else {
      g.toast('Yum! Cooking is coming soon to this kitchen!', { icon: 'star' });
      g.audio.play('chime');
    }
    return true;
  }, () => 'Tap to cook');

  def('wardrobe', (g, e) => {
    const a = anim(e);
    a.open = 2.0;
    if (e.key === 'wardrobe') sfx.creak(true);
    else g.audio.play('magic', { volume: 0.6 });
    emit(e, ...center(e, 1.2), 'sparkle', { count: 12 });
    const go = () => {
      if (g.mode !== 'play') return;
      if (g.actions.has('dressup')) g.runAction('dressup');
      else if (g.ui && g.ui.hasPanel('dressup')) g.ui.open('dressup');
      else g.toast('The Dress-Up Studio is getting ready!', { icon: 'dress' });
    };
    setTimeout(go, e.key === 'wardrobe' ? 450 : 200);
    return true;
  }, () => 'Tap to dress up');

  def('sink', (g, e) => {
    anim(e).water = 2.6;
    sfx.water(2.4);
    return true;
  }, () => 'Tap to wash your hands');

  def('yum', (g, e) => {
    g.audio.play('eat');
    emit(e, 0.5, 0.6, 0.5, 'heart', { count: 5 });
    if (e.key === 'cake_stand') emit(e, 0.5, 0.7, 0.5, 'confetti', { count: 16 });
    g.toast(e.key === 'cake_stand' ? 'Yummy cake!' : 'Crunchy and yummy!', { icon: 'heart' });
    return true;
  }, () => 'Tap for a treat');

  // ---------- bathroom ----------

  def('bath', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); g.audio.play('splash', { volume: 0.6 }); return true; }
    const s = e.def.seat;
    p.sitOn(e, at(e, s[0], s[1], s[2]), frontYaw(e));
    g.audio.play('splash');
    sfx.bubbles(8);
    emit(e, 0.5, 0.7, 1, 'bubble', { count: 14, spread: 0.8 });
    return true;
  }, (g, e) => (seatedOn(e) ? 'Tap to get out' : 'Tap for a bubble bath'));

  def('shower', (g, e) => {
    anim(e).water = 4;
    sfx.water(4);
    const p = g.player;
    if (p) {
      const c = at(e, 0.5, 0, 0.5);
      if (Math.abs(p.position.x - c.x) < 0.6 && Math.abs(p.position.z - c.z) < 0.6 && Math.abs(p.position.y - c.y) < 1) {
        setTimeout(() => g.toast('So fresh and clean!', { icon: 'sparkle' }), 900);
      }
    }
    return true;
  }, () => 'Tap for a shower');

  def('toilet', (g, e) => {
    sfx.flush();
    emit(e, 0.5, 0.6, 0.55, 'bubble', { count: 6, spread: 0.2 });
    emit(e, 0.5, 0.9, 0.5, 'sparkle', { count: 6 });
    return true;
  }, () => 'Tap to flush');

  def('towel', (g, e) => {
    sfx.fluff();
    emit(e, 0.5, 0.6, 0.3, 'sparkle', { count: 8 });
    emit(e, 0.5, 0.7, 0.3, 'heart', { count: 2 });
    return true;
  }, () => 'So soft! Tap to fluff');

  // ---------- living room ----------

  def('fireplace', (g, e) => {
    const on = e.data.on === false;
    E.setData(e, { on });
    if (on) { sfx.crackle(1.6); emit(e, 1, 0.5, 0.6, 'star', { count: 8, color: '#FFC76B' }); }
    else { g.audio.play('whoosh', { volume: 0.5 }); emit(e, 1, 0.6, 0.5, 'smoke_puff', { count: 6 }); }
    return true;
  }, (g, e) => (e.data.on === false ? 'Tap to light the fire' : 'Tap to put the fire out'));

  def('clock', (g, e) => {
    sfx.ding(2);
    emit(e, 0.5, 0.7, 0.2, 'note', { count: 3 });
    anim(e).wiggle = 1;
    g.toast(timeWords(game.time.dayTime), { icon: 'sun' });
    return true;
  }, () => 'Tap to hear the time');

  def('picture', (g, e) => {
    const base = Number.isFinite(e.data.art) ? e.data.art : Math.max(0, (e.def.colors || []).indexOf(e.color));
    E.setData(e, { art: (base + 1) % 8 });
    g.audio.play('magic', { volume: 0.5 });
    emit(e, 0.5, 0.5, 0.2, 'sparkle', { count: 10 });
    return true;
  }, () => 'Tap for a new picture');

  def('plant', (g, e) => {
    emit(e, 0.5, 0.7, 0.4, 'splash', { count: 10, spread: 0.3 });
    g.audio.play('splash', { volume: 0.4 });
    if (e.key === 'plant_pot' && !e.data.bloom) {
      setTimeout(() => {
        if (!E.byUid(e.uid)) return;
        E.setData(e, { bloom: true });
        g.audio.play('chime');
        emit(e, 0.5, 0.8, 0.5, 'petal', { count: 8 });
        emit(e, 0.5, 0.8, 0.5, 'sparkle', { count: 10 });
      }, 500);
    } else {
      emit(e, 0.5, 0.8, 0.3, 'petal', { count: 6 });
      emit(e, 0.5, 0.8, 0.3, 'heart', { count: 3 });
    }
    return true;
  }, (g, e) => (e.key === 'plant_pot' && e.data.bloom ? 'Tap to give it water' : 'Tap to water'));

  // ---------- bedroom toys & pets ----------

  def('toy_chest', (g, e) => {
    anim(e).lid = 2.4;
    sfx.creak(true);
    setTimeout(() => {
      if (!E.byUid(e.uid)) return;
      emit(e, 0.5, 0.8, 0.5, 'confetti', { count: 26 });
      g.audio.play('success', { volume: 0.7 });
      spawnToy(e);
    }, 250);
    return true;
  }, () => 'Tap to open');

  def('pet_bed', (g, e) => {
    sfx.fluff();
    emit(e, 0.5, 0.3, 0.5, 'sparkle', { count: 8 });
    emit(e, 0.5, 0.4, 0.5, 'heart', { count: 2 });
    return true;
  }, () => 'A comfy pet bed! Tap to fluff');

  def('hug', (g, e) => {
    anim(e).squish = 1;
    g.audio.play('pet');
    emit(e, 0.5, 0.7, 0.5, 'heart', { count: 8 });
    return true;
  }, () => 'Tap for a hug');

  // ---------- garden & fun ----------

  def('swing', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); return true; }
    p.sitOn(e, at(e, SWING_PIVOT[0], SWING_PIVOT[1] - SWING_ROPE + 0.02, SWING_PIVOT[2]), frontYaw(e));
    anim(e).amp = Math.max(anim(e).amp || 0, 0.15);
    sfx.whee();
    emit(e, 1, 0.9, 0.5, 'sparkle', { count: 8 });
    return true;
  }, (g, e) => (seatedOn(e) ? 'Tap to hop off' : 'Tap to swing!'));

  def('slide', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); return true; }
    p.sitOn(e, at(e, ...SLIDE_TOP), frontYaw(e));
    anim(e).slide = -0.35;
    emit(e, ...SLIDE_TOP, 'sparkle', { count: 10 });
    g.audio.play('jump');
    return true;
  }, () => 'Tap to slide!');

  def('trampoline', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    if (p.flying) p.setFlying(false);
    const c = at(e, 1, 0.47, 1);
    p.position.copy(c);
    bounce(e, 12.5);
    return true;
  }, () => 'Tap to bounce!');

  def('float', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' && p.seatEntity === e) { p.stand(); return true; }
    const y = e.data.water ? 0.86 : 0.2;
    p.sitOn(e, at(e, 0.5, y, 0.5), frontYaw(e));
    g.audio.play('splash', { volume: 0.5 });
    emit(e, 0.5, y + 0.2, 0.5, 'splash', { count: 10 });
    return true;
  }, (g, e) => (seatedOn(e) ? 'Tap to hop off' : 'Tap to float'));

  def('wish', (g, e) => {
    anim(e).bob = 1.5;
    g.audio.play('splash', { volume: 0.6 });
    setTimeout(() => g.audio.play('magic'), 250);
    const c = center(e, e.key === 'well' ? 0.8 : 0.9);
    emit(e, c[0], c[1], c[2], 'splash', { count: 16 });
    emit(e, c[0], c[1] + 0.3, c[2], 'star', { count: 12 });
    const wishes = ['You made a wish!', 'Your wish is on its way!', 'Sparkly wish sent!'];
    g.toast(wishes[Math.floor(Math.random() * wishes.length)], { icon: 'star' });
    return true;
  }, () => 'Tap to make a wish');

  def('bird', (g, e) => {
    anim(e).hop = 1.4;
    sfx.chirp();
    emit(e, 0.5, 1.5, 0.9, 'note', { count: 4 });
    return true;
  }, () => 'Tap to say hi to the bird');

  def('balloon', (g, e) => {
    anim(e).boop = 1;
    sfx.squeak();
    emit(e, 0.5, 1.6, 0.5, 'sparkle', { count: 10 });
    return true;
  }, () => 'Tap the balloons');

  def('climb', (g, e) => {
    const p = g.player;
    if (!p) return false;
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    if (p.flying) p.setFlying(false);
    const start = at(e, 0.5, 0.02, 0.45);
    p.position.copy(start);
    p.velocity.set(0, 0, 0);
    climb = { entity: e, top: ladderTop(e), until: performance.now() + 8000, over: 0 };
    g.audio.play('jump', { volume: 0.5 });
    return true;
  }, () => 'Tap to climb');

  for (const [name, h] of Object.entries(actions)) E.registerAction(name, h);

  // ---------- helpers used by actions ----------

  function timeWords(dayTime) {
    const hours = dayTime * 24;
    let h = Math.floor(hours);
    const m = (hours - h) * 60;
    let phrase;
    const h12 = (x) => (x % 12) || 12;
    if (m < 8) phrase = `${h12(h)} o'clock`;
    else if (m < 23) phrase = `quarter past ${h12(h)}`;
    else if (m < 38) phrase = `half past ${h12(h)}`;
    else if (m < 53) { h += 1; phrase = `quarter to ${h12(h)}`; }
    else { h += 1; phrase = `${h12(h)} o'clock`; }
    const hh = h % 24;
    const part = hh >= 5 && hh < 12 ? 'in the morning' : hh >= 12 && hh < 17 ? 'in the afternoon' : hh >= 17 && hh < 21 ? 'in the evening' : 'at night';
    return `It's ${phrase} ${part}!`;
  }

  function bounce(e, v) {
    const p = game.player;
    p.velocity.y = v;
    p.onGround = false;
    if (p.body) p.body.onGround = false;
    sfx.boing(v > 13 ? 1.2 : 1);
    anim(e).wobble = 0.6;
    if (game.particles) {
      game.particles.emit('star', tmp.set(p.position.x, p.position.y + 0.2, p.position.z), { count: 6 });
    }
  }

  function ladderTop(e) {
    let top = e.y + e.def.size[1];
    for (let guard = 0; guard < 64; guard++) {
      const n = E.at(e.x, top, e.z);
      if (!n || !n.def.climb) break;
      top = n.y + n.def.size[1];
    }
    return top;
  }

  // ---------- toy pop-ups from the toy chest ----------

  const toys = [];
  const fxGroup = new THREE.Group();
  fxGroup.name = 'furniture-fx';
  const TOY_BUILDERS = [
    (k) => { k.ball(0.14, '#FF8FB8', 0, 0, 0); k.torus(0.14, 0.03, '#FFFFFF', 0, 0, 0, { rot: [Math.PI / 2, 0, 0] }); k.torus(0.14, 0.03, '#8FD0FF', 0, 0, 0); },
    (k) => { k.ball(0.12, '#FFE36B', 0, 0, 0, { sz: 1.3 }); k.ball(0.08, '#FFE36B', 0, 0.12, 0.06); k.box(0.06, 0.03, 0.07, '#FF9E4F', -0.03, 0.1, 0.12); },
    (k) => { k.pixels(STAR_ROWS, 0.05, { X: '#FFD43B' }, -0.175, -0.15, -0.03, { depth: 0.06 }); },
    (k) => { k.pixels(HEART_ROWS, 0.05, { X: '#FF5FA2' }, -0.175, -0.15, -0.03, { depth: 0.06 }); },
    (k) => { k.box(0.24, 0.24, 0.24, '#9BE8CF', -0.12, -0.12, -0.12, { faces: { pz: '#FF9CCB', px: '#FFE38F', py: '#A6D8FF' } }); },
    (k) => { k.ball(0.1, '#E7BE8C', 0, 0, 0); k.ball(0.08, '#E7BE8C', 0, 0.15, 0); k.ball(0.035, '#E7BE8C', -0.06, 0.22, 0); k.ball(0.035, '#E7BE8C', 0.06, 0.22, 0); k.ball(0.035, '#FFF1D6', 0, 0.14, 0.07); },
  ];
  function spawnToy(e) {
    if (!game.world) return;
    if (!fxGroup.parent) game.scene.add(fxGroup);
    const k = new Kit();
    TOY_BUILDERS[Math.floor(Math.random() * TOY_BUILDERS.length)](k);
    const obj = k.build();
    obj.position.copy(at(e, 0.5, 0.6, 0.5));
    fxGroup.add(obj);
    toys.push({ obj, t: 0, y0: obj.position.y });
  }
  function updateToys(dt) {
    for (let i = toys.length - 1; i >= 0; i--) {
      const toy = toys[i];
      toy.t += dt;
      const t = toy.t;
      toy.obj.position.y = toy.y0 + Math.min(1, t * 2.2) * 1.1 + Math.sin(t * 4) * 0.05;
      toy.obj.rotation.y += dt * 3;
      const s = t < 0.25 ? t / 0.25 : t > 2.1 ? Math.max(0, 1 - (t - 2.1) / 0.3) : 1;
      toy.obj.scale.setScalar(Math.max(0.001, s * 1.4));
      if (t > 2.4) {
        if (game.particles) game.particles.emit('sparkle', toy.obj.position, { count: 10 });
        fxGroup.remove(toy.obj);
        disposeObject(toy.obj);
        toys.splice(i, 1);
      }
    }
  }
  function clearToys() {
    for (const toy of toys) { fxGroup.remove(toy.obj); disposeObject(toy.obj); }
    toys.length = 0;
    if (fxGroup.parent) fxGroup.parent.remove(fxGroup);
  }

  // ---------- per-piece animations (def.update) ----------

  const approach = (cur, target, dt, speed = 9) => {
    if (cur === undefined) return target;
    const d = target - cur;
    return Math.abs(d) < 0.002 ? target : cur + d * Math.min(1, dt * speed);
  };
  const T = () => game.time.t;

  const hinge = (partName, openAngle, axis = 'y', key = 'door') => (e, dt) => {
    const p = partsOf(e)[partName];
    if (!p) return;
    const a = anim(e);
    a[key] = approach(a[key], e.data.open ? openAngle : 0, dt, 8);
    p.rotation[axis] = a[key];
  };

  const timedDoors = (list) => (e, dt) => {
    const a = anim(e);
    const parts = partsOf(e);
    if (a.open > 0) a.open -= dt;
    const target = a.open > 0 ? 1 : 0;
    a.doorT = approach(a.doorT, target, dt, 7);
    for (const [name, angle, axis] of list) if (parts[name]) parts[name].rotation[axis || 'y'] = angle * a.doorT;
  };

  const water = (partName, splashAt) => (e, dt) => {
    const a = anim(e);
    const part = partsOf(e)[partName];
    const on = a.water > 0;
    if (part) part.visible = on;
    if (!on) return;
    a.water -= dt;
    a.drip = (a.drip || 0) - dt;
    if (a.drip <= 0) {
      a.drip = 0.12;
      emit(e, splashAt[0], splashAt[1], splashAt[2], 'splash', { count: 3, spread: 0.2, scale: 0.7 });
      if (Math.random() < 0.3) emit(e, splashAt[0], splashAt[1] + 0.1, splashAt[2], 'bubble', { count: 1 });
    }
  };

  // a puffed-up quilt tucks her in while she sleeps
  const bedCover = (e) => {
    const parts = partsOf(e);
    const p = game.player;
    const asleep = !!p && p.state === 'sleep' && p.seatEntity === e;
    const want = asleep ? (e.anim && e.anim.cover) || 'cover' : null;
    if (parts.cover) parts.cover.visible = want === 'cover';
    if (parts.cover2) parts.cover2.visible = want === 'cover2';
  };

  const U = {
    bed_single: bedCover,
    bed_double: bedCover,
    bed_canopy: bedCover,
    bed_bunk: bedCover,
    bed_heart: bedCover,
    bed_cloud: bedCover,
    door: hinge('leaf', DOOR_OPEN_ANGLE),
    door_pink: hinge('leaf', DOOR_OPEN_ANGLE),
    door_glass: hinge('leaf', DOOR_OPEN_ANGLE),
    gate: hinge('leaf', GATE_OPEN),
    dollhouse: hinge('front', -1.95),
    window_frame(e, dt) {
      const parts = partsOf(e);
      const a = anim(e);
      a.cur = approach(a.cur, e.data.open ? 0.32 : 1, dt, 6);
      if (parts.curtainL) parts.curtainL.scale.x = a.cur;
      if (parts.curtainR) parts.curtainR.scale.x = a.cur;
    },
    wardrobe: timedDoors([['doorL', -1.9], ['doorR', 1.9]]),
    fridge: timedDoors([['door', 1.5], ['freezer', 1.2]]),
    toy_chest(e, dt) {
      const a = anim(e);
      if (a.lid > 0) a.lid -= dt;
      a.lidT = approach(a.lidT, a.lid > 0 ? 1 : 0, dt, 8);
      const lid = partsOf(e).lid;
      if (lid) lid.rotation.x = -1.5 * a.lidT;
    },
    mailbox(e, dt) {
      const flag = partsOf(e).flag;
      if (!flag) return;
      const a = anim(e);
      a.flag = approach(a.flag, e.data.mail === false ? Math.PI / 2 : 0, dt, 6);
      flag.rotation.x = a.flag;
    },
    clock(e) {
      const parts = partsOf(e);
      const hours = game.time.dayTime * 24;
      if (parts.hour) parts.hour.rotation.z = -((hours % 12) / 12) * Math.PI * 2;
      if (parts.minute) parts.minute.rotation.z = -(hours % 1) * Math.PI * 2;
      if (parts.tail) {
        const a = anim(e);
        if (a.wiggle > 0) a.wiggle -= 0.016;
        parts.tail.rotation.z = Math.sin(T() * 3.2) * (0.3 + Math.max(0, a.wiggle || 0) * 0.3);
      }
    },
    fireplace(e) {
      const f = partsOf(e).flames;
      if (!f) { e.lightScale = 1; return; }
      const t = T();
      f.scale.y = 1 + 0.18 * Math.sin(t * 13.1) + 0.1 * Math.sin(t * 7.7);
      f.scale.x = 1 + 0.06 * Math.sin(t * 9.3);
      e.lightScale = 0.85 + 0.12 * Math.sin(t * 11.3) + 0.08 * Math.sin(t * 5.1);
      const a = anim(e);
      a.ember = (a.ember || 0) - 0.016;
      if (a.ember <= 0) {
        a.ember = 0.7 + Math.random() * 0.8;
        emit(e, 1 + (Math.random() - 0.5) * 0.4, 0.5, 0.5, 'sparkle', { count: 1, color: '#FFC76B', scale: 0.6 });
      }
    },
    candle(e) {
      const f = partsOf(e).flame;
      if (!f) { e.lightScale = 1; return; }
      const t = T() + e.uid;
      f.scale.y = 1 + 0.15 * Math.sin(t * 12.7) + 0.08 * Math.sin(t * 6.1);
      f.rotation.z = 0.08 * Math.sin(t * 5.3);
      e.lightScale = 0.88 + 0.1 * Math.sin(t * 10.1) + 0.05 * Math.sin(t * 4.3);
    },
    fairy_lights(e) {
      const parts = partsOf(e);
      if (!parts.twinkleA) return;
      const on = Math.sin(T() * 2.6 + e.uid) > 0;
      parts.twinkleA.visible = on;
      parts.twinkleB.visible = !on;
    },
    tv(e, dt) {
      const model = e.object3d && e.object3d.children[0];
      const scr = model && model.userData.screen;
      if (!scr) return;
      const a = anim(e);
      if (a.label > 0) a.label -= dt;
      scr.t += dt;
      scr.acc += dt;
      if (scr.acc < 1 / 12) return;
      if (game.camera.position.distanceToSquared(e.object3d.position) > 26 * 26) return;
      scr.acc = 0;
      drawChannel(scr.ctx, e.data.ch | 0, scr.t, a.label > 0);
      scr.tex.needsUpdate = true;
    },
    crib(e, dt) {
      bedCover(e);
      const m = partsOf(e).mobile;
      if (m) m.rotation.y += dt * 0.6;
    },
    balloon_bunch(e, dt) {
      const b = partsOf(e).bunch;
      if (!b) return;
      const a = anim(e);
      if (a.boop > 0) a.boop = Math.max(0, a.boop - dt * 1.2);
      const t = T() + e.uid * 1.7;
      b.rotation.z = Math.sin(t * 0.9) * 0.07 + Math.sin(t * 7) * 0.08 * (a.boop || 0);
      b.rotation.x = Math.cos(t * 0.7) * 0.05;
      b.position.y = 0.22 + Math.sin(t * 1.3) * 0.03 + Math.abs(Math.sin(t * 9)) * 0.12 * (a.boop || 0);
    },
    bird_house(e, dt) {
      const b = partsOf(e).bird;
      if (!b) return;
      const a = anim(e);
      if (a.hop > 0) a.hop -= dt;
      const hop = Math.max(0, a.hop || 0);
      b.position.y = 1.23 + Math.abs(Math.sin(hop * 9)) * 0.1 * (hop > 0 ? 1 : 0);
      b.rotation.y = hop > 0 ? Math.sin(hop * 6) * 0.6 : Math.sin(T() * 0.5 + e.uid) * 0.25;
    },
    well(e, dt) {
      const b = partsOf(e).bucket;
      if (!b) return;
      const a = anim(e);
      if (a.bob > 0) a.bob -= dt;
      const bob = Math.max(0, a.bob || 0);
      b.position.y = 1.44 - Math.sin(Math.min(1, bob / 1.5) * Math.PI) * 0.25;
      b.rotation.y += dt * (0.3 + bob);
    },
    fountain(e, dt) {
      const a = anim(e);
      a.sp = (a.sp || 0) - dt;
      if (a.sp > 0) return;
      a.sp = 0.45;
      if (game.camera.position.distanceToSquared(e.object3d.position) > 22 * 22) return;
      emit(e, 1, 0.85, 1, 'splash', { count: 2, spread: 0.2, scale: 0.6 });
      if (a.bob > 0) { a.bob -= 0.45; emit(e, 1, 0.9, 1, 'sparkle', { count: 4 }); }
    },
    teddy_bear(e, dt) {
      const b = partsOf(e).bear;
      if (!b) return;
      const a = anim(e);
      if (!(a.squish > 0)) { if (b.scale.x !== 1) b.scale.set(1, 1, 1); return; }
      a.squish = Math.max(0, a.squish - dt * 1.6);
      const s = Math.sin(a.squish * Math.PI * 3) * 0.18 * a.squish;
      b.scale.set(1 + s, 1 - s, 1 + s);
    },
    beanbag(e, dt) {
      const a = anim(e);
      const model = e.object3d && e.object3d.children[0];
      if (!model || !(a.squish > 0)) return;
      a.squish = Math.max(0, a.squish - dt * 2);
      const s = Math.sin(a.squish * Math.PI * 2) * 0.1 * a.squish;
      model.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    },
    trampoline(e, dt) {
      const a = anim(e);
      const model = e.object3d && e.object3d.children[0];
      if (!model || !(a.wobble > 0)) { if (model && model.scale.y !== 1) model.scale.y = 1; return; }
      a.wobble = Math.max(0, a.wobble - dt);
      model.scale.y = 1 - Math.sin(a.wobble * 20) * 0.06 * a.wobble;
    },
    sink_kitchen: water('water', [0.5, 0.72, 0.52]),
    sink_bath: water('water', [0.5, 0.74, 0.42]),
    shower: water('rain', [0.5, 0.12, 0.45]),
    bathtub(e, dt) {
      if (!seatedOn(e)) return;
      const a = anim(e);
      a.bub = (a.bub || 0) - dt;
      if (a.bub > 0) return;
      a.bub = 0.3;
      emit(e, 0.3 + Math.random() * 0.4, 0.62, 0.3 + Math.random() * 1.4, 'bubble', { count: 2, spread: 0.3 });
      if (Math.random() < 0.15) sfx.bubbles(2);
    },
    swing(e, dt) {
      const seat = partsOf(e).seat;
      if (!seat) return;
      const a = anim(e);
      const p = game.player;
      const riding = !!p && p.seatEntity === e && p.state === 'sit';
      a.amp = riding ? Math.min(0.62, (a.amp || 0) + dt * 0.35) : (a.amp || 0) * Math.max(0, 1 - dt * 0.5);
      if (a.amp < 0.001 && !riding) { seat.rotation.x = 0; return; }
      const prev = Math.sin(a.ph || 0);
      a.ph = (a.ph || 0) + dt * 2.4;
      const th = a.amp * Math.sin(a.ph);
      seat.rotation.x = th;
      if (riding) {
        const ly = SWING_PIVOT[1] - SWING_ROPE * Math.cos(th) + 0.02;
        const lz = SWING_PIVOT[2] - SWING_ROPE * Math.sin(th);
        E.localToWorld(e, SWING_PIVOT[0], ly, lz, p.position);
        if (p.avatar) {
          const grp = p.avatar.group;
          grp.position.copy(p.position);
          grp.rotation.order = 'YXZ';
          grp.rotation.x = th;
          tilted = true;
        }
        if (prev < 0 && Math.sin(a.ph) >= 0 && a.amp > 0.3) game.audio.play('whoosh', { volume: 0.3 });
      }
    },
    slide(e, dt) {
      const a = anim(e);
      if (a.slide === undefined) return;
      const p = game.player;
      if (!p || p.seatEntity !== e || p.state !== 'sit') { a.slide = undefined; return; }
      a.slide += dt / 1.25;
      const t = Math.max(0, Math.min(1, a.slide));
      const k = t * t;
      const x = SLIDE_TOP[0] + (SLIDE_END[0] - SLIDE_TOP[0]) * k;
      const y = SLIDE_TOP[1] + (SLIDE_END[1] - SLIDE_TOP[1]) * k;
      const z = SLIDE_TOP[2] + (SLIDE_END[2] - SLIDE_TOP[2]) * k;
      E.localToWorld(e, x, y, z, p.position);
      if (a.slide > 0 && !a.wheed) { a.wheed = true; sfx.whee(); }
      a.trail = (a.trail || 0) - dt;
      if (a.slide > 0 && a.trail <= 0) {
        a.trail = 0.05;
        if (game.particles) game.particles.emit('rainbow_trail', tmp2.set(p.position.x, p.position.y + 0.3, p.position.z), { count: 2 });
      }
      if (a.slide >= 1) {
        a.slide = undefined;
        a.wheed = false;
        p.stand();
        emit(e, 0.5, 0.6, 3.3, 'star', { count: 10 });
        game.audio.play('success', { volume: 0.5 });
      }
    },
    pool_float(e, dt) {
      const f = partsOf(e).float;
      if (!f) return;
      const base = e.data.water ? 0.8 : 0.13;
      const bob = e.data.water ? Math.sin(T() * 1.8 + e.uid) * 0.04 : 0;
      f.position.y = base + bob;
      f.rotation.y = e.data.water ? Math.sin(T() * 0.4 + e.uid) * 0.3 : 0;
      const p = game.player;
      if (p && p.seatEntity === e && p.state === 'sit') {
        E.localToWorld(e, 0.5, (e.data.water ? 0.86 : 0.2) + bob, 0.5, p.position);
        if (p.avatar) p.avatar.group.position.copy(p.position);
      }
    },
  };

  // ---------- the furniture system: ladders, trampolines, toys, water ----------

  let climb = null;
  let tilted = false;
  const dir = new THREE.Vector3();

  function updatePlayerMechanics(dt) {
    const p = game.player;
    const input = game.input;
    if (!p || !game.world) return;
    // undo the swing lean once she is off the swing
    if (tilted && p.avatar && !(p.state === 'sit' && p.seatEntity && p.seatEntity.key === 'swing')) {
      p.avatar.group.rotation.x = 0;
      tilted = false;
    }
    if (p.state !== 'walk' || p.flying) {
      if (climb && p.state !== 'walk') climb = null;
      return;
    }
    const px = Math.floor(p.position.x), pz = Math.floor(p.position.z);
    // trampoline: landing on it bounces you up high
    if (p.onGround) {
      const under = E.at(px, Math.floor(p.position.y - 0.08), pz);
      if (under && under.def.bounce && p.position.y - under.y > 0.3) bounce(under, input.jump ? 15 : 12);
    }
    // ladders: press forward or jump while touching one to climb; tapping one climbs by itself
    let lad = E.at(px, Math.floor(p.position.y + 0.1), pz);
    if (!lad || !lad.def.climb) lad = E.at(px, Math.floor(p.position.y + 1.0), pz);
    if (lad && !lad.def.climb) lad = null;
    if (climb) {
      const c = climb;
      if (performance.now() > c.until || !E.byUid(c.entity.uid)) climb = null;
      else if (p.position.y < c.top + 0.05) {
        const t = E.localToWorld(c.entity, 0.5, 0, 0.45, tmp2);
        p.velocity.x = (t.x - p.position.x) * 6;
        p.velocity.z = (t.z - p.position.z) * 6;
        p.velocity.y = 3.6;
        p.onGround = false;
        if (Math.random() < dt * 5) game.audio.play('step', { pitch: 1.3 });
      } else {
        // at the top: step over onto whatever the ladder leans against
        E.localToWorld(c.entity, 0.5, 0, -0.5, dir);
        dir.sub(E.localToWorld(c.entity, 0.5, 0, 0.5, tmp2)).normalize();
        p.velocity.x = dir.x * 3;
        p.velocity.z = dir.z * 3;
        c.over += dt;
        if (c.over > 0.45) {
          climb = null;
          game.celebrate([p.position.x, p.position.y + 1, p.position.z], 'sparkle', { quiet: true });
        }
      }
      return;
    }
    if (lad) {
      if (input.jump || input.move.z > 0.3) {
        p.velocity.y = 3.4;
        p.onGround = false;
      } else if (p.velocity.y < -1.6) {
        p.velocity.y = -1.6; // holding on: slide down gently
      }
    }
  }

  game.addSystem({
    name: 'furniture',
    update(dt) {
      if (!game.world) return;
      animateWater(game.time.t);
      if (toys.length) updateToys(dt);
      if (game.mode === 'play' && !game.paused) updatePlayerMechanics(dt);
    },
    onWorldUnload() {
      clearToys();
      climb = null;
      sleeping = false;
    },
  });

  // mail arrives every morning
  game.events.on('time:morning', () => {
    // a friend visiting (multiplayer guest) gets the host's mail flags from the host
    if (!game.world || (game.net && game.net.isGuest)) return;
    for (const e of E.all()) if (e.key === 'mailbox' && e.data.mail === false) E.setData(e, { mail: true });
  });

  // ---------- fences connect to their neighbours ----------

  const DIRS = [[1, 1, 0], [2, -1, 0], [4, 0, 1], [8, 0, -1]];
  const connects = (x, y, z) => {
    const n = E.at(x, y, z);
    if (n) return n.key === 'fence' || n.key === 'gate';
    const w = game.world;
    const id = w.get(x, y, z);
    const props = game.registry.blocks.props;
    return !!props && props.solid[id] === 1 && props.shape[id] === SHAPES.cube;
  };
  function refreshFence(e) {
    if (!e || e.key !== 'fence' || !E.byUid(e.uid)) return;
    let conn = 0;
    for (const [bit, lx, lz] of DIRS) {
      const [wx, wz] = rotXZ(lx, lz, e.rot);
      if (connects(e.x + wx, e.y, e.z + wz)) conn |= bit;
    }
    if ((e.data.conn | 0) !== conn) E.setData(e, { conn });
  }
  function refreshAround(x, y, z) {
    if (!game.world) return;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = E.at(x + dx, y, z + dz);
      if (n && n.key === 'fence') refreshFence(n);
    }
  }
  game.events.on('entity:place', ({ entity }) => {
    if (entity && (entity.key === 'fence' || entity.key === 'gate')) refreshAround(entity.x, entity.y, entity.z);
  });
  game.events.on('entity:remove', ({ entity }) => {
    if (entity && (entity.key === 'fence' || entity.key === 'gate')) refreshAround(entity.x, entity.y, entity.z);
  });
  game.events.on('block:place', ({ x, y, z }) => refreshAround(x, y, z));
  game.events.on('block:remove', ({ x, y, z }) => refreshAround(x, y, z));

  return { updates: U, actions, spawnToy, timeWords };
}
