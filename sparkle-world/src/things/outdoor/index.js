// Outdoor fun (wave 2): zip lines, treehouse parts, camping and the hair salon chair.
//
//   zipline_tower   tall wooden tower; two within 48 blocks link with a sagging cable, Hand-tap
//                   either one to climb up, grab the handle and zip across ('zipline:ride')
//   tree_platform   a deck braced against a tree trunk, or on stilts, with a rope ladder
//   rope_bridge     stretches across a gap between platforms / block tops, sways, walkable
//   tent            pastel dome tent: sleep inside (Happy Camper sticker)
//   campfire        flickering flames, warm light, crackles; roast a marshmallow ('camp:marshmallow')
//   camp_chair      folding chair (sit)          hammock        lie down and swing gently
//   string_lights   colorful bulbs that glow at night (tap: on / off)
//   picnic_table    benches (sit, facing the table) and a gingham top food can stand on
//   cooler          the lid pops open and a juice box pops out
//   camper_bunk     a narrow bunk bed for campers (sleep on top or bottom)
//   salon_chair     sit, spin, and the Dress-Up Studio opens on the Hair tab
//
// Everything registers through game.entities.define / registerAction, game.addSystem('outdoor')
// and events; install(game) is called from src/things/furniture.js (after the furniture
// catalog, so the furniture 'sleep', 'sit' and 'lamp' actions exist).

import * as M from './models-camp.js';
import { zipTower, zipTowerColliders, treePlatform, treePlatformColliders, ropeBridge, ropeBridgeColliders, BRIDGE_COLORS, SWAY } from './models-tree.js';
import { salonChair, SALON_COLORS, SALON_COLLIDERS, SALON_SEAT } from './models-salon.js';
import { createOutdoorSfx } from './sfx.js';
import { ZipLines } from './zipline.js';
import { Ladders } from './ladders.js';
import { Bridges } from './bridge.js';
import { installCamp } from './camp.js';
import { installExtras, CAMP_TAB } from './extras.js';
import { setNightGlow } from './glow.js';
import * as THREE from 'three';

const TOWER_COLORS = ['#FF9CCB', '#A6D8FF', '#9BE8CF', '#C8B4FF', '#FFE38F', '#FFBFA0'];
const PLATFORM_COLORS = ['#FF9CCB', '#C8B4FF', '#9BE8CF', '#A6D8FF', '#FFE38F', '#FFBFA0'];
const STONE_COLORS = ['#E6E0F5', '#FFE3F0', '#DDF3FF', '#E2FBF0', '#FFF6D8'];
const LIGHT_POSTS = ['#FFFFFF', '#FFD1E6', '#E6DDFF', '#DDF3FF', '#E2FBF0', '#FFF6D8'];
const BUNK_COLORS = ['#FF9CCB', '#C8B4FF', '#A6D8FF', '#9BE8CF', '#FFE38F', '#FFBFA0'];

