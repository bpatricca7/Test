// Chunk mesher: turns a 16x64x16 column of voxels into three vertex buffers (opaque, cutout,
// translucent) with per-vertex ambient occlusion, face shading and smooth sky/block light.

import { SHAPES } from '../core/registry.js';
import { hash3 } from '../core/util.js';

// Face order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. Corners are unit-cube coords listed
// counter-clockwise seen from outside; uv (u, v) per corner.
const FACES = [
  { n: [1, 0, 0], axis: 0, t: [1, 2], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [-1, 0, 0], axis: 0, t: [1, 2], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [0, 1, 0], axis: 1, t: [0, 2], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]] },
  { n: [0, -1, 0], axis: 1, t: [0, 2], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, 1], axis: 2, t: [0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [0, 0, -1], axis: 2, t: [0, 1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
];

// Per face, per corner: offsets (relative to the cell in front of the face) of side1, side2, corner.
const AO_OFFSETS = FACES.map((f) =>
  f.c.map((corner) => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[f.t[0]] = corner[f.t[0]] ? 1 : -1;
    s2[f.t[1]] = corner[f.t[1]] ? 1 : -1;
    return [s1, s2, [s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]]];
  }),
);

const FACE_SHADE = [0.78, 0.78, 1.0, 0.6, 0.88, 0.88];
const AO_CURVE = [0.52, 0.7, 0.85, 1.0];
const LIQUID_TOP = 0.875;
const SLAB_H = 0.5;
const CARPET_H = 1 / 16;

/** Growable interleaved-by-attribute vertex storage, reused across chunk builds. */
class MeshBuffer {
  constructor() {
    this._alloc(4096);
  }
  _alloc(vcap) {
    const old = this.pos ? this : null;
    this.vcap = vcap;
    const pos = new Float32Array(vcap * 3), uv = new Float32Array(vcap * 2);
    const layer = new Uint16Array(vcap), shade = new Uint8Array(vcap), light = new Uint8Array(vcap * 2);
    const idx = new Uint32Array(vcap * 1.5);
    if (old) {
      pos.set(old.pos); uv.set(old.uv); layer.set(old.layer); shade.set(old.shade);
      light.set(old.light); idx.set(old.idx);
    }
    this.pos = pos; this.uv = uv; this.layer = layer; this.shade = shade; this.light = light; this.idx = idx;
    if (!old) { this.vc = 0; this.ic = 0; }
  }
  reset() {
    this.vc = 0;
    this.ic = 0;
  }
  reserve(nv) {
    if (this.vc + nv > this.vcap) this._alloc(this.vcap * 2);
  }
  vertex(x, y, z, u, v, layer, shade, sky, blk) {
    const i = this.vc++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.layer[i] = layer;
    this.shade[i] = shade;
    this.light[i * 2] = sky;
    this.light[i * 2 + 1] = blk;
  }
  /** Two triangles for the last four vertices; flip picks the other diagonal. */
  quad(flip) {
    const b = this.vc - 4;
    const ix = this.idx;
    let k = this.ic;
    if (!flip) {
      ix[k++] = b; ix[k++] = b + 1; ix[k++] = b + 2;
      ix[k++] = b; ix[k++] = b + 2; ix[k++] = b + 3;
    } else {
      ix[k++] = b + 1; ix[k++] = b + 2; ix[k++] = b + 3;
      ix[k++] = b + 1; ix[k++] = b + 3; ix[k++] = b;
    }
    this.ic = k;
  }
  /** Copy out compact arrays for a BufferGeometry, or null when empty. */
  take() {
    if (this.vc === 0) return null;
    const vc = this.vc, ic = this.ic;
    return {
      position: this.pos.slice(0, vc * 3),
      uv: this.uv.slice(0, vc * 2),
      layer: this.layer.slice(0, vc),
      shade: this.shade.slice(0, vc),
      light: this.light.slice(0, vc * 2),
      index: vc < 65536 ? Uint16Array.from(this.idx.subarray(0, ic)) : this.idx.slice(0, ic),
      vertexCount: vc,
    };
  }
}

