// Hero building (UI spec §9.5): the detailed model is mounted only for the selected facility. Its massing uses
// the shared field material (same windows and roof tint as the field), plus parapet, floor bands, rooftop units,
// canopy, a cached EdgesGeometry outline in the accent colour, and the cut-away interior when focused.
// When focused every shell mesh ignores raycasts, so clicks reach the crew inside.
import { memo, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FacilityEstimate } from '@shared/estimate';
import { FINISH_COLORS } from '../components/lib/theme';
import { useStore } from '../store';
import type { BuildingPlacement } from './layout';
import { BAYS, basic, fieldMaterial, mat, seeded, std, styleOf } from './assets';
import { hoverFromScene } from './hover';
import { explodeGap, floorY } from './InteriorCrew';
import { WALL_BASE, WALL_TINT } from './BuildingField';

/** the acid accent of the obsidian theme (tokens.css --accent): selection outline and the interior cage */
const ACCENT = '#c6f43c';

const noRaycast = () => {};
const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const s0 = new THREE.Vector3();

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, items: { x: number; y: number; z: number; w: number; h: number; d: number; color?: string }[], name: string) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
  const col = items.some((i) => i.color) ? new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3) : null;
  if (col) mesh.instanceColor = col;
  const c = new THREE.Color();
  items.forEach((it, i) => {
    m4.compose(v0.set(it.x, it.y, it.z), q0, s0.set(it.w, it.h, it.d)); mesh.setMatrixAt(i, m4);
    if (col) { c.set(it.color ?? '#ffffff'); col.setXYZ(i, c.r, c.g, c.b); }
  });
  mesh.count = items.length; mesh.computeBoundingSphere(); mesh.name = name;
  return mesh;
}

export interface HeroProps { placement: BuildingPlacement; estimate?: FacilityEstimate; tint: string; focused: boolean; hovered: boolean }

