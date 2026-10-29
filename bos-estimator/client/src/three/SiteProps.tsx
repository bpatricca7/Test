// Site props (UI spec §9.6): roads as 3 instanced meshes (asphalt, curbs, centre lines), lots as one instanced
// slab, trees as one trunk + one crown mesh (road, lot and zone trees merged), street lights as poles + heads.
// Everything is rebuilt only when the layout identity changes.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import type { Box2, SiteLayout } from './layout';
import { mat, seeded, sitePalette, std, surfaceMat } from './assets';
import { clock } from './clock';
import { nightFactor } from './Lighting';

const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const s0 = new THREE.Vector3();
const noRaycast = () => {};

function fixedSphere(mesh: THREE.InstancedMesh, layout: SiteLayout) {
  const b = layout.bounds;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(b.x, 2, b.z), Math.hypot(b.w, b.d) / 2 + 40);
}

function build(geo: THREE.BufferGeometry, material: THREE.Material, boxes: { x: number; y: number; z: number; w: number; h: number; d: number }[], layout: SiteLayout, name: string) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, boxes.length));
  boxes.forEach((b, i) => { m4.compose(v0.set(b.x, b.y, b.z), q0, s0.set(b.w, b.h, b.d)); mesh.setMatrixAt(i, m4); });
  mesh.count = boxes.length; mesh.name = name; mesh.raycast = noRaycast;
  fixedSphere(mesh, layout);
  return mesh;
}

