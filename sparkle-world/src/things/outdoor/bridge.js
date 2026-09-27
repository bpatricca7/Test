// Rope bridges and tree platforms: smart placement for both, and the bookkeeping that keeps
// them tidy.
//  - Rope Bridge: tap a platform (or a block top) facing across a gap: the bridge stretches
//    from that edge to the next platform / block top at the same height (up to 20 blocks).
//    Every cell is a 'rope_bridge' segment entity { i, n, b } (so cells, colliders, saving
//    and undo all come from the entity system); segment 0 draws the whole swaying bridge.
//    Placing, removing (Remove tool on any part) and Undo take the whole bridge at once.
//  - Tree Platform: tapped on the side of a trunk (any solid block) it braces against it;
//    tapped on the ground it stands on stilts 3 blocks up. Both get a rope ladder down.
//  - Platform railings open where a bridge or the ladder meets them (data.open, derived).

import * as THREE from 'three';
import { toLocal, dirToWorld } from './ladders.js';
import { SHAPES } from '../../core/registry.js';

export const BRIDGE_MAX = 20;

/** Railing bit of a platform edge cell (see treePlatform in models-tree.js). */
export function edgeBit(side, cx, cz) {
  switch (side) {
    case 0: return cx;
    case 1: return 3 + (2 - cz);
    case 2: return 6 + (2 - cx);
    default: return 9 + cz;
  }
}

export class Bridges {
  constructor(game, sfx) {
    this.game = game;
    this.E = game.entities;
    this.sfx = sfx;
    this.dirty = false;
    this.bounce = 0;
    this._l = { x: 0, z: 0, tmp: new THREE.Vector3() };
    this._d = { x: 0, z: 0 };
  }

  // ---------- cell tests ----------

  _free(x, y, z) {
    const w = this.game.world;
    if (!w.inBounds(x, y, z)) return false;
    const id = w.get(x, y, z);
    const props = this.game.registry.blocks.props;
    if (id !== 0 && !props.replaceable[id]) return false;
    const e = this.E.at(x, y, z);
    return !e || !!e.def.flat;
  }

  /** Something she can walk on whose top is at height L, over cell (x, L - 1, z). */
  _solidTop(x, L, z) {
    const w = this.game.world;
    const y = L - 1;
    if (!w.inBounds(x, y, z)) return false;
    const e = this.E.at(x, y, z);
    if (e) return e.key === 'tree_platform';
    const id = w.get(x, y, z);
    const props = this.game.registry.blocks.props;
    return id !== 0 && props.solid[id] === 1 && props.shape[id] === SHAPES.cube && !props.replaceable[id];
  }

  _floor(x, L, z) {
    return this._solidTop(x, L, z) && this._free(x, L, z);
  }

  _gap(x, L, z) {
    return !this._solidTop(x, L, z) && this._free(x, L - 1, z) && this._free(x, L, z) && this._free(x, L + 1, z);
  }

  /** Walk from floor cell (x, z) along (dx, dz): to its edge, across the gap, to the far floor. */
  _scan(x, z, L, dx, dz) {
    if (!this._floor(x, L, z)) return { fail: 'edge' };
    let k = 1;
    while (k <= 6 && this._floor(x + dx * k, L, z + dz * k)) k++;
    if (!this._gap(x + dx * k, L, z + dz * k)) return { fail: 'edge' };
    const start = k;
    while (k - start <= BRIDGE_MAX && this._gap(x + dx * k, L, z + dz * k)) k++;
    const n = k - start;
    if (n > BRIDGE_MAX) return { fail: 'far' };
    if (!this._floor(x + dx * k, L, z + dz * k)) return { fail: 'land' };
    return { x0: x + dx * start, z0: z + dz * start, n, L, dx, dz };
  }

  /** Plan a bridge from a Build-tool pick. */
  plan(hit) {
    const g = this.game;
    if (!hit || !g.world) return { fail: 'edge' };
    const props = g.registry.blocks.props;
    const yaw = g.cameraRig ? g.cameraRig.yaw : g.player ? g.player.yaw : 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let D = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    let L, x, z;
    if (hit.type === 'block') {
      if (hit.face[1] === 1) {
        L = hit.y + 1;
        x = hit.x;
        z = hit.z;
        if (props.replaceable[hit.id]) L = hit.y;
      } else if (hit.face[1] === 0) {
        L = hit.y + 1;
        x = hit.x;
        z = hit.z;
        D = [hit.face[0], hit.face[2]];
      } else return { fail: 'edge' };
    } else if (hit.type === 'pickable' && hit.pickable && hit.pickable.kind === 'entity') {
      const e = hit.pickable.ref;
      if (e.key === 'rope_bridge') return { fail: 'bridge' };
      if (e.key !== 'tree_platform') return { fail: 'edge' };
      L = e.y + 1;
      let best = null, bd = Infinity;
      for (const [cx, , cz] of e.cells) {
        const d = Math.abs(cx + 0.5 - hit.point.x) + Math.abs(cz + 0.5 - hit.point.z);
        if (d < bd) { bd = d; best = [cx, cz]; }
      }
      [x, z] = best;
      if (hit.face[1] === 0 && (hit.face[0] || hit.face[2])) D = [hit.face[0], hit.face[2]];
    } else return { fail: 'edge' };
    const a = this._scan(x, z, L, D[0], D[1]);
    if (!a.fail) return a;
    const b = this._scan(x, z, L, -D[0], -D[1]);
    if (!b.fail) return b;
    return a.fail === 'edge' ? b : a;
  }