export function outdoorDefs() {
  const cat = CAMP_TAB;
  return [
    { key: 'tent', name: 'Camping Tent', category: cat, size: [2, 2, 2], colors: M.TENT_COLORS, build: (c) => M.tent(c),
      colliders: [[0.12, 0, 0.12, 1.88, 1.25, 1.88]], actions: ['camp_sleep'], sleepPos: M.TENT_SLEEP },
    { key: 'campfire', name: 'Camp Fire', category: cat, size: [1, 1, 1], colors: STONE_COLORS, build: (c) => M.campfire(c),
      colliders: [[0.12, 0, 0.12, 0.88, 0.32, 0.88]], actions: ['roast'], light: 14, lightPos: [0.5, 0.45, 0.5], defaultData: { on: true } },
    { key: 'camp_chair', name: 'Camp Chair', category: cat, size: [1, 1, 1], colors: M.CAMP_FABRIC, build: (c) => M.campChair(c),
      colliders: [[0.12, 0, 0.15, 0.88, 0.42, 0.85]], actions: ['sit'], seat: [0.5, 0.43, 0.5] },
    { key: 'hammock', name: 'Hammock', category: cat, size: [3, 2, 1], colors: M.CAMP_FABRIC, build: (c) => M.hammock(c),
      colliders: [[0.02, 0, 0.25, 0.3, 1.45, 0.75], [2.7, 0, 0.25, 2.98, 1.45, 0.75], [0.45, 0, 0.2, 2.55, 0.5, 0.8]], actions: ['hammock'] },
    { key: 'string_lights', name: 'String Lights', category: cat, size: [3, 2, 1], colors: LIGHT_POSTS, build: (c, d) => M.stringLights(c, d),
      colliders: [[0.02, 0, 0.38, 0.24, 1.95, 0.62], [2.76, 0, 0.38, 2.98, 1.95, 0.62]], light: 11, lightPos: [1.5, 1.45, 0.5], actions: ['lamp'], defaultData: { on: true } },
    { key: 'picnic_table', name: 'Picnic Table', category: cat, size: [2, 1, 2], colors: M.CLOTH_COLORS, build: (c) => M.picnicTable(c),
      colliders: [[0.1, 0.72, 0.4, 1.9, 0.81, 1.6], [0.2, 0, 0.5, 1.8, 0.72, 1.5], [0.1, 0, 0.05, 1.9, 0.47, 0.35], [0.1, 0, 1.65, 1.9, 0.47, 1.95]],
      surface: 0.81, actions: ['picnic'] },
    { key: 'cooler', name: 'Cooler', category: cat, size: [1, 1, 1], colors: M.CAMP_FABRIC.slice(1).concat(M.CAMP_FABRIC[0]), build: (c) => M.cooler(c),
      colliders: [[0.1, 0, 0.22, 0.9, 0.56, 0.78]], actions: ['cooler'] },
    { key: 'camper_bunk', name: 'Camper Bunk', category: cat, size: [1, 2, 2], colors: BUNK_COLORS, build: (c) => M.camperBunk(c),
      colliders: [[0, 0, 0, 1, 0.38, 2], [0, 1.1, 0, 1, 1.32, 2]], actions: ['camp_sleep'], sleepSpots: M.BUNK_SPOTS },
    { key: 'zipline_tower', name: 'Zip Line Tower', category: cat, size: [2, 7, 2], colors: TOWER_COLORS, build: (c) => zipTower(c),
      colliders: zipTowerColliders(), actions: ['zip'] },
    { key: 'tree_platform', name: 'Tree Platform', category: cat, size: [3, 1, 3], colors: PLATFORM_COLORS, build: (c, d) => treePlatform(c, d),
      colliders: (d) => treePlatformColliders(d), actions: ['platform'], defaultData: { legs: 2.8, ladder: 3, open: 2 } },
    { key: 'rope_bridge', name: 'Rope Bridge', category: cat, size: [1, 1, 1], colors: BRIDGE_COLORS, build: (c, d) => ropeBridge(c, d),
      colliders: (d) => ropeBridgeColliders(d), actions: ['bridge'], defaultData: { i: 0, n: 3 } },
    { key: 'salon_chair', name: 'Salon Chair', category: 'bedroom', size: [1, 2, 2], colors: SALON_COLORS, build: (c) => salonChair(c),
      colliders: SALON_COLLIDERS, actions: ['salon'], seat: SALON_SEAT },
  ];
}

