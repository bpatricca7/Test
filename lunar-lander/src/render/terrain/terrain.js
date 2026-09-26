// Lunar terrain renderer: spherical quadtree (cube-sphere) of chunks from orbit down to the footpads.
//
// Contract: createTerrain(ctx) -> { update(frame), isReady() }  (adds its objects to ctx.scene, layer WORLD)
//
// - Six root chunks (cube faces), split by camera distance (split when distance < K x chunk size) down to
//   ~0.65 m vertex spacing under the camera (quality 'high'). Parents stay drawn until all four children
//   are generated (no holes); children geomorph from the parent's shape (no popping); skirts hide cracks.
// - Chunks are generated in Web Workers (inline-worker import, works from file://), with a time-sliced
//   main-thread fallback if workers are unavailable. Uploads are budgeted per frame.
// - Vertices are float32 relative to each chunk's double-precision centre; meshes are positioned every
//   frame with the floating origin (ctx.origin). Frustum + horizon culling.
// - Material: lunar photometry + baked Sun-horizon shadows + procedural micro-craters (terrainMaterial.js).
// - Boulders: instanced rocks from the chunks that own them (rocks.js), exactly where they collide.

import * as THREE from 'three';
import { MOON, LAYERS } from '../../core/constants.js';
import { FACES, faceDir, dirToFaceST } from './cubeSphere.js';
import { chunkJob, chunkSizeM, BOULDER_LEVELS } from './chunkGen.js';
import { createLunarUniforms, createTerrainMaterial, updateBandOffsets } from './terrainMaterial.js';
import { createRocks } from './rocks.js';
import { createRockShadow } from './rockShadow.js';
import ChunkWorker from './chunk.worker.js?worker&inline';

const R = MOON.radius;
const H_MIN_GLOBAL = -11000; // below the deepest basin floor (horizon-culling occluder)
const IN_FLIGHT = 4; // jobs queued per worker

const QUALITY = {
  low: { N: 25, maxLevel: 16, K: 2.2, Kdeep: 1.8, workers: 1, bands: 2, uploads: 3, budget: 1000, limb: 1, rockShadow: 1024 },
  medium: { N: 33, maxLevel: 16, K: 2.8, Kdeep: 2.1, workers: 2, bands: 3, uploads: 4, budget: 1800, limb: 1.8, rockShadow: 2048 },
  high: { N: 33, maxLevel: 17, K: 3.6, Kdeep: 2.4, workers: 3, bands: 3, uploads: 6, budget: 3200, limb: 2.5, rockShadow: 2048 },
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const EMPTY = 0;
const QUEUED = 1;
const WORKING = 2;
const READY = 3;

// Shared index buffer (grid + skirt quads) for chunks of N x N vertices.
function buildIndex(N) {
  const idx = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = a + N;
      idx.push(a, b, c, a, c, d);
    }
  }
  // skirt: edge loop (bottom, right, top, left — counter-clockwise), skirt vertex = N*N + loop index
  const loop = [];
  for (let q = 0; q < N; q++) loop.push(q);
  for (let q = 0; q < N; q++) loop.push(q * N + (N - 1));
  for (let q = 0; q < N; q++) loop.push((N - 1) * N + (N - 1 - q));
  for (let q = 0; q < N; q++) loop.push((N - 1 - q) * N);
  for (let side = 0; side < 4; side++) {
    for (let q = 0; q < N - 1; q++) {
      const l0 = side * N + q;
      const l1 = l0 + 1;
      const ea = loop[l0];
      const eb = loop[l1];
      const sa = N * N + l0;
      const sb = N * N + l1;
      idx.push(ea, sb, eb, ea, sa, sb);
    }
  }
  const nV = N * N + 4 * N;
  return new THREE.BufferAttribute(nV > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
}

let nodeSerial = 0;

class Node {
  constructor(f, level, i, j, parent) {
    this.f = f;
    this.level = level;
    this.i = i;
    this.j = j;
    this.parent = parent;
    this.key = `${f}/${level}/${i}/${j}`;
    this.id = ++nodeSerial;
    this.state = EMPTY;
    this.children = null;
    this.mesh = null;
    this.size = chunkSizeM(level);
    const cw = 2 / (1 << level);
    this.s0 = -1 + i * cw;
    this.t0 = -1 + j * cw;
    this.cw = cw;
    // provisional bounds until generated
    const d = faceDir(f, this.s0 + cw / 2, this.t0 + cw / 2, [0, 0, 0]);
    const h = parent ? 0.5 * (parent.hmin + parent.hmax) : 0;
    this.center = new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(R + h);
    this.radius = this.size * 0.75 + (parent ? parent.hmax - parent.hmin : 12000);
    this.hmin = parent ? parent.hmin : -10000;
    this.hmax = parent ? parent.hmax : 10000;
    this.lastUsed = 0;
    this.lastUsedT = 0;
    this.prio = 0;
    this.boulders = null;
    this.dist = Infinity;
  }
}

