// Deterministic estimating engine: inventory × factors → annual labor-hours → FTE → manning per contract year.

import {
  CATEGORY_DEFAULTS, CREWS, FACTORS, GROWING_WEEKS_BY_CLIMATE, SNOW_EVENTS_BY_CLIMATE, crewMeta,
  type Crew, type Factor, type FrequencyRule,
} from './factors';
import { SERVICE_LEVELS, type Assumptions, type Facility, type FloorMix, type GroundsArea, type Inventory } from './types';

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  productiveHoursPerFte: 1776,
  supervisorRatio: 12,
  contractYears: 5,
  workloadGrowthPerYear: 0,
  wageEscalationPerYear: 0.03,
  climateZone: 'temperate',
  growingSeasonWeeks: 30,
  snowEventsPerYear: 6,
  cleanableShareDefault: 0.85,
};

export interface TaskLine {
  factorId: string;
  name: string;
  ref: string;
  crew: Crew;
  quantity: number;
  unit: string;
  frequencyPerYear: number;
  lhPerUnit: number;
  hoursPerOccurrence: number;
  annualHours: number;
}

export interface ResolvedFacility extends Facility {
  cleanableSqft: number;
  floorMix: FloorMix;
  restroomFixtures: number;
  occupancy: number;
  footprint: { length: number; width: number };
  serviceDaysPerYear: number;
}

export interface FacilityEstimate {
  facilityId: string;
  resolved: ResolvedFacility;
  lines: TaskLine[];
  hoursByCrew: Partial<Record<Crew, number>>;
  dailyHoursByCrew: Partial<Record<Crew, number>>; // average per service day — drives the live tracker
  totalHours: number;
  fte: number;
}

export interface GroundsEstimate {
  areaId: string;
  area: GroundsArea;
  lines: TaskLine[];
  hoursByCrew: Partial<Record<Crew, number>>;
  dailyHoursByCrew: Partial<Record<Crew, number>>;
  totalHours: number;
  fte: number;
  acres: number;
}

export interface CrewSummary {
  crew: Crew;
  label: string;
  color: string;
  hours: number;
  fte: number;
  headcount: number;
  wage: number;
  annualCost: number;
}

export interface YearManning {
  year: number;
  label: string;
  hours: number;
  fte: number;
  headcount: number;
  byCrew: { crew: Crew; fte: number; headcount: number }[];
  laborCost: number;
}

