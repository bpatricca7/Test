// Cruise fun (wave 5, docs/teams/cruise-fun.md): everything to do on the Cruise Ship, and all of
// it in the Bag's Cruise Fun tab so it works in any world.
//   - 17 pieces (cruise_*): water slide gates and a little water slide, lift booths, arcade
//     cabinets, hoops / ring toss / shuffleboard, the mini golf sign and hole flags, the DJ
//     booth, the big movie screen, the captain's wheel, the "What's On" board, pool floats,
//     sun loungers, towel animals and the ship's bell (models.js);
//   - the rides and games: slides (slide.js), the dance party (party.js), the mini games
//     (games.js) in the cruise-play panel, the lift and the board (panels.js);
//   - the placers for the ship's world features (cruise:* records, wave5-plan.md 4.1);
//   - the 'cruise' system (named spots per world, every frame's rides and party), six
//     stickers, at most 20 coins a day (logic.js PAY), scores in profile.cruise;
//   - game.cruise (the facade) and game.debug.cruise.

import * as M from './models.js';
import {
  cruiseData, dailyCoins, recordScore, liftStops, currentStop, cleanName, cleanColor, packPath,
  ACTIVITIES, activityOfSpot, nearest, PAY,
} from './logic.js';
import { createCruiseSfx } from './sfx.js';
import { Slides } from './slide.js';
import { Party, songOf, SONG_COUNT } from './party.js';
import { installPanels } from './panels.js';
import { STICKERS } from './art.js';
import { partsOf } from '../furniture/kit.js';
import { rotXZ } from '../entities.js';
import { drawChannel, CHANNELS, TV_W, TV_H } from '../furniture/tv.js';

const TAB = 'cruise';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_SPOTS = 32;
const MOVIE_FPS = 12;
const MOVIE_SEE = 40; // blocks: the screen plays within this of the camera
const DECK_GAMES = ['hoops', 'ring', 'shuffle'];

/** Is anything covering the world (a panel, a dialog, a fade, a pop...)? (the squish rule) */
function blocked(game) {
  const ui = game.ui;
  if (!ui || typeof document === 'undefined') return true;
  return !!(ui.current || ui.dialogOpen || document.hidden || game.loading || game.mode !== 'play' ||
    (game.container && game.container.classList.contains('sw-photo-mode')) ||
    (ui.fader && ui.fader.classList.contains('sw-on')) ||
    (ui.root && (ui.root.querySelector(':scope > .sw-stkpop') || ui.root.classList.contains('sw-tut-on'))));
}

