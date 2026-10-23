#!/usr/bin/env node
// Deterministic generator for the large-installation-420-xlsx fixture (scale test: 420 in-scope facilities).
//   cd bos-estimator && node tests/fixtures/large-installation-420-xlsx/gen.mjs
// Writes facility-list.json (the multi-sheet workbook source that scripts/render-fixtures.mjs renders to XLSX) and
// truth.json (ground truth per tests/harness/truth.ts). Uses a seeded PRNG (mulberry32), never Math.random, so the
// same seed always gives byte-identical output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 4202027;
const SOLICITATION = 'W9124Z-27-R-0420';
const INSTALLATION = 'Fort Brannock';
const OUT_XLSX = `${SOLICITATION} Att J-0302 Facility List ${INSTALLATION}.xlsx`;
const EXPECTED_IN_SCOPE = 420;

// ---------- seeded PRNG ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const rf = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- frequency codes (defined on the Notes sheet) ----------
const FREQ = { '7X/WK': 'daily_7', '5X/WK': 'daily_5', '3X/WK': '3x_week', '2X/WK': '2x_week', '1X/WK': 'weekly', 'BI-WKLY': 'biweekly', '1X/MO': 'monthly', 'QTRLY': 'quarterly' };

// ---------- facility types ----------
// cc = CATCODE, cat = truth category (omitted where the title is ambiguous), sf = gross SF range, fl = floors range,
// cl = cleanable share of gross, fx = restroom fixtures (fn of gross), fq = allowed custodial frequencies, rm = remark.
const per1000 = (lo, hi) => (g) => Math.max(2, Math.round((g / 1000) * rf(lo, hi)));
const TYPES = {
  ueph: { cc: 72111, cat: 'barracks', names: ['UEPH BARRACKS', 'UEPH BARRACKS', 'UEPH BARRACKS (2+2 MODULE)', 'UEPH BARRACKS (1+1E MODULE)'], sf: [42000, 98000], fl: [3, 5], cl: [0.18, 0.26], fx: () => ri(6, 14), fq: ['5X/WK'], rm: 'COMMON AREAS ONLY (NOTE 2)' },
  cof: { cc: 14185, cat: 'admin', names: ['COMPANY OPERATIONS FACILITY (COF)'], sf: [11800, 28600], fl: [1, 2], cl: [0.84, 0.92], fx: per1000(0.45, 0.7), fq: ['5X/WK'] },
  bnhq: { cc: 14183, cat: 'admin', names: ['BATTALION HEADQUARTERS'], sf: [13200, 24800], fl: [2, 2], cl: [0.85, 0.92], fx: per1000(0.5, 0.75), fq: ['5X/WK'] },
  bdehq: { cc: 14182, cat: 'admin', names: ['BRIGADE HEADQUARTERS'], sf: [28400, 56200], fl: [2, 3], cl: [0.85, 0.92], fx: per1000(0.45, 0.65), fq: ['5X/WK'] },
  temf: { cc: 21410, cat: 'maintenance', names: ['TACTICAL EQUIPMENT MAINT FACILITY (TEMF)'], sf: [38000, 112000], fl: [1, 2], cl: [0.12, 0.2], fx: () => ri(8, 18), fq: ['5X/WK', '5X/WK', '3X/WK'], rm: 'ADMIN, BREAK AND LATRINE AREAS ONLY - MAINT BAYS EXCLUDED (NOTE 3)' },
  orgstor: { cc: 44224, cat: 'warehouse', names: ['ORGANIZATIONAL STORAGE BLDG'], sf: [3800, 12600], fl: [1, 1], cl: [0.85, 0.95], fx: () => 0, fq: ['1X/MO'] },
  dfac: { cc: 72210, cat: 'dining', names: ['DINING FACILITY'], sf: [18200, 36400], fl: [1, 1], cl: [0.62, 0.7], fx: () => ri(8, 16), fq: ['7X/WK'], rm: 'DINING ROOM, ENTRY AND LATRINES - KITCHEN BY FOOD SERVICE CONTRACTOR' },
  chapel: { cc: 73017, cat: 'community', sf: [6400, 24000], fl: [1, 1], cl: [0.85, 0.92], fx: per1000(0.4, 0.6), fq: ['2X/WK', '3X/WK'] },
  pfc: { cc: 74028, cat: 'fitness', sf: [28000, 78000], fl: [1, 2], cl: [0.86, 0.94], fx: () => ri(20, 40), fq: ['7X/WK'] },
  cdc: { cc: 74046, cat: 'child_care', sf: [14200, 26400], fl: [1, 1], cl: [0.86, 0.92], fx: (g) => Math.round(g / rf(650, 800)), fq: ['5X/WK'] },
  tmc: { cc: 55010, cat: 'medical', names: ['TROOP MEDICAL CLINIC'], sf: [9200, 18400], fl: [1, 2], cl: [0.84, 0.9], fx: per1000(0.9, 1.3), fq: ['5X/WK'] },
  dental: { cc: 54010, cat: 'medical', names: ['DENTAL CLINIC'], sf: [8200, 16400], fl: [1, 1], cl: [0.84, 0.9], fx: per1000(0.8, 1.2), fq: ['5X/WK'] },
  whse: { cc: 44220, cat: 'warehouse', names: ['GENERAL PURPOSE WAREHOUSE'], sf: [8000, 96000], fl: [1, 1], cl: [0.04, 0.1], fx: () => ri(2, 8), fq: ['1X/WK', 'BI-WKLY'], rm: 'OFFICE AND LATRINE AREAS ONLY' },
  hazstor: { cc: 44260, cat: 'warehouse', names: ['HAZARDOUS MATERIALS STORAGE BLDG'], sf: [1200, 4800], fl: [1, 1], cl: [0.9, 1], fx: () => 0, fq: ['QTRLY'] },
  shop: { cc: 21910, cat: 'maintenance', sf: [4200, 28000], fl: [1, 1], cl: [0.3, 0.45], fx: () => ri(3, 8), fq: ['3X/WK', '2X/WK'], rm: 'OFFICE, BREAK AND LATRINE AREAS ONLY' },
  hangar: { cc: 21110, cat: 'hangar', names: ['AIRCRAFT MAINTENANCE HANGAR'], sf: [42000, 96000], fl: [1, 2], cl: [0.15, 0.25], fx: () => ri(6, 14), fq: ['5X/WK'], rm: 'SHOP, ADMIN AND LATRINE AREAS ONLY - HANGAR BAY EXCLUDED' },
  admin: { cc: 61050, cat: 'admin', sf: [2400, 42000], fl: [1, 3], cl: [0.84, 0.92], fx: per1000(0.4, 0.7), fq: ['5X/WK'] },
  instr: { cc: 17120, cat: 'education', sf: [6800, 32000], fl: [1, 2], cl: [0.85, 0.92], fx: per1000(0.4, 0.6), fq: ['5X/WK'] },
  fire: { cc: 73010, cat: 'other', sf: [8800, 16400], fl: [1, 2], cl: [0.6, 0.75], fx: per1000(0.6, 0.9), fq: ['3X/WK'], rm: 'ADMIN AND LATRINE AREAS; APPARATUS BAY AND QUARTERS BY FIRE DEPT' },
  gate: { cc: 14113, cat: 'other', sf: [120, 640], fl: [1, 1], cl: [1, 1], fx: () => ri(0, 2), fq: ['7X/WK'] },
  latrine: { cc: 73046, cat: 'other', sf: [120, 480], fl: [1, 1], cl: [1, 1], fx: () => ri(2, 8), fq: ['2X/WK', '1X/WK'] },
  tower: { cc: 17890, cat: 'other', sf: [140, 360], fl: [2, 3], cl: [1, 1], fx: () => 0, fq: ['1X/WK', 'BI-WKLY'] },
  rangeops: { cc: 17891, sf: [800, 2400], fl: [1, 1], cl: [0.9, 1], fx: () => ri(2, 4), fq: ['1X/WK'] },
  rangeclass: { cc: 17892, cat: 'education', sf: [600, 1800], fl: [1, 1], cl: [0.95, 1], fx: () => 0, fq: ['1X/WK'] },
};

