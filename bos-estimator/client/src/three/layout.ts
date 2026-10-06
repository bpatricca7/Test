// Procedural site layout: turns the facility inventory into a campus of lots, buildings,
// grounds pads and roads. 1 scene unit = 10 ft. Grounds areas are drawn with a compressed
// scale (large acreages would otherwise dwarf the buildings) — labels always show real quantities.
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

export interface SiteLayout {
  buildings: BuildingPlacement[];
  zones: ZonePlacement[];
  roads: Box2[];
  bounds: Box2;
  depot: { x: number; z: number };
}

const ACRE = 43560;
const ORDER: FacilityCategory[] = ['admin', 'education', 'community', 'dining', 'barracks', 'medical', 'fitness', 'child_care', 'lab', 'maintenance', 'warehouse', 'hangar', 'other'];

/** Compress real square footage to displayed scene area (units²). */
function displayArea(sqft: number, strength: 'soft' | 'hard' = 'soft'): number {
  const knee = (strength === 'soft' ? 1.0 : 0.75) * ACRE;
  const slope = strength === 'soft' ? 0.1 : 0.03;
  const shown = sqft <= knee ? sqft : knee + (sqft - knee) * slope;
  return shown / (UNIT_FT * UNIT_FT);
}

interface Lot { id: string; w: number; d: number; bw: number; bd: number; turfIds: string[]; turfArea: number; parkIds: string[]; parkArea: number; parkDepth: number; f: ResolvedFacility }

