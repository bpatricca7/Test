#!/usr/bin/env node
// Deterministic generator for the univ-room-inventory-xlsx holdout fixture.
//   cd bos-estimator && node tests/holdout-b2/univ-room-inventory-xlsx/gen.mjs
// Writes attachment-c-space-inventory.json (the multi-sheet workbook source that scripts/render-fixtures.mjs
// renders to XLSX) and replaces expect.facilities in truth.json. Every building figure on C-1, C-2 and C-3 is
// computed from the same room list, so subtotals, totals and the three tabs always reconcile.
// Uses a seeded PRNG (mulberry32), never Math.random.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 2027014;

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
const pick = (arr) => (Array.isArray(arr) ? arr[Math.floor(rnd() * arr.length)] : arr);
const r5 = (n) => Math.round(n / 5) * 5;
const fmt = (n) => n.toLocaleString('en-US');

// ---------- FICM 2006 room use codes used in C-2 ----------
const USE = {
  '110': ['Classroom', 'A'], '115': ['Classroom Service', 'A'], '210': ['Class Laboratory', 'A'], '215': ['Class Laboratory Service', 'A'],
  '220': ['Open Laboratory', 'A'], '225': ['Open Laboratory Service', 'A'], '250': ['Research/Nonclass Laboratory', 'A'], '255': ['Research/Nonclass Lab Service', 'A'],
  '310': ['Office', 'A'], '315': ['Office Service', 'A'], '350': ['Conference Room', 'A'], '410': ['Study Room', 'A'], '420': ['Stack', 'A'],
  '430': ['Open-Stack Study Room', 'A'], '440': ['Processing Room', 'A'], '455': ['Study Service', 'A'], '520': ['Athletic or Physical Education', 'A'],
  '525': ['Athletic or Physical Education Service', 'A'], '530': ['Media Production', 'A'], '540': ['Clinic', 'A'], '545': ['Clinic Service', 'A'],
  '610': ['Assembly', 'A'], '615': ['Assembly Service', 'A'], '620': ['Exhibition', 'A'], '630': ['Food Facility', 'A'], '635': ['Food Facility Service', 'A'],
  '640': ['Day Care', 'A'], '645': ['Day Care Service', 'A'], '650': ['Lounge', 'A'], '660': ['Merchandising', 'A'], '665': ['Merchandising Service', 'A'],
  '670': ['Recreation', 'A'], '680': ['Meeting Room', 'A'], '710': ['Central Computer or Telecommunications', 'A'], '720': ['Shop', 'A'], '725': ['Shop Service', 'A'],
  '730': ['Central Storage', 'A'], '740': ['Vehicle Storage', 'A'], '750': ['Central Service', 'A'],
  '050': ['Inactive Area', 'U'], '060': ['Alteration or Conversion Area', 'U'],
  W01: ['Circulation - Corridor', 'N'], W02: ['Circulation - Lobby/Vestibule', 'N'], W03: ['Circulation - Stairway', 'N'], W04: ['Circulation - Elevator', 'N'], W05: ['Circulation - Loading Dock', 'N'],
  X01: ['Bldg Service - Custodial Supply Closet', 'N'], X02: ['Bldg Service - Janitor Room', 'N'], X03: ['Bldg Service - Public Rest Room', 'N'], X04: ['Bldg Service - Trash Room', 'N'],
  Y01: ['Mechanical - Mechanical Room', 'N'], Y02: ['Mechanical - Electrical Room', 'N'], Y03: ['Mechanical - Telecom Closet (IDF)', 'N'],
};
// Default custodial service flag by use code (Notes tab, General Note 6).
const NOT_CLEANED = new Set(['Y01', 'Y02', 'Y03', 'X01', 'X02', 'W05', '050', '060', '710', '720', '730', '740', '750', '630', '635', '660', '665']);
// Floor covering by use code.
const COVER = {
  '110': ['CPT-T', 'VCT', 'CPT-T'], '115': 'VCT', '210': ['VCT', 'SV', 'EP'], '215': 'VCT', '220': ['CPT-T', 'VCT'], '225': 'VCT', '250': ['SV', 'EP'], '255': 'VCT',
  '310': 'CPT-T', '315': ['VCT', 'CPT-T'], '350': 'CPT-T', '410': 'CPT-T', '420': 'CPT', '430': 'CPT', '440': 'VCT', '455': 'VCT', '520': 'WD', '525': 'CT',
  '530': 'VCT', '540': 'SV', '545': 'SV', '610': 'CPT', '615': 'WD', '620': 'TZ', '630': 'QT', '635': 'QT', '640': 'LVT', '645': 'LVT', '650': 'CPT-T',
  '660': 'VCT', '665': 'VCT', '670': 'VCT', '680': 'CPT', '710': 'VCT', '720': 'SC', '725': 'VCT', '730': 'SC', '740': 'SC', '750': 'SC', '050': 'VCT', '060': 'SC',
  W01: ['VCT', 'VCT', 'TZ'], W02: ['TZ', 'CT'], W03: 'RB', W04: 'VCT', W05: 'SC', X01: 'SC', X02: 'SC', X03: 'CT', X04: 'SC', Y01: 'SC', Y02: 'SC', Y03: 'SC',
};
const COVERS = ['CPT', 'CPT-T', 'VCT', 'LVT', 'SV', 'CT', 'QT', 'TZ', 'WD', 'RB', 'SC', 'EP'];