function make(type, over = {}) {
  const t = TYPES[type];
  const gross = over.gross ?? ri(t.sf[0], t.sf[1]);
  const floors = over.floors ?? ri(t.fl[0], t.fl[1]);
  const share = rf(t.cl[0], t.cl[1]);
  const cleanable = over.cleanable ?? (gross < 1000 ? gross : Math.round(gross * share));
  const fixtures = over.fixtures ?? t.fx(gross);
  const freq = over.freq ?? pick(t.fq);
  return {
    num: over.num, name: over.name ?? pick(t.names), catcode: over.cc ?? t.cc, floors, gross, cleanable,
    fixtures, freq, remark: over.remark ?? t.rm ?? '', category: over.category === null ? undefined : over.category ?? t.cat,
    excluded: !!over.excluded,
  };
}

// building numbers: walk upward inside a zone's number block with irregular gaps, like a real RPI.
function numberer(start) {
  let n = start;
  return {
    next(gap = [2, 9]) { n += ri(gap[0], gap[1]); return n; },
    jump(to) { n = Math.max(n, to); return n; },
  };
}

const zones = [];
const zone = (id, title) => { const z = { id, title, rows: [] }; zones.push(z); return z; };

// ---------------- ZONE 1 - MAIN CANTONMENT (1xxxx) ----------------
{
  const z = zone(1, 'ZONE 1 - MAIN CANTONMENT');
  const N = numberer(10000);
  const add = (type, over = {}) => z.rows.push(make(type, { num: String(N.next(over.gap)), ...over }));
  // access control points
  N.jump(10000);
  for (const [nm, sf] of [['ACP 1 MAIN GATE GATEHOUSE', 640], ['ACP 1 MAIN GATE OVERWATCH BOOTH', 120], ['ACP 2 NORTH GATE GATEHOUSE', 480], ['ACP 3 EAST GATE GATEHOUSE', 420], ['ACP 4 WEST GATE GATEHOUSE', 396], ['ACP 5 COMMERCIAL VEHICLE INSPECTION GATEHOUSE', 612], ['ACP 5 SEARCH OFFICE', 288], ['ACP 6 RANGE ROAD GATEHOUSE', 224]]) add('gate', { name: nm, gross: sf, gap: [1, 2] });
  add('gate', { name: 'VISITOR CONTROL CENTER', gross: 2410, cleanable: 2180, fixtures: 4, gap: [1, 3] });
  N.jump(10100);
  add('admin', { name: 'DIVISION HEADQUARTERS', gross: ri(128000, 148000), floors: 3, fixtures: ri(70, 90) });
  add('admin', { name: 'GARRISON HEADQUARTERS', gross: ri(38000, 52000), floors: 3 });
  add('admin', { name: 'DIRECTORATE OF PUBLIC WORKS (DPW) ADMINISTRATION', gross: ri(14000, 22000), floors: 2 });
  add('admin', { name: 'DIRECTORATE OF EMERGENCY SERVICES / MILITARY POLICE STATION', cc: 73075, category: null, gross: ri(16000, 24000), floors: 2, freq: '7X/WK' });
  add('admin', { name: 'CRIMINAL INVESTIGATION DIVISION FIELD OFFICE', cc: 14114, gross: ri(6200, 9800), floors: 1 });
  for (const no of [1, 2, 3]) add('fire', { name: `FIRE STATION NO ${no}` });
  N.jump(10300);
  const adminNames = ['IN/OUT PROCESSING CENTER', 'STAFF JUDGE ADVOCATE LEGAL CENTER', 'RESOURCE MANAGEMENT OFFICE', 'DIRECTORATE OF PLANS, TRAINING, MOBILIZATION AND SECURITY (DPTMS)', 'NETWORK ENTERPRISE CENTER (NEC)', 'MISSION AND INSTALLATION CONTRACTING COMMAND OFFICE', 'CIVILIAN PERSONNEL ADVISORY CENTER', 'INSTALLATION SAFETY OFFICE', 'PUBLIC AFFAIRS OFFICE', 'INSPECTOR GENERAL OFFICE', 'SOLDIER FOR LIFE - TRANSITION ASSISTANCE PROGRAM CENTER', 'RETENTION OFFICE', 'FAMILY AND MWR ADMINISTRATION', 'LOGISTICS READINESS CENTER ADMINISTRATION', 'ENVIRONMENTAL DIVISION OFFICE', 'HOUSING SERVICES OFFICE', 'INSTALLATION TRANSPORTATION OFFICE', 'ID CARD / DEERS OFFICE', 'AMERICAN RED CROSS OFFICE', 'SOLDIER SUPPORT CENTER', 'ADMIN GEN PURPOSE', 'ADMIN GEN PURPOSE', 'ADMIN GEN PURPOSE', 'ADMIN GEN PURPOSE', 'TENANT ADMIN BLDG', 'TENANT ADMIN BLDG'];
  for (const nm of adminNames) add('admin', { name: nm });
  N.jump(10500);
  add('tmc', { name: 'ARMY HEALTH CLINIC', gross: ri(58000, 68000), floors: 3, fixtures: ri(64, 80) });
  add('dental', { name: 'DENTAL CLINIC NO 1' });
  add('dental', { name: 'DENTAL CLINIC NO 2' });
  add('tmc', { name: 'BEHAVIORAL HEALTH CLINIC', gross: ri(9800, 14600) });
  N.jump(10600);
  add('pfc', { name: 'MAIN POST PHYSICAL FITNESS CENTER', gross: ri(68000, 78000), floors: 2 });
  add('pfc', { name: 'AQUATIC CENTER (INDOOR POOL)', cc: 74042, gross: ri(30000, 36000), floors: 1 });
  add('chapel', { name: 'MAIN POST CHAPEL', gross: ri(16000, 24000) });
  add('chapel', { name: 'MEMORIAL CHAPEL', gross: ri(6400, 9800) });
  add('chapel', { name: 'RELIGIOUS EDUCATION CENTER', gross: ri(9000, 14000), floors: 2, freq: '3X/WK' });
  for (const nm of ['CHILD DEVELOPMENT CENTER (MAIN POST)', 'CHILD DEVELOPMENT CENTER (HILLSIDE)', 'CHILD DEVELOPMENT CENTER (LAKEVIEW)', 'SCHOOL AGE CENTER']) add('cdc', { name: nm });
  add('admin', { name: 'YOUTH CENTER', cc: 74047, category: 'community', gross: ri(16000, 21000), floors: 1, freq: '5X/WK' });
  add('admin', { name: 'POST LIBRARY', cc: 74044, category: 'community', gross: ri(9000, 13000), floors: 1 });
  add('admin', { name: 'ARMY COMMUNITY SERVICE CENTER', cc: 74010, category: 'community', gross: ri(8000, 12000), floors: 1 });
  add('admin', { name: 'SOLDIER AND FAMILY ASSISTANCE CENTER', cc: 74010, category: 'community', gross: ri(11000, 15500), floors: 2 });
  add('admin', { name: 'POST OFFICE', cc: 73070, category: null, gross: ri(4200, 6800), floors: 1 });
  N.jump(10700);
  add('instr', { name: 'ARMY EDUCATION CENTER', floors: 2 });
  add('admin', { name: 'NCO ACADEMY HEADQUARTERS', floors: 2 });
  for (const no of [1, 2, 3]) add('instr', { name: `NCO ACADEMY INSTRUCTION BLDG ${no}` });
  add('dfac', { name: 'NCO ACADEMY DINING FACILITY', gross: ri(14200, 18600) });
  for (let i = 0; i < 2; i++) add('ueph', { name: 'NCO ACADEMY STUDENT BARRACKS', floors: 3 });
  add('admin', { name: 'MISSION TRAINING COMPLEX', cc: 17120, category: 'education', gross: ri(48000, 62000), floors: 2 });
  add('instr', { name: 'DIGITAL TRAINING FACILITY' });
  // not in scope: shown for reference only
  N.jump(10800);
  add('admin', { name: 'ADMIN GEN PURPOSE (WWII WOOD)', gross: 6340, floors: 2, freq: 'N/A', remark: 'VACANT - PENDING DISPOSAL - NOT IN SCOPE', excluded: true });
  add('admin', { name: 'SHOPPETTE (AAFES)', cc: 74055, category: null, gross: 5260, floors: 1, freq: 'N/A', remark: 'AAFES MAINTAINED - NOT IN SCOPE', excluded: true });
  add('admin', { name: 'BOWLING CENTER', cc: 74021, category: null, gross: 18400, floors: 1, freq: 'N/A', remark: 'NAF FACILITY - MWR CUSTODIAL - NOT IN SCOPE', excluded: true });
}