  /** Build tool with the Rope Bridge: plan and place every segment as one Undo. */
  build(hit, color) {
    const g = this.game, E = this.E;
    const plan = this.plan(hit);
    if (plan.fail) {
      const msg = {
        edge: 'Stand at the edge of a platform and tap across the gap!',
        land: 'Build a platform on the other side first!',
        far: 'That gap is too wide! Bridges reach 20 blocks.',
        bridge: "That's a rope bridge already!",
      }[plan.fail];
      g.toast(msg, { icon: 'build', key: 'bridge-tip' });
      return false;
    }
    const { x0, z0, n, L, dx, dz } = plan;
    const rot = dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 0 : 2;
    const def = E.defs.get('rope_bridge');
    for (let i = 0; i < n; i++) {
      if (!E.canPlace(def, x0 + dx * i, L - 1, z0 + dz * i, rot)) {
        g.toast('Something is in the way of the bridge!', { icon: 'build', key: 'bridge-tip' });
        return false;
      }
    }
    const b = `${x0},${L},${z0},${rot}`;
    let first = null;
    g.historyGroup(() => {
      for (let i = 0; i < n; i++) {
        const e = E.place('rope_bridge', x0 + dx * i, L - 1, z0 + dz * i, rot, color, { i, n, b }, { fx: i === 0 || i === n - 1 });
        if (i === 0) first = e;
      }
    });
    if (!first) return false;
    this.sfx.creak(1);
    setTimeout(() => this.sfx.creak(1.2), 180);
    if (g.particles) {
      for (let i = 0; i <= n; i += 2) g.particles.emit('sparkle', [x0 + dx * i + 0.5, L + 0.3, z0 + dz * i + 0.5], { count: 5 });
    }
    const stats = g.profile.stats || (g.profile.stats = {});
    if (!stats.bridgesBuilt) g.toast('A wobbly rope bridge! Walk across!', { icon: 'star', color: 'mint' });
    stats.bridgesBuilt = (stats.bridgesBuilt || 0) + 1;
    return true;
  }

  segmentsOf(e) {
    const out = [];
    for (const o of this.E.map.values()) if (o.key === 'rope_bridge' && o.data.b === e.data.b) out.push(o);
    return out;
  }

  /** Remove tool on any part: the whole bridge goes (one Undo brings it back). */
  removeWhole(e) {
    const g = this.game;
    const segs = this.segmentsOf(e);
    if (!segs.length) return false;
    g.historyGroup(() => {
      for (const s of segs) this.E.remove(s, { history: true, fx: s === e });
    });
    return true;
  }

  /** Our segments remove and rebuild as one bridge: patch their pickables. */
  patch(e) {
    const pk = e.pickable;
    if (!pk || pk._outdoor) return;
    pk._outdoor = true;
    pk.onRemove = () => this.removeWhole(e);
    const hint = pk.hint;
    pk.hint = (g, hit) => {
      if (g.selectedTool === 'build') {
        const item = g.selectedItem();
        if (item && item.key === 'furn:rope_bridge') return null; // no "Tap to turn it"
      }
      return hint ? hint(g, hit) : null;
    };
    const onBuild = pk.onBuild;
    pk.onBuild = (g, hit, item, opts) => {
      if (item && item.key === 'furn:rope_bridge') {
        g.toast("That's a rope bridge already! Tap across another gap.", { icon: 'build', key: 'bridge-tip' });
        return true;
      }
      return onBuild ? onBuild(g, hit, item, opts) : false;
    };
  }

  // ---------- tree platforms ----------

