// RS Means-style productivity factor library.
//
// Each factor is expressed the way RSMeans Facilities Maintenance & Repair data is
// organized: a task, a crew, a unit of measure, and labor-hours per unit (the inverse
// of "daily output"). The numbers below are REPRESENTATIVE DEFAULTS for base operations
// support (BOS) estimating. RSMeans data is licensed; before pricing a bid, open the
// Factors panel and reconcile each line against your organization's current RSMeans
// edition (or your own historical productivity). Every value is editable and the
// override is stored with the project.
//
// Calibration (2026 benchmark study): the defaults target APPA Level 2 ("ordinary tidiness")
// for daily custodial service, ISSA 540 / 612 cleaning times for individual tasks, published
// floor-care, mowing, sports-field and snow production rates for the periodic lines, and
// military full-food-service contracts (≈6–9 meals per productive labor-hour) for dining.
// Each recalibrated, new or benchmark-validated line carries a short `basis` citation, shown in
// the Factors dialog; tests/calibration.test.ts keeps the composites inside their bands.
// APPA / NCES area figures are SF per custodian ON SHIFT (8 h per service day). The engine's FTE
// is 1,776 productive hours, so SF per FTE = SF per shift × 0.888 for 5-day service
// (250 × 8 / 1,776) and × 0.617 for 7-day service (360 × 8 / 1,776) — compare like with like.
// The benchmark sources are secondary summaries of paid publications (APPA, ISSA, PGMS, RSMeans);
// they set plausible bands, not licensed line values.

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
  { id: 'custodial', label: 'Custodial crew', short: 'Custodial', color: '#1a8cf0', defaultWage: 17.5, shift: { start: 17, end: 1.5 }, domain: 'interior' },
  { id: 'floor_care', label: 'Floor care crew', short: 'Floor care', color: '#c856ca', defaultWage: 19.5, shift: { start: 20, end: 4.5 }, domain: 'interior' },
  { id: 'grounds_mow', label: 'Grounds — mowing crew', short: 'Mowing', color: '#55b4be', defaultWage: 18.5, shift: { start: 6, end: 14.5 }, domain: 'grounds' },
  { id: 'grounds_landscape', label: 'Grounds — landscape crew', short: 'Landscape', color: '#f5732e', defaultWage: 19.0, shift: { start: 6.5, end: 15 }, domain: 'grounds' },
  { id: 'dining_prod', label: 'Dining — food production', short: 'Food prod', color: '#e0408a', defaultWage: 19.0, shift: { start: 4.5, end: 20 }, domain: 'dining' },
  { id: 'dining_san', label: 'Dining — attendants & sanitation', short: 'Dining san', color: '#74fba4', defaultWage: 17.0, shift: { start: 5.5, end: 21 }, domain: 'dining' },
  { id: 'supervision', label: 'Working supervision', short: 'Supervision', color: '#c3bcfa', defaultWage: 28.0, shift: { start: 6, end: 14.5 }, domain: 'interior' },
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
  /** How the APPA cleaning level scales this line: appearance work fully, restroom sanitation within ±1/3; absent = not at all (infection control, periodic work). */
  appearance?: 'full' | 'sanitation';
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
  /** Short benchmark citation for the default rate (ISSA / APPA / SFMA …), shown in the Factors dialog. */
  basis?: string;
}