// ---------------- troop areas: brigades / battalions ----------------
function brigade(z, N, opts) {
  const add = (type, over = {}) => z.rows.push(make(type, { num: String(N.next(over.gap)), ...over }));
  N.jump(opts.base);
  add('bdehq');
  add('dfac');
  if (opts.pfc) add('pfc', { name: 'PHYSICAL FITNESS CENTER' });
  for (let b = 0; b < opts.bns; b++) {
    N.jump(opts.base + 100 * (b + 1));
    add('bnhq');
    for (let c = 0; c < opts.cofs; c++) add('cof');
    for (let u = 0; u < opts.ueph; u++) add('ueph');
    const temfNo = N.next();
    z.rows.push(make('temf', { num: String(temfNo) }));
    // the TEMF's storage annex carries the TEMF number plus a letter suffix
    if (opts.storage) z.rows.push(make('orgstor', { num: `${temfNo}A` }));
  }
}

{
  const z = zone(2, 'ZONE 2 - NORTH TROOP AREA');
  const N = numberer(20000);
  brigade(z, N, { base: 20000, bns: 6, cofs: 3, ueph: 3, storage: true, pfc: true });
  brigade(z, N, { base: 21000, bns: 6, cofs: 3, ueph: 3, storage: true, pfc: true });
  N.jump(21900);
  z.rows.push(make('chapel', { num: String(N.next()), name: 'NORTH TROOP AREA CHAPEL' }));
  z.rows.push(make('tmc', { num: String(N.next()) }));
  z.rows.push(make('dental', { num: String(N.next()), name: 'DENTAL CLINIC NO 3' }));
  z.rows.push(make('ueph', { num: String(N.next()), name: 'UEPH BARRACKS (ROLLING PIN)', gross: 31840, floors: 3, freq: 'N/A', remark: 'DEMOLISHED FY26 - NOT IN SCOPE', excluded: true }));
}

