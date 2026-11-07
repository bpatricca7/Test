// The Twinkle Elves (docs/teams/elves.md, wave5-plan.md §7.6): small elves of our own who
// love hide and seek.
//
//  - Holiday Village: an elf hides at every `holiday:elf` spot (placed once when the world is
//    made). Tap one: a giggle, a little line, sparkles, "You found Pip! 3 of 12". A soft jingle
//    gets louder near an elf you have not found; the life column shows a counter that opens
//    the Twinkle Elves panel. `holiday:elfhome` is the elves' cottage sign with Bramble, who
//    says hello (that is where you meet them first).
//  - The house elf: once you have met the elves, an elf moves into any world where you have a
//    bed (or right away into any world when an Elf Door from the Bag goes on a wall). Every
//    new game morning (and on loading the world on a new day) it hides somewhere new in or
//    around your home, sometimes with a tiny scene. Find it and tap: a giggle, a line, a tiny
//    surprise. You can name it.
//  - Everything an elf does is an entity placed or moved through game.entities on the host
//    only (friends see it); elves never move or change blocks or furniture, never stand
//    inside a block and never hide out of reach (spots.js).
//  - Bag (Holiday tab): Twinkle Elf (12 colors, a friendly figure that giggles), Elf Door,
//    Elf Sign. Stickers elf_first, elf_all, elf_home. At most 10 coins a day.
//
// game.elves (facade) and game.debug.elves (probes) are at the end.

import {
  NAMES, GREETER, SCHEMES, SWATCHES, LINES, SCENES, RANDOM_SCENES, COIN_HOUSE, COIN_VILLAGE, HOME_STICKER_FINDS, ALL_MIN,
  MAX_HIDERS, JINGLE_NEAR, TWINKLE_NEAR, SCENE_CHANCE, schemeIndex, whereLabel, dayStamp, hashStr, rng, worldKey, houseIndex,
  cleanName, pickOne, normalizeElves, isFound, markFound, countFound, markHomeFind, takeCoins, normalizeWorldData,
} from './data.js';
import { pickHideSpot, nearestSpot, spotSupport, findStand, homeRegion } from './spots.js';
import { makeView } from './view.js';
import { buildElf, buildElfDoor, buildElfSign, DOOR_COLORS, SIGN_COLORS, poseOf } from './models.js';
import { elfSfx } from './sfx.js';
import { ELF_STICKERS } from './art.js';
import { installElfUI, blocked, elfPortrait } from './ui.js';
import { FOOD } from '../food-models.js';
import { basketAdd } from '../pets/kit.js';

export const KEY_ELF = 'elf_twinkle';
export const KEY_DOOR = 'elf_door';
export const KEY_SIGN = 'elf_sign';
const TAB = 'holiday';
const ROLES = new Set(['hide', 'house', 'greet']);
const TAU = Math.PI * 2;
const QUIET = { history: false, fx: false, events: false };

