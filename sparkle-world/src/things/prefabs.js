// Magic Houses: whole furnished houses (and a few other Magic Builds) from the Bag's
// "Magic Houses" tab. Pick one and a see-through ghost of it follows the Build target,
// its front turned toward you (Turn button / R key). Tap to build: the house pops in block by
// block from the bottom up with sparkles and a magic sound, the area is cleared and levelled,
// the furniture moves in, and ONE Undo takes it all back (terrain restored exactly).
//
// Registry: game.registry.prefabs.set(key, { key, name, icon, size: [x, y, z], build(api) })
// (api: see prefabs/kit.js). Items: 'prefab:<key>' in the 'houses' Bag tab.
// API: game.prefabs (register, plan, place, placementAt, finish, ...). Event 'prefab:place'.

import * as THREE from 'three';
import { hash3, clamp } from '../core/util.js';
import { raycastVoxels, makeVoxelHit } from '../world/raycast.js';
import { resolvePlan } from './prefabs/plan.js';
import { placementFromHit, placementAt, computeDiff, writeCells, groundBelow, footprintBounds } from './prefabs/place.js';
import { voxelGeometry, prefabMaterial, footprintMaterial } from './prefabs/mesh.js';
import { createToolbar } from './prefabs/toolbar.js';
import { PREFABS } from './prefabs/catalog.js';

const START = 0.12; // first blocks pop at
const SPREAD = 1.0; // bottom-to-top sweep
const JITTER = 0.16;
const POP = 0.38; // one block's pop (matches the shader)
const CORNER_SPARKLE = { count: 2, spread: 0.3 };
const BAND_SPARKLE = { count: 3, spread: 0.6 };
const POP_SOUND = { pitch: 1, volume: 0.45 };

/** Voxels of a plan in prefab-local coordinates (ghost / thumbnail). */
function localSource(plan, groundId = 0) {
  const { W, H, D, ids } = plan;
  const idAt = (x, y, z) => {
    if (y < 0) return -1;
    if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return 0;
    const v = ids[(y * D + z) * W + x];
    if (v > 0) return v;
    return y === 0 && v < 0 ? groundId : 0;
  };
  return {
    idAt,
    each(cb) {
      for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const id = idAt(x, y, z);
        if (id > 0) cb(x, y, z, id);
      }
    },
  };
}

/** Voxels that a placement will write, looked up against the final world state. */
function diffSource(world, diff) {
  const { sx, sy, sz, blocks } = world;
  const map = diff.map;
  const layer = sx * sz;
  return {
    idAt(x, y, z) {
      if (y < 0) return -1;
      if (x < 0 || z < 0 || x >= sx || z >= sz || y >= sy) return 0;
      const i = (y * sz + z) * sx + x;
      const v = map.get(i);
      return v === undefined ? blocks[i] : v;
    },
    each(cb) {
      const { idx, next } = diff;
      for (let k = 0; k < idx.length; k++) {
        if (!next[k]) continue;
        const i = idx[k];
        const y = Math.floor(i / layer);
        const r = i - y * layer;
        const z = Math.floor(r / sx);
        cb(r - z * sx, y, z, next[k]);
      }
    },
  };
}

