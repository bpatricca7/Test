// The 3D site view (UI spec §9). The canvas always fills the window under the opaque shell panels; the free
// rect is handled with a camera view offset, so panel changes never resize the WebGL buffer. Labels, the hover
// tooltip and the worker card live in one DOM layer next to the canvas.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import { SMAAPreset, type EffectComposer as EffectComposerImpl, type SMAAEffect } from 'postprocessing';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { buildingTint } from '../components/lib/theme';
import { clock } from './clock';
import { Lighting, Ground } from './Lighting';
import { SiteProps } from './SiteProps';
import { BuildingField, useFacilityMap } from './BuildingField';
import { HeroBuilding } from './Building';
import { GroundsPads } from './GroundsPad';
import { Workers } from './Workers';
import { CameraRig } from './CameraRig';
import { PlanCamera } from './PlanView';
import { LabelLayerDriver } from './LabelLayer';
import { useTestHooks } from './testHooks';
import { disposeAssets } from './assets';
import { rt } from './runtime';
import { freeRect, insets } from './insets';
import type { Box2 } from './layout';

export { dayFactor, nightFactor } from './Lighting';

function SimClock() {
  const simSet = useStore((s) => s.simSet);
  const last = useRef(0);
  useFrame((_, dt) => {
    if (clock.playing) clock.time = (clock.time + (Math.min(dt, 0.1) * clock.speed) / 60) % 24;
    last.current += dt;
    if (last.current > 0.5) { last.current = 0; if (clock.playing) simSet({ time: clock.time }); }
  });
  return null;
}

/** Keeps demand-mode frames flowing while something animates (spawn rise, recent glow, label fades). */
function Animator() {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => { if (rt.animating.size) invalidate(); });
  return null;
}

