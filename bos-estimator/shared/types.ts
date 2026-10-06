// Shared domain model for the BOS estimating workbench.
// Used by the server (AI extraction + persistence) and the client (3D + estimate UI).

export type FacilityCategory =
  | 'admin'
  | 'barracks'
  | 'dining'
  | 'medical'
  | 'warehouse'
  | 'maintenance'
  | 'hangar'
  | 'fitness'
  | 'child_care'
  | 'education'
  | 'community'
  | 'lab'
  | 'other';

export const FACILITY_CATEGORIES: FacilityCategory[] = [
  'admin', 'barracks', 'dining', 'medical', 'warehouse', 'maintenance', 'hangar',
  'fitness', 'child_care', 'education', 'community', 'lab', 'other',
];

/** Fractions of cleanable floor area by finish. Should sum to ~1. */
export interface FloorMix {
  carpet: number;
  resilient: number; // VCT / LVT / sheet vinyl
  hardTile: number; // ceramic / terrazzo / quarry
  concrete: number; // sealed / bare (warehouse, hangar)
  wood: number; // gym floors
}

export type ServiceLevel = 'daily_7' | 'daily_5' | '3x_week' | '2x_week' | 'weekly';

export const SERVICE_LEVELS: { id: ServiceLevel; label: string; daysPerYear: number }[] = [
  { id: 'daily_7', label: 'Daily, 7 days/week', daysPerYear: 360 },
  { id: 'daily_5', label: 'Daily, 5 days/week', daysPerYear: 250 },
  { id: '3x_week', label: '3x per week', daysPerYear: 150 },
  { id: '2x_week', label: '2x per week', daysPerYear: 100 },
  { id: 'weekly', label: 'Weekly', daysPerYear: 50 },
];

export type ScopeItem = 'custodial' | 'floor_care' | 'dining' | 'grounds';

export interface SourceRef {
  file?: string;
  page?: number;
  excerpt?: string; // short quote from the RFP supporting the number
}

export interface DiningProfile {
  seats?: number;
  mealsPerDay: number; // headcount (all meal periods)
  mealPeriods: number; // e.g. 3 (B/L/D) or 4 (+ midnight)
  daysPerWeek: number; // 7 for most dining facilities
  kitchenSqft?: number;
  diningRoomSqft?: number;
  serviceStyle?: 'full_food_service' | 'dining_facility_attendant' | 'management_only';
}

export interface Facility {
  id: string; // stable slug e.g. "b-1234"
  buildingNumber?: string;
  name: string;
  category: FacilityCategory;
  grossSqft: number;
  /** Area the custodial contractor actually services. Defaults to a category-based share of gross. */
  cleanableSqft?: number;
  floors: number;
  /** Optional footprint hint from the RFP (feet). If absent, derived from gross/floors. */
  footprint?: { length: number; width: number };
  floorMix?: Partial<FloorMix>;
  restroomFixtures?: number; // toilets + urinals + lavatories + showers
  occupancy?: number;
  serviceLevel: ServiceLevel;
  scope: ScopeItem[];
  dining?: DiningProfile;
  source?: SourceRef;
  confidence: number; // 0..1 — how sure the extractor is about name + square footage
  notes?: string;
  /** Optional site position hint from the AI (0..1 normalized east/north). */
  siteHint?: { x: number; y: number };
}

export type GroundsKind =
  | 'improved_turf' // mowed weekly in season, trimmed, edged
  | 'semi_improved' // mowed every 2-3 weeks, tractor
  | 'unimproved' // bush-hogged a few times per year
  | 'athletic_field'
  | 'shrub_bed' // planting beds, mulch
  | 'parking' // paved lots: sweeping, litter
  | 'sidewalk' // walks: blowing, edging, snow
  | 'tree_canopy'; // individual trees: pruning

export const GROUNDS_KINDS: { id: GroundsKind; label: string; defaultUnit: GroundsUnit }[] = [
  { id: 'improved_turf', label: 'Improved turf', defaultUnit: 'acres' },
  { id: 'semi_improved', label: 'Semi-improved grounds', defaultUnit: 'acres' },
  { id: 'unimproved', label: 'Unimproved grounds', defaultUnit: 'acres' },
  { id: 'athletic_field', label: 'Athletic fields', defaultUnit: 'acres' },
  { id: 'shrub_bed', label: 'Shrub / planting beds', defaultUnit: 'sqft' },
  { id: 'parking', label: 'Parking lots', defaultUnit: 'sqft' },
  { id: 'sidewalk', label: 'Sidewalks / walks', defaultUnit: 'sqft' },
  { id: 'tree_canopy', label: 'Trees', defaultUnit: 'each' },
];

export type GroundsUnit = 'acres' | 'sqft' | 'sqyd' | 'lf' | 'each';

export interface GroundsArea {
  id: string;
  name: string;
  facilityId?: string; // when the RFP ties the area to a building
  kind: GroundsKind;
  quantity: number;
  unit: GroundsUnit;
  source?: SourceRef;
  confidence: number;
  notes?: string;
}

export type ClimateZone = 'cold' | 'temperate' | 'hot_humid' | 'arid';

