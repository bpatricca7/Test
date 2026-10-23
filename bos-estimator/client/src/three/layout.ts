// Procedural site layout: turns the facility inventory into a campus of lots, buildings,
// grounds pads and roads. 1 scene unit = 10 ft. Grounds areas are drawn with a compressed
// scale (large acreages would otherwise dwarf the buildings) — labels always show real quantities.
//
// Stability (UI spec §9.10): computeLayout(f, g, { prev }) keeps every existing lot where it was, so editing
// one building never moves another. A full pack (sorted by category) runs only without `prev`, on `relayout`,
// or when more than 30% of the facility ids changed. The function is deterministic (no Math.random).
import type { ResolvedFacility } from '@shared/estimate';
import { groundsSqft } from '@shared/estimate';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import type { FacilityCategory, GroundsArea, GroundsKind } from '@shared/types';

export const UNIT_FT = 10;
export const FLOOR_HEIGHT = 1.4; // 14 ft per story in scene units

export interface Box2 { x: number; z: number; w: number; d: number } // center + full size

export interface BuildingPlacement {
  id: string;
  box: Box2;
  height: number;
  floors: number;
  floorHeight: number;
  color: string;
  lot: Box2;
  category: FacilityCategory;
}

export interface ZonePlacement {
  id: string; // grounds area id
  kind: GroundsKind;
  box: Box2;
  facilityId?: string;
  realSqft: number;
}

/** Packing state carried from one layout to the next (opaque to the shell). */
export interface PackState {
  /** west edge and width of the building rows */
  x0: number;
  rowWidth: number;
  /** open appended row: top z, west edge, width, next free x and current row depth */
  append: { top: number; x0: number; w: number; x: number; h: number } | null;
  /** lots created since the last full pack (for the hole ratio) */
  slots: number;
}

export interface SiteLayout {
  buildings: BuildingPlacement[];
  zones: ZonePlacement[];
  roads: Box2[];
  bounds: Box2;
  depot: { x: number; z: number };
  /** true when an incremental update had to overlap lots or left too many holes: offer "Re-layout" */
  stale: boolean;
  /** tallest building, scene units */
  maxHeight: number;
  pack: PackState;
}

const ACRE = 43560;
const ORDER: FacilityCategory[] = ['admin', 'education', 'community', 'dining', 'barracks', 'medical', 'fitness', 'child_care', 'lab', 'maintenance', 'warehouse', 'hangar', 'other'];
const TURF_KINDS: GroundsKind[] = ['improved_turf', 'athletic_field', 'shrub_bed', 'semi_improved', 'unimproved', 'tree_canopy'];
const GAP = 2.2;
const ROAD = 4.5;
const LOT_MARGIN = 1.6;

/** Compress real square footage to displayed scene area (units²). */
function displayArea(sqft: number, strength: 'soft' | 'hard' = 'soft'): number {
  const knee = (strength === 'soft' ? 1.0 : 0.75) * ACRE;
  const slope = strength === 'soft' ? 0.1 : 0.03;
  const shown = sqft <= knee ? sqft : knee + (sqft - knee) * slope;
  return shown / (UNIT_FT * UNIT_FT);
}

const fnv = (s: string, seed: number) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * Geometry-only signature: facility id, footprint (1 ft), floors and category; grounds id, kind, attachment,
 * unit and quantity (0.01). Names, service levels and review marks are excluded, so editing them keeps the layout.
 */
export function layoutSignature(facilities: ResolvedFacility[], grounds: GroundsArea[]): string {
  let s = '';
  for (const f of facilities) s += `${f.id}:${Math.round(f.footprint.length)}x${Math.round(f.footprint.width)}:${f.floors}:${f.category}|`;
  s += '#';
  for (const g of grounds) s += `${g.id}:${g.kind}:${g.facilityId ?? ''}:${g.unit}:${Math.round(g.quantity * 100) / 100}|`;
  return `${facilities.length}.${grounds.length}.${fnv(s, 2166136261).toString(36)}${fnv(s, 0x811c9dc5 ^ 0x5bd1e995).toString(36)}`;
}

interface Lot { id: string; w: number; d: number; bw: number; bd: number; turf: GroundsArea[]; park: GroundsArea[]; parkDepth: number; f: ResolvedFacility }