/** The see-through preview: house ghost, pulsing footprint, corner posts. */
class Ghost {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'prefab-ghost';
    this.group.visible = false;
    game.scene.add(this.group);
    this.key = null;
    this.plan = null;
    this.pl = null;
    this.yaw = 0;
    this.t = 0;
    this.sparkT = 0;
    this.box = new THREE.Box3();
    this._v = new THREE.Vector3();
    this._sig = new Int32Array(8); // what the placement was computed from (no per-frame strings)
    this._sigPlan = null;
  }

  /** True when the aim / turn / player cell differ from the last placement's inputs. */
  changed(plan, t, turn, px, pz) {
    const s = this._sig;
    const v0 = t.x, v1 = t.y, v2 = t.z, v3 = t.face[1], v4 = turn, v5 = Math.round(px), v6 = Math.round(pz);
    if (this._sigPlan === plan && s[7] === 1 && s[0] === v0 && s[1] === v1 && s[2] === v2 && s[3] === v3 && s[4] === v4 && s[5] === v5 && s[6] === v6) return false;
    this._sigPlan = plan;
    s[0] = v0; s[1] = v1; s[2] = v2; s[3] = v3; s[4] = v4; s[5] = v5; s[6] = v6; s[7] = 1;
    return true;
  }

  invalidate() {
    this._sig[7] = 0;
  }

  _init() {
    if (this.colorMat) return;
    const g = this.game;
    this.depthMat = prefabMaterial(g, 'ghostDepth');
    this.colorMat = prefabMaterial(g, 'ghost');
    this.depthMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.depthMat);
    this.colorMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.colorMat);
    this.depthMesh.renderOrder = 20;
    this.colorMesh.renderOrder = 21;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.footMat = footprintMaterial();
    this.foot = new THREE.Mesh(plane, this.footMat);
    this.foot.renderOrder = 22;
    this.postMat = new THREE.MeshBasicMaterial({ color: 0xff5fa2, transparent: true, opacity: 0.8, depthWrite: false });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0);
    this.posts = [0, 1, 2, 3].map(() => {
      const m = new THREE.Mesh(unit, this.postMat);
      m.renderOrder = 22;
      return m;
    });
    this.inner = new THREE.Group();
    this.inner.add(this.depthMesh, this.colorMesh, this.foot, ...this.posts);
    this.group.add(this.inner);
  }

  setPlan(plan) {
    this._init();
    if (this.plan === plan) return;
    this.plan = plan;
    this.key = plan.key;
    if (!plan.ghostGeo) {
      plan.ghostGeo = voxelGeometry(localSource(plan), this.game.registry.blocks.props, { offset: [plan.ax + 0.5, 0, plan.az + 0.5] });
      plan.ghostGeo.userData.shared = true;
    }
    this.depthMesh.geometry = plan.ghostGeo;
    this.colorMesh.geometry = plan.ghostGeo;
    const { W, D, ax, az } = plan;
    const h = plan.maxY + 1;
    this.foot.scale.set(W, 1, D);
    this.foot.position.set((W - 1) / 2 - ax, 1.04, (D - 1) / 2 - az);
    this.footMat.uniforms.uSize.value.set(W, D);
    const xs = [-ax - 0.5, W - ax - 0.5], zs = [-az - 0.5, D - az - 0.5];
    let i = 0;
    for (const x of xs) for (const z of zs) {
      const m = this.posts[i++];
      m.position.set(x, 1, z);
      m.scale.set(0.09, h, 0.09);
    }
  }

  place(pl, snap) {
    this.pl = pl;
    const target = pl.rot * (Math.PI / 2);
    if (snap) this.yaw = target;
    this.targetYaw = target;
    this.group.position.set(pl.ox + 0.5, pl.oy, pl.oz + 0.5);
    const b = pl.bounds;
    this.box.min.set(b.x0 - 0.2, pl.oy, b.z0 - 0.2);
    this.box.max.set(b.x1 + 1.2, pl.oy + this.plan.maxY + 1.5, b.z1 + 1.2);
  }

  hide() {
    this.group.visible = false;
    this.pl = null;
    this.invalidate();
    if (this.pickable) this.game.pickables.delete(this.pickable);
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    // ease the turn (shortest way round)
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 14);
    this.inner.rotation.y = this.yaw;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    this.colorMat.uniforms.uOpacity.value = 0.42 + 0.14 * pulse;
    this.footMat.uniforms.uTime.value = this.t;
    this.postMat.opacity = 0.55 + 0.35 * pulse;
    // sparkles drift up from the corners
    this.sparkT -= dt;
    const g = this.game;
    if (this.sparkT <= 0 && g.particles && this.pl) {
      this.sparkT = 0.28;
      const b = this.pl.bounds;
      const k = Math.floor(this.t * 7) % 4;
      const x = k & 1 ? b.x1 + 1 : b.x0, z = k & 2 ? b.z1 + 1 : b.z0;
      this._v.set(x, this.pl.oy + 1 + Math.random() * (this.plan.maxY + 1), z);
      g.particles.emit('sparkle', this._v, CORNER_SPARKLE);
    }
  }
}