function lotMaterial(fast: boolean) {
  // obsidian: lots are concrete plinths on the board, ringed by a lighter hairline that stays >= 1 px at any distance
  return surfaceMat('lot', fast, { color: '#222222', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, (sh) => {
    sh.uniforms.uLotEdge = lotEdge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld; varying vec2 vLotP; varying vec2 vLotS; varying vec4 vBld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLotP = position.xz + 0.5; vLotS = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)); vBld = aBld;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLotEdge; varying vec2 vLotP; varying vec2 vLotS; varying vec4 vBld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 dw = min(vLotP, 1.0 - vLotP) * vLotS; float dm = min(dw.x, dw.y);
          float e = max(1.0 - smoothstep(0.32, 0.42, dm), 1.0 - smoothstep(0.4, 1.3, dm / max(fwidth(dm), 1e-4)));
          diffuseColor.rgb = mix(diffuseColor.rgb, uLotEdge, e);
          vec2 p = (vLotP - 0.5) * vLotS - vBld.xy; vec2 q = max(abs(p) - vBld.zw, 0.0);
          float ao = 1.0 - smoothstep(0.0, 1.5, length(q)); diffuseColor.rgb *= 1.0 - ao * 0.38; }`);
  }, 'lot-edge');
}
const lotEdge = { value: new THREE.Color('#3e3e3e') };
const roadMaterial = (fast: boolean) => surfaceMat('road', fast, { color: '#2e2e2e', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** world size of the kerb (curb + gutter) and its minimum on screen, device px */
const kerbU = { uKerbW: { value: 0.3 }, uKerbPx: { value: 1.35 }, uViewH: { value: 900 }, uKerbGlow: { value: new THREE.Color(0, 0, 0) } };
/**
 * Road casing: every road quad again, grown by the kerb width (never thinner than ~1.3 px on screen) and kept under
 * the asphalt by its polygon offset. Each road gets a light kerb line on both sides and at its ends, and where roads
 * cross the asphalt covers the other road's casing, so junctions stay clean. Unlit: its colour is final (the site
 * palette), plus a sodium glow after dark, so the street network still reads at night.
 */
const kerbMaterial = () => mat('road-kerb', () => {
  // writes depth (the open ground is drawn after it); its offset sits between the lots (-1) and the asphalt (-2), so
  // the asphalt always wins over a casing and a casing over a lot it overlaps
  const m = new THREE.MeshBasicMaterial({ color: '#6c6c6c', polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, kerbU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uKerbW; uniform float uKerbPx; uniform float uViewH;')
      .replace('#include <project_vertex>', `
        vec4 kw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec4 kv = viewMatrix * kw;
        float kd = isPerspectiveMatrix(projectionMatrix) ? -kv.z : 1.0;
        float kpx = 2.0 * kd / (projectionMatrix[1][1] * uViewH);   // world size of one pixel here
        kw.xz += sign(position.xz) * max(uKerbW, uKerbPx * kpx);
        vec4 mvPosition = viewMatrix * kw;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uKerbGlow;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.rgb += uKerbGlow;');
  };
  m.customProgramCacheKey = () => 'road-kerb-casing';
  return m;
});
export function SiteProps() {
  const { layout } = useDerived();
  const lighting = useStore((s) => s.lighting ?? 'review');
  const fast = useStore((s) => s.quality) !== 'high';
  const invalidate = useThree((s) => s.invalidate);
  const review = lighting !== 'live';

  const meshes = useMemo(() => {
    if (!layout || (layout.buildings.length === 0 && layout.zones.length === 0)) return null; // empty project: bare ground
    const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
    const box = new THREE.BoxGeometry(1, 1, 1);
    // ---- roads
    const asphalt: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [];
    const curbs: typeof asphalt = [];
    const lines: typeof asphalt = [];
    for (const r of layout.roads) {
      const horiz = r.w > r.d;
      asphalt.push({ x: r.x, y: 0.06, z: r.z, w: r.w, h: 1, d: r.d });
      for (const s of [-1, 1]) curbs.push(horiz ? { x: r.x, y: 0.08, z: r.z + s * (r.d / 2 + 0.15), w: r.w, h: 0.16, d: 0.3 } : { x: r.x + s * (r.w / 2 + 0.15), y: 0.08, z: r.z, w: 0.3, h: 0.16, d: r.d });
      // centre line: one instance per road, dashed in the shader (3-unit dashes, 3-unit gaps)
      lines.push(horiz ? { x: r.x, y: 0.075, z: r.z, w: r.w * 0.98, h: 1, d: 0.16 } : { x: r.x, y: 0.075, z: r.z, w: 0.16, h: 1, d: r.d * 0.98 });
    }
    const roadMat = roadMaterial(true);
    const curbMat = std('curb', { color: '#6a6a6a', roughness: 0.9 });
    const lineMat = mat('road-line', () => {
      const m = new THREE.MeshBasicMaterial({ color: '#7a7a7a', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vDash;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sx = length(instanceMatrix[0].xyz), sz = length(instanceMatrix[2].xyz); vDash = sx > sz ? (position.x + 0.5) * sx : (position.z + 0.5) * sz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vDash;')
          .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nif (fract(vDash / 6.0) > 0.5) discard;');
      };
      m.customProgramCacheKey = () => 'road-line-dash';
      return m;
    });
    const roadMesh = build(flat, roadMat, asphalt, layout, 'roads'); roadMesh.receiveShadow = true;
    const kerbMesh = build(flat, kerbMaterial(), asphalt, layout, 'road-kerbs');
    const curbMesh = build(box, curbMat, curbs, layout, 'curbs'); curbMesh.receiveShadow = true;
    const lineMesh = build(flat, lineMat, lines, layout, 'road-lines');
    // ---- lots
    const lotGeo = new THREE.PlaneGeometry(1, 1); lotGeo.rotateX(-Math.PI / 2);
    const bld = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, layout.buildings.length) * 4), 4);
    layout.buildings.forEach((b, i) => bld.setXYZW(i, b.box.x - b.lot.x, b.box.z - b.lot.z, b.box.w / 2, b.box.d / 2));
    lotGeo.setAttribute('aBld', bld);
    const lotMesh = build(lotGeo, lotMaterial(true), layout.buildings.map((b) => ({ x: b.lot.x, y: 0.035, z: b.lot.z, w: b.lot.w, h: 1, d: b.lot.d })), layout, 'lots');
    lotMesh.receiveShadow = true;
    for (const m of [roadMesh, curbMesh]) m.renderOrder = -2;
    // lots, asphalt, then the kerb casings (the offsets decide the overlaps): drawn after the asphalt, a casing's
    // fragments under the road fail the depth test before shading, so only its visible kerb line costs fill
    lotMesh.renderOrder = -2.6; kerbMesh.renderOrder = -1.9;
    // ---- street lights along the roads
    const spots: { x: number; z: number }[] = [];
    for (const r of layout.roads) {
      const horiz = r.w > r.d; const len = horiz ? r.w : r.d; const n = Math.max(2, Math.floor(len / 26));
      for (let i = 0; i <= n; i++) {
        const u = -len / 2 + (len / n) * i; const side = (i % 2 === 0 ? 1 : -1) * ((horiz ? r.d : r.w) / 2 + 0.9);
        spots.push(horiz ? { x: r.x + u, z: r.z + side } : { x: r.x + side, z: r.z + u });
      }
    }
    const lamps = spots.slice(0, 320);
    const poleMesh = build(new THREE.CylinderGeometry(0.06, 0.09, 1, 5, 1, true), std('lamp-pole', { color: '#2e2e2e', roughness: 0.6, metalness: 0.4 }), lamps.map((s) => ({ x: s.x, y: 1.9, z: s.z, w: 1, h: 3.8, d: 1 })), layout, 'lamp-poles');
    poleMesh.castShadow = true;
    const headMat = std('lamp-head', { color: '#f2ead8', emissive: '#ffc46b', emissiveIntensity: 0 });
    const headMesh = build(new THREE.OctahedronGeometry(0.24, 0), headMat, lamps.map((s) => ({ x: s.x, y: 3.85, z: s.z, w: 1, h: 1, d: 1 })), layout, 'lamp-heads');
    // ---- trees: perimeter, lot corners, tree zones and loose turf; deterministic
    const trees = treeSpots(layout);
    const trunkMesh = build(new THREE.CylinderGeometry(0.12, 0.18, 1, 5, 1, true), std('tree-trunk', { color: '#1c1c1c', roughness: 1 }), [], layout, 'tree-trunks');
    const crownMesh = build(new THREE.IcosahedronGeometry(1.3, 0), std('tree-crown', { color: '#3a3f3a', roughness: 0.9, flatShading: true }), [], layout, 'tree-crowns');
    const trunkCap = new THREE.InstancedMesh(trunkMesh.geometry, trunkMesh.material, Math.max(1, trees.length));
    const crownCap = new THREE.InstancedMesh(crownMesh.geometry, crownMesh.material, Math.max(1, trees.length));
    for (const m of [trunkCap, crownCap]) { m.raycast = noRaycast; m.castShadow = true; fixedSphere(m, layout); }
    trunkCap.name = 'tree-trunks'; crownCap.name = 'tree-crowns';
    return { flat, lotGeo, box, roadMesh, kerbMesh, curbMesh, lineMesh, lotMesh, poleMesh, headMesh, headMat, lineMat, trees, trunkCap, crownCap, nearOnly: [curbMesh, lineMesh, poleMesh, trunkCap] };
  }, [layout]);
  useEffect(() => () => { if (!meshes) return; for (const g of [meshes.flat, meshes.lotGeo, meshes.box, meshes.poleMesh.geometry, meshes.headMesh.geometry, meshes.trunkCap.geometry, meshes.crownCap.geometry]) g.dispose(); }, [meshes]);

  useEffect(() => { if (!meshes) return; meshes.lotMesh.material = lotMaterial(fast); meshes.roadMesh.material = roadMaterial(fast); invalidate(); }, [meshes, fast, invalidate]);

  // tree density: in Review only the trees in lots and tree zones (a deterministic 60 % subset; the perimeter rows
  // read as specks on the empty board at large viewports), every tree in Live
  useEffect(() => {
    if (!meshes) return;
    let n = 0;
    for (const t of meshes.trees) {
      if (review && (t.perim || t.keep < 0.4)) continue;
      m4.compose(v0.set(t.x, 0.9 * t.s, t.z), q0, s0.set(t.s, 1.8 * t.s, t.s)); meshes.trunkCap.setMatrixAt(n, m4);
      m4.compose(v0.set(t.x, 2.4 * t.s, t.z), q0, s0.set(t.s, t.s * 1.05, t.s)); meshes.crownCap.setMatrixAt(n, m4);
      n++;
    }
    meshes.trunkCap.count = n; meshes.crownCap.count = n;
    meshes.trunkCap.instanceMatrix.needsUpdate = true; meshes.crownCap.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [meshes, review, invalidate]);

  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (!meshes) return;
    // the flat palette (Lighting writes it every frame): lit surfaces take colour / exposure as albedo
    const inv = 1 / Math.max(0.05, sitePalette.exposure);
    const lm = lotMaterial(fast), rm = roadMaterial(fast);
    lm.color.copy(sitePalette.lot).multiplyScalar(inv);
    lotEdge.value.copy(sitePalette.lotEdge).multiplyScalar(inv);
    rm.color.copy(sitePalette.road).multiplyScalar(inv);
    (meshes.kerbMesh.material as THREE.MeshBasicMaterial).color.copy(sitePalette.kerb);
    kerbU.uKerbGlow.value.copy(sitePalette.kerbGlow);
    kerbU.uViewH.value = gl.domElement.height || 900;
    meshes.lineMat.color.copy(sitePalette.dash);
    (meshes.crownCap.material as THREE.MeshLambertMaterial).color.copy(sitePalette.crown);
    const k = review ? 0 : 0.15 + nightFactor(clock.time) * 2.4;
    if (meshes.headMat.emissiveIntensity !== k) meshes.headMat.emissiveIntensity = k;
    // sub-pixel details (curbs, centre lines, lamp posts, trunks) only when the camera is close enough to see them
    const dist = controls?.target ? camera.position.distanceTo(controls.target) : 300;
    const near = dist < 260;
    for (const m of meshes.nearOnly) if (m.visible !== near) m.visible = near;
    const heads = near || !review;
    if (meshes.headMesh.visible !== heads) meshes.headMesh.visible = heads;
  });

  if (!meshes) return null;
  return (
    <group>
      <primitive object={meshes.lotMesh} />
      <primitive object={meshes.kerbMesh} />
      <primitive object={meshes.roadMesh} />
      <primitive object={meshes.curbMesh} />
      <primitive object={meshes.lineMesh} />
      {meshes.poleMesh.count > 0 && <primitive object={meshes.poleMesh} />}
      {meshes.headMesh.count > 0 && <primitive object={meshes.headMesh} />}
      <primitive object={meshes.trunkCap} />
      <primitive object={meshes.crownCap} />
    </group>
  );
}

