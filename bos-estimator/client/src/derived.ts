// Derived data (UI spec §2.5). App.tsx computes it once per render with useComputeDerived() and provides it
// through DerivedContext; THREE reads it with useDerived(). useTopDownLive() is the only source of the top-down
// numbers (top bar FTE / implied / Δ and the Estimate tab), so they cannot disagree.

import { createContext, useContext, useDeferredValue, useMemo, useRef } from 'react';
import { estimateInventory, type EstimateResult, type FacilityEstimate, type GroundsEstimate, type ResolvedFacility } from '@shared/estimate';
import { annualValueBasis, computeTopDown, DEFAULT_TOPDOWN } from '@shared/topdown';
import { isInScope, type Facility, type GroundsArea, type TopDownAssumptions, type TopDownEstimate } from '@shared/types';
import * as layoutModule from './three/layout';
import type { SiteLayout } from './three/layout';
import { buildRoster, type Agent } from './three/sim';
import { useStore } from './store';
import { reviewContext, reviewCounts, rowMetaFor, stableContext, type ReviewContext, type ReviewCounts, type RowMeta } from './components/lib/review';

export type { IssueCode, RowMeta, ReviewCounts } from './components/lib/review';

export interface Derived {
  est: EstimateResult | null;
  estById: Map<string, FacilityEstimate>;
  gestById: Map<string, GroundsEstimate>;
  /** object identity changes ONLY when geometry changes */
  layout: SiteLayout | null;
  /** increments when layout identity changes */
  layoutRev: number;
  /** increments when est identity changes */
  estRev: number;
  /** [] while view === 'table'; computed from useDeferredValue(est) */
  roster: Agent[];
  /** every facility and grounds id */
  rowMeta: Map<string, RowMeta>;
  /** FTE quantiles (20/40/60/80) of in-scope facilities, for colorBy 'fte' */
  fteBreaks: [number, number, number, number];
  // ---- SHELL additions (THREE may ignore) ----
  /** review progress and queue sizes (rail badge, chips, footer meters, top-bar label) */
  counts: ReviewCounts;
  facById: Map<string, Facility>;
  groundsById: Map<string, GroundsArea>;
}

const EMPTY_COUNTS: ReviewCounts = { total: 0, verified: 0, flagged: 0, needs: 0, outOfScope: 0, edited: 0 };
const EMPTY_ROSTER: Agent[] = [];
const DEFAULT_BREAKS: [number, number, number, number] = [0.5, 1, 2, 4];
export const EMPTY_DERIVED: Derived = { est: null, estById: new Map(), gestById: new Map(), layout: null, layoutRev: 0, estRev: 0, roster: EMPTY_ROSTER, rowMeta: new Map(), fteBreaks: DEFAULT_BREAKS, counts: EMPTY_COUNTS, facById: new Map(), groundsById: new Map() };
export const DerivedContext = createContext<Derived>(EMPTY_DERIVED);
export const useDerived = () => useContext(DerivedContext);

// ---------------------------------------------------------------- layout API (THREE lands the new signature)
type ComputeLayoutFn = (f: ResolvedFacility[], g: GroundsArea[], opts?: { prev?: SiteLayout | null; relayout?: boolean }) => SiteLayout;
type SignatureFn = (f: ResolvedFacility[], g: GroundsArea[]) => string;
// Read through a dynamic key so the bundler does not resolve a named export THREE may not have landed yet.
const layoutApi = layoutModule as unknown as Record<string, unknown>;
const pick = <T,>(name: string): T | null => (typeof layoutApi[name] === 'function' ? (layoutApi[name] as T) : null);
const computeLayoutFn = layoutModule.computeLayout as unknown as ComputeLayoutFn;

