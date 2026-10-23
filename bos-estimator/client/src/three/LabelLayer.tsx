// One DOM label layer for the 3D view (UI spec §9.7): 160 pooled divs updated imperatively (no drei <Html>),
// level of detail by projected footprint (pin / chip / full), ranking, a free-area budget, collision-free packing
// inside the free rect that avoids [data-occluder] rects, the hover tooltip and the worker card.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CATEGORY_DEFAULTS, crewMeta } from '@shared/factors';
import type { Facility, GroundsArea } from '@shared/types';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { CONF_COLOR, CONF_GLYPH, REVIEW_COLOR, categoryColor, confBand, crewColor } from '../components/lib/theme';
import { n0 } from '../fmt';
import type { BuildingPlacement, ZonePlacement } from './layout';
import { freeRect, onInsetsChange } from './insets';
import { rt, type LabelOut } from './runtime';
import { hoverFromScene, hoverSrc } from './hover';
import { fmtTime } from './sim';
import { clock } from './clock';
import './labels.css';

const POOL = 160;
const PACK_MS = 200;
type Lod = 'chip' | 'full' | 'pin';
interface Rect { x0: number; y0: number; x1: number; y1: number }
interface Cand {
  key: string; id: string; kind: 'facility' | 'grounds'; rank: number; lod: Lod; sel: boolean; hov: boolean;
  anchor: THREE.Vector3; ax: number; ay: number; text: string; html: string; cls: string; stripe: string; pc: string; w: number; h: number; isNew: boolean;
  chipText?: string; l1?: string; l2?: string; l3?: string;
}
interface Placed { key: string; id: string; kind: 'facility' | 'grounds'; slot: Slot; anchor: THREE.Vector3; offX: number; offY: number; w: number; h: number; lod: Lod; text: string; isNew: boolean; x: number; y: number; visible: boolean; must?: boolean }
interface Slot { el: HTMLDivElement; key: string | null; cls: string; html: string; style: string; tx: string; on: boolean }

const _v = new THREE.Vector3();
const intersects = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ell = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Spatial hash (64 px cells) of placed rects. */
class Hash {
  cells = new Map<number, Rect[]>();
  private keys(r: Rect, f: (k: number) => void) { for (let cx = Math.floor(r.x0 / 64); cx <= Math.floor(r.x1 / 64); cx++) for (let cy = Math.floor(r.y0 / 64); cy <= Math.floor(r.y1 / 64); cy++) f(cx * 4096 + cy); }
  hit(r: Rect, pad: number) { let hit = false; this.keys({ x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad }, (k) => { if (hit) return; const c = this.cells.get(k); if (c) for (const o of c) if (intersects(r, o, pad)) { hit = true; return; } }); return hit; }
  add(r: Rect) { this.keys(r, (k) => { const c = this.cells.get(k); if (c) c.push(r); else this.cells.set(k, [r]); }); }
}

/** Text widths from canvas measureText with the real fonts (cached). */
const measurer = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  const cache = new Map<string, number>();
  let fonts = { sans: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' };
  const readFonts = () => {
    try { const cs = getComputedStyle(document.documentElement); fonts = { sans: cs.getPropertyValue('--font-sans').trim() || fonts.sans, mono: cs.getPropertyValue('--font-mono').trim() || fonts.mono }; } catch { /* keep defaults */ }
  };
  readFonts();
  try { document.fonts?.addEventListener?.('loadingdone', () => { cache.clear(); readFonts(); }); } catch { /* no font loading API */ }
  return {
    width(text: string, font: 'chip' | 'l1' | 'l2' | 'zone'): number {
      const k = `${font}|${text}`; const hit = cache.get(k); if (hit != null) return hit;
      if (!ctx) ctx = document.createElement('canvas').getContext('2d');
      let w = text.length * 7.2;
      if (ctx) {
        ctx.font = font === 'chip' ? `500 12px ${fonts.mono}` : font === 'l1' ? `500 12.5px ${fonts.sans}` : font === 'l2' ? `400 11.5px ${fonts.mono}` : `500 11.5px ${fonts.sans}`;
        w = ctx.measureText(text).width;
      }
      cache.set(k, w); if (cache.size > 6000) cache.clear();
      return w;
    },
  };
})();

const qtyText = (g: GroundsArea) => {
  const q = g.quantity;
  switch (g.unit) {
    case 'acres': return `${q >= 100 ? n0(q) : q.toFixed(1)} ac`;
    case 'hectares': return `${q >= 100 ? n0(q) : q.toFixed(1)} ha`;
    case 'sqft': return `${n0(q)} SF`;
    case 'sqm': return `${n0(q)} m²`;
    case 'sqyd': return `${n0(q)} SY`;
    case 'lf': return `${n0(q)} LF`;
    default: return g.kind === 'tree_canopy' ? `${n0(q)} trees` : `${n0(q)} ea`;
  }
};