// ---------- buildings ----------
// lv = floor levels (C-2 "Flr"), mz = mezzanine levels (not counted as floors), elev = has elevator.
// prog[level] = [code, count, min, max, org, opts?]  opts: { name, cover, cust:'N', comment, st (stations divisor) }
// Truth: sl = service level id for the printed frequency; cat = category asserted only where the "Type of Building" is unambiguous.
const B = [
  { no: '010', ab: 'ADM', name: 'Founders Hall', sms: 'FOUNDERS HALL', type: 'Administration', yr: 1962, lv: ['01', '02'], elev: true, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'admin', appa: 2,
    remarks: '',
    prog: {
      '01': [['310', 5, 120, 190, ['PRES', 'FIN', 'HR', 'BURS']], ['310', 1, 1100, 1400, 'BURS', { name: 'CASHIER / OPEN OFFICE' }], ['315', 2, 220, 480, 'REG', { name: 'RECORDS' }], ['315', 1, 90, 180, 'FIN', { name: 'WORKROOM' }], ['350', 1, 320, 420, 'PRES']],
      '02': [['310', 5, 120, 210, ['PRES', 'PROV', 'HR', 'UADV']], ['680', 1, 1350, 1550, 'PRES', { name: 'BOARD ROOM', cover: 'CPT' }], ['315', 1, 80, 160, 'PROV']],
    } },
  { no: '012', ab: 'LIB', name: 'Elmore Library', sms: 'ELMORE LIBRARY', type: 'Library', yr: 1971, lv: ['B', '01', '02', '03'], elev: true, freq: '7/wk (Sun-Sat)', sl: 'daily_7', cat: null, appa: 2,
    rev: 'A1', remarks: 'Service Frequency revised by Addendum No. 1 (was 6/wk (M-Sa)).',
    prog: {
      B: [['420', 1, 4200, 4800, 'LIB', { name: 'COMPACT SHELVING' }], ['440', 1, 900, 1150, 'LIB', { name: 'TECHNICAL SERVICES' }], ['455', 1, 150, 320, 'LIB'], ['730', 1, 500, 700, 'LIB', { name: 'LIBRARY STORAGE' }]],
      '01': [['430', 1, 6800, 7600, 'LIB', { name: 'MAIN READING ROOM' }], ['455', 1, 650, 820, 'LIB', { name: 'CIRCULATION DESK' }], ['220', 1, 1400, 1700, 'IT', { name: 'INFORMATION COMMONS', st: 45 }], ['310', 3, 120, 170, 'LIB'], ['650', 1, 380, 520, 'LIB', { name: 'CAFE SEATING' }]],
      '02': [['430', 1, 5600, 6300, 'LIB', { name: 'STACKS / STUDY' }], ['410', 3, 110, 180, 'LIB', { name: 'GROUP STUDY', st: 25 }], ['110', 1, 760, 880, 'LIB', { name: 'INSTRUCTION ROOM', st: 20 }], ['310', 2, 120, 160, 'LIB']],
      '03': [['430', 1, 5200, 5900, 'LIB', { name: 'QUIET STUDY / STACKS' }], ['410', 2, 100, 170, 'LIB', { name: 'GROUP STUDY', st: 25 }], ['620', 1, 600, 760, 'LIB', { name: 'ARCHIVES READING' }], ['420', 1, 1100, 1400, 'LIB', { name: 'ARCHIVES STACK' }]],
    } },
  { no: '014', ab: 'SCI', name: 'Lindqvist Science Hall', sms: 'LINDQVIST SCIENCE HALL', type: 'Instruction - Science Labs', yr: 1968, lv: ['01', '02', '03'], elev: true, freq: '5/wk (M-F)', sl: 'daily_5', cat: null, appa: 2,
    remarks: 'Lab benches and fume hoods cleaned by Dept.; contractor cleans floors, sinks (exterior) and trash per RFP 4.8.',
    prog: {
      '01': [['210', 4, 1050, 1350, 'CHEM', { name: 'CHEM LAB', st: 48 }], ['215', 2, 160, 320, 'CHEM', { name: 'STOCKROOM / PREP' }], ['110', 2, 1200, 1500, 'REG', { name: 'LECTURE HALL', st: 16, cover: 'CPT' }], ['310', 2, 120, 160, 'CHEM']],
      '02': [['210', 4, 1050, 1300, 'BIOL', { name: 'BIOLOGY LAB', st: 48 }], ['215', 2, 160, 300, 'BIOL', { name: 'PREP ROOM' }], ['250', 2, 520, 760, 'BIOL', { name: 'RESEARCH LAB' }], ['310', 2, 115, 155, 'BIOL']],
      '03': [['210', 3, 1050, 1250, 'PHYS', { name: 'PHYSICS LAB', st: 48 }], ['215', 2, 150, 260, 'PHYS'], ['250', 2, 480, 700, 'GEOL', { name: 'RESEARCH LAB' }], ['110', 1, 820, 960, 'REG', { st: 20 }], ['310', 2, 115, 155, ['PHYS', 'GEOL', 'MATH']]],
    } },
  { no: '016', ab: 'BRG', name: 'Bergstrom Hall', sms: 'BERGSTROM HALL', type: 'Instruction', yr: 1966, lv: ['01', '02', '03'], elev: true, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'education', appa: 2,
    remarks: 'Rooms on 2nd floor coded 060 are offline for renovation until 01/2027 (Cust Svc = N); to be added by contract modification when returned to service.',
    prog: {
      '01': [['110', 5, 720, 980, 'REG', { st: 20 }], ['115', 1, 80, 140, 'REG'], ['650', 1, 300, 420, 'STUA', { name: 'STUDENT LOUNGE' }]],
      '02': [['110', 3, 700, 940, 'REG', { st: 20 }], ['310', 4, 110, 150, ['ENGL', 'HIST', 'PHIL']], ['060', 3, 160, 420, 'FAC', { comment: 'Renovation - offline to 01/2027' }], ['350', 1, 260, 340, 'ENGL']],
      '03': [['110', 3, 700, 900, 'REG', { st: 20 }], ['220', 1, 900, 1100, 'ENGL', { name: 'WRITING CENTER', st: 40 }], ['310', 5, 110, 150, ['ENGL', 'HIST', 'LANG']]],
    } },
  { no: '018', ab: 'KIT', name: 'Kittredge Hall', sms: 'KITTREDGE HALL', type: 'Instruction', yr: 1989, lv: ['01'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'education', appa: 2,
    remarks: '',
    prog: {
      '01': [['110', 6, 860, 1250, 'REG', { st: 20 }], ['220', 1, 1150, 1350, 'BUSN', { name: 'COMPUTER LAB', st: 40 }], ['650', 1, 420, 560, 'BUSN', { name: 'ATRIUM LOUNGE', cover: 'TZ' }], ['310', 6, 115, 160, ['BUSN', 'ACCT', 'ECON']], ['350', 1, 280, 360, 'BUSN']],
    } },
  { no: '019', ab: 'THO', name: 'Thorsen Hall', sms: 'THORSEN HALL', type: 'Instruction', yr: 1958, lv: ['01', '02'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'education', appa: 3,
    rev: 'A1', grossCorrection: 720,
    prog: {
      '01': [['110', 5, 680, 900, 'REG', { st: 20 }], ['310', 2, 110, 150, 'MATH'], ['050', 1, 520, 640, 'FAC', { comment: 'Inactive - former darkroom, locked' }]],
      '02': [['110', 4, 680, 880, 'REG', { st: 20 }], ['310', 2, 110, 150, ['MATH', 'PSYC']], ['220', 1, 700, 820, 'MATH', { name: 'MATH TUTORING', st: 35 }]],
    } },
  { no: '021', ab: 'CDC', name: 'Child Development Center', sms: 'CHILD DEVELOPMENT CTR', type: 'Child Care (Lab School)', yr: 2004, lv: ['01'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'child_care', appa: 2,
    remarks: 'Lab school. Background checks required for contractor staff (RFP 5.3).',
    prog: {
      '01': [['640', 6, 820, 1050, 'CDC', { name: 'CLASSROOM', st: 35 }], ['645', 2, 120, 260, 'CDC', { name: 'KITCHENETTE / STORAGE' }], ['310', 2, 110, 150, 'CDC'], ['210', 1, 480, 560, 'EDUC', { name: 'OBSERVATION ROOM', st: 30, cover: 'CPT-T' }]],
    } },
  { no: '022', ab: 'FAC', name: 'Fine Arts Center', sms: 'FINE ARTS CENTER', type: 'Instruction - Fine & Performing Arts', yr: 1977, lv: ['B', '01', '02'], mz: ['M1'], elev: true, freq: '6/wk (M-Sa)', sl: 'daily_6', cat: 'education', appa: 2,
    remarks: 'Mezzanine (M1) booths not counted as a floor. Scene shop maintained by Theatre Dept. (Cust Svc = N).',
    prog: {
      B: [['720', 1, 2200, 2600, 'THTR', { name: 'SCENE SHOP' }], ['615', 2, 180, 420, 'THTR', { name: 'DRESSING / GREEN ROOM' }], ['730', 1, 700, 900, 'THTR', { name: 'COSTUME STORAGE' }], ['220', 3, 70, 95, 'MUSC', { name: 'PRACTICE ROOM', st: 70 }]],
      '01': [['610', 1, 6400, 7000, 'THTR', { name: 'THEATRE (412 SEATS)' }], ['615', 1, 1800, 2100, 'THTR', { name: 'STAGE', cover: 'WD' }], ['620', 1, 1100, 1300, 'ART', { name: 'GALLERY' }], ['210', 2, 1600, 1900, 'MUSC', { name: 'REHEARSAL HALL', st: 30, cover: 'WD' }], ['310', 2, 120, 160, 'MUSC']],
      '02': [['210', 5, 1100, 1450, 'ART', { name: 'STUDIO', st: 60, cover: 'SC' }], ['215', 2, 180, 320, 'ART', { name: 'KILN / STORAGE' }], ['310', 4, 110, 150, ['ART', 'THTR', 'MUSC']]],
      M1: [['615', 2, 140, 220, 'THTR', { name: 'LIGHT / SOUND BOOTH', cover: 'CPT' }], ['Y01', 1, 600, 800, '', { name: 'FAN ROOM' }]],
    } },
  { no: '024', ab: 'AHN', name: 'Allied Health & Nursing Building', sms: 'ALLIED HEALTH & NURSING BLDG', type: 'Instruction', yr: 2011, lv: ['01', '02', '03'], elev: true, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'education', appa: 2,
    remarks: '3rd floor leased to Pine Falls Regional Medical Center (PFRMC) residency program; tenant cleans (3rd floor rooms Cust Svc = N).',
    prog: {
      '01': [['110', 4, 900, 1200, 'REG', { st: 20 }], ['210', 2, 1300, 1550, 'NURS', { name: 'SIMULATION LAB', st: 55, cover: 'SV' }], ['215', 2, 150, 260, 'NURS'], ['650', 1, 360, 480, 'NURS']],
      '02': [['210', 3, 1100, 1400, 'NURS', { name: 'SKILLS LAB', st: 55, cover: 'SV' }], ['215', 1, 200, 300, 'NURS'], ['310', 5, 115, 160, ['NURS', 'HSCI']], ['350', 1, 280, 340, 'NURS']],
      '03': [['310', 5, 115, 165, 'PFRMC'], ['350', 2, 280, 420, 'PFRMC'], ['210', 1, 900, 1100, 'PFRMC', { st: 55 }]],
    },
    tenantLevel: '03' },
  { no: '026', ab: 'TEC', name: 'Technology & Engineering Center', sms: 'TECHNOLOGY & ENGINEERING CTR', type: 'Instruction - Labs & Shops', yr: 1999, lv: ['01'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: null, appa: 3,
    remarks: 'Instructional labs/shops (code 210) are cleaned; Dept. shop (720), storage and server room are not.',
    prog: {
      '01': [['210', 3, 1500, 2100, ['ENGR', 'TECH'], { name: 'MFG / WELDING LAB', st: 75, cover: 'SC' }], ['215', 2, 200, 380, 'TECH', { name: 'TOOL CRIB' }], ['210', 2, 1000, 1300, 'ENGR', { name: 'ELECTRONICS / CAD LAB', st: 50, cover: 'VCT' }], ['720', 1, 900, 1100, 'TECH', { name: 'DEPT SHOP' }], ['730', 1, 600, 800, 'TECH'], ['W05', 1, 300, 380, ''], ['110', 2, 820, 1000, 'REG', { st: 20 }], ['310', 4, 115, 155, ['ENGR', 'TECH', 'CSCI']], ['710', 1, 340, 420, 'IT', { name: 'SERVER ROOM' }]],
    } },
  { no: '028', ab: 'UNI', name: 'Campus Union', sms: 'CAMPUS UNION', type: 'Student Center', yr: 1974, lv: ['B', '01', '02'], elev: true, freq: '7/wk (Sun-Sat)', sl: 'daily_7', cat: 'community', appa: 2,
    remarks: 'Bookstore and Food Court are auxiliary-operated and cleaned by the operators (Cust Svc = N). Ballroom set-ups not included.',
    prog: {
      B: [['660', 1, 4200, 4800, 'BKST', { name: 'BOOKSTORE', comment: 'Auxiliary - operator cleans' }], ['665', 1, 600, 800, 'BKST', { comment: 'Auxiliary - operator cleans' }], ['670', 1, 1800, 2200, 'UNION', { name: 'GAME ROOM' }], ['W05', 1, 380, 460, '']],
      '01': [['630', 1, 5200, 5900, 'DINE', { name: 'FOOD COURT SEATING', comment: 'Dining contractor cleans' }], ['635', 1, 2400, 2800, 'DINE', { name: 'SERVERY / KITCHEN', comment: 'Dining contractor cleans' }], ['650', 2, 900, 1400, 'UNION', { name: 'LOUNGE' }], ['310', 3, 120, 180, ['UNION', 'STUA', 'SGOV']], ['680', 1, 380, 480, 'UNION']],
      '02': [['610', 1, 5400, 6000, 'UNION', { name: 'NORTHWOODS BALLROOM' }], ['615', 1, 400, 520, 'UNION', { name: 'CHAIR / TABLE STORAGE' }], ['680', 4, 350, 720, 'UNION', { name: 'MEETING ROOM', st: 30 }], ['310', 3, 120, 170, ['STUA', 'MULT', 'CAREER']]],
    } },
  { no: '030', ab: 'OST', name: 'Ostrander Hall', sms: 'OSTRANDER HALL (HPE)', type: 'Physical Education & Recreation', yr: 1969, lv: ['01', '02'], elev: true, freq: '6/wk (M-Sa)', sl: 'daily_6', cat: 'fitness', appa: 2,
    remarks: 'Gym wood floor: dust mop nightly, no wet mopping; refinishing by others.',
    prog: {
      '01': [['520', 1, 11200, 12000, 'KINE', { name: 'MAIN GYMNASIUM' }], ['525', 2, 1400, 1800, 'KINE', { name: 'LOCKER ROOM', cover: 'CT' }], ['525', 1, 450, 600, 'KINE', { name: 'EQUIPMENT ISSUE', cover: 'VCT' }], ['310', 2, 120, 160, 'KINE']],
      '02': [['520', 1, 3200, 3700, 'REC', { name: 'FITNESS CENTER', cover: 'RB' }], ['520', 1, 1800, 2100, 'KINE', { name: 'DANCE / AEROBICS', cover: 'WD' }], ['110', 2, 760, 900, 'REG', { st: 20 }], ['310', 3, 115, 155, ['KINE', 'REC']]],
    } },
  { no: '032', ab: 'SSC', name: 'Student Services Center', sms: 'STUDENT SERVICES CENTER', type: 'Administration - Student Services', yr: 1994, lv: ['01'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'admin', appa: 2,
    remarks: '',
    prog: {
      '01': [['310', 1, 1500, 1800, 'REG', { name: 'ONE-STOP SERVICE AREA' }], ['310', 8, 115, 160, ['ADMS', 'REG', 'FAID', 'ADVS', 'CAREER']], ['650', 1, 520, 680, 'ADMS', { name: 'WAITING / LOBBY LOUNGE' }], ['315', 1, 120, 220, 'REG'], ['350', 1, 240, 340, 'ADVS'], ['220', 1, 600, 720, 'ADVS', { name: 'TESTING CENTER', st: 30 }]],
    } },
  { no: '035', ab: 'WEL', name: 'Wellness Center', sms: 'WELLNESS CENTER', type: 'Student Health Clinic & Counseling', yr: 2008, lv: ['01'], elev: false, freq: '5/wk (M-F)', sl: 'daily_5', cat: 'medical', appa: 2,
    remarks: 'Clinic exam rooms: bloodborne pathogen protocol per RFP 4.9.',
    prog: {
      '01': [['540', 5, 110, 150, 'HLTH', { name: 'EXAM ROOM' }], ['545', 2, 90, 220, 'HLTH', { name: 'LAB / MED STORAGE' }], ['310', 4, 110, 150, ['HLTH', 'CNSL']], ['650', 1, 380, 480, 'HLTH', { name: 'WAITING' }], ['350', 1, 220, 300, 'CNSL']],
    } },
  { no: '040', ab: 'PPL', name: 'Physical Plant', sms: 'PHYSICAL PLANT', type: 'Physical Plant / Shops', yr: 1965, lv: ['01'], elev: false, freq: '3/wk (M/W/F)', sl: '3x_week', cat: 'maintenance', appa: 3,
    remarks: 'Shops, storage and receiving are not cleaned (Cust Svc = N); offices, break room, locker room and rest rooms only.',
    prog: {
      '01': [['720', 3, 1400, 2400, 'FAC', { name: 'SHOP' }], ['730', 2, 1800, 2600, 'FAC', { name: 'WAREHOUSE' }], ['750', 1, 1200, 1500, 'FAC', { name: 'CENTRAL RECEIVING' }], ['W05', 1, 400, 520, ''], ['310', 3, 115, 165, 'FAC'], ['725', 1, 520, 640, 'FAC', { name: 'STAFF LOCKER ROOM', cover: 'CT' }], ['650', 1, 420, 520, 'FAC', { name: 'BREAK ROOM', cover: 'VCT' }]],
    } },
  { no: '041', ab: 'GFG', name: 'Grounds & Fleet Garage', sms: 'GROUNDS & FLEET GARAGE', type: 'Vehicle Maintenance Garage', yr: 1983, lv: ['01'], elev: false, freq: '1/wk (Wed)', sl: 'weekly', cat: 'maintenance', appa: 3,
    remarks: 'Vehicle bays and shop not cleaned; office, rest room and locker room only.',
    prog: {
      '01': [['740', 1, 4200, 4800, 'FAC', { name: 'VEHICLE BAYS' }], ['720', 1, 1100, 1300, 'FAC', { name: 'FLEET SHOP' }], ['310', 2, 120, 160, 'FAC'], ['725', 1, 260, 340, 'FAC', { name: 'LOCKER ROOM', cover: 'CT' }]],
    } },
  { no: '045', ab: 'EFS', name: 'Environmental Field Station', sms: 'ENVIRONMENTAL FIELD STATION', type: 'Instruction - Field Station', yr: 1997, lv: ['01'], elev: false, freq: '2/wk (T/Th)', sl: '2x_week', cat: null, appa: 3,
    rev: 'A1', deleted: true, site: 'Lake Annex',
    remarks: 'DELETED by Addendum No. 1 - Biology Dept. will clean. Rooms remain in C-2 (report not re-run).',
    prog: {
      '01': [['210', 2, 820, 980, 'ENVS', { name: 'FIELD LAB', st: 40, cover: 'SC' }], ['110', 1, 640, 760, 'ENVS', { st: 20 }], ['310', 2, 110, 140, 'ENVS'], ['730', 1, 300, 380, 'ENVS']],
    } },
  { no: '050', ab: 'CEW', name: 'Continuing Education & Workforce Center', sms: 'CONT ED & WORKFORCE CTR', type: 'Instruction (Leased)', yr: 2001, lv: ['01'], elev: false, freq: '6/wk (M-Sa)', sl: 'daily_6', cat: 'education', appa: 2,
    site: 'Downtown (leased)',
    remarks: 'Leased building, 418 Front Street, Pine Falls. Gross Sq Ft per lease exhibit. Saturday classes.',
    prog: {
      '01': [['110', 6, 700, 900, 'CEW', { st: 20 }], ['220', 2, 900, 1100, 'CEW', { name: 'COMPUTER LAB', st: 40 }], ['310', 4, 110, 150, 'CEW'], ['350', 1, 260, 340, 'CEW'], ['650', 1, 300, 420, 'CEW']],
    } },
];

// Buildings in the facilities inventory but not in the contract (C-1 Part B; no room data in C-2).
const NOT_IN_CONTRACT = [
  { no: '025', ab: 'HAG', name: 'Hagen Hall', type: 'Vacant (closed 05/2026)', yr: 1958, floors: 3, gross: 27880, asf: 17412, nonasg: 6106, inc: 'EXCLUDED', remarks: 'Vacant; scheduled for demolition summer 2027. Not cleaned.' },
  { no: '027', ab: 'STM', name: 'STEM Innovation Annex', type: 'Instruction - Labs (under construction)', yr: '2027 (est.)', floors: 2, gross: 38500, asf: 'TBD', nonasg: 'TBD', inc: 'OPTION 1', remarks: 'Under construction; substantial completion est. 12/2027. May be added by Option 1 at the proposed Cleanable Sq Ft unit price. Gross Sq Ft is design area; rooms not yet in SMS.' },
  { no: '060', ab: 'NRH', name: 'Nordahl Residence Hall', type: 'Residence Hall', yr: 1964, floors: 5, gross: 88640, asf: 56210, nonasg: 19870, inc: 'EXCLUDED', remarks: 'Auxiliary - Housing. Cleaned by Residence Life custodial staff.' },
  { no: '061', ab: 'SRH', name: 'Sorensen Residence Hall', type: 'Residence Hall', yr: 2015, floors: 4, gross: 102300, asf: 64980, nonasg: 22740, inc: 'EXCLUDED', remarks: 'Auxiliary - Housing. Cleaned by Residence Life custodial staff.' },
  { no: '062', ab: 'LSC', name: 'Lakeside Commons', type: 'Dining Hall', yr: 1965, floors: 2, gross: 31760, asf: 21430, nonasg: 6290, inc: 'EXCLUDED', remarks: 'Auxiliary - Dining. Cleaned by the food service contractor.' },
  { no: '070', ab: 'WAR', name: 'Wolf Arena', type: 'Athletics - Arena/Fieldhouse', yr: 1986, floors: 2, gross: 96450, asf: 70120, nonasg: 15880, inc: 'EXCLUDED', remarks: 'Athletics. Daily and event cleaning under separate contract (RFP TSU-26-031).' },
];

// ---------- room generation ----------
const NAMES_RR = [['WOMEN', 'MEN'], ['MEN', 'WOMEN']];
const levelNum = (lv) => (lv === 'B' ? 'B' : lv === 'M1' ? 'M' : String(Number(lv)));
function genRooms(b) {
  const rooms = [];
  const levels = [...b.lv, ...(b.mz ?? [])];
  const multi = b.lv.length > 1;
  for (const lv of levels) {
    const ln = levelNum(lv);
    let seq = lv === 'B' ? 1 : 1;
    const nextNo = (suffix = '') => {
      const n = seq++;
      if (lv === 'B') return `B${String(n).padStart(2, '0')}${suffix}`;
      if (lv === 'M1') return `M1${String(n).padStart(2, '0')}`;
      return `${ln}${String(n).padStart(2, '0')}${suffix}`;
    };
    const tenant = b.tenantLevel === lv;
    const add = (code, area, org, opts = {}) => {
      const [desc, cat] = USE[code];
      let cust = NOT_CLEANED.has(code) ? 'N' : 'Y';
      if (opts.cust) cust = opts.cust;
      if (tenant) cust = 'N';
      let st = '';
      if (opts.st) st = Math.max(1, Math.round(area / opts.st));
      rooms.push({ flr: lv, room: opts.room ?? nextNo(), name: opts.name ?? '', code, desc, cat, org: org ?? '', st, area, cover: opts.cover ?? pick(COVER[code]), cust, comment: opts.comment ?? (tenant ? 'Tenant (PFRMC) cleans' : '') });
    };
    let asgArea = 0;
    // assignable program; a lab-service room follows its lab with a letter suffix
    for (const [code, count, min, max, org, opts = {}] of b.prog[lv] ?? []) {
      for (let i = 0; i < count; i++) {
        const area = ri(min, max);
        asgArea += area;
        if ((code === '215' || code === '255') && rooms.length && rooms[rooms.length - 1].flr === lv && /^\d+$|^B\d+$/.test(String(rooms[rooms.length - 1].room)) && rnd() < 0.6) {
          add(code, area, pick(org), { ...opts, room: `${rooms[rooms.length - 1].room}A` });
        } else add(code, area, pick(org), opts);
      }
    }
    if (lv === 'M1') continue; // mezzanine: booths + mech only
    // non-assignable rooms: per level a corridor (two on large floors), two stairs in multi-level buildings,
    // rest rooms and a janitor room; per building one lobby, elevator, mechanical, electrical and IDF room.
    const nCorr = asgArea > 9000 ? 2 : 1;
    for (let i = 1; i <= nCorr; i++) add('W01', r5((asgArea * rf(0.14, 0.18)) / nCorr), '', { room: `${ln}C${String(i).padStart(2, '0')}` });
    if (lv === '01') add('W02', Math.min(900, Math.max(120, r5(asgArea * rf(0.04, 0.08)))), '', { room: `${ln}V01`, name: 'MAIN ENTRY' });
    if (multi) for (let i = 1; i <= 2; i++) add('W03', r5(rf(170, 250)), '', { room: `${ln}S${String(i).padStart(2, '0')}` });
    if (multi && b.elev && lv === '01') add('W04', ri(62, 84), '', { room: `${ln}E01`, name: 'ELEVATOR' });
    if (asgArea > 2500) { const nm = pick(NAMES_RR); add('X03', ri(170, 340), '', { name: nm[0] }); add('X03', ri(170, 340), '', { name: nm[1] }); }
    else add('X03', ri(60, 90), '', { name: 'ALL-GENDER' });
    add('X02', ri(38, 72), '', { name: 'JANITOR' });
    if (lv === b.lv[0]) {
      add('Y01', Math.min(1200, Math.max(150, r5(asgArea * rf(0.05, 0.09)))), '', { name: 'MECH' });
      add('Y02', ri(90, 170), '', { name: 'ELEC' });
      if (asgArea > 6000) add('X04', ri(80, 140), '', { name: 'TRASH / RECYCLING' });
      add('Y03', ri(48, 96), '', { name: 'IDF' });
    }
  }
  return rooms;
}

for (const b of B) {
  b.rooms = genRooms(b);
  b.asf = b.rooms.filter((r) => r.cat !== 'N').reduce((s, r) => s + r.area, 0);
  b.nonasg = b.rooms.filter((r) => r.cat === 'N').reduce((s, r) => s + r.area, 0);
  b.net = b.asf + b.nonasg;
  b.clean = b.rooms.filter((r) => r.cust === 'Y').reduce((s, r) => s + r.area, 0);
  b.gross = Math.round(b.net / rf(0.84, 0.9));
  if (b.grossCorrection) { b.grossOld = b.gross - b.grossCorrection; }
  b.floors = b.lv.length;
  b.covers = Object.fromEntries(COVERS.map((c) => [c, b.rooms.filter((r) => r.cust === 'Y' && r.cover === c).reduce((s, r) => s + r.area, 0)]));
}
for (const x of NOT_IN_CONTRACT) x.net = typeof x.asf === 'number' ? x.asf + x.nonasg : 'TBD';

const inc = B.filter((b) => !b.deleted);
const sum = (arr, k) => arr.reduce((s, x) => s + (typeof x[k] === 'number' ? x[k] : 0), 0);

// ---------- Notes tab ----------
const notes = [
  ['TAMARACK STATE UNIVERSITY'],
  ['Purchasing Services  |  1200 University Drive, Pine Falls, Minnesota'],
  ['RFP No. TSU-27-014  -  Custodial Services, Academic & Administrative Buildings'],
  ['ATTACHMENT C  -  SPACE INVENTORY (Building Summary, Room Data, Floor Coverings)'],
  ['Issued 09/18/2026  |  Revised 10/02/2026 (Addendum No. 1)'],
  [],
  ['Tab', 'Content'],
  ['Notes', 'These notes and the code legends'],
  ['C-1 Bldg Summary', 'Building Summary of Cleanable Space - one row per building; revised per Addendum No. 1'],
  ['C-2 Room Data', 'Room Inventory by Building (Cleanable Space Profile) - Space Management System report SPC-210, run 09/14/2026; NOT re-run after Addendum No. 1'],
  ['C-3 Floor Covering', 'Cleanable Sq Ft by floor covering, buildings included in the contract (revised per Addendum No. 1)'],
  [],
  ['GENERAL NOTES'],
  ['1.', 'Room data are exported from the University Space Management System (SMS) as of the Fall 2026 census date (09/08/2026). Room use codes follow the Postsecondary Education Facilities Inventory and Classification Manual (FICM, 2006 edition). Gross Sq Ft is taken from the University Facilities Inventory.'],
  ['2.', 'Room Net Area is measured to the inside face of walls and rounded to the whole square foot. Gross Sq Ft is measured to the outside face of exterior walls and includes walls, shafts and structure that are not roomed; it is therefore larger than the sum of the room areas.'],
  ['3.', 'Floor plans (PDF) for each building are available for review at Purchasing Services and will be shown at the mandatory pre-proposal walk-through on 10/08/2026. Proposers are responsible for verifying room areas and floor coverings during the walk-through.'],
  ['4.', 'Proposers shall price Attachment D (Price Schedule) on Cleanable Sq Ft (Attachment C-1, column K) for each included building at the service frequency in column M. Gross Sq Ft is provided for reference only.'],
  ['5.', 'Buildings not in the contract are listed on C-1 Part B for information only and have no room data in C-2: Nordahl and Sorensen Residence Halls and Lakeside Commons (Auxiliary Services - Housing and Dining), Wolf Arena (Athletics, separate contract), Hagen Hall (vacant), and the STEM Innovation Annex (under construction; Option 1).'],
  ['6.', 'Within included buildings the following spaces are Cust Svc = N and are not part of Cleanable Sq Ft: mechanical, electrical and telecom rooms (Y codes); janitor rooms and custodial supply closets (X01, X02); loading docks; 050/060 inactive and alteration areas; shops, central storage, vehicle storage, central service/receiving and server rooms (710-750); spaces cleaned by auxiliary operators or tenants (Campus Union bookstore and food court; Allied Health & Nursing 3rd floor).'],
  ['7.', 'Addendum No. 1 (10/02/2026) changes, reflected in C-1 and C-3 (marked "A1" in C-1 column O): (a) Bldg 045 Environmental Field Station is DELETED from the contract; (b) Bldg 019 Thorsen Hall Gross Sq Ft is corrected from ' + fmt(B.find((b) => b.no === '019').grossOld) + ' to ' + fmt(B.find((b) => b.no === '019').gross) + ' (Facilities Inventory error; room data unchanged); (c) Bldg 012 Elmore Library service frequency is changed from 6/wk (M-Sa) to 7/wk (Sun-Sat). Report SPC-210 (C-2) was not re-run; where C-2 differs from C-1, C-1 governs.'],
  ['8.', 'APPA Level (C-1 column N) is the target appearance level from APPA Custodial Staffing Guidelines: 2 = Ordinary Tidiness, 3 = Casual Inattention.'],
  ['9.', 'Service Frequency is the number of nights per week routine cleaning is performed, with the nights in parentheses (M-F = Monday through Friday; M-Sa = Monday through Saturday; Sun-Sat = every night). No service on the 11 University holidays listed in RFP Section 4.6. Frequencies apply year-round, including summer session and semester breaks.'],
  [],
  ['C-2 SPACE CATEGORY (column "Cat")'],
  ['A', 'Assignable (FICM 100-900 series)'],
  ['N', 'Non-assignable: W = circulation, X = building service, Y = mechanical'],
  ['U', 'Unclassified (FICM 000 series: 050 Inactive, 060 Alteration or Conversion); counted in Net Assignable Sq Ft on C-1'],
  [],
  ['FLOOR COVERING CODES (C-2 "Floor Cvrg", C-3 columns)'],
  ['CPT', 'Carpet, broadloom'], ['CPT-T', 'Carpet tile'], ['VCT', 'Vinyl composition tile'], ['LVT', 'Luxury vinyl tile'], ['SV', 'Sheet vinyl (welded seams)'],
  ['CT', 'Ceramic / porcelain tile'], ['QT', 'Quarry tile'], ['TZ', 'Terrazzo'], ['WD', 'Wood (sports floor / stage)'], ['RB', 'Rubber (stair treads, fitness flooring)'],
  ['SC', 'Sealed concrete'], ['EP', 'Epoxy / resinous'],
  [],
  ['ROOM USE CODES APPEARING IN C-2', 'Description', 'Cat', 'Default Cust Svc'],
  ...Object.entries(USE).filter(([c]) => B.some((b) => b.rooms.some((r) => r.code === c))).sort(([a], [b]) => (a < b ? -1 : 1)).map(([c, [d, cat]]) => [c, d, cat, NOT_CLEANED.has(c) ? 'N' : 'Y']),
];

// ---------- C-1 Building Summary ----------
const c1Header = ['Bldg. No.', 'Abbr.', 'Building Name', 'Type of Building', 'No. of Floors (1)', 'Year Built', 'Gross Sq Ft (2)', 'Net Assignable Sq Ft (3)', 'Non-Assignable Sq Ft (3)', 'Room Total Net Sq Ft (4)', 'Cleanable Sq Ft (5)', 'Include / Excluded', 'Service Frequency (6)', 'APPA Level', 'Rev.', 'Site', 'Remarks'];
const W = c1Header.length;
const padRow = (r) => [...r, ...Array(Math.max(0, W - r.length)).fill('')];
const c1 = [
  ['TAMARACK STATE UNIVERSITY  -  PURCHASING SERVICES'],
  ['RFP No. TSU-27-014  Custodial Services - Academic & Administrative Buildings'],
  ['ATTACHMENT C-1  -  BUILDING SUMMARY OF CLEANABLE SPACE  (Revised 10/02/2026 per Addendum No. 1)'],
  ['Gross Sq Ft from the University Facilities Inventory; room areas from Space Management System report SPC-210 (Attachment C-2). See footnotes below and the Notes tab.'],
  [],
  padRow(['BUILDING', '', '', '', '', '', 'AREA (SQ FT)', '', '', '', '', 'CONTRACT']),
  c1Header,
  ['A. BUILDINGS IN RFP SCOPE'],
];
const c1Merges = ['A1:Q1', 'A2:Q2', 'A3:Q3', 'A4:Q4', 'A6:F6', 'G6:K6', 'L6:P6', 'A8:Q8'];
for (const b of B) {
  c1.push([b.no, b.ab, b.name, b.type, b.floors, b.yr, b.gross, b.asf, b.nonasg, b.net, b.clean, b.deleted ? 'DELETED (Add. 1)' : 'INCLUDE', b.freq, b.appa, b.rev ?? '', b.site ?? 'Main', b.no === '019' ? `Gross Sq Ft corrected by Addendum No. 1 (was ${fmt(b.grossOld)}); room data unchanged.` : b.remarks]);
}
c1.push(padRow([`Total - Buildings Included (${inc.length}; excludes 045)`, '', '', '', '', '', sum(inc, 'gross'), sum(inc, 'asf'), sum(inc, 'nonasg'), sum(inc, 'net'), sum(inc, 'clean')]));
c1Merges.push(`A${c1.length}:F${c1.length}`);
c1.push([]);
c1.push(['B. BUILDINGS NOT IN CONTRACT (listed for information only - no room data in C-2)']);
c1Merges.push(`A${c1.length}:Q${c1.length}`);
for (const x of NOT_IN_CONTRACT) c1.push([x.no, x.ab, x.name, x.type, x.floors, x.yr, x.gross, x.asf, x.nonasg, x.net, 'n/a', x.inc, '-', '', '', 'Main', x.remarks]);
c1.push(padRow([`Total - Buildings Not in Contract (${NOT_IN_CONTRACT.length})`, '', '', '', '', '', sum(NOT_IN_CONTRACT, 'gross'), sum(NOT_IN_CONTRACT, 'asf'), sum(NOT_IN_CONTRACT, 'nonasg'), sum(NOT_IN_CONTRACT, 'net')]));
c1Merges.push(`A${c1.length}:F${c1.length}`);
c1.push([]);
const all = [...B, ...NOT_IN_CONTRACT];
c1.push(padRow([`TOTAL - ALL BUILDINGS LISTED (${all.length})`, '', '', '', '', '', sum(all, 'gross'), sum(all, 'asf'), sum(all, 'nonasg'), sum(all, 'net')]));
c1Merges.push(`A${c1.length}:F${c1.length}`);
c1.push([]);
const foot = [
  '(1) No. of Floors = floor levels including basement (B). Mezzanines (M1) and roof penthouses are not counted.',
  '(2) Gross Sq Ft from the University Facilities Inventory, measured to the outside face of exterior walls. Not the sum of room areas. 027 = design area.',
  '(3) Net Assignable = rooms with FICM use codes 100-900 plus 050/060 unclassified (C-2 Cat A and U); Non-Assignable = circulation (W), building service (X) and mechanical (Y) rooms (C-2 Cat N).',
  '(4) Room Total Net Sq Ft = Net Assignable + Non-Assignable = sum of Net Area of all rooms of the building in Attachment C-2.',
  '(5) Cleanable Sq Ft = sum of Net Area of rooms with Cust Svc = "Y" in Attachment C-2. Price Attachment D on this figure.',
  '(6) Nights per week of routine cleaning, nights in parentheses. Year-round; no service on University holidays (RFP 4.6).',
  'Totals: Part B and the all-buildings total include figures for buildings that are not in the contract; 027 (TBD) is not included in the net area totals.',
];
for (const f of foot) { c1.push([f]); c1Merges.push(`A${c1.length}:Q${c1.length}`); }

// ---------- C-2 Room Data (report export with page headers) ----------
const c2Header = ['Bldg', 'Bldg Name', 'Flr', 'Room', 'Room Name', 'Use Code', 'Use Description', 'Cat', 'Org', 'Stations', 'Net Area (SF)', 'Floor Cvrg', 'Cust Svc', 'Comments'];
const lines = []; // logical lines: { kind, row, bldg }
for (const b of B) {
  const g = b.grossOld ?? b.gross;
  lines.push({ kind: 'group', bldg: b, row: [`BLDG ${b.no}  ${b.sms} (${b.ab})  -  Gross Area ${fmt(g)} SF  -  ${b.floors} floor${b.floors > 1 ? 's' : ''}${b.mz ? ' + mezz.' : ''}  -  ${b.site ?? 'Main Campus'}`] });
  for (const r of b.rooms) lines.push({ kind: 'room', bldg: b, row: [b.no, b.sms, r.flr, r.room, r.name, r.code, r.desc, r.cat, r.org, r.st, r.area, r.cover, r.cust, r.comment] });
  lines.push({ kind: 'foot', bldg: b, row: [`Total Bldg ${b.no} (all rooms)`, '', '', `${b.rooms.length} rooms`, '', '', '', '', '', '', b.net] });
  const yN = b.rooms.filter((r) => r.cust === 'Y').length;
  lines.push({ kind: 'foot', bldg: b, row: [`Total Bldg ${b.no} (Cust Svc = Y)`, '', '', `${yN} rooms`, '', '', '', '', '', '', b.clean] });
  lines.push({ kind: 'blank', bldg: b, row: [] });
}
const nRooms = B.reduce((s, b) => s + b.rooms.length, 0);
const nY = B.reduce((s, b) => s + b.rooms.filter((r) => r.cust === 'Y').length, 0);
lines.push({ kind: 'foot', row: [`REPORT TOTAL - ${B.length} buildings (all rooms)`, '', '', `${nRooms} rooms`, '', '', '', '', '', '', sum(B, 'net')] });
lines.push({ kind: 'foot', row: [`REPORT TOTAL - ${B.length} buildings (Cust Svc = Y)`, '', '', `${nY} rooms`, '', '', '', '', '', '', sum(B, 'clean')] });
lines.push({ kind: 'blank', row: [] });
lines.push({ kind: 'foot', row: ['*** End of report SPC-210 ***'] });

const PAGE = 60; // printed lines per page, including the page header block
const firstHdr = (n) => [
  ['TAMARACK STATE UNIVERSITY'],
  ['Facilities Planning & Space Management  -  Space Management System Report SPC-210: Room Inventory by Building'],
  ['RFP No. TSU-27-014 Custodial Services  -  ATTACHMENT C-2, ROOM DATA (CLEANABLE SPACE PROFILE)'],
  ['Run date 09/14/2026 07:42   Data as of Fall 2026 census (09/08/2026)   Sort: Bldg, Flr, Room   Selection: Bldg list for RFP TSU-27-014 (draft scope 09/11/2026)'],
  ['NOTE (Purchasing Services, 10/02/2026): This report was run before Addendum No. 1 and has not been re-run. Addendum No. 1 deleted Bldg 045 and corrected the Gross Area of Bldg 019. Where this tab differs from Attachment C-1, C-1 governs.'],
  [`Page 1 of ${n}`],
  c2Header,
];
const contHdr = (k, n) => [
  [],
  ['TAMARACK STATE UNIVERSITY  -  SPC-210 Room Inventory by Building  -  RFP TSU-27-014 Attachment C-2 (continued)'],
  [`Page ${k} of ${n}`],
  c2Header,
];
function paginate(n) {
  const out = []; const merges = []; let page = 1;
  const push = (r) => out.push(r);
  for (const r of firstHdr(n)) push(r);
  let used = 7;
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (used >= PAGE) {
      page++;
      for (const r of contHdr(page, n)) push(r);
      used = 4;
      if (ln.kind !== 'group' && ln.bldg && ln.kind !== 'blank') { push([`BLDG ${ln.bldg.no}  ${ln.bldg.sms} (${ln.bldg.ab})  (continued)`]); used++; }
      if (ln.kind === 'blank') { i++; continue; }
    }
    push(ln.row); used++; i++;
  }
  return { out, pages: page };
}
let pg = paginate(1);
pg = paginate(pg.pages);
const c2 = pg.out;
const c2Merges = [];
c2.forEach((r, idx) => { if (r.length === 1 && r[0]) c2Merges.push(`A${idx + 1}:N${idx + 1}`); });

// ---------- C-3 Floor covering ----------
const C3COV = COVERS.filter((c) => inc.some((b) => b.covers[c] > 0)); // pivot shows only coverings present
const c3 = [
  ['TAMARACK STATE UNIVERSITY  -  RFP No. TSU-27-014 Custodial Services'],
  ['ATTACHMENT C-3  -  CLEANABLE SQ FT BY FLOOR COVERING, BUILDINGS INCLUDED  (Revised 10/02/2026 per Addendum No. 1)'],
  ['Rooms with Cust Svc = Y in Attachment C-2, summed by floor covering code (see Notes tab for codes). Row total = C-1 Cleanable Sq Ft.'],
  [],
  ['Bldg. No.', 'Abbr.', 'Building Name', ...C3COV, 'Total Cleanable Sq Ft'],
];
for (const b of inc) c3.push([b.no, b.ab, b.name, ...C3COV.map((c) => b.covers[c] || ''), b.clean]);
c3.push(['TOTAL', '', `${inc.length} buildings`, ...C3COV.map((c) => inc.reduce((s, b) => s + b.covers[c], 0)), sum(inc, 'clean')]);
const c3Last = String.fromCharCode(65 + 3 + C3COV.length);
const c3Merges = [`A1:${c3Last}1`, `A2:${c3Last}2`, `A3:${c3Last}3`];

const nf = '#,##0';
const workbook = {
  sheets: [
    { name: 'Notes', rows: notes, merges: ['A1:D1', 'A2:D2', 'A3:D3', 'A4:D4', 'A5:D5'] },
    { name: 'C-1 Bldg Summary', rows: c1, merges: c1Merges, numFmt: [null, null, null, null, null, null, nf, nf, nf, nf, nf] },
    { name: 'C-2 Room Data', rows: c2, merges: c2Merges, numFmt: [null, null, null, null, null, null, null, null, null, null, nf] },
    { name: 'C-3 Floor Covering', rows: c3, merges: c3Merges, numFmt: [null, null, null, ...C3COV.map(() => nf), nf] },
  ],
};
fs.writeFileSync(path.join(here, 'attachment-c-space-inventory.json'), JSON.stringify(workbook, null, 1) + '\n');

// ---------- truth facilities ----------
const facilities = inc.map((b) => {
  const f = { buildingNumber: b.no, name: b.name, grossSqft: b.gross, cleanableSqft: b.clean, floors: b.floors, serviceLevel: b.sl };
  if (b.cat) f.category = b.cat;
  return f;
});
const truthPath = path.join(here, 'truth.json');
if (fs.existsSync(truthPath)) {
  const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  truth.expect.facilities = facilities;
  fs.writeFileSync(truthPath, JSON.stringify(truth, null, 2) + '\n');
}
const summary = {
  buildingsInC2: B.length, rooms: nRooms, roomsY: nY, c2Rows: c2.length, c2Pages: pg.pages,
  included: inc.length, grossIncluded: sum(inc, 'gross'), cleanIncluded: sum(inc, 'clean'), netIncluded: sum(inc, 'net'),
  grossAll: sum(all, 'gross'), c1Rows: c1.length,
};
console.log(JSON.stringify(summary));
for (const b of B) console.log(b.no, b.ab.padEnd(4), String(b.rooms.length).padStart(3), 'gross', b.gross, b.grossOld ?? '', 'net', b.net, 'asf', b.asf, 'clean', b.clean, (b.clean / b.gross).toFixed(2), b.deleted ? 'DELETED' : '');