/** Cyan scan plane that sweeps the site only while the reader is extracting (P1). */
function ScanSweep() {
  const phase = useStore((s) => s.extraction.phase ?? (s.extraction.running ? 'extracting' : 'idle'));
  const reduced = useStore((s) => s.reducedMotion ?? false);
  const { layout } = useDerived();
  const plane = useRef<THREE.Mesh>(null);
  const on = phase === 'extracting' && !reduced && layout != null;
  useFrame(() => {
    if (!plane.current || !layout) return;
    const b = layout.bounds; const u = (performance.now() % 5000) / 5000;
    plane.current.position.set(b.x - b.w / 2 + u * b.w, 4, b.z);
    plane.current.scale.set(1, 1, b.d);
  });
  if (!on) return null;
  return (
    <mesh ref={plane} raycast={() => null}>
      <boxGeometry args={[0.35, 8, 1]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/** Accent ground reticle on the selected building or zone. */
function SelectionFx() {
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const reduced = useStore((s) => s.reducedMotion ?? false);
  const { layout } = useDerived();
  const ring = useRef<THREE.Mesh>(null);
  let box: Box2 | undefined;
  if (layout && selection.kind === 'facility') box = layout.buildings.find((x) => x.id === selection.id)?.lot;
  if (layout && selection.kind === 'grounds') box = layout.zones.find((x) => x.id === selection.id)?.box;
  useFrame(() => {
    if (!ring.current || !box) return;
    const p = reduced ? 0.5 : (performance.now() % 2400) / 2400;
    const r = Math.max(box.w, box.d) * 0.62;
    ring.current.scale.setScalar(r * (0.96 + p * 0.12));
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 - p * 0.35;
  });
  if (!box || focusMode === 'building') return null;
  return (
    <group position={[box.x, 0.12, box.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={3}>
        <ringGeometry args={[0.97, 1, 72]} />
        <meshBasicMaterial color="#5aa9f5" transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={3}>
        <planeGeometry args={[box.w + 0.6, box.d + 0.6]} />
        <meshBasicMaterial color="#5aa9f5" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Hero() {
  const d = useDerived();
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const hoverId = useStore((s) => s.hoverId ?? null);
  const buildingTab = useStore((s) => s.buildingTab);
  const colorBy = useStore((s) => s.colorBy ?? 'category');
  const crewFilter = useStore((s) => s.crewFilter);
  const fmap = useFacilityMap();
  if (selection.kind !== 'facility' || !d.layout) return null;
  const b = d.layout.buildings.find((x) => x.id === selection.id);
  const f = fmap.get(selection.id);
  if (!b || !f) return null;
  const neutral = crewFilter != null;
  const meta = d.rowMeta.get(b.id);
  const tint = neutral ? '#c9ced6' : buildingTint(colorBy, { category: f.category, conf: f.confidence, review: meta?.review ?? 'ok', fte: d.estById.get(b.id)?.fte ?? 0, fteBreaks: d.fteBreaks });
  return <HeroBuilding placement={b} estimate={d.estById.get(b.id)} tint={tint} focused={focusMode === 'building' && buildingTab === 'interior'} hovered={hoverId === b.id} />;
}

function TestHooks() { useTestHooks(); return null; }

/**
 * The shell's panels are opaque, so pixels outside the free rect are never seen: the renderer scissors to the
 * free rect (+2 px). While a panel animates (and briefly after) the whole canvas renders, so newly exposed
 * areas are always fresh. The WebGL buffer itself is never resized.
 */
function FreeRectScissor() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const until = useRef(0);
  const lastVersion = useRef(-1);
  useFrame(() => {
    const now = performance.now();
    if (insets.version !== lastVersion.current) { lastVersion.current = insets.version; until.current = now + 450; }
    const W = size.width, H = size.height;
    const fr = freeRect(W, H);
    const full = insets.animating || now < until.current || (fr.w >= W - 1 && fr.h >= H - 1);
    if (full) { gl.setScissorTest(false); rt.scissor.on = false; if (now < until.current) rt.animating.add('scissor'); else rt.animating.delete('scissor'); return; }
    rt.animating.delete('scissor');
    const x = Math.max(0, Math.floor(fr.x0) - 2), y = Math.max(0, Math.floor(H - fr.y1) - 2);
    const w = Math.min(W - x, Math.ceil(fr.w) + 4), h = Math.min(H - y, Math.ceil(fr.h) + 4);
    gl.setScissor(x, y, w, h);
    gl.setScissorTest(true);
    Object.assign(rt.scissor, { on: true, x, y, w, h });
  }, -1);
  useEffect(() => () => gl.setScissorTest(false), [gl]);
  return null;
}

/**
 * High tier post-processing: SMAA always, Bloom (threshold 0.85, so only emissive values above 1 bloom) and
 * Vignette only in Live lighting. The composer's buffers and SMAA's edge / weight targets are scissored to the
 * free rect like the main render, which keeps the High tier usable on software rasterizers.
 */
function Post() {
  const quality = useStore((s) => s.quality);
  const lighting = useStore((s) => s.lighting ?? 'review');
  const composer = useRef<EffectComposerImpl>(null);
  const smaa = useRef<SMAAEffect>(null);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    const c = composer.current; if (!c) return;
    const dpr = gl.getPixelRatio();
    const sc = rt.scissor;
    const targets: THREE.WebGLRenderTarget[] = [c.inputBuffer, c.outputBuffer];
    const fx = smaa.current as unknown as { renderTargetEdges?: THREE.WebGLRenderTarget; renderTargetWeights?: THREE.WebGLRenderTarget } | null;
    if (fx?.renderTargetEdges) targets.push(fx.renderTargetEdges);
    if (fx?.renderTargetWeights) targets.push(fx.renderTargetWeights);
    for (const t of targets) {
      t.scissorTest = sc.on;
      if (sc.on) t.scissor.set(Math.floor(sc.x * dpr), Math.floor(sc.y * dpr), Math.ceil(sc.w * dpr), Math.ceil(sc.h * dpr));
    }
  }, 0);
  if (quality !== 'high') return null;
  const live = lighting === 'live';
  return (
    <EffectComposer ref={composer} multisampling={0} enableNormalPass={false} frameBufferType={live ? THREE.HalfFloatType : THREE.UnsignedByteType}>
      {live ? <Bloom mipmapBlur levels={3} resolutionScale={0.5} intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.6} /> : <></>}
      {live ? <Vignette eskil={false} offset={0.2} darkness={0.5} /> : <></>}
      <SMAA ref={smaa} preset={SMAAPreset.LOW} />
    </EffectComposer>
  );
}

function Cleanup() {
  useEffect(() => () => disposeAssets(), []);
  return null;
}

function SceneContents({ layer }: { layer: React.RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <Lighting />
      <Ground />
      <SiteProps />
      <GroundsPads />
      <BuildingField />
      <Hero />
      <Workers />
      <SelectionFx />
      <ScanSweep />
      <PlanCamera />
      <CameraRig />
      <SimClock />
      <Animator />
      <LabelLayerDriver layer={layer} />
      <TestHooks />
      <FreeRectScissor />
      <Post />
      <Cleanup />
    </>
  );
}

const dprFor = (quality: 'high' | 'fast') => {
  const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  const budget = quality === 'high' ? 3.7e6 : 2.1e6;
  return Math.min(2, Math.max(0.75, Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / (W * H)))));
};

export function Scene() {
  const quality = useStore((s) => s.quality);
  const view = useStore((s) => s.view ?? 'map');
  const playing = useStore((s) => s.sim.playing);
  const running = useStore((s) => s.extraction.running);
  const { roster } = useDerived();
  const layer = useRef<HTMLDivElement>(null);
  const [dpr, setDpr] = useState(() => dprFor(quality));
  useEffect(() => {
    const on = () => setDpr(dprFor(quality));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [quality]);
  useEffect(() => { clock.playing = playing; }, [playing]);
  // the shell may set the time or speed through the store (scrubber, peak-hour default, tests): follow it
  useEffect(() => useStore.subscribe((s, p) => {
    if (s.sim !== p.sim) {
      if (Math.abs(s.sim.time - clock.time) > 0.02) clock.time = s.sim.time;
      if (s.sim.speed !== clock.speed) clock.speed = s.sim.speed;
      clock.playing = s.sim.playing;
    }
  }), []);
  const frameloop = view === 'table' ? 'never' : (playing && roster.length > 0) || running ? 'always' : 'demand';
  const gl = useMemo(() => ({ antialias: false, powerPreference: 'high-performance' as const, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0, stencil: false }), []);
  return (
    <div className="scene-root">
      <Canvas frameloop={frameloop} dpr={dpr} shadows="percentage" gl={gl}
        camera={{ position: [140, 150, 200], fov: 42, near: 0.5, far: 6000 }}
        onPointerMissed={() => useStore.getState().setSelectedAgent(null)}>
        <Suspense fallback={null}>
          <SceneContents layer={layer} />
        </Suspense>
      </Canvas>
      <div className="label-layer" ref={layer} />
    </div>
  );
}

export type { Box2 };
