// The 3D site view (UI spec §9). The canvas always fills the window under the opaque shell panels; the free
// rect is handled with a camera view offset, so panel changes never resize the WebGL buffer. Labels, the hover
// tooltip and the worker card live in one DOM layer next to the canvas.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import { SMAAPreset, type BloomEffect as BloomEffectImpl, type EffectComposer as EffectComposerImpl, type SMAAEffect } from 'postprocessing';
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
import { freeRect, insets, insetsSettling } from './insets';
import { PerfGovernor, usePerfLevel } from './perf';
import type { Box2 } from './layout';

export { dayFactor, nightFactor } from './Lighting';

/**
 * Advances the non-reactive clock every frame and mirrors it into the store for the shell's dock: once a second,
 * and only every 5 s while a run streams (the shell's coalesced extraction flushes already use most of the
 * ≤ 4 store writes/s budget then).
 */
function SimClock() {
  const simSet = useStore((s) => s.simSet);
  const last = useRef(0);
  useFrame((_, dt) => {
    if (clock.playing) clock.time = (clock.time + (Math.min(dt, 0.1) * clock.speed) / 60) % 24;
    last.current += dt;
    const every = useStore.getState().extraction.running ? 5 : 1;
    if (last.current > every) { last.current = 0; if (clock.playing) simSet({ time: clock.time }); }
  });
  return null;
}

/**
 * Follows sim changes made outside the render loop (the dock's clock slider, "Jump to hh:mm", the peak-hour
 * default, tests calling simSet). The shell often writes `clock` directly before `simSet`, so every sim change
 * counts: in the demand frameloop nothing else would render the new time (crews, Live sky and sun, agents()).
 */