export const FACTORS: Factor[] = [
  // ---------------- Custodial (interior, routine) ----------------
  { id: 'cust_trash', name: 'Empty waste receptacles, police area, reline', ref: 'FM&R 01 93 04 Custodial — waste removal', crew: 'custodial', unit: 'msf', lhPerUnit: 0.05, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { allFloor: true }, basis: 'ISSA bidding example runs a trash route at ≈30,000 SF/h (2 min/MSF); legacy ISSA 0.5 min per basket. 3 min/MSF incl. relining & policing.' },
  { id: 'cust_vacuum_lanes', name: 'Vacuum carpet, traffic lanes (backpack / wide-area)', ref: 'FM&R 01 93 04 Custodial — vacuuming', crew: 'custodial', unit: 'msf', lhPerUnit: 0.15, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { floor: ['carpet'] }, basis: 'ISSA 540: 14" backpack vacuum 8.1 min/MSF full area; open carpet 7,000–9,000 SF/h. 9 min/MSF ≈ 6,700 SF/h.' },
  { id: 'cust_vacuum_full', name: 'Vacuum carpet, wall-to-wall, detail edges', ref: 'FM&R 01 93 04 Custodial — vacuuming', crew: 'custodial', unit: 'msf', lhPerUnit: 0.25, frequency: { kind: 'per_year', times: 50 }, appearance: 'full', applies: { floor: ['carpet'] }, basis: 'ISSA-based open-office detail vacuuming 3,000–5,000 SF/h (ISSA 540 12" upright 26.8 min/MSF). 15 min/MSF ≈ 4,000 SF/h.' },
  { id: 'cust_dustmop', name: 'Dust mop hard & resilient floors', ref: 'FM&R 01 93 04 Custodial — floor sweeping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.1, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { floor: ['resilient', 'hardTile', 'wood'] }, basis: 'ISSA 540: 36" dust mop 4.8 min/MSF, 48" 2.4 min/MSF. 6 min/MSF incl. edges and furniture.' },
  { id: 'cust_dampmop', name: 'Damp mop hard & resilient floors (spot/traffic)', ref: 'FM&R 01 93 04 Custodial — damp mopping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.2, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { floor: ['resilient', 'hardTile'] }, basis: 'ISSA 540: 24-oz mop & bucket 12.0 min/MSF; ISSA 612: 14" flat mop 5,355 SF/h (11.2 min/MSF).' },
  { id: 'cust_sweep_concrete', name: 'Sweep sealed concrete, ride-on sweeper', ref: 'FM&R 01 93 04 Custodial — power sweeping', crew: 'custodial', unit: 'msf', lhPerUnit: 0.06, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { floor: ['concrete'] } },
  { id: 'cust_dusting', name: 'Dust horizontal surfaces, low (desks, ledges, furniture)', ref: 'FM&R 01 93 04 Custodial — dusting', crew: 'custodial', unit: 'msf', lhPerUnit: 0.15, frequency: { kind: 'per_year', times: 50 }, appearance: 'full', applies: { allFloor: true } },
  { id: 'cust_spot', name: 'Spot clean doors, partitions, interior glass, walls', ref: 'FM&R 01 93 04 Custodial — spot cleaning', crew: 'custodial', unit: 'msf', lhPerUnit: 0.05, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { allFloor: true }, basis: 'No ISSA per-MSF value; set so the office composite lands at APPA Level 2 (office 16,900 SF/custodian; NCES L2 11–18k; FL DOE 19k).' },
  { id: 'cust_restroom', name: 'Clean & disinfect restroom fixture (incl. floor, mirrors, restock)', ref: 'FM&R 01 93 04 Custodial — restroom, per fixture', crew: 'custodial', unit: 'fixture', lhPerUnit: 0.075, frequency: { kind: 'per_service_day' }, appearance: 'sanitation', applies: { fixtures: true }, note: '≈4.5 min per fixture per service', basis: 'Validated: ISSA baseline 3 min per fixture incl. travel & restock; 4.5 min for APPA Level 2.' },
  { id: 'cust_entrance', name: 'Clean entrance glass & vestibule mats', ref: 'FM&R 01 93 04 Custodial — entrance glass', crew: 'custodial', unit: 'msf', lhPerUnit: 0.015, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { allFloor: true }, basis: 'Set so the office composite lands at APPA Level 2: ≈22 min/day for a 25k SF building (two entrance glass sets and mats).' },
  { id: 'cust_kitchenette', name: 'Break room / kitchenette sanitation', ref: 'FM&R 01 93 04 Custodial — break areas', crew: 'custodial', unit: 'msf', lhPerUnit: 0.02, frequency: { kind: 'per_service_day' }, appearance: 'full', applies: { allFloor: true, excludeCategories: ['warehouse', 'hangar', 'maintenance', 'dining'] }, basis: 'Set so the office composite lands at APPA Level 2: one 10-min break-room service per ≈8,000 SF of office.' },
  { id: 'cust_high_dust', name: 'High dusting: vents, diffusers, ledges, blinds', ref: 'FM&R 01 93 04 Custodial — high dusting', crew: 'custodial', unit: 'msf', lhPerUnit: 0.2, frequency: { kind: 'per_year', times: 4 }, applies: { allFloor: true } },
  { id: 'cust_windows', name: 'Window washing, interior & exterior (per MSF floor area)', ref: 'FM&R 01 93 04 Custodial — window washing', crew: 'custodial', unit: 'msf', lhPerUnit: 0.45, frequency: { kind: 'per_year', times: 2 }, applies: { allFloor: true } },
  { id: 'cust_med_disinfect', name: 'Disinfect high-touch surfaces, exam & treatment rooms', ref: 'FM&R 01 93 04 Custodial — healthcare disinfection', crew: 'custodial', unit: 'msf', lhPerUnit: 0.1, frequency: { kind: 'per_service_day' }, applies: { allFloor: true, categories: ['medical'] }, basis: 'New line. Puts a clinic at ≈12,400 SF per custodian shift (APPA Level 1–2), above hospital EVS ≈1,300 SF/h ≈ 10,400 per shift (HFM four-step ES staffing).' },

  // ---------------- Floor care (interior, periodic) ----------------
  { id: 'fc_spraybuff', name: 'Spray buff resilient floor, high-speed burnisher', ref: 'FM&R 01 93 04 Floor care — burnishing', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.4, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['resilient'] }, basis: 'Validated: spray buff, 17" high-speed 2,000–3,000 SF/h (janitorialstore.com floor-care production rates); 2,500 SF/h. ISSA 540 6 min/MSF (10,000 SF/h) is a 20" 2000-rpm dry burnish, a different task.' },
  { id: 'fc_scrub_recoat', name: 'Machine scrub & recoat resilient floor (2 coats)', ref: 'FM&R 01 93 04 Floor care — scrub & recoat', crew: 'floor_care', unit: 'msf', lhPerUnit: 2.2, frequency: { kind: 'per_year', times: 4 }, applies: { floor: ['resilient'] } },
  { id: 'fc_strip_wax', name: 'Strip, seal & apply 4 coats floor finish', ref: 'FM&R 01 93 04 Floor care — strip & refinish', crew: 'floor_care', unit: 'msf', lhPerUnit: 6.5, frequency: { kind: 'per_year', times: 1 }, applies: { floor: ['resilient'] }, basis: 'Validated: 154 SF/h vs CRI floor-covering LCC 100–125, Imperial Dade ≈150, field reports ≈333 SF/h.' },
  { id: 'fc_tile_scrub', name: 'Machine scrub ceramic / quarry tile & grout', ref: 'FM&R 01 93 04 Floor care — tile scrubbing', crew: 'floor_care', unit: 'msf', lhPerUnit: 1.0, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['hardTile'] }, basis: 'Restroom-scale tile & grout detail at 1,000 SF/h (open-area autoscrubbing 17,000–20,000 SF/h, janitorialstore.com). Low confidence.' },
  { id: 'fc_carpet_interim', name: 'Carpet interim cleaning (encapsulation / bonnet)', ref: 'FM&R 01 93 04 Floor care — carpet interim', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.9, frequency: { kind: 'per_year', times: 4 }, applies: { floor: ['carpet'] }, basis: 'Validated: AICS 2018 time-motion study, bonnet / encapsulation 60–70 min/MSF.' },
  { id: 'fc_carpet_extract', name: 'Carpet hot-water extraction, truck/portable', ref: 'FM&R 01 93 04 Floor care — carpet extraction', crew: 'floor_care', unit: 'msf', lhPerUnit: 1.4, frequency: { kind: 'per_year', times: 2 }, applies: { floor: ['carpet'] }, basis: 'CMM: portable / box wand 600–1,200 SF/h, truckmount wand 600–1,400; ISSA 400–2,000 by soil load. 714 SF/h.' },
  { id: 'fc_wood', name: 'Gym wood floor: screen & recoat', ref: 'FM&R 01 93 04 Floor care — wood floor recoat', crew: 'floor_care', unit: 'msf', lhPerUnit: 3.0, frequency: { kind: 'per_year', times: 1 }, applies: { floor: ['wood'] } },
  { id: 'fc_concrete_scrub', name: 'Auto-scrub sealed concrete (ride-on)', ref: 'FM&R 01 93 04 Floor care — auto scrubbing', crew: 'floor_care', unit: 'msf', lhPerUnit: 0.12, frequency: { kind: 'per_year', times: 12 }, applies: { floor: ['concrete'] } },

  // ---------------- Grounds — mowing crew ----------------
  { id: 'gr_mow_improved', name: 'Mow improved turf, 72" zero-turn', ref: 'FM&R 32 01 90 Lawn maintenance — mowing, riding', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.45, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] }, basis: 'Cornell: 60" riding ≈2 ac/h; Exmark at 80%: 72" at 6–8 mph = 3.5–4.6 ac/h theoretical. 2.2 ac/h incl. obstacles & travel.' },
  { id: 'gr_trim_edge', name: 'String trim & edge walks/curbs/obstacles, improved', ref: 'FM&R 32 01 90 Lawn maintenance — trimming & edging', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.3, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_blow', name: 'Blow clippings from walks, lots, entrances', ref: 'FM&R 32 01 90 Lawn maintenance — clean-up', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.1, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_mow_semi', name: "Mow semi-improved, tractor w/ 15' batwing", ref: 'FM&R 32 01 90 Lawn maintenance — tractor mowing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.18, frequency: { kind: 'mow_cycles', multiplier: 1 / 3 }, applies: { groundsKind: ['semi_improved'] }, basis: 'Validated: Exmark formula, 15-ft cutter at 5 mph ≈7.3 ac/h at 80% efficiency; 5.6 ac/h here.' },
  { id: 'gr_mow_unimproved', name: 'Rotary-cut (bush hog) unimproved grounds', ref: 'FM&R 32 01 90 Lawn maintenance — rough mowing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.15, frequency: { kind: 'per_year', times: 3 }, applies: { groundsKind: ['unimproved'] }, basis: 'Exmark formula: 15-ft cutter at 5 mph = 9.1 ac/h (100%), 7.3 (80%); rough terrain and transport between parcels → 6.7 ac/h.' },
  { id: 'gr_athletic_mow', name: 'Mow athletic field (2x/week in season)', ref: 'FM&R 32 01 90 Lawn maintenance — athletic turf', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.9, frequency: { kind: 'mow_cycles', multiplier: 2 }, applies: { groundsKind: ['athletic_field'] } },
  { id: 'gr_athletic_prep', name: 'Athletic field prep, drag & line', ref: 'FM&R 32 01 90 Lawn maintenance — field marking', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 1.8, frequency: { kind: 'mow_cycles', multiplier: 1 }, applies: { groundsKind: ['athletic_field'] }, basis: 'SFMA: ≈250 h per high-school native-soil field-year (1.8–2 acres: ≈125–140 h/acre), ≈415 h heavy use (≈210–230 h/acre). ≈3.2 h per 1.8-acre field per week; athletic fields total ≈130 h/acre/yr at 30 weeks.' },
  { id: 'gr_police', name: 'Police litter & debris, improved areas', ref: 'FM&R 32 01 90 Site maintenance — policing', crew: 'grounds_mow', unit: 'acre', lhPerUnit: 0.05, frequency: { kind: 'per_year', times: 250 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },

  // ---------------- Grounds — landscape crew ----------------
  { id: 'gr_bed_maint', name: 'Planting bed weeding, cultivating, debris', ref: 'FM&R 32 01 90 Planting maintenance — bed care', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 0.9, frequency: { kind: 'per_year', times: 10 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_mulch', name: 'Re-mulch beds, 2" shredded hardwood', ref: 'FM&R 32 01 90 Planting maintenance — mulching', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 2.5, frequency: { kind: 'per_year', times: 1 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_prune_shrub', name: 'Prune shrubs & hedges, haul debris', ref: 'FM&R 32 01 90 Planting maintenance — pruning', crew: 'grounds_landscape', unit: 'msf_bed', lhPerUnit: 1.2, frequency: { kind: 'per_year', times: 2 }, applies: { groundsKind: ['shrub_bed'] } },
  { id: 'gr_tree_prune', name: 'Prune tree ≤ 30 ft, clean-up (3-yr cycle)', ref: 'FM&R 32 01 90 Tree maintenance — pruning', crew: 'grounds_landscape', unit: 'each', lhPerUnit: 0.75, frequency: { kind: 'per_year', times: 0.34 }, applies: { groundsKind: ['tree_canopy'] } },
  { id: 'gr_athletic_cultural', name: 'Athletic turf core aeration, overseed & topdress', ref: 'FM&R 32 01 90 Lawn maintenance — aeration / renovation', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 2.0, frequency: { kind: 'per_year', times: 4 }, applies: { groundsKind: ['athletic_field'] }, basis: 'New line. SFMA field-year totals include aeration, overseeding and topdressing: 8 h/acre/yr.' },
  { id: 'gr_fert', name: 'Fertilize & broadleaf weed control, improved turf', ref: 'FM&R 32 01 90 Lawn maintenance — fertilizing', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.2, frequency: { kind: 'per_year', times: 4 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },
  { id: 'gr_irrig', name: 'Irrigation inspection & head adjustment', ref: 'FM&R 32 84 00 Irrigation — inspection', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.08, frequency: { kind: 'mow_cycles', multiplier: 0.5 }, applies: { groundsKind: ['improved_turf', 'athletic_field'] } },
  { id: 'gr_leaf', name: 'Leaf removal, blow / vacuum / haul', ref: 'FM&R 32 01 90 Lawn maintenance — leaf removal', crew: 'grounds_landscape', unit: 'acre', lhPerUnit: 0.7, frequency: { kind: 'leaf_season' }, applies: { groundsKind: ['improved_turf'] } },
  { id: 'gr_parking_sweep', name: 'Parking lot mechanical sweeping', ref: 'FM&R 32 01 13 Paving maintenance — sweeping', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.025, frequency: { kind: 'per_year', times: 12 }, applies: { groundsKind: ['parking'] } },
  { id: 'gr_parking_police', name: 'Parking lot litter / police', ref: 'FM&R 32 01 13 Paving maintenance — policing', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.01, frequency: { kind: 'per_year', times: 150 }, applies: { groundsKind: ['parking'] } },
  { id: 'gr_walk_blow', name: 'Sidewalk blowing, litter, weed control at joints', ref: 'FM&R 32 01 13 Paving maintenance — walks', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.03, frequency: { kind: 'per_year', times: 150 }, applies: { groundsKind: ['sidewalk'] } },
  { id: 'gr_snow_walk', name: 'Snow & ice removal, walks & entrances (per event)', ref: 'FM&R 32 01 13 Snow removal — walks, hand/blower', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.45, frequency: { kind: 'snow_events' }, applies: { groundsKind: ['sidewalk'] }, basis: 'Validated: hand shovel ≈1,250 SF/h up to blower ≈5,000 SF/h; 2,222 SF/h here.' },
  { id: 'gr_snow_lot', name: 'Snow plowing, parking lots (per event)', ref: 'FM&R 32 01 13 Snow removal — plowing', crew: 'grounds_landscape', unit: 'msf_paved', lhPerUnit: 0.035, frequency: { kind: 'snow_events' }, applies: { groundsKind: ['parking'] }, basis: 'Validated: SIMA 0.5–1.9 ac/h (pickup plow ≈1 ac/h on an open lot); 0.66 ac/h here for lots with islands and cars.' },

  // ---------------- Dining facility (full food service) ----------------
  { id: 'dn_prep', name: 'Food preparation & cooking', ref: 'Dining FFS — production labor, per meal', crew: 'dining_prod', unit: 'meal', lhPerUnit: 0.04, frequency: { kind: 'per_meal' }, applies: { dining: 'production' }, note: '≈25 meals per labor-hour' },
  { id: 'dn_serve', name: 'Serving line, short order, salad bar', ref: 'Dining FFS — service labor, per meal', crew: 'dining_prod', unit: 'meal', lhPerUnit: 0.028, frequency: { kind: 'per_meal' }, applies: { dining: 'production' }, basis: 'Puts a 2,000-meal FFS DFAC at ≈7.8 meals per labor-hour: Fort Hood ≈8.3, Fort Leonard Wood ≈7.1, Keesler/Meridian ≈5.8 (per productive hour).' },
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
  admin: { label: 'Administrative / office', floorMix: { carpet: 0.55, resilient: 0.25, hardTile: 0.15, concrete: 0.05, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.5, occupantsPerMsf: 4, typicalFloors: 2, aspect: 1.6, color: '#b8b8b8' },
  barracks: { label: 'Barracks / dormitory', floorMix: { carpet: 0.2, resilient: 0.5, hardTile: 0.25, concrete: 0.05, wood: 0 }, cleanableShare: 0.6, serviceLevel: 'daily_7', fixturesPerMsf: 2.0, occupantsPerMsf: 3, typicalFloors: 3, aspect: 2.4, color: '#b9996b' },
  dining: { label: 'Dining facility', floorMix: { carpet: 0.1, resilient: 0.2, hardTile: 0.7, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 0.6, occupantsPerMsf: 15, typicalFloors: 1, aspect: 1.5, color: '#f5911d' },
  medical: { label: 'Medical / dental clinic', floorMix: { carpet: 0.15, resilient: 0.6, hardTile: 0.25, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 1.2, occupantsPerMsf: 5, typicalFloors: 2, aspect: 1.5, color: '#f5f5f5' },
  warehouse: { label: 'Warehouse / supply', floorMix: { carpet: 0, resilient: 0.1, hardTile: 0, concrete: 0.9, wood: 0 }, cleanableShare: 0.3, serviceLevel: '2x_week', fixturesPerMsf: 0.1, occupantsPerMsf: 0.3, typicalFloors: 1, aspect: 2.2, color: '#857c72' },
  maintenance: { label: 'Maintenance shop / motor pool', floorMix: { carpet: 0, resilient: 0.2, hardTile: 0, concrete: 0.8, wood: 0 }, cleanableShare: 0.4, serviceLevel: '2x_week', fixturesPerMsf: 0.2, occupantsPerMsf: 0.8, typicalFloors: 1, aspect: 1.8, color: '#666666' },
  hangar: { label: 'Aircraft hangar', floorMix: { carpet: 0, resilient: 0.05, hardTile: 0, concrete: 0.95, wood: 0 }, cleanableShare: 0.25, serviceLevel: 'weekly', fixturesPerMsf: 0.08, occupantsPerMsf: 0.3, typicalFloors: 1, aspect: 1.3, color: '#97a5b0' },
  fitness: { label: 'Fitness center / gym', floorMix: { carpet: 0, resilient: 0.4, hardTile: 0.3, concrete: 0, wood: 0.3 }, cleanableShare: 0.9, serviceLevel: 'daily_7', fixturesPerMsf: 1.5, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.4, color: '#3892d8' },
  child_care: { label: 'Child development center', floorMix: { carpet: 0.3, resilient: 0.6, hardTile: 0.1, concrete: 0, wood: 0 }, cleanableShare: 0.9, serviceLevel: 'daily_5', fixturesPerMsf: 1.5, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.8, color: '#fcbcc4' },
  education: { label: 'Training / education', floorMix: { carpet: 0.35, resilient: 0.5, hardTile: 0.15, concrete: 0, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.8, occupantsPerMsf: 8, typicalFloors: 2, aspect: 1.8, color: '#32b78c' },
  community: { label: 'Community / MWR / chapel', floorMix: { carpet: 0.4, resilient: 0.35, hardTile: 0.25, concrete: 0, wood: 0 }, cleanableShare: 0.85, serviceLevel: 'daily_5', fixturesPerMsf: 0.8, occupantsPerMsf: 6, typicalFloors: 1, aspect: 1.5, color: '#a49ddc' },
  lab: { label: 'Laboratory / technical', floorMix: { carpet: 0.1, resilient: 0.7, hardTile: 0.2, concrete: 0, wood: 0 }, cleanableShare: 0.8, serviceLevel: 'daily_5', fixturesPerMsf: 0.6, occupantsPerMsf: 3, typicalFloors: 2, aspect: 1.5, color: '#51d7f9' },
  other: { label: 'Other', floorMix: { carpet: 0.3, resilient: 0.4, hardTile: 0.2, concrete: 0.1, wood: 0 }, cleanableShare: 0.8, serviceLevel: 'daily_5', fixturesPerMsf: 0.5, occupantsPerMsf: 3, typicalFloors: 1, aspect: 1.5, color: '#888888' },
};

export const SNOW_EVENTS_BY_CLIMATE = { cold: 18, temperate: 6, hot_humid: 0, arid: 1 } as const;
export const GROWING_WEEKS_BY_CLIMATE = { cold: 24, temperate: 30, hot_humid: 40, arid: 34 } as const;