{
  const z = zone(3, 'ZONE 3 - SOUTH TROOP AREA');
  const N = numberer(30000);
  brigade(z, N, { base: 30000, bns: 5, cofs: 3, ueph: 3, storage: true, pfc: true }); // sustainment brigade
  brigade(z, N, { base: 31000, bns: 4, cofs: 3, ueph: 2, storage: false, pfc: false }); // division artillery
  const add = (type, over = {}) => z.rows.push(make(type, { num: String(N.next(over.gap)), ...over }));
  // separate battalion (no brigade headquarters)
  N.jump(31700);
  add('bnhq', { name: 'MILITARY INTELLIGENCE BATTALION HEADQUARTERS' });
  for (let c = 0; c < 3; c++) add('cof');
  for (let u = 0; u < 2; u++) add('ueph');
  add('temf');
  N.jump(31800);
  add('chapel', { name: 'SOUTH TROOP AREA CHAPEL' });
  add('tmc');
  add('cdc', { name: 'CHILD DEVELOPMENT CENTER (SOUTH)' });
  add('instr', { name: 'UNIT CLASSROOM BLDG' });
  add('instr', { name: 'UNIT CLASSROOM BLDG' });
  add('ueph', { name: 'UEPH BARRACKS', gross: 64220, floors: 4, freq: 'N/A', remark: 'UNDER RENOVATION THRU FY28 - NOT IN SCOPE', excluded: true });
  // relocatable (temporary) buildings: T-prefixed numbers
  for (const num of ['T32001', 'T32003', 'T32004', 'T32007']) z.rows.push(make('admin', { num, name: 'RELOCATABLE ADMIN BLDG', gross: ri(1440, 3840), floors: 1 }));
}

// ---------------- ZONE 4 - LOGISTICS AND INDUSTRIAL AREA (4xxxx) ----------------
{
  const z = zone(4, 'ZONE 4 - LOGISTICS AND INDUSTRIAL AREA');
  const N = numberer(40000);
  const add = (type, over = {}) => z.rows.push(make(type, { num: String(N.next(over.gap)), ...over }));
  add('whse', { name: 'INSTALLATION GENERAL PURPOSE WAREHOUSE (DOL)', gross: 250000, floors: 1, cleanable: 14600, fixtures: 12, freq: '1X/WK' });
  add('whse', { name: 'SUPPLY SUPPORT ACTIVITY (SSA) WAREHOUSE', gross: ri(52000, 64000), freq: '1X/WK' });
  add('whse', { name: 'CENTRAL ISSUE FACILITY (CIF)', gross: ri(68000, 84000), cleanable: undefined, freq: '5X/WK', remark: 'CUSTOMER SERVICE, OFFICE AND LATRINE AREAS ONLY' });
  for (let i = 0; i < 22; i++) add('whse');
  add('whse', { name: 'GENERAL PURPOSE WAREHOUSE', gross: 22480, freq: 'N/A', remark: 'DEMOLISHED FY25 - NOT IN SCOPE', excluded: true });
  N.jump(40400);
  for (const nm of ['DOL MAINTENANCE SHOP (WHEELED)', 'DOL MAINTENANCE SHOP (TRACKED)', 'DOL ALLIED TRADES SHOP']) add('shop', { name: nm, cc: 21410, gross: ri(42000, 72000), cleanable: undefined });
  for (const nm of ['DPW CARPENTRY SHOP', 'DPW ELECTRICAL SHOP', 'DPW HVAC SHOP', 'DPW PLUMBING SHOP', 'DPW ROADS AND GROUNDS SHOP', 'DPW PAINT SHOP']) add('shop', { name: nm });
  N.jump(40600);
  for (let i = 0; i < 6; i++) add('orgstor');
  add('hazstor');
  add('hazstor');
  add('admin', { name: 'SELF SERVICE SUPPLY CENTER', cc: 44220, category: 'warehouse', gross: ri(6000, 9000), floors: 1 });
  add('admin', { name: 'TRANSPORTATION MOTOR POOL ADMINISTRATION', gross: ri(4800, 7600), floors: 1 });
  add('gate', { name: 'FUEL POINT CONTROL BLDG', cc: 12410, gross: ri(360, 720), freq: '1X/WK' });
  add('gate', { name: 'FUEL POINT CONTROL BLDG', cc: 12410, gross: ri(360, 720), freq: '1X/WK' });
}

// ---------------- ZONE 5 - ARMY AIRFIELD (5xxxx) ----------------
{
  const z = zone(5, 'ZONE 5 - ARMY AIRFIELD');
  const N = numberer(50000);
  const add = (type, over = {}) => z.rows.push(make(type, { num: String(N.next(over.gap)), ...over }));
  add('admin', { name: 'AIRFIELD OPERATIONS BLDG', cc: 14112, gross: ri(14000, 19000), floors: 2, freq: '7X/WK' });
  add('admin', { name: 'AIR TRAFFIC CONTROL TOWER', cc: 14171, category: null, gross: ri(4200, 5200), floors: 6, freq: '7X/WK' });
  add('fire', { name: 'AIRCRAFT CRASH RESCUE STATION' });
  for (let i = 0; i < 6; i++) add('hangar');
  add('hangar', { gross: 61200, floors: 1, freq: 'N/A', remark: 'TRANSFERRED TO ARNG AASF - NOT IN SCOPE', excluded: true });
  N.jump(50300);
  for (let i = 0; i < 2; i++) { add('bnhq', { name: 'AVIATION BATTALION HEADQUARTERS' }); for (let c = 0; c < 2; c++) add('cof', { name: 'AVIATION COMPANY OPERATIONS FACILITY' }); }
  add('orgstor', { name: 'AVIATION UNIT STORAGE BLDG' });
  add('orgstor', { name: 'AVIATION UNIT STORAGE BLDG' });
  add('instr', { name: 'FLIGHT SIMULATOR BLDG', cc: 17150, gross: ri(9000, 14000), floors: 1 });
  add('ueph', { name: 'UEPH BARRACKS', floors: 3 });
  add('ueph', { name: 'UEPH BARRACKS', floors: 3 });
}

