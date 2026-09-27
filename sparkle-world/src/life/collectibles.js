// Gems: 20-30 sparkling faceted gems hidden around each world (5 pastel colors). They spin
// and bob with a soft glow, and are collected by walking (or flying) into them, or by tapping
// one within reach: chime + burst + counter. Placed at world.gemSpots (from worldgen) for new
// worlds, else scattered over the surface (seeded by the world). Saved per world (system
// 'collectibles'); sets world.gemTotal; emits 'gem:collect' { count, total } where count = gems
// found in this world and total = world.gemTotal (stickers.js counts profile.stats.gems).
// A gentle "gem radar": now and then the nearest gem sends up a faint sparkle beam.

import * as THREE from 'three';
import { mulberry32, hashString } from '../core/util.js';

export const GEM_COLORS = ['#FF6FB5', '#A77BFF', '#5CC8FF', '#3FE0B5', '#FFD04D'];
const MAX_GEMS = 40;
const GEM_SCALE = 0.3;

// ---------- a brilliant-cut gem ----------

function gemGeometry() {
  const n = 8;
  const ring = (r, y, off) => Array.from({ length: n }, (_, i) => {
    const t = ((i + off) / n) * Math.PI * 2;
    return [Math.cos(t) * r, y, Math.sin(t) * r];
  });
  const table = ring(0.52, 0.36, 0.5), g1 = ring(1, 0.08, 0), g2 = ring(1, -0.04, 0);
  const top = [0, 0.36, 0], culet = [0, -0.98, 0];
  const pts = [];
  const tri = (a, b, c) => {
    // wind every facet outward
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3 + 0.2, cz = (a[2] + b[2] + c[2]) / 3;
    if (nx * cx + ny * cy + nz * cz < 0) pts.push(...a, ...c, ...b);
    else pts.push(...a, ...b, ...c);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(top, table[i], table[j]);
    tri(table[i], g1[j], g1[i]);
    tri(table[i], table[j], g1[j]);
    tri(g1[i], g1[j], g2[j]);
    tri(g1[i], g2[j], g2[i]);
    tri(g2[i], g2[j], culet);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals(); // non-indexed: one flat normal per facet
  return g;
}

const gemVert = /* glsl */ `
attribute vec4 iPos;   // xyz, spin
attribute vec4 iData;  // scale, -, -, -
attribute vec3 iColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vFacet;
void main() {
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 p = position * iData.x;
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 n = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
  vFacet = fract(sin(dot(normal, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vColor = iColor;
  vec4 mv = viewMatrix * vec4(iPos.xyz + p, 1.0);
  vV = mv.xyz;
  vN = normalize(mat3(viewMatrix) * n);
  gl_Position = projectionMatrix * mv;
  if (iData.x <= 0.0001) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const gemFrag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uLight;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vFacet;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vV);
  vec3 L1 = normalize(vec3(0.5, 0.8, 0.55));
  vec3 L2 = normalize(vec3(-0.65, 0.25, 0.45));
  float dif = max(dot(n, L1), 0.0) * 0.5 + max(dot(n, L2), 0.0) * 0.22;
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, L1), 0.0), 30.0) + pow(max(dot(r, L2), 0.0), 44.0) * 0.6;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  // deep facets and bright facets side by side read as "cut gem"
  vec3 deep = vColor * vColor * 0.55;
  vec3 col = mix(deep, vColor * 1.08, clamp(0.15 + dif + vFacet * 0.45 - 0.2, 0.0, 1.0));
  col += vec3(spec) * 0.95 + mix(vColor, vec3(1.0), 0.5) * fres * 0.28;
  col *= mix(1.0, uLight, 0.35);
  float fog = smoothstep(uFogNear, uFogFar, length(vV));
  gl_FragColor = vec4(mix(min(col, vec3(1.0)), uFogColor, fog), 1.0);
}`;

const glowVert = /* glsl */ `
attribute vec4 gData; // alpha, size, -, -
attribute vec3 gColor;
uniform float uScale;
varying float vA;
varying vec3 vC;
void main() {
  vA = gData.x;
  vC = gColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(gData.y * uScale / max(0.1, -mv.z), 256.0);
  gl_Position = projectionMatrix * mv;
  if (vA < 0.01) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const glowFrag = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float halo = smoothstep(1.0, 0.0, r);
  float rays = max(0.0, 1.0 - abs(c.x) * 18.0) * smoothstep(0.5, 0.0, abs(c.y)) + max(0.0, 1.0 - abs(c.y) * 18.0) * smoothstep(0.5, 0.0, abs(c.x));
  float a = (halo * halo * 0.7 + rays * 0.35) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vC, vec3(1.0), 0.45) * a, a);
}`;

const beamVert = /* glsl */ `
uniform vec3 uBase;
uniform float uHeight;
varying vec2 vUv;
void main() {
  vUv = vec2(position.x + 0.5, position.y);
  vec3 toCam = cameraPosition - uBase;
  toCam.y = 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(0.0001))));
  vec3 p = uBase + right * position.x * 1.4 + vec3(0.0, position.y * uHeight, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float core = pow(across, 5.0);
  float up = pow(1.0 - vUv.y, 1.6);
  float ripple = 0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 6.0);
  float a = (across * across * 0.45 + core * 0.8) * up * ripple * uAlpha;
  if (a < 0.005) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * a, a);
}`;

function hexUnit(hex, out, o) {
  const n = parseInt(hex.slice(1), 16);
  out[o] = ((n >> 16) & 255) / 255; out[o + 1] = ((n >> 8) & 255) / 255; out[o + 2] = (n & 255) / 255;
}

// ---------- placement ----------

/** Fallback when worldgen gave no gemSpots: seeded surface spots spread over the land. */
function scatterSpots(game, world) {
  const seed = (world.meta.seed ?? hashString(world.meta.id || 'w')) ^ 0x6e3a7b1;
  const rand = mulberry32(seed);
  const count = world.sx > 160 ? 30 : 24;
  const minD2 = (world.sx > 160 ? 12 : 9) ** 2;
  const reg = game.registry.blocks, props = reg.props;
  const spawn = world.meta.spawn;
  const spots = [];
  for (let tries = 0; spots.length < count && tries < count * 80; tries++) {
    const x = 4 + Math.floor(rand() * (world.sx - 8)), z = 4 + Math.floor(rand() * (world.sz - 8));
    const top = world.surfaceAt(x, z);
    if (top < 1 || top >= world.sy - 2) continue;
    const id = world.get(x, top, z);
    const shape = props.shape[id];
    let y = top + 1;
    if (shape === 2) y = top; // among the flowers
    else if (shape === 5) {
      // over a pond (not the open sea)
      if (rand() > 0.3 || world.heightAt(x, z) < top - 3) continue;
    }
    const here = world.get(x, y, z);
    if (here !== 0 && !props.replaceable[here]) continue;
    if (spawn && (x + 0.5 - spawn[0]) ** 2 + (z + 0.5 - spawn[2]) ** 2 < 36) continue;
    if (spots.some((s) => (s[0] - x) ** 2 + (s[2] - z) ** 2 < minD2)) continue;
    spots.push([x, y, z]);
  }
  return spots;
}

// ---------- install ----------

export function install(game) {
  const scene = game.scene;
  const geo = new THREE.InstancedBufferGeometry().copy(gemGeometry());
  const iPos = new Float32Array(MAX_GEMS * 4), iData = new Float32Array(MAX_GEMS * 4), iColor = new Float32Array(MAX_GEMS * 3);
  const aPos = new THREE.InstancedBufferAttribute(iPos, 4).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.InstancedBufferAttribute(iData, 4).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(iColor, 3);
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iData', aData);
  geo.setAttribute('iColor', aColor);
  geo.instanceCount = 0;
  const gemU = {
    uFogColor: { value: new THREE.Color(0.8, 0.9, 1) }, uFogNear: { value: 60 }, uFogFar: { value: 160 }, uLight: { value: 1 },
  };
  const gemMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: gemU, vertexShader: gemVert, fragmentShader: gemFrag }));
  gemMesh.frustumCulled = false;
  gemMesh.name = 'gems';
  gemMesh.visible = false;

  const glowGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array(MAX_GEMS * 3), gData = new Float32Array(MAX_GEMS * 4), gColor = new Float32Array(MAX_GEMS * 3);
  const aGPos = new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage);
  const aGData = new THREE.BufferAttribute(gData, 4).setUsage(THREE.DynamicDrawUsage);
  const aGColor = new THREE.BufferAttribute(gColor, 3);
  glowGeo.setAttribute('position', aGPos);
  glowGeo.setAttribute('gData', aGData);
  glowGeo.setAttribute('gColor', aGColor);
  glowGeo.setDrawRange(0, 0);
  const glowU = { uScale: { value: 600 } };
  const glow = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
    uniforms: glowU, vertexShader: glowVert, fragmentShader: glowFrag, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  glow.frustumCulled = false;
  glow.renderOrder = 9;
  glow.visible = false;

  const beamU = { uBase: { value: new THREE.Vector3() }, uHeight: { value: 14 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } };
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
  beamGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    uniforms: beamU, vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  beam.frustumCulled = false;
  beam.renderOrder = 9;
  beam.visible = false;
  gemMesh.userData.envWarm = glow.userData.envWarm = beam.userData.envWarm = true;
  scene.add(gemMesh, glow, beam);

  let gems = []; // { x, y, z, c, got, anim (seconds since collected, -1 idle), ph, pickable }
  let clock = 0, radarIn = 5, beamT = -1, beamGem = null, glintAcc = 0, checkAcc = 0;
  const v3 = new THREE.Vector3();

  const found = () => gems.reduce((n, g) => n + (g.got ? 1 : 0), 0);

  const makePickable = (gem) => {
    const box = new THREE.Box3(new THREE.Vector3(gem.x + 0.18, gem.y + 0.1, gem.z + 0.18), new THREE.Vector3(gem.x + 0.82, gem.y + 0.95, gem.z + 0.82));
    const grab = () => { collect(gem); return true; };
    gem.pickable = { object3d: gemMesh, kind: 'other', ref: gem, box, onUse: grab, onBuild: grab, onRemove: grab, hint: () => 'Tap to grab the gem!' };
    game.pickables.add(gem.pickable);
  };

  const setGems = (list) => {
    for (const g of gems) if (g.pickable) game.pickables.delete(g.pickable);
    gems = list.slice(0, MAX_GEMS).map(([x, y, z, c, got], i) => ({ x, y, z, c: ((c | 0) % GEM_COLORS.length + GEM_COLORS.length) % GEM_COLORS.length, got: !!got, anim: -1, ph: i * 1.7, pickable: null }));
    gems.forEach((g, i) => {
      hexUnit(GEM_COLORS[g.c], iColor, i * 3);
      hexUnit(GEM_COLORS[g.c], gColor, i * 3);
      if (!g.got) makePickable(g);
    });
    aColor.needsUpdate = aGColor.needsUpdate = true;
    geo.instanceCount = gems.length;
    glowGeo.setDrawRange(0, gems.length);
    if (game.world) game.world.gemTotal = gems.length;
    gemMesh.visible = glow.visible = gems.length > 0;
  };

  const generate = (world) => {
    let spots = Array.isArray(world.gemSpots) && world.gemSpots.length ? world.gemSpots : scatterSpots(game, world);
    const rand = mulberry32((world.meta.seed ?? 7) ^ 0x2545f491);
    spots = spots.slice(0, 30);
    setGems(spots.map(([x, y, z]) => [x | 0, y | 0, z | 0, Math.floor(rand() * GEM_COLORS.length), 0]));
  };

  /** Keep a gem out of blocks (someone built where it floats): hop it up to air. */
  const unbury = (g) => {
    const w = game.world;
    let y = g.y;
    const props = game.registry.blocks.props;
    while (y < w.sy - 1) {
      const id = w.get(g.x, y, g.z);
      if (id === 0 || props.replaceable[id]) break;
      y++;
    }
    if (y !== g.y) {
      g.y = y;
      if (g.pickable) {
        game.pickables.delete(g.pickable);
        makePickable(g);
      }
    }
  };

  function collect(g) {
    if (g.got || !game.world) return;
    g.got = true;
    g.anim = 0;
    if (g.pickable) game.pickables.delete(g.pickable);
    g.pickable = null;
    if (beamGem === g) beamT = Math.max(beamT, 1.9);
    const count = found(), total = gems.length;
    game.audio.play('chime');
    game.audio.play('sparkle', { pitch: 1.25 });
    game.events.emit('gem:collect', { count, total, color: GEM_COLORS[g.c] });
    if (count >= total) {
      game.toast(`You found ALL ${total} gems!`, { icon: 'gem', big: true, color: 'mint' });
      game.audio.play('success');
      if (game.player) {
        const p = game.player.position;
        game.celebrate([p.x, p.y + 2, p.z], 'confetti', { quiet: true });
      }
    } else {
      // one toast that counts up (key) instead of a stack when she finds gems close together
      game.toast(`Gem ${count} of ${total}!`, { icon: 'gem', color: 'mint', key: 'gem-count' });
    }
  }

  game.events.on('block:place', ({ x, y, z }) => {
    for (const g of gems) if (!g.got && g.x === x && g.y === y && g.z === z) unbury(g);
  });

  game.gems = {
    colors: GEM_COLORS,
    list: () => gems.map((g) => ({ x: g.x, y: g.y, z: g.z, color: GEM_COLORS[g.c], found: g.got })),
    found,
    total: () => gems.length,
    /** Where the nearest gem is (for hints), or null. */
    nearest() {
      const n = nearest(48);
      return n ? { x: n.x, y: n.y, z: n.z, color: GEM_COLORS[n.c] } : null;
    },
    /** Send the sparkle beam up from the nearest gem now. */
    radar() { radarIn = 0; },
  };

  function nearest(maxD) {
    const p = game.player ? game.player.position : game.camera.position;
    let best = null, bd = maxD * maxD;
    for (const g of gems) {
      if (g.got) continue;
      const d = (g.x + 0.5 - p.x) ** 2 + (g.y - p.y) ** 2 * 0.3 + (g.z + 0.5 - p.z) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }

  game.addSystem({
    name: 'collectibles',
    onWorldLoad(world, save) {
      gemU.uFogColor = game.blockUniforms.uFogColor;
      gemU.uFogNear = game.blockUniforms.uFogNear;
      gemU.uFogFar = game.blockUniforms.uFogFar;
      gemMesh.material.uniforms = gemU;
      gemMesh.material.uniformsNeedUpdate = true;
      clock = 0; radarIn = 6; beamT = -1; beamGem = null;
      const saved = save && save.systems && save.systems.collectibles;
      if (!saved || !Array.isArray(saved.gems)) generate(world);
    },
    onWorldUnload() {
      setGems([]);
      beam.visible = false;
    },
    serialize() {
      return { v: 1, gems: gems.map((g) => [g.x, g.y, g.z, g.c, g.got ? 1 : 0]) };
    },
    deserialize(data) {
      if (!data || !Array.isArray(data.gems)) return;
      setGems(data.gems);
    },
    update(dt) {
      if (!game.world || !gems.length) return;
      clock += dt;
      const playing = game.mode === 'play';
      const p = game.player ? game.player.position : null;
      const tod = game.timeOfDay || { daylight: 1, night: 0 };
      gemU.uLight.value = 0.55 + 0.45 * tod.daylight;
      glowU.uScale.value = game.renderer.domElement.height / (2 * Math.tan((game.camera.fov * Math.PI) / 360));
      checkAcc += dt;
      const recheck = checkAcc > 1;
      if (recheck) checkAcc = 0;
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        const cx = g.x + 0.5, cz = g.z + 0.5;
        let cy = g.y + 0.5 + Math.sin(clock * 2.2 + g.ph) * 0.1;
        let scale = GEM_SCALE, spin = clock * 1.7 + g.ph, glowA = 0;
        if (g.got) {
          if (g.anim >= 0) {
            g.anim += dt;
            const t = g.anim / 0.55;
            if (t >= 1) {
              g.anim = -1;
              v3.set(cx, cy + 1.1, cz);
              if (game.particles) {
                game.particles.emit('gem', v3, { count: 14, colors: [GEM_COLORS[g.c], '#FFFFFF'] });
                game.particles.emit('sparkle', v3, { count: 12 });
                game.particles.emit('star', v3, { count: 5, color: GEM_COLORS[g.c] });
              }
              scale = 0;
            } else {
              cy += t * 1.1;
              spin += t * t * 18;
              scale = GEM_SCALE * (t < 0.4 ? 1 + t * 1.2 : 1.48 * (1 - (t - 0.4) / 0.6));
              glowA = 1 - t;
            }
          } else scale = 0;
        } else {
          if (recheck) unbury(g);
          glowA = (0.5 + 0.3 * Math.sin(clock * 3 + g.ph)) * (0.7 + 0.5 * tod.night);
          if (p && playing) {
            const dx = cx - p.x, dz = cz - p.z, dy = cy - (p.y + 0.9);
            if (Math.abs(dx) < 0.85 && Math.abs(dz) < 0.85 && Math.abs(dy) < 1.25) collect(g);
          }
        }
        iPos[i * 4] = cx; iPos[i * 4 + 1] = cy; iPos[i * 4 + 2] = cz; iPos[i * 4 + 3] = spin;
        iData[i * 4] = scale;
        gPos[i * 3] = cx; gPos[i * 3 + 1] = cy; gPos[i * 3 + 2] = cz;
        gData[i * 4] = glowA;
        gData[i * 4 + 1] = 1.7;
      }
      aPos.needsUpdate = aData.needsUpdate = aGPos.needsUpdate = aGData.needsUpdate = true;
      if (!playing || !p) return;

      // little glints on nearby gems
      glintAcc += dt;
      if (glintAcc > 0.35 && game.particles) {
        glintAcc = 0;
        const g = gems[Math.floor(Math.random() * gems.length)];
        if (!g.got && (g.x - p.x) ** 2 + (g.z - p.z) ** 2 < 22 * 22) {
          v3.set(g.x + 0.5 + (Math.random() - 0.5) * 0.6, g.y + 0.5 + Math.random() * 0.5, g.z + 0.5 + (Math.random() - 0.5) * 0.6);
          game.particles.emit('glint', v3, { count: 1, spread: 0, color: '#FFFFFF' });
        }
      }

      // gem radar: the nearest gem sends up a faint sparkle beam every so often
      if (beamT < 0 && !game.paused) {
        radarIn -= dt;
        if (radarIn <= 0) {
          radarIn = 9 + Math.random() * 5;
          const g = nearest(48);
          if (g && (g.x + 0.5 - p.x) ** 2 + (g.z + 0.5 - p.z) ** 2 > 16) {
            beamGem = g;
            beamT = 0;
            beamU.uBase.value.set(g.x + 0.5, g.y + 0.2, g.z + 0.5);
            const c = GEM_COLORS[g.c];
            const n = parseInt(c.slice(1), 16);
            beamU.uColor.value.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
          }
        }
      }
      if (beamT >= 0) {
        beamT += dt;
        const T = 2.9;
        const a = beamT < 0.5 ? beamT / 0.5 : beamT > T - 1 ? Math.max(0, (T - beamT) / 1) : 1;
        beamU.uAlpha.value = a * (0.6 + 0.3 * tod.night);
        beamU.uTime.value = clock;
        beam.visible = true;
        if (game.particles && beamGem && Math.random() < dt * 8) {
          v3.set(beamGem.x + 0.5 + (Math.random() - 0.5) * 0.5, beamGem.y + 0.6 + Math.random() * 3, beamGem.z + 0.5 + (Math.random() - 0.5) * 0.5);
          game.particles.emit('sparkle', v3, { count: 1, color: GEM_COLORS[beamGem.c], spread: 0, gravity: -2 });
        }
        if (beamT >= T) { beamT = -1; beam.visible = false; beamGem = null; }
      }
    },
  });
}