export const HeroBuilding = memo(function HeroBuilding({ placement: b, estimate: e, tint, focused, hovered }: HeroProps) {
  const style = styleOf(b.category);
  const h = Math.max(0.6, b.height);
  const select = useStore((s) => s.select);
  const setFocusMode = useStore((s) => s.setFocusMode);

  // massing: one instance of the shared field material
  const massing = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const one = (n: number, v: number[]) => new THREE.InstancedBufferAttribute(new Float32Array(v.length ? v : new Array(n).fill(0)), n);
    const rnd = seeded(b.id);
    geo.setAttribute('aRoof', one(3, [0, 0, 0]));
    geo.setAttribute('aDims', one(3, [b.box.w, h, b.box.d]));
    geo.setAttribute('aFloors', one(1, [Math.max(1, b.floors)]));
    geo.setAttribute('aState', one(1, [0]));
    geo.setAttribute('aSeed', one(1, [Math.floor(rnd() * BAYS[style].bays) / BAYS[style].bays]));
    geo.setAttribute('aBorn', one(1, [-1e6]));
    const mesh = new THREE.InstancedMesh(geo, fieldMaterial(style), 1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    m4.compose(v0.set(0, h / 2, 0), q0, s0.set(b.box.w, h, b.box.d)); mesh.setMatrixAt(0, m4);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'hero-massing';
    mesh.computeBoundingSphere();
    return mesh;
  }, [b.id, b.box.w, b.box.d, h, b.floors, style]);
  useEffect(() => () => massing.geometry.dispose(), [massing]);
  useEffect(() => {
    const c = new THREE.Color(tint);
    (massing.geometry.getAttribute('aRoof') as THREE.InstancedBufferAttribute).setXYZ(0, c.r, c.g, c.b);
    massing.geometry.getAttribute('aRoof').needsUpdate = true;
    const w = WALL_BASE.clone().lerp(c, WALL_TINT);
    massing.instanceColor!.setXYZ(0, w.r, w.g, w.b); massing.instanceColor!.needsUpdate = true;
    (massing.geometry.getAttribute('aState') as THREE.InstancedBufferAttribute).setX(0, hovered ? 1 : 0);
    massing.geometry.getAttribute('aState').needsUpdate = true;
  }, [massing, tint, hovered]);

  // cached outline

  const details = useMemo(() => {
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const roofC = new THREE.Color(tint).multiplyScalar(0.72).getStyle();
    const parapet = instanced(unit, std('hero-parapet', { color: '#ffffff', roughness: 0.9 }), [{ x: 0, y: h + 0.12, z: 0, w: b.box.w + 0.16, h: 0.24, d: b.box.d + 0.16, color: roofC }], 'hero-parapet');
    const floorsToDraw = Math.min(b.floors, 16);
    const bands = instanced(unit, std('hero-band', { color: '#141414', roughness: 1 }), Array.from({ length: Math.max(0, floorsToDraw - 1) }, (_, i) => ({ x: 0, y: (i + 1) * b.floorHeight, z: 0, w: b.box.w + 0.06, h: 0.07, d: b.box.d + 0.06 })), 'hero-bands');
    const units = instanced(unit, std('hero-rtu', { color: '#8c8c8c' }), [], 'hero-rtu'); // rooftop units: shared field mesh
    const extras: { x: number; y: number; z: number; w: number; h: number; d: number; color?: string }[] = [];
    if (b.category === 'hangar') extras.push({ x: 0, y: h + 0.5, z: 0, w: b.box.w * 0.9, h: 0.9, d: b.box.d * 0.28, color: '#4a4a4a' });
    if (style !== 'industrial') extras.push({ x: 0, y: 0.5, z: b.box.d / 2 + 0.02, w: Math.min(2.2, b.box.w * 0.3), h: 1.0, d: 0.04, color: '#141414' }); // entrance glazing (canopy: field mesh)
    const extra = instanced(unit, std('hero-extra', { color: '#ffffff', roughness: 0.5, metalness: 0.25 }), extras, 'hero-extra');
    for (const m of [parapet, units, extra]) m.castShadow = true;
    return { unit, parapet, bands, units, extra };
  }, [b.id, b.box.w, b.box.d, b.floors, b.floorHeight, b.category, h, style, tint]);
  useEffect(() => () => details.unit.dispose(), [details]);

  // cut-away interior: finish patches, restroom cores, stair/elevator core and a faint floor cage, instanced
  const interior = useMemo(() => {
    if (!focused) return null;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const floors = Math.max(1, Math.min(b.floors, 24));
    const mix = e?.resolved.floorMix ?? { carpet: 0.3, resilient: 0.4, hardTile: 0.2, concrete: 0.1, wood: 0 };
    const entries = (Object.entries(mix) as [keyof typeof FINISH_COLORS, number][]).filter(([, v]) => v > 0.02).sort((p, q) => q[1] - p[1]);
    const patches: { x: number; y: number; z: number; w: number; h: number; d: number; color: string }[] = [];
    const rest: typeof patches = [];
    const cores: typeof patches = [];
    const cages: typeof patches = [];
    const restroomsPerFloor = Math.max(1, Math.min(4, Math.round((e?.resolved.restroomFixtures ?? 4) / floors / 6)));
    for (let f = 0; f < floors; f++) {
      const y = floorY(b, f);
      let x = -b.box.w / 2;
      for (const [k, v] of entries) { const w = v * b.box.w; patches.push({ x: x + w / 2, y: y + 0.05, z: 0, w: Math.max(0.05, w - 0.02), h: 0.1, d: b.box.d - 0.02, color: FINISH_COLORS[k] ?? '#999' }); x += w; }
      for (let r = 0; r < restroomsPerFloor; r++) rest.push({ x: -b.box.w / 2 + 0.9 + r * 1.6, y: y + 0.55, z: b.box.d / 2 - 0.8, w: 1.4, h: 0.9, d: 1.3, color: '#f4f4f4' });
      cores.push({ x: 0, y: y + b.floorHeight / 2, z: 0, w: Math.min(2.2, b.box.w * 0.18), h: b.floorHeight, d: Math.min(2.2, b.box.d * 0.18), color: '#1a1a1a' });
      cages.push({ x: 0, y: y + b.floorHeight / 2, z: 0, w: b.box.w, h: b.floorHeight - 0.05, d: b.box.d, color: ACCENT });
    }
    const pm = instanced(unit, std('int-floor', { color: '#ffffff', roughness: 0.9 }), patches, 'int-floors');
    pm.receiveShadow = true;
    const rm = instanced(unit, std('int-rest', { color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.6 }), rest, 'int-rest');
    const cm = instanced(unit, std('int-core', { color: '#ffffff', roughness: 0.8 }), cores, 'int-core');
    const wm = instanced(unit, basic('int-cage', { color: ACCENT, wireframe: true, transparent: true, opacity: 0.2, depthWrite: false }), cages, 'int-cage');
    for (const m of [pm, rm, cm, wm]) m.raycast = noRaycast;
    return { unit, pm, rm, cm, wm };
  }, [focused, b.id, b.box.w, b.box.d, b.floors, b.floorHeight, e]);
  useEffect(() => () => interior?.unit.dispose(), [interior]);
  const gap = explodeGap(b);
  const hx = focused ? Math.max(h, Math.min(b.floors, 24) * (b.floorHeight + gap) - gap) : h;

  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(b.box.w + 0.04, hx + 0.04, b.box.d + 0.04)), [b.box.w, b.box.d, hx]);
  useEffect(() => () => outline.dispose(), [outline]);
  const ghostMat = mat('hero-ghost', () => new THREE.MeshStandardMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.06, depthWrite: false, roughness: 0.4, side: THREE.DoubleSide }));
  const outlineMat = mat('hero-outline', () => new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 1 }));

  const onDouble = (ev: ThreeEvent<MouseEvent>) => { ev.stopPropagation(); select({ kind: 'facility', id: b.id }); setFocusMode('building'); };
  const onClick = (ev: ThreeEvent<MouseEvent>) => { if (ev.delta > 4) return; ev.stopPropagation(); };
  const onMove = (ev: ThreeEvent<PointerEvent>) => { ev.stopPropagation(); hoverFromScene(b.id); };
  const onOut = () => { if (useStore.getState().hoverId === b.id) hoverFromScene(null); };

  return (
    <group position={[b.box.x, 0, b.box.z]}>
      {!focused && (
        <>
          <primitive object={massing} onClick={onClick} onDoubleClick={onDouble} onPointerMove={onMove} onPointerOut={onOut} />
          <primitive object={details.parapet} raycast={noRaycast} />
          {details.bands.count > 0 && <primitive object={details.bands} raycast={noRaycast} />}
          {details.units.count > 0 && <primitive object={details.units} raycast={noRaycast} />}
          {details.extra.count > 0 && <primitive object={details.extra} raycast={noRaycast} />}
        </>
      )}
      {focused && interior && (
        <>
          {gap === 0 && <mesh position={[0, hx / 2, 0]} material={ghostMat} raycast={noRaycast} renderOrder={5}>
            <boxGeometry args={[b.box.w, hx, b.box.d]} />
          </mesh>}
          <primitive object={interior.pm} />
          <primitive object={interior.rm} />
          <primitive object={interior.cm} />
          <primitive object={interior.wm} />
        </>
      )}
      <lineSegments geometry={outline} material={outlineMat} position={[0, hx / 2, 0]} raycast={noRaycast} renderOrder={6} />
    </group>
  );
});