export function install(game) {
  const E = game.entities;
  if (!E) return;
  const bot = typeof navigator !== 'undefined' && !!navigator.webdriver;
  const sfx = createCruiseSfx(game);
  const cr = () => cruiseData(game.profile);
  const T = () => (game.time ? game.time.t : 0);

  // ---------------- stickers ----------------
  const registerStickers = () => {
    const reg = game.registry && game.registry.stickers;
    if (!reg) return;
    for (const s of STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', registerStickers);
  const award = (id) => {
    registerStickers();
    if (game.stickers && !game.stickers.has(id)) game.award(id);
  };

  // ---------------- coins and scores ----------------
  /** Something fun done: the day's coins for it (once a day each, at most 20 a day). */
  const paid = (what, at = null) => {
    const c = cr();
    if (!c) return 0;
    const n = dailyCoins(c, what);
    if (n > 0 && game.coins && typeof game.coins.add === 'function') game.coins.add(n, 'cruise', at ? { at } : {});
    game.saveProfile();
    return n;
  };

  /** A round finished in the game panel: keep the best, pay the day's coins, stickers. */
  const finishRound = (key, score) => {
    const c = cr();
    if (!c) return { best: score, isBest: false };
    const rec = recordScore(c, key, score);
    if (key === 'star' || key === 'bubble' || key === 'fish') award('cruise_arcade');
    if (DECK_GAMES.includes(key) && DECK_GAMES.every((k) => (c.plays[k] || 0) > 0)) award('cruise_champ');
    if (key === 'golf') award('cruise_golf');
    if (PAY[key]) paid(key);
    game.saveProfile();
    game.events.emit('cruise:score', { game: key, score, best: rec.best, isBest: rec.isBest });
    return rec;
  };

  // ---------------- rides ----------------
  const slides = new Slides(game, sfx, {
    done: (kind) => {
      award('cruise_splash');
      paid(kind);
    },
  });
  const party = new Party(game, sfx, {
    started: () => award('cruise_party'),
  });

  // ---------------- furniture ----------------
  const anims = new WeakMap(); // entity -> little animation state
  const anim = (e) => {
    let a = anims.get(e);
    if (!a) anims.set(e, (a = { spin: 0, swing: 0, label: 0, check: 0, model: null, wet: false, seat: null }));
    return a;
  };

  // a piece whose look sits on something below (towels on beds, floats on water) moves its
  // 'body' part; its pick box follows so a tap still finds it
  const settle = (e, dy) => {
    const body = partsOf(e).body;
    if (!body) return;
    if (Math.abs(body.position.y - dy) < 1e-4) return;
    const moved = Math.abs(body.position.y - dy) > 0.1;
    body.position.y = dy;
    if (moved && e.object3d && e.pickable && e.pickable.box) {
      e.object3d.updateMatrixWorld(true);
      e.pickable.box.setFromObject(e.object3d).expandByScalar(0.02);
    }
  };

  /** How far down the top of whatever stands right under a 1x1 piece is (<= 0), or null. */
  const restTop = (e) => {
    const below = E.at(e.x, e.y - 1, e.z);
    if (!below || below === e) return null;
    const def = below.def;
    let top = null;
    if (isNum(def.surface)) top = def.surface;
    else if (Array.isArray(def.colliders) && def.colliders.length) top = Math.max(...def.colliders.map((b) => b[4]));
    else if (def.colliders === 'full') top = def.size[1];
    if (!isNum(top)) return null;
    const dy = below.y + (below.yOffset || 0) + top - (e.y + (e.yOffset || 0));
    return dy <= 0.02 && dy > -1.2 ? dy : null;
  };

  const liquidHere = (e) => !!(game.physics && game.physics.liquidAt(e.x + 0.5, e.y + 0.5, e.z + 0.5));

  const defs = [
    { key: 'cruise_slide', name: 'Water Slide Start', size: [1, 3, 1], colors: M.GATE_COLORS, colliders: M.GATE_COLLIDERS,
      actions: ['cruise-slide'], build: (c, d) => M.slideGate(c, d) },
    { key: 'cruise_waterslide', name: 'Mini Water Slide', size: [2, 4, 6], colors: M.SLIDE_COLORS, colliders: M.WATERSLIDE_COLLIDERS,
      actions: ['cruise-slide'], build: (c) => M.waterSlide(c) },
    { key: 'cruise_lift', name: 'Lift', size: [1, 2, 1], colors: M.LIFT_COLORS, colliders: M.LIFT_COLLIDERS, light: 8, lightPos: [0.5, 1.8, 0.5],
      actions: ['cruise-lift'], build: (c) => M.lift(c) },
    { key: 'cruise_arcade', name: 'Arcade Game', size: [1, 2, 1], colors: M.ARCADE_COLORS, colliders: M.ARCADE_COLLIDERS, light: 6, lightPos: [0.5, 1.5, 0.9],
      actions: ['cruise-arcade'], build: (c, d) => M.arcade(c, d) },
    { key: 'cruise_hoops', name: 'Hoops', size: [1, 3, 1], colors: M.GAME_COLORS, colliders: M.HOOPS_COLLIDERS,
      actions: ['cruise-game'], build: (c) => M.hoops(c) },
    { key: 'cruise_ringtoss', name: 'Ring Toss', size: [2, 1, 1], colors: M.GAME_COLORS, colliders: M.RINGTOSS_COLLIDERS,
      actions: ['cruise-game'], build: (c) => M.ringToss(c) },
    { key: 'cruise_shuffle', name: 'Shuffleboard', size: [1, 1, 4], colors: M.GAME_COLORS, colliders: M.SHUFFLE_COLLIDERS,
      actions: ['cruise-game'], build: (c) => M.shuffle(c) },
    { key: 'cruise_golf', name: 'Mini Golf', size: [1, 2, 1], colors: ['#3FD8B0', '#FF7EB6', '#4FB8FF', '#FFC94D', '#9C7BFF'], colliders: M.GOLF_COLLIDERS,
      actions: ['cruise-golf'], build: (c) => M.golfSign(c) },
    { key: 'cruise_flag', name: 'Golf Hole Flag', size: [1, 2, 1], colors: ['#FF5FA2', '#FFC94D', '#4FB8FF', '#3FD8B0', '#9C7BFF'], colliders: 'none',
      actions: ['cruise-golf'], build: (c, d) => M.golfFlag(c, d), update: (e) => flagTick(e) },
    { key: 'cruise_dj', name: 'DJ Booth', size: [2, 3, 1], colors: M.DJ_COLORS, colliders: M.DJ_COLLIDERS, light: 7, lightPos: [1, 1.2, 0.9],
      actions: ['cruise-dj'], build: (c) => M.djBooth(c), update: (e, dt) => party.tick(e, dt) },
    { key: 'cruise_movie', name: 'Movie Screen', size: [5, 3, 1], colors: M.SCREEN_COLORS, colliders: M.SCREEN_COLLIDERS, defaultData: { ch: 1 },
      actions: ['cruise-movie'], build: (c, d) => M.movieScreen(c, d), update: (e, dt) => movieTick(e, dt) },
    { key: 'cruise_wheel', name: "Captain's Wheel", size: [1, 2, 1], colors: M.WHEEL_COLORS, colliders: M.WHEEL_COLLIDERS,
      actions: ['cruise-wheel'], build: (c) => M.wheel(c), update: (e, dt) => wheelTick(e, dt) },
    { key: 'cruise_board', name: "What's On Board", size: [2, 2, 1], colors: M.BOARD_COLORS, colliders: M.BOARD_COLLIDERS,
      actions: ['cruise-board'], build: (c) => M.board(c) },
    { key: 'cruise_float', name: 'Pool Float', size: [1, 1, 1], colors: M.FLOAT_COLORS, colliders: 'none',
      actions: ['cruise-float'], build: (c, d) => M.float(c, d), update: (e, dt) => floatTick(e, dt) },
    { key: 'cruise_lounger', name: 'Sun Lounger', size: [1, 1, 2], colors: M.LOUNGER_COLORS, colliders: M.LOUNGER_COLLIDERS,
      actions: ['cruise-lounge'], build: (c) => M.lounger(c) },
    { key: 'cruise_towel', name: 'Towel Animal', size: [1, 1, 1], colors: M.TOWEL_COLORS, colliders: 'none', defaultData: { a: 0 },
      actions: ['cruise-towel'], build: (c, d) => M.towel(c, d), update: (e, dt) => towelTick(e, dt) },
    { key: 'cruise_bell', name: "Ship's Bell", size: [1, 2, 1], colors: M.BELL_COLORS, colliders: M.BELL_COLLIDERS,
      actions: ['cruise-bell'], build: (c) => M.bell(c), update: (e, dt) => bellTick(e, dt) },
  ];
  for (const d of defs) E.define({ category: TAB, placeOn: 'floor', ...d });

  // ---------------- per-frame looks ----------------

  function movieTick(e, dt) {
    const model = e.object3d && e.object3d.children[0];
    const scr = model && model.userData.screen;
    if (!scr) return;
    const a = anim(e);
    if (a.label > 0) a.label -= dt;
    scr.t += dt;
    scr.acc += dt;
    if (scr.acc < 1 / MOVIE_FPS) return;
    if (game.camera && game.camera.position.distanceToSquared(e.object3d.position) > MOVIE_SEE * MOVIE_SEE) return;
    scr.acc = 0;
    const ch = Math.max(1, Math.min(CHANNELS.length - 1, e.data.ch | 0));
    const c = scr.ctx;
    c.setTransform(scr.canvas.width / TV_W, 0, 0, scr.canvas.height / TV_H, 0, 0);
    drawChannel(c, ch, scr.t, a.label > 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    scr.tex.needsUpdate = true;
  }

  function wheelTick(e, dt) {
    const a = anim(e);
    const w = partsOf(e).wheel;
    if (!w) return;
    if (a.spin > 0) {
      a.spin = Math.max(0, a.spin - dt);
      w.rotation.z += dt * 5 * Math.min(1, a.spin);
    } else w.rotation.z += (Math.sin(T() * 0.7 + e.uid) * 0.06 - w.rotation.z) * Math.min(1, dt * 2);
  }

  function bellTick(e, dt) {
    const a = anim(e);
    const b = partsOf(e).bell;
    if (!b) return;
    if (a.swing > 0) a.swing = Math.max(0, a.swing - dt * 0.6);
    b.rotation.x = Math.sin(T() * 9) * 0.45 * a.swing;
  }

  function flagTick(e) {
    const f = partsOf(e).flag;
    if (f) f.rotation.y = Math.sin(T() * 2.2 + e.uid) * 0.25;
  }

  function floatTick(e, dt) {
    const a = anim(e);
    const model = e.object3d && e.object3d.children[0];
    if (a.model !== model) {
      a.model = model;
      a.check = 0;
    }
    a.check -= dt;
    if (a.check <= 0) {
      a.check = 1.5;
      a.wet = liquidHere(e);
    }
    const body = partsOf(e).body;
    if (!body) return;
    const t = T() + e.uid * 0.7;
    settle(e, a.wet ? 0.68 + Math.sin(t * 1.6) * 0.04 : 0);
    body.rotation.z = a.wet ? Math.sin(t * 1.1) * 0.05 : 0;
    body.rotation.x = a.wet ? Math.cos(t * 0.9) * 0.04 : 0;
    if (a.wet) body.rotation.y += dt * 0.08;
    // she bobs along when she sits on it
    const p = game.player;
    if (p && p.state === 'sit' && p.seatEntity === e) {
      a.seat = E.localToWorld(e, 0.5, body.position.y + 0.26, 0.5, a.seat || undefined);
      p.position.copy(a.seat);
    }
  }

  function towelTick(e, dt) {
    const a = anim(e);
    const model = e.object3d && e.object3d.children[0];
    if (a.model !== model) {
      a.model = model;
      a.check = 0;
    }
    a.check -= dt;
    if (a.check > 0) return;
    a.check = 2;
    const dy = restTop(e);
    settle(e, dy === null ? 0 : dy);
  }

  // ---------------- actions ----------------

  const sparkle = (e, lx, ly, lz, kind = 'sparkle', count = 10) => {
    if (game.particles) game.particles.emit(kind, E.localToWorld(e, lx, ly, lz), { count, spread: 0.6 });
  };
  const openPanel = (name, args) => (game.ui && game.ui.hasPanel(name) ? game.ui.open(name, args) : false);

  E.registerAction('cruise-slide', {
    run: (g, e) => slides.start(e),
    hint: (g, e) => (slides.ride ? null : e.key === 'cruise_waterslide' ? 'Tap to slide!' : 'Tap to ride the slide!'),
  });

  E.registerAction('cruise-lift', {
    run: (g, e) => openLift(e),
    hint: () => 'Tap to ride the lift',
  });

  E.registerAction('cruise-arcade', {
    run: (g, e) => {
      sfx.blip(3);
      sparkle(e, 0.5, 1.6, 0.9, 'star', 6);
      return openPanel('cruise-play', { game: M.gameOf(e.color, e.data) });
    },
    hint: (g, e) => `Tap to play ${M.ARCADE_NAMES[M.gameOf(e.color, e.data)]}`,
  });

  const deckKey = (e) => (e.key === 'cruise_ringtoss' ? 'ring' : e.key === 'cruise_shuffle' ? 'shuffle' : 'hoops');
  E.registerAction('cruise-game', {
    run: (g, e) => {
      sparkle(e, 0.5, 1, 0.5, 'star', 6);
      return openPanel('cruise-play', { game: deckKey(e) });
    },
    hint: (g, e) => ({ hoops: 'Tap to shoot hoops', ring: 'Tap to toss rings', shuffle: 'Tap to play shuffleboard' }[deckKey(e)]),
  });

  E.registerAction('cruise-golf', {
    run: (g, e) => {
      const d = e.data || {};
      const holes = isNum(d.h) ? Math.max(1, Math.min(9, d.h | 0)) : 6;
      const pars = Array.isArray(d.par) ? d.par.slice(0, 9) : null;
      const start = e.key === 'cruise_flag' && isNum(d.i) ? Math.max(0, Math.min(holes - 1, d.i | 0)) : 0;
      sparkle(e, 0.5, 1.6, 0.5, 'sparkle', 8);
      return openPanel('cruise-play', { game: 'golf', opts: { holes, pars, start } });
    },
    hint: (g, e) => (e.key === 'cruise_flag' ? `Tap to putt on hole ${((e.data && e.data.i) | 0) + 1}` : 'Tap to play mini golf'),
  });

  E.registerAction('cruise-dj', {
    run: (g, e) => {
      party.tap(e);
      return true;
    },
    hint: (g, e) => {
      const s = songOf(e);
      return s === 0 ? 'Tap to start the party!' : s >= SONG_COUNT ? 'Tap to rest the DJ' : 'Tap for the next song';
    },
  });

  E.registerAction('cruise-movie', {
    run: (g, e) => {
      const ch = ((e.data.ch | 0) + 1) % CHANNELS.length;
      E.setData(e, { ch });
      anim(e).label = 2.5;
      game.audio.play(ch > 0 ? 'chime' : 'click', { volume: 0.5 });
      sparkle(e, 2.5, 2.4, 0.4, ch > 0 ? 'star' : 'sparkle', 10);
      if (ch > 0) game.toast(`Now showing: ${CHANNELS[ch]}`, { icon: 'star', key: 'cruise-movie' });
      game.events.emit('cruise:movie', { uid: e.uid, ch });
      return true;
    },
    hint: (g, e) => ((e.data.ch | 0) === 0 ? 'Tap to start the show' : (e.data.ch | 0) >= CHANNELS.length - 1 ? 'Tap to stop the show' : 'Tap for the next cartoon'),
  });

  E.registerAction('cruise-wheel', {
    run: (g, e) => captain(e),
    hint: () => 'Tap to steer the ship',
  });

  E.registerAction('cruise-board', {
    run: (g, e) => {
      game.audio.play('page');
      sparkle(e, 1, 2, 0.6, 'sparkle', 8);
      return openPanel('cruise-board', { uid: e.uid });
    },
    hint: () => "Tap to see what's on",
  });

  E.registerAction('cruise-float', {
    run: (g, e) => {
      const p = game.player;
      if (!p || typeof p.sitOn !== 'function') return false;
      const body = partsOf(e).body;
      const seat = E.localToWorld(e, 0.5, (body ? body.position.y : 0) + 0.26, 0.5);
      p.sitOn(e, seat, e.rot * (Math.PI / 2));
      sfx.splash(0.4);
      sparkle(e, 0.5, 0.8, 0.5, 'bubble', 8);
      return true;
    },
    hint: () => 'Tap to float',
  });

  E.registerAction('cruise-lounge', {
    run: (g, e) => {
      const p = game.player;
      if (!p || typeof p.sleepIn !== 'function') return false;
      const lie = E.localToWorld(e, M.LOUNGER_LIE[0], M.LOUNGER_LIE[1], M.LOUNGER_LIE[2]);
      p.sleepIn(e, lie, e.rot * (Math.PI / 2), { quiet: true });
      game.audio.play('pop', { volume: 0.5 });
      sparkle(e, 0.5, 0.9, 1, 'sparkle', 6);
      game.toast('Ahh, sunny and cozy!', { icon: 'sun', key: 'cruise-lounge' });
      return true;
    },
    hint: () => 'Tap to relax in the sun',
  });

  E.registerAction('cruise-towel', {
    run: (g, e) => {
      const a = ((e.data.a | 0) + 1) % M.TOWEL_ANIMALS.length;
      E.setData(e, { a });
      sfx.pop();
      sparkle(e, 0.5, 0.6, 0.5, 'heart', 5);
      game.toast(`${M.TOWEL_NAMES[M.TOWEL_ANIMALS[a]]}!`, { icon: 'heart', key: 'cruise-towel' });
      return true;
    },
    hint: () => 'Tap to fold a new animal',
  });

  E.registerAction('cruise-bell', {
    run: (g, e) => {
      anim(e).swing = 1;
      sfx.bell();
      sparkle(e, 0.5, 1.5, 0.7, 'note', 4);
      game.events.emit('cruise:bell', { uid: e.uid });
      return true;
    },
    hint: () => 'Tap to ring the bell',
  });

  // ---------------- the captain's wheel ----------------

  let camLook = null; // { yaw, t }: the camera turning to look out over the bow
  function captain(e) {
    const p = game.player;
    if (!p) return false;
    anim(e).spin = 2.2;
    sfx.horn();
    const prof = game.profile || {};
    const name = cleanName(prof.playerName || (prof.look && prof.look.name), 16) || 'Sparkle';
    game.toast(`Captain ${name}!`, { icon: 'crown', big: true, color: 'pink', key: 'cruise-captain' });
    sparkle(e, 0.5, 1.4, 0.8, 'star', 12);
    // she takes the wheel: in front of it, looking over it, out toward the bow
    const [fx, fz] = rotXZ(0, 1, e.rot);
    const bowYaw = Math.atan2(-fx, -fz);
    if (p.state === 'walk' || p.state === 'emote') {
      const spot = p.findStandSpot(e.x + fx + 0.5, e.y, e.z + fz + 0.5, e);
      if (spot && Math.hypot(spot[0] - p.position.x, spot[2] - p.position.z) < 4) {
        p.position.set(spot[0], spot[1], spot[2]);
        p.velocity.set(0, 0, 0);
      }
      p.yaw = bowYaw;
    }
    camLook = { yaw: bowYaw, t: 2.4 };
    award('cruise_captain');
    game.events.emit('cruise:captain', { uid: e.uid });
    return true;
  }

  const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  function cameraLook(dt) {
    const rig = game.cameraRig;
    if (!camLook || !rig) return;
    camLook.t -= dt;
    const input = game.input;
    const touched = input && input.look && (Math.abs(input.look.dx) + Math.abs(input.look.dy) > 0.5 || input.turn);
    if (camLook.t <= 0 || touched || rig.mode === 'first') {
      camLook = null;
      return;
    }
    rig.yaw += angleTo(rig.yaw, camLook.yaw) * Math.min(1, dt * 2.2);
    rig.pitch += (0.12 - rig.pitch) * Math.min(1, dt * 1.6);
  }

  // ---------------- lifts ----------------

  const liftPieces = (x, z) => {
    const out = [];
    for (const e of E.map.values()) {
      if (e.key === 'cruise_lift' && e.x === x && e.z === z) out.push({ uid: e.uid, x: e.x, y: e.y, z: e.z, name: e.data && e.data.n });
    }
    return out;
  };

  function openLift(e) {
    const stops = liftStops(liftPieces(e.x, e.z), e.x, e.z);
    sfx.ding();
    if (stops.length < 2) {
      game.toast('Build another lift right above or below to ride between decks!', { icon: 'up', key: 'cruise-lift' });
      return true;
    }
    const here = currentStop(stops, game.player ? game.player.position.y : e.y) || stops.find((s) => s.uid === e.uid);
    return openPanel('cruise-lift', { stops, here, uid: e.uid });
  }

  /** Ride to a stop: a ding, a short fade, and she stands in that deck's lift. */
  function goLift(stop) {
    if (!stop || !E.byUid(stop.uid) || !game.ui) return;
    game.ui.transition({ text: stop.name, hold: 450 }, () => {
      const t = E.byUid(stop.uid);
      const p = game.player;
      if (!t || !p) return;
      const v = E.localToWorld(t, 0.5, 0.02, 0.5);
      const ph = game.physics;
      let pos = [v.x, v.y, v.z];
      if (ph && ph.bodyBlocked(v.x, v.y + 0.01, v.z, p.halfW, p.height)) {
        const spot = p.findStandSpot(v.x, v.y, v.z, t);
        if (spot) pos = spot;
      }
      p.teleport(pos[0], pos[1], pos[2]);
      p.yaw = t.rot * (Math.PI / 2);
      if (game.cameraRig) {
        game.cameraRig.yaw = p.yaw;
        game.cameraRig.snap();
      }
      sfx.ding();
      if (game.particles) game.particles.emit('sparkle', [pos[0], pos[1] + 1, pos[2]], { count: 14, spread: 0.8 });
      game.events.emit('cruise:lift', { uid: t.uid, deck: stop.name });
    }).then(() => game.toast(`${stop.name}!`, { icon: 'up', key: 'cruise-lift' }));
  }

  // ---------------- the board and spots ----------------

  let spots = []; // [{ name, deck, x, y, z }] this world's named places (cruise:spot records)

  /** Every activity she can go to now: a named spot first, else the nearest piece for it. */
  function boardList() {
    const p = game.player;
    const px = p ? p.position.x : 0, py = p ? p.position.y : 0, pz = p ? p.position.z : 0;
    const bySpot = new Map(ACTIVITIES.map((a) => [a.key, []]));
    for (const s of spots) {
      const k = activityOfSpot(s.name);
      if (k && bySpot.has(k)) bySpot.get(k).push({ x: s.x + 0.5, y: s.y, z: s.z + 0.5 });
    }
    const keyOf = new Map();
    for (const a of ACTIVITIES) for (const k of a.pieces) keyOf.set(k, a.key);
    const pieces = new Map();
    let n = 0;
    for (const e of E.map.values()) {
      const k = keyOf.get(e.key);
      if (!k) continue;
      if (++n > 4000) break;
      if (!pieces.has(k)) pieces.set(k, []);
      pieces.get(k).push({ x: e.x + 0.5, y: e.y, z: e.z + 0.5, e });
    }
    const out = [];
    for (const a of ACTIVITIES) {
      const at = bySpot.get(a.key).length ? nearest(bySpot.get(a.key), px, py, pz) : nearest(pieces.get(a.key) || [], px, py, pz);
      if (!at) continue;
      const here = Math.hypot(at.x - px, at.z - pz) < 5 && Math.abs(at.y - py) < 2.5;
      out.push({ key: a.key, name: a.name, icon: a.icon, color: a.color, here, go: () => goTo(at, a.name) });
    }
    return out;
  }

  function goTo(at, label) {
    if (!game.ui) return;
    game.audio.play('magic', { volume: 0.5 });
    game.ui.transition({ text: label, stars: true, hold: 450 }, () => {
      const p = game.player;
      if (!p) return;
      const e = at.e && E.byUid(at.e.uid) ? at.e : null;
      let spot = null;
      if (e) {
        const [fx, fz] = rotXZ(0, 1, e.rot);
        const f = e.frontCell();
        spot = p.findStandSpot(f[0] + 0.5 + fx, f[1], f[2] + 0.5 + fz, e) || p.findStandSpot(f[0] + 0.5, f[1], f[2] + 0.5, e);
      } else spot = p.findStandSpot(at.x, at.y, at.z, null);
      if (!spot) spot = [at.x, at.y + 0.01, at.z];
      p.teleport(spot[0], spot[1], spot[2]);
      if (e) {
        const c = E.localToWorld(e, e.def.size[0] / 2, 0, e.def.size[2] / 2);
        p.yaw = Math.atan2(c.x - spot[0], c.z - spot[2]);
        if (game.cameraRig) {
          game.cameraRig.yaw = p.yaw;
          game.cameraRig.snap();
        }
      }
      if (game.particles) game.particles.emit('sparkle', [spot[0], spot[1] + 1, spot[2]], { count: 16, spread: 0.8 });
      game.events.emit('cruise:goto', { name: label });
    });
  }

  // ---------------- world features (wave5-plan.md 4.1; host only, see features.js) ----------------

  /**
   * Place a piece for a record (players are ignored by placeOpts). A record whose cells are not
   * free (a block that is not air or replaceable, another piece, outside the world) is skipped:
   * never forced into a lantern, a ladder or a wall.
   */
  const put = (g, key, x, y, z, rot, color, data) => {
    const def = E.defs && E.defs.get(key);
    if (!def || ![x, y, z].every(isNum)) return null;
    const r = (((rot | 0) % 4) + 4) % 4;
    return E.place(key, x | 0, y | 0, z | 0, r, color, data, g.worldFeatures.placeOpts()) || null;
  };

  let arcadeN = 0;
  if (game.worldFeatures) {
    const WF = game.worldFeatures;
    WF.on('cruise:slide', (g, f) => {
      const color = cleanColor(f.color, M.GATE_COLORS[0]);
      const data = { n: cleanName(f.name, 20) || 'Water Slide' };
      const { code } = packPath(f.path, f.x | 0, f.y | 0, f.z | 0);
      if (code) data.p = code;
      return !!put(g, 'cruise_slide', f.x, f.y, f.z, f.rot, color, data);
    });
    WF.on('cruise:lift', (g, f) => {
      const list = Array.isArray(f.stops) ? f.stops.slice(0, 12) : [];
      let n = 0;
      const props = g.registry.blocks.props;
      const solidAt = (x, y, z) => {
        const w = g.world;
        if (!w || !w.inBounds(x, y, z)) return false;
        const id = w.get(x, y, z);
        return id !== 0 && !props.replaceable[id];
      };
      // she arrives in the lift facing its front (goLift: "facing out"), so each stop's booth
      // faces a cell she can step out into: the record's turn when its front is open, else the
      // first turn that is (one record turns every stop, and a deck's wall or rail may stand
      // right in front of one of them)
      const openFront = (x, y, z, r) => {
        const [dx, dz] = rotXZ(0, 1, r);
        const fx = x + dx, fz = z + dz;
        return !solidAt(fx, y, fz) && !solidAt(fx, y + 1, fz) && solidAt(fx, y - 1, fz) && !E.at(fx, y, fz);
      };
      const r0 = (((f.rot | 0) % 4) + 4) % 4;
      for (const s of list) {
        if (!isObj(s) || !isNum(s.y)) continue;
        // a stop's y may name the deck's floor block (cruise-world does) or the air cell above
        // it (wave5-plan.md 4): the booth stands on the floor either way
        const y = solidAt(f.x | 0, s.y | 0, f.z | 0) ? (s.y | 0) + 1 : s.y | 0;
        const r = [r0, (r0 + 1) % 4, (r0 + 3) % 4, (r0 + 2) % 4].find((k) => openFront(f.x | 0, y, f.z | 0, k)) ?? r0;
        if (put(g, 'cruise_lift', f.x, y, f.z, r, M.LIFT_COLORS[0], { n: cleanName(s.name, 20) })) n++;
      }
      return n > 0;
    });
    WF.on('cruise:arcade', (g, f) => {
      const i = arcadeN++ % M.ARCADE_GAMES.length;
      return !!put(g, 'cruise_arcade', f.x, f.y, f.z, f.rot, M.ARCADE_COLORS[i], { g: M.ARCADE_GAMES[i] });
    });
    WF.on('cruise:game', (g, f) => {
      const key = { hoops: 'cruise_hoops', ringtoss: 'cruise_ringtoss', ring: 'cruise_ringtoss', shuffle: 'cruise_shuffle', shuffleboard: 'cruise_shuffle' }[f.game];
      if (!key) return false;
      return !!put(g, key, f.x, f.y, f.z, f.rot, null, {});
    });
    WF.on('cruise:golf', (g, f) => {
      const holes = Array.isArray(f.holes) ? f.holes.filter(isObj).slice(0, 9) : [];
      const n = holes.length || 6;
      const par = holes.map((h) => (isNum(h.par) ? Math.max(2, Math.min(5, Math.round(h.par))) : 3));
      const sign = put(g, 'cruise_golf', f.x, f.y, f.z, f.rot, null, holes.length ? { h: n, par } : { h: n });
      holes.forEach((h, i) => {
        const c = Array.isArray(h.cup) && h.cup.length >= 3 && h.cup.slice(0, 3).every(isNum) ? h.cup : null;
        // the flag knows the course's pars too, so a round started from a flag shows the same pars
        if (c) put(g, 'cruise_flag', c[0], c[1], c[2], f.rot, null, { i, h: n, par });
      });
      return !!sign;
    });
    WF.on('cruise:dance', (g, f) => {
      const data = {};
      if ([f.x0, f.z0, f.x1, f.z1].every(isNum)) Object.assign(data, { fx0: f.x0 | 0, fz0: f.z0 | 0, fx1: f.x1 | 0, fz1: f.z1 | 0, fy: f.y | 0 });
      return !!put(g, 'cruise_dj', f.x, f.y, f.z, f.rot, null, data);
    });
    WF.on('cruise:movie', (g, f) => {
      const data = { ch: 1 };
      if (isNum(f.w)) data.w = Math.max(5, Math.min(24, Math.round(f.w)));
      if (isNum(f.h)) data.h = Math.max(3, Math.min(14, Math.round(f.h)));
      return !!put(g, 'cruise_movie', f.x, f.y, f.z, f.rot, null, data);
    });
    WF.on('cruise:wheel', (g, f) => !!put(g, 'cruise_wheel', f.x, f.y, f.z, f.rot, null, {}));
    WF.on('cruise:board', (g, f) => !!put(g, 'cruise_board', f.x, f.y, f.z, f.rot, null, {}));
    WF.on('cruise:float', (g, f) => {
      const i = ((f.x | 0) * 7 + (f.z | 0) * 13) & 0xffff;
      return !!put(g, 'cruise_float', f.x, f.y, f.z, f.rot, M.FLOAT_COLORS[i % M.FLOAT_COLORS.length], {});
    });
    WF.on('cruise:spot', (g, f) => {
      if (![f.x, f.y, f.z].every(isNum) || spots.length >= MAX_SPOTS) return false;
      const name = cleanName(f.name, 24);
      if (!name) return false;
      spots.push({ name, deck: cleanName(f.deck, 24), x: f.x | 0, y: f.y | 0, z: f.z | 0 });
      return true;
    });
  }

  // ---------------- facade, debug, panels ----------------

  let welcomeOn = !bot, welcomeT = -1, welcomed = false;

  game.cruise = {
    slides, party, sfx,
    spots: () => spots.map((s) => ({ ...s })),
    play: (key, opts) => openPanel('cruise-play', { game: key, opts }),
    board: boardList,
    award,
    data: () => cr(),
  };
  if (game.debug) {
    game.debug.cruise = {
      plan: (uid) => {
        const e = E.byUid(uid);
        const pl = e ? slides.plan(e) : null;
        return pl ? { end: pl.end, wet: pl.wet, points: pl.points ? pl.points.length : 0, splashAt: pl.splashAt } : null;
      },
      ride: () => (slides.ride ? { phase: slides.ride.phase, s: slides.ride.s, v: slides.ride.v, len: slides.ride.line.len } : null),
      slide: (uid) => {
        const e = E.byUid(uid);
        return e ? slides.start(e) : false;
      },
      freeze: (on = true) => {
        slides.freeze = !!on;
      },
      spots: () => spots.map((s) => ({ ...s })),
      party: () => ({ playing: party.playing, lights: party.fx.size, booths: party.djs.size }),
      board: () => boardList().map((a) => ({ key: a.key, name: a.name, here: a.here })),
      data: () => JSON.parse(JSON.stringify(cr() || {})),
      lift: (uid) => {
        const e = E.byUid(uid);
        return e ? liftStops(liftPieces(e.x, e.z), e.x, e.z) : [];
      },
      goLift: (uid) => {
        const e = E.byUid(uid);
        if (e) goLift({ uid: e.uid, name: cleanName(e.data && e.data.n, 20) || 'Deck', y: e.y });
        return !!e;
      },
      welcome: (on = true) => {
        welcomeOn = !!on;
        welcomed = false;
        welcomeT = 0;
      },
    };
  }

  installPanels(game, {
    sfx,
    finish: finishRound,
    best: (key) => {
      const c = cr();
      return c && isNum(c.best[key]) ? c.best[key] : 0;
    },
    goLift,
    board: boardList,
  });

  // ---------------- the system ----------------

  game.addSystem({
    name: 'cruise',
    update(dt) {
      if (!game.world) return;
      const playing = game.mode === 'play';
      slides.update(playing && !game.paused ? dt : 0);
      party.update(dt, playing);
      if (playing && !game.paused) cameraLook(dt);
      // a hello on the ship, once a world, when nothing covers the world
      if (welcomeOn && !welcomed && welcomeT >= 0 && playing && !game.paused) {
        if (!blocked(game)) welcomeT += dt;
        if (welcomeT > 6) {
          welcomed = true;
          let hasBoard = false;
          for (const e of E.map.values()) if (e.key === 'cruise_board') { hasBoard = true; break; }
          game.toast(hasBoard ? "Welcome aboard! The What's On board shows all the fun." : 'Welcome aboard the ship!', { icon: 'star', big: true, key: 'cruise-welcome' });
          sfx.horn();
        }
      }
    },
    onWorldLoad(world) {
      spots = [];
      arcadeN = 0;
      slides.cancelRide();
      party.clear();
      camLook = null;
      welcomed = false;
      welcomeT = world && world.meta && world.meta.biome === 'cruise' ? 0 : -1;
    },
    onWorldUnload() {
      slides.cancelRide();
      party.clear();
      sfx.rushStop();
      camLook = null;
      spots = [];
    },
    serialize: () => (spots.length ? { v: 1, spots: spots.map((s) => ({ ...s })) } : undefined),
    deserialize(data) {
      if (!isObj(data) || !Array.isArray(data.spots)) return;
      spots = [];
      for (const s of data.spots) {
        if (spots.length >= MAX_SPOTS) break;
        if (!isObj(s) || ![s.x, s.y, s.z].every(isNum)) continue;
        const name = cleanName(s.name, 24);
        if (name) spots.push({ name, deck: cleanName(s.deck, 24), x: s.x | 0, y: s.y | 0, z: s.z | 0 });
      }
    },
  });
}
