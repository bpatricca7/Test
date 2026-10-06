// RS Means-style productivity factor library.
//
// Each factor is expressed the way RSMeans Facilities Maintenance & Repair data is
// organized: a task, a crew, a unit of measure, and labor-hours per unit (the inverse
// of "daily output"). The numbers below are REPRESENTATIVE DEFAULTS for base operations
// support (BOS) estimating. RSMeans data is licensed; before pricing a bid, open the
// Factors panel and reconcile each line against your organization's current RSMeans
// edition (or your own historical productivity). Every value is editable and the
// override is stored with the project.

import type { FacilityCategory, FloorMix, GroundsKind, ServiceLevel } from './types';

export type Crew =
  | 'custodial'
  | 'floor_care'
  | 'grounds_mow'
  | 'grounds_landscape'
  | 'dining_prod'
  | 'dining_san'
  | 'supervision';

export interface CrewMeta {
  id: Crew;
  label: string;
  short: string;
  color: string; // used for the 3D crews
  defaultWage: number; // $/hr, base (SCA-style) — editable
  shift: { start: number; end: number }; // sim hours (24h), used by the live tracker
  domain: 'interior' | 'grounds' | 'dining';
}

export const CREWS: CrewMeta[] = [
  { id: 'custodial', label: 'Custodial crew', short: 'Custodial', color: '#38bdf8', defaultWage: 17.5, shift: { start: 17, end: 1.5 }, domain: 'interior' },
  { id: 'floor_care', label: 'Floor care crew', short: 'Floor care', color: '#a78bfa', defaultWage: 19.5, shift: { start: 20, end: 4.5 }, domain: 'interior' },
  { id: 'grounds_mow', label: 'Grounds — mowing crew', short: 'Mowing', color: '#4ade80', defaultWage: 18.5, shift: { start: 6, end: 14.5 }, domain: 'grounds' },
  { id: 'grounds_landscape', label: 'Grounds — landscape crew', short: 'Landscape', color: '#facc15', defaultWage: 19.0, shift: { start: 6.5, end: 15 }, domain: 'grounds' },
  { id: 'dining_prod', label: 'Dining — food production', short: 'Food prod', color: '#fb923c', defaultWage: 19.0, shift: { start: 4.5, end: 20 }, domain: 'dining' },
  { id: 'dining_san', label: 'Dining — attendants & sanitation', short: 'Dining san', color: '#f472b6', defaultWage: 17.0, shift: { start: 5.5, end: 21 }, domain: 'dining' },
  { id: 'supervision', label: 'Working supervision', short: 'Supervision', color: '#e2e8f0', defaultWage: 28.0, shift: { start: 6, end: 14.5 }, domain: 'interior' },
];

export const crewMeta = (id: Crew): CrewMeta => CREWS.find((c) => c.id === id)!;

export type FactorUnit =
  | 'msf' // 1,000 sq ft of floor area
  | 'fixture' // restroom fixture
  | 'acre'
  | 'msf_bed' // 1,000 sq ft of planting bed
  | 'msf_paved' // 1,000 sq ft of paved surface
  | 'each' // tree
  | 'meal'
  | 'day'; // per operating day of a dining facility

export type FrequencyRule =
  | { kind: 'per_service_day' } // custodial: service days / year from the facility's service level
  | { kind: 'per_year'; times: number }
  | { kind: 'mow_cycles'; multiplier: number } // growing-season weeks × multiplier
  | { kind: 'snow_events' }
  | { kind: 'leaf_season' } // 3 cycles in cold/temperate, 0 otherwise
  | { kind: 'dining_days' } // dining operating days / year
  | { kind: 'dining_meal_periods' } // operating days × meal periods
  | { kind: 'per_meal' }; // meals per year