// ---------------- ZONE 6 - RANGES AND TRAINING AREAS (9xxxx) ----------------
{
  const z = zone(6, 'ZONE 6 - RANGES AND TRAINING AREAS');
  const add = (type, num, over = {}) => z.rows.push(make(type, { num: String(num), ...over }));
  add('admin', 90001, { name: 'RANGE CONTROL HEADQUARTERS', gross: ri(9800, 12800), floors: 2, freq: '7X/WK' });
  add('rangeops', 90004, { name: 'RANGE CONTROL AMMUNITION BREAKDOWN BLDG', category: null, freq: 'BI-WKLY' });
  const rangeTypes = ['ZERO', 'KD', 'ARF', 'MPRC', 'MPTR', 'IPBC', 'CPQC', 'MPMG', 'SRTA', 'HAND GRENADE', 'DEMO', 'MORTAR', 'SNIPER', 'CONVOY LFX', 'SQUAD BATTLE COURSE', 'PISTOL QUAL', 'NIGHT FIRE', 'SHOOTHOUSE'];
  const ranges = [1, 3, 4, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 22, 23, 25, 27, 29, 31, 33, 36, 38, 40, 42, 45];
  ranges.forEach((r, i) => {
    const nn = String(r).padStart(2, '0');
    const rt = rangeTypes[i % rangeTypes.length];
    const base = 90000 + r * 100;
    if (r === 31) { add('latrine', base + 1, { name: `RANGE ${nn} ${rt} LATRINE`, gross: 240, freq: 'N/A', remark: 'RANGE CLOSED - NOT IN SCOPE', excluded: true }); return; }
    add('latrine', base + 1, { name: `RANGE ${nn} ${rt} LATRINE`, gross: r === 3 ? 120 : undefined });
    if (i % 5 !== 4) add('tower', base + 2, { name: `RANGE ${nn} ${rt} CONTROL TOWER` });
    if (i % 2 === 0) add('rangeops', base + 3, { name: `RANGE ${nn} ${rt} OPS AND STORAGE BLDG` });
    if (i % 4 === 1) add('rangeclass', base + 4, { name: `RANGE ${nn} ${rt} CLASSROOM` });
  });
  for (const ta of [2, 5, 7, 10, 13, 16, 19, 21, 24]) add('latrine', 97000 + ta * 10, { name: `TA ${String(ta).padStart(2, '0')} VAULT LATRINE`, gross: ri(120, 180), fixtures: 2, freq: '1X/WK' });
}

// ---------- assemble the facility sheet ----------
const HEAD1 = ['ITEM', 'BLDG NO.', 'FACILITY DESCRIPTION', 'CATCODE', 'NO. OF FLOORS', 'AREA (SQUARE FEET)', '', 'RESTROOM FIXTURES (EA)', 'CUSTODIAL FREQUENCY', 'REMARKS'];
const HEAD2 = ['', '', '', '', '', 'GROSS', 'CLEANABLE', '', '', ''];
const fac = [
  [`SOLICITATION ${SOLICITATION} - BASE OPERATIONS SUPPORT SERVICES (CUSTODIAL AND GROUNDS MAINTENANCE)`],
  [`ATTACHMENT J-0302 - INSTALLATION FACILITY LIST, ${INSTALLATION.toUpperCase()}`],
  ['Source: DPW Real Property Branch (GFEBS) extract as of 15 SEP 2026. Areas in square feet. Frequency codes and notes are defined on the Notes sheet.'],
  [],
  HEAD1, HEAD2,
];
const merges = ['A1:J1', 'A2:J2', 'A3:J3', 'A5:A6', 'B5:B6', 'C5:C6', 'D5:D6', 'E5:E6', 'F5:G5', 'H5:H6', 'I5:I6', 'J5:J6'];
let item = 0;
const truthFacilities = [];
const zoneStats = [];
const seen = new Set();
for (const z of zones) {
  fac.push([z.title]);
  merges.push(`A${fac.length}:J${fac.length}`);
  let g = 0, c = 0, fx = 0, n = 0;
  for (const f of z.rows) {
    if (seen.has(f.num)) throw new Error(`duplicate building number ${f.num}`);
    seen.add(f.num);
    item++;
    fac.push([item, f.num, f.name, f.catcode, f.floors, f.gross, f.cleanable, f.fixtures || '', f.freq, f.remark]);
    if (f.excluded) continue;
    n++; g += f.gross; c += f.cleanable; fx += f.fixtures || 0;
    const t = { buildingNumber: f.num, name: f.name, grossSqft: f.gross, cleanableSqft: f.cleanable, floors: f.floors, serviceLevel: FREQ[f.freq] };
    if (!t.serviceLevel) throw new Error(`no service level for ${f.num} ${f.freq}`);
    if (f.category) t.category = f.category;
    if (f.fixtures) t.restroomFixtures = f.fixtures;
    truthFacilities.push(t);
  }
  fac.push(['', '', `${z.title.split(' - ')[0]} SUBTOTAL - ${n} FACILITIES IN SCOPE`, '', '', g, c, fx, '', '']);
  zoneStats.push({ zone: z.title, inScope: n, listed: z.rows.length, gross: g, cleanable: c });
}
const totG = truthFacilities.reduce((s, f) => s + f.grossSqft, 0);
const totC = truthFacilities.reduce((s, f) => s + f.cleanableSqft, 0);
const totFx = truthFacilities.reduce((s, f) => s + (f.restroomFixtures ?? 0), 0);
fac.push([]);
fac.push(['', '', `GRAND TOTAL - ${truthFacilities.length} FACILITIES IN SCOPE`, '', '', totG, totC, totFx, '', '']);
fac.push([]);
const facNotes = [
  'NOTES:',
  '1. Gross SF is the RPI total unit of measure quantity; cleanable SF is the area serviced under the custodial requirement (PWS para C.5.2).',
  '2. UEPH barracks: cleanable SF is common areas only (entries, corridors, stairwells, laundry rooms, dayrooms and common latrines). Living modules are cleaned by the occupants.',
  '3. TEMF: cleanable SF is the administrative, break and latrine areas. Maintenance bays, tool rooms and COMSEC/arms vaults are excluded.',
  '4. Facilities marked NOT IN SCOPE in the Remarks column are listed for reference only. They are excluded from all subtotals and totals and shall not be serviced.',
  '5. Range latrines, towers and range buildings are serviced at the frequency shown during scheduled range use; Range Control issues the weekly range schedule.',
  '6. Building numbers ending in a letter are separate facilities (TEMF storage annexes); numbers beginning with T are relocatable buildings.',
];
for (const n of facNotes) { fac.push([n]); merges.push(`A${fac.length}:J${fac.length}`); }
if (truthFacilities.length !== EXPECTED_IN_SCOPE) throw new Error(`in-scope facilities = ${truthFacilities.length}, expected ${EXPECTED_IN_SCOPE}`);