function sizeLot(f: ResolvedFacility, attached: GroundsArea[]): Lot {
  const bw = Math.max(2, f.footprint.length / UNIT_FT);
  const bd = Math.max(2, f.footprint.width / UNIT_FT);
  const turf = attached.filter((g) => TURF_KINDS.includes(g.kind));
  const park = attached.filter((g) => g.kind === 'parking' || g.kind === 'sidewalk');
  const turfArea = turf.reduce((s, g) => s + displayArea(g.kind === 'tree_canopy' ? g.quantity * 400 : groundsSqft(g), g.kind === 'improved_turf' || g.kind === 'athletic_field' || g.kind === 'shrub_bed' ? 'soft' : 'hard'), 0);
  const parkArea = park.reduce((s, g) => s + displayArea(groundsSqft(g), 'soft'), 0);
  const aspect = bw / bd;
  const needed = (bw + 2 * LOT_MARGIN) * (bd + 2 * LOT_MARGIN) + turfArea;
  const w = Math.max(bw + 2 * LOT_MARGIN, Math.sqrt(needed * aspect));
  let d = Math.max(bd + 2 * LOT_MARGIN, Math.sqrt(needed / aspect));
  const parkDepth = parkArea > 0 ? Math.min(Math.max(2.5, parkArea / w), w * 0.9) : 0;
  d += parkDepth;
  return { id: f.id, w, d, bw, bd, turf, park, parkDepth, f };
}

const floorHeightOf = (c: FacilityCategory) => (c === 'hangar' ? 4.2 : c === 'warehouse' || c === 'maintenance' ? 2.4 : FLOOR_HEIGHT);

/** Building, attached turf pads and the parking strip for one lot. */
function placeInLot(lot: Lot, lotBox: Box2, buildings: BuildingPlacement[], zones: ZonePlacement[]) {
  const parkDepth = Math.min(lot.parkDepth, Math.max(0, lotBox.d - lot.bd - 1));
  const bz = lotBox.z - parkDepth / 2; // building in the north part, parking strip on the south edge
  const fh = floorHeightOf(lot.f.category);
  buildings.push({ id: lot.id, box: { x: lotBox.x, z: bz, w: lot.bw, d: lot.bd }, height: fh * lot.f.floors, floors: lot.f.floors, floorHeight: fh, color: CATEGORY_DEFAULTS[lot.f.category]?.color ?? '#9ca3af', lot: lotBox, category: lot.f.category });
  const padBox: Box2 = { x: lotBox.x, z: lotBox.z - parkDepth / 2, w: lotBox.w, d: lotBox.d - parkDepth };
  lot.turf.forEach((g, i) => {
    const shrink = 1 - i * 0.08;
    zones.push({ id: g.id, kind: g.kind, box: { x: padBox.x, z: padBox.z, w: padBox.w * shrink, d: padBox.d * shrink }, facilityId: lot.id, realSqft: groundsSqft(g) });
  });
  if (parkDepth > 0 && lot.park.length) {
    const each = lotBox.w / lot.park.length;
    lot.park.forEach((g, i) => zones.push({ id: g.id, kind: g.kind, box: { x: lotBox.x - lotBox.w / 2 + each * (i + 0.5), z: lotBox.z + lotBox.d / 2 - parkDepth / 2, w: Math.max(0.5, each - 0.4), d: Math.max(0.5, parkDepth - 0.4) }, facilityId: lot.id, realSqft: groundsSqft(g) }));
  }
}

/**
 * Displayed size of a site-wide grounds area. Very large areas (training ranges of thousands of acres) are
 * compressed towards `cap` (a share of the campus width) so they frame the campus instead of dwarfing it;
 * the labels always print the real quantity.
 */
const looseSize = (g: GroundsArea, cap: number): { w: number; d: number } => {
  const sq = g.kind === 'tree_canopy' ? g.quantity * 350 : groundsSqft(g);
  const rough = g.kind === 'semi_improved' || g.kind === 'unimproved';
  const area = Math.max(12, displayArea(sq, rough ? 'hard' : 'soft'));
  const aspect = g.kind === 'sidewalk' ? 6 : g.kind === 'parking' ? 2.2 : rough ? 2 : 1.6;
  const side = Math.sqrt(area);
  const k = cap > 0 && side > 0 ? (cap * Math.tanh(side / cap)) / side : 1;
  return { w: Math.sqrt(area * aspect) * k, d: Math.sqrt(area / aspect) * k };
};
const capFor = (rowWidth: number) => Math.max(18, rowWidth * 0.15);
const looseReal = (g: GroundsArea) => (g.kind === 'tree_canopy' ? g.quantity : groundsSqft(g));

