// Grounds pads (UI spec §9.6): one instanced mesh per grounds kind with the shared kind texture (UVs scaled per
// zone to w/5 × d/5), a crisp 1 px border in the shader, highlight state per instance and no Html.
import { memo, useEffect, useMemo, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { GroundsKind } from '@shared/types';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { ZONE_COLORS, type ZonePlacement } from './layout';
import { padMaterial } from './assets';
import { hoverFromScene } from './hover';
import { rt } from './runtime';

const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const s0 = new THREE.Vector3();
const PAD = { normal: 0, hover: 1, selected: 2, dim: 3, recent: 4 } as const;
/** a pad found by the reader flashes white this long (the same window as a building's "just found" edge) */
const RECENT_MS = 2500;

/** ZONE_COLORS desaturated 15% */
export const padColor = (k: GroundsKind) => { const c = new THREE.Color(ZONE_COLORS[k]); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s * 0.85, hsl.l); return `#${c.getHexString()}`; };

interface KindBatch { kind: GroundsKind; attached: boolean; mesh: THREE.InstancedMesh; zones: ZonePlacement[]; uvs: THREE.InstancedBufferAttribute; state: THREE.InstancedBufferAttribute }

export const GroundsPads = memo(function GroundsPads() {
  const { layout } = useDerived();
  const invalidate = useThree((s) => s.invalidate);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId ?? null);
  const filterIds = useStore((s) => s.filterIds ?? null);
  const focusMode = useStore((s) => s.focusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const recentIds = useStore((s) => s.extraction.recentIds);
  const recentAt = useStore((s) => s.extraction.recent);
  const [tick, setTick] = useState(0);
  const fast = useStore((s) => s.quality) !== 'high';

  const batches = useMemo(() => {
    if (!layout) return [] as KindBatch[];
    // one batch per kind and attachment: site-wide areas never carry building shadows, so they always use the
    // cheap unlit material; pads on building lots receive shadows in the High tier and, in every tier, keep no night
    // floor on their face (only on the rim), so their turf goes dark at night like the lot it covers
    const byKind = new Map<string, ZonePlacement[]>();
    for (const z of layout.zones) { const k = `${z.kind}|${z.facilityId ? 'a' : 'l'}`; const a = byKind.get(k) ?? []; a.push(z); byKind.set(k, a); }
    const out: KindBatch[] = [];
    for (const [key, zones] of byKind) {
      const kind = zones[0].kind; const attached = key.endsWith('|a');
      const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      const uvs = new THREE.InstancedBufferAttribute(new Float32Array(zones.length * 2), 2);
      const state = new THREE.InstancedBufferAttribute(new Float32Array(zones.length), 1);
      geo.setAttribute('aUvScale', uvs); geo.setAttribute('aPadState', state);
      const mesh = new THREE.InstancedMesh(geo, padMaterial(kind, padColor(kind), true, ZONE_COLORS[kind], attached), zones.length);
      zones.forEach((z, i) => {
        const y = z.facilityId ? 0.085 : 0.05;
        m4.compose(v0.set(z.box.x, y, z.box.z), q0, s0.set(z.box.w, 1, z.box.d)); mesh.setMatrixAt(i, m4);
        uvs.setXY(i, Math.max(1, Math.round(z.box.w / 5)), Math.max(1, Math.round(z.box.d / 5)));
      });
      mesh.receiveShadow = attached; mesh.name = `pads-${kind}`; mesh.renderOrder = -2;
      mesh.userData.ids = zones.map((z) => z.id);
      mesh.computeBoundingSphere();
      out.push({ kind, attached, mesh, zones, uvs, state });
    }
    return out;
  }, [layout]);
  useEffect(() => () => { for (const b of batches) b.mesh.geometry.dispose(); }, [batches]);
  useEffect(() => { for (const b of batches) b.mesh.material = padMaterial(b.kind, padColor(b.kind), fast || !b.attached, ZONE_COLORS[b.kind], b.attached); invalidate(); }, [batches, fast, invalidate]);

  useEffect(() => {
    const selId = selection.kind === 'grounds' ? selection.id : null;
    const parent = selection.kind === 'facility' && focusMode === 'building' && buildingTab === 'grounds' ? selection.id : null;
    // "just found" is a short flash, not a state that lingers after the read (it used to keep a cyan rim for good)
    const now = Date.now();
    let nextExpiry = Infinity;
    const recent = new Set<string>();
    for (const id of recentIds ?? []) { const t = recentAt?.[id]; if (t != null && now - t < RECENT_MS) { recent.add(id); nextExpiry = Math.min(nextExpiry, t + RECENT_MS); } }
    for (const b of batches) {
      b.zones.forEach((z, i) => {
        let st: number = PAD.normal;
        if (z.id === selId || (parent && z.facilityId === parent)) st = PAD.selected;
        else if (filterIds && !filterIds.has(z.id)) st = PAD.dim;
        else if (recent.has(z.id)) st = PAD.recent;
        else if (z.id === hoverId) st = PAD.hover;
        b.state.setX(i, st);
      });
      b.state.needsUpdate = true;
    }
    invalidate();
    if (!recent.size) { rt.animating.delete('pad-recent'); return; }
    rt.animating.add('pad-recent');
    const timer = setTimeout(() => { rt.animating.delete('pad-recent'); setTick((x) => x + 1); invalidate(); }, Math.max(50, nextExpiry - now + 20));
    return () => { clearTimeout(timer); rt.animating.delete('pad-recent'); };
  }, [batches, selection, hoverId, filterIds, focusMode, buildingTab, recentIds, recentAt, tick, invalidate]);

  const idOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => { const ids = (e.object as THREE.InstancedMesh).userData.ids as string[] | undefined; return e.instanceId != null && ids ? ids[e.instanceId] : null; };
  const onMove = (e: ThreeEvent<PointerEvent>) => { const id = idOf(e); if (!id) return; e.stopPropagation(); hoverFromScene(id); };
  const onOut = (e: ThreeEvent<PointerEvent>) => { const id = idOf(e); if (id && useStore.getState().hoverId === id) hoverFromScene(null); };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    const id = idOf(e); if (!id) return;
    const s = useStore.getState();
    if (s.focusMode === 'building') return; // inside a building the pads are context, not targets
    e.stopPropagation();
    select({ kind: 'grounds', id });
  };

  return (
    <group>
      {batches.map((b) => <primitive key={`${b.kind}-${b.attached}`} object={b.mesh} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />)}
    </group>
  );
});