export function computeLayout(facilities: ResolvedFacility[], grounds: GroundsArea[]): SiteLayout {
  const byFacility = new Map<string, GroundsArea[]>();
  const loose: GroundsArea[] = [];
  const facIds = new Set(facilities.map((f) => f.id));
  for (const g of grounds) {
    if (g.facilityId && facIds.has(g.facilityId)) { const arr = byFacility.get(g.facilityId) ?? []; arr.push(g); byFacility.set(g.facilityId, arr); }
    else loose.push(g);
  }

  // ---- lots
  const lots: Lot[] = facilities.map((f) => {
    const bw = Math.max(2, f.footprint.length / UNIT_FT);
    const bd = Math.max(2, f.footprint.width / UNIT_FT);
    const attached = byFacility.get(f.id) ?? [];
    const turf = attached.filter((g) => ['improved_turf', 'athletic_field', 'shrub_bed', 'semi_improved', 'unimproved', 'tree_canopy'].includes(g.kind));
    const park = attached.filter((g) => g.kind === 'parking' || g.kind === 'sidewalk');
    const turfArea = turf.reduce((s, g) => s + displayArea(g.kind === 'tree_canopy' ? g.quantity * 400 : groundsSqft(g), g.kind === 'improved_turf' || g.kind === 'athletic_field' || g.kind === 'shrub_bed' ? 'soft' : 'hard'), 0);
    const parkArea = park.reduce((s, g) => s + displayArea(groundsSqft(g), 'soft'), 0);
    const margin = 1.6;
    const aspect = bw / bd;
    const needed = (bw + 2 * margin) * (bd + 2 * margin) + turfArea;
    let w = Math.max(bw + 2 * margin, Math.sqrt(needed * aspect));
    let d = Math.max(bd + 2 * margin, Math.sqrt(needed / aspect));
    const parkDepth = parkArea > 0 ? Math.min(Math.max(2.5, parkArea / w), w * 0.9) : 0;
    d += parkDepth;
    return { id: f.id, w, d, bw, bd, turfIds: turf.map((g) => g.id), turfArea, parkIds: park.map((g) => g.id), parkArea, parkDepth, f };
  });

  lots.sort((a, b) => (ORDER.indexOf(a.f.category) - ORDER.indexOf(b.f.category)) || (b.f.grossSqft - a.f.grossSqft));

  const totalArea = lots.reduce((s, l) => s + l.w * l.d, 0);
  const rowWidth = Math.max(60, Math.sqrt(totalArea) * 1.35);
  const GAP = 2.2; const ROAD = 4.5;
  const placed: { lot: Lot; x: number; z: number }[] = [];
  const roads: Box2[] = [];
  let cx = 0, cz = 0, rowH = 0, rowStart = 0;
  const rows: { z: number; h: number; w: number }[] = [];
  for (const lot of lots) {
    if (cx > 0 && cx + lot.w > rowWidth) { rows.push({ z: cz, h: rowH, w: cx }); cz += rowH + ROAD; cx = 0; rowH = 0; rowStart = placed.length; }
    placed.push({ lot, x: cx + lot.w / 2, z: cz + lot.d / 2 });
    cx += lot.w + GAP; rowH = Math.max(rowH, lot.d);
  }
  void rowStart;
  if (cx > 0) rows.push({ z: cz, h: rowH, w: cx });

  const campusW = Math.max(rowWidth, ...rows.map((r) => r.w));
  const campusD = rows.length ? rows[rows.length - 1].z + rows[rows.length - 1].h : 40;
  const ox = -campusW / 2, oz = -campusD / 2; // center campus at origin

  const buildings: BuildingPlacement[] = [];
  const zones: ZonePlacement[] = [];
  for (const p of placed) {
    const { lot } = p;
    const lotBox: Box2 = { x: p.x + ox, z: p.z + oz, w: lot.w, d: lot.d };
    // building sits in the upper (north) part of the lot, parking strip on the south edge
    const bz = lotBox.z - lot.parkDepth / 2;
    const fh = lot.f.category === 'hangar' ? 4.2 : lot.f.category === 'warehouse' || lot.f.category === 'maintenance' ? 2.4 : FLOOR_HEIGHT;
    buildings.push({ id: lot.id, box: { x: lotBox.x, z: bz, w: lot.bw, d: lot.bd }, height: fh * lot.f.floors, floors: lot.f.floors, floorHeight: fh, color: CATEGORY_DEFAULTS[lot.f.category]?.color ?? '#9ca3af', lot: lotBox, category: lot.f.category });
    // attached turf = the lot minus parking strip (one zone per attached area, stacked as rings is overkill → share the same pad)
    const padBox: Box2 = { x: lotBox.x, z: lotBox.z - lot.parkDepth / 2, w: lot.w, d: lot.d - lot.parkDepth };
    const turfAreas = (byFacility.get(lot.id) ?? []).filter((g) => lot.turfIds.includes(g.id));
    turfAreas.forEach((g, i) => {
      const shrink = 1 - i * 0.08;
      zones.push({ id: g.id, kind: g.kind, box: { x: padBox.x, z: padBox.z, w: padBox.w * shrink, d: padBox.d * shrink }, facilityId: lot.id, realSqft: groundsSqft(g) });
    });
    if (lot.parkDepth > 0) {
      const parks = (byFacility.get(lot.id) ?? []).filter((g) => lot.parkIds.includes(g.id));
      const each = lot.w / parks.length;
      parks.forEach((g, i) => zones.push({ id: g.id, kind: g.kind, box: { x: lotBox.x - lot.w / 2 + each * (i + 0.5), z: lotBox.z + lot.d / 2 - lot.parkDepth / 2, w: each - 0.4, d: lot.parkDepth - 0.4 }, facilityId: lot.id, realSqft: groundsSqft(g) }));
    }
  }
  // roads between rows + ring road
  for (let i = 1; i < rows.length; i++) roads.push({ x: 0, z: rows[i].z - ROAD / 2 + oz, w: campusW + ROAD * 2, d: ROAD * 0.8 });

  // ---- loose (site-wide) zones in bands around the campus
  const north = loose.filter((g) => g.kind === 'semi_improved' || g.kind === 'unimproved');
  const east = loose.filter((g) => ['improved_turf', 'athletic_field', 'shrub_bed', 'tree_canopy'].includes(g.kind));
  const south = loose.filter((g) => g.kind === 'parking' || g.kind === 'sidewalk');

  const sizeOf = (g: GroundsArea): { w: number; d: number } => {
    const sq = g.kind === 'tree_canopy' ? g.quantity * 350 : groundsSqft(g);
    const area = Math.max(12, displayArea(sq, g.kind === 'semi_improved' || g.kind === 'unimproved' ? 'hard' : 'soft'));
    const aspect = g.kind === 'sidewalk' ? 6 : g.kind === 'parking' ? 2.2 : 1.6;
    return { w: Math.sqrt(area * aspect), d: Math.sqrt(area / aspect) };
  };
  const bandPack = (items: GroundsArea[], maxW: number): { g: GroundsArea; x: number; z: number; w: number; d: number }[] => {
    const out: { g: GroundsArea; x: number; z: number; w: number; d: number }[] = [];
    let x = 0, z = 0, h = 0;
    for (const g of items) {
      const s = sizeOf(g);
      if (x > 0 && x + s.w > maxW) { z += h + GAP; x = 0; h = 0; }
      out.push({ g, x: x + s.w / 2, z: z + s.d / 2, w: s.w, d: s.d });
      x += s.w + GAP; h = Math.max(h, s.d);
    }
    return out;
  };
  const halfW = campusW / 2, halfD = campusD / 2;
  // south band (paved)
  const sPack = bandPack(south, campusW + 20);
  const sD = sPack.length ? Math.max(...sPack.map((p) => p.z + p.d / 2)) : 0;
  const sW = sPack.length ? Math.max(...sPack.map((p) => p.x + p.w / 2)) : 0;
  for (const p of sPack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: p.x - sW / 2, z: halfD + ROAD + p.z, w: p.w, d: p.d }, realSqft: groundsSqft(p.g) });
  // east band (turf, athletics, beds, trees)
  const ePack = bandPack(east, Math.max(40, campusW * 0.5));
  const eW = ePack.length ? Math.max(...ePack.map((p) => p.x + p.w / 2)) : 0;
  const eD = ePack.length ? Math.max(...ePack.map((p) => p.z + p.d / 2)) : 0;
  for (const p of ePack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: halfW + ROAD + p.x, z: -halfD + p.z, w: p.w, d: p.d }, realSqft: p.g.kind === 'tree_canopy' ? p.g.quantity : groundsSqft(p.g) });
  // north band (rough grounds)
  const nPack = bandPack(north, campusW + eW + 20);
  const nD = nPack.length ? Math.max(...nPack.map((p) => p.z + p.d / 2)) : 0;
  const nW = nPack.length ? Math.max(...nPack.map((p) => p.x + p.w / 2)) : 0;
  for (const p of nPack) zones.push({ id: p.g.id, kind: p.g.kind, box: { x: p.x - nW / 2 + eW / 2, z: -halfD - ROAD - nD + p.z, w: p.w, d: p.d }, realSqft: groundsSqft(p.g) });

  if (rows.length || ePack.length) {
    roads.push({ x: 0, z: halfD + ROAD / 2, w: campusW + eW + ROAD * 3, d: ROAD * 0.8 }); // south road
    roads.push({ x: 0, z: -halfD - ROAD / 2, w: campusW + eW + ROAD * 3, d: ROAD * 0.8 }); // north road
    roads.push({ x: -halfW - ROAD / 2, z: 0, w: ROAD * 0.8, d: campusD + ROAD * 2 }); // west
    roads.push({ x: halfW + ROAD / 2, z: 0, w: ROAD * 0.8, d: campusD + ROAD * 2 }); // between campus and east band
  }

  const minX = Math.min(-halfW - ROAD, -nW / 2 + eW / 2 - 5, -sW / 2 - 5);
  const maxX = Math.max(halfW + ROAD + eW + 5, nW / 2 + eW / 2 + 5, sW / 2 + 5);
  const minZ = -halfD - ROAD - nD - 5;
  const maxZ = Math.max(halfD + ROAD + sD + 5, -halfD + eD + 5);
  const bounds: Box2 = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: Math.max(80, maxX - minX), d: Math.max(80, maxZ - minZ) };
  return { buildings, zones, roads, bounds, depot: { x: -halfW - ROAD - 6, z: halfD + ROAD + 6 } };
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