function boundsOf(buildings: BuildingPlacement[], zones: ZonePlacement[], roads: Box2[]): Box2 {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const add = (b: Box2) => { minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2); minZ = Math.min(minZ, b.z - b.d / 2); maxZ = Math.max(maxZ, b.z + b.d / 2); };
  for (const b of buildings) add(b.lot);
  for (const z of zones) add(z.box);
  for (const r of roads) add(r);
  if (!isFinite(minX)) return { x: 0, z: 0, w: 80, d: 80 };
  minX -= 5; maxX += 5; minZ -= 5; maxZ += 5;
  const w = Math.max(80, maxX - minX), d = Math.max(80, maxZ - minZ);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w, d };
}

const overlaps = (a: Box2, b: Box2, pad = 0.05) => Math.abs(a.x - b.x) * 2 < a.w + b.w - pad && Math.abs(a.z - b.z) * 2 < a.d + b.d - pad;

function splitGrounds(facilities: ResolvedFacility[], grounds: GroundsArea[]) {
  const byFacility = new Map<string, GroundsArea[]>();
  const loose: GroundsArea[] = [];
  const facIds = new Set(facilities.map((f) => f.id));
  for (const g of grounds) {
    if (g.facilityId && facIds.has(g.facilityId)) { const arr = byFacility.get(g.facilityId) ?? []; arr.push(g); byFacility.set(g.facilityId, arr); }
    else loose.push(g);
  }
  return { byFacility, loose };
}

export function computeLayout(facilities: ResolvedFacility[], grounds: GroundsArea[], opts?: { prev?: SiteLayout | null; relayout?: boolean }): SiteLayout {
  const prev = opts?.prev;
  if (prev && prev.pack && !opts?.relayout) {
    const prevIds = new Set(prev.buildings.map((b) => b.id));
    const nextIds = new Set(facilities.map((f) => f.id));
    let differ = 0;
    for (const id of nextIds) if (!prevIds.has(id)) differ++;
    for (const id of prevIds) if (!nextIds.has(id)) differ++;
    const base = Math.max(prevIds.size, nextIds.size);
    const emptyBefore = prev.buildings.length === 0 && prev.zones.length === 0;
    if (!emptyBefore && (base === 0 || differ / base <= 0.3)) return incremental(prev, facilities, grounds);
  }
  return fullPack(facilities, grounds);
}

