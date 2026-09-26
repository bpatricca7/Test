// Chunk meshes for the whole world: rebuilds dirty chunks nearest to the camera first within
// a per-frame time budget, sorts translucent chunk meshes back-to-front, and draws a large
// "horizon" plane (ocean or grass) around the world so its edge disappears into the fog.

import * as THREE from 'three';
import { Mesher } from './mesher.js';
import { CHUNK } from './world.js';

const PASS_NAMES = [null, 'opaque', 'cutout', 'translucent'];

export class ChunkRenderer {
  constructor(world, materials) {
    this.world = world;
    this.materials = materials;
    this.group = new THREE.Group();
    this.group.name = 'chunks';
    this.mesher = new Mesher(world);
    this.chunks = [];
    for (let cz = 0; cz < world.czCount; cz++) {
      for (let cx = 0; cx < world.cxCount; cx++) {
        this.chunks.push({ cx, cz, meshes: [null, null, null, null] });
      }
    }
    this.lastBuildMs = 0;
    this._camX = 0;
    this._camZ = 0;
    this.horizon = null;
    this.buildHorizon();
  }

  /** Number of chunks still waiting to be (re)meshed. */
  get pending() {
    return this.world.dirtyCount;
  }

  /**
   * Rebuild dirty chunks, nearest to (camX, camZ) first, until budgetMs is used up.
   * Always builds at least one chunk when any are dirty so progress never stalls.
   */
  update(budgetMs, camX, camZ) {
    this._camX = camX;
    this._camZ = camZ;
    const w = this.world;
    if (w.dirtyCount > 0) {
      const start = performance.now();
      do {
        let best = -1, bestD = Infinity;
        for (let k = 0; k < w.dirty.length; k++) {
          if (!w.dirty[k]) continue;
          const c = this.chunks[k];
          const dx = c.cx * CHUNK + 8 - camX, dz = c.cz * CHUNK + 8 - camZ;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = k; }
        }
        if (best < 0) { w.dirtyCount = 0; break; }
        w.dirty[best] = 0;
        w.dirtyCount--;
        this.rebuild(this.chunks[best]);
      } while (w.dirtyCount > 0 && performance.now() - start < budgetMs);
      this.lastBuildMs = performance.now() - start;
    }
    this.sortTranslucent();
  }

  rebuild(chunk) {
    const data = this.mesher.build(chunk.cx, chunk.cz);
    const maxY = Math.max(0, data.maxY + 1);
    for (let p = 1; p <= 3; p++) {
      const part = data[PASS_NAMES[p]];
      let mesh = chunk.meshes[p];
      if (!part) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          chunk.meshes[p] = null;
        }
        continue;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
      geo.setAttribute('layer', new THREE.BufferAttribute(part.layer, 1));
      geo.setAttribute('shade', new THREE.BufferAttribute(part.shade, 1, true));
      geo.setAttribute('light', new THREE.BufferAttribute(part.light, 2, true));
      geo.setIndex(new THREE.BufferAttribute(part.index, 1));
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(CHUNK, maxY + 1, CHUNK));
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(CHUNK / 2, (maxY + 1) / 2, CHUNK / 2),
        Math.sqrt(2 * (CHUNK / 2) ** 2 + ((maxY + 1) / 2) ** 2) + 1,
      );
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geo;
      } else {
        mesh = new THREE.Mesh(geo, this.materials[PASS_NAMES[p]]);
        mesh.name = `chunk-${chunk.cx}-${chunk.cz}-${PASS_NAMES[p]}`;
        mesh.position.set(chunk.cx * CHUNK, 0, chunk.cz * CHUNK);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        chunk.meshes[p] = mesh;
        this.group.add(mesh);
      }
    }
  }

  /** Back-to-front order for blended chunk meshes (renderOrder beats three's own z sort). */
  sortTranslucent() {
    for (const c of this.chunks) {
      const m = c.meshes[3];
      if (!m) continue;
      const dx = c.cx * CHUNK + 8 - this._camX, dz = c.cz * CHUNK + 8 - this._camZ;
      m.renderOrder = -Math.round(Math.sqrt(dx * dx + dz * dz) * 4);
    }
  }

  /** Flat textured ring around the world (ocean for island biomes, grass for flat land). */
  buildHorizon() {
    const w = this.world;
    const out = w.outside;
    if (!out || !out.block) return;
    const def = w.registry.byKey(out.block);
    if (!def) return;
    const layer = w.registry.props.faceLayer[def.id * 6 + 2];
    const y = out.surface;
    const R = 420;
    const X0 = -R, Z0 = -R, X1 = w.sx + R, Z1 = w.sz + R;
    const rects = [
      [X0, Z0, X1, 0], [X0, w.sz, X1, Z1], // south / north strips
      [X0, 0, 0, w.sz], [w.sx, 0, X1, w.sz], // west / east strips
    ];
    const pos = [], uv = [], lay = [], shade = [], light = [], idx = [];
    for (const [a, b, c, d] of rects) {
      const base = pos.length / 3;
      const corners = [[a, b], [a, d], [c, d], [c, b]];
      for (const [x, z] of corners) {
        pos.push(x, y, z);
        uv.push(x, -z);
        lay.push(layer);
        shade.push(255);
        light.push(255, 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('layer', new THREE.BufferAttribute(new Uint16Array(lay), 1));
    geo.setAttribute('shade', new THREE.BufferAttribute(new Uint8Array(shade), 1, true));
    geo.setAttribute('light', new THREE.BufferAttribute(new Uint8Array(light), 2, true));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.materials.opaque);
    mesh.name = 'horizon';
    mesh.frustumCulled = false;
    this.horizon = mesh;
    this.group.add(mesh);
  }

  dispose() {
    for (const c of this.chunks) {
      for (let p = 1; p <= 3; p++) {
        if (c.meshes[p]) c.meshes[p].geometry.dispose();
        c.meshes[p] = null;
      }
    }
    if (this.horizon) this.horizon.geometry.dispose();
    this.group.clear();
  }
}
