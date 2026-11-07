// The dance deck: tap the DJ booth and the party starts (tap again: the next song; after the
// last song the DJ takes a rest). The booth's data holds the song (data.p: 0 off, 1..4), so it
// travels to every friend's page like a lamp's on/off and everyone near it gets the party:
//   - the music (sfx.js, on the effects bus) loudest on the floor, fading out by 28 blocks;
//     the world's own music ducks under it;
//   - a light-up floor: glowing tiles over the dance floor (the record's rectangle, or 6 x 5 in
//     front of a Bag booth) changing color on the beat, colored beams sweeping from the disco
//     ball, notes and confetti, and the booth's light pulsing. Only looks: no block changes;
//   - she dances when she stands still on the floor (and her friends nearby join in through the
//     'emote' event, the friends module's mirror).

import * as THREE from 'three';
import { rotXZ } from '../entities.js';
import { partsOf } from '../furniture/kit.js';

export const SONG_COUNT = 4;
const HEAR = 28; // blocks: the music fades out by here
const LOUD = 9; // blocks: full volume within this
const SEE = 56; // blocks from the camera: the floor lights and beams show within this
const MAX_TILES = 400;
const TILE_COLS = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#4FB8FF', '#9C7BFF', '#FF9F43'].map((c) => new THREE.Color(c));
const BPM = [118, 124, 112, 128];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The song a booth plays (0 = none). */
export function songOf(e) {
  // data.song (an ANY_FIELDS key, so a friend may start the party); data.p in older saves
  const d = e && e.data;
  const p = d ? (isNum(d.song) ? d.song : d.p) | 0 : 0;
  return p >= 1 && p <= SONG_COUNT ? p : 0;
}

/** The dance floor cells of a booth: [[x, y, z], ...] (the floor's top cells + 1, at most MAX_TILES). */
export function floorCells(e) {
  const d = (e && e.data) || {};
  const out = [];
  if ([d.fx0, d.fz0, d.fx1, d.fz1].every(isNum)) {
    const x0 = Math.min(d.fx0, d.fx1) | 0, x1 = Math.max(d.fx0, d.fx1) | 0;
    const z0 = Math.min(d.fz0, d.fz1) | 0, z1 = Math.max(d.fz0, d.fz1) | 0;
    const y = isNum(d.fy) ? d.fy | 0 : e.y;
    for (let x = x0; x <= x1 && x - x0 < 24; x++) {
      for (let z = z0; z <= z1 && z - z0 < 24; z++) {
        out.push([x, y, z]);
        if (out.length >= MAX_TILES) return out;
      }
    }
    return out;
  }
  // a Bag booth: 6 wide, 5 deep, out of its front
  for (let k = 1; k <= 5; k++) {
    for (let i = -2; i <= 3; i++) {
      const [ox, oz] = rotXZ(i, k, e.rot);
      out.push([e.x + ox, e.y, e.z + oz]);
    }
  }
  return out;
}

export class Party {
  constructor(game, sfx, hooks) {
    this.game = game;
    this.sfx = sfx;
    this.hooks = hooks || {};
    this.djs = new Set(); // booths seen by their def.update
    this.fx = new Map(); // uid -> { tiles, beams, song, light, cells, t, beat }
    this.group = new THREE.Group();
    this.group.name = 'cruise-party';
    this.playing = 0; // song index + 1 the music plays (0: quiet)
    this.ducked = false;
    this.danceT = 0;
    this.stillT = 0;
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._tileGeo = null;
    this._tileMat = null;
    this._beamGeo = null;
  }

  // ---------- the booth ----------

  /** Tap: start the party, then the next song, then a rest. Returns the new song (0 = off). */
  tap(e) {
    const g = this.game;
    const now = songOf(e);
    const next = now >= SONG_COUNT ? 0 : now + 1;
    g.entities.setData(e, { song: next });
    if (next === 1) {
      this.sfx.scratch();
      g.toast("Let's dance!", { icon: 'music', key: 'cruise-dj', color: 'pink' });
      if (g.particles) g.particles.emit('confetti', g.entities.localToWorld(e, 1, 2.2, 0.6, this._v), { count: 30, spread: 1.6 });
      if (this.hooks.started) this.hooks.started(e);
    } else if (next > 1) {
      this.sfx.scratch();
      g.toast(`Song ${next}!`, { icon: 'music', key: 'cruise-dj' });
      if (g.particles) g.particles.emit('note', g.entities.localToWorld(e, 1, 1.6, 0.6, this._v), { count: 8, spread: 0.8 });
    } else {
      g.audio.play('chime', { volume: 0.5 });
      g.toast('The DJ takes a little rest.', { icon: 'music', key: 'cruise-dj' });
    }
    g.events.emit('cruise:party', { uid: e.uid, song: next });
    return next;
  }