export interface SiteInfo {
  installationName?: string;
  location?: string;
  solicitation?: string;
  contractName?: string;
  climateZone?: ClimateZone;
  growingSeasonWeeks?: number; // mowing cycles for improved turf
  contractYears?: number; // base + options
  notes?: string;
}

export interface Inventory {
  site: SiteInfo;
  facilities: Facility[];
  grounds: GroundsArea[];
}

/** Which Claude model the extractor uses; the user can switch to compare. */
export interface AiConfig {
  model: string; // e.g. "claude-opus-5-5" | "claude-sonnet-5-5" | any custom id
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export const AI_MODEL_PRESETS: { id: string; label: string; blurb: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', blurb: 'Most thorough reading of long RFPs and messy tables.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', blurb: 'Faster and cheaper; strong on clean workload tables.' },
];

/** Previous award / incumbent contract facts used for the top-down should-cost cross-check. */
export interface PriorAward {
  incumbent?: string;
  contractNumber?: string;
  contractType?: string; // FFP, IDIQ, cost-plus …
  totalValue?: number; // total award or ceiling value, $
  periodMonths?: number; // total period of performance covered by totalValue (base + options)
  annualValue?: number; // stated annual value, $ (overrides totalValue / period)
  spendToDate?: number; // obligations / invoiced to date, $
  spendPeriodMonths?: number; // months the spend covers
  awardYear?: number;
  source?: SourceRef;
  notes?: string;
  confidence?: number;
}

/** Pricing assumptions used to back into FTEs from a contract value. */
export interface TopDownAssumptions {
  loadedCostPerFte: number; // fully burdened $ per FTE-year (wage + fringe/H&W + overhead), base case
  loadedCostLow: number; // optimistic (cheaper labor) bound
  loadedCostHigh: number; // conservative bound
  odcMaterialsPct: number; // supplies, consumables, equipment — share of price
  subcontractPct: number; // pass-through subcontracts — share of price
  gaPct: number; // G&A applied to cost
  feePct: number; // fee / profit applied to cost incl. G&A
  escalationPct: number; // annual escalation to bring prior-award $ to today
  yearsSinceAward: number;
}

export interface TopDownEstimate {
  basis: 'award' | 'spend' | 'annual' | 'none';
  rawAnnualValue: number; // $ per year as found / entered
  annualValue: number; // escalated to current-year $
  assumptions: TopDownAssumptions;
  priceBreakdown: { loadedLabor: number; odc: number; subcontract: number; ga: number; fee: number };
  impliedFte: { low: number; base: number; high: number };
  bottomUpFte: number;
  bottomUpLaborCost: number;
  bottomUpLoadedCostPerFte: number; // what the bottom-up crew mix implies per FTE at the same load factor
  deltaPct: number | null; // (bottomUp − implied) / implied
  rationale: string;
  risks: string[];
  recommendedFte?: number;
  provider: 'claude' | 'heuristic';
  model?: string;
  generatedAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectMeta {
  inventory: Inventory;
  factorOverrides?: Record<string, number>; // factorId -> overridden labor-hours-per-unit
  assumptionOverrides?: Partial<Assumptions>;
  wages?: Record<string, number>; // crew id -> $/hr override
  priorAward?: PriorAward;
  topDown?: TopDownEstimate;
  topDownOverrides?: Partial<TopDownAssumptions>;
  ai: AiConfig;
  documents: { name: string; size: number; pages?: number; chars: number; mode: 'native_pdf' | 'text' }[];
  extraction?: { provider: 'claude' | 'heuristic'; model?: string; finishedAt: string; durationMs: number; usage?: { input: number; output: number } };
}

/** Global estimating assumptions (editable in the UI). */
export interface Assumptions {
  productiveHoursPerFte: number; // e.g. 1,776
  supervisorRatio: number; // working supervisors per N FTE (e.g. 1 per 12)
  contractYears: number;
  workloadGrowthPerYear: number; // fraction, applied to hours each option year
  wageEscalationPerYear: number; // fraction, applied to $ each option year
  climateZone: ClimateZone;
  growingSeasonWeeks: number;
  snowEventsPerYear: number; // derived from climate unless overridden
  cleanableShareDefault: number; // gross -> cleanable when RFP is silent
}

// ---------- SSE events emitted by the extraction endpoint ----------

export type ExtractionEvent =
  | { type: 'status'; message: string; stage: 'reading' | 'ai' | 'merging' | 'done' }
  | { type: 'document'; name: string; pages?: number; chars: number; mode: 'native_pdf' | 'text' }
  | { type: 'ai_text'; text: string; kind?: 'text' | 'thinking' | 'tool' }
  | { type: 'facility'; facility: Facility }
  | { type: 'grounds'; area: GroundsArea }
  | { type: 'site'; site: SiteInfo }
  | { type: 'prior_award'; award: PriorAward }
  | { type: 'topdown'; topDown: TopDownEstimate }
  | { type: 'done'; inventory: Inventory; provider: 'claude' | 'heuristic'; model?: string; durationMs: number; usage?: { input: number; output: number } }
  | { type: 'error'; message: string };