const KIND_SHORT: Record<string, string> = { improved_turf: 'Improved', semi_improved: 'Semi-impr.', unimproved: 'Unimproved', athletic_field: 'Athletic', shrub_bed: 'Beds', parking: 'Parking', sidewalk: 'Walks', tree_canopy: 'Trees' };
/** "TA 01 Unimproved · 9,761 ac": the area's code (or a short name), its kind, and the real quantity. */
function zoneChipText(g: GroundsArea): string {
  const name = (g.name || '').trim();
  const code = /^([A-Z]{1,4}[- ]?\d{1,3}[A-Z]?)\b/.exec(name)?.[1];
  const head = code ? `${code} ${KIND_SHORT[g.kind] ?? ''}`.trim() : ell(name || KIND_SHORT[g.kind] || 'Grounds', 18);
  return `${head} · ${qtyText(g)}`;
}

export function readOccluders(): Rect[] {
  const out: Rect[] = [];
  document.querySelectorAll('[data-occluder]').forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el as HTMLElement);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return;
    out.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 });
  });
  return out;
}

export function LabelLayerDriver({ layer }: { layer: React.RefObject<HTMLDivElement | null> }) {
  const d = useDerived();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const events = useThree((s) => s.events);
  const facilities = useStore((s) => s.project?.inventory.facilities);
  const grounds = useStore((s) => s.project?.inventory.grounds);
  const view = useStore((s) => s.view ?? 'map');
  const reducedMotion = useStore((s) => s.reducedMotion ?? false);
  const fmap = useMemo(() => new Map((facilities ?? []).map((f) => [f.id, f] as [string, Facility])), [facilities]);
  const gmap = useMemo(() => new Map((grounds ?? []).map((g) => [g.id, g] as [string, GroundsArea])), [grounds]);
  const bmap = useMemo(() => new Map((d.layout?.buildings ?? []).map((b) => [b.id, b] as [string, BuildingPlacement])), [d.layout]);
  const zmap = useMemo(() => new Map((d.layout?.zones ?? []).map((z) => [z.id, z] as [string, ZonePlacement])), [d.layout]);
  // FTE percentile per building (ranking of ordinary buildings)
  const ftePct = useMemo(() => {
    const arr = [...d.estById.values()].map((e) => ({ id: e.facilityId, fte: e.fte })).sort((a, b) => a.fte - b.fte);
    const m = new Map<string, number>(); arr.forEach((x, i) => m.set(x.id, arr.length > 1 ? (i / (arr.length - 1)) * 100 : 50)); return m;
  }, [d.estById]);
  const zonePct = useMemo(() => {
    const arr = [...(d.layout?.zones ?? [])].sort((a, b) => a.box.w * a.box.d - b.box.w * b.box.d);
    const m = new Map<string, number>(); arr.forEach((z, i) => m.set(z.id, arr.length > 1 ? (i / (arr.length - 1)) * 50 : 25)); return m;
  }, [d.layout]);

  const S = useRef({
    slots: [] as Slot[], tip: null as HTMLDivElement | null, card: null as HTMLDivElement | null,
    placed: [] as Placed[], dirty: true, lastPack: 0, camSig: '', restTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    occ: [] as Rect[], occSig: '', tipId: null as string | null, tipSince: 0, tipHtml: '', cardHtml: '', cardAt: 0, drag: null as null | { x: number; y: number; id: number; ev: PointerEvent; fired: boolean },
    suppressClick: false,
  });

  const markDirty = () => { S.current.dirty = true; invalidate(); };

  // ---- pool, tooltip and worker card, created once
  useEffect(() => {
    const root = layer.current; if (!root) return;
    const s = S.current;
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div'); el.className = 'lbl is-off'; el.setAttribute('aria-hidden', 'true');
      root.appendChild(el); s.slots.push({ el, key: null, cls: 'lbl is-off', html: '', style: '', tx: '', on: false });
    }
    s.tip = document.createElement('div'); s.tip.className = 'tip3d'; s.tip.setAttribute('role', 'tooltip'); root.appendChild(s.tip);
    s.card = document.createElement('div'); s.card.className = 'worker-card'; root.appendChild(s.card);
    const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-id]') as HTMLElement | null;
    const onOver = (e: Event) => { const t = target(e); if (t?.dataset.id) hoverFromScene(t.dataset.id); };
    const onOut = (e: Event) => {
      const t = target(e); const rel = (e as PointerEvent).relatedTarget as HTMLElement | null;
      if (!t?.dataset.id || (rel && t.contains(rel))) return;
      if (useStore.getState().hoverId === t.dataset.id) hoverFromScene(null);
    };
    const onClick = (e: MouseEvent) => {
      if (s.suppressClick) { s.suppressClick = false; return; }
      const t = target(e); if (!t?.dataset.id) return;
      e.stopPropagation();
      const st = useStore.getState();
      st.select(t.dataset.kind === 'grounds' ? { kind: 'grounds', id: t.dataset.id } : { kind: 'facility', id: t.dataset.id });
    };
    const onDbl = (e: MouseEvent) => {
      const t = target(e); if (!t?.dataset.id || t.dataset.kind !== 'facility') return;
      e.stopPropagation();
      const st = useStore.getState(); st.select({ kind: 'facility', id: t.dataset.id }); st.setFocusMode('building');
    };
    // drags and wheel that start on a label go to the 3D controls
    const sink = () => (events.connected as HTMLElement | undefined) ?? root.parentElement?.querySelector('canvas')?.parentElement ?? null;
    const onWheel = (e: WheelEvent) => { const el = sink(); if (!el) return; e.preventDefault(); el.dispatchEvent(new WheelEvent('wheel', e)); };
    const onDown = (e: PointerEvent) => { if (!target(e)) return; s.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, ev: e, fired: false }; };
    const onMove = (e: PointerEvent) => {
      const g = s.drag; if (!g || g.fired || e.pointerId !== g.id) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
      g.fired = true; s.suppressClick = true;
      const el = sink(); if (!el) return;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: g.x, clientY: g.y, screenX: g.ev.screenX, screenY: g.ev.screenY, button: g.ev.button, buttons: g.ev.buttons, pointerId: g.id, pointerType: g.ev.pointerType, isPrimary: g.ev.isPrimary, ctrlKey: g.ev.ctrlKey, shiftKey: g.ev.shiftKey, altKey: g.ev.altKey, metaKey: g.ev.metaKey }));
    };
    const onUp = () => { const g = s.drag; s.drag = null; if (g && !g.fired) s.suppressClick = false; else if (g) setTimeout(() => { s.suppressClick = false; }, 0); };
    const onCtx = (e: Event) => { if (target(e)) e.preventDefault(); };
    root.addEventListener('pointerover', onOver); root.addEventListener('pointerout', onOut);
    root.addEventListener('click', onClick); root.addEventListener('dblclick', onDbl);
    root.addEventListener('wheel', onWheel, { passive: false }); root.addEventListener('pointerdown', onDown);
    root.addEventListener('contextmenu', onCtx);
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    const offInsets = onInsetsChange(markDirty);
    // occluders appear and move without camera motion: poll their rects cheaply
    const poll = setInterval(() => {
      const occ = readOccluders(); const sig = occ.map((r) => `${r.x0 | 0},${r.y0 | 0},${r.x1 | 0},${r.y1 | 0}`).join(';');
      if (sig !== s.occSig) { s.occSig = sig; s.occ = occ; markDirty(); }
    }, 400);
    return () => {
      root.removeEventListener('pointerover', onOver); root.removeEventListener('pointerout', onOut);
      root.removeEventListener('click', onClick); root.removeEventListener('dblclick', onDbl);
      root.removeEventListener('wheel', onWheel); root.removeEventListener('pointerdown', onDown); root.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      offInsets(); clearInterval(poll);
      for (const sl of s.slots) sl.el.remove();
      s.tip?.remove(); s.card?.remove(); s.slots = []; s.placed = []; rt.labels = []; rt.labelRects = [];
    };
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- data that changes labels → repack
  useEffect(() => markDirty(), [d.layout, d.estById, d.rowMeta, d.gestById, fmap, gmap, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => useStore.subscribe((s, p) => {
    if (s.selection !== p.selection || s.hoverId !== p.hoverId || s.filterIds !== p.filterIds || s.colorBy !== p.colorBy || s.labelMode !== p.labelMode
      || s.focusMode !== p.focusMode || s.buildingTab !== p.buildingTab || s.extraction.recentIds !== p.extraction.recentIds || s.planView !== p.planView || s.selectedAgentId !== p.selectedAgentId) markDirty();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = layer.current; if (!root) return;
    root.classList.toggle('is-hidden', view === 'table');
    root.classList.toggle('reduced', reducedMotion);
  }, [view, reducedMotion, layer]);

  const project = (p: THREE.Vector3, W: number, H: number) => {
    _v.copy(p).project(camera);
    return { x: ((_v.x + 1) / 2) * W, y: ((1 - _v.y) / 2) * H, front: _v.z < 1 && _v.z > -1 };
  };

  function pack() {
    const s = S.current;
    const W = size.width, H = size.height;
    const fr = freeRect(W, H);
    const area: Rect = { x0: fr.x0 + 8, y0: fr.y0 + 8, x1: fr.x1 - 8, y1: fr.y1 - 8 };
    if (!s.occSig) { s.occ = readOccluders(); s.occSig = 'init'; }
    const occ = s.occ;
    const st = useStore.getState();
    const layout = d.layout;
    const cands: Cand[] = [];
    const selId = st.selection.kind ? (st.selection as { id: string }).id : null;
    const hoverId = st.hoverId ?? null;
    const colorBy = st.colorBy ?? 'category';
    const labelMode = st.labelMode ?? 'auto';
    const filterIds = st.filterIds ?? null;
    const focused = st.focusMode === 'building' && st.selection.kind === 'facility';
    const recentIds = st.extraction.recentIds ?? [];
    const recentRank = new Map(recentIds.slice(0, 8).map((id, i) => [id, i] as [string, number]));
    // the Needs-review chip is on when every filtered id needs review
    let needsChip = false;
    if (filterIds && filterIds.size) { needsChip = true; for (const id of filterIds) if (d.rowMeta.get(id)?.review !== 'needs') { needsChip = false; break; } }
    const needsRelevant = colorBy === 'confidence' || colorBy === 'review' || needsChip;
    const onRoof = (st.planView ?? false) && (camera as THREE.OrthographicCamera).isOrthographicCamera === true; // plan view: chips sit on the roofs
    const budget = onRoof ? 200 : Math.max(24, Math.min(100, Math.floor((fr.w * fr.h) / 9000)));

    if (layout && !(focused && st.buildingTab === 'interior')) {
      for (const b of focused ? [] : layout.buildings) {
        const f = fmap.get(b.id); if (!f) continue;
        const sel = b.id === selId && st.selection.kind === 'facility', hov = b.id === hoverId;
        if (filterIds && !filterIds.has(b.id) && !sel && !hov) continue;
        const h = Math.max(0.6, b.height);
        const anchor = new THREE.Vector3(b.box.x, h + 0.3, b.box.z);
        const a = project(anchor, W, H); if (!a.front) continue;
        if (!sel && !hov && (a.x < fr.x0 - 40 || a.x > fr.x1 + 40 || a.y < fr.y0 - 40 || a.y > fr.y1 + 60)) continue;
        const c1 = project(_v.set(b.box.x - b.box.w / 2, h, b.box.z - b.box.d / 2).clone(), W, H);
        const c2 = project(_v.set(b.box.x + b.box.w / 2, h, b.box.z + b.box.d / 2).clone(), W, H);
        const c3 = project(_v.set(b.box.x - b.box.w / 2, h, b.box.z + b.box.d / 2).clone(), W, H);
        const c4 = project(_v.set(b.box.x + b.box.w / 2, h, b.box.z - b.box.d / 2).clone(), W, H);
        const diag = Math.max(Math.hypot(c1.x - c2.x, c1.y - c2.y), Math.hypot(c3.x - c4.x, c3.y - c4.y));
        const meta = d.rowMeta.get(b.id);
        const flagged = meta?.review === 'flagged';
        const needs = meta?.review === 'needs';
        const isNew = recentRank.has(b.id);
        const match = filterIds != null && filterIds.size <= 150 && filterIds.has(b.id); // a short search result list: pin every hit
        const priority = sel || hov || flagged || isNew || (needs && needsRelevant) || match;
        let rank = ftePct.get(b.id) ?? 0;
        if (filterIds && filterIds.has(b.id)) rank = 300;
        if (needs && needsRelevant) rank = 500;
        if (isNew) rank = 600 - (recentRank.get(b.id) ?? 0);
        if (flagged) rank = 700;
        if (hov) rank = 950;
        if (sel) rank = 1000;
        let lod: Lod | null;
        if (sel || hov) lod = 'full';
        else if (labelMode === 'off') lod = priority ? 'pin' : null;
        else if (diag < 14) lod = priority ? 'pin' : null;
        else if (diag < 60 || labelMode === 'numbers') lod = 'chip';
        else lod = 'full';
        if (!lod) continue;
        const band = confBand(f.confidence);
        const statusColor = colorBy === 'review' ? REVIEW_COLOR[meta?.review ?? 'ok'] : colorBy === 'confidence' ? (band === 'hi' ? CONF_COLOR.hi : CONF_COLOR[band]) : categoryColor(f.category);
        const stripe = statusColor;
        const pc = flagged ? 'var(--flag)' : isNew ? 'var(--new)' : (sel || hov || (match && !(needs && needsRelevant))) ? 'var(--accent)' : CONF_COLOR[band];
        const est = d.estById.get(b.id);
        const num = f.buildingNumber?.trim();
        const chipText = num || ell(f.name, 12);
        const name = ell(f.name, 28);
        const l1 = num ? `${num} · ${name}` : name;
        const l2 = `${n0(f.grossSqft)} SF · ${(est?.fte ?? 0).toFixed(1)} FTE · ${CONF_GLYPH[band]}${Math.round(f.confidence * 100)}%`;
        // crew-dot row: who is working inside right now (only while interior figures are hidden)
        const crewAt = rt.interiorHidden ? rt.crewAt.get(b.id) : undefined;
        const dots = crewAt && crewAt.size ? [...crewAt.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4) : null;
        const l3 = dots ? dots.map(([c, nn]) => `● ${nn}`).join('  ') : '';
        const l3html = dots ? `<div class="l3">${dots.map(([c, nn]) => `<span style="color:${crewColor(c as Parameters<typeof crewColor>[0])}">●</span> ${nn}`).join('&nbsp;&nbsp;')}</div>` : '';
        const cls = [sel ? 'lbl--sel' : '', hov && !sel ? 'lbl--hover' : '', isNew ? 'lbl--new' : '', flagged ? 'lbl--flag' : (needs && needsRelevant ? 'lbl--warn' : '')].filter(Boolean).join(' ');
        cands.push({ key: `f:${b.id}`, id: b.id, kind: 'facility', rank, lod, sel, hov, anchor, ax: a.x, ay: a.y, text: lod === 'full' ? l1 : chipText,
          html: lod === 'full' ? `<div class="l1">${num ? `<span class="n">${esc(num)}</span> · ${esc(name)}` : esc(name)}</div><div class="l2">${esc(l2)}</div>${l3html}` : lod === 'chip' ? esc(chipText) : `<span class="pin__dot">${flagged ? '⚑' : CONF_GLYPH[band]}</span><span class="pin__stem"></span>`,
          cls, stripe, pc, w: 0, h: 0, isNew, chipText, l1, l2, l3 });
      }
      // grounds chips
      for (const z of layout.zones) {
        const g = gmap.get(z.id); if (!g) continue;
        const sel = st.selection.kind === 'grounds' && z.id === selId, hov = z.id === hoverId;
        const attachedFocus = focused && st.buildingTab === 'grounds' && z.facilityId === selId;
        if (focused && !attachedFocus && !sel) continue;
        if (filterIds && !filterIds.has(z.id) && !sel && !hov) continue;
        if (labelMode === 'off' && !sel && !hov) continue;
        const anchor = new THREE.Vector3(z.box.x, 0.2, z.box.z);
        const a = project(anchor, W, H); if (!a.front) continue;
        const c1 = project(_v.set(z.box.x - z.box.w / 2, 0, z.box.z - z.box.d / 2).clone(), W, H);
        const c2 = project(_v.set(z.box.x + z.box.w / 2, 0, z.box.z + z.box.d / 2).clone(), W, H);
        const diag = Math.hypot(c1.x - c2.x, c1.y - c2.y);
        if (!(diag >= 60 || sel || hov || attachedFocus)) continue;
        if (z.facilityId && !sel && !hov && !attachedFocus) continue; // attached turf reads through its building's label
        const text = zoneChipText(g);
        const rank = sel ? 1000 : hov ? 950 : attachedFocus ? 400 : zonePct.get(z.id) ?? 0;
        cands.push({ key: `g:${z.id}`, id: z.id, kind: 'grounds', rank, lod: 'chip', sel, hov, anchor, ax: a.x, ay: a.y, text, html: esc(text), cls: `lbl--zone${sel ? ' lbl--sel' : hov ? ' lbl--hover' : ''}`, stripe: 'var(--border-2)', pc: '', w: 0, h: 0, isNew: false });
      }
    }
    cands.sort((a, b) => b.rank - a.rank);

    const hash = new Hash();
    const placedRects: Rect[] = [];
    const out: { c: Cand; r: Rect }[] = [];
    let units = 0, count = 0, fullCount = 0;
    const inside = (r: Rect) => r.x0 >= area.x0 && r.y0 >= area.y0 && r.x1 <= area.x1 && r.y1 <= area.y1;
    const onOcc = (r: Rect) => occ.some((o) => intersects(r, o));
    const pointInOcc = (x: number, y: number) => occ.some((o) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1);
    const rectFor = (c: Cand, lod: Lod): Rect => {
      if (lod === 'pin') return { x0: c.ax - 6, y0: c.ay - 20, x1: c.ax + 6, y1: c.ay };
      if (lod === 'chip') {
        const w = Math.ceil(measurer.width(c.text, c.kind === 'grounds' ? 'zone' : 'chip')) + 17;
        const y1 = c.kind === 'grounds' || onRoof ? c.ay + 10 : c.ay - 4;
        return { x0: c.ax - w / 2, y0: y1 - 20, x1: c.ax + w / 2, y1 };
      }
      const w = Math.min(320, Math.ceil(Math.max(measurer.width(c.l1 ?? c.text, 'l1'), measurer.width(c.l2 ?? '', 'l2'), measurer.width(c.l3 ?? '', 'l2'))) + 21);
      const h = c.l3 ? 56 : 40;
      return { x0: c.ax - w / 2, y0: c.ay - 4 - h, x1: c.ax + w / 2, y1: c.ay - 4 };
    };
    for (const c of cands) {
      const must = c.sel || c.hov;
      if (must && pointInOcc(c.ax, c.ay)) continue;
      let lod = c.lod;
      const toChip = () => { lod = 'chip'; if (c.chipText) { c.text = c.chipText; c.html = esc(c.chipText); } };
      if (lod === 'full' && !must && fullCount >= 12) toChip();
      const cost = lod === 'pin' ? 1 / 3 : 1;
      if (!must && (units + cost > budget || count + 1 > budget)) { if (lod === 'pin') continue; else continue; }
      let r = rectFor(c, lod);
      if (must) {
        // never culled: clamp into the free rect, then try a few positions to stay clear of others
        const tries: [number, number][] = [[0, 0], [0, (r.y1 - r.y0) + 14], [(r.x1 - r.x0) / 2 + 10, 0], [-(r.x1 - r.x0) / 2 - 10, 0], [0, -(r.y1 - r.y0) - 6]];
        let best: Rect | null = null;
        for (const [dx, dy] of tries) {
          let rr: Rect = { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
          const sx = Math.max(0, area.x0 - rr.x0) - Math.max(0, rr.x1 - area.x1); const sy = Math.max(0, area.y0 - rr.y0) - Math.max(0, rr.y1 - area.y1);
          rr = { x0: rr.x0 + sx, y0: rr.y0 + sy, x1: rr.x1 + sx, y1: rr.y1 + sy };
          if (!hash.hit(rr, 4) && !onOcc(rr)) { best = rr; break; }
          if (!best && !onOcc(rr)) best = rr;
        }
        if (!best) continue;
        r = best;
      } else {
        if (!inside(r) || onOcc(r) || hash.hit(r, 4)) {
          if (lod === 'full') { toChip(); r = rectFor(c, 'chip'); if (!inside(r) || onOcc(r) || hash.hit(r, 4)) continue; }
          else continue;
        }
      }
      hash.add(r); placedRects.push(r);
      units += lod === 'pin' ? 1 / 3 : 1; count++;
      if (lod === 'full') fullCount++;
      out.push({ c: { ...c, lod, w: r.x1 - r.x0, h: r.y1 - r.y0 }, r });
    }

    // ---- assign pool slots: keep the same div for the same key when possible
    const prevByKey = new Map<string, Slot>();
    for (const sl of s.slots) if (sl.key) prevByKey.set(sl.key, sl);
    const taken = new Set<Slot>();
    const want = out.slice(0, POOL);
    const assign = new Map<string, Slot>();
    for (const { c } of want) { const sl = prevByKey.get(c.key); if (sl) { assign.set(c.key, sl); taken.add(sl); } }
    const free = s.slots.filter((sl) => !taken.has(sl));
    for (const { c } of want) if (!assign.has(c.key)) { const sl = free.shift(); if (sl) assign.set(c.key, sl); }
    const used = new Set(assign.values());
    const placed: Placed[] = [];
    for (const { c, r } of want) {
      const sl = assign.get(c.key); if (!sl) continue;
      const cls = c.lod === 'pin' ? `pin is-on${c.sel ? ' lbl--sel' : ''}` : `lbl lbl--${c.lod} ${c.cls} is-on`;
      if (sl.cls !== cls) { sl.el.className = cls; sl.cls = cls; }
      if (sl.html !== c.html) { sl.el.innerHTML = c.html; sl.html = c.html; }
      const style = `${Math.round(c.w)}|${Math.round(c.h)}|${c.stripe}|${c.pc}`;
      if (sl.style !== style) {
        sl.el.style.width = `${Math.round(c.w)}px`; sl.el.style.height = `${Math.round(c.h)}px`;
        sl.el.style.setProperty('--stripe', c.stripe); if (c.pc) sl.el.style.setProperty('--pc', c.pc);
        sl.style = style;
      }
      if (sl.key !== c.key) { sl.el.dataset.id = c.id; sl.el.dataset.kind = c.kind; sl.el.title = ''; sl.key = c.key; }
      sl.on = true;
      placed.push({ key: c.key, id: c.id, kind: c.kind, slot: sl, anchor: c.anchor, offX: r.x0 - c.ax, offY: r.y0 - c.ay, w: c.w, h: c.h, lod: c.lod, text: c.text, isNew: c.isNew, x: r.x0, y: r.y0, visible: true, must: c.sel || c.hov });
    }
    for (const sl of s.slots) if (!used.has(sl) && sl.on) { sl.on = false; sl.cls = sl.cls.replace(' is-on', '') + ' is-off'; sl.el.className = sl.cls; sl.key = null; delete sl.el.dataset.id; }
    s.placed = placed;
    reproject(true);
  }

  function reproject(force = false) {
    const s = S.current;
    const W = size.width, H = size.height;
    const fr = freeRect(W, H);
    const labels: LabelOut[] = [];
    const rects: Rect[] = [];
    // between packs the camera may move: a label that now collides with a higher-ranked one, leaves the free
    // rect or slides under an overlay hides until the next pack (placed[] is in rank order)
    for (const p of s.placed) {
      const a = project(p.anchor, W, H);
      const x = Math.round(a.x + p.offX), y = Math.round(a.y + p.offY);
      const r: Rect = { x0: x, y0: y, x1: x + p.w, y1: y + p.h };
      const must = p.must === true;
      const clear = must || (r.x0 >= fr.x0 && r.y0 >= fr.y0 && r.x1 <= fr.x1 && r.y1 <= fr.y1 && !s.occ.some((o) => intersects(r, o)) && !rects.some((o) => intersects(r, o)));
      const vis = a.front && clear;
      if (vis !== p.visible || force) { p.slot.el.style.visibility = vis ? '' : 'hidden'; p.visible = vis; }
      const tx = `translate3d(${x}px,${y}px,0)`;
      if (p.slot.tx !== tx) { p.slot.el.style.transform = tx; p.slot.tx = tx; }
      p.x = x; p.y = y;
      if (vis) { labels.push({ id: p.id, text: p.text, lod: p.lod, x, y, w: Math.round(p.w), h: Math.round(p.h), isNew: p.isNew }); rects.push({ x0: x, y0: y, x1: x + p.w, y1: y + p.h }); }
    }
    rt.labels = labels; rt.labelRects = rects;
  }

  function updateTooltip(now: number) {
    const s = S.current; const tip = s.tip; if (!tip) return;
    const st = useStore.getState();
    const id = st.hoverId ?? null;
    const fromScene = id != null && hoverSrc.sceneId === id && st.view !== 'table';
    if (!fromScene) { if (s.tipId) { tip.classList.remove('is-on'); s.tipId = null; } return; }
    if (s.tipId !== id) { s.tipId = id; s.tipSince = now; tip.classList.remove('is-on'); invalidateLater(160); return; }
    if (now - s.tipSince < 150) { invalidateLater(160 - (now - s.tipSince)); return; }
    const b = bmap.get(id); const z = b ? undefined : zmap.get(id);
    let html = '';
    let anchor: THREE.Vector3 | null = null;
    if (b) {
      const f = fmap.get(id); if (!f) return;
      const e = d.estById.get(id); const meta = d.rowMeta.get(id);
      const band = confBand(f.confidence);
      const rv = meta?.review ?? 'ok';
      const rvText = rv === 'verified' ? '✓ Verified' : rv === 'flagged' ? '⚑ Flagged' : rv === 'needs' ? '! Needs review' : 'Not reviewed';
      html = `<div class="t">${f.buildingNumber ? `<span class="n">${esc(f.buildingNumber)}</span> · ` : ''}${esc(f.name)}</div>`
        + `<div class="s">${esc(CATEGORY_DEFAULTS[f.category]?.label ?? f.category)} · ${f.floors || 1} fl</div>`
        + `<div class="g"><div><span>Gross SF</span><b>${n0(f.grossSqft)}</b></div><div><span>Cleanable SF</span><b>${n0(e?.resolved.cleanableSqft ?? f.cleanableSqft ?? 0)}</b></div>`
        + `<div><span>FTE</span><b>${(e?.fte ?? 0).toFixed(2)}</b></div><div><span>Confidence</span><b style="color:${CONF_COLOR[band]}">${CONF_GLYPH[band]} ${Math.round(f.confidence * 100)}%</b></div></div>`
        + `<div class="r ${rv === 'needs' ? 'warn' : rv === 'flagged' ? 'flag' : rv === 'verified' ? 'ok' : ''}">${rvText}</div>`
        + `<div class="h">Click select · Double-click inside</div>`;
      anchor = new THREE.Vector3(b.box.x, Math.max(0.6, b.height) + 0.3, b.box.z);
    } else if (z) {
      const g = gmap.get(id); if (!g) return;
      const ge = d.gestById.get(id);
      html = `<div class="t">${esc(g.name)}</div><div class="s">${esc(g.documentLabel ? `${g.documentLabel} · ` : '')}${esc(qtyText(g))}</div>`
        + `<div class="g"><div><span>FTE</span><b>${(ge?.fte ?? 0).toFixed(2)}</b></div><div><span>Confidence</span><b>${Math.round(g.confidence * 100)}%</b></div></div><div class="h">Click select</div>`;
      anchor = new THREE.Vector3(z.box.x, 0.2, z.box.z);
    }
    if (!html || !anchor) { tip.classList.remove('is-on'); return; }
    if (s.tipHtml !== html) { tip.innerHTML = html; s.tipHtml = html; }
    const W = size.width, H = size.height; const fr = freeRect(W, H);
    const a = project(anchor, W, H);
    if (!a.front) { tip.classList.remove('is-on'); return; }
    const w = 260, h = tip.offsetHeight || 150;
    const lbl = s.placed.find((p) => p.id === id && p.visible);
    const opts: [number, number][] = lbl
      ? [[lbl.x + lbl.w + 8, lbl.y], [lbl.x - 8 - w, lbl.y], [lbl.x, lbl.y + lbl.h + 8], [lbl.x, lbl.y - 8 - h]]
      : [[a.x + 16, a.y - 16 - h], [a.x - 16 - w, a.y - 16 - h], [a.x + 16, a.y + 16], [a.x - 16 - w, a.y + 16]];
    const clampR = (x: number, y: number): Rect => { const cx = Math.min(Math.max(x, fr.x0 + 8), fr.x1 - 8 - w); const cy = Math.min(Math.max(y, fr.y0 + 8), fr.y1 - 8 - h); return { x0: cx, y0: cy, x1: cx + w, y1: cy + h }; };
    let pick: Rect | null = null;
    for (const [x, y] of opts) {
      const r: Rect = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (r.x0 >= fr.x0 + 8 && r.x1 <= fr.x1 - 8 && r.y0 >= fr.y0 + 8 && r.y1 <= fr.y1 - 8 && !s.occ.some((o) => intersects(r, o))) { pick = r; break; }
    }
    if (!pick) { pick = clampR(opts[0][0], opts[0][1]); if (s.occ.some((o) => intersects(pick!, o))) { for (const [x, y] of opts.slice(1)) { const r = clampR(x, y); if (!s.occ.some((o) => intersects(r, o))) { pick = r; break; } } } }
    tip.style.transform = `translate3d(${Math.round(pick.x0)}px,${Math.round(pick.y0)}px,0)`;
    tip.classList.add('is-on');
  }

  function updateCard(now: number) {
    const s = S.current; const card = s.card; if (!card) return;
    const id = useStore.getState().selectedAgentId;
    const p = id ? rt.crew.find((c) => c.id === id) : undefined;
    if (!p || useStore.getState().view === 'table') { if (card.classList.contains('is-on')) card.classList.remove('is-on'); return; }
    const sState = p.state; const agent = sState.agent; const meta = crewMeta(agent.crew);
    if (now - s.cardAt > 120 || !card.classList.contains('is-on')) {
      s.cardAt = now;
      const hhmm = (h: number) => fmtTime(h);
      let body = '';
      if (sState.status === 'off') body = `<span class="c">Off shift (works ${hhmm(meta.shift.start)}–${hhmm(meta.shift.end)})</span>`;
      else if (sState.status === 'travel' && sState.job) body = `<span class="c">Walking to ${esc(sState.job.targetName)}</span>`;
      else if (sState.status === 'work' && sState.job) body = `<span>${esc(sState.job.task)}</span><br/><span class="c">${esc(sState.job.targetName)}${sState.job.floors > 1 ? ` · floor ${sState.floor + 1}` : ''} · ${Math.round(sState.progress * 100)}% · ${sState.job.hours.toFixed(1)} h/day</span>`;
      const html = `<b>${esc(meta.label)}${agent.represents > 1 ? ` ×${agent.represents}` : ''} · #${agent.index + 1}</b>${body}`;
      if (html !== s.cardHtml) { card.innerHTML = html; s.cardHtml = html; card.style.setProperty('--crew', crewColor(agent.crew)); }
    }
    card.classList.add('is-on');
    const W = size.width, H = size.height; const fr = freeRect(W, H);
    const a = project(_v.set(p.wx, p.wy + 1.2, p.wz).clone(), W, H);
    if (!a.front) { card.classList.remove('is-on'); return; }
    const w = card.offsetWidth || 200, h = card.offsetHeight || 50;
    // above the agent, else below, else beside; clamped to the free rect and clear of overlays
    const opts: [number, number][] = [[a.x - w / 2, a.y - h - 12], [a.x - w / 2, a.y + 16], [a.x + 16, a.y - h / 2], [a.x - 16 - w, a.y - h / 2]];
    let pick: Rect | null = null;
    for (const [ox, oy] of opts) {
      const x = Math.min(Math.max(ox, fr.x0 + 8), fr.x1 - 8 - w), y = Math.min(Math.max(oy, fr.y0 + 8), fr.y1 - 8 - h);
      const r: Rect = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (!s.occ.some((o) => intersects(r, o))) { pick = r; break; }
      if (!pick) pick = r;
    }
    card.style.transform = `translate3d(${Math.round(pick!.x0)}px,${Math.round(pick!.y0)}px,0)`;
  }

  const laterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function invalidateLater(ms: number) {
    if (laterTimer.current) return;
    laterTimer.current = setTimeout(() => { laterTimer.current = null; invalidate(); }, Math.max(16, ms));
  }

  useFrame(() => {
    const s = S.current;
    if (!s.slots.length) return;
    const now = performance.now();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements; const pe = camera.projectionMatrix.elements;
    const sig = `${e[12].toFixed(3)},${e[13].toFixed(3)},${e[14].toFixed(3)},${e[8].toFixed(4)},${e[9].toFixed(4)},${e[10].toFixed(4)},${pe[0].toFixed(5)},${pe[8].toFixed(5)},${pe[9].toFixed(5)},${size.width},${size.height}`;
    const moved = sig !== s.camSig;
    s.camSig = sig;
    if (clock.playing && now - s.lastPack > 1000) s.dirty = true;
    if (s.dirty || (moved && now - s.lastPack > PACK_MS)) {
      s.dirty = false; s.lastPack = now; pack();
    } else if (moved) reproject();
    if (moved) { clearTimeout(s.restTimer); s.restTimer = setTimeout(() => { s.dirty = true; invalidate(); }, PACK_MS + 30); }
    updateTooltip(now);
    updateCard(now);
  });

  return null;
}