/** Geometry-only signature (used until three/layout.ts exports layoutSignature): ids, footprints (1 ft), floors, category, grounds geometry. */
function fallbackSignature(facilities: ResolvedFacility[], grounds: GroundsArea[]): string {
  const parts: string[] = [];
  for (const f of facilities) parts.push(`${f.id}:${Math.round(f.footprint.length)}x${Math.round(f.footprint.width)}:${f.floors}:${f.category}`);
  parts.push('|');
  for (const g of grounds) parts.push(`${g.id}:${g.kind}:${g.facilityId ?? ''}:${g.unit}:${Math.round(g.quantity * 100) / 100}`);
  return parts.join(';');
}
function signatureOf(facilities: ResolvedFacility[], grounds: GroundsArea[]): string {
  const sig = pick<SignatureFn>(['layout', 'Signature'].join(''));
  return sig ? sig(facilities, grounds) : fallbackSignature(facilities, grounds);
}

const quantile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/** App.tsx: compute everything once per render. */
export function useComputeDerived(): Derived {
  const inventory = useStore((s) => s.project?.inventory);
  const assumptions = useStore((s) => s.project?.assumptionOverrides);
  const overrides = useStore((s) => s.project?.factorOverrides);
  const wages = useStore((s) => s.project?.wages);
  const review = useStore((s) => s.project?.review);
  const changedIds = useStore((s) => s.extraction.result?.changedIds);
  const layoutEpoch = useStore((s) => s.layoutEpoch);
  const view = useStore((s) => s.view);

  // estimate: memoized on the inputs that change hours
  const estRevRef = useRef(0);
  const est = useMemo(() => {
    if (!inventory) return null;
    estRevRef.current++;
    return estimateInventory(inventory, assumptions ?? {}, overrides, wages as never);
  }, [inventory, assumptions, overrides, wages]);
  const estRev = estRevRef.current;

  const { estById, gestById } = useMemo(() => ({
    estById: new Map(est?.facilities.map((e) => [e.facilityId, e]) ?? []),
    gestById: new Map(est?.grounds.map((g) => [g.areaId, g]) ?? []),
  }), [est]);

  // layout: identity changes only when geometry changes (name, service and review edits keep it)
  const resolved = useMemo(() => est?.facilities.map((f) => f.resolved) ?? [], [est]);
  const grounds = inventory?.grounds;
  const sig = useMemo(() => (est && grounds ? signatureOf(resolved, grounds) : ''), [est, resolved, grounds]);
  const live = useRef({ resolved, grounds }); live.current = { resolved, grounds };
  const prevLayout = useRef<SiteLayout | null>(null);
  const lastEpoch = useRef(layoutEpoch);
  const layoutRevRef = useRef(0);
  const layout = useMemo(() => {
    if (!sig) { lastEpoch.current = layoutEpoch; return (prevLayout.current = null); }
    const relayout = lastEpoch.current !== layoutEpoch; lastEpoch.current = layoutEpoch;
    layoutRevRef.current++;
    return (prevLayout.current = computeLayoutFn(live.current.resolved, live.current.grounds ?? [], { prev: prevLayout.current, relayout }));
  }, [sig, layoutEpoch]);
  const layoutRev = layoutRevRef.current;

  // crews: deferred, and only in Map view
  const dEst = useDeferredValue(est);
  const dLayout = useDeferredValue(layout);
  const roster = useMemo(() => (view === 'map' && dEst && dLayout ? buildRoster(dEst, dLayout) : EMPTY_ROSTER), [dEst, dLayout, view]);

  // review model (memoized per row in review.ts)
  const ctxRef = useRef<ReviewContext | null>(null);
  const rowMeta = useMemo(() => {
    const m = new Map<string, RowMeta>();
    if (!inventory) return m;
    const ctx = stableContext(reviewContext(inventory.facilities, changedIds ?? []), ctxRef.current);
    ctxRef.current = ctx;
    for (const f of inventory.facilities) m.set(f.id, rowMetaFor(f, 'facility', ctx, review?.[f.id]));
    for (const g of inventory.grounds) m.set(g.id, rowMetaFor(g, 'grounds', ctx, review?.[g.id]));
    return m;
  }, [inventory, review, changedIds]);
  const counts = useMemo(() => (rowMeta.size ? reviewCounts(rowMeta) : EMPTY_COUNTS), [rowMeta]);

  const fteBreaks = useMemo<[number, number, number, number]>(() => {
    if (!est || !inventory) return DEFAULT_BREAKS;
    const inScope = new Set(inventory.facilities.filter(isInScope).map((f) => f.id));
    const ftes = est.facilities.filter((e) => inScope.has(e.facilityId)).map((e) => e.fte).sort((a, b) => a - b);
    return ftes.length >= 5 ? [quantile(ftes, 0.2), quantile(ftes, 0.4), quantile(ftes, 0.6), quantile(ftes, 0.8)] : DEFAULT_BREAKS;
  }, [est, inventory]);

  const { facById, groundsById } = useMemo(() => ({
    facById: new Map(inventory?.facilities.map((f) => [f.id, f]) ?? []),
    groundsById: new Map(inventory?.grounds.map((g) => [g.id, g]) ?? []),
  }), [inventory]);

  return useMemo<Derived>(() => ({ est, estById, gestById, layout, layoutRev, estRev, roster, rowMeta, fteBreaks, counts, facById, groundsById }),
    [est, estById, gestById, layout, layoutRev, estRev, roster, rowMeta, fteBreaks, counts, facById, groundsById]);
}