// ---------- grounds sheet ----------
const grounds = [
  [`SOLICITATION ${SOLICITATION} - ATTACHMENT J-0302`],
  [`${INSTALLATION.toUpperCase()} - GROUNDS MAINTENANCE AREAS BY CANTONMENT ZONE AND TRAINING AREA (ACRES)`],
  [],
  ['AREA NO.', 'GROUNDS AREA', 'ACRES BY GROUNDS CATEGORY', '', '', 'TOTAL ACRES', 'REMARKS'],
  ['', '', 'IMPROVED', 'SEMI-IMPROVED', 'UNIMPROVED', '', ''],
];
const gMerges = ['A1:G1', 'A2:G2', 'A4:A5', 'B4:B5', 'C4:E4', 'F4:F5', 'G4:G5'];
const truthGrounds = [];
const KINDS = [['improved_turf', 'IMPROVED'], ['semi_improved', 'SEMI-IMPROVED'], ['unimproved', 'UNIMPROVED']];
const dash = (v) => (v ? v : '-');
function groundsSection(title, rows, label) {
  grounds.push([title]); gMerges.push(`A${grounds.length}:G${grounds.length}`);
  const sum = [0, 0, 0];
  for (const r of rows) {
    const total = r2(r.q[0] + r.q[1] + r.q[2]);
    grounds.push([r.id, r.name, dash(r.q[0]), dash(r.q[1]), dash(r.q[2]), total, r.remark ?? '']);
    if (r.excluded) continue;
    r.q.forEach((q, i) => { sum[i] = r2(sum[i] + q); if (q > 0) truthGrounds.push({ kind: KINDS[i][0], quantity: q, unit: 'acres', name: `${r.id} ${r.name}` }); });
  }
  grounds.push(['', `SUBTOTAL - ${label}`, sum[0], sum[1], sum[2], r2(sum[0] + sum[1] + sum[2]), '']);
  return sum;
}
const cant = [
  { id: 'C-1', name: 'MAIN CANTONMENT', q: [r2(rf(170, 200)), r2(rf(55, 75)), 0], remark: 'Parade field, headquarters and community area lawns' },
  { id: 'C-2', name: 'NORTH TROOP AREA', q: [r2(rf(130, 160)), r2(rf(80, 100)), r2(rf(8, 16))] },
  { id: 'C-3', name: 'SOUTH TROOP AREA', q: [r2(rf(100, 130)), r2(rf(70, 95)), r2(rf(10, 20))] },
  { id: 'C-4', name: 'LOGISTICS AND INDUSTRIAL AREA', q: [r2(rf(18, 28)), r2(rf(60, 80)), r2(rf(14, 24))] },
  { id: 'C-5', name: 'ARMY AIRFIELD', q: [r2(rf(28, 40)), r2(rf(380, 440)), r2(rf(80, 110))], remark: 'Semi-improved includes runway infield and clear zones' },
  { id: 'C-6', name: 'CANTONMENT ROADSIDES, MEDIANS AND DRAINAGE WAYS', q: [0, r2(rf(220, 260)), 0] },
  { id: 'C-7', name: 'FAMILY HOUSING AREAS (RCI)', q: [r2(rf(300, 360)), r2(rf(40, 60)), 0], remark: 'RCI PARTNER MAINTAINED - NOT IN SCOPE', excluded: true },
  { id: 'C-8', name: 'GOLF COURSE (NAF)', q: [r2(rf(110, 140)), r2(rf(20, 30)), r2(rf(30, 45))], remark: 'NAF - NOT IN SCOPE', excluded: true },
];
const tas = [];
for (let ta = 1; ta <= 24; ta++) {
  const hasRange = [1, 3, 4, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 22, 23].includes(ta);
  tas.push({ id: `TA ${String(ta).padStart(2, '0')}`, name: `TRAINING AREA ${ta}${hasRange ? ' (RANGE COMPLEX)' : ''}`, q: [hasRange ? r2(rf(0.5, 6)) : 0, r2(rf(15, 240)), r2(rf(1200, 9800))], remark: hasRange ? 'Improved: range building and bleacher areas' : '' });
}
tas.push({ id: 'IA-1', name: 'IMPACT AREA (DUDDED)', q: [0, 0, r2(rf(17000, 19000))], remark: 'NO ACCESS - NOT IN SCOPE', excluded: true });
const s1 = groundsSection('CANTONMENT ZONES', cant, 'CANTONMENT');
const s2 = groundsSection('TRAINING AREAS', tas, 'TRAINING AREAS');
grounds.push([]);
grounds.push(['', 'GRAND TOTAL (IN SCOPE)', r2(s1[0] + s2[0]), r2(s1[1] + s2[1]), r2(s1[2] + s2[2]), r2(s1[0] + s1[1] + s1[2] + s2[0] + s2[1] + s2[2]), '']);
grounds.push([]);
for (const n of [
  'NOTES:',
  '1. Acreages are from the ITAM / DPW GIS as of 01 AUG 2026 and are net of building footprints and paved surfaces.',
  '2. A dash (-) means no acreage of that category in the area.',
  '3. Areas marked NOT IN SCOPE are shown for reference and are excluded from subtotals and the grand total.',
  '4. Grounds category definitions are on the Notes sheet.',
]) { grounds.push([n]); gMerges.push(`A${grounds.length}:G${grounds.length}`); }