function fullPack(facilities: ResolvedFacility[], grounds: GroundsArea[]): SiteLayout {
  const { byFacility, loose } = splitGrounds(facilities, grounds);
  const lots = facilities.map((f) => sizeLot(f, byFacility.get(f.id) ?? []));
  lots.sort((a, b) => (ORDER.indexOf(a.f.category) - ORDER.indexOf(b.f.category)) || (b.f.grossSqft - a.f.grossSqft) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const totalArea = lots.reduce((s, l) => s + l.w * l.d, 0);
  const rowWidth = Math.max(60, Math.sqrt(totalArea) * 1.35);
  const placed: { lot: Lot; x: number; z: number }[] = [];
  const roads: Box2[] = [];
  let cx = 0, cz = 0, rowH = 0;
  const rows: { z: number; h: number; w: number }[] = [];
  for (const lot of lots) {
    if (cx > 0 && cx + lot.w > rowWidth) { rows.push({ z: cz, h: rowH, w: cx }); cz += rowH + ROAD; cx = 0; rowH = 0; }
    placed.push({ lot, x: cx + lot.w / 2, z: cz + lot.d / 2 });
    cx += lot.w + GAP; rowH = Math.max(rowH, lot.d);
  }
  if (cx > 0) rows.push({ z: cz, h: rowH, w: cx });

  const campusW = Math.max(rowWidth, ...rows.map((r) => r.w));
  const campusD = rows.length ? rows[rows.length - 1].z + rows[rows.length - 1].h : 40;
  const ox = -campusW / 2, oz = -campusD / 2; // center campus at origin

  const buildings: BuildingPlacement[] = [];
  const zones: ZonePlacement[] = [];
  for (const p of placed) placeInLot(p.lot, { x: p.x + ox, z: p.z + oz, w: p.lot.w, d: p.lot.d }, buildings, zones);
  for (let i = 1; i < rows.length; i++) roads.push({ x: 0, z: rows[i].z - ROAD / 2 + oz, w: campusW + ROAD * 2, d: ROAD * 0.8 });

  // ---- loose (site-wide) zones in bands around the campus
  const north = loose.filter((g) => g.kind === 'semi_improved' || g.kind === 'unimproved');
  const east = loose.filter((g) => ['improved_turf', 'athletic_field', 'shrub_bed', 'tree_canopy'].includes(g.kind));
  const south = loose.filter((g) => g.kind === 'parking' || g.kind === 'sidewalk');
  const cap = capFor(rowWidth);
  const bandPack = (items: GroundsArea[], maxW: number) => {
    const out: { g: GroundsArea; x: number; z: number; w: number; d: number }[] = [];
    let x = 0, z = 0, h = 0;
    for (const g of items) {
      const s = looseSize(g, cap);
      if (x > 0 && x + s.w > maxW) { z += h + GAP; x = 0; h = 0; }
      out.push({ g, x: x + s.w / 2, z: z + s.d / 2, w: s.w, d: s.d });
      x += s.w + GAP; h = Math.max(h, s.d);
    }
    return out;
  };
  const halfW = campusW / 2, halfD = campusD / 2;
  // a band is at least as wide as a square of its own area, so a grounds-heavy site packs into blocks, not strips
  const squareW = (items: GroundsArea[]) => Math.sqrt(items.reduce((a, g) => { const z = looseSize(g, cap); return a + (z.w + GAP) * (z.d + GAP); }, 0)) * 1.15;
  const sPack = bandPack(south, Math.max(campusW + 20, squareW(south)));
  const sW = sPack.length ? Math.max(...sPack.map((p) => p.x + p.w / 2)) : 0;
  for (const p of sPack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: p.x - sW / 2, z: halfD + ROAD + p.z, w: p.w, d: p.d }, realSqft: looseReal(p.g) });
  const ePack = bandPack(east, Math.max(40, campusW * 0.5, squareW(east)));
  const eW = ePack.length ? Math.max(...ePack.map((p) => p.x + p.w / 2)) : 0;
  for (const p of ePack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: halfW + ROAD + p.x, z: -halfD + p.z, w: p.w, d: p.d }, realSqft: looseReal(p.g) });
  const nPack = bandPack(north, Math.max(campusW + eW + 20, squareW(north)));
  const nD = nPack.length ? Math.max(...nPack.map((p) => p.z + p.d / 2)) : 0;
  const nW = nPack.length ? Math.max(...nPack.map((p) => p.x + p.w / 2)) : 0;
  for (const p of nPack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: p.x - nW / 2 + eW / 2, z: -halfD - ROAD - nD + p.z, w: p.w, d: p.d }, realSqft: looseReal(p.g) });

  if (rows.length || ePack.length) {
    roads.push({ x: 0, z: halfD + ROAD / 2, w: campusW + ROAD * 2, d: ROAD * 0.8 }); // south road
    roads.push({ x: eW / 2, z: -halfD - ROAD / 2, w: campusW + eW + ROAD * 3, d: ROAD * 0.8 }); // north road (serves the east band)
    roads.push({ x: -halfW - ROAD / 2, z: 0, w: ROAD * 0.8, d: campusD + ROAD * 2 }); // west
    roads.push({ x: halfW + ROAD / 2, z: 0, w: ROAD * 0.8, d: campusD + ROAD * 2 }); // between campus and east band
  }

  const bounds = boundsOf(buildings, zones, roads);
  const maxHeight = buildings.reduce((m, b) => Math.max(m, b.height), 0);
  return { buildings, zones, roads, bounds, depot: { x: -halfW - ROAD - 6, z: halfD + ROAD + 6 }, stale: false, maxHeight, pack: { x0: ox, rowWidth: campusW, append: null, slots: lots.length } };
}