// ---------------------------------------------------------------- top-down, live
export interface TopDownLive {
  bottomUpFte: number;
  heads: number;
  impliedBase: number;
  impliedLow: number;
  impliedHigh: number;
  /** (bottom-up − implied) / implied; null without an award value */
  deltaPct: number | null;
  annualValue: number;
  /** inputs changed since the stored rationale (bottom-up moved > 1 %, the annual value or an override changed) */
  stale: boolean;
  /** the full live computation (assumptions, price breakdown, rationale carried over from the stored run) */
  td: TopDownEstimate | null;
}

export function computeTopDownLive(est: EstimateResult | null, stored: TopDownEstimate | undefined, overrides: Partial<TopDownAssumptions> | undefined, pa: Parameters<typeof computeTopDown>[0]): TopDownLive {
  if (!est) return { bottomUpFte: 0, heads: 0, impliedBase: 0, impliedLow: 0, impliedHigh: 0, deltaPct: null, annualValue: 0, stale: false, td: null };
  const base: TopDownAssumptions = { ...DEFAULT_TOPDOWN, ...(stored?.assumptions ?? {}), ...(overrides ?? {}) };
  const td = computeTopDown(pa, base, est, { rationale: stored?.rationale ?? '', risks: stored?.risks ?? [], recommendedFte: stored?.recommendedFte, provider: stored?.provider ?? 'heuristic', model: stored?.model });
  let stale = false;
  if (stored) {
    const moved = Math.abs(est.totalFte - stored.bottomUpFte) / Math.max(1e-9, Math.abs(stored.bottomUpFte)) > 0.01;
    const value = Math.round(annualValueBasis(pa).value) !== Math.round(stored.rawAnnualValue);
    const ov = Object.entries(overrides ?? {}).some(([k, v]) => v !== undefined && stored.assumptions[k as keyof TopDownAssumptions] !== v);
    stale = moved || value || ov;
  }
  const hasValue = td.impliedFte.base > 0;
  return {
    bottomUpFte: est.totalFte,
    heads: est.totalHeadcount,
    impliedBase: td.impliedFte.base,
    impliedLow: td.impliedFte.low,
    impliedHigh: td.impliedFte.high,
    deltaPct: hasValue ? td.deltaPct : null,
    annualValue: td.annualValue,
    stale,
    td,
  };
}

/** The only source for top-bar FTE / implied / Δ and for the Estimate tab (UI spec §2.5). */
export function useTopDownLive(): TopDownLive {
  const { est } = useDerived();
  const stored = useStore((s) => s.project?.topDown);
  const overrides = useStore((s) => s.project?.topDownOverrides);
  const pa = useStore((s) => s.project?.priorAward);
  return useMemo(() => computeTopDownLive(est, stored, overrides, pa), [est, stored, overrides, pa]);
}