  /** Per frame for every booth (its def.update): remember it, spin its bits. */
  tick(e, dt) {
    this.djs.add(e);
    const song = songOf(e);
    const parts = partsOf(e);
    if (!song) return;
    const spin = dt * (BPM[song - 1] / 60) * Math.PI;
    if (parts.disco) parts.disco.rotation.y += spin * 0.5;
    if (parts.discL) parts.discL.rotation.y -= spin;
    if (parts.discR) parts.discR.rotation.y -= spin;
  }

  // ---------- every frame ----------

  update(dt, playing) {
    const g = this.game, E = g.entities, p = g.player;
    if (!E || !g.world) return;
    const cam = g.camera ? g.camera.position : null;
    let best = null, bestD = Infinity;
    for (const e of this.djs) {
      if (!E.byUid(e.uid) || E.byUid(e.uid) !== e) {
        this.djs.delete(e);
        this._drop(e.uid);
        continue;
      }
      const song = songOf(e);
      if (!song) {
        this._drop(e.uid);
        continue;
      }
      const c = E.localToWorld(e, 1, 1, 0.5, this._v);
      if (p) {
        const d = c.distanceTo(p.position);
        if (d < bestD) { bestD = d; best = e; }
      }
      const near = cam ? c.distanceTo(cam) < SEE : true;
      if (near) this._show(e, song, dt);
      else this._drop(e.uid);
    }
    // the music: the nearest party she can hear
    const song = best && bestD < HEAR ? songOf(best) : 0;
    if (song && playing) {
      // (audio still locked before her first tap: try again next frame, so the music starts
      // as soon as sound is allowed)
      if (this.playing !== song && this.sfx.partyStart(song - 1) !== false) this.playing = song;
      const vol = bestD <= LOUD ? 1 : Math.max(0, 1 - (bestD - LOUD) / (HEAR - LOUD));
      this.sfx.partyVolume(vol);
      this._duck(vol);
    } else if (this.playing || this.ducked) {
      this.stop();
    }
    // she dances on the floor
    if (song && playing && p && best) this._dance(best, dt);
  }

  /** Quiet: the music off and the world's music back (the lights stay with their booths). */
  stop() {
    this.sfx.partyStop();
    this.playing = 0;
    this._duck(0);
  }

  /** World closing: everything off and gone. */
  clear() {
    this.stop();
    for (const uid of [...this.fx.keys()]) this._drop(uid);
    this.djs.clear();
  }

  // ---------- her dancing ----------

  _dance(e, dt) {
    const p = this.game.player;
    const on = this._onFloor(e, p.position);
    const still = p.state === 'walk' && p.onGround && Math.hypot(p.velocity.x, p.velocity.z) < 0.3;
    if (!on || !still) {
      this.stillT = 0;
      return;
    }
    this.stillT += dt;
    this.danceT -= dt;
    if (this.stillT > 0.8 && this.danceT <= 0 && typeof p.emote === 'function') {
      this.danceT = 3.2;
      p.emote('dance');
    }
  }

  _onFloor(e, pos) {
    const f = this.fx.get(e.uid);
    const cells = f ? f.cells : floorCells(e);
    const x = Math.floor(pos.x), z = Math.floor(pos.z), y = Math.floor(pos.y + 0.1);
    for (const c of cells) if (Math.abs(c[0] - x) <= 0 && Math.abs(c[2] - z) <= 0 && Math.abs(c[1] - y) <= 1) return true;
    // close to the booth counts too
    const c = this.game.entities.localToWorld(e, 1, 0, 1.5, this._v);
    return Math.hypot(c.x - pos.x, c.z - pos.z) < 2.5 && Math.abs(c.y - pos.y) < 1.5;
  }

  _duck(vol) {
    const A = this.game.audio;
    if (!A || !A.ctx || !A.musicGain) return;
    const on = vol > 0.05;
    if (on) {
      A.musicGain.gain.setTargetAtTime(A.musicVolume * 0.28 * (1 - 0.85 * vol), A.ctx.currentTime, 0.3);
      this.ducked = true;
    } else if (this.ducked) {
      this.ducked = false;
      if (typeof A._applyVolumes === 'function') A._applyVolumes();
    }
  }

  // ---------- the lights ----------

  _materials() {
    if (!this._tileGeo) {
      this._tileGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
      this._tileMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      this._beamGeo = new THREE.ConeGeometry(0.9, 6, 12, 1, true).translate(0, -3, 0);
    }
  }