export function install(game) {
  const registry = game.registry.prefabs;
  const plans = new Map();
  const items = game.registry.items;
  let ghost = null;
  let toolbar = null;
  let job = null;
  let buildMat = null;
  let thumbMat = null;
  let turn = 0;
  let turnKey = null;
  let touchTip = null;
  let justBuilt = null; // bounds of the house just built: no ghost over it until she aims elsewhere
  const scratch = { v: new THREE.Vector3(), ray: new THREE.Ray(), hitP: new THREE.Vector3() };
  const aim = {
    raycaster: new THREE.Raycaster(), vh: makeVoxelHit(), head: new THREE.Vector3(), center: new THREE.Vector2(0, 0),
    hit: { type: 'block', x: 0, y: 0, z: 0, id: 0, key: '', face: [0, 0, 0], point: new THREE.Vector3(), place: [0, 0, 0], distance: 0 },
  };

  /** What the Build tool aims at on the ground, looking straight through the ghost itself. */
  function aimGround() {
    const w = game.world;
    if (!w) return null;
    aim.raycaster.setFromCamera(game.input.pointer || aim.center, game.camera);
    const { origin: o, direction: d } = aim.raycaster.ray;
    const pp = game.player && game.player.position;
    const head = pp ? aim.head.set(pp.x, pp.y + 1.4, pp.z) : aim.head.copy(o);
    const vh = raycastVoxels(w, o.x, o.y, o.z, d.x, d.y, d.z, o.distanceTo(head) + game.reach, null, aim.vh);
    if (!vh) return null;
    const h = aim.hit;
    h.x = vh.x; h.y = vh.y; h.z = vh.z; h.id = vh.id;
    h.face[0] = vh.face[0]; h.face[1] = vh.face[1]; h.face[2] = vh.face[2];
    h.point.set(vh.point[0], vh.point[1], vh.point[2]);
    h.place[0] = vh.x + vh.face[0]; h.place[1] = vh.y + vh.face[1]; h.place[2] = vh.z + vh.face[2];
    h.distance = vh.distance;
    if (pp && h.point.distanceTo(head) > game.reach + 0.75) return null;
    return h;
  }

  const ready = () => !!game.blockUniforms && !!game.registry.blocks.props;

  function planOf(key) {
    if (!ready()) return null;
    let p = plans.get(key);
    if (p) return p;
    const def = registry.get(key);
    if (!def || typeof def.build !== 'function') return null;
    try {
      p = resolvePlan(game, def);
    } catch (err) {
      console.error('[prefabs] could not draw up', key, err);
      return null;
    }
    plans.set(key, p);
    return p;
  }

  // ---------- thumbnails ----------

  function thumbObject(key) {
    const plan = planOf(key);
    if (!plan) return null;
    if (!thumbMat) thumbMat = prefabMaterial(game, 'thumb');
    if (!plan.thumbGeo) {
      const grass = game.registry.blocks.idOf('grass');
      plan.thumbGeo = voxelGeometry(localSource(plan, grass > 0 ? grass : 0), game.registry.blocks.props, { offset: [plan.W / 2, 0, plan.D / 2] });
      plan.thumbGeo.userData.shared = true;
    }
    return new THREE.Mesh(plan.thumbGeo, thumbMat);
  }

  function iconFor(key) {
    const def = registry.get(key);
    return game.thumbs.get('prefab:' + key, () => thumbObject(key), { dir: def && def.iconDir ? def.iconDir : [1.0, 0.8, 1.55], zoom: def && def.iconZoom ? def.iconZoom : 0.78 });
  }

  // ---------- registering ----------

  function register(def) {
    if (!def || !def.key || typeof def.build !== 'function') throw new Error('prefab needs key and build()');
    const entry = { ...def, icon: () => iconFor(def.key) };
    registry.set(def.key, entry);
    plans.delete(def.key);
    items.register({
      key: 'prefab:' + def.key,
      name: def.name || def.key,
      category: 'houses',
      kind: 'other',
      prefab: def.key,
      icon: () => iconFor(def.key),
      use: (g, hit) => usePrefab(def.key, hit),
    });
    return entry;
  }

  for (const def of PREFABS) register(def);
  // prefabs other modules put straight into the registry still get their Bag item
  game.events.on('game:ready', () => {
    for (const [key, def] of registry) if (!items.has('prefab:' + key) && def && typeof def.build === 'function') register({ key, ...def });
  });

  // ---------- building ----------

  function moveOut(diff, plan, pl) {
    const p = game.player;
    const w = game.world;
    if (!p || !w || p.state === 'ride') return;
    const pos = p.position;
    const b = diff.bounds;
    const inside = pos.x > b.x0 - 0.35 && pos.x < b.x1 + 1.35 && pos.z > b.z0 - 0.35 && pos.z < b.z1 + 1.35 &&
      pos.y > pl.oy - 3 && pos.y < pl.oy + plan.H + 1;
    const blocked = game.physics && game.physics.bodyBlocked(pos.x, pos.y + 0.01, pos.z, p.halfW, p.height);
    if (!inside && !blocked) return;
    if (p.state === 'sit' || p.state === 'sleep') p.stand();
    const ex = clamp(diff.entry[0], 1, w.sx - 2), ez = clamp(diff.entry[1], 1, w.sz - 2);
    const gy = groundBelow(game, ex, w.sy - 1, ez);
    p.teleport(ex + 0.5, gy + 1.02, ez + 0.5);
    if (game.physics && game.physics.bodyBlocked(ex + 0.5, gy + 1.02, ez + 0.5, p.halfW, p.height)) {
      const spot = p.findStandSpot ? p.findStandSpot(ex + 0.5, gy + 1, ez + 0.5) : null;
      if (spot) p.teleport(spot[0], spot[1], spot[2]);
    }
    const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2;
    const yaw = Math.atan2(cx - p.position.x, cz - p.position.z);
    p.yaw = yaw;
    if (game.cameraRig) game.cameraRig.yaw = yaw;
  }

  /** Apply a placement now (one Undo). Returns a result summary. */
  function commit(plan, pl) {
    const w = game.world;
    const diff = computeDiff(game, plan, pl);
    const res = {
      key: plan.key, name: plan.name, placement: { x: pl.ox, y: pl.oy, z: pl.oz, rot: pl.rot },
      bounds: diff.bounds, changed: diff.idx.length, removed: diff.entities.length,
      furniture: { requested: diff.furniture.length, placed: 0, skipped: [] },
    };
    game.historyGroup(() => {
      for (const e of diff.entities) game.entities.remove(e, { history: true, fx: false });
      const { idx, next } = diff;
      const prev = writeCells(w, idx, next);
      game.pushHistory({
        undo: () => { if (game.world === w) writeCells(w, idx, prev); },
        redo: () => { if (game.world === w) writeCells(w, idx, next); },
      });
      moveOut(diff, plan, pl);
      if (game.entities) {
        for (const f of diff.furniture) {
          const e = game.entities.place(f.key, f.x, f.y, f.z, f.rot, f.color, f.data || {}, { history: true, fx: false });
          if (e) res.furniture.placed++;
          else res.furniture.skipped.push(f.key);
        }
      }
    });
    return res;
  }

  function celebrate(plan, res) {
    const b = res.bounds;
    const top = res.placement.y + plan.maxY + 1.5;
    const cx = (b.x0 + b.x1 + 1) / 2, cz = (b.z0 + b.z1 + 1) / 2;
    const P = game.particles;
    if (P) {
      P.emit('confetti', new THREE.Vector3(cx, top, cz), { count: 70, spread: 2.5 });
      for (const [x, z] of [[b.x0, b.z0], [b.x1 + 1, b.z0], [b.x0, b.z1 + 1], [b.x1 + 1, b.z1 + 1]]) {
        P.emit('star', new THREE.Vector3(x, res.placement.y + 2, z), { count: 8, spread: 0.6 });
      }
      P.emit('heart', new THREE.Vector3(res.placement.x + 0.5, res.placement.y + 2.5, res.placement.z + 0.5), { count: 8 });
    }
    game.audio.play('success');
    game.toast(`Ta-da! Your ${plan.name} is ready!`, { icon: 'home', big: true });
    game.events.emit('prefab:place', { prefab: { key: plan.key, name: plan.name, ...res.placement, bounds: res.bounds } });
  }

  function dropMesh(j) {
    if (j.mesh) {
      game.scene.remove(j.mesh);
      j.mesh = null;
    }
    if (j.geo) {
      j.geo.dispose();
      j.geo = null;
    }
  }

  function commitJob(j) {
    if (j.committed) return;
    j.committed = true;
    const i = game.history.indexOf(j.placeholder);
    if (i >= 0) game.history.splice(i, 1);
    try {
      j.result = commit(j.plan, j.pl);
      game.prefabs.lastResult = j.result;
      celebrate(j.plan, j.result);
    } catch (err) {
      console.error('[prefabs] build failed', j.plan.key, err);
      dropMesh(j);
    }
  }

  function finishJob(j) {
    if (!j) return;
    commitJob(j);
    dropMesh(j);
    if (job === j) job = null;
  }

  function cancelJob(j) {
    if (!j || j.committed) return;
    j.committed = true;
    justBuilt = null;
    dropMesh(j);
    if (job === j) job = null;
  }

  /** Start the pop-in animation; the world changes when it ends (one Undo). */
  function startJob(plan, pl) {
    const w = game.world;
    const diff = computeDiff(game, plan, pl);
    const maxLy = plan.maxY + 3;
    const start = (x, y, z) => START + clamp((y - pl.oy + 2) / maxLy, 0, 1) * SPREAD + hash3(x, y, z) * JITTER;
    const geo = voxelGeometry(diffSource(w, diff), game.registry.blocks.props, { start });
    if (!buildMat) buildMat = prefabMaterial(game, 'build');
    buildMat.uniforms.uClock.value = 0;
    const mesh = new THREE.Mesh(geo, buildMat);
    mesh.name = 'prefab-build';
    game.scene.add(mesh);
    const j = {
      plan, pl, t: 0, start: performance.now(), T: START + SPREAD + JITTER + POP, mesh, geo, committed: false, layer: -99, sparkT: 0,
      bounds: diff.bounds, result: null,
    };
    j.placeholder = { undo: () => cancelJob(j), redo: () => {} };
    game.pushHistory(j.placeholder);
    job = j;
    game.audio.play('magic');
    game.audio.play('whoosh', { volume: 0.5, pitch: 1.3 });
    if (game.particles) {
      const b = diff.bounds;
      game.particles.emit('sparkle', new THREE.Vector3((b.x0 + b.x1 + 1) / 2, pl.oy + 1.5, (b.z0 + b.z1 + 1) / 2), { count: 40, spread: Math.max(2, (b.x1 - b.x0) / 3) });
    }
    return j;
  }

  function updateJob(dt) {
    const j = job;
    if (!j) return;
    // real time, so the magic takes ~1.6 s even when frames are slow
    j.t = typeof game.prefabs.holdClock === 'number' ? game.prefabs.holdClock : (performance.now() - j.start) / 1000;
    if (buildMat) buildMat.uniforms.uClock.value = j.t;
    const b = j.bounds;
    if (!j.committed) {
      const maxLy = j.plan.maxY + 3;
      const f = (j.t - START) / SPREAD;
      const layer = Math.floor(f * maxLy) - 2;
      if (layer > j.layer && f <= 1.05) {
        j.layer = layer;
        POP_SOUND.pitch = 0.75 + clamp(f, 0, 1) * 0.9;
        game.audio.play('pop', POP_SOUND);
      }
      j.sparkT -= dt;
      if (j.sparkT <= 0 && game.particles && f <= 1.1) {
        j.sparkT = 0.045;
        const y = j.pl.oy + clamp(f, 0, 1) * maxLy - 1;
        const v = scratch.v.set(b.x0 + Math.random() * (b.x1 - b.x0 + 1), y, b.z0 + Math.random() * (b.z1 - b.z0 + 1));
        game.particles.emit(Math.random() < 0.3 ? 'star' : 'sparkle', v, BAND_SPARKLE);
      }
      if (j.t >= j.T) commitJob(j);
      return;
    }
    // keep the animated copy until the real chunk meshes are rebuilt
    const w = game.world;
    let clean = true;
    for (let cz = Math.max(0, (b.z0 - 1) >> 4); cz <= Math.min(w.czCount - 1, (b.z1 + 1) >> 4) && clean; cz++) {
      for (let cx = Math.max(0, (b.x0 - 1) >> 4); cx <= Math.min(w.cxCount - 1, (b.x1 + 1) >> 4); cx++) {
        if (w.dirty[cz * w.cxCount + cx]) { clean = false; break; }
      }
    }
    if (clean || j.t > j.T + 4) {
      dropMesh(j);
      job = null;
    }
  }

  /** Build a plan at a placement (animated unless told otherwise). */
  function build(plan, pl, { animate = true } = {}) {
    if (!plan || !pl || !game.world) return null;
    if (job && !job.committed) return null; // one magic at a time
    if (job) finishJob(job);
    justBuilt = pl.bounds;
    if (ghost) ghost.hide();
    if (animate) return startJob(plan, pl);
    const res = commit(plan, pl);
    game.prefabs.lastResult = res;
    celebrate(plan, res);
    return res;
  }

  /** Did this tap land on the ghost (its footprint, or a ray through its box)? */
  function tapOnGhost(hit) {
    if (!ghost || !ghost.group.visible || !ghost.pl) return false;
    const b = ghost.pl.bounds;
    const px = hit.type === 'block' ? hit.x : hit.place[0], pz = hit.type === 'block' ? hit.z : hit.place[2];
    if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1) return true;
    const cam = game.camera.position;
    const ray = scratch.ray;
    ray.origin.copy(cam);
    ray.direction.copy(hit.point).sub(cam).normalize();
    const p = ray.intersectBox(ghost.box, scratch.hitP);
    return !!p && p.distanceTo(cam) <= cam.distanceTo(hit.point) + 0.5;
  }

  function usePrefab(key, hit) {
    const plan = planOf(key);
    if (!plan || !game.world || !hit) return false;
    if (job && !job.committed) return true; // still building the last one
    if (game.input.touchMode) {
      // iPad: the first tap shows where it goes, a tap on the ghost builds it
      if (ghost && ghost.key === key && tapOnGhost(hit)) return !!build(plan, ghost.pl);
      touchTip = 'Tap it to build!';
      game.audio.play('pop', { pitch: 1.3 });
      return true;
    }
    const pl = placementFromHit(game, plan, hit, turnKey === key ? turn : 0);
    return !!build(plan, pl);
  }

  function selectedPrefab() {
    if (game.selectedTool !== 'build') return null;
    const item = game.selectedItem();
    return item && item.prefab ? item : null;
  }

  function turnHouse() {
    const item = selectedPrefab();
    if (!item) return false;
    turn = (turn + 1) & 3;
    turnKey = item.prefab;
    game.audio.play('pop', { pitch: 1.15 });
    if (ghost) ghost.invalidate();
    return true;
  }

  function buildHere() {
    const item = selectedPrefab();
    if (!item) return false;
    if (job && !job.committed) return false;
    if (!ghost || !ghost.group.visible || ghost.key !== item.prefab) {
      game.toast('Look at the ground first!', { icon: 'home' });
      return false;
    }
    return !!build(ghost.plan, ghost.pl);
  }

  // ---------- ghost & toolbar each frame ----------

  function updateGhost(dt) {
    const item = game.mode === 'play' && !game.paused && !(job && !job.committed) ? selectedPrefab() : null;
    // while the mouse is on the house bar (reaching for Turn or Build!) the canvas has lost the
    // cursor and the aim would jump to the screen centre: keep the ghost where she pointed
    const hold = !!item && !!toolbar && toolbar.hover && !!ghost && ghost.group.visible && ghost.key === item.prefab;
    const t = item ? (hold ? aim.hit : aimGround()) : null;
    if (t && justBuilt) {
      const b = justBuilt;
      if (t.x >= b.x0 - 1 && t.x <= b.x1 + 1 && t.z >= b.z0 - 1 && t.z <= b.z1 + 1) {
        if (ghost && ghost.group.visible) ghost.hide();
        return;
      }
      justBuilt = null;
    }
    if (!item || !t || !t.place) {
      if (ghost && ghost.group.visible) ghost.hide();
      return;
    }
    const plan = planOf(item.prefab);
    if (!plan) return;
    if (!ghost) {
      ghost = new Ghost(game);
      // the ghost is tappable: a tap (or click) anywhere on it builds it right there
      ghost.pickable = {
        object3d: ghost.group, kind: 'other', ref: ghost, box: ghost.box,
        onBuild: (g, hit, it) => {
          if (it && it.prefab === ghost.key && ghost.pl && !(job && !job.committed)) build(ghost.plan, ghost.pl);
          return true;
        },
        hint: (g) => (g.input.touchMode ? 'Tap to build!' : 'Click to build!'),
      };
    }
    if (turnKey !== item.prefab) {
      turnKey = item.prefab;
      turn = 0;
    }
    const p = game.player ? game.player.position : game.camera.position;
    if (ghost.changed(plan, t, turn, p.x, p.z)) {
      const pl = placementFromHit(game, plan, t, turn);
      if (!pl) return;
      const fresh = !ghost.group.visible || ghost.plan !== plan;
      ghost.setPlan(plan);
      ghost.place(pl, fresh);
    }
    ghost.group.visible = true;
    game.pickables.add(ghost.pickable);
    ghost.update(dt);
  }

  function updateToolbar() {
    if (!toolbar) return;
    const item = game.mode === 'play' && !game.paused ? selectedPrefab() : null;
    if (!item) {
      toolbar.hide();
      touchTip = null;
      return;
    }
    let tip;
    if (job && !job.committed) tip = 'Magic!';
    else if (game.input.touchMode) tip = ghost && ghost.group.visible ? touchTip || 'Tap it to build!' : 'Tap a spot!';
    else tip = 'Click to build!';
    toolbar.show(item, tip);
  }

  game.addSystem({
    name: 'prefabs',
    onWorldLoad() {
      job = null;
      turn = 0;
      if (ghost) ghost.hide();
    },
    onWorldUnload() {
      if (job) cancelJob(job);
      job = null;
      if (ghost) ghost.hide();
      if (toolbar) toolbar.hide();
    },
    update(dt) {
      if (!game.world) return;
      try {
        updateJob(dt);
      } catch (err) {
        console.error('[prefabs] build animation failed', err);
        if (job) finishJob(job);
      }
      updateGhost(dt);
      updateToolbar();
    },
  });

  if (game.ui) toolbar = createToolbar(game, { onTurn: turnHouse, onBuild: buildHere });

  game.input.on('key', (e) => {
    if (!e.down || e.repeat || e.code !== 'KeyR') return;
    if (game.mode !== 'play' || game.paused || (game.ui && game.ui.dialogOpen)) return;
    turnHouse();
  });
  game.registerAction('turn_house', () => turnHouse());
  // the see-through preview is a building aid, not part of her world: keep it out of the My
  // Worlds pictures and her photos (both render between these two events). The pop-in of a
  // house being built stays: that is the house appearing, and the world only changes at the end.
  let ghostWasShown = false;
  game.events.on('thumbnail:before', () => {
    ghostWasShown = !!(ghost && ghost.group.visible);
    if (ghostWasShown) ghost.group.visible = false;
  });
  game.events.on('thumbnail:after', () => {
    if (ghostWasShown && ghost) ghost.group.visible = true;
    ghostWasShown = false;
  });

  // after an Undo the spot is free again: show the ghost there straight away
  let histSize = 0;
  game.events.on('history:change', ({ size }) => {
    if (size < histSize) justBuilt = null;
    histSize = size;
  });

  // ---------- API ----------

  game.prefabs = {
    register,
    plan: planOf,
    list: () => [...registry.keys()],
    get building() { return !!job && !job.committed; },
    get clock() { return job && !job.committed ? job.t : 0; },
    /** Tests/screenshots: pin the build animation clock (seconds), or null to let it run. */
    holdClock: null,
    get ghost() {
      if (!ghost || !ghost.group.visible || !ghost.pl) return null;
      const pl = ghost.pl;
      return { key: ghost.key, placement: { x: pl.ox, y: pl.oy, z: pl.oz, rot: pl.rot, bounds: pl.bounds } };
    },
    lastResult: null,
    /** Placement for key at world column (x, z); opts { rot = 0, fromY }. */
    placementAt(key, x, z, opts = {}) {
      const plan = planOf(key);
      if (!plan || !game.world) return null;
      const fromY = opts.fromY ?? game.world.sy - 1;
      return placementAt(game, plan, x, z, fromY, opts.rot || 0);
    },
    /** Build key at world column (x, z). opts { rot, fromY, animate = false }. */
    place(key, x, z, opts = {}) {
      const plan = planOf(key);
      const pl = this.placementAt(key, x, z, opts);
      return build(plan, pl, { animate: !!opts.animate });
    },
    /** Finish a running build animation right away. */
    finish() {
      if (job) finishJob(job);
      return game.prefabs.lastResult;
    },
    footprint(key, x, z, rot = 0) {
      const plan = planOf(key);
      return plan ? footprintBounds(plan, x, z, rot) : null;
    },
    turn: turnHouse,
    buildHere,
  };
  game.debug.prefabs = game.prefabs;
}