/** Keep every existing lot centre; grow lots in place; append new lots in rows south of the current site. */
function incremental(prev: SiteLayout, facilities: ResolvedFacility[], grounds: GroundsArea[]): SiteLayout {
  const { byFacility, loose } = splitGrounds(facilities, grounds);
  const prevB = new Map(prev.buildings.map((b) => [b.id, b]));
  const prevZ = new Map(prev.zones.map((z) => [z.id, z]));
  const buildings: BuildingPlacement[] = [];
  const zones: ZonePlacement[] = [];
  const roads: Box2[] = prev.roads.slice();
  let stale = prev.stale;
  const grown: Box2[] = [];
  const fresh: Lot[] = [];
  for (const f of facilities) {
    const lot = sizeLot(f, byFacility.get(f.id) ?? []);
    const pb = prevB.get(f.id);
    if (!pb) { fresh.push(lot); continue; }
    const fits = lot.w <= pb.lot.w + 1e-6 && lot.d <= pb.lot.d + 1e-6;
    const box: Box2 = fits ? { ...pb.lot } : { x: pb.lot.x, z: pb.lot.z, w: Math.max(lot.w, pb.lot.w), d: Math.max(lot.d, pb.lot.d) };
    if (!fits) grown.push(box);
    placeInLot(lot, box, buildings, zones);
  }
  // loose zones that already existed keep their centre
  const freshLoose: GroundsArea[] = [];
  for (const g of loose) {
    const pz = prevZ.get(g.id);
    if (pz && !pz.facilityId) { const s = looseSize(g, capFor(prev.pack.rowWidth)); zones.push({ id: g.id, kind: g.kind, box: { x: pz.box.x, z: pz.box.z, w: s.w, d: s.d }, realSqft: looseReal(g) }); }
    else freshLoose.push(g);
  }
  // removed ids leave holes
  const slotsBefore = prev.pack.slots || prev.buildings.length;
  let slots = slotsBefore;

  // append rows south of everything placed so far. Each new row is centred on the campus and as wide as a
  // full pack of the current lot area would be, so a growing campus widens instead of becoming a strip.
  let append = prev.pack.append && typeof prev.pack.append.w === 'number' ? { ...prev.pack.append } : null;
  const { x0 } = prev.pack;
  const cx = x0 + prev.pack.rowWidth / 2;
  let rowWidth = prev.pack.rowWidth;
  let lotArea = 0;
  for (const b of buildings) lotArea += b.lot.w * b.lot.d;
  for (const l of fresh) lotArea += l.w * l.d;
  const contentMaxZ = () => {
    let m = -Infinity;
    for (const b of buildings) m = Math.max(m, b.lot.z + b.lot.d / 2);
    for (const z of zones) m = Math.max(m, z.box.z + z.box.d / 2);
    for (const r of roads) m = Math.max(m, r.z + r.d / 2);
    return isFinite(m) ? m : 0;
  };
  const openRow = (top: number) => {
    const w = Math.max(rowWidth, Math.sqrt(lotArea) * 1.35);
    rowWidth = w;
    roads.push({ x: cx, z: top - ROAD / 2, w: w + ROAD * 2, d: ROAD * 0.8 });
    return { top, x0: cx - w / 2, w, x: cx - w / 2, h: 0 };
  };
  const place = (w: number, d: number): Box2 => {
    if (!append) append = openRow(contentMaxZ() + ROAD);
    if (append.x > append.x0 && append.x + w > append.x0 + append.w) append = openRow(append.top + append.h + ROAD);
    const box: Box2 = { x: append.x + w / 2, z: append.top + d / 2, w, d };
    append.x += w + GAP; append.h = Math.max(append.h, d);
    return box;
  };
  for (const lot of fresh) { placeInLot(lot, place(lot.w, lot.d), buildings, zones); slots++; }
  for (const g of freshLoose) { const s = looseSize(g, capFor(rowWidth)); zones.push({ id: g.id, kind: g.kind, box: place(s.w, s.d), realSqft: looseReal(g) }); }

  // grown lots that now collide with a neighbour or a road make the layout stale
  if (grown.length) {
    for (const gbox of grown) {
      if (roads.some((r) => overlaps(gbox, r))) { stale = true; break; }
      if (buildings.some((b) => b.lot !== gbox && (b.lot.x !== gbox.x || b.lot.z !== gbox.z) && overlaps(gbox, b.lot))) { stale = true; break; }
    }
  }
  const holes = Math.max(0, slots - buildings.length);
  if (slots > 0 && holes / slots > 0.2) stale = true;

  const bounds = boundsOf(buildings, zones, roads);
  const maxHeight = buildings.reduce((m, b) => Math.max(m, b.height), 0);
  return { buildings, zones, roads, bounds, depot: prev.depot, stale, maxHeight, pack: { x0: cx - rowWidth / 2, rowWidth, append, slots } };
}

export const ZONE_COLORS: Record<GroundsKind, string> = {
  improved_turf: '#3f8f3a',
  semi_improved: '#6f8f3a',
  unimproved: '#8a8a4a',
  athletic_field: '#2f9e44',
  shrub_bed: '#5b3a1f',
  parking: '#3b3f46',
  sidewalk: '#8b8f98',
  tree_canopy: '#2b6b2f',
};
export const ZONE_LABELS: Record<GroundsKind, string> = {
  improved_turf: 'Improved turf', semi_improved: 'Semi-improved', unimproved: 'Unimproved', athletic_field: 'Athletic field', shrub_bed: 'Planting beds', parking: 'Parking', sidewalk: 'Walks', tree_canopy: 'Trees',
};
