// Instanced building field (UI spec §9.5): one InstancedMesh per facade style (3 draw calls) for every in-scope
// building except the hero, plus one instanced contact-shadow blob mesh. Layout identity changes rebuild matrices
// and attributes; estimate / colour / hover / filter changes only rewrite the colour and state attributes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Facility } from '@shared/types';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { buildingTint, NEUTRAL_ROOF } from '../components/lib/theme';
import type { BuildingPlacement, SiteLayout } from './layout';
import { BAYS, fieldMaterial, seeded, std, STYLES, styleOf, type FacadeStyle } from './assets';
import { requestShadow, rt } from './runtime';
import { hoverFromScene } from './hover';

export const STATE = { normal: 0, hover: 1, hidden: 2, dim: 3, ghost: 4, recent: 5, refound: 6 } as const;
const RECENT_MS = 2500;
/** Obsidian massing: close neutral graphite walls; the category hue lives in the roof (aRoof) and only tints the walls 8%. */
export const WALL_BASE = new THREE.Color('#878787');
export const WALL_TINT = 0.08;

interface Batch { style: FacadeStyle; mesh: THREE.InstancedMesh; cap: number; ids: string[]; placements: BuildingPlacement[]; roof: THREE.InstancedBufferAttribute; dims: THREE.InstancedBufferAttribute; floors: THREE.InstancedBufferAttribute; state: THREE.InstancedBufferAttribute; seed: THREE.InstancedBufferAttribute; born: THREE.InstancedBufferAttribute }

function makeBatch(style: FacadeStyle, cap: number): Batch {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const attr = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const roof = attr(3), dims = attr(3), floors = attr(1), state = attr(1), seed = attr(1), born = attr(1);
  born.array.fill(-1e6);
  geo.setAttribute('aRoof', roof); geo.setAttribute('aDims', dims); geo.setAttribute('aFloors', floors); geo.setAttribute('aState', state); geo.setAttribute('aSeed', seed); geo.setAttribute('aBorn', born);
  const mesh = new THREE.InstancedMesh(geo, fieldMaterial(style), cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0;
  mesh.name = `field-${style}`; mesh.renderOrder = -3; // first: occludes lots and ground (early depth rejection)
  return { style, mesh, cap, ids: [], placements: [], roof, dims, floors, state, seed, born };
}

const capFor = (n: number) => { let c = 16; while (c < n) c *= 2; return c; };
const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const s0 = new THREE.Vector3();
const c0 = new THREE.Color();
const c1 = new THREE.Color();

function setBoundingSphere(mesh: THREE.InstancedMesh, layout: SiteLayout) {
  const b = layout.bounds;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(b.x, layout.maxHeight / 2, b.z), Math.hypot(b.w, b.d) / 2 + 10 + layout.maxHeight);
  mesh.boundingBox = new THREE.Box3(new THREE.Vector3(b.x - b.w / 2 - 10, 0, b.z - b.d / 2 - 10), new THREE.Vector3(b.x + b.w / 2 + 10, layout.maxHeight + 10, b.z + b.d / 2 + 10));
}

/** Per-facility facts the tint and labels need, keyed by id. */
export function useFacilityMap(): Map<string, Facility> {
  const facilities = useStore((s) => s.project?.inventory.facilities);
  return useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f])), [facilities]);
}

export function tintFor(id: string, cat: BuildingPlacement['category'], ctx: { colorBy: Parameters<typeof buildingTint>[0]; fmap: Map<string, Facility>; d: ReturnType<typeof useDerived>; neutral: boolean }): string {
  if (ctx.neutral) return NEUTRAL_ROOF;
  const f = ctx.fmap.get(id);
  const meta = ctx.d.rowMeta.get(id);
  return buildingTint(ctx.colorBy ?? 'category', { category: f?.category ?? cat, conf: f?.confidence ?? 1, review: meta?.review ?? 'ok', fte: ctx.d.estById.get(id)?.fte ?? 0, fteBreaks: ctx.d.fteBreaks });
}

