// Top-down ("should-cost") cross-check: back into an FTE count from the previous award or
// spend run-rate using assumed fully loaded cost per FTE and assumed ODC / materials share.
//
//   price = (loadedLabor + odc + subcontract) × (1 + G&A) × (1 + fee)
//   loadedLabor = price / ((1 + G&A)(1 + fee)) − odc − subcontract        (odc, sub as shares of price)
//   impliedFte  = loadedLabor / loadedCostPerFte
//
// The AI proposes the assumptions (and a rationale); the arithmetic always runs here so the
// numbers in the UI stay consistent when the user drags an assumption.

import type { EstimateResult } from './estimate';
import type { PriorAward, TopDownAssumptions, TopDownEstimate } from './types';

export const DEFAULT_TOPDOWN: TopDownAssumptions = {
  loadedCostPerFte: 58000,
  loadedCostLow: 50000,
  loadedCostHigh: 68000,
  odcMaterialsPct: 0.08,
  subcontractPct: 0,
  gaPct: 0.08,
  feePct: 0.07,
  escalationPct: 0.03,
  yearsSinceAward: 0,
};

/** Paid-hours and burden factor used to turn bottom-up wages into a loaded annual cost per FTE. */
export const LOAD_FACTOR = 1.42; // fringe (H&W, vacation, holidays, payroll taxes) + site overhead on base wage
export const PAID_HOURS = 2080;

export function annualValueBasis(pa?: PriorAward): { basis: TopDownEstimate['basis']; value: number } {
  if (!pa) return { basis: 'none', value: 0 };
  if (pa.annualValue && pa.annualValue > 0) return { basis: 'annual', value: pa.annualValue };
  if (pa.spendToDate && pa.spendToDate > 0 && pa.spendPeriodMonths && pa.spendPeriodMonths > 0) return { basis: 'spend', value: (pa.spendToDate / pa.spendPeriodMonths) * 12 };
  if (pa.totalValue && pa.totalValue > 0) return { basis: 'award', value: pa.totalValue / Math.max(1, (pa.periodMonths ?? 60) / 12) };
  return { basis: 'none', value: 0 };
}

/** Loaded annual cost per FTE implied by the bottom-up crew mix (wage-weighted). */
export function bottomUpLoadedCostPerFte(est: EstimateResult, loadFactor = LOAD_FACTOR): number {
  const fte = est.crews.reduce((s, c) => s + c.fte, 0);
  if (fte <= 0) return DEFAULT_TOPDOWN.loadedCostPerFte;
  const avgWage = est.crews.reduce((s, c) => s + c.wage * c.fte, 0) / fte;
  return Math.round(avgWage * PAID_HOURS * loadFactor);
}

export function computeTopDown(pa: PriorAward | undefined, a: TopDownAssumptions, est: EstimateResult, meta: Pick<TopDownEstimate, 'rationale' | 'risks' | 'provider' | 'model' | 'recommendedFte'>): TopDownEstimate {
  const { basis, value: raw } = annualValueBasis(pa);
  const annual = raw * Math.pow(1 + (a.escalationPct || 0), Math.max(0, a.yearsSinceAward || 0));
  const costBase = annual / ((1 + a.gaPct) * (1 + a.feePct));
  const odc = annual * a.odcMaterialsPct;
  const sub = annual * a.subcontractPct;
  const loadedLabor = Math.max(0, costBase - odc - sub);
  const ga = costBase * a.gaPct;
  const fee = (costBase + ga) * a.feePct;
  const safe = (d: number) => (d > 0 ? loadedLabor / d : 0);
  const implied = { base: safe(a.loadedCostPerFte), low: safe(a.loadedCostHigh), high: safe(a.loadedCostLow) };
  const bottomUpFte = est.totalFte;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    basis,
    rawAnnualValue: Math.round(raw),
    annualValue: Math.round(annual),
    assumptions: a,
    priceBreakdown: { loadedLabor: Math.round(loadedLabor), odc: Math.round(odc), subcontract: Math.round(sub), ga: Math.round(ga), fee: Math.round(fee) },
    impliedFte: { low: r1(implied.low), base: r1(implied.base), high: r1(implied.high) },
    bottomUpFte,
    bottomUpLaborCost: est.totalLaborCost,
    bottomUpLoadedCostPerFte: bottomUpLoadedCostPerFte(est),
    deltaPct: implied.base > 0 ? (bottomUpFte - implied.base) / implied.base : null,
    rationale: meta.rationale,
    risks: meta.risks,
    recommendedFte: meta.recommendedFte,
    provider: meta.provider,
    model: meta.model,
    generatedAt: new Date().toISOString(),
  };
}

/** Rule-based assumption set used when no AI key is configured. */
export function heuristicAssumptions(est: EstimateResult, pa?: PriorAward): TopDownAssumptions {
  const base = bottomUpLoadedCostPerFte(est);
  const hasDining = est.crews.some((c) => c.crew === 'dining_prod' || c.crew === 'dining_san');
  const groundsShare = est.crews.filter((c) => c.crew.startsWith('grounds')).reduce((s, c) => s + c.fte, 0) / Math.max(1, est.totalFte);
  const odc = 0.06 + groundsShare * 0.08 + (hasDining ? 0.01 : 0); // mowing fleet & fuel push ODC up; FFS food is usually government furnished
  const yrs = pa?.awardYear ? Math.max(0, new Date().getFullYear() - pa.awardYear) : 0;
  return { ...DEFAULT_TOPDOWN, loadedCostPerFte: base, loadedCostLow: Math.round(base * 0.88), loadedCostHigh: Math.round(base * 1.15), odcMaterialsPct: Math.round(odc * 1000) / 1000, yearsSinceAward: yrs };
}
