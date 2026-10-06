import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MapControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { clock } from './clock';
import { Building } from './Building';
import { GroundsPad } from './GroundsPad';
import { Workers } from './Workers';
import type { Box2 } from './layout';

/** 0 at night → 1 at solar noon. */
export const dayFactor = (t: number) => Math.max(0, Math.sin(((t - 6) / 12) * Math.PI));
/** 0 by day → 1 deep night, with dusk/dawn ramps. */
export const nightFactor = (t: number) => { const d = dayFactor(t); return d > 0.25 ? 0 : 1 - d / 0.25; };

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

/** Gradient sky dome + sun/moon light rig driven by the sim clock. */
function Atmosphere() {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const stars = useRef<THREE.Group>(null);
  const { scene } = useThree();
  const uniforms = useMemo(() => ({ top: { value: new THREE.Color('#0b1020') }, horizon: { value: new THREE.Color('#1b2a4a') }, glow: { value: new THREE.Color('#ff9a5c') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glowAmt: { value: 0 } }), []);
  const cNight = useMemo(() => new THREE.Color('#9fb4ff'), []);
  const cDusk = useMemo(() => new THREE.Color('#ffb47a'), []);
  const cNoon = useMemo(() => new THREE.Color('#fff6e6'), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const topDay = useMemo(() => new THREE.Color('#5fa8e8'), []);
  const topNight = useMemo(() => new THREE.Color('#06091a'), []);
  const horDay = useMemo(() => new THREE.Color('#cfe4f7'), []);
  const horNight = useMemo(() => new THREE.Color('#16213f'), []);
  const fogCol = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const t = clock.time;
    const day = dayFactor(t);
    const ang = ((t - 6) / 12) * Math.PI;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.45).normalize();
    uniforms.sunDir.value.copy(dir);
    const dusk = Math.exp(-Math.pow((Math.sin(ang)) / 0.22, 2)); // peaks at sunrise / sunset
    uniforms.glowAmt.value = dusk * 0.9;
    uniforms.top.value.copy(topNight).lerp(topDay, day);
    uniforms.horizon.value.copy(horNight).lerp(horDay, Math.min(1, day * 1.4));
    fogCol.copy(uniforms.horizon.value);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(fogCol);
    if (sun.current) {
      sun.current.intensity = 0.5 + day * 1.7;
      sun.current.position.set(dir.x * 140, Math.max(35, dir.y * 160), dir.z * 140 + 40);
      if (day <= 0) tmp.copy(cNight); else if (day < 0.35) tmp.copy(cDusk).lerp(cNoon, day / 0.35); else tmp.copy(cNoon);
      sun.current.color.copy(tmp);
    }
    if (hemi.current) hemi.current.intensity = 0.65 + day * 0.7;
    if (amb.current) amb.current.intensity = 0.3 + day * 0.25;
    if (stars.current) stars.current.visible = day < 0.12;
  });

  return (
    <>
      <mesh scale={1600} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial side={THREE.BackSide} depthWrite={false} uniforms={uniforms}
          vertexShader={`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={`uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform float glowAmt; varying vec3 vDir;
            void main(){ float h = clamp(vDir.y, -0.1, 1.0); float k = pow(1.0 - clamp(h, 0.0, 1.0), 2.2); vec3 c = mix(top, horizon, k);
              float s = max(0.0, dot(normalize(vDir), normalize(sunDir))); c += glow * glowAmt * pow(s, 6.0) * (1.0 - clamp(h*3.0,0.0,1.0)*0.6);
              c += vec3(1.0, 0.95, 0.85) * pow(s, 400.0) * 0.8 * step(0.0, sunDir.y); gl_FragColor = vec4(c, 1.0); }`} />
      </mesh>
      <group ref={stars}><Stars radius={900} depth={80} count={2600} factor={4} fade speed={0.35} /></group>
      <ambientLight ref={amb} intensity={0.35} color="#dfe8ff" />
      <hemisphereLight ref={hemi} intensity={0.8} color="#dbe7ff" groundColor="#3a4a3a" />
      <directionalLight ref={sun} position={[60, 120, 70]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-240} shadow-camera-right={240} shadow-camera-top={240} shadow-camera-bottom={-240} shadow-camera-near={10} shadow-camera-far={600} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <fog attach="fog" args={['#16213f', 380, 1400]} />
    </>
  );
}

function groundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a3a2b'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { const v = 30 + Math.random() * 40; ctx.fillStyle = `rgba(${v},${v + 20},${v},${0.25 + Math.random() * 0.4})`; ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 255, 255);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(160, 160); t.anisotropy = 4; return t;
}

function Ground({ size }: { size: number }) {
  const select = useStore((s) => s.select);
  const tex = useMemo(groundTexture, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow onClick={(e) => { e.stopPropagation(); select({ kind: null }); }}>
      <planeGeometry args={[size * 5, size * 5]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function Roads() {
  const { layout } = useDerived();
  if (!layout) return null;
  return (
    <group>
      {layout.roads.map((r, i) => {
        const horiz = r.w > r.d;
        return (
          <group key={i} position={[r.x, 0.012, r.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[r.w, r.d]} />
              <meshStandardMaterial color="#262a31" roughness={0.95} />
            </mesh>
            {/* curbs */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={horiz ? [0, 0.08, s * (r.d / 2 + 0.15)] : [s * (r.w / 2 + 0.15), 0.08, 0]} receiveShadow>
                <boxGeometry args={horiz ? [r.w, 0.16, 0.3] : [0.3, 0.16, r.d]} />
                <meshStandardMaterial color="#8a8f98" roughness={0.9} />
              </mesh>
            ))}
            {/* dashed centre line */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
              <planeGeometry args={[horiz ? r.w * 0.98 : 0.16, horiz ? 0.16 : r.d * 0.98]} />
              <meshBasicMaterial color="#e8d27a" transparent opacity={0.55} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Instanced street lights along the roads: poles, heads, and warm lamps that glow at night. */
function StreetLights() {
  const { layout } = useDerived();
  const poles = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<THREE.InstancedMesh>(null);
  const lampMat = useRef<THREE.MeshStandardMaterial>(null);
  const spots = useMemo(() => {
    if (!layout) return [] as { x: number; z: number }[];
    const out: { x: number; z: number }[] = [];
    for (const r of layout.roads) {
      const horiz = r.w > r.d; const len = horiz ? r.w : r.d; const n = Math.max(2, Math.floor(len / 16));
      for (let i = 0; i <= n; i++) {
        const u = -len / 2 + (len / n) * i; const side = (i % 2 === 0 ? 1 : -1) * ((horiz ? r.d : r.w) / 2 + 0.9);
        out.push(horiz ? { x: r.x + u, z: r.z + side } : { x: r.x + side, z: r.z + u });
      }
    }
    return out.slice(0, 400);
  }, [layout]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!poles.current || !lamps.current) return;
    spots.forEach((s, i) => {
      dummy.position.set(s.x, 1.9, s.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); poles.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 3.85, s.z); dummy.updateMatrix(); lamps.current!.setMatrixAt(i, dummy.matrix);
    });
    poles.current.instanceMatrix.needsUpdate = true; lamps.current.instanceMatrix.needsUpdate = true;
  }, [spots, dummy]);
  useFrame(() => { if (lampMat.current) lampMat.current.emissiveIntensity = 0.1 + nightFactor(clock.time) * 2.6; });
  if (!spots.length) return null;
  return (
    <group>
      <instancedMesh key={`p${spots.length}`} ref={poles} args={[undefined, undefined, spots.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.06, 0.09, 3.8, 6]} />
        <meshStandardMaterial color="#3b4350" roughness={0.6} metalness={0.4} />
      </instancedMesh>
      <instancedMesh key={`l${spots.length}`} ref={lamps} args={[undefined, undefined, spots.length]} frustumCulled={false}>
        <sphereGeometry args={[0.2, 10, 10]} />
        <meshStandardMaterial ref={lampMat} color="#fff1c9" emissive="#ffd27a" emissiveIntensity={0.1} />
      </instancedMesh>
    </group>
  );
}

/** Low-poly trees along the perimeter roads. */
function RoadTrees() {
  const { layout } = useDerived();
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    if (!layout) return [] as { x: number; z: number; s: number }[];
    const out: { x: number; z: number; s: number }[] = [];
    const b = layout.bounds;
    const perim = [{ x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z - b.d / 2 }, { x0: b.x - b.w / 2, z0: b.z + b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2 }, { x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x - b.w / 2, z1: b.z + b.d / 2 }, { x0: b.x + b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2 }];
    perim.forEach((p, pi) => { const len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0); const n = Math.floor(len / 9); for (let i = 0; i <= n; i++) { const u = i / Math.max(1, n); const j = Math.sin((i + pi * 7) * 12.9898) * 2.5; out.push({ x: p.x0 + (p.x1 - p.x0) * u + (pi >= 2 ? j : 0), z: p.z0 + (p.z1 - p.z0) * u + (pi < 2 ? j : 0), s: 0.8 + Math.abs(Math.sin(i * 3.7 + pi)) * 0.7 }); } });
    return out.slice(0, 260);
  }, [layout]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!trunks.current || !crowns.current) return;
    spots.forEach((s, i) => {
      dummy.position.set(s.x, 0.9 * s.s, s.z); dummy.scale.set(s.s, s.s, s.s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunks.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 2.4 * s.s, s.z); dummy.updateMatrix(); crowns.current!.setMatrixAt(i, dummy.matrix);
    });
    trunks.current.instanceMatrix.needsUpdate = true; crowns.current.instanceMatrix.needsUpdate = true;
  }, [spots, dummy]);
  if (!spots.length) return null;
  return (
    <group>
      <instancedMesh key={`t${spots.length}`} ref={trunks} args={[undefined, undefined, spots.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.12, 0.18, 1.8, 6]} />
        <meshStandardMaterial color="#5b3a1f" roughness={1} />
      </instancedMesh>
      <instancedMesh key={`c${spots.length}`} ref={crowns} args={[undefined, undefined, spots.length]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[1.3, 1]} />
        <meshStandardMaterial color="#2f7a33" roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Cyan scan plane that sweeps the site while the AI reader is working. */
function ScanSweep() {
  const running = useStore((s) => s.extraction.running);
  const { layout } = useDerived();
  const plane = useRef<THREE.Mesh>(null);
  const t0 = useRef(performance.now());
  useFrame(() => {
    if (!plane.current || !layout) return;
    const b = layout.bounds; const period = 5000;
    const u = ((performance.now() - t0.current) % period) / period;
    plane.current.position.set(b.x - b.w / 2 + u * b.w, 4, b.z);
    plane.current.visible = running;
  });
  if (!layout) return null;
  const b = layout.bounds;
  return (
    <mesh ref={plane} visible={false}>
      <boxGeometry args={[0.35, 8, b.d]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.33} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/** Spotlight + pulsing ring on the selected building. */
function SelectionFx() {
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const { layout } = useDerived();
  const target = useMemo(() => new THREE.Object3D(), []);
  const ring = useRef<THREE.Mesh>(null);
  const b = selection.kind === 'facility' && layout ? layout.buildings.find((x) => x.id === selection.id) : undefined;
  useFrame(() => {
    if (!ring.current || !b) return;
    const p = (performance.now() % 2200) / 2200;
    const r = Math.max(b.box.w, b.box.d) * 0.7;
    ring.current.visible = focusMode === 'site';
    ring.current.scale.setScalar(r * (0.95 + p * 0.45));
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.4;
  });
  if (!b) return null;
  return (
    <group>
      <primitive object={target} position={[b.box.x, 0, b.box.z]} />
      <spotLight position={[b.box.x + 6, b.height + 28, b.box.z + 8]} target={target} angle={0.42} penumbra={0.7} intensity={260} distance={120} color="#9ad8ff" castShadow={false} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[b.box.x, 0.05, b.box.z]}>
        <ringGeometry args={[0.975, 1, 96]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Moves the camera to the current selection (smoothly), frames the site on load, orbits slowly when idle. */
function CameraRig() {
  const controls = useRef<MapControlsImpl>(null);
  const { camera } = useThree();
  const { layout } = useDerived();
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const orbit = useStore((s) => s.autoOrbit);
  const running = useStore((s) => s.extraction.running);
  const target = useRef(new THREE.Vector3());
  const camTo = useRef(new THREE.Vector3());
  const animating = useRef(false);
  const lastKey = useRef('');
  const lastInteract = useRef(performance.now());

  useEffect(() => {
    if (!layout) return;
    const key = `${selection.kind}:${'id' in selection ? selection.id : ''}:${focusMode}:${buildingTab}:${layout.buildings.length}:${layout.zones.length}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const goto = (tx: number, ty: number, tz: number, cx: number, cy: number, cz: number) => { target.current.set(tx, ty, tz); camTo.current.set(cx, cy, cz); animating.current = true; };
    if (selection.kind === 'facility') {
      const b = layout.buildings.find((x) => x.id === selection.id);
      if (b) {
        if (focusMode === 'building') {
          if (buildingTab === 'grounds') goto(b.lot.x, 0, b.lot.z, b.lot.x + b.lot.w * 0.5, Math.max(b.lot.w, b.lot.d) * 0.9 + 10, b.lot.z + b.lot.d * 1.0);
          else { const r = Math.max(b.box.w, b.box.d, b.height) * 1.6 + 6; goto(b.box.x, b.height * 0.45, b.box.z, b.box.x + r * 0.7, b.height * 0.6 + r * 0.55, b.box.z + r * 0.75); }
        } else { const r = Math.max(b.lot.w, b.lot.d) * 1.5 + 12; goto(b.box.x, b.height * 0.3, b.box.z, b.box.x + r * 0.6, r * 0.7, b.box.z + r * 0.8); }
        return;
      }
    }
    if (selection.kind === 'grounds') {
      const z = layout.zones.find((x) => x.id === selection.id);
      if (z) { const r = Math.max(z.box.w, z.box.d) * 1.1 + 10; goto(z.box.x, 0, z.box.z, z.box.x + r * 0.5, r * 0.75, z.box.z + r * 0.7); return; }
    }
    const b = layout.bounds; const r = Math.max(b.w, b.d) * 0.6 + 20;
    goto(b.x, 0, b.z, b.x + r * 0.55, r * 0.7, b.z + r * 0.75);
  }, [layout, selection, focusMode, buildingTab]);

  useFrame((_, dt) => {
    const c = controls.current; if (!c) return;
    const idle = performance.now() - lastInteract.current > 9000;
    c.autoRotate = orbit && idle && !animating.current && !running;
    c.autoRotateSpeed = 0.35;
    if (!animating.current) return;
    const k = 1 - Math.exp(-dt * 4);
    c.target.lerp(target.current, k);
    camera.position.lerp(camTo.current, k);
    c.update();
    if (camera.position.distanceTo(camTo.current) < 0.3) animating.current = false;
  });

  return <MapControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.08} minDistance={4} maxDistance={1400} onStart={() => { animating.current = false; lastInteract.current = performance.now(); }} />;
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
      <StreetLights />
      <RoadTrees />
    </group>
  );
}

export function Scene() {
  const { layout } = useDerived();
  const quality = useStore((s) => s.quality);
  const size = Math.max(200, layout ? Math.max(layout.bounds.w, layout.bounds.d) : 200);
  return (
    <Canvas shadows dpr={[1, quality === 'high' ? 1.75 : 1.25]} camera={{ position: [120, 110, 120], fov: 42, near: 0.5, far: 3500 }} gl={{ antialias: false, powerPreference: 'high-performance', toneMappingExposure: 1.1 }} onPointerMissed={() => useStore.getState().setSelectedAgent(null)}>
      <Suspense fallback={null}>
        <Atmosphere />
        <Ground size={size} />
        <Site />
        <Workers />
        <ScanSweep />
        <SelectionFx />
        <CameraRig />
        <SimClock />
        {quality === 'high' && (
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.78} luminanceSmoothing={0.25} radius={0.7} />
            <Vignette eskil={false} offset={0.18} darkness={0.6} />
            <SMAA />
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
  );
}

export type { Box2 };