// ---------- notes sheet ----------
const notes = [
  ['ATTACHMENT J-0302 - NOTES AND DEFINITIONS'],
  [],
  ['CUSTODIAL FREQUENCY', 'DEFINITION', 'SERVICES PER YEAR (NOMINAL)'],
  ['7X/WK', 'Daily, seven days per week including weekends and Federal holidays', 365],
  ['5X/WK', 'Daily, Monday through Friday, excluding Federal holidays', 250],
  ['3X/WK', 'Three times per week (Monday, Wednesday, Friday)', 150],
  ['2X/WK', 'Two times per week (Tuesday, Thursday)', 100],
  ['1X/WK', 'Once per week', 52],
  ['BI-WKLY', 'Once every two weeks', 26],
  ['1X/MO', 'Once per month', 12],
  ['QTRLY', 'Once per calendar quarter', 4],
  ['N/A', 'Not serviced (facility not in scope)', 0],
  [],
  ['GROUNDS CATEGORY', 'DEFINITION'],
  ['IMPROVED', 'Areas on which intensive maintenance is performed as a fixed requirement: lawns, landscape plantings, parade and athletic grounds. Mowed on a 7-day cycle during the growing season.'],
  ['SEMI-IMPROVED', 'Areas on which periodic maintenance is performed: road shoulders, firebreaks, range firing lines, airfield infield and clear zones. Mowed 4 to 6 times per growing season.'],
  ['UNIMPROVED', 'All other areas, including woodland and training land. Brush control or bush-hogging once or twice per year.'],
];
const sheets = {
  sheets: [
    { name: 'J-0302 Facility List', rows: fac, merges, numFmt: [null, null, null, null, null, '#,##0', '#,##0', null, null, null] },
    { name: 'Grounds', rows: grounds, merges: gMerges, numFmt: [null, null, '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', null] },
    { name: 'Notes', rows: notes, merges: ['A1:C1'] },
  ],
};
fs.writeFileSync(path.join(here, 'facility-list.json'), JSON.stringify(sheets, null, 1) + '\n');