function treeSpots(layout: SiteLayout): { x: number; z: number; s: number; keep: number; perim: boolean }[] {
  const out: { x: number; z: number; s: number; keep: number; perim: boolean }[] = [];
  let onPerim = true;
  const rnd = seeded(`trees-${layout.buildings.length}-${layout.zones.length}`);
  const push = (x: number, z: number, s: number) => out.push({ x, z, s, keep: rnd(), perim: onPerim });
  const b = layout.bounds;
  const perim = [
    { x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z - b.d / 2 }, { x0: b.x - b.w / 2, z0: b.z + b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2 },
    { x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x - b.w / 2, z1: b.z + b.d / 2 }, { x0: b.x + b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2 },
  ];
  perim.forEach((p, pi) => {
    const len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0); const n = Math.floor(len / 12);
    for (let i = 0; i <= n; i++) { const u = i / Math.max(1, n); const j = (rnd() - 0.5) * 5; push(p.x0 + (p.x1 - p.x0) * u + (pi >= 2 ? j : 0), p.z0 + (p.z1 - p.z0) * u + (pi < 2 ? j : 0), 0.8 + rnd() * 0.7); }
  });
  onPerim = false;
  // a tree at two corners of roomy lots
  for (const bp of layout.buildings) {
    const l: Box2 = bp.lot;
    const spareW = (l.w - bp.box.w) / 2, spareD = (l.d - bp.box.d) / 2;
    if (spareW > 2.2) { push(l.x - l.w / 2 + 1.1, bp.box.z - bp.box.d / 2 + 0.6, 0.6 + rnd() * 0.3); push(l.x + l.w / 2 - 1.1, bp.box.z + bp.box.d / 2 - 0.6, 0.6 + rnd() * 0.3); }
    else if (spareD > 2.2) push(l.x - l.w / 2 + 1.1, l.z - l.d / 2 + 1.1, 0.6 + rnd() * 0.3);
  }
  for (const z of layout.zones) {
    if (z.kind !== 'tree_canopy' && !(z.kind === 'improved_turf' && !z.facilityId)) continue;
    const n = Math.min(z.kind === 'tree_canopy' ? 28 : 8, Math.max(3, Math.round((z.box.w * z.box.d) / 60)));
    for (let i = 0; i < n; i++) push(z.box.x + (rnd() - 0.5) * z.box.w * 0.85, z.box.z + (rnd() - 0.5) * z.box.d * 0.85, 0.7 + rnd() * 0.5);
  }
  return out.slice(0, 1100);
}
