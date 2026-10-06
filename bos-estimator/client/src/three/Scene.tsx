import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { clock } from './clock';
import { Building } from './Building';
import { GroundsPad } from './GroundsPad';
import { Workers } from './Workers';

function SimClock() {
  const simSet = useStore((s) => s.simSet);
  const last = useRef(0);
  useFrame((_, dt) => {
    if (clock.playing) clock.time = (clock.time + (Math.min(dt, 0.1) * clock.speed) / 60) % 24;
    last.current += dt;
    if (last.current > 0.5) { last.current = 0; simSet({ time: clock.time }); }
  });
  return null;
}

/** Day/night lighting driven by the sim clock. */
function Daylight() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const { scene } = useThree();
  const bg = useMemo(() => new THREE.Color(), []);
  const cNight = useMemo(() => new THREE.Color('#9fb4ff'), []);
  const cDusk = useMemo(() => new THREE.Color('#ffc48f'), []);
  const cNoon = useMemo(() => new THREE.Color('#fff6e6'), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const t = clock.time;
    const day = Math.max(0, Math.sin(((t - 6) / 12) * Math.PI)); // 0 at night, 1 at noon
    if (sun.current) {
      sun.current.intensity = 0.55 + day * 1.5;
      const ang = ((t - 6) / 12) * Math.PI;
      const up = Math.sin(ang);
      sun.current.position.set(Math.cos(ang) * 120, up > 0.05 ? 30 + up * 120 : 90, 70);
      if (day <= 0) tmp.copy(cNight); else if (day < 0.35) tmp.copy(cDusk).lerp(cNoon, day / 0.35); else tmp.copy(cNoon);
      sun.current.color.copy(tmp);
    }
    if (hemi.current) hemi.current.intensity = 0.7 + day * 0.6;
    if (amb.current) amb.current.intensity = 0.35 + day * 0.25;
    bg.setRGB(0.045 + day * 0.3, 0.07 + day * 0.42, 0.14 + day * 0.55);
    scene.background = bg;
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(bg);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.4} color="#dfe8ff" />
      <hemisphereLight ref={hemi} intensity={0.8} color="#dbe7ff" groundColor="#3a4a3a" />
      <directionalLight ref={sun} position={[60, 120, 70]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-220} shadow-camera-right={220} shadow-camera-top={220} shadow-camera-bottom={-220} shadow-camera-near={10} shadow-camera-far={500} shadow-bias={-0.0004} />
      <fog attach="fog" args={['#0b1020', 350, 1100]} />
    </>
  );
}

function Ground({ size }: { size: number }) {
  const select = useStore((s) => s.select);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow onClick={(e) => { e.stopPropagation(); select({ kind: null }); }}>
        <planeGeometry args={[size * 4, size * 4]} />
        <meshStandardMaterial color="#2c3a2c" roughness={1} />
      </mesh>
      <gridHelper args={[size * 4, Math.round(size / 5), '#3a4d3a', '#2a3a2a']} position={[0, -0.005, 0]} />
    </group>
  );
}