// ---------- truth ----------
const excludedRows = zones.flatMap((z) => z.rows.filter((r) => r.excluded).map((r) => `${r.num} ${r.name} (${r.remark})`));
const gTot = { improved_turf: r2(s1[0] + s2[0]), semi_improved: r2(s1[1] + s2[1]), unimproved: r2(s1[2] + s2[2]) };
const nameCount = {}; for (const f of truthFacilities) nameCount[f.name] = (nameCount[f.name] ?? 0) + 1;
const repeatCounts = Object.entries(nameCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${c} x "${n}"`).join(', ');
const repeatedRows = Object.values(nameCount).filter((c) => c > 1).reduce((s, c) => s + c, 0);
const annexEx = truthFacilities.find((f) => /A$/.test(f.buildingNumber)).buildingNumber.slice(0, -1);
const sfMin = Math.min(...truthFacilities.map((f) => f.grossSqft)), sfMax = Math.max(...truthFacilities.map((f) => f.grossSqft));
const truth = {
  id: 'large-installation-420-xlsx',
  title: `Large Army installation Attachment J-0302 facility list workbook: ${truthFacilities.length} in-scope facilities in six zones (UEPH, COF, BN/BDE HQ, TEMF, DFAC, chapels, PFCs, CDCs, clinics, warehouses, range latrines/towers, gatehouses) plus a Grounds sheet of improved / semi-improved / unimproved acres by cantonment zone and training area (scale test)`,
  theme: 'large',
  provenance: {
    fidelity: 'synthetic',
    sources: [
      { url: 'https://www.usace.army.mil/Portals/2/FY2019%202017_PAX_Newsletter_3_2_2_Army_Facilities_Pricing_Guide_Dated_6%20APR%202017___.pdf', note: 'Army Facilities Pricing Guide (PAX 3.2.2, 2017): CATCODE 14185 COMPANY OPERATIONS FACILITY (COF), 21410 tactical equipment maintenance facilities (TEMF) in small/medium/large sizes, 72210 dining facility entries, 72111 among the enlisted housing codes. Used for those CATCODE assignments only.' },
      { url: 'https://www.usace.army.mil/LinkClick.aspx?fileticket=KnZFypDe6uQ%3D&portalid=2', note: 'USACE unit costs for Army facilities: 14183 BATTALION HQS BLDG W/ CLASSROOMS, 14182 brigade headquarters building, 74042 indoor swimming pool as a code separate from the fitness center. Used for those CATCODE assignments.' },
      { url: 'https://www.usace.army.mil/LinkClick.aspx?fileticket=I5cAMZGFUkE%3D&portalid=2', note: 'FY05 facility unit cost table: 21410 VEHICLE MAINT SHOP - TRACK; 72111 unaccompanied personnel housing.' },
      { url: 'https://www.usace.army.mil/LinkClick.aspx?fileticket=bdnXSYCqMYI%3D&portalid=2', note: 'USACE Army facilities unit-cost table: 14114 CIDC field operations building; five-digit CATCD per DA Pam 415-28.' },
      { url: 'https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/r415_28.pdf', note: 'AR 415-28 Real Property Category Codes: the five-digit CATCODE system used in the CATCODE column.' },
      { url: 'https://www.samdaily.us/archive/2025/05-May/18-May-2025/FBO-07446536.htm', note: 'Fort Cavazos Installation Custodial Service sources sought (PANMCC-25-P-0000015172): one installation custodial requirement with a separate PWS. Scale anchor only.' },
      { url: 'https://oversight.govsignals.ai/opportunity/sources-sought-for-installation-custodial-service-at-fort-cavazos-tx-panmcc-25-p-0000015172', note: 'Summary of the same notice: roughly 500 to 600 government facilities. Basis for testing at 400+ buildings.' },
      { url: 'https://app.g2xchange.com/opportunities/sam/7c36ee60-7ed0-4dec-bdae-6eba76a41dce', note: 'Fort Benning grounds maintenance sources sought: about 184,000 acres of improved, semi-improved and unimproved grounds, excluding the golf course, cemetery, airfield and some MWR areas. Basis for the three-category acreage layout and the NOT IN SCOPE golf course row.' },
      { url: 'https://www.patrick.spaceforce.mil/Portals/14/AFD-150612-026.pdf', note: 'Improved grounds (intensive maintenance) and semi-improved grounds (mowed occasionally) definitions, paraphrased on the Notes sheet.' },
    ],
    notes: 'Generated by gen.mjs (seeded mulberry32 PRNG, seed 4202027). The installation (Fort Brannock), solicitation number, every building number, name, area, floor count, fixture count, frequency and acreage are invented. CATCODEs 14114, 14182, 14183, 14185, 21410, 72111, 72210 and 74042 follow the USACE cost tables cited. All other CATCODE assignments (61050, 73017, 74028, 74046, 55010, 54010, 44220, 44224, 44260, 21110, 21910, 17120, 17150, 73010, 73046, 73070, 73075, 74010, 74021, 74044, 74047, 74055, 12410, 14112, 14113, 14171, 17890-17892) are plausible but not verified against DA Pam 415-28. No public Army facility-list exhibit was downloadable, so the column layout follows the other fixtures and common Technical Exhibit practice, not a specific document.',
  },
  inputs: [{ src: 'facility-list.json', as: 'xlsx', out: OUT_XLSX }],
  expect: {
    facilities: truthFacilities,
    facilitiesComplete: true,
    grounds: truthGrounds,
    site: { installationName: INSTALLATION, solicitation: SOLICITATION },
  },
  traps: [
    `Scale: ${zones.reduce((s, z) => s + z.rows.length, 0)} listed facility rows, ${truthFacilities.length} in scope, ${totG.toLocaleString('en-US')} gross SF in total. Gross SF runs from ${sfMin.toLocaleString('en-US')} (RANGE 03 latrine, gatehouse booth) to ${sfMax.toLocaleString('en-US')} (installation warehouse). Readers and the 3D campus must handle 400+ buildings without truncation, paging limits or dropping rows.`,
    `Names repeat: ${repeatCounts}. ${repeatedRows} in-scope rows share a name with at least one other row. Only the building number tells them apart, so de-duplicating by name collapses hundreds of buildings.`,
    'Two-row merged header: "AREA (SQUARE FEET)" is merged over GROSS and CLEANABLE. ITEM (1..N) is a row counter, not a building number. CATCODE is a 5-digit number cell (e.g. 72111) and must not be read as square feet. BLDG NO. is a number cell for plain 5-digit numbers and a text cell for suffixed or T-prefixed numbers.',
    `Zone section rows ("ZONE 2 - NORTH TROOP AREA", merged across) are headers, not facilities. Six "ZONE n SUBTOTAL - n FACILITIES IN SCOPE" rows and a "GRAND TOTAL - ${truthFacilities.length} FACILITIES IN SCOPE" row (${totG.toLocaleString('en-US')} SF) are not facilities.`,
    `${excludedRows.length} rows are listed with SF but marked NOT IN SCOPE in Remarks (frequency N/A) and are excluded from truth and from the printed subtotals: ${excludedRows.join('; ')}.`,
    `Building numbers with a letter suffix (TEMF storage annexes such as ${annexEx}A next to TEMF ${annexEx}) are separate facilities from the TEMF with the same digits. Relocatable buildings use T-prefixed numbers (T32001, T32003, T32004, T32007).`,
    'Cleanable SF is far below gross for UEPH barracks (common areas only, about 18-26%), TEMFs (12-20%), hangars, shops and warehouses (office/latrine areas only), and DFACs (kitchen by the food service contractor). Do not default cleanable to gross.',
    'Custodial frequency is a code (7X/WK, 5X/WK, 3X/WK, 2X/WK, 1X/WK, BI-WKLY, 1X/MO, QTRLY) defined on the Notes sheet: 7X/WK -> daily_7, 5X/WK -> daily_5, BI-WKLY -> biweekly, 1X/MO -> monthly, QTRLY -> quarterly. The Notes sheet "SERVICES PER YEAR" numbers (365, 250, ...) are not facilities.',
    'RESTROOM FIXTURES is blank for buildings without restrooms (towers, storage buildings, some gatehouses); truth leaves restroomFixtures out for those.',
    `Grounds sheet: two-row header with "ACRES BY GROUNDS CATEGORY" merged over IMPROVED / SEMI-IMPROVED / UNIMPROVED; a dash means zero. In-scope totals: improved ${gTot.improved_turf} AC, semi-improved ${gTot.semi_improved} AC, unimproved ${gTot.unimproved} AC. C-7 FAMILY HOUSING (RCI), C-8 GOLF COURSE (NAF) and IA-1 IMPACT AREA (DUDDED) are NOT IN SCOPE. The TOTAL ACRES column, the two SUBTOTAL rows and the GRAND TOTAL row must not be added again.`,
    'Unimproved training-area acreage (tens of thousands of acres) is in scope here and dominates total acres. A reader that drops it, or that also adds the 17,000+ acre impact area, is far off on unimproved acres.',
    'No dining workload (meals/day) is given; DFAC rows are custodial only, so truth asserts no dining profile.',
  ],
};
fs.writeFileSync(path.join(here, 'truth.json'), JSON.stringify(truth, null, 2) + '\n');

console.log(`facilities in scope: ${truthFacilities.length} (listed ${zones.reduce((s, z) => s + z.rows.length, 0)}), gross ${totG}, cleanable ${totC}, fixtures ${totFx}, SF ${sfMin}..${sfMax}`);
for (const s of zoneStats) console.log(`  ${s.zone}: ${s.inScope}/${s.listed} in scope, ${s.gross} SF gross, ${s.cleanable} SF cleanable`);
console.log(`grounds rows: ${truthGrounds.length}; totals ${JSON.stringify(gTot)}`);
const byCat = {}; for (const f of truthFacilities) byCat[f.category ?? '(none)'] = (byCat[f.category ?? '(none)'] ?? 0) + 1;
console.log('by category:', JSON.stringify(byCat));
const byLvl = {}; for (const f of truthFacilities) byLvl[f.serviceLevel] = (byLvl[f.serviceLevel] ?? 0) + 1;
console.log('by service level:', JSON.stringify(byLvl));