export function BuildingField() {
  const d = useDerived();
  const { layout } = d;
  const invalidate = useThree((s) => s.invalidate);
  const fmap = useFacilityMap();
  const colorBy = useStore((s) => s.colorBy ?? 'category');
  const lighting = useStore((s) => s.lighting ?? 'review');
  const crewFilter = useStore((s) => s.crewFilter);
  const hoverId = useStore((s) => s.hoverId ?? null);
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const filterIds = useStore((s) => s.filterIds ?? null);
  const recentIds = useStore((s) => s.extraction.recentIds);
  const recent = useStore((s) => s.extraction.recent);
  const running = useStore((s) => s.extraction.running);
  const stagingActive = useStore((s) => s.extraction.staging?.active ?? false);
  const seenIds = useStore((s) => s.extraction.staging?.seenIds);
  const reducedMotion = useStore((s) => s.reducedMotion ?? false);
  const select = useStore((s) => s.select);
  const setFocusMode = useStore((s) => s.setFocusMode);

  const batchesRef = useRef<Record<FacadeStyle, Batch> | null>(null);
  const byId = useRef(new Map<string, { b: Batch; i: number }>());
  const prevIds = useRef<Set<string> | null>(null);
  const hiddenId = useRef<string | null>(null);
  const lastStates = useRef(new Map<string, number>());
  /** superseded ghosts during a re-read, and the ids just re-found (600 ms --ok edge pulse) */
  const ghosted = useRef(new Set<string>());
  const refound = useRef(new Map<string, number>());
  const [, setTick] = useState(0);

  // ---- batches sized to the layout (grown in powers of two so streaming does not remount every flush)
  const counts = useMemo(() => {
    const c: Record<FacadeStyle, number> = { office: 0, barracks: 0, industrial: 0 };
    for (const b of layout?.buildings ?? []) c[styleOf(b.category)]++;
    return c;
  }, [layout]);
  const caps = `${capFor(counts.office)}.${capFor(counts.barracks)}.${capFor(counts.industrial)}`;
  const batches = useMemo(() => {
    const [o, b, i] = caps.split('.').map(Number);
    const next = { office: makeBatch('office', o), barracks: makeBatch('barracks', b), industrial: makeBatch('industrial', i) };
    return next;
  }, [caps]);
  useEffect(() => { batchesRef.current = batches; return () => { for (const s of STYLES) batches[s].mesh.geometry.dispose(); }; }, [batches]);


  // ---- rooftop units (≤ 2 per building, seeded) and entrance canopies: one draw call each, shown when close
  const details = useMemo(() => {
    if (!layout) return null;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const rtus: { x: number; y: number; z: number; w: number; h: number; d: number; id: string }[] = [];
    const canopies: typeof rtus = [];
    for (const p of layout.buildings) {
      const rnd = seeded(p.id + 'roof');
      const h = Math.max(0.6, p.height);
      const area = p.box.w * p.box.d;
      const n = area > 60 ? 1 + Math.floor(rnd() * 2) : area > 20 ? 1 : 0;
      for (let i = 0; i < n; i++) { const uh = 0.45 + rnd() * 0.5; rtus.push({ x: p.box.x + (rnd() - 0.5) * p.box.w * 0.55, y: h + uh / 2, z: p.box.z + (rnd() - 0.5) * p.box.d * 0.55, w: 0.8 + rnd() * 1.3, h: uh, d: 0.8 + rnd() * 1.1, id: p.id }); }
      if (styleOf(p.category) !== 'industrial') canopies.push({ x: p.box.x, y: 1.15, z: p.box.z + p.box.d / 2 + 0.5, w: Math.min(3.2, p.box.w * 0.4), h: 0.12, d: 1.0, id: p.id });
    }
    const mk = (items: typeof rtus, color: string, name: string) => {
      const mesh = new THREE.InstancedMesh(unit, std(`field-${name}`, { color }), Math.max(1, items.length));
      items.forEach((it, i) => { m4.compose(v0.set(it.x, it.y, it.z), q0, s0.set(it.w, it.h, it.d)); mesh.setMatrixAt(i, m4); });
      mesh.count = items.length; mesh.name = `field-${name}`; mesh.raycast = () => {}; mesh.castShadow = true; mesh.renderOrder = -3;
      setBoundingSphere(mesh, layout);
      mesh.userData.ids = items.map((it) => it.id);
      mesh.userData.base = mesh.instanceMatrix.array.slice();
      return mesh;
    };
    return { unit, rtu: mk(rtus, '#8c8c8c', 'rtu'), canopy: mk(canopies, '#a9a9a9', 'canopy') };
  }, [layout]);
  useEffect(() => () => details?.unit.dispose(), [details]);
  // the hero's own units and canopy hide while its cut-away interior shows
  const buildingTab = useStore((s) => s.buildingTab);
  useEffect(() => {
    if (!details) return;
    const hide = focusMode === 'building' && buildingTab === 'interior' && selection.kind === 'facility' ? selection.id : null;
    for (const m of [details.rtu, details.canopy]) {
      const ids = m.userData.ids as string[]; const base = m.userData.base as Float32Array; const arr = m.instanceMatrix.array as Float32Array;
      arr.set(base);
      if (hide) ids.forEach((id, i) => { if (id === hide) arr.fill(0, i * 16, i * 16 + 16); });
      m.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  }, [details, focusMode, buildingTab, selection, invalidate]);
  const camera = useThree((s) => s.camera);
  const getState = useThree((s) => s.get);
  useFrame(() => {
    if (!details || !layout) return;
    const ctl = getState().controls as unknown as { target?: THREE.Vector3 } | null;
    const R = Math.hypot(layout.bounds.w, layout.bounds.d) / 2;
    const near = ctl?.target != null && camera.position.distanceTo(ctl.target) < Math.max(160, 0.45 * R);
    if (details.rtu.visible !== near) { details.rtu.visible = near; details.canopy.visible = near; }
  });

  // ---- layout → matrices, dims, floors, seeds, spawn times
  useEffect(() => {
    byId.current.clear();
    for (const s of STYLES) { batches[s].ids = []; batches[s].placements = []; }
    if (!layout) { for (const s of STYLES) batches[s].mesh.count = 0; prevIds.current = null; invalidate(); return; }
    const now = performance.now() / 1000;
    const prev = prevIds.current;
    let spawned = false;
    for (const p of layout.buildings) {
      const b = batches[styleOf(p.category)];
      const i = b.ids.length;
      b.ids.push(p.id); b.placements.push(p);
      byId.current.set(p.id, { b, i });
      const h = Math.max(0.6, p.height);
      m4.compose(v0.set(p.box.x, h / 2, p.box.z), q0, s0.set(p.box.w, h, p.box.d));
      b.mesh.setMatrixAt(i, m4);
      b.dims.setXYZ(i, p.box.w, h, p.box.d);
      b.floors.setX(i, Math.max(1, p.floors));
      const rnd = seeded(p.id);
      b.seed.setX(i, Math.floor(rnd() * BAYS[b.style].bays) / BAYS[b.style].bays);
      const isNew = prev != null && !prev.has(p.id) && running && !reducedMotion;
      b.born.setX(i, isNew ? now : -1e6);
      if (isNew) spawned = true;
    }
    for (const s of STYLES) {
      const b = batches[s];
      b.mesh.count = b.ids.length;
      b.mesh.instanceMatrix.needsUpdate = true;
      for (const a of [b.dims, b.floors, b.seed, b.born]) a.needsUpdate = true;
      setBoundingSphere(b.mesh, layout);
      b.mesh.userData.ids = b.ids;
    }
    prevIds.current = new Set(layout.buildings.map((b) => b.id));
    hiddenId.current = null; lastStates.current.clear();
    if (spawned) { rt.animating.add('spawn'); setTimeout(() => { rt.animating.delete('spawn'); requestShadow(); invalidate(); }, 750); }
    requestShadow();
    invalidate();
  }, [layout, batches]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- colours: roof = buildingTint, walls = mix(WALL_BASE graphite, tint, WALL_TINT)
  useEffect(() => {
    if (!layout) return;
    // a crew filter hands the colour to the crews (scene colour owner); Live keeps roof colours readable at night (S9)
    const neutral = crewFilter != null;
    const ctx = { colorBy, fmap, d, neutral };
    for (const s of STYLES) {
      const b = batches[s];
      b.ids.forEach((id, i) => {
        c0.set(tintFor(id, b.placements[i].category, ctx));
        b.roof.setXYZ(i, c0.r, c0.g, c0.b);
        c1.copy(WALL_BASE).lerp(c0, WALL_TINT);
        b.mesh.instanceColor!.setXYZ(i, c1.r, c1.g, c1.b);
      });
      b.roof.needsUpdate = true; b.mesh.instanceColor!.needsUpdate = true;
    }
    invalidate();
  }, [layout, batches, colorBy, lighting, crewFilter, fmap, d.estById, d.rowMeta, d.fteBreaks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- states: hover / hero hidden / dimmed / ghost / recent
  useEffect(() => {
    if (!layout) return;
    const selId = selection.kind === 'facility' ? selection.id : null;
    const focused = focusMode === 'building' && selId != null;
    const now = Date.now();
    const recentSet = new Set<string>();
    let nextExpiry = Infinity;
    for (const id of recentIds ?? []) { const t = recent?.[id]; if (t != null && now - t < RECENT_MS) { recentSet.add(id); nextExpiry = Math.min(nextExpiry, t + RECENT_MS); } }
    const changed: { b: Batch; i: number }[] = [];
    for (const s of STYLES) {
      const b = batches[s];
      b.ids.forEach((id, i) => {
        let st: number = STATE.normal;
        if (id === selId) st = STATE.hidden;
        else if (focused || (filterIds && !filterIds.has(id))) st = STATE.dim;
        else if (stagingActive && seenIds && !seenIds.has(id)) { st = STATE.ghost; ghosted.current.add(id); }
        else if ((refound.current.get(id) ?? 0) > now) st = STATE.refound;
        else if (ghosted.current.has(id) && stagingActive) { ghosted.current.delete(id); refound.current.set(id, now + 600); st = STATE.refound; nextExpiry = Math.min(nextExpiry, now + 600); }
        else if (recentSet.has(id)) st = STATE.recent;
        else if (id === hoverId) st = STATE.hover;
        if (b.state.getX(i) !== st || lastStates.current.get(id) !== st) { b.state.setX(i, st); lastStates.current.set(id, st); changed.push({ b, i }); }
      });
    }
    // hero: scale its field instance to 0, restore the previous one
    if (hiddenId.current !== selId) {
      const restore = hiddenId.current ? byId.current.get(hiddenId.current) : null;
      if (restore) { const p = restore.b.placements[restore.i]; const h = Math.max(0.6, p.height); m4.compose(v0.set(p.box.x, h / 2, p.box.z), q0, s0.set(p.box.w, h, p.box.d)); restore.b.mesh.setMatrixAt(restore.i, m4); restore.b.mesh.instanceMatrix.needsUpdate = true; }
      const hide = selId ? byId.current.get(selId) : null;
      if (hide) { m4.makeScale(0, 0, 0); hide.b.mesh.setMatrixAt(hide.i, m4); hide.b.mesh.instanceMatrix.needsUpdate = true; }
      hiddenId.current = selId;
      requestShadow();
    }
    if (changed.length && changed.length <= 2) {
      // hover in / out: upload only the touched instances
      for (const b of new Set(changed.map((c) => c.b))) b.state.clearUpdateRanges();
      for (const { b, i } of changed) { b.state.addUpdateRange(i, 1); b.state.needsUpdate = true; }
    } else if (changed.length) {
      for (const s of STYLES) { batches[s].state.clearUpdateRanges(); batches[s].state.needsUpdate = true; }
    }
    if (!stagingActive) ghosted.current.clear();
    for (const [id, t] of refound.current) { if (t <= now) refound.current.delete(id); else nextExpiry = Math.min(nextExpiry, t); }
    if (recentSet.size || refound.current.size) {
      rt.animating.add('recent');
      const t = setTimeout(() => { rt.animating.delete('recent'); invalidate(); setTick((x) => x + 1); }, Math.max(50, nextExpiry - now + 20));
      invalidate();
      return () => clearTimeout(t);
    }
    rt.animating.delete('recent');
    invalidate();
  }); // runs after every render; cheap (≤ 420 compares) and keeps timers simple

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const ids = (e.object as THREE.InstancedMesh).userData.ids as string[] | undefined;
    if (e.instanceId == null || !ids) return;
    e.stopPropagation();
    hoverFromScene(ids[e.instanceId]);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const ids = (e.object as THREE.InstancedMesh).userData.ids as string[] | undefined;
    const id = e.instanceId != null && ids ? ids[e.instanceId] : null;
    if (id && useStore.getState().hoverId === id) hoverFromScene(null);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    const ids = (e.object as THREE.InstancedMesh).userData.ids as string[] | undefined;
    if (e.instanceId == null || !ids) return;
    e.stopPropagation();
    const id = ids[e.instanceId];
    const s = useStore.getState();
    if (s.selection.kind === 'facility' && s.selection.id === id) return;
    select({ kind: 'facility', id });
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    const ids = (e.object as THREE.InstancedMesh).userData.ids as string[] | undefined;
    if (e.instanceId == null || !ids) return;
    e.stopPropagation();
    select({ kind: 'facility', id: ids[e.instanceId] });
    setFocusMode('building');
  };

  if (!layout) return null;
  return (
    <group>
      {STYLES.map((s) => <primitive key={`${s}-${batches[s].cap}`} object={batches[s].mesh} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} onDoubleClick={onDouble} />)}
      {details && details.rtu.count > 0 && <primitive object={details.rtu} />}
      {details && details.canopy.count > 0 && <primitive object={details.canopy} />}
    </group>
  );
}