export function install(game) {
  const E = game.entities;
  if (!E || !game.ui) return;
  const ev = game.events;
  const bot = typeof navigator !== 'undefined' && !!navigator.webdriver;
  const guest = () => !!(game.net && game.net.isGuest);
  const remote = () => !!(game.net && game.net.remoteApplying);

  // ---------------- state ----------------

  const st = {
    wk: '', // this world's key (profile progress)
    data: normalizeWorldData(null), // this world's save (systems.elves): the house elf
    nextIdx: 0, // the next village elf's number while a new world is placed
    hiders: [], // the village elves here (entities), refreshed every second
    house: null, // the house elf entity here (any page)
    listT: 0,
    jingleT: 3,
    twinkleT: 1,
    sweepT: 2,
    queue: [], // toasts this module starts by itself, shown when the world is clear
    queueT: 0,
    popups: !bot, // off under test drivers (wave5-plan "one thing at a time"); debug.popups(true)
  };

  /** profile.elves, made clean once (a merge may replace the profile: read it fresh). */
  const clean = new WeakSet();
  function prof(create = false) {
    const p = game.profile;
    if (!p) return null;
    if (!p.elves) {
      if (!create) return null;
      p.elves = normalizeElves(null);
      clean.add(p.elves);
    }
    if (!clean.has(p.elves)) {
      p.elves = normalizeElves(p.elves);
      clean.add(p.elves);
    }
    return p.elves;
  }

  const isHoliday = () => !!(game.world && game.world.meta && game.world.meta.biome === 'holiday');
  const isElf = (e) => !!e && e.key === KEY_ELF;
  const nameOf = (e) => {
    const d = (e && e.data) || {};
    if (d.role === 'greet') return GREETER;
    return cleanName(d.name, NAMES[schemeIndex(d, e && e.color)]);
  };

  /** Is this elf found by this player (the gold star over it; the jingle stops)? */
  function foundHere(e) {
    const d = e.data || {};
    const pe = prof();
    if (d.role === 'hide') return isFound(pe, st.wk, d.idx);
    if (d.role === 'house') return !!pe && (pe.home[st.wk] | 0) >= (d.hide | 0);
    return true;
  }

  // ---------------- toasts this module starts by itself ----------------

  function later(text, opts = {}) {
    if (!st.popups) return;
    st.queue.push({ text, opts, at: performance.now() });
    if (st.queue.length > 4) st.queue.shift();
  }

  function pumpQueue(dt) {
    if (!st.queue.length) return;
    st.queueT -= dt;
    if (st.queueT > 0) return;
    if (blocked(game)) {
      st.queueT = 0.25;
      return;
    }
    const q = st.queue.shift();
    if (performance.now() - q.at > 120000) return; // too old to matter now
    game.toast(q.text, q.opts);
    st.queueT = 4;
  }

  /** A toast with the elf's picture (waits a moment for the picture, never long). */
  function toastWithFace(text, sc, opts = {}) {
    let done = false;
    const go = (url) => {
      if (done) return;
      done = true;
      game.toast(text, url ? { ...opts, img: url } : opts);
    };
    elfPortrait(game, sc).then(go, () => go(''));
    setTimeout(() => go(''), 450);
  }

  // ---------------- coins and stickers ----------------

  const registerStickers = () => {
    const reg = game.registry.stickers;
    if (!reg) return;
    for (const s of ELF_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  ev.on('game:ready', registerStickers);
  function award(id) {
    if (remote()) return false;
    registerStickers();
    if (game.stickers && !game.stickers.has(id)) return !!game.award(id);
    return false;
  }

  function payCoins(want, at) {
    if (remote()) return 0;
    const pe = prof(true);
    if (!pe) return 0;
    const n = takeCoins(pe, want, dayStamp());
    if (n > 0 && game.coins && typeof game.coins.add === 'function') game.coins.add(n, 'elves', { at });
    return n;
  }

  // ---------------- furniture: the elf, the Elf Door, the sign ----------------

  E.define({
    key: KEY_ELF,
    name: 'Twinkle Elf',
    category: TAB,
    size: [1, 1, 1],
    colors: SWATCHES,
    colliders: 'none',
    placeOn: 'table',
    batch: false,
    actions: ['elf'],
    build: (color, data) => buildElf(schemeIndex(data, color), data || {}),
    update: (entity, dt) => animate(entity, dt),
  });
  E.define({
    key: KEY_DOOR,
    name: 'Elf Door',
    category: TAB,
    size: [1, 1, 1],
    colors: DOOR_COLORS,
    colliders: 'none',
    placeOn: 'wall',
    actions: ['elf_door'],
    build: (color) => buildElfDoor(color),
  });
  E.define({
    key: KEY_SIGN,
    name: 'Elf Sign',
    category: TAB,
    size: [1, 2, 1],
    colors: SIGN_COLORS,
    colliders: [[0.42, 0, 0.42, 0.58, 1.6, 0.58]],
    light: 8,
    lightPos: [0.5, 1.6, 0.5],
    actions: ['elf_sign'],
    build: (color) => buildElfSign(color),
  });

  // ---------------- the elf's little life (every page: looks only) ----------------

  function animate(e, dt) {
    const o = e.object3d;
    const m = o && o.children[0];
    const u = m && m.userData.elf;
    if (!u) return;
    const d = e.data || {};
    const a = e._elf || (e._elf = { t: (e.uid % 97) * 0.37, hop: 0, wave: 0, next: 3 + (e.uid % 7), headY: 0 });
    const showStar = d.role === 'hide' && foundHere(e);
    if (u.found.visible !== showStar) u.found.visible = showStar;
    const cam = game.camera.position;
    if (cam.distanceToSquared(o.position) > 32 * 32) return; // far away: still as a picture
    a.t += dt;
    const t = a.t;
    // the hat star twinkles; the found star spins
    u.star.rotation.z += dt * 1.4;
    u.star.scale.setScalar(0.9 + Math.sin(t * 4.2) * 0.1);
    if (showStar) u.found.rotation.y += dt * 2;
    const pl = game.player;
    const pp = pl ? pl.position : null;
    const near = pp ? Math.hypot(pp.x - o.position.x, pp.z - o.position.z) : 99;
    // now and then a little hop or a wave while you are near
    if (a.hop > 0) a.hop = Math.max(0, a.hop - dt);
    if (a.wave > 0) a.wave = Math.max(0, a.wave - dt);
    if (near < 9 && a.hop <= 0 && a.wave <= 0 && !game.paused) {
      a.next -= dt;
      if (a.next <= 0) {
        a.next = 4 + ((e.uid * 13 + Math.floor(t)) % 5);
        if (u.pose === 'stand' && (Math.floor(t) + e.uid) % 3 === 0) a.hop = 0.55;
        else a.wave = 1.3;
      }
    }
    if (u.pose === 'lie') {
      // a snow angel: the arm sweeps
      u.arm.rotation.z = u.armRest.z + Math.sin(t * (a.wave > 0 ? 7 : 1.5)) * (a.wave > 0 ? 0.45 : 0.12);
      return;
    }
    u.inner.scale.set(1, 1 + Math.sin(t * 2.3) * 0.018, 1);
    if (a.hop > 0) {
      const k = 1 - a.hop / 0.55;
      u.inner.position.y = u.baseY + 0.8 * k * (1 - k);
      u.inner.rotation.y = k * TAU;
    } else {
      u.inner.position.y = u.baseY;
      u.inner.rotation.y = 0;
    }
    // the head turns to look at you when you are close
    let want = Math.sin(t * 0.55) * 0.25;
    if (pp && near < 7) {
      let rel = Math.atan2(pp.x - o.position.x, pp.z - o.position.z) - o.rotation.y;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      want = Math.max(-0.75, Math.min(0.75, rel));
    }
    a.headY += (want - a.headY) * Math.min(1, dt * 5);
    u.head.rotation.y = a.headY;
    u.head.rotation.z = Math.sin(t * 1.3) * 0.07 + (a.hop > 0 ? Math.sin(t * 20) * 0.12 : 0);
    // wave hello (or the resting arm with what it holds)
    if (a.wave > 0) {
      u.arm.rotation.x = 0;
      u.arm.rotation.z = -2.45 + Math.sin(t * 13) * 0.38;
    } else {
      u.arm.rotation.x = u.armRest.x;
      u.arm.rotation.z = u.armRest.z + Math.sin(t * 1.7) * 0.05;
    }
  }

  /** The giggle: hop, wave, sound, sparkles (this page only). Returns where it happened. */
  function giggle(e, big = false) {
    const a = e._elf || (e._elf = { t: 0, hop: 0, wave: 0, next: 4, headY: 0 });
    a.hop = poseOf(e.data) === 'stand' ? 0.55 : 0;
    a.wave = 1.6;
    a.next = 5;
    elfSfx(game, 'giggle', { pitch: 0.92 + (schemeIndex(e.data, e.color) % 5) * 0.05 });
    const p = E.localToWorld(e, 0.5, 0.6 + ((e.data && e.data.dy) || 0), 0.5);
    if (game.particles) {
      game.particles.emit('sparkle', p, { count: big ? 16 : 8 });
      if (big) game.particles.emit('star', p, { count: 10 });
    }
    return p;
  }

  // ---------------- tapping an elf ----------------

  E.registerAction('elf', {
    run(g, e) {
      const d = e.data || {};
      if (d.role === 'hide') return tapHider(e);
      if (d.role === 'house') return tapHouse(e);
      if (d.role === 'greet') return tapGreeter(e);
      giggle(e);
      ui.showBubble(e, { name: nameOf(e), line: pickOne(LINES.decor, Math.random), ttl: 4 });
      return true;
    },
    hint(g, e) {
      const d = (e && e.data) || {};
      if (d.role === 'hide' && !foundHere(e)) return 'You found an elf! Tap!';
      if (d.role === 'house' && !foundHere(e)) return 'Peekaboo! Tap the elf!';
      if (d.role === 'greet') return 'Tap to meet the elves';
      return 'Tap to say hi';
    },
  });

  function meet() {
    if (remote()) return;
    const pe = prof(true);
    if (pe && !pe.met) {
      pe.met = true;
      game.saveProfile();
    }
  }

  function tapHider(e) {
    const d = e.data;
    const name = nameOf(e);
    const pe = prof(true);
    if (!pe || !st.wk) return false;
    const fresh = markFound(pe, st.wk, d.idx);
    meet();
    const p = giggle(e, fresh);
    refreshHiders();
    const total = st.hiders.length;
    const n = countFound(pe, st.wk, st.hiders.map((h) => h.data.idx));
    if (!fresh) {
      ui.showBubble(e, { name, line: pickOne(LINES.again, Math.random), ttl: 4 });
      return true;
    }
    game.saveProfile();
    const all = total >= 1 && n >= total;
    ui.showBubble(e, {
      name,
      line: all ? 'You found all of us! Hooray!' : pickOne(LINES.found, Math.random),
      sub: `${n} of ${total}`,
      buttons: [{ label: 'Yay!', icon: 'heart', color: '#FF5FA2' }],
      ttl: 6,
    });
    toastWithFace(`You found ${name}! (${n} of ${total})`, schemeIndex(d, e.color), { icon: 'star', color: 'mint' });
    payCoins(COIN_VILLAGE, { x: p.x, y: p.y, z: p.z });
    award('elf_first');
    if (all) celebrateAll(total);
    ev.emit('elf:found', { role: 'hide', idx: d.idx, name, found: n, total });
    return true;
  }

  function celebrateAll(total) {
    elfSfx(game, 'tada');
    const pl = game.player;
    if (pl && game.particles) game.particles.emit('confetti', { x: pl.position.x, y: pl.position.y + 2, z: pl.position.z }, { count: 50 });
    setTimeout(() => game.toast(`You found all ${total} Twinkle Elves!`, { big: true, icon: 'star', color: 'sun' }), 900);
    if (total >= ALL_MIN) award('elf_all');
    ev.emit('elf:all', { total });
  }

  function tapHouse(e) {
    const d = e.data;
    const name = nameOf(e);
    const pe = prof(true);
    if (!pe || !st.wk) return false;
    const fresh = markHomeFind(pe, st.wk, d.hide | 0);
    meet();
    const p = giggle(e, fresh);
    const buttons = [{ label: 'Yay!', icon: 'heart', color: '#FF5FA2' }];
    if (!guest()) {
      buttons.push({ label: 'Name', icon: 'pencil', color: '#9C7BFF', onClick: () => rename() });
      buttons.push({ label: 'Bye', icon: 'wave', color: '#6CC6FF', onClick: () => goodbye() });
    }
    if (!fresh) {
      ui.showBubble(e, { name, line: pickOne(LINES.houseAgain, Math.random), buttons, ttl: 7 });
      return true;
    }
    game.saveProfile();
    const scene = SCENES[d.scene] || null;
    const line = scene ? scene.line : pickOne(LINES.house, rng(hashStr(`${st.wk}:${d.hide}`)));
    // the tiny surprise: a treat from the scene, and a few coins (within the daily cap)
    let sub = '';
    const gift = scene && scene.gift && FOOD[scene.gift] ? scene.gift : '';
    if (gift && !remote()) {
      basketAdd(game, gift, 1);
      sub = `+1 ${FOOD[gift].name} in your basket`;
    }
    payCoins(COIN_HOUSE, { x: p.x, y: p.y, z: p.z });
    ui.showBubble(e, { name, line, sub, buttons, ttl: 9 });
    toastWithFace(`You found ${name}!`, schemeIndex(d, e.color), { icon: 'star', color: 'mint' });
    award('elf_first');
    if (pe.homeFinds >= HOME_STICKER_FINDS) award('elf_home');
    ev.emit('elf:found', { role: 'house', name, finds: pe.homeFinds });
    return true;
  }

  function tapGreeter(e) {
    giggle(e, true);
    meet();
    elfSfx(game, 'hello');
    setTimeout(() => { if (game.mode === 'play' && !game.ui.current && !game.ui.dialogOpen) game.ui.open('elves'); }, 450);
    return true;
  }

  E.registerAction('elf_sign', {
    run() {
      meet();
      elfSfx(game, 'hello');
      game.ui.open('elves');
      return true;
    },
    hint: () => 'Tap to meet the elves',
  });

  E.registerAction('elf_door', {
    run(g, door) {
      elfSfx(game, 'knock');
      const h = houseEntity();
      if (h) {
        const where = (h.data && h.data.where) || 'somewhere nearby';
        game.toast(foundHere(h) ? `${nameOf(h)} lives here! See you tomorrow morning.` : `Knock knock! ${nameOf(h)} is hiding ${where}!`, { icon: 'home', color: 'mint' });
        return true;
      }
      if (guest()) {
        game.toast('Knock knock! The elves are out playing. Come back soon!', { icon: 'home', color: 'mint' });
        return true;
      }
      if (st.data.house) st.data.house.away = false;
      if (!arrive({ door, announce: 'now' })) game.toast('An elf will move in tomorrow morning!', { icon: 'home', color: 'mint' });
      return true;
    },
    hint: () => (houseEntity() ? 'Knock knock!' : guest() ? null : 'Tap: invite an elf!'),
  });

  // ---------------- the house elf (host only) ----------------

  /** The house elf entity in this world (any page), or null. */
  function houseEntity() {
    const h = st.data.house;
    if (h && h.uid) {
      const e = E.byUid(h.uid);
      if (isElf(e) && e.data && e.data.role === 'house') return e;
    }
    return st.house && E.byUid(st.house.uid) === st.house ? st.house : null;
  }

  const doors = () => E.all().filter((e) => e.key === KEY_DOOR);
  const beds = () => E.all().filter((e) => e.def && Array.isArray(e.def.actions) && e.def.actions.includes('sleep'));

  const playerCell = () => {
    const p = game.player && game.player.position;
    return p ? [p.x, p.y, p.z] : null;
  };
  const dist2 = (e, p) => (p ? (e.x + 0.5 - p[0]) ** 2 + (e.y - p[1]) ** 2 + (e.z + 0.5 - p[2]) ** 2 : 0);
  const nearest = (list, p) => list.slice().sort((a, b) => dist2(a, p) - dist2(b, p))[0] || null;

  /** Your home: the Elf Door, else the bed you slept in, else the bed nearest you. */
  function homeAnchor(door = null) {
    const p = playerCell();
    const d = door && E.byUid(door.uid) ? door : nearest(doors(), p);
    if (d) return { cell: d.frontCell(), door: d, bed: null };
    const h = st.data.house;
    const bedList = beds();
    let bed = h && h.bed ? E.byUid(h.bed) : null;
    if (!bed || !bedList.includes(bed)) bed = nearest(bedList, p);
    if (!bed) return null;
    return { cell: [bed.x, bed.y, bed.z], door: null, bed };
  }

  /** May an elf live in this world now? */
  function eligible() {
    if (!game.world || guest() || game.world.meta.shared) return false;
    const h = st.data.house;
    // it said bye: it stays with the Twinkle Elves until you tap an Elf Door or put one up
    // (both clear `away` before they call arrive())
    if (h && h.away) return false;
    if (doors().length > 0) return true;
    const pe = prof();
    return !!(pe && pe.met) && !isHoliday() && beds().length > 0;
  }

  /** The offset place() itself gives an elf in this cell (a table's surface). */
  function autoOffset(x, y, z) {
    const t = E.surfaceBelow(x, y, z);
    return t ? t.y + (t.yOffset || 0) + t.def.surface - y : 0;
  }

  /** Face the elf toward a cell (rot 0..3 turns its front to +Z, +X, -Z, -X). */
  const faceToward = (x, z, tx, tz) => {
    const dx = tx - x, dz = tz - z;
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
    return dz >= 0 ? 0 : 2;
  };

  /**
   * Place (or move, keeping its uid) an elf: no history, no sound, no event. data.dy is the
   * height on top of what place() gives by itself, so a reload shows it the same.
   */
  function putElf(spot, rot, sc, data, uid = null) {
    const dy = Math.round((spot.dy - autoOffset(spot.x, spot.y, spot.z)) * 1000) / 1000;
    const full = { ...data, sc, dy };
    if (!(Math.abs(dy) > 0.001)) delete full.dy;
    const opts = { ...QUIET, players: false, restsOn: null };
    if (uid && !E.byUid(uid)) opts.uid = uid;
    return E.place(KEY_ELF, spot.x, spot.y, spot.z, rot, SWATCHES[sc] || SWATCHES[0], full, opts);
  }

  /** The house elf arrives (first time, after a goodbye, or when it went missing). */
  function arrive({ door = null, announce = 'later' } = {}) {
    if (!eligible() || !st.wk) return false;
    const old = st.data.house;
    const sc = old ? old.sc : houseIndex(st.wk);
    st.data.house = {
      uid: old ? old.uid : 0, name: old ? old.name : NAMES[sc], sc, hide: old ? old.hide : 0, stamp: 0,
      spot: old ? old.spot : null, prev: old ? old.prev : [], away: false, bed: old ? old.bed : 0,
    };
    const e = hideHouse({ door });
    if (!e) return false;
    const name = nameOf(e);
    const text = `Knock knock! ${name} the Twinkle Elf moved in! Can you find ${name}?`;
    if (announce === 'now') {
      elfSfx(game, 'knock');
      toastWithFace(text, st.data.house.sc, { icon: 'home', color: 'mint', big: true });
    } else if (announce === 'later') {
      later(text, { icon: 'home', color: 'mint', big: true });
    }
    ev.emit('elf:arrive', { name });
    return true;
  }

  /** Run fn while the elf's own cell reads as free (it is about to move). */
  function withElfAway(e, fn) {
    if (!e || !game.world) return fn();
    const i = game.world.index(e.x, e.y, e.z);
    const occ = E.occupied;
    const had = !!occ && occ.get(i) === e;
    if (had) occ.delete(i);
    try {
      return fn();
    } finally {
      if (had) occ.set(i, e);
    }
  }

  /** A new morning: the house elf hides somewhere new. Returns the entity or null. */
  function hideHouse({ door = null } = {}) {
    const h = st.data.house;
    if (!h || h.away || guest() || !game.world) return null;
    const home = homeAnchor(door);
    if (!home) return null;
    if (home.bed) h.bed = home.bed.uid;
    const cur = houseEntity();
    const view = makeView(game);
    const rand = rng(hashStr(`${st.wk}:${h.hide + 1}:${game.time ? game.time.day : 0}`));
    const curCell = cur ? [cur.x, cur.y, cur.z] : h.spot;
    const me = playerCell();
    let spot = withElfAway(cur, () => pickHideSpot(view, { anchor: home.cell, rand, last: curCell, prev: h.prev, player: me }));
    if (!spot) {
      const [ax, ay, az] = home.cell;
      spot = withElfAway(cur, () => nearestSpot(view, ax, ay, az, { r: 4, down: 4, up: 3, player: me, avoid: curCell ? [curCell] : [], region: homeRegion(view, home.cell) }));
    }
    if (!spot) return cur; // nowhere new fits: it stays where it is
    // a tiny scene sometimes (always a bubble bath in a bathtub)
    let scene = '';
    if (spot.bath) scene = 'bath';
    else if (rand() < SCENE_CHANCE) scene = pickOne(RANDOM_SCENES, rand) || '';
    const data = { role: 'house', name: h.name, hide: h.hide + 1, where: whereLabel(spot.kind, spot.key) };
    if (scene) data.scene = scene;
    else data.pose = spot.kind === 'furn' && /sofa|armchair|chair|stool|bench|bed|beanbag|shelf/.test(spot.key || '') ? 'sit' : rand() < 0.4 ? 'sit' : 'stand';
    const stand = spot.stand || home.cell;
    const rot = faceToward(spot.x, spot.z, stand[0], stand[2]);
    if (cur) {
      const op = E.localToWorld(cur, 0.5, 0.5, 0.5);
      E.remove(cur, QUIET);
      if (game.particles && game.mode === 'play') game.particles.emit('sparkle', op, { count: 8 });
    }
    // only one house elf: an Undo may have brought an old one back
    for (const o of E.all()) if (isElf(o) && o.data && o.data.role === 'house') E.remove(o, QUIET);
    const e = putElf(spot, rot, h.sc, data, h.uid || null);
    if (!e) return null;
    if (h.spot) h.prev = [...h.prev, h.spot].slice(-3);
    h.uid = e.uid;
    h.spot = [spot.x, spot.y, spot.z];
    h.hide += 1;
    h.stamp = dayStamp();
    st.house = e;
    return e;
  }

  function morning({ quiet = false } = {}) {
    if (guest() || !game.world) return;
    const h = st.data.house;
    if (!eligible()) {
      // no home for an elf any more (no door, no bed): it goes home quietly
      const cur = houseEntity();
      if (cur && !doors().length && !beds().length) E.remove(cur, QUIET);
      return;
    }
    if (!h || !houseEntity()) {
      arrive({ announce: quiet ? 'none' : 'later' });
      return;
    }
    const e = hideHouse();
    if (e && !quiet) later(`Good morning! ${nameOf(e)} is hiding somewhere new. Listen for the jingle!`, { icon: 'sun', color: 'mint' });
  }

  async function rename() {
    const e = houseEntity();
    if (!e) return;
    if (guest()) {
      game.net.refuse('npc');
      return;
    }
    const old = nameOf(e);
    const name = await game.ui.textInput({ title: `A new name for ${old}`, value: old, suggestions: NAMES.filter((n) => n !== old).slice(0, 4), ok: 'Save', maxLength: 14 });
    if (!name || !E.byUid(e.uid)) return;
    const n = cleanName(name, old);
    if (st.data.house) st.data.house.name = n;
    E.setData(e, { name: n });
    elfSfx(game, 'giggle');
    game.toast(`Hello, ${n}!`, { icon: 'heart', color: 'mint' });
    ui.render();
  }

  async function goodbye() {
    const e = houseEntity();
    if (!e || guest()) return;
    const name = nameOf(e);
    const ok = await game.ui.confirm({ title: `Say bye to ${name}?`, text: `${name} will go home to the Twinkle Elves. Knock on an Elf Door to invite an elf back.`, yes: 'Bye bye', no: 'Stay!', icon: 'heart' });
    if (!ok || !E.byUid(e.uid)) return;
    if (st.data.house) st.data.house.away = true;
    const p = E.localToWorld(e, 0.5, 0.5, 0.5);
    E.remove(e, QUIET);
    if (game.particles) game.particles.emit('star', p, { count: 12 });
    elfSfx(game, 'hello', { pitch: 0.8 });
  }

  function getDoor() {
    const item = game.registry.items.get('furn:' + KEY_DOOR);
    if (!item) return;
    game.setSlot(null, item.key, DOOR_COLORS[0]);
    game.ui.close();
    game.toast('Tap a wall in your house to put the Elf Door there!', { icon: 'home', color: 'mint' });
  }

  // ---------------- Holiday Village: the hiding elves and the cottage ----------------

  /** What a village elf holds, or how it sits (by its hiding place). */
  const VILLAGE_EXTRAS = ['', 'candy', '', 'gift', '', 'book', '', 'snowman', '', '', 'cookies', ''];
  function villageLook(where, idx) {
    const scene = VILLAGE_EXTRAS[idx % VILLAGE_EXTRAS.length];
    if (scene) return { scene };
    return { pose: /tree|shelf|fence|lamp|roof|bench|step|porch|chimney/.test(where) && idx % 2 === 0 ? 'sit' : 'stand' };
  }

  function towardSpawn(x, z) {
    const sp = game.world && game.world.meta && game.world.meta.spawn;
    return Array.isArray(sp) ? faceToward(x, z, sp[0], sp[2]) : 0;
  }
  const recRot = (rec, x, z) => (Number.isInteger(rec.rot) && rec.rot >= 0 && rec.rot <= 3 ? rec.rot : towardSpawn(x, z));

  if (game.worldFeatures) {
    game.worldFeatures.on('holiday:elf', (g, rec) => {
      const idx = st.nextIdx;
      if (idx >= MAX_HIDERS) return false;
      const view = makeView(game, { village: true });
      const x = rec.x | 0, y = rec.y | 0, z = rec.z | 0;
      // the record's own cell when an elf fits there and can be reached, else the nearest
      // reachable cell, else (a record far from any floor) the nearest cell with support
      const s = spotSupport(view, x, y, z);
      const spot = (s && findStand(view, x, y, z, s.dy) ? { x, y, z, dy: s.dy } : null)
        || nearestSpot(view, x, y, z, { r: 2, down: 4, up: 2 })
        || (s ? { x, y, z, dy: s.dy } : nearestSpot(view, x, y, z, { r: 2, down: 4, up: 2, needReach: false }));
      if (!spot) return false;
      const where = String(rec.where || '').replace(/[^a-z_]/gi, '').slice(0, 12);
      const sc = idx % SCHEMES.length;
      const data = { role: 'hide', idx, name: NAMES[sc], where, ...villageLook(where, idx) };
      if (!putElf(spot, recRot(rec, spot.x, spot.z), sc, data)) return false;
      st.nextIdx++;
      return true;
    });

    game.worldFeatures.on('holiday:elfhome', (g, rec) => {
      const x = rec.x | 0, y = rec.y | 0, z = rec.z | 0;
      const rot = recRot(rec, x, z);
      const sign = E.place(KEY_SIGN, x, y, z, rot, SIGN_COLORS[0], {}, game.worldFeatures.placeOpts());
      // Bramble waits beside the sign (or on the spot itself when the sign did not fit)
      const view = makeView(game, { village: true });
      const avoid = sign ? sign.cells.map((c) => c.slice()) : [];
      const spot = nearestSpot(view, x, y, z, { r: 2, down: 2, up: 1, needReach: false, avoid });
      const greeter = spot ? putElf(spot, rot, 0, { role: 'greet', pose: 'stand' }) : null;
      return !!(sign || greeter);
    });
  }

  // ---------------- bookkeeping, the jingle, the sweep ----------------

  function refreshHiders() {
    const hs = [];
    let house = null;
    for (const e of E.all()) {
      if (!isElf(e) || !e.data) continue;
      // a reload (entities.deserialize) ties an elf on a table to that table, so taking the
      // table away would take the elf too; a hiding elf hops down instead (the sweep)
      if (e.restsOn && ROLES.has(e.data.role)) e.restsOn = null;
      if (e.data.role === 'hide' && Number.isInteger(e.data.idx) && e.data.idx >= 0 && e.data.idx < MAX_HIDERS) hs.push(e);
      else if (e.data.role === 'house') house = e;
    }
    hs.sort((a, b) => a.data.idx - b.data.idx);
    st.hiders = hs;
    st.house = house;
    const pe = prof();
    ui.setCounter(pe ? countFound(pe, st.wk, hs.map((h) => h.data.idx)) : 0, hs.length);
  }

  /** The nearest elf you have not found (for the jingle), with its distance. */
  function nearestUnfound() {
    const pl = game.player;
    if (!pl) return null;
    const p = pl.position;
    let best = null, bd = Infinity;
    const list = st.house ? [...st.hiders, st.house] : st.hiders;
    for (const e of list) {
      if (!e.object3d || foundHere(e)) continue;
      const o = e.object3d.position;
      const d = Math.hypot(o.x - p.x, (o.y - p.y) * 0.8, o.z - p.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { e: best, d: bd } : null;
  }

  function hint(dt) {
    st.jingleT -= dt;
    st.twinkleT -= dt;
    if (st.jingleT > 0 && st.twinkleT > 0) return;
    if (game.paused || game.ui.current || game.mode !== 'play' || document.hidden || game.loading) {
      st.jingleT = Math.max(st.jingleT, 1);
      st.twinkleT = Math.max(st.twinkleT, 1);
      return;
    }
    const n = nearestUnfound();
    if (!n || n.d > JINGLE_NEAR) {
      st.jingleT = Math.max(st.jingleT, 2);
      st.twinkleT = Math.max(st.twinkleT, 1);
      return;
    }
    const k = 1 - n.d / JINGLE_NEAR; // 0 far .. 1 right here
    if (st.jingleT <= 0) {
      elfSfx(game, 'jingle', { volume: 0.12 + 0.88 * k * k });
      st.jingleT = 1.3 + 3.2 * (1 - k);
    }
    if (st.twinkleT <= 0) {
      st.twinkleT = 1.2;
      if (n.d < TWINKLE_NEAR && game.particles) {
        const d = n.e.data || {};
        game.particles.emit('sparkle', E.localToWorld(n.e, 0.5, 0.85 + (d.dy || 0), 0.5), { count: 3, scale: 0.7, spread: 0.15 });
      }
    }
  }

  /** Host: an elf whose shelf, bed or block went away hops down to the nearest good spot. */
  function sweep() {
    if (guest() || !game.world || game.loading) return;
    let view = null;
    for (const e of [...st.hiders, ...(st.house ? [st.house] : []), ...greeters()]) {
      if (E.byUid(e.uid) !== e || !ROLES.has(e.data.role)) continue;
      // plain air only: a village elf hopping down never lands on (and clears) a planted flower or
      // a snow tuft (the village view is only for the brand-new world's own records)
      const v = view || (view = makeView(game));
      const s = withElfAway(e, () => v.support(e.x, e.y, e.z));
      const want = autoOffset(e.x, e.y, e.z) + ((e.data && e.data.dy) || 0);
      if (s && Math.abs(s.dy - want) < 0.02) continue;
      const spot = s ? { x: e.x, y: e.y, z: e.z, dy: s.dy } : withElfAway(e, () => nearestSpot(v, e.x, e.y, e.z, { r: 2, down: 12, up: 1 })
        || nearestSpot(v, e.x, e.y, e.z, { r: 2, down: 12, up: 1, needReach: false }));
      if (!spot) continue;
      const data = { ...e.data };
      if (data.role === 'house' && spot.kind) data.where = whereLabel(spot.kind, spot.key);
      const { uid, rot } = e;
      const sc = schemeIndex(data, e.color);
      E.remove(e, QUIET);
      const n = putElf(spot, rot, sc, data, uid);
      if (n && st.data.house && st.data.house.uid === uid) st.data.house.spot = [n.x, n.y, n.z];
    }
    refreshHiders();
  }
  const greeters = () => E.all().filter((e) => isElf(e) && e.data && e.data.role === 'greet');

  // ---------------- the panel, the system, the events ----------------

  const ui = installElfUI(game, {
    state() {
      const pe = prof();
      const hiders = st.hiders.map((e) => ({
        idx: e.data.idx,
        name: nameOf(e),
        sc: schemeIndex(e.data, e.color),
        where: whereLabel('', '', e.data.where),
        found: isFound(pe, st.wk, e.data.idx),
      }));
      const h = houseEntity();
      const house = h ? { name: nameOf(h), sc: schemeIndex(h.data, h.color), where: h.data.where || '', foundToday: foundHere(h) } : null;
      return { hiders, house, isHoliday: isHoliday(), met: !!(pe && pe.met), isGuest: guest() };
    },
    onPanelOpen() {
      meet();
      refreshHiders();
    },
    getDoor,
    rename,
  });

  game.addSystem({
    name: 'elves',
    onWorldLoad(world) {
      st.wk = worldKey(world && world.meta);
      st.data = normalizeWorldData(null);
      st.nextIdx = 0;
      st.hiders = [];
      st.house = null;
      st.queue.length = 0;
      st.listT = 0.2;
      st.sweepT = 2;
      st.jingleT = 4;
    },
    onWorldUnload() {
      st.hiders = [];
      st.house = null;
      st.queue.length = 0;
      ui.hideBubble();
      ui.setCounter(0, 0);
    },
    serialize() {
      return st.data.house ? normalizeWorldData(st.data) : undefined;
    },
    deserialize(data) {
      st.data = normalizeWorldData(data);
    },
    update(dt) {
      if (!game.world || game.mode !== 'play') return;
      const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
      st.listT -= step;
      if (st.listT <= 0) {
        st.listT = 1;
        refreshHiders();
      }
      ui.update(step);
      hint(step);
      pumpQueue(step);
      if (!guest()) {
        st.sweepT -= step;
        if (st.sweepT <= 0) {
          st.sweepT = 1.5;
          sweep();
        }
      }
    },
  });

  ev.on('world:load', () => {
    refreshHiders();
    ui.warm();
    if (guest() || !game.world || game.world.meta.shared || !eligible()) return;
    const h = st.data.house;
    if (!h) arrive({ announce: 'later' });
    else if (!h.away && (!houseEntity() || h.stamp !== dayStamp())) morning(); // a new day since you were here (or it went missing)
    refreshHiders();
  });

  ev.on('time:morning', () => {
    if (guest() || !game.world || game.loading) return;
    morning();
    refreshHiders();
  });

  ev.on('entity:place', ({ entity } = {}) => {
    if (remote() || !entity || guest()) return;
    if (entity.key === KEY_DOOR) {
      if (st.data.house) st.data.house.away = false;
      if (!houseEntity()) {
        // an Elf Door went on a wall: an elf moves in right away
        setTimeout(() => {
          if (game.world && E.byUid(entity.uid) === entity && !houseEntity()) arrive({ door: entity, announce: 'now' });
        }, 600);
      }
    } else if (entity.def && Array.isArray(entity.def.actions) && entity.def.actions.includes('sleep') && !houseEntity()) {
      const pe = prof();
      if (pe && pe.met && !isHoliday() && !(st.data.house && st.data.house.away)) {
        setTimeout(() => { if (game.world && !houseEntity()) arrive({ announce: 'later' }); }, 1500);
      }
    }
  });

  // the bed you sleep in is your home
  ev.on('entity:use', ({ entity, action } = {}) => {
    if (remote() || guest() || action !== 'sleep' || !entity || !st.data.house) return;
    st.data.house.bed = entity.uid;
  });

  // ---------------- facade and debug ----------------

  game.elves = {
    /** { hiders, found, house, met } for this world and player. */
    state() {
      refreshHiders();
      const pe = prof();
      const h = houseEntity();
      return {
        hiders: st.hiders.length,
        found: pe ? countFound(pe, st.wk, st.hiders.map((e) => e.data.idx)) : 0,
        house: h ? { uid: h.uid, name: nameOf(h), hide: h.data.hide | 0, where: h.data.where || '', found: foundHere(h) } : null,
        met: !!(pe && pe.met),
      };
    },
    open: () => game.ui.open('elves'),
  };

  if (game.debug) {
    game.debug.elves = {
      state: () => ({ ...game.elves.state(), wk: st.wk, data: JSON.parse(JSON.stringify(st.data)), profile: JSON.parse(JSON.stringify(prof() || {})), queue: st.queue.length }),
      list: () => E.all().filter(isElf).map((e) => ({ uid: e.uid, x: e.x, y: e.y, z: e.z, rot: e.rot, yOffset: e.yOffset, data: { ...e.data } })),
      tap(uid) {
        const e = E.byUid(uid);
        return e ? E.use(e, null) : false;
      },
      morning: () => { morning(); refreshHiders(); return game.elves.state().house; },
      arrive: () => arrive({ announce: 'now' }),
      meet: () => meet(),
      popups(on) { st.popups = !!on; return st.popups; },
      spots(n = 5) {
        const home = homeAnchor();
        if (!home) return [];
        const out = [];
        for (let i = 0; i < Math.min(50, n | 0); i++) {
          const s = pickHideSpot(makeView(game), { anchor: home.cell, rand: rng(hashStr(`dbg:${i}`)), player: playerCell() });
          if (s) out.push(s);
        }
        return out;
      },
    };
  }
}