  _show(e, song, dt) {
    const g = this.game, E = g.entities, w = g.world;
    let f = this.fx.get(e.uid);
    if (!f || f.song !== song || f.x !== e.x || f.y !== e.y || f.z !== e.z || f.rot !== e.rot) {
      this._drop(e.uid);
      this._materials();
      const props = g.registry.blocks.props;
      const solid = (x, y, z) => {
        if (!w.inBounds(x, y, z)) return false;
        const id = w.get(x, y, z);
        return id !== 0 && props.solid[id] === 1 && !props.replaceable[id];
      };
      // tiles only where there is floor to light up and room above it
      const cells = floorCells(e);
      const lit = cells.filter(([x, y, z]) => solid(x, y - 1, z) && !solid(x, y, z));
      const tiles = new THREE.InstancedMesh(this._tileGeo, this._tileMat, Math.max(1, lit.length));
      tiles.count = lit.length;
      tiles.frustumCulled = false;
      tiles.renderOrder = 3;
      for (let i = 0; i < lit.length; i++) {
        const [x, y, z] = lit[i];
        this._m.makeTranslation(x + 0.5, y + 0.03, z + 0.5);
        tiles.setMatrixAt(i, this._m);
        tiles.setColorAt(i, TILE_COLS[(x + z) % TILE_COLS.length] || TILE_COLS[0]);
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
      tiles.instanceMatrix.needsUpdate = true;
      this.group.add(tiles);
      // beams from the disco ball
      const beams = new THREE.Group();
      E.localToWorld(e, 1.0, 2.05, 0.42, this._v);
      beams.position.copy(this._v);
      const mats = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.MeshBasicMaterial({ color: TILE_COLS[i * 2 % TILE_COLS.length], transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        mats.push(m);
        const arm = new THREE.Group();
        arm.rotation.y = (i / 4) * Math.PI * 2;
        const beam = new THREE.Mesh(this._beamGeo, m);
        beam.rotation.x = 0.55;
        beam.renderOrder = 3;
        arm.add(beam);
        beams.add(arm);
      }
      this.group.add(beams);
      // the booth's light pulses (one of the shared point lights, like a car's lamps)
      const lp = E.localToWorld(e, 1, 2.2, 1.6, new THREE.Vector3());
      const light = { object3d: e.object3d, lightPoint: [lp.x, lp.y, lp.z], lightCell: [Math.floor(lp.x), Math.floor(lp.y), Math.floor(lp.z)], lightScale: 1 };
      if (E.extraLights) E.extraLights.add(light);
      f = { tiles, beams, mats, light, lit, cells, song, x: e.x, y: e.y, z: e.z, rot: e.rot, t: 0, beat: -1 };
      this.fx.set(e.uid, f);
      if (!this.group.parent && g.scene) g.scene.add(this.group);
    }
    f.light.object3d = e.object3d;
    f.t += dt;
    const bps = BPM[song - 1] / 60;
    const beat = Math.floor(f.t * bps);
    const inBeat = f.t * bps - beat;
    // the floor changes on every beat: stripes, rings, checks, sparkles
    if (beat !== f.beat) {
      f.beat = beat;
      const pattern = Math.floor(beat / 8) % 4;
      const cx = (f.lit.reduce((s, c) => s + c[0], 0) / Math.max(1, f.lit.length));
      const cz = (f.lit.reduce((s, c) => s + c[2], 0) / Math.max(1, f.lit.length));
      for (let i = 0; i < f.lit.length; i++) {
        const [x, , z] = f.lit[i];
        let k;
        if (pattern === 0) k = x + z + beat;
        else if (pattern === 1) k = Math.round(Math.hypot(x - cx, z - cz)) - beat;
        else if (pattern === 2) k = ((x + z) & 1) * 3 + beat;
        else k = ((x * 7 + z * 13 + beat * 5) >>> 0) % 97;
        f.tiles.setColorAt(i, TILE_COLS[((k % TILE_COLS.length) + TILE_COLS.length) % TILE_COLS.length]);
      }
      if (f.tiles.instanceColor) f.tiles.instanceColor.needsUpdate = true;
      // notes and confetti now and then
      if (g.particles && beat % 4 === 0) {
        const c = E.localToWorld(e, 1, 2.3, 0.6, this._v);
        g.particles.emit('note', c, { count: 2, spread: 0.8 });
      }
      if (g.particles && beat % 16 === 8 && f.lit.length) {
        const [x, y, z] = f.lit[(beat * 31) % f.lit.length];
        g.particles.emit('confetti', this._v.set(x + 0.5, y + 2.5, z + 0.5), { count: 14, spread: 1.4 });
      }
    }
    f.tiles.material.opacity = 0.32 + 0.3 * (1 - inBeat);
    f.beams.rotation.y += dt * 0.9;
    for (let i = 0; i < f.beams.children.length; i++) {
      const arm = f.beams.children[i];
      arm.children[0].rotation.x = 0.45 + 0.25 * Math.sin(f.t * 1.3 + i * 1.7);
    }
    f.light.lightScale = 0.7 + 0.8 * (1 - inBeat);
  }

  _drop(uid) {
    const f = this.fx.get(uid);
    if (!f) return;
    this.fx.delete(uid);
    this.group.remove(f.tiles);
    this.group.remove(f.beams);
    f.tiles.dispose();
    for (const m of f.mats) m.dispose();
    const E = this.game.entities;
    if (E && E.extraLights) E.extraLights.delete(f.light);
    if (!this.fx.size && this.group.parent) this.group.parent.remove(this.group);
  }
}