export function install(game) {
  const E = game.entities;
  if (!E || game.outdoor) return;
  installExtras(game);
  const sfx = createOutdoorSfx(game);
  const camp = installCamp(game, sfx);
  for (const def of outdoorDefs()) {
    if (camp.updates[def.key]) def.update = camp.updates[def.key];
    E.define(def);
  }

  const zip = new ZipLines(game, sfx);
  const ladders = new Ladders(game, new THREE.Vector3());
  const bridges = new Bridges(game, sfx);
  const items = game.registry.items;
  const bridgeItem = items.get('furn:rope_bridge');
  if (bridgeItem) bridgeItem.use = (g, hit, opts) => bridges.build(hit, opts && opts.color);
  const platformItem = items.get('furn:tree_platform');
  if (platformItem) platformItem.use = (g, hit, opts) => bridges.placePlatform(hit, opts && opts.color);

  // ---------- Hand-tool actions for the tree pieces ----------

  E.registerAction('zip', {
    run(g, e) {
      if (zip.ride) return true;
      if (!zip.linkOf(e.uid)) {
        g.toast('Build another Zip Tower nearby, then tap to zip across!', { icon: 'star', key: 'zip-link' });
        g.audio.play('click');
        return true;
      }
      return zip.start(e);
    },
    hint(g, e) {
      if (zip.ride) return null;
      return zip.linkOf(e.uid) ? 'Tap to zip!' : 'Build a 2nd tower to zip!';
    },
  });

  E.registerAction('platform', {
    run(g, e) {
      const p = g.player;
      if (!p) return false;
      if (ladders.onDeck(e, p.position)) {
        g.toast('What a view!', { icon: 'sun', key: 'view' });
        if (g.particles) g.particles.emit('sparkle', [p.position.x, p.position.y + 1.4, p.position.z], { count: 10 });
        g.audio.play('chime');
        return true;
      }
      return ladders.climbTo(e);
    },
    hint(g, e) {
      const p = g.player;
      if (p && ladders.onDeck(e, p.position)) return null;
      return ladders.zone(e) ? 'Tap to climb up!' : null;
    },
  });

  const _hitV = new THREE.Vector3();
  E.registerAction('bridge', {
    run(g, e, hit) {
      bridges.bounce = 1;
      sfx.boing(0.9 + Math.random() * 0.2);
      sfx.creak(1.1);
      if (g.particles) {
        const pt = hit && hit.point ? _hitV.copy(hit.point) : E.localToWorld(e, 0.5, 1, 0.5, _hitV);
        g.particles.emit('star', pt, { count: 6 });
      }
      return true;
    },
    hint: () => 'Tap to wobble!',
  });

  // ---------- keep links, ladders and railings in step with the world ----------

  game.events.on('entity:place', ({ entity }) => {
    if (!game.world || !entity) return;
    const k = entity.key;
    if (k === 'zipline_tower') {
      ladders.track(entity);
      zip.onPlace(entity);
    } else if (k === 'tree_platform') {
      ladders.track(entity);
      bridges.dirty = true;
    } else if (k === 'rope_bridge') {
      bridges.patch(entity);
      bridges.dirty = true;
    }
  });
  game.events.on('entity:remove', ({ entity }) => {
    if (!game.world || !entity) return;
    const k = entity.key;
    if (k === 'zipline_tower') {
      ladders.untrack(entity);
      zip.onRemove(entity);
    } else if (k === 'tree_platform') {
      ladders.untrack(entity);
      bridges.dirty = true;
    } else if (k === 'rope_bridge') bridges.dirty = true;
  });

  // multiplayer guest: pieces the host placed arrive silently (no entity events): keep the
  // ladders and whole-bridge Remove in step (the zip links follow the host's list, actors.js)
  game.events.on('net:applied', ({ placed, removed }) => {
    if (!game.world) return;
    if (removed) {
      for (const e of removed) {
        if (e.key === 'zipline_tower' || e.key === 'tree_platform') ladders.untrack(e);
        if (e.key === 'zipline_tower') zip.onRemove(e);
      }
    }
    if (placed) {
      for (const e of placed) {
        if (e.key === 'zipline_tower' || e.key === 'tree_platform') ladders.track(e);
        else if (e.key === 'rope_bridge') bridges.patch(e);
      }
    }
  });

  let repatch = 0, creakT = 0;
  const onBridge = () => {
    const p = game.player;
    if (!p || p.state !== 'walk' || !p.onGround) return false;
    const e = E.at(Math.floor(p.position.x), Math.floor(p.position.y - 0.2), Math.floor(p.position.z));
    return !!e && e.key === 'rope_bridge';
  };

  game.addSystem({
    name: 'outdoor',
    update(dt) {
      if (!game.world) return;
      const playing = game.mode === 'play';
      zip.update(playing && !game.paused ? dt : 0);
      if (playing && !game.paused) ladders.update(dt);
      camp.update(dt);
      if (bridges.dirty) bridges.refreshOpenings();
      // bridges: gentle sway, bouncier while she walks across
      if (playing && onBridge() && Math.hypot(game.player.velocity.x, game.player.velocity.z) > 0.6) {
        bridges.bounce = Math.max(bridges.bounce, 0.4);
        creakT -= dt;
        if (creakT <= 0) {
          creakT = 0.55 + Math.random() * 0.5;
          sfx.creak(0.9 + Math.random() * 0.3);
        }
      }
      bridges.bounce = Math.max(0, bridges.bounce - dt * 0.7);
      SWAY.uSwayT.value = game.time.t;
      SWAY.uSwayA.value = 0.045 + 0.1 * bridges.bounce;
      SWAY.uSwayB.value = 0.09 * bridges.bounce;
      // halos brighten as night falls
      const daylight = game.blockUniforms ? game.blockUniforms.uDaylight.value : 1;
      const night = Math.max(0, Math.min(1, (1 - daylight) / 0.55));
      setNightGlow(night, 0.86 + 0.1 * Math.sin(game.time.t * 11) + 0.04 * Math.sin(game.time.t * 5.3));
      // bridge segments keep their whole-bridge Remove / Build behaviour even if rebuilt
      repatch -= dt;
      if (repatch <= 0) {
        repatch = 1;
        for (const e of E.map.values()) if (e.key === 'rope_bridge') bridges.patch(e);
      }
    },
    onWorldLoad() {
      zip.clear();
      ladders.clear();
      game.scene.add(zip.group);
      for (const e of E.map.values()) {
        ladders.track(e);
        if (e.key === 'rope_bridge') bridges.patch(e);
      }
      bridges.dirty = true;
      bridges.bounce = 0;
    },
    onWorldUnload() {
      zip.clear();
      ladders.clear();
      camp.unload();
      sfx.windStop();
      game.scene.remove(zip.group);
    },
    serialize: () => ({ v: 1, zip: zip.serialize() }),
    deserialize(data) {
      if (data && Array.isArray(data.zip)) zip.deserialize(data.zip);
    },
  });

  game.outdoor = { zip, ladders, bridges, sfx, camp };
  if (game.debug) {
    game.debug.outdoor = {
      links: () => zip.links.map((l) => ({ a: l.a, b: l.b, len: l.len, parked: l.parked })),
      ride: () => (zip.ride ? { phase: zip.ride.phase, s: zip.ride.s, v: zip.ride.v, len: zip.ride.link.len } : null),
      zip: (uid) => {
        const e = E.byUid(uid);
        return e ? zip.start(e) : false;
      },
    };
  }
}