function Roads() {
  const { layout } = useDerived();
  if (!layout) return null;
  return (
    <group>
      {layout.roads.map((r, i) => (
        <group key={i} position={[r.x, 0.01, r.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[r.w, r.d]} />
            <meshStandardMaterial color="#2a2d33" roughness={0.95} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <planeGeometry args={[r.w > r.d ? r.w * 0.98 : 0.18, r.w > r.d ? 0.18 : r.d * 0.98]} />
            <meshBasicMaterial color="#d8c16a" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Moves the camera to the current selection (smoothly) and frames the whole site on load. */
function CameraRig() {
  const controls = useRef<MapControlsImpl>(null);
  const { camera } = useThree();
  const { layout } = useDerived();
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const target = useRef(new THREE.Vector3());
  const camTo = useRef(new THREE.Vector3());
  const animating = useRef(false);
  const lastKey = useRef('');

  useEffect(() => {
    if (!layout) return;
    const key = `${selection.kind}:${'id' in selection ? selection.id : ''}:${focusMode}:${buildingTab}:${layout.buildings.length}:${layout.zones.length}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (selection.kind === 'facility') {
      const b = layout.buildings.find((x) => x.id === selection.id);
      if (b) {
        if (focusMode === 'building') {
          if (buildingTab === 'grounds') {
            target.current.set(b.lot.x, 0, b.lot.z);
            camTo.current.set(b.lot.x + b.lot.w * 0.5, Math.max(b.lot.w, b.lot.d) * 0.9 + 10, b.lot.z + b.lot.d * 1.0);
          } else {
            target.current.set(b.box.x, b.height * 0.45, b.box.z);
            const r = Math.max(b.box.w, b.box.d, b.height) * 1.6 + 6;
            camTo.current.set(b.box.x + r * 0.7, b.height * 0.6 + r * 0.55, b.box.z + r * 0.75);
          }
        } else {
          target.current.set(b.box.x, b.height * 0.3, b.box.z);
          const r = Math.max(b.lot.w, b.lot.d) * 1.5 + 12;
          camTo.current.set(b.box.x + r * 0.6, r * 0.7, b.box.z + r * 0.8);
        }
        animating.current = true; return;
      }
    }
    if (selection.kind === 'grounds') {
      const z = layout.zones.find((x) => x.id === selection.id);
      if (z) { target.current.set(z.box.x, 0, z.box.z); const r = Math.max(z.box.w, z.box.d) * 1.1 + 10; camTo.current.set(z.box.x + r * 0.5, r * 0.75, z.box.z + r * 0.7); animating.current = true; return; }
    }
    // frame the whole site
    const b = layout.bounds;
    target.current.set(b.x, 0, b.z);
    const r = Math.max(b.w, b.d) * 0.62 + 20;
    camTo.current.set(b.x + r * 0.55, r * 0.75, b.z + r * 0.75);
    animating.current = true;
  }, [layout, selection, focusMode, buildingTab]);

  useFrame((_, dt) => {
    if (!animating.current || !controls.current) return;
    const k = 1 - Math.exp(-dt * 4);
    controls.current.target.lerp(target.current, k);
    camera.position.lerp(camTo.current, k);
    controls.current.update();
    if (camera.position.distanceTo(camTo.current) < 0.3) animating.current = false;
  });

  return <MapControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.08} minDistance={4} maxDistance={1200} onStart={() => (animating.current = false)} />;
}

function Site() {
  const { layout, est } = useDerived();
  const facilities = useStore((s) => s.project?.inventory.facilities ?? []);
  const grounds = useStore((s) => s.project?.inventory.grounds ?? []);
  if (!layout || !est) return null;
  const fmap = new Map(facilities.map((f) => [f.id, f]));
  const emap = new Map(est.facilities.map((e) => [e.facilityId, e]));
  const gmap = new Map(grounds.map((g) => [g.id, g]));
  const gemap = new Map(est.grounds.map((g) => [g.areaId, g]));
  return (
    <group>
      {layout.zones.map((z) => { const g = gmap.get(z.id); return g ? <GroundsPad key={z.id} zone={z} area={g} estimate={gemap.get(z.id)} /> : null; })}
      {layout.buildings.map((b) => { const f = fmap.get(b.id); const e = emap.get(b.id); return f && e ? <Building key={b.id} placement={b} facility={f} estimate={e} total={layout.buildings.length} /> : null; })}
      <Roads />
    </group>
  );
}

export function Scene() {
  const { layout } = useDerived();
  const size = Math.max(200, layout ? Math.max(layout.bounds.w, layout.bounds.d) : 200);
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [120, 110, 120], fov: 42, near: 0.5, far: 3000 }} gl={{ antialias: true, powerPreference: 'high-performance', toneMappingExposure: 1.15 }} onPointerMissed={() => useStore.getState().setSelectedAgent(null)}>
      <Suspense fallback={null}>
        <Daylight />
        <Stars radius={600} depth={80} count={1500} factor={3} fade speed={0.3} />
        <Ground size={size} />
        <Site />
        <Workers />
        <CameraRig />
        <SimClock />
      </Suspense>
    </Canvas>
  );
}