function SimFollower() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => useStore.subscribe((s, p) => {
    if (s.sim === p.sim) return;
    const jumped = Math.abs(s.sim.time - p.sim.time) > 1e-6 || Math.abs(s.sim.time - clock.time) > 0.02;
    if (Math.abs(s.sim.time - clock.time) > 0.02) clock.time = s.sim.time;
    if (s.sim.speed !== clock.speed) clock.speed = s.sim.speed;
    clock.playing = s.sim.playing;
    // the Live sun follows the clock: a time jump needs a fresh shadow map at once, not at the next 1 Hz refresh
    if (jumped && !s.sim.playing && (s.lighting ?? 'review') === 'live') rt.shadowDirty = true;
    invalidate();
  }), [invalidate]);
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
    const full = insetsSettling() || now < until.current || (fr.w >= W - 1 && fr.h >= H - 1);
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
 * Vignette only in Live lighting. Every render target in the chain (composer buffers, SMAA edges / weights, the
 * bloom's luminance and mip chain) is scissored to the free rect like the main render, and the bloom's
 * luminance pass and mip chain run at half resolution: on software rasterizers the full-size luminance pass
 * and mip chain cost more than the scene itself.
 */
type BloomInternals = {
  luminancePass: { renderTarget: THREE.WebGLRenderTarget; resolution: { scale: number } };
  mipmapBlurPass: { downsamplingMipmaps: THREE.WebGLRenderTarget[]; upsamplingMipmaps: THREE.WebGLRenderTarget[]; setSize(w: number, h: number): void; __half?: boolean };
};
const BLOOM_SCALE = 0.5;
function Post() {
  const quality = useStore((s) => s.quality);
  const lighting = useStore((s) => s.lighting ?? 'review');
  const live = lighting === 'live';
  const level = usePerfLevel();
  const composer = useRef<EffectComposerImpl>(null);
  const smaa = useRef<SMAAEffect>(null);
  const bloom = useRef<BloomEffectImpl>(null);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    const c = composer.current; if (!c) return;
    const dpr = gl.getPixelRatio();
    const sc = rt.scissor;
    const cw = gl.domElement.width, ch = gl.domElement.height;
    // scissor a target of any size to the free rect (+ a margin of `pad` target pixels for blur taps)
    const clip = (t: THREE.WebGLRenderTarget, pad: number) => {
      t.scissorTest = sc.on;
      if (!sc.on) return;
      const kx = (t.width / cw) * dpr, ky = (t.height / ch) * dpr;
      t.scissor.set(Math.max(0, Math.floor(sc.x * kx) - pad), Math.max(0, Math.floor(sc.y * ky) - pad), Math.ceil(sc.w * kx) + 2 * pad, Math.ceil(sc.h * ky) + 2 * pad);
    };
    clip(c.inputBuffer, 0); clip(c.outputBuffer, 0);
    const fx = smaa.current as unknown as { renderTargetEdges?: THREE.WebGLRenderTarget; renderTargetWeights?: THREE.WebGLRenderTarget } | null;
    if (fx?.renderTargetEdges) clip(fx.renderTargetEdges, 0);
    if (fx?.renderTargetWeights) clip(fx.renderTargetWeights, 0);
    const bl = bloom.current as unknown as BloomInternals | null;
    if (bl) {
      // the mip chain normally starts at half the canvas size: start it at half of the (already half-size) luminance
      const mp = bl.mipmapBlurPass;
      if (!mp.__half) {
        const setSize = mp.setSize.bind(mp);
        mp.setSize = (w, h) => setSize(Math.max(1, Math.round(w * BLOOM_SCALE)), Math.max(1, Math.round(h * BLOOM_SCALE)));
        mp.__half = true;
        mp.setSize(cw, ch);
      }
      if (bl.luminancePass.resolution.scale !== BLOOM_SCALE) bl.luminancePass.resolution.scale = BLOOM_SCALE;
      clip(bl.luminancePass.renderTarget, 4);
      for (const t of mp.downsamplingMipmaps) clip(t, 4);
      for (const t of mp.upsamplingMipmaps) clip(t, 4);
    }
  }, 0);
  // the frame-rate governor (perf.ts) sheds SMAA first, then (level 3) the Live glow, when High cannot hold 4 fps
  const aa = level < 1;
  const glow = live && level < 3;
  if (quality !== 'high' || (!aa && !glow)) return null;
  return (
    <EffectComposer ref={composer} multisampling={0} enableNormalPass={false} frameBufferType={glow ? THREE.HalfFloatType : THREE.UnsignedByteType}>
      {glow ? <Bloom ref={bloom} mipmapBlur levels={3} resolutionScale={0.5} intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.6} /> : <></>}
      {glow ? <Vignette eskil={false} offset={0.2} darkness={0.5} /> : <></>}
      {aa ? <SMAA ref={smaa} preset={SMAAPreset.LOW} /> : <></>}
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
      <SimFollower />
      <Animator />
      <LabelLayerDriver layer={layer} />
      <TestHooks />
      <FreeRectScissor />
      <PerfGovernor />
      <Post />
      <Cleanup />
    </>
  );
}

/** §9.4 DPR; at governor level ≥ 2 the High tier renders 25% fewer pixels per axis (still ≥ 0.75). */
const dprFor = (quality: 'high' | 'fast', level = 0) => {
  const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  const budget = quality === 'high' ? 3.7e6 : 2.1e6;
  const base = Math.min(2, Math.max(0.75, Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / (W * H)))));
  return quality === 'high' && level >= 2 ? Math.max(0.75, base * 0.75) : base;
};

export function Scene() {
  const quality = useStore((s) => s.quality);
  const view = useStore((s) => s.view ?? 'map');
  const playing = useStore((s) => s.sim.playing);
  const running = useStore((s) => s.extraction.running);
  const { roster } = useDerived();
  const layer = useRef<HTMLDivElement>(null);
  const level = usePerfLevel();
  const [dpr, setDpr] = useState(() => dprFor(quality, level));
  useEffect(() => {
    const on = () => setDpr(dprFor(quality, level));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [quality, level]);
  useEffect(() => { clock.playing = playing; }, [playing]);
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