/**
 * Create the terrain renderer.
 * @param {object} ctx RenderContext (see ARCHITECTURE.md)
 * @returns {{update(frame:object):void, isReady():boolean, stats():object}}
 */
export function createTerrain(ctx) {
  const Q = QUALITY[ctx.quality] || QUALITY.high;
  const N = Q.N;
  const maxLevel = Q.maxLevel;
  const K = Q.K;
  // Split factor per level: large chunks (seen from orbit) get the high factor for a fine silhouette;
  // near the ground the micro-crater shading covers sub-mesh detail, so deep levels split less eagerly.
  const kOf = (level) => (level <= 9 ? Q.K : level >= 12 ? Q.Kdeep : Q.K + ((Q.Kdeep - Q.K) * (level - 9)) / 3);
  const finestSpacing = chunkSizeM(maxLevel) / (N - 1);

  const lunar = createLunarUniforms(ctx);
  // boulder cast shadows (near cascade ~80 m across the Sun, far ~700 m)
  const rockShadow = createRockShadow(ctx, { size: Q.rockShadow, halves: [40, 350] });
  const material = createTerrainMaterial(ctx, lunar, { bands: Q.bands, meshK: 4.5 / (Q.Kdeep * (N - 1)), meshKFar: 4.5 / (Q.K * (N - 1)), minMeshD: 6 * finestSpacing, rockShadow });
  const group = new THREE.Group();
  group.name = 'terrain';
  group.matrixAutoUpdate = false; // stays at the render origin; children carry their own matrices
  ctx.scene.add(group);
  const rocks = createRocks(ctx, lunar, rockShadow);
  const index = buildIndex(N);

  const nodes = new Map();
  const roots = FACES.map((_, f) => {
    const n = new Node(f, 0, 0, 0, null);
    nodes.set(n.key, n);
    return n;
  });

  // ------------------------------------------------------------------ generation back-ends
  const pending = new Map(); // key -> node (wanted this frame, not yet dispatched)
  let inVisit = false;
  const results = []; // generated chunk data waiting for upload
  const sun = [ctx.sunDir.x, ctx.sunDir.y, ctx.sunDir.z];
  const workers = [];
  let fallback = null; // {node, it, t0} when running on the main thread
  let useFallback = false;
  const nWorkers = Math.max(1, Math.min(Q.workers, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4) - 1));
  try {
    for (let k = 0; k < nWorkers; k++) {
      const w = new ChunkWorker();
      const slot = { w, jobs: new Set(), dead: false };
      w.onmessage = (e) => {
        const r = e.data;
        slot.jobs.delete(r.key);
        if (r.error) {
          console.error('terrain worker:', r.error);
          const n = nodes.get(r.key);
          if (n) n.state = EMPTY;
          return;
        }
        results.push(r);
        speculate(r);
        dispatch();
      };
      w.onerror = (e) => {
        console.warn('terrain worker failed, using main-thread generation', e.message || e);
        for (const key of slot.jobs) {
          const n = nodes.get(key);
          if (n && n.state === WORKING) n.state = EMPTY;
        }
        slot.jobs.clear();
        slot.dead = true;
        if (workers.every((s) => s.dead)) useFallback = true;
        e.preventDefault?.();
      };
      workers.push(slot);
    }
  } catch (err) {
    console.warn('terrain: Web Workers unavailable, generating on the main thread', err);
    useFallback = true;
  }

  function request(node, prio) {
    if (node.state !== EMPTY && node.state !== QUEUED) return;
    const fresh = node.state === EMPTY || node.prio !== prio;
    node.state = QUEUED;
    node.prio = prio;
    pending.set(node.key, node);
    if (fresh && !inVisit) heapPush(node); // (during LOD selection the heap is rebuilt afterwards)
  }

  // A chunk just arrived: if the last camera would split it, request its children right away
  // (refinement then proceeds at worker speed instead of one level per rendered frame).
  function speculate(r) {
    const n = nodes.get(r.key);
    if (!n || n.level >= maxLevel || frameNo === 0) return;
    n.center.set(r.center[0], r.center[1], r.center[2]);
    n.radius = r.radius;
    n.hmin = r.hmin;
    n.hmax = r.hmax;
    const dist = nodeDistance(n);
    if (dist >= kOf(n.level) * n.size || !visible(n)) return;
    ensureChildren(n);
    for (const c of n.children) {
      c.lastUsed = frameNo;
      c.lastUsedT = performance.now();
      if (c.state === EMPTY) request(c, nodeDistance(c) / c.size - n.level * 0.01);
    }
  }

  function makeReq(node) {
    return {
      key: node.key,
      f: node.f,
      level: node.level,
      i: node.i,
      j: node.j,
      N,
      sun,
      maxLevel,
      boulders: BOULDER_LEVELS.includes(node.level),
    };
  }

  // Pending requests are served from a binary min-heap on `prio` (rebuilt once per frame from `pending`,
  // speculative requests pushed in between): a worker message only pops a few entries instead of
  // re-sorting the whole queue. Stale entries (already dispatched / dropped) are skipped when popped.
  let heap = [];
  function heapUp(a, i) {
    const n = a[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].prio <= n.prio) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = n;
  }
  function heapDown(a, i) {
    const len = a.length;
    const n = a[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= len) break;
      if (c + 1 < len && a[c + 1].prio < a[c].prio) c++;
      if (a[c].prio >= n.prio) break;
      a[i] = a[c];
      i = c;
    }
    a[i] = n;
  }
  function heapPush(n) {
    heap.push(n);
    heapUp(heap, heap.length - 1);
  }
  function heapPop() {
    while (heap.length) {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        heapDown(heap, 0);
      }
      if (pending.get(top.key) === top && top.state === QUEUED) return top;
    }
    return null;
  }
  function rebuildHeap() {
    heap = Array.from(pending.values());
    for (let i = (heap.length >> 1) - 1; i >= 0; i--) heapDown(heap, i);
  }

  function dispatch() {
    if (!pending.size) return;
    if (!useFallback) {
      // keep up to IN_FLIGHT jobs queued per worker so workers never idle between (slow) frames
      for (let round = 0; round < IN_FLIGHT; round++) {
        for (const slot of workers) {
          if (slot.dead || slot.jobs.size > round) continue;
          const node = heapPop();
          if (!node) return;
          pending.delete(node.key);
          node.state = WORKING;
          slot.jobs.add(node.key);
          slot.w.postMessage(makeReq(node));
        }
      }
    } else if (!fallback) {
      const node = heapPop();
      if (!node) return;
      pending.delete(node.key);
      node.state = WORKING;
      fallback = { node, it: chunkJob(makeReq(node)) };
    }
  }

  function stepFallback(budgetMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!fallback) {
        dispatch(); // next most urgent chunk
        if (!fallback) return;
      }
      const r = fallback.it.next();
      if (r.done) {
        results.push(r.value);
        fallback = null;
      }
    }
  }

  // ------------------------------------------------------------------ upload
  function freeArray() {
    this.array = null;
  }
  // Geomorph range depends only on the level: one material per level, all sharing the base material's
  // uniform OBJECTS (and its compiled program) except their own uMorphRange. No per-chunk uniform
  // uploads; the renderer sorts opaque objects by material, so chunks are drawn grouped by level.
  const levelMats = [];
  function materialForLevel(level) {
    let m = levelMats[level];
    if (m) return m;
    const kp = kOf(Math.max(0, level - 1));
    const size = chunkSizeM(level);
    // fully the parent's shape where the parent would merge back (distance 2 x its K x size)
    const range = level === 0 ? new THREE.Vector2(1e30, 2e30) : new THREE.Vector2(kp * size * 1.3, kp * size * 1.95);
    m = new THREE.ShaderMaterial({
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      extensions: material.extensions,
    });
    m.uniforms = Object.assign({}, material.uniforms, { uMorphRange: { value: range } });
    m.name = `${material.name}/L${level}`;
    levelMats[level] = m;
    return m;
  }

  function upload(r) {
    const node = nodes.get(r.key);
    if (!node || node.state !== WORKING) return false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    g.setAttribute('morph', new THREE.BufferAttribute(r.morph, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.nrm, 3, true));
    g.setAttribute('aux', new THREE.BufferAttribute(r.aux, 4));
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r.radius);
    // the GPU keeps the only copy of the vertex data we need (halves memory for large caches); after a
    // WebGL context loss every chunk is regenerated (see onContextRestored)
    for (const name of ['position', 'morph', 'normal', 'aux']) g.attributes[name].onUpload(freeArray);
    const mesh = new THREE.Mesh(g, materialForLevel(node.level));
    mesh.layers.set(LAYERS.WORLD);
    mesh.frustumCulled = true;
    // only drawn chunks are children of the group (see draw / update); their matrix is set in draw()
    mesh.matrixAutoUpdate = false;
    // near-ground chunks cast into the renderer's (tight, vessel-centred) sunlight shadow map, so a
    // spacecraft standing in a crater's shadow or next to a hill is shaded too (the shadow camera
    // culls everything outside its few-metre box, so this costs almost nothing)
    mesh.castShadow = node.level >= 12;
    mesh.name = node.key;
    mesh.userData.level = node.level;
    mesh.userData.drawnFrame = -1;
    node.mesh = mesh;
    node.center.set(r.center[0], r.center[1], r.center[2]);
    node.radius = r.radius;
    node.hmin = r.hmin;
    node.hmax = r.hmax;
    node.boulders = r.boulders;
    node.state = READY;
    return true;
  }

  function disposeNode(n) {
    if (n.children) for (const c of n.children) disposeNode(c);
    n.children = null;
    if (n.mesh) {
      group.remove(n.mesh);
      // the index buffer is shared by every chunk: detach it first so three.js does not delete the
      // GL buffer that all other chunks' vertex-array objects still reference
      n.mesh.geometry.index = null;
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
    pending.delete(n.key);
    nodes.delete(n.key);
    n.state = EMPTY;
  }

  // ------------------------------------------------------------------ WebGL context loss
  // Chunk vertex arrays are freed after their GPU upload, so after a context loss/restore (driver reset,
  // GPU switch, sleep/wake) three.js cannot re-upload them: drop every chunk and regenerate the quadtree.
  let contextRestored = false;
  let contextLost = false;
  const canvas = ctx.renderer && ctx.renderer.domElement;
  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('webglcontextlost', () => {
      contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      contextLost = false;
      contextRestored = true;
    });
  }
  function resetAll() {
    contextRestored = false;
    for (const r of roots) {
      if (r.children) for (const c of r.children) disposeNode(c);
      r.children = null;
      if (r.mesh) {
        group.remove(r.mesh);
        r.mesh.geometry.index = null;
        r.mesh.geometry.dispose();
        r.mesh = null;
      }
      if (r.state === READY) r.state = EMPTY;
    }
    // results already received but not uploaded still hold their arrays: keep them for the roots,
    // drop the rest (their nodes are gone); in-flight worker jobs for dropped nodes are ignored
    for (let q = results.length - 1; q >= 0; q--) {
      const n = nodes.get(results[q].key);
      if (!n || n.state !== WORKING) results.splice(q, 1);
    }
    for (const [k, n] of pending) if (!nodes.has(k) || n.state !== QUEUED) pending.delete(k);
    drawn = [];
    readyFrames = 0;
  }

  // ------------------------------------------------------------------ per-frame selection
  const frustum = new THREE.Frustum();
  const _pm = new THREE.Matrix4();
  const _sph = new THREE.Sphere();
  const _st = [0, 0];
  const _d = [0, 0, 0];
  const cam = new THREE.Vector3();
  let camR = R;
  let camH = 0;
  let horizonCam = 0;
  let limbRefine = false;
  let frameNo = 0;
  let drawn = [];
  let drawnNext = [];
  let pendingVisible = 0;
  let boulderChunks = [];
  let readyFrames = 0;
  // readiness fallback timer: starts at the first terrain frame (and again at every scenario load), not
  // at construction (boot and shader compilation can take tens of seconds on slow machines)
  let t0 = -1;
  ctx.game?.events?.on?.('scenario', () => {
    t0 = -1;
    readyFrames = 0;
  });
  const R_OCC = R + H_MIN_GLOBAL;

  function nodeDistance(n) {
    // closest point of the chunk's face rectangle to the camera (at the camera's height, clamped)
    if (dirToFaceST(n.f, cam.x, cam.y, cam.z, _st)) {
      const s = Math.min(n.s0 + n.cw, Math.max(n.s0, _st[0]));
      const t = Math.min(n.t0 + n.cw, Math.max(n.t0, _st[1]));
      faceDir(n.f, s, t, _d);
      const h = Math.min(n.hmax, Math.max(n.hmin, camH));
      const r = R + h;
      const dx = _d[0] * r - cam.x;
      const dy = _d[1] * r - cam.y;
      const dz = _d[2] * r - cam.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return Math.max(0, cam.distanceTo(n.center) - n.radius);
  }

  function visible(n) {
    // horizon culling against a sphere below the deepest terrain
    const dc = cam.distanceTo(n.center) - n.radius;
    const top = R + n.hmax;
    const ht = Math.sqrt(Math.max(0, top * top - R_OCC * R_OCC));
    if (dc > horizonCam + ht) return false;
    _sph.center.copy(n.center).sub(ctx.origin);
    _sph.radius = n.radius;
    return frustum.intersectsSphere(_sph);
  }

  function ensureChildren(n) {
    if (n.children) return;
    const L = n.level + 1;
    n.children = [];
    for (let q = 0; q < 4; q++) {
      const c = new Node(n.f, L, n.i * 2 + (q & 1), n.j * 2 + (q >> 1), n);
      nodes.set(c.key, c);
      n.children.push(c);
    }
  }

  function draw(n) {
    const m = n.mesh;
    m.position.copy(n.center).sub(ctx.origin);
    m.updateMatrix();
    if (m.parent !== group) group.add(m);
    m.userData.drawnFrame = frameNo;
    drawnNext.push(m);
  }

  function visit(n) {
    n.lastUsed = frameNo;
    n.lastUsedT = nowMs;
    const dist = nodeDistance(n);
    n.dist = dist;
    if (n.state !== READY) {
      request(n, dist / n.size - 10);
      pendingVisible++;
      return;
    }
    if (n.boulders && dist < 2500) boulderChunks.push(n);
    const vis = visible(n);
    const hyst = n.children && n.children.every((c) => c.state === READY) ? 1.12 : 1;
    let splitDist = kOf(n.level) * n.size * hyst;
    // silhouette refinement: from orbit, chunks seen at grazing incidence near the limb are split
    // further than their footprint suggests, so crater rims and massifs break the limb's arc
    if (limbRefine && vis && n.level <= 9) {
      const tx = n.center.x - cam.x;
      const ty = n.center.y - cam.y;
      const tz = n.center.z - cam.z;
      const cl = Math.sqrt(tx * tx + ty * ty + tz * tz) * n.center.length();
      const cosg = cl > 0 ? Math.abs(tx * n.center.x + ty * n.center.y + tz * n.center.z) / cl : 1;
      if (cosg < 0.3) splitDist *= 1 + Q.limb * (1 - smoothstep(0.08, 0.3, cosg));
    }
    if (n.level < maxLevel && dist < splitDist && (vis || dist < splitDist * 0.5)) {
      ensureChildren(n);
      let all = true;
      for (const c of n.children) {
        c.lastUsed = frameNo;
        c.lastUsedT = nowMs;
        if (c.state !== READY) {
          all = false;
          request(c, nodeDistance(c) / c.size + (vis ? 0 : 50) - n.level * 0.01);
        }
      }
      if (all) {
        for (const c of n.children) visit(c);
        return;
      }
      if (vis) pendingVisible++;
    }
    if (vis) draw(n);
  }

  function evict() {
    if (nodes.size < Q.budget) return;
    // unused for 90 frames (1.5 s at 60 fps); when far over budget, anything untouched for 3 frames and
    // 1.5 s of wall time (slow frames: software GL, background tab)
    const hard = nodes.size > Q.budget * 1.3;
    const old = frameNo - (hard ? 3 : 90);
    const oldT = nowMs - 1500;
    // nodes whose children all went unused: drop those children's whole subtrees, biggest first
    const cands = [];
    for (const n of nodes.values()) {
      if (!n.children) continue;
      let unused = true;
      for (const c of n.children) if (c.lastUsed >= old || (hard && c.lastUsedT >= oldT)) unused = false;
      if (unused) cands.push(n);
    }
    cands.sort((a, b) => a.level - b.level || a.lastUsed - b.lastUsed);
    for (const n of cands) {
      if (nodes.size < Q.budget * 0.8) break;
      if (!n.children || !nodes.has(n.key)) continue; // already removed with an ancestor's subtree
      for (const c of n.children) disposeNode(c); // in-flight results for them are simply dropped
      n.children = null;
    }
  }

  let lastUploadMs = 0;
  let lastWall = 0;
  let lastWallDt = 0;
  let lastUpdateMs = 0;
  let nowMs = 0;
  return {
    /** Per-frame update: LOD selection, generation dispatch, uploads, uniforms, rocks. */
    update(frame) {
      const tStart = performance.now();
      if (t0 < 0) t0 = tStart;
      frameNo++;
      if (contextRestored) resetAll();
      cam.copy(frame.cameraMCI);
      camR = cam.length();
      // approximate camera height above the reference sphere for LOD distances
      camH = camR - R;
      horizonCam = Math.sqrt(Math.max(0, camR * camR - R_OCC * R_OCC));
      limbRefine = camH > 15000;
      material.uniforms.uLimb.value = limbRefine ? Q.limb : 0;
      const camera = ctx.camera;
      _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(_pm);

      // uploads (budgeted). Slow frames (software GL, busy machine) can take more uploads without a
      // visible hitch; measure real wall-clock time (frame.dt is fixed in fixed-step test mode).
      const tu = performance.now();
      nowMs = tu;
      const wall = lastWall ? (tu - lastWall) / 1000 : 0;
      lastWall = tu;
      lastWallDt = wall;
      const slow = wall > 0.05;
      const verySlow = wall > 0.2; // nothing left to protect: drain the queue
      let n = 0;
      const maxUp = verySlow ? 1e9 : slow ? Q.uploads * 8 : Q.uploads;
      while (!contextLost && results.length && n < maxUp && performance.now() - tu < (verySlow ? 150 : slow ? 25 : 2.5)) {
        if (upload(results.shift())) n++;
      }
      lastUploadMs = performance.now() - tu;

      // selection
      drawnNext = [];
      pendingVisible = 0;
      boulderChunks = [];
      for (const [k, node] of pending) if (node.lastUsed < frameNo - 1) {
        pending.delete(k);
        if (node.state === QUEUED) node.state = EMPTY;
      }
      inVisit = true;
      for (const r of roots) visit(r);
      inVisit = false;
      // chunks drawn last frame but not this one leave the group (hidden chunks cost nothing per frame)
      for (const m of drawn) if (m.userData.drawnFrame !== frameNo && m.parent === group) group.remove(m);
      drawn = drawnNext;

      rebuildHeap();
      dispatch();
      // main-thread fallback: ~3 ms per frame in normal play (never a hitch); more while the initial
      // LOD loads or when frames are already very slow (software rendering)
      if (useFallback) stepFallback(verySlow ? 60 : readyFrames < 2 ? 8 : 3);
      if (frameNo % (lastWallDt > 0.1 ? 5 : 30) === 0) evict();

      // uniforms
      lunar.uCamMCI.value.copy(cam);
      lunar.uSunDir.value.copy(frame.sunDir);
      updateBandOffsets(material, cam);
      let bsig = boulderChunks.length;
      for (const c of boulderChunks) bsig = (Math.imul(bsig ^ c.id, 0x9e3779b1) + c.id) | 0;
      rocks.update(frame, boulderChunks, bsig);
      rockShadow.update(frame, rocks.anchor, rocks.count, rocks.version);

      const ready = roots.every((r) => r.state === READY) && pendingVisible === 0 && results.length === 0;
      readyFrames = ready ? readyFrames + 1 : 0;
      lastUpdateMs = performance.now() - tStart;
    },
    /** True once the LOD around the camera has been built (or after a generous timeout). */
    isReady() {
      if (readyFrames >= 2) return true;
      if (t0 < 0 || !roots.every((r) => r.state === READY)) return false;
      // fallback: generation cannot keep up (e.g. the camera keeps moving); give up waiting for the
      // last visible chunks once nothing is waiting for upload, or after a hard cap
      const el = performance.now() - t0;
      return (el > 45000 && results.length === 0) || el > 120000;
    },
    /** Debug handles (materials, rocks). */
    debug: { material, rocks, rockShadow, lunar, nodes },
    /** Debug statistics. */
    stats() {
      let working = 0;
      for (const s of workers) working += s.jobs.size;
      let ready = 0;
      let stale = 0;
      for (const n of nodes.values()) {
        if (n.state === READY) ready++;
        if (n.lastUsed < frameNo - 20) stale++;
      }
      return {
        nodes: nodes.size,
        ready,
        stale,
        drawn: drawn.length,
        pending: pending.size,
        working,
        results: results.length,
        pendingVisible,
        rocks: rocks.count,
        fallback: useFallback,
        maxDrawnLevel: drawn.reduce((m, x) => Math.max(m, x.userData.level), 0),
        lastUploadMs,
        lastUpdateMs,
      };
    },
  };
}