  /** Build tool with the Tree Platform: on a trunk side (braced) or on the ground (stilts). */
  placePlatform(hit, color) {
    const g = this.game, E = this.E, w = g.world;
    if (!hit || !w) return false;
    const def = E.defs.get('tree_platform');
    const props = g.registry.blocks.props;
    const tryPlace = (x, y, z, rots, data) => {
      for (const r of rots) {
        if (E.canPlace(def, x, y, z, r)) return E.place('tree_platform', x, y, z, r, color, data);
      }
      return null;
    };
    let e = null;
    if (hit.type === 'block' && hit.face[1] === 0 && !props.replaceable[hit.id]) {
      // braced against a trunk: back row against the block, deck top level with its top
      const nx = hit.face[0], nz = hit.face[2];
      const rot = nz === 1 ? 0 : nx === 1 ? 1 : nz === -1 ? 2 : 3;
      const ax = hit.x + nx * 3, az = hit.z + nz * 3, y = hit.y;
      const ladder = this._drop(ax + nx, y, az + nz, y + 1);
      e = tryPlace(ax, y, az, [rot], { legs: 0, ladder, open: ladder > 0.3 ? 2 : 0 });
    } else if (hit.type === 'block' && hit.place) {
      // on stilts, three blocks up, facing her (the ladder comes down on her side)
      let [x, y0, z] = hit.place;
      if (props.replaceable[hit.id]) [x, y0, z] = [hit.x, hit.y, hit.z];
      const p = g.player ? g.player.position : g.camera.position;
      const ddx = p.x - (x + 0.5), ddz = p.z - (z + 0.5);
      const rot = Math.abs(ddx) > Math.abs(ddz) ? (ddx > 0 ? 1 : 3) : ddz > 0 ? 0 : 2;
      const rots = [rot, (rot + 1) % 4, (rot + 3) % 4, (rot + 2) % 4];
      for (const up of [2, 1, 0]) {
        const y = y0 + up;
        const legs = y + 0.8 - y0;
        e = tryPlace(x, y, z, rots, { legs, ladder: up ? y + 1 - y0 : 0, open: up ? 2 : 0 });
        if (e) break;
      }
    } else {
      return !!E.placeFromHit('tree_platform', hit, color);
    }
    if (!e) {
      g.toast('No room there!');
      return false;
    }
    const stats = g.profile.stats || (g.profile.stats = {});
    if (!stats.platformsBuilt) g.toast('A tree platform! Climb up the rope ladder!', { icon: 'star', color: 'mint' });
    stats.platformsBuilt = (stats.platformsBuilt || 0) + 1;
    return true;
  }

  /** Blocks from deck top `top` down to the ground under (x, z), for the rope ladder. */
  _drop(x, y, z, top) {
    const w = this.game.world;
    const props = this.game.registry.blocks.props;
    for (let yy = y - 1; yy >= Math.max(0, y - 14); yy--) {
      const id = w.inBounds(x, yy, z) ? w.get(x, yy, z) : 0;
      if (id && props.solid[id]) return Math.max(0, top - (yy + 1));
    }
    return Math.min(14, top);
  }

  /** Open each platform's railing where a bridge end or its ladder meets it. */
  refreshOpenings() {
    this.dirty = false;
    const E = this.E;
    const want = new Map();
    for (const e of E.map.values()) if (e.key === 'tree_platform') want.set(e, (+e.data.ladder || 0) > 0.3 ? 2 : 0);
    if (!want.size) return;
    const l = this._l;
    for (const s of E.map.values()) {
      if (s.key !== 'rope_bridge') continue;
      const i = s.data.i | 0, n = s.data.n | 0;
      const d = dirToWorld(s, 0, 1, this._d); // bridge direction (increasing i)
      const ends = [];
      if (i === 0) ends.push([s.x - d.x, s.z - d.z, d.x, d.z]);
      if (i === n - 1) ends.push([s.x + d.x, s.z + d.z, -d.x, -d.z]);
      for (const [cx, cz, tx, tz] of ends) {
        const p = E.at(cx, s.y, cz);
        if (!p || p.key !== 'tree_platform' || !want.has(p)) continue;
        const loc = toLocal(E, p, cx + 0.5, cz + 0.5, l);
        const lx = Math.floor(loc.x), lz = Math.floor(loc.z);
        // the platform-local side that faces the bridge
        const lt = toLocalDir(p, tx, tz);
        const side = lt[1] > 0.5 ? 0 : lt[0] > 0.5 ? 1 : lt[1] < -0.5 ? 2 : 3;
        want.set(p, want.get(p) | (1 << edgeBit(side, lx, lz)));
      }
    }
    for (const [p, open] of want) if ((p.data.open | 0) !== open) E.setData(p, { open });
  }
}

/** World direction -> model-local direction of entity e ([x, z]). */
function toLocalDir(e, dx, dz) {
  switch (e.rot & 3) {
    case 1: return [-dz, dx];
    case 2: return [-dx, -dz];
    case 3: return [dz, -dx];
    default: return [dx, dz];
  }
}