export class Mesher {
  constructor(world) {
    this.world = world;
    this.buffers = [null, new MeshBuffer(), new MeshBuffer(), new MeshBuffer()]; // by pass
    this._ao = new Int32Array(4);
    this._sky = new Float32Array(4);
    this._blk = new Float32Array(4);
  }

  /** Mesh chunk (cx, cz). Returns { opaque, cutout, translucent, maxY } (null parts are empty). */
  build(cx, cz) {
    const w = this.world;
    const { sx, sy, sz } = w;
    const props = w.registry.props;
    const shapeOf = props.shape, passOf = props.pass, opaque = props.opaque, faceLayer = props.faceLayer;
    const blocks = w.blocks, skyArr = w.sky, blkArr = w.blockLight;
    const layerSize = sx * sz;
    for (let p = 1; p <= 3; p++) this.buffers[p].reset();

    const x0 = cx * 16, z0 = cz * 16;
    const x1 = Math.min(sx, x0 + 16), z1 = Math.min(sz, z0 + 16);

    // highest non-air voxel in this chunk, so we skip the empty sky above it
    let maxY = -1;
    for (let z = z0; z < z1 && maxY < sy - 1; z++) {
      for (let x = x0; x < x1; x++) {
        for (let y = sy - 1; y > maxY; y--) {
          if (blocks[(y * sz + z) * sx + x] !== 0) { maxY = y; break; }
        }
      }
    }

    // bounds-aware readers (world edges: air to the sides/above, solid below). Beyond the
    // sides of an ocean world the horizon ring's water continues, so water at the edge gets
    // no side wall facing out of the world.
    const out = w.outside;
    const outId = out && out.block ? w.registry.idOf(out.block) : -1;
    const seaId = outId > 0 && shapeOf[outId] === SHAPES.liquid ? outId : 0;
    const seaTop = seaId ? Math.floor(out.surface) : -1;
    const idAt = (x, y, z) => {
      if (y < 0) return w.floorId;
      if (y >= sy) return 0;
      if (x < 0 || z < 0 || x >= sx || z >= sz) return y <= seaTop ? seaId : 0;
      return blocks[(y * sz + z) * sx + x];
    };
    const occl = (x, y, z) => (opaque[idAt(x, y, z)] ? 1 : 0);

    const aoArr = this._ao, skyV = this._sky, blkV = this._blk;

    for (let y = 0; y <= maxY; y++) {
      for (let z = z0; z < z1; z++) {
        let i = (y * sz + z) * sx + x0;
        for (let x = x0; x < x1; x++, i++) {
          const id = blocks[i];
          if (id === 0) continue;
          const shape = shapeOf[id];
          const pass = passOf[id];
          const buf = this.buffers[pass];
          const lx = x - x0, lz = z - z0;

          if (shape === SHAPES.cross) {
            this._cross(buf, lx, y, lz, x, z, faceLayer[id * 6], skyArr[i], blkArr[i]);
            continue;
          }

          let height = 1;
          if (shape === SHAPES.slab) height = SLAB_H;
          else if (shape === SHAPES.carpet) height = CARPET_H;
          else if (shape === SHAPES.liquid && idAt(x, y + 1, z) !== id) height = LIQUID_TOP;
          const selfOpaque = opaque[id] === 1;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
            const nid = idAt(nx, ny, nz);
            // visibility: the top of short blocks is always visible; otherwise hide faces
            // behind opaque cubes and between neighbours of the same see-through block
            if (!(f === 2 && height < 1)) {
              if (opaque[nid]) continue;
              if (!selfOpaque && nid === id) continue;
            }

            // the cell whose light/AO this face sees (carpets and slabs: their own layer for the top)
            const ox = nx, oz = nz;
            const oy = f === 2 && shape === SHAPES.carpet ? y : ny;
            const baseSky = sampleLight(skyArr, ox, oy, oz, sx, sy, sz, 15);
            const baseBlk = sampleLight(blkArr, ox, oy, oz, sx, sy, sz, 0);

            const offs = AO_OFFSETS[f];
            for (let v = 0; v < 4; v++) {
              const o = offs[v];
              const s1 = occl(ox + o[0][0], oy + o[0][1], oz + o[0][2]);
              const s2 = occl(ox + o[1][0], oy + o[1][1], oz + o[1][2]);
              const c = s1 && s2 ? 1 : occl(ox + o[2][0], oy + o[2][1], oz + o[2][2]);
              aoArr[v] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
              // smooth light: average the open cells around this corner
              let sSum = baseSky, bSum = baseBlk, n = 1;
              if (!s1) {
                sSum += sampleLight(skyArr, ox + o[0][0], oy + o[0][1], oz + o[0][2], sx, sy, sz, 15);
                bSum += sampleLight(blkArr, ox + o[0][0], oy + o[0][1], oz + o[0][2], sx, sy, sz, 0);
                n++;
              }
              if (!s2) {
                sSum += sampleLight(skyArr, ox + o[1][0], oy + o[1][1], oz + o[1][2], sx, sy, sz, 15);
                bSum += sampleLight(blkArr, ox + o[1][0], oy + o[1][1], oz + o[1][2], sx, sy, sz, 0);
                n++;
              }
              if (!c && !(s1 && s2)) {
                sSum += sampleLight(skyArr, ox + o[2][0], oy + o[2][1], oz + o[2][2], sx, sy, sz, 15);
                bSum += sampleLight(blkArr, ox + o[2][0], oy + o[2][1], oz + o[2][2], sx, sy, sz, 0);
                n++;
              }
              skyV[v] = sSum / n;
              blkV[v] = bSum / n;
            }

            const layer = faceLayer[id * 6 + f];
            const fs = FACE_SHADE[f];
            buf.reserve(4);
            for (let v = 0; v < 4; v++) {
              const cc = face.c[v];
              const vy = cc[1] ? height : 0;
              const uvv = face.uv[v];
              // side faces of short blocks show the bottom part of the tile
              const tv = face.axis === 1 ? uvv[1] : uvv[1] * height;
              buf.vertex(
                lx + cc[0], y + vy, lz + cc[2],
                uvv[0], tv,
                layer,
                Math.round(fs * AO_CURVE[aoArr[v]] * 255),
                Math.round(skyV[v] * 17),
                Math.round(blkV[v] * 17),
              );
            }
            // anisotropy fix: split along the brighter diagonal so dark corners stay local
            buf.quad(aoArr[0] + aoArr[2] < aoArr[1] + aoArr[3]);
          }
        }
      }
    }