export interface Factor {
  id: string;
  name: string;
  /** RSMeans-style reference (section / line family). Reconcile against your licensed edition. */
  ref: string;
  crew: Crew;
  unit: FactorUnit;
  lhPerUnit: number; // labor-hours per unit per occurrence
  frequency: FrequencyRule;
  applies: {
    floor?: (keyof FloorMix)[]; // custodial lines: which floor finishes drive the quantity
    allFloor?: boolean; // quantity = total cleanable area
    fixtures?: boolean;
    categories?: FacilityCategory[];
    excludeCategories?: FacilityCategory[];
    groundsKind?: GroundsKind[];
    dining?: 'production' | 'service' | 'sanitation' | 'management';
  };
  note?: string;
}

export const FACTORS: Factor[] = [
  // ---------------- Custodial (interior, routine) ----------------
  { id: 'cust_trash', name: 'Empty waste receptacles, police area, reline', ref: 'FM&R 01 93 04 Custodial — waste removal', crew: 'custodial', unit: 'msf', lhPerUnit: 0.12, frequency: { kind: 'per_service_day' }, applies: { allFloor: true } },
  { id: 'cust_vacuum_lanes', name: 'Vacuum carpet, traffic lanes (upright)', ref: 'FM&R 01 93 04 Custodial — vacuuming', crew: 'custodial', unit: 'msf', lhPerUnit: 0.3, frequency: { kind: 'per_service_day' }, applies: { floor: ['carpet'] } },
  { id: 'cust_vacuum_full', name: 'Vacuum carpet, wall-to-wall, detail edges', ref: 'FM&R 01 93 04 Custodial — vacuuming', crew: 'custodial', unit: 'msf', lhPerUnit: 0.55, frequency: { kind: 'per_year', times: 50 }, applies: { floor: ['carpet'] } },
  { id: 'cust_dustmop', name: 'Dust mop hard & resilient floors', ref: 'FM&R 01 93 04 Custodial — floor sweeping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.22, frequency: { kind: 'per_service_day' }, applies: { floor: ['resilient', 'hardTile', 'wood'] } },
  { id: 'cust_dampmop', name: 'Damp mop hard & resilient floors (spot/traffic)', ref: 'FM&R 01 93 04 Custodial — damp mopping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.35, frequency: { kind: 'per_service_day' }, applies: { floor: ['resilient', 'hardTile'] } },
  { id: 'cust_sweep_concrete', name: 'Sweep sealed concrete, ride-on sweeper', ref: 'FM&R 01 93 04 Custodial — power sweeping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.06, frequency: { kind: 'per_service_day' }, applies: { floor: ['concrete'] } },
  { id: 'cust_dusting', name: 'Dust horizontal surfaces, low (desks, ledges, furniture)', ref: 'FM&R 01 93 04 Custodial — dusting', crew: 'custodial', unit: 'msf', lhPerUnit: 0.15, frequency: { kind: 'per_year', times: 50 }, applies: { allFloor: true } },
  { id: 'cust_spot', name: 'Spot clean doors, partitions, interior glass, walls', ref: 'FM&R 01 93 04 Custodial — spot cleaning', crew: 'custodial', unit: 'msf', lhPerUnit: 0.1, frequency: { kind: 'per_service_day' }, applies: { allFloor: true } },
  { id: 'cust_restroom', name: 'Clean & disinfect restroom fixture (incl. floor, mirrors, restock)', ref: 'FM&R 01 93 04 Custodial — restroom, per fixture', crew: 'custodial', unit: 'fixture', lhPerUnit: 0.075, frequency: { kind: 'per_service_day' }, applies: { fixtures: true }, note: '≈4.5 min per fixture per service' },
  { id: 'cust_entrance', name: 'Clean entrance glass & vestibule mats', ref: 'FM&R 01 93 04 Custodial — entrance glass', crew: 'custodial', unit: 'msf', lhPerUnit: 0.05, frequency: { kind: 'per_service_day' }, applies: { allFloor: true } },
  { id: 'cust_kitchenette', name: 'Break room / kitchenette sanitation', ref: 'FM&R 01 93 04 Custodial — break areas', crew: 'custodial', unit: 'msf', lhPerUnit: 0.08, frequency: { kind: 'per_service_day' }, applies: { allFloor: true, excludeCategories: ['warehouse', 'hangar', 'maintenance', 'dining'] } },
  { id: 'cust_high_dust', name: 'High dusting: vents, diffusers, ledges, blinds', ref: 'FM&R 01 93 04 Custodial — high dusting', crew: 'custodial', unit: 'msf', lhPerUnit: 0.2, frequency: { kind: 'per_year', times: 4 }, applies: { allFloor: true } },
  { id: 'cust_windows', name: 'Window washing, interior & exterior (per MSF floor area)', ref: 'FM&R 01 93 04 Custodial — window washing', crew: 'custodial', unit: 'msf', lhPerUnit: 0.45, frequency: { kind: 'per_year', times: 2 }, applies: { allFloor: true } },

  // ---------------- Floor care (interior, periodic) ----------------
  { id: 'fc_spraybuff', name: 'Spray buff resilient floor, high-speed burnisher', ref: 'FM&R 01 93 04 Floor care — burnishing', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.4, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['resilient'] } },
  { id: 'fc_scrub_recoat', name: 'Machine scrub & recoat resilient floor (2 coats)', ref: 'FM&R 01 93 04 Floor care — scrub & recoat', crew: 'floor_care', unit: 'msf', lhPerUnit: 2.2, frequency: { kind: 'per_year', times: 4 }, applies: { floor: ['resilient'] } },
  { id: 'fc_strip_wax', name: 'Strip, seal & apply 4 coats floor finish', ref: 'FM&R 01 93 04 Floor care — strip & refinish', crew: 'floor_care', unit: 'msf', lhPerUnit: 6.5, frequency: { kind: 'per_year', times: 1 }, applies: { floor: ['resilient'] } },
  { id: 'fc_tile_scrub', name: 'Machine scrub ceramic / quarry tile & grout', ref: 'FM&R 01 93 04 Floor care — tile scrubbing', crew: 'floor_care', unit: 'msf', lhPerUnit: 1.4, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['hardTile'] } },
  { id: 'fc_carpet_interim', name: 'Carpet interim cleaning (encapsulation / bonnet)', ref: 'FM&R 01 93 04 Floor care — carpet interim', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.9, frequency: { kind: 'per_year', times: 4 }, applies: { floor: ['carpet'] } },
  { id: 'fc_carpet_extract', name: 'Carpet hot-water extraction, truck/portable', ref: 'FM&R 01 93 04 Floor care — carpet extraction', crew: 'floor_care', unit: 'msf', lhPerUnit: 1.8, frequency: { kind: 'per_year', times: 2 }, applies: { floor: ['carpet'] } },
  { id: 'fc_wood', name: 'Gym wood floor: screen & recoat', ref: 'FM&R 01 93 04 Floor care — wood floor recoat', crew: 'floor_care', unit: 'msf', lhPerUnit: 3.0, frequency: { kind: 'per_year', times: 1 }, applies: { floor: ['wood'] } },
  { id: 'fc_concrete_scrub', name: 'Auto-scrub sealed concrete (ride-on)', ref: 'FM&R 01 93 04 Floor care — auto scrubbing', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.12, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['concrete'] } },

  // ---------------- Grounds — mowing crew ----------------
  { id: 'gr_mow_improved', name: 'Mow improved turf, 72" zero-turn', ref: 'FM&R 32 01 90 Lawn maintenance — mowing, riding', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.6, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_trim_edge', name: 'String trim & edge walks/curbs/obstacles, improved', ref: 'FM&R 32 01 90 Lawn maintenance — trimming & edging', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.3, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_blow', name: 'Blow clippings from walks, lots, entrances', ref: 'FM&R 32 01 90 Lawn maintenance — clean-up', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.1, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_mow_semi', name: "Mow semi-improved, tractor w/ 15' batwing", ref: 'FM&R 32 01 90 Lawn maintenance — tractor mowing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.18, frequency: { kind: 'mow_cycles', multiplier: 1 / 3 }, applies: { groundsKind: ['semi_improved'] } },
  { id: 'gr_mow_unimproved', name: 'Rotary-cut (bush hog) unimproved grounds', ref: 'FM&R 32 01 90 Lawn maintenance — rough mowing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.12, frequency: { kind: 'per_year', times: 3 }, applies: { groundsKind: ['unimproved'] } },
  { id: 'gr_athletic_mow', name: 'Mow athletic field (2x/week in season)', ref: 'FM&R 32 01 90 Lawn maintenance — athletic turf', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.9, frequency: { kind: 'mow_cycles', multiplier: 2 }, applies: { groundsKind: ['athletic_field'] } },
  { id: 'gr_athletic_prep', name: 'Athletic field prep, drag & line', ref: 'FM&R 32 01 90 Lawn maintenance — field marking', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.6, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['athletic_field'] } },
  { id: 'gr_police', name: 'Police litter & debris, improved areas', ref: 'FM&R 32 01 90 Site maintenance — policing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.05, frequency: { kind: 'per_year', times: 250 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },

  // ---------------- Grounds — landscape crew ----------------
  { id: 'gr_bed_maint', name: 'Planting bed weeding, cultivating, debris', ref: 'FM&R 32 01 90 Planting maintenance — bed care', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 0.9, frequency: { kind: 'per_year', times: 10 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_mulch', name: 'Re-mulch beds, 2" shredded hardwood', ref: 'FM&R 32 01 90 Planting maintenance — mulching', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 2.5, frequency: { kind: 'per_year', times: 1 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_prune_shrub', name: 'Prune shrubs & hedges, haul debris', ref: 'FM&R 32 01 90 Planting maintenance — pruning', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 1.2, frequency: { kind: 'per_year', times: 2 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_tree_prune', name: 'Prune tree ≤ 30 ft, clean-up (3-yr cycle)', ref: 'FM&R 32 01 90 Tree maintenance — pruning', crew: 'grounds_landscape', unit: 'each', lhPerUnit: 0.75, frequency: { kind: 'per_year', times: 0.34 }, applies: { groundsKind: ['tree_canopy'] } },
  { id: 'gr_fert', name: 'Fertilize & broadleaf weed control, improved turf', ref: 'FM&R 32 01 90 Lawn maintenance — fertilizing', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.2, frequency: { kind: 'per_year', times: 4 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },
  { id: 'gr_irrig', name: 'Irrigation inspection & head adjustment', ref: 'FM&R 32 84 00 Irrigation — inspection', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.08, frequency: { kind: 'mow_cycles', multiplier: 0.5 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },
  { id: 'gr_leaf', name: 'Leaf removal, blow / vacuum / haul', ref: 'FM&R 32 01 90 Lawn maintenance — leaf removal', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.7, frequency: { kind: 'leaf_season' }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_parking_sweep', name: 'Parking lot mechanical sweeping', ref: 'FM&R 32 01 13 Paving maintenance — sweeping', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.025, frequency: { kind: 'per_year', times: 12 }, applies: { groundsKind: ['parking'] } },
  { id: 'gr_parking_police', name: 'Parking lot litter / police', ref: 'FM&R 32 01 13 Paving maintenance — policing', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.01, frequency: { kind: 'per_year', times: 150 }, applies: { groundsKind: ['parking'] } },
  { id: 'gr_walk_blow', name: 'Sidewalk blowing, litter, weed control at joints', ref: 'FM&R 32 01 13 Paving maintenance — walks', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.03, frequency: { kind: 'per_year', times: 150 }, applies: { groundsKind: ['sidewalk'] } },
  { id: 'gr_snow_walk', name: 'Snow & ice removal, walks & entrances (per event)', ref: 'FM&R 32 01 13 Snow removal — walks, hand/blower', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.45, frequency: { kind: 'snow_events' }, applies: { groundsKind: ['sidewalk'] } },
  { id: 'gr_snow_lot', name: 'Snow plowing, parking lots (per event)', ref: 'FM&R 32 01 13 Snow removal — plowing', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.035, frequency: { kind: 'snow_events' }, applies: { groundsKind: ['parking'] } },

  // ---------------- Dining facility (full food service) ----------------
  { id: 'dn_prep', name: 'Food preparation & cooking', ref: 'Dining FFS — production labor, per meal', crew: 'dining_prod', unit: 'meal', lhPerUnit: 0.04, frequency: { kind: 'per_meal' }, applies: { dining: 'production' }, note: '≈25 meals per labor-hour' },
  { id: 'dn_serve', name: 'Serving line, short order, salad bar', ref: 'Dining FFS — service labor, per meal', crew: 'dining_prod', unit: 'meal', lhPerUnit: 0.022, frequency: { kind: 'per_meal' }, applies: { dining: 'production' } },
  { id: 'dn_dfa', name: 'Dining room attendants (bus, wipe, beverage station)', ref: 'Dining — DFA labor, per meal', crew: 'dining_san', unit: 'meal', lhPerUnit: 0.018, frequency: { kind: 'per_meal' }, applies: { dining: 'service' } },
  { id: 'dn_ware', name: 'Warewashing, pot & pan', ref: 'Dining — warewashing, per meal', crew: 'dining_san', unit: 'meal', lhPerUnit: 0.02, frequency: { kind: 'per_meal' }, applies: { dining: 'service' } },
  { id: 'dn_san_kitchen', name: 'Kitchen & serving line sanitation (floors, hoods, equipment)', ref: 'FM&R 01 93 04 Custodial — kitchen sanitation', crew: 'dining_san', unit: 'msf', lhPerUnit: 1.1, frequency: { kind: 'dining_days' }, applies: { dining: 'sanitation' } },
  { id: 'dn_san_dining', name: 'Dining room floor & table sanitation, after each meal period', ref: 'FM&R 01 93 04 Custodial — dining room', crew: 'dining_san', unit: 'msf', lhPerUnit: 0.5, frequency: { kind: 'dining_meal_periods' }, applies: { dining: 'sanitation' } },
  { id: 'dn_receiving', name: 'Receiving, storage, inventory', ref: 'Dining — storeroom labor, per day', crew: 'dining_prod', unit: 'day', lhPerUnit: 3.0, frequency: { kind: 'dining_days' }, applies: { dining: 'production' } },
  { id: 'dn_mgmt', name: 'Dining facility management & headcount/cashier', ref: 'Dining — management, per day', crew: 'dining_prod', unit: 'day', lhPerUnit: 16, frequency: { kind: 'dining_days' }, applies: { dining: 'management' } },
];

export const factorById = (id: string): Factor | undefined => FACTORS.find((f) => f.id === id);

// ---------------- Category defaults (applied when the RFP is silent) ----------------

export interface CategoryDefaults {
  label: string;
  floorMix: FloorMix;
  cleanableShare: number;
  serviceLevel: ServiceLevel;
  fixturesPerMsf: number; // restroom fixtures per 1,000 SF gross
  occupantsPerMsf: number;
  typicalFloors: number;
  aspect: number; // footprint length:width
  color: string; // 3D building color
}

export const CATEGORY_DEFAULTS: Record<FacilityCategory, CategoryDefaults> = {
  admin: { label: 'Administrative / office', floorMix: { carpet: 0.55, resilient: 0.25, hardTile: 0.15, concrete: 0.05, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.5, occupantsPerMsf: 4, typicalFloors: 2, aspect: 1.6, color: '#94a3b8' },
  barracks: { label: 'Barracks / dormitory', floorMix: { carpet: 0.2, resilient: 0.5, hardTile: 0.25, concrete: 0.05, wood: 0 }, cleanableShare: 0.6, serviceLevel: 'daily_7', fixturesPerMsf: 2.0, occupantsPerMsf: 3, typicalFloors: 3, aspect: 2.4, color: '#b8a48a' },
  dining: { label: 'Dining facility', floorMix: { carpet: 0.1, resilient: 0.2, hardTile: 0.7, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 0.6, occupantsPerMsf: 15, typicalFloors: 1, aspect: 1.5, color: '#f59e0b' },
  medical: { label: 'Medical / dental clinic', floorMix: { carpet: 0.15, resilient: 0.6, hardTile: 0.25, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 1.2, occupantsPerMsf: 5, typicalFloors: 2, aspect: 1.5, color: '#f8fafc' },
  warehouse: { label: 'Warehouse / supply', floorMix: { carpet: 0, resilient: 0.1, hardTile: 0, concrete: 0.9, wood: 0 }, cleanableShare: 0.3, serviceLevel: '2x_week', fixturesPerMsf: 0.1, occupantsPerMsf: 0.3, typicalFloors: 1, aspect: 2.2, color: '#78716c' },
  maintenance: { label: 'Maintenance shop / motor pool', floorMix: { carpet: 0, resilient: 0.2, hardTile: 0, concrete: 0.8, wood: 0 }, cleanableShare: 0.4, serviceLevel: '2x_week', fixturesPerMsf: 0.2, occupantsPerMsf: 0.8, typicalFloors: 1, aspect: 1.8, color: '#71717a' },
  hangar: { label: 'Aircraft hangar', floorMix: { carpet: 0, resilient: 0.05, hardTile: 0, concrete: 0.95, wood: 0 }, cleanableShare: 0.25, serviceLevel: 'weekly', fixturesPerMsf: 0.08, occupantsPerMsf: 0.3, typicalFloors: 1, aspect: 1.3, color: '#64748b' },
  fitness: { label: 'Fitness center / gym', floorMix: { carpet: 0, resilient: 0.4, hardTile: 0.3, concrete: 0, wood: 0.3 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 1.5, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.4, color: '#60a5fa' },
  child_care: { label: 'Child development center', floorMix: { carpet: 0.3, resilient: 0.6, hardTile: 0.1, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_5', fixturesPerMsf: 1.5, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.8, color: '#fda4af' },
  education: { label: 'Training / education', floorMix: { carpet: 0.35, resilient: 0.5, hardTile: 0.15, concrete: 0, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.8, occupantsPerMsf: 8, typicalFloors: 2, aspect: 1.8, color: '#a3e635' },
  community: { label: 'Community / MWR / chapel', floorMix: { carpet: 0.4, resilient: 0.35, hardTile: 0.25, concrete: 0, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.8, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.5, color: '#c4b5fd' },
  lab: { label: 'Laboratory / technical', floorMix: { carpet: 0.1, resilient: 0.7, hardTile: 0.2, concrete: 0, wood: 0 }, cleanableShare: 0.8, serviceLevel: 'daily_5', fixturesPerMsf: 0.6, occupantsPerMsf: 3, typicalFloors: 2, aspect: 1.5, color: '#67e8f9' },
  other: { label: 'Other', floorMix: { carpet: 0.3, resilient: 0.4, hardTile: 0.2, concrete: 0.1, wood: 0 }, cleanableShare: 0.8, serviceLevel: 'daily_5', fixturesPerMsf: 0.5, occupantsPerMsf: 3, typicalFloors: 1, aspect: 1.5, color: '#9ca3af' },
};

export const SNOW_EVENTS_BY_CLIMATE = { cold: 18, temperate: 6, hot_humid: 0, arid: 1 } as const;
export const GROWING_WEEKS_BY_CLIMATE = { cold: 24, temperate: 30, hot_humid: 40, arid: 34 } as const;