export interface EstimateResult {
  facilities: FacilityEstimate[];
  grounds: GroundsEstimate[];
  crews: CrewSummary[];
  directHours: number;
  directFte: number;
  supervisionFte: number;
  supervisionHeadcount: number;
  totalFte: number;
  totalHeadcount: number;
  totalLaborCost: number;
  years: YearManning[];
  metrics: {
    grossSqft: number;
    cleanableSqft: number;
    acres: number;
    pavedSqft: number;
    bedSqft: number;
    trees: number;
    mealsPerYear: number;
    facilitiesCount: number;
  };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function resolveFacility(f: Facility, a: Assumptions): ResolvedFacility {
  const d = CATEGORY_DEFAULTS[f.category] ?? CATEGORY_DEFAULTS.other;
  const floors = Math.max(1, Math.round(f.floors || d.typicalFloors));
  const gross = Math.max(0, f.grossSqft || 0);
  const cleanable = f.cleanableSqft && f.cleanableSqft > 0 ? f.cleanableSqft : gross * (d.cleanableShare ?? a.cleanableShareDefault);
  const mix = normalizeMix({ ...d.floorMix, ...(f.floorMix ?? {}) });
  const fixtures = f.restroomFixtures && f.restroomFixtures > 0 ? f.restroomFixtures : Math.max(gross > 0 ? 2 : 0, Math.round((gross / 1000) * d.fixturesPerMsf));
  const occupancy = f.occupancy && f.occupancy > 0 ? f.occupancy : Math.round((gross / 1000) * d.occupantsPerMsf);
  const footArea = gross / floors;
  const footprint = f.footprint ?? { length: Math.sqrt(footArea * d.aspect), width: Math.sqrt(footArea / d.aspect) };
  const level = SERVICE_LEVELS.find((s) => s.id === f.serviceLevel) ?? SERVICE_LEVELS.find((s) => s.id === d.serviceLevel)!;
  return { ...f, floors, grossSqft: gross, cleanableSqft: cleanable, floorMix: mix, restroomFixtures: fixtures, occupancy, footprint, serviceDaysPerYear: level.daysPerYear };
}

export function normalizeMix(m: Partial<FloorMix>): FloorMix {
  const mix: FloorMix = { carpet: m.carpet ?? 0, resilient: m.resilient ?? 0, hardTile: m.hardTile ?? 0, concrete: m.concrete ?? 0, wood: m.wood ?? 0 };
  const sum = Object.values(mix).reduce((s, v) => s + Math.max(0, v), 0);
  if (sum <= 0) return { carpet: 0.3, resilient: 0.4, hardTile: 0.2, concrete: 0.1, wood: 0 };
  (Object.keys(mix) as (keyof FloorMix)[]).forEach((k) => (mix[k] = Math.max(0, mix[k]) / sum));
  return mix;
}

function occurrences(rule: FrequencyRule, ctx: { serviceDays: number; growingWeeks: number; snowEvents: number; climateLeaf: boolean; diningDays: number; mealPeriods: number; mealsPerYear: number }): { freq: number; perMeal: boolean } {
  switch (rule.kind) {
    case 'per_service_day': return { freq: ctx.serviceDays, perMeal: false };
    case 'per_year': return { freq: rule.times, perMeal: false };
    case 'mow_cycles': return { freq: Math.max(0, Math.round(ctx.growingWeeks * rule.multiplier)), perMeal: false };
    case 'snow_events': return { freq: ctx.snowEvents, perMeal: false };
    case 'leaf_season': return { freq: ctx.climateLeaf ? 3 : 0, perMeal: false };
    case 'dining_days': return { freq: ctx.diningDays, perMeal: false };
    case 'dining_meal_periods': return { freq: ctx.diningDays * ctx.mealPeriods, perMeal: false };
    case 'per_meal': return { freq: 1, perMeal: true };
  }
}

const lh = (factor: Factor, overrides?: Record<string, number>) => (overrides && overrides[factor.id] != null ? overrides[factor.id] : factor.lhPerUnit);

export function estimateFacility(f: Facility, a: Assumptions, overrides?: Record<string, number>): FacilityEstimate {
  const r = resolveFacility(f, a);
  const lines: TaskLine[] = [];
  const scope = new Set(f.scope?.length ? f.scope : ['custodial', 'floor_care']);
  const cleanableMsf = r.cleanableSqft / 1000;
  const ctxBase = { serviceDays: r.serviceDaysPerYear, growingWeeks: a.growingSeasonWeeks, snowEvents: a.snowEventsPerYear, climateLeaf: a.climateZone === 'cold' || a.climateZone === 'temperate' };
  const dining = r.dining;
  const diningDays = dining ? Math.round((dining.daysPerWeek || 7) * 52) : 0;
  const mealsPerYear = dining ? dining.mealsPerDay * diningDays : 0;
  const ctx = { ...ctxBase, diningDays, mealPeriods: dining?.mealPeriods || 3, mealsPerYear };

  for (const factor of FACTORS) {
    const ap = factor.applies;
    if (ap.categories && !ap.categories.includes(r.category)) continue;
    if (ap.excludeCategories && ap.excludeCategories.includes(r.category)) continue;

    let quantity = 0;
    if (ap.dining) {
      if (!dining || !scope.has('dining')) continue;
      const style = dining.serviceStyle ?? 'full_food_service';
      if (style === 'dining_facility_attendant' && (ap.dining === 'production')) continue;
      if (style === 'management_only' && ap.dining !== 'management') continue;
      if (factor.unit === 'meal') quantity = mealsPerYear;
      else if (factor.unit === 'day') quantity = 1;
      else if (factor.id === 'dn_san_kitchen') quantity = (dining.kitchenSqft ?? r.grossSqft * 0.35) / 1000;
      else if (factor.id === 'dn_san_dining') quantity = (dining.diningRoomSqft ?? r.grossSqft * 0.45) / 1000;
    } else if (ap.fixtures) {
      if (!scope.has('custodial')) continue;
      quantity = r.restroomFixtures;
    } else if (ap.allFloor || ap.floor) {
      const needs = factor.crew === 'floor_care' ? 'floor_care' : 'custodial';
      if (!scope.has(needs)) continue;
      if (r.category === 'dining' && scope.has('dining') && dining) {
        // A dining facility under full food service is cleaned by the dining sanitation lines, not routine custodial.
        continue;
      }
      const share = ap.allFloor ? 1 : (ap.floor ?? []).reduce((s, k) => s + r.floorMix[k], 0);
      quantity = cleanableMsf * share;
    } else continue;

    if (quantity <= 0) continue;
    const { freq } = occurrences(factor.frequency, ctx);
    if (freq <= 0) continue;
    const rate = lh(factor, overrides);
    const perOcc = quantity * rate;
    lines.push({ factorId: factor.id, name: factor.name, ref: factor.ref, crew: factor.crew, quantity: round(quantity, 3), unit: factor.unit, frequencyPerYear: round(freq, 2), lhPerUnit: rate, hoursPerOccurrence: round(perOcc, 3), annualHours: round(perOcc * freq, 1) });
  }

  const hoursByCrew = sumByCrew(lines);
  const totalHours = lines.reduce((s, l) => s + l.annualHours, 0);
  const dailyHoursByCrew: Partial<Record<Crew, number>> = {};
  for (const [crew, hrs] of Object.entries(hoursByCrew) as [Crew, number][]) {
    const days = crewMeta(crew).domain === 'dining' ? Math.max(1, diningDays) : r.serviceDaysPerYear;
    dailyHoursByCrew[crew] = hrs / days;
  }
  return { facilityId: f.id, resolved: r, lines, hoursByCrew, dailyHoursByCrew, totalHours: round(totalHours), fte: round(totalHours / a.productiveHoursPerFte, 2) };
}

export function groundsAcres(g: GroundsArea): number {
  switch (g.unit) {
    case 'acres': return g.quantity;
    case 'sqft': return g.quantity / 43560;
    case 'sqyd': return (g.quantity * 9) / 43560;
    default: return 0;
  }
}

export function groundsSqft(g: GroundsArea): number {
  switch (g.unit) {
    case 'acres': return g.quantity * 43560;
    case 'sqft': return g.quantity;
    case 'sqyd': return g.quantity * 9;
    case 'lf': return g.quantity * 5; // assume 5-ft-wide walk when given in linear feet
    default: return 0;
  }
}

export function estimateGrounds(g: GroundsArea, a: Assumptions, overrides?: Record<string, number>): GroundsEstimate {
  const lines: TaskLine[] = [];
  const ctx = { serviceDays: 250, growingWeeks: a.growingSeasonWeeks, snowEvents: a.snowEventsPerYear, climateLeaf: a.climateZone === 'cold' || a.climateZone === 'temperate', diningDays: 0, mealPeriods: 0, mealsPerYear: 0 };
  for (const factor of FACTORS) {
    const kinds = factor.applies.groundsKind;
    if (!kinds || !kinds.includes(g.kind)) continue;
    let quantity = 0;
    if (factor.unit === 'acre') quantity = groundsAcres(g);
    else if (factor.unit === 'msf_bed' || factor.unit === 'msf_paved') quantity = groundsSqft(g) / 1000;
    else if (factor.unit === 'each') quantity = g.unit === 'each' ? g.quantity : 0;
    if (quantity <= 0) continue;
    const { freq } = occurrences(factor.frequency, ctx);
    if (freq <= 0) continue;
    const rate = lh(factor, overrides);
    const perOcc = quantity * rate;
    lines.push({ factorId: factor.id, name: factor.name, ref: factor.ref, crew: factor.crew, quantity: round(quantity, 3), unit: factor.unit, frequencyPerYear: round(freq, 2), lhPerUnit: rate, hoursPerOccurrence: round(perOcc, 3), annualHours: round(perOcc * freq, 1) });
  }
  const hoursByCrew = sumByCrew(lines);
  const totalHours = lines.reduce((s, l) => s + l.annualHours, 0);
  const dailyHoursByCrew: Partial<Record<Crew, number>> = {};
  for (const [crew, hrs] of Object.entries(hoursByCrew) as [Crew, number][]) dailyHoursByCrew[crew] = hrs / 250;
  return { areaId: g.id, area: g, lines, hoursByCrew, dailyHoursByCrew, totalHours: round(totalHours), fte: round(totalHours / a.productiveHoursPerFte, 2), acres: groundsAcres(g) };
}

function sumByCrew(lines: TaskLine[]): Partial<Record<Crew, number>> {
  const out: Partial<Record<Crew, number>> = {};
  for (const l of lines) out[l.crew] = (out[l.crew] ?? 0) + l.annualHours;
  return out;
}

export function estimateInventory(inv: Inventory, assumptionsIn: Partial<Assumptions> = {}, overrides?: Record<string, number>, wages?: Partial<Record<Crew, number>>): EstimateResult {
  const climate = assumptionsIn.climateZone ?? inv.site.climateZone ?? DEFAULT_ASSUMPTIONS.climateZone;
  const a: Assumptions = {
    ...DEFAULT_ASSUMPTIONS,
    climateZone: climate,
    growingSeasonWeeks: inv.site.growingSeasonWeeks ?? GROWING_WEEKS_BY_CLIMATE[climate],
    snowEventsPerYear: SNOW_EVENTS_BY_CLIMATE[climate],
    contractYears: inv.site.contractYears ?? DEFAULT_ASSUMPTIONS.contractYears,
    ...assumptionsIn,
  };
  const facilities = inv.facilities.map((f) => estimateFacility(f, a, overrides));
  const grounds = inv.grounds.map((g) => estimateGrounds(g, a, overrides));

  const hoursByCrew: Partial<Record<Crew, number>> = {};
  for (const e of [...facilities, ...grounds]) for (const [c, h] of Object.entries(e.hoursByCrew) as [Crew, number][]) hoursByCrew[c] = (hoursByCrew[c] ?? 0) + h;

  const directHours = Object.values(hoursByCrew).reduce((s, v) => s + v, 0);
  const directFte = directHours / a.productiveHoursPerFte;
  const supervisionFte = directFte > 0 ? Math.max(1, directFte / a.supervisorRatio) : 0;
  const supervisionHeadcount = Math.ceil(supervisionFte);

  const crews: CrewSummary[] = CREWS.filter((c) => c.id !== 'supervision').map((c) => {
    const hours = hoursByCrew[c.id] ?? 0;
    const fte = hours / a.productiveHoursPerFte;
    const wage = wages?.[c.id] ?? c.defaultWage;
    return { crew: c.id, label: c.label, color: c.color, hours: round(hours), fte: round(fte, 2), headcount: Math.ceil(fte - 1e-9), wage, annualCost: Math.round(hours * wage) };
  }).filter((c) => c.hours > 0);
  const supWage = wages?.supervision ?? crewMeta('supervision').defaultWage;
  if (supervisionFte > 0) crews.push({ crew: 'supervision', label: 'Working supervision', color: crewMeta('supervision').color, hours: round(supervisionFte * a.productiveHoursPerFte), fte: round(supervisionFte, 2), headcount: supervisionHeadcount, wage: supWage, annualCost: Math.round(supervisionFte * 2080 * supWage) });

  const totalFte = directFte + supervisionFte;
  const totalHeadcount = crews.reduce((s, c) => s + c.headcount, 0);
  const totalLaborCost = crews.reduce((s, c) => s + c.annualCost, 0);

  const years: YearManning[] = [];
  for (let y = 0; y < Math.max(1, a.contractYears); y++) {
    const growth = (1 + a.workloadGrowthPerYear) ** y;
    const esc = (1 + a.wageEscalationPerYear) ** y;
    const byCrew = crews.map((c) => ({ crew: c.crew, fte: round(c.fte * growth, 2), headcount: Math.ceil(c.fte * growth - 1e-9) }));
    years.push({
      year: y + 1,
      label: y === 0 ? 'Base year' : `Option ${y}`,
      hours: Math.round(directHours * growth),
      fte: round(totalFte * growth, 2),
      headcount: byCrew.reduce((s, c) => s + c.headcount, 0),
      byCrew,
      laborCost: Math.round(totalLaborCost * growth * esc),
    });
  }

  const metrics = {
    grossSqft: inv.facilities.reduce((s, f) => s + (f.grossSqft || 0), 0),
    cleanableSqft: facilities.reduce((s, e) => s + e.resolved.cleanableSqft, 0),
    acres: grounds.filter((g) => ['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'].includes(g.area.kind)).reduce((s, g) => s + g.acres, 0),
    pavedSqft: inv.grounds.filter((g) => g.kind === 'parking' || g.kind === 'sidewalk').reduce((s, g) => s + groundsSqft(g), 0),
    bedSqft: inv.grounds.filter((g) => g.kind === 'shrub_bed').reduce((s, g) => s + groundsSqft(g), 0),
    trees: inv.grounds.filter((g) => g.kind === 'tree_canopy').reduce((s, g) => s + g.quantity, 0),
    mealsPerYear: inv.facilities.reduce((s, f) => s + (f.dining ? f.dining.mealsPerDay * (f.dining.daysPerWeek || 7) * 52 : 0), 0),
    facilitiesCount: inv.facilities.length,
  };

  return { facilities, grounds, crews, directHours: round(directHours), directFte: round(directFte, 2), supervisionFte: round(supervisionFte, 2), supervisionHeadcount, totalFte: round(totalFte, 2), totalHeadcount, totalLaborCost, years, metrics };
}