    return {
      opaque: this.buffers[1].take(),
      cutout: this.buffers[2].take(),
      translucent: this.buffers[3].take(),
      maxY,
    };
  }

  /** Flower/grass sprite: two diagonal quads, lightly jittered per position. */
  _cross(buf, lx, y, lz, wx, wz, layer, sky, blk) {
    const jx = (hash3(wx, 7, wz) - 0.5) * 0.3;
    const jz = (hash3(wx, 13, wz) - 0.5) * 0.3;
    const a = 0.15, b = 0.85;
    const s = sky * 17, bl = blk * 17;
    const top = 255, bottom = 190;
    buf.reserve(8);
    const x0 = lx + a + jx, x1 = lx + b + jx, z0 = lz + a + jz, z1 = lz + b + jz;
    buf.vertex(x0, y, z0, 0, 0, layer, bottom, s, bl);
    buf.vertex(x1, y, z1, 1, 0, layer, bottom, s, bl);
    buf.vertex(x1, y + 1, z1, 1, 1, layer, top, s, bl);
    buf.vertex(x0, y + 1, z0, 0, 1, layer, top, s, bl);
    buf.quad(false);
    buf.vertex(x0, y, z1, 0, 0, layer, bottom, s, bl);
    buf.vertex(x1, y, z0, 1, 0, layer, bottom, s, bl);
    buf.vertex(x1, y + 1, z0, 1, 1, layer, top, s, bl);
    buf.vertex(x0, y + 1, z1, 0, 1, layer, top, s, bl);
    buf.quad(false);
  }
}

/** Light value with world-edge rules: `outside` beyond the sides/top, dark below. */
function sampleLight(arr, x, y, z, sx, sy, sz, outside) {
  if (y >= sy) return outside;
  if (y < 0) return 0;
  if (x < 0 || z < 0 || x >= sx || z >= sz) return outside;
  return arr[(y * sz + z) * sx + x];
}
