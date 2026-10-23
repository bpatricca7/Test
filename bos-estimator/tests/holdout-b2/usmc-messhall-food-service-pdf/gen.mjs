#!/usr/bin/env node
// Deterministic generator for the usmc-messhall-food-service-pdf holdout fixture.
//   cd bos-estimator && node tests/holdout-b2/usmc-messhall-food-service-pdf/gen.mjs
// Writes m67443-27-r-0019-att-j2.html (rendered to PDF by scripts/render-fixtures.mjs) and replaces
// expect.facilities in truth.json. Every TE-1 / TE-3 / TE-4 figure, subtotal and total, and every Amendment 0001
// figure, is computed from the one table below, so the document and the truth always reconcile.
// No randomness: historical (TE-4) figures use fixed per-row factors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => n.toLocaleString('en-US');
const dash = '&mdash;';

// ------------------------------------------------------------------------------------------------------------
// Facility table. status: in = in scope; closed = closed for renovation; option = optional line item only;
// deleted = in the original exhibit, deleted by Amendment 0001.
// wk = Monday-Friday average headcount per meal period {B, L, D, M (Midrats)}.
// we = Saturday/Sunday/holiday average headcount per meal period {B, Br (brunch), L, S (supper/dinner), M}.
// weDays = weekend/holiday days open per typical week (2 = Sat+Sun, 1 = Saturday only, 0 = closed weekends).
// amend = Amendment 0001 replacement values (applied to the truth, printed in the amendment pages).
// hist = TE-4 factors [FY24, FY25, FY26 9-month] applied to the weekly meals (see histFor()).
// ------------------------------------------------------------------------------------------------------------
const G_MAIN = 'MARINE CORPS BASE CAMP HALLORAN &ndash; MAINSIDE';
const G_TC = 'MARINE CORPS BASE CAMP HALLORAN &ndash; TARRANT CREEK';
const G_OB = 'MARINE CORPS BASE CAMP HALLORAN &ndash; OYSTER BAY';
const G_W = 'MARINE CORPS BASE CAMP HALLORAN &ndash; CAMP WHITLOCK';
const G_D = 'MARINE CORPS BASE CAMP HALLORAN &ndash; CAMP DUNNING';
const G_SP = 'MARINE CORPS BASE CAMP HALLORAN &ndash; SHELL POINT RANGE COMPLEX';
const G_AS = 'MARINE CORPS AIR STATION PELL RIVER';

const F = [
  { item: 1, inst: 'MCB', grp: G_MAIN, bn: '211', name: 'Mess Hall 211', area: 'Mainside', type: 'FFS', yr: '1972 /<br>2009', floors: 1, seats: 520, gross: 31480, sanit: 27915, dining: 9860, days: '7', status: 'in',
    remarks: '', wk: { B: 385, L: 760, D: 410 }, we: { Br: 330, S: 270 }, weDays: 2,
    hrs: { wk: ['0530&ndash;0800', '1100&ndash;1300', '1630&ndash;1830', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [0.97, 1.01, 0.99] },
  { item: 2, inst: 'MCB', grp: G_MAIN, bn: '227', name: 'Mess Hall 227', area: 'Mainside', type: 'FFS', yr: '1984 /<br>2016', floors: 2, seats: 860, gross: 23460, sanit: 20690, dining: 15240, days: '7', status: 'in',
    remarks: 'Two service floors, two kitchens. Midrats 7 days.', wk: { B: 540, L: 1180, D: 610, M: 150 }, we: { Br: 470, S: 390, M: 95 }, weDays: 2,
    amend: { gross: 46920, sanit: 41380 },
    hrs: { wk: ['0530&ndash;0800', '1030&ndash;1300', '1630&ndash;1830', '2300&ndash;0100'], we: [null, '0830&ndash;1230', null, '1630&ndash;1830', '2300&ndash;0100'] }, hist: [1.03, 0.98, 1.0] },
  { item: 3, inst: 'MCB', grp: G_MAIN, bn: '260', name: 'Mess Hall 260 (Headquarters and Support Battalion)', area: 'Mainside', type: 'M&amp;MA', yr: '1966 /<br>2011', floors: 1, seats: 280, gross: 18250, sanit: 15970, dining: 5420, days: 'M&ndash;F', status: 'in',
    remarks: 'Closed weekends and holidays.', wk: { B: 140, L: 365, D: 120 }, we: null, weDays: 0,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1800', null], we: null }, hist: [0.95, 1.0, 1.02] },
  { item: 4, inst: 'MCB', grp: G_MAIN, bn: '408', name: 'Mess Hall 408', area: 'Mainside', type: 'FFS', yr: '1979 /<br>2014', floors: 1, seats: 450, gross: 26940, sanit: 23780, dining: 8350, days: '7', status: 'in',
    remarks: '', wk: { B: 310, L: 645, D: 355 }, we: { Br: 285, S: 230 }, weDays: 2,
    hrs: { wk: ['0530&ndash;0800', '1100&ndash;1300', '1630&ndash;1830', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [1.04, 0.99, 0.97] },
  { item: 5, inst: 'MCB', grp: G_MAIN, bn: '1104', name: 'Wolf Creek Mess Hall', area: 'Mainside (Wolf Creek barracks complex)', type: 'FFS', yr: '2010', floors: 1, seats: 650, gross: 38640, sanit: 34210, dining: 12100, days: '7', status: 'in',
    remarks: '', wk: { B: 470, L: 980, D: 540 }, we: { Br: 420, S: 345 }, weDays: 2,
    hrs: { wk: ['0530&ndash;0800', '1100&ndash;1315', '1630&ndash;1830', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [0.82, 1.0, 1.01], histNote: 'FY24 reflects 2d Bn unit deployment, Feb&ndash;Aug 2024.' },
  { item: 6, inst: 'MCB', grp: G_TC, bn: 'TC-303', name: 'Tarrant Creek Mess Hall 303', area: 'Tarrant Creek', type: 'M&amp;MA', yr: '1968 /<br>2006', floors: 1, seats: 410, gross: 24860, sanit: 21940, dining: 7780, days: 'M&ndash;F', status: 'in',
    remarks: 'Closed weekends and holidays.', wk: { B: 210, L: 520, D: 190 }, we: null, weDays: 0,
    hrs: { wk: ['0600&ndash;0830', '1100&ndash;1300', '1630&ndash;1830', null], we: null }, hist: [1.0, 0.97, 1.03] },
  { item: 7, inst: 'MCB', grp: G_TC, bn: 'TC-410', name: 'Tarrant Creek Mess Hall 410', area: 'Tarrant Creek', type: '(FFS)', yr: '1987', floors: 1, seats: 500, gross: 29700, sanit: null, dining: 9150, days: 'CLOSED<sup>5</sup>', status: 'closed',
    remarks: 'Closed for renovation since 5 Jan 2026. No workload. Not included in totals.', histWeekly: 6900, hist: [1.0, 0.98, null], histNote: 'Closed 5 Jan 2026 (FY26 = Oct&ndash;Dec 2025 only).' },
  { item: 8, inst: 'MCB', grp: G_TC, bn: 'TC-575', name: 'Tarrant Creek Mess Hall 575', area: 'Tarrant Creek', type: 'FFS', yr: '2012', floors: 1, seats: 600, gross: 35410, sanit: 31265, dining: 11050, days: '7', status: 'in',
    remarks: 'Feeds TC-410 diners since 5 Jan 2026.', wk: { B: 365, L: 830, D: 445 }, we: { Br: 350, S: 285 }, weDays: 2,
    hrs: { wk: ['0530&ndash;0800', '1100&ndash;1300', '1630&ndash;1830', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, histPreWeekly: 6600, hist: [0.99, 1.0, 0.99], histNote: 'Receiving TC-410 diners from 5 Jan 2026.' },
  { item: 9, inst: 'MCB', grp: G_OB, bn: 'OB-160', name: 'Oyster Bay Mess Hall', area: 'Oyster Bay', type: 'FFS', yr: '1979 /<br>2015', floors: 1, seats: 330, gross: 21330, sanit: 18870, dining: 6480, days: '7', status: 'in',
    remarks: '', wk: { B: 190, L: 415, D: 215 }, we: { Br: 160, S: 125 }, weDays: 2,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1800', null], we: [null, '0900&ndash;1200', null, '1630&ndash;1800', null] }, hist: [0.96, 1.02, 0.98] },
  { item: 10, inst: 'MCB', grp: G_W, bn: 'W-48', name: 'Camp Whitlock Mess Hall 48', area: 'Camp Whitlock', type: 'FFS', yr: '1992', floors: 1, seats: 380, gross: 22615, sanit: 19940, dining: 7060, days: '7', status: 'in',
    remarks: '', wk: { B: 255, L: 470, D: 280 }, we: { Br: 230, S: 180 }, weDays: 2,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1800', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [1.01, 0.99, 1.0] },
  { item: 11, inst: 'MCB', grp: G_W, bn: 'W-133', name: 'Camp Whitlock Schools Mess Hall', area: 'Camp Whitlock (Combat Service Support Schools)', type: 'FFS', yr: '1990 /<br>2018', floors: 1, seats: 450, gross: 27560, sanit: 24410, dining: 8920, days: 'M&ndash;Sa', status: 'in',
    remarks: 'Saturday brunch and supper only; closed Sundays and holidays.', wk: { B: 340, L: 690, D: 395 }, we: { Br: 260, S: 195 }, weDays: 1,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1830', null], we: [null, '0900&ndash;1230 (Sat)', null, '1630&ndash;1800 (Sat)', null] }, hist: [0.97, 1.0, 1.03] },
  { item: 12, inst: 'MCB', grp: G_D, bn: 'D-301', name: 'Mess Hall 301 (Marine Combat Training Battalion)', area: 'Camp Dunning', type: 'FFS', yr: '2001', floors: 1, seats: 560, gross: 33180, sanit: 29350, dining: 10240, days: '7', status: 'in',
    remarks: 'Training schedule: breakfast, lunch and dinner 7 days.', wk: { B: 480, L: 505, D: 495 }, we: { B: 455, L: 470, S: 460 }, weDays: 2,
    hrs: { wk: ['0500&ndash;0700', '1100&ndash;1300', '1630&ndash;1830', null], we: ['0600&ndash;0800', null, '1100&ndash;1300', '1630&ndash;1830', null] }, hist: [0.94, 1.02, 0.99] },
  { item: 13, inst: 'MCB', grp: G_D, bn: 'D-450', name: 'Mess Hall 450 (Infantry Training Battalion)', area: 'Camp Dunning', type: 'FFS', yr: '2005', floors: 1, seats: 720, gross: 42180, sanit: 37250, dining: 13600, days: '7', status: 'in',
    remarks: 'Training schedule: breakfast, lunch and dinner 7 days.', wk: { B: 610, L: 655, D: 630 }, we: { B: 585, L: 600, S: 590 }, weDays: 2,
    amend: { wk: { B: 845, L: 905, D: 870 }, we: { B: 810, L: 830, S: 815 } },
    hrs: { wk: ['0500&ndash;0700', '1100&ndash;1300', '1630&ndash;1830', null], we: ['0600&ndash;0800', null, '1100&ndash;1300', '1630&ndash;1830', null] }, hist: [1.0, 0.98, 1.01] },
  { item: 14, inst: 'MCB', grp: G_D, bn: 'D-512', name: 'Mess Hall 512', area: 'Camp Dunning', type: 'FFS', yr: '1974 /<br>2003', floors: 1, seats: 400, gross: 23940, sanit: 21050, dining: 7320, days: '7', status: 'deleted',
    remarks: 'Training schedule: breakfast, lunch and dinner 7 days.', wk: { B: 240, L: 255, D: 245 }, we: { B: 225, L: 230, S: 225 }, weDays: 2,
    hrs: { wk: ['0500&ndash;0700', '1100&ndash;1300', '1630&ndash;1830', null], we: ['0600&ndash;0800', null, '1100&ndash;1300', '1630&ndash;1830', null] }, hist: [1.02, 0.99, 0.97] },
  { item: 15, inst: 'MCB', grp: G_D, bn: 'D-615', name: 'Mess Hall 615', area: 'Camp Dunning', type: 'M&amp;MA', yr: '1983 /<br>2012', floors: 1, seats: 300, gross: 19880, sanit: 17420, dining: 5760, days: '7', status: 'in',
    remarks: '', wk: { B: 175, L: 340, D: 190 }, we: { Br: 150, S: 120 }, weDays: 2,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1800', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [0.98, 1.0, 1.0] },
  { item: 16, inst: 'MCB', grp: G_D, bn: 'D-1720', name: 'Camp Dunning Mess Hall (New), MILCON P-1312', area: 'Camp Dunning', type: '(FFS)', yr: '(2029)', floors: 1, seats: 800, gross: 48500, sanit: null, dining: 15900, days: 'OPTION<sup>6</sup>', status: 'option',
    remarks: 'Optional line item only. BOD est. 2d Qtr FY 2029. Not included in totals.' },
  { item: 17, inst: 'MCB', grp: G_SP, bn: 'SP-24', name: 'Shell Point Range Satellite', area: 'Shell Point Range Complex', type: 'SAT', yr: '1996', floors: 1, seats: 90, gross: 4850, sanit: 4310, dining: 1620, days: 'M&ndash;F', status: 'in',
    remarks: 'Parent mess hall D-301.<sup>7</sup> Closed weekends and holidays.', wk: { B: 95, D: 110 }, we: null, weDays: 0, lunchNS: true,
    hrs: { wk: ['0500&ndash;0630', 'N/S', '1700&ndash;1830', null], we: null }, hist: [1.08, 0.93, 1.0], histNote: 'FY25 reflects range closure for repairs, Apr&ndash;May 2025.' },
  { item: 18, inst: 'AS', grp: G_AS, bn: 'AS-4150', name: 'Pell River Mess Hall', area: 'MCAS Pell River', type: 'FFS', yr: '1998 /<br>2019', floors: 1, seats: 560, gross: 33720, sanit: 29860, dining: 10480, days: '7', status: 'in',
    remarks: 'Midrats 7 days (flight line night shifts).', wk: { B: 330, L: 815, D: 400, M: 210 }, we: { Br: 290, S: 240, M: 140 }, weDays: 2,
    hrs: { wk: ['0530&ndash;0800', '1030&ndash;1300', '1630&ndash;1900', '2300&ndash;0100'], we: [null, '0830&ndash;1230', null, '1630&ndash;1830', '2300&ndash;0100'] }, hist: [0.99, 1.01, 1.02] },
  { item: 19, inst: 'AS', grp: G_AS, bn: 'AS-219', name: 'Flight Line Satellite', area: 'MCAS Pell River (Hangar Row)', type: 'SAT', yr: '1987 /<br>2024', floors: 1, seats: 72, gross: 4260, sanit: 3790, dining: 1380, days: 'M&ndash;F', status: 'in',
    remarks: 'Parent mess hall AS-4150.<sup>7</sup> Lunch and Midrats only.', wk: { L: 240, M: 85 }, we: null, weDays: 0,
    hrs: { wk: ['N/S', '1100&ndash;1300', 'N/S', '2330&ndash;0100'], we: null }, hist: [null, 0.95, 1.0], histNote: 'Opened 3 Feb 2025 (FY25 = 34 weeks).' },
  { item: 20, inst: 'AS', grp: G_AS, bn: 'AS-505', name: 'Mess Hall AS-505', area: 'MCAS Pell River', type: 'M&amp;MA', yr: '1985 /<br>2013', floors: 1, seats: 340, gross: 20540, sanit: 18135, dining: 6150, days: '7', status: 'in',
    remarks: '', wk: { B: 160, L: 390, D: 205 }, we: { Br: 140, S: 115 }, weDays: 2,
    hrs: { wk: ['0600&ndash;0800', '1100&ndash;1300', '1630&ndash;1800', null], we: [null, '0900&ndash;1230', null, '1630&ndash;1800', null] }, hist: [1.0, 0.98, 0.99] },
];
// Projected headcount for the optional line item (D-1720), TE-3A.
const OPT = { wk: { B: 780, L: 840, D: 805 }, we: { B: 750, L: 770, S: 760 }, weDays: 2 };

const WK = ['B', 'L', 'D', 'M'];
const WE = ['B', 'Br', 'L', 'S', 'M'];
const sum = (o, keys) => (o ? keys.reduce((s, k) => s + (o[k] || 0), 0) : 0);
const wkTot = (f) => sum(f.wk, WK);
const weTot = (f) => sum(f.we, WE);
const weekly = (f) => 5 * wkTot(f) + f.weDays * weTot(f);
const daysPerWeek = (f) => 5 + f.weDays;
const withAmend = (f) => (f.amend ? { ...f, ...f.amend } : f);

const orig = F.filter((f) => f.status === 'in' || f.status === 'deleted'); // in scope as originally issued
const final = F.filter((f) => f.status === 'in').map(withAmend); // in scope after Amendment 0001

// ---------- TE-4 historical meals served (fixed factors, no randomness) ----------
function histFor(f) {
  const base = f.histWeekly ?? weekly(f);
  const pre = f.histPreWeekly ?? base;
  const [a, b, c] = f.hist;
  const wob = (n, k) => n + ((f.item * 37 + k * 11) % 23); // small fixed wobble so figures are not round
  const fy24 = a == null ? null : wob(Math.round(pre * 52 * a), 1);
  let fy25 = b == null ? null : wob(Math.round(pre * 52 * b), 2);
  if (f.bn === 'AS-219') fy25 = wob(Math.round(base * 34 * b), 2);
  let fy26;
  if (f.status === 'closed') fy26 = wob(Math.round(base * 13 * 0.99), 3);
  else if (f.histPreWeekly) fy26 = wob(Math.round(pre * 13 + base * 26 * c), 3);
  else fy26 = wob(Math.round(base * 39 * c), 3);
  return [fy24, fy25, fy26];
}

// ---------- totals ----------
const tot = (rows, fn) => rows.reduce((s, f) => s + (fn(f) || 0), 0);
const te1Tot = (rows) => ({ n: rows.length, mh: rows.filter((f) => f.type !== 'SAT').length, sat: rows.filter((f) => f.type === 'SAT').length, seats: tot(rows, (f) => f.seats), gross: tot(rows, (f) => f.gross), sanit: tot(rows, (f) => f.sanit), dining: tot(rows, (f) => f.dining) });
const te3Tot = (rows) => {
  const o = { wk: {}, we: {} };
  for (const k of WK) o.wk[k] = tot(rows, (f) => f.wk?.[k]);
  for (const k of WE) o.we[k] = tot(rows, (f) => f.we?.[k]);
  o.wkT = tot(rows, wkTot); o.weT = tot(rows, weTot); o.weekly = tot(rows, weekly);
  return o;
};

// ---------- HTML pieces ----------
const SOL = 'M67443-27-R-0019';
const RH = (right) => `<div class="rh"><span>Solicitation No. ${SOL} &nbsp;|&nbsp; Garrison Food Service &ndash; MCB Camp Halloran and MCAS Pell River, NC</span><span class="rr">${right}</span></div>`;
const RF = (mid) => `<div class="rf"><span>Attachment J-2 &nbsp;(9 November 2026)</span><span>${mid}</span><span>RCO Camp Halloran</span></div>`;
const RHA = (right) => `<div class="rh"><span>Amendment 0001 to Solicitation No. ${SOL} &nbsp;|&nbsp; Garrison Food Service</span><span class="rr">${right}</span></div>`;
const RFA = (mid) => `<div class="rf"><span>Amendment 0001 &nbsp;(18 December 2026)</span><span>${mid}</span><span>SF 30 Continuation Sheet</span></div>`;
const n = (v) => (v == null ? dash : fmt(v));
const cg = (w) => `<colgroup>${w.map((x) => `<col style="width:${x}%">`).join('')}</colgroup>`;
const hc = (o, k) => (o && o[k] ? fmt(o[k]) : dash);

// TE-1
const TE1_HEAD = `${cg([3.2, 5.8, 16.5, 11, 4.8, 5.8, 4.2, 7.2, 7.6, 6.6, 4.8, 5.4, 17.1])}
<thead>
<tr><th colspan="5" class="g">FACILITY IDENTIFICATION</th><th colspan="3" class="g">REAL PROPERTY DATA &ndash; iNFADS, 30 JUN 2026</th><th colspan="4" class="g">CONTRACT DATA</th><th rowspan="2">Remarks</th></tr>
<tr><th>Item</th><th>Bldg<br>No.</th><th>Mess Hall</th><th>Area</th><th>Svc<br>Type</th><th>Year<br>Built /<br>Renov.</th><th>Floors</th><th>Gross<br>SF<sup>1</sup></th><th>Sanitation<br>Area SF<sup>2</sup></th><th>Dining<br>Room SF<sup>3</sup></th><th>Seats</th><th>Days of<br>Opn<sup>4</sup></th></tr>
<tr class="colno"><td>(1)</td><td>(2)</td><td>(3)</td><td>(4)</td><td>(5)</td><td>(6)</td><td>(7)</td><td>(8)</td><td>(9)</td><td>(10)</td><td>(11)</td><td>(12)</td><td>(13)</td></tr>
</thead>`;
function te1Row(f) {
  const par = f.status === 'closed' || f.status === 'option';
  const p = (v) => (par ? `(${fmt(v)})` : fmt(v));
  return `<tr${par ? ' class="na"' : ''}><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="sm">${f.area}</td><td class="c">${f.type}</td><td class="c sm">${f.yr}</td><td class="c">${f.floors}</td><td class="num">${p(f.gross)}</td><td class="num">${f.sanit == null ? dash : fmt(f.sanit)}</td><td class="num">${p(f.dining)}</td><td class="num">${p(f.seats)}</td><td class="c">${f.days}</td><td class="sm">${f.remarks}</td></tr>`;
}
function te1Rows(rows) {
  let out = '', g = null;
  for (const f of rows) {
    if (f.grp !== g) { g = f.grp; out += `<tr class="grp"><td colspan="13">${g}</td></tr>\n`; }
    out += te1Row(f) + '\n';
  }
  return out;
}
const te1TotRow = (label, t, cls = 'sub') => `<tr class="${cls}"><td colspan="7">${label}</td><td class="num">${fmt(t.gross)}</td><td class="num">${fmt(t.sanit)}</td><td class="num">${fmt(t.dining)}</td><td class="num">${fmt(t.seats)}</td><td></td><td></td></tr>`;

// TE-2
function te2Row(f) {
  if (f.status === 'closed') return `<tr class="na"><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="c">CLOSED</td><td colspan="9" class="c">CLOSED FOR RENOVATION &ndash; SEE TE-1 NOTE 5</td></tr>`;
  const t = (v) => (v == null ? dash : v);
  const wk = f.hrs.wk.map((v) => `<td class="c">${t(v)}</td>`).join('');
  const we = f.hrs.we ? f.hrs.we.map((v) => `<td class="c">${t(v)}</td>`).join('') : `<td colspan="5" class="c">CLOSED SATURDAYS, SUNDAYS AND HOLIDAYS</td>`;
  return `<tr><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="c">${f.days}</td>${wk}${we}</tr>`;
}

// TE-3
const TE3_HEAD = `${cg([3.0, 5.6, 15.4, 4.6, 4.3, 4.3, 4.3, 4.5, 4.7, 4.2, 4.3, 4.2, 4.6, 4.5, 4.7, 5.6, 17.2].slice(0, 17))}
<thead>
<tr><th rowspan="2">Item</th><th rowspan="2">Bldg<br>No.</th><th rowspan="2">Mess Hall</th><th rowspan="2">Days<br>of Opn</th><th colspan="5" class="g">MONDAY &ndash; FRIDAY (EXCLUDING FEDERAL HOLIDAYS)<sup>1</sup></th><th colspan="6" class="g">SATURDAY, SUNDAY AND FEDERAL HOLIDAYS<sup>3</sup></th><th rowspan="2">Est.<br>Weekly<br>Meals<sup>4</sup></th><th rowspan="2">Remarks</th></tr>
<tr><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Midrats<sup>2</sup></th><th>Total</th><th>Brkfst</th><th>Brunch</th><th>Lunch</th><th>Supper /<br>Dinner</th><th>Midrats<sup>2</sup></th><th>Total</th></tr>
</thead>`;
function te3Cells(f) {
  const wk = `<td class="num">${hc(f.wk, 'B')}</td><td class="num">${f.lunchNS ? 'N/S<sup>6</sup>' : hc(f.wk, 'L')}</td><td class="num">${hc(f.wk, 'D')}</td><td class="num">${hc(f.wk, 'M')}</td><td class="num b">${fmt(wkTot(f))}</td>`;
  const we = f.we ? WE.map((k) => `<td class="num">${hc(f.we, k)}</td>`).join('') + `<td class="num b">${fmt(weTot(f))}</td>` : `<td colspan="6" class="c">CLOSED SAT, SUN AND HOLIDAYS</td>`;
  return wk + we + `<td class="num b">${fmt(weekly(f))}</td>`;
}
function te3Row(f, remarks) {
  if (f.status === 'closed') return `<tr class="na"><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="c">N/A</td><td colspan="11" class="c">CLOSED FOR RENOVATION &ndash; NO WORKLOAD (diners reassigned to TC-575; see TE-1 Note 5)</td><td class="num">${dash}</td><td class="sm"></td></tr>`;
  return `<tr><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="c">${f.days}</td>${te3Cells(f)}<td class="sm">${remarks ?? ''}</td></tr>`;
}
const te3Remarks = {
  '227': 'Midrats 7 days.', '260': 'M&amp;MA.', 'TC-303': 'M&amp;MA.', 'TC-575': 'Includes former TC-410 diners.',
  'W-133': 'Saturday only (closed Sun and holidays).<sup>3</sup>', 'D-301': 'Training schedule.', 'D-450': 'Training schedule.', 'D-512': 'Training schedule.',
  'D-615': 'M&amp;MA.', 'SP-24': 'Satellite of D-301.<sup>5</sup>', 'AS-4150': 'Midrats 7 days.', 'AS-219': 'Satellite of AS-4150.<sup>5</sup>', 'AS-505': 'M&amp;MA.',
};
const te3TotRow = (label, t) => `<tr class="grand"><td colspan="4">${label}</td>${WK.map((k) => `<td class="num">${fmt(t.wk[k])}</td>`).join('')}<td class="num">${fmt(t.wkT)}</td>${WE.map((k) => `<td class="num">${fmt(t.we[k])}</td>`).join('')}<td class="num">${fmt(t.weT)}</td><td class="num">${fmt(t.weekly)}</td><td></td></tr>`;

// ---------- build ----------
const p1Rows = F.filter((f) => f.item <= 11);
const p2Rows = F.filter((f) => f.item >= 12);
const origMCB = te1Tot(orig.filter((f) => f.inst === 'MCB'));
const origAS = te1Tot(orig.filter((f) => f.inst === 'AS'));
const origAll = te1Tot(orig);
const finMCB = te1Tot(final.filter((f) => f.inst === 'MCB'));
const finAS = te1Tot(final.filter((f) => f.inst === 'AS'));
const finAll = te1Tot(final);
const t3orig = te3Tot(orig);
const t3fin = te3Tot(final);
const hist = F.filter((f) => f.hist).map((f) => ({ f, h: histFor(f) }));
const histTot = [0, 1, 2].map((i) => hist.reduce((s, x) => s + (x.h[i] || 0), 0));
const d450 = F.find((f) => f.bn === 'D-450');
const d450a = withAmend(d450);
const b227 = F.find((f) => f.bn === '227');
const tc575 = F.find((f) => f.bn === 'TC-575');

const css = `
  @page { size: Letter portrait; }
  @page land { size: Letter landscape; }
  .land { page: land; }
  body { font-family: "Times New Roman", Times, serif; font-size: 10.5pt; color: #000; margin: 0; }
  p { margin: 0 0 5pt; line-height: 1.2; text-align: justify; }
  .rh { font-family: Arial, Helvetica, sans-serif; font-size: 7.6pt; border-bottom: 0.75pt solid #000; padding-bottom: 2pt; margin-bottom: 8pt; display: flex; justify-content: space-between; gap: 12pt; }
  .rh .rr { font-weight: bold; white-space: nowrap; }
  .rf { font-family: Arial, Helvetica, sans-serif; font-size: 7.2pt; border-top: 0.5pt solid #000; padding-top: 2pt; margin-top: 8pt; display: flex; justify-content: space-between; }
  h1 { font-family: Arial, Helvetica, sans-serif; font-size: 12.5pt; text-align: center; margin: 2pt 0 3pt; line-height: 1.25; }
  h2 { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; margin: 8pt 0 4pt; }
  .ctr { text-align: center; }
  .blk { border: 1pt solid #000; padding: 5pt 8pt; margin: 6pt 0 8pt; font-family: Arial, Helvetica, sans-serif; font-size: 8.6pt; }
  .blk td { padding: 1pt 6pt 1pt 0; vertical-align: top; }
  table.ex { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 7.1pt; line-height: 1.13; table-layout: fixed; }
  table.ex th { border: 0.75pt solid #000; background: #d9d9d9; padding: 1.5pt 2pt; vertical-align: bottom; font-size: 6.8pt; }
  table.ex th.g { background: #bfbfbf; vertical-align: middle; }
  table.ex td { border: 0.5pt solid #000; padding: 1.4pt 2.5pt; vertical-align: top; overflow-wrap: break-word; }
  table.ex tr.colno td { text-align: center; font-size: 6pt; padding: 0.5pt; background: #f2f2f2; }
  table.ex tr.grp td { background: #404040; color: #fff; font-weight: bold; padding: 1.5pt 4pt; }
  table.ex tr.sub td { background: #ececec; font-weight: bold; }
  table.ex tr.grand td { background: #d0d0d0; font-weight: bold; border-top: 1.5pt double #000; }
  table.ex tr.na td { color: #444; font-style: italic; }
  td.c { text-align: center; } td.num { text-align: right; white-space: nowrap; } td.sm { font-size: 6.6pt; } td.b { font-weight: bold; }
  sup { font-size: 5.4pt; vertical-align: super; line-height: 0; }
  p.tcap { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; font-weight: bold; margin: 2pt 0 1pt; text-align: center; }
  p.tsub { font-family: Arial, Helvetica, sans-serif; font-size: 7.4pt; margin: 0 0 4pt; text-align: center; }
  p.cont { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; font-style: italic; text-align: right; margin: 2pt 0; }
  div.fn { font-family: Arial, Helvetica, sans-serif; font-size: 6.9pt; margin-top: 4pt; line-height: 1.18; }
  div.fn p { margin: 0 0 1.6pt; text-align: left; }
  table.box { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; margin: 4pt 0 6pt; }
  table.box td, table.box th { border: 0.6pt solid #000; padding: 1.8pt 4pt; vertical-align: top; text-align: left; }
  table.box th { background: #d9d9d9; }
  table.box td.num { text-align: right; }
  ol.alpha { list-style: lower-alpha; margin: 0 0 5pt 22pt; padding: 0; } ol.alpha li { margin-bottom: 2pt; line-height: 1.2; }
  .qa p { margin-bottom: 4pt; }
  .pb { page-break-after: always; }
  .small { font-family: Arial, sans-serif; font-size: 8.2pt; }
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Solicitation ${SOL} &ndash; Attachment J-2 PWS Technical Exhibits, Garrison Food Service (with Amendment 0001)</title>
<style>${css}</style></head><body>

<!-- ============================ PAGE 1: GENERAL ============================ -->
<div class="pg">
${RH('Attachment J-2 &ndash; General')}
<h1>SECTION J &ndash; ATTACHMENT J-2<br>PERFORMANCE WORK STATEMENT (PWS) TECHNICAL EXHIBITS</h1>
<p class="ctr" style="font-family:Arial,sans-serif;font-size:9.5pt;margin-bottom:3pt"><b>GARRISON FOOD SERVICE (FULL FOOD SERVICE AND MANAGEMENT AND MESS ATTENDANT SERVICES)</b><br>Marine Corps Base (MCB) Camp Halloran and Marine Corps Air Station (MCAS) Pell River, North Carolina</p>
<div class="blk"><table>
<tr><td><b>Solicitation No.:</b></td><td>${SOL}</td><td><b>Issued by:</b></td><td>Regional Contracting Office (RCO), MCB Camp Halloran</td></tr>
<tr><td><b>Requiring Activity:</b></td><td>G-4 Food Service Division, MCB Camp Halloran</td><td><b>Attachment date:</b></td><td>9 November 2026</td></tr>
<tr><td><b>NAICS / PSC:</b></td><td>722310 / S203</td><td><b>Exhibits:</b></td><td>TE-1 through TE-5 (this attachment)</td></tr>
</table></div>
<p class="small"><b>CONTENTS.</b> Part 1 &ndash; General; Part 2 &ndash; Basis of Estimates; Part 3 &ndash; Period of Performance and Current Contract; TE-1 &ndash; Mess Hall Facility Data (2 pages); TE-2 &ndash; Mess Hall Hours of Operation; TE-3 &ndash; Estimated Workload, Average Headcount per Meal Period; TE-3A &ndash; Optional Line Item Projected Headcount; TE-4 &ndash; Historical Meals Served (MCFMIS); TE-5 &ndash; Sanitation and Custodial Requirements.</p>

<h2>PART 1 &ndash; GENERAL</h2>
<p><b>1.1 Purpose.</b> These Technical Exhibits (TE) provide the facility data, hours of operation, estimated workload and sanitation requirements for garrison food service at the mess halls of MCB Camp Halloran and MCAS Pell River. The estimated quantities of work listed in the Technical Exhibits are provided for planning and pricing purposes only. The Government does not guarantee any minimum or maximum headcount.</p>
<p><b>1.2 Scope.</b> This requirement covers sixteen (16) operating garrison mess halls and two (2) satellite facilities listed in TE-1 with a Service Type of FFS, M&amp;MA or SAT. Two service types apply:</p>
<ol class="alpha">
<li><b>Full Food Service (FFS).</b> The Contractor provides all management, supervision, cooks, bakers, mess attendants, cashiers and headcount personnel necessary to requisition, receive, store, prepare, cook and serve all meals, and performs all sanitation of the facility.</li>
<li><b>Management and Mess Attendant (M&amp;MA).</b> Marine Food Service Specialists (MOS 3381) prepare and cook all meals; M&amp;MA mess halls are designated to provide a training platform for Marine food service personnel. The Contractor provides management support, serving line attendants, dining room, scullery and pot-and-pan attendants, cashiers and headcount personnel, and performs all sanitation of the facility.</li>
<li><b>Satellite facilities (SAT).</b> Hot meals are prepared at the parent mess hall shown in TE-1 and transported in insulated food containers to the satellite, where the Contractor serves the meal, records headcount and performs all sanitation of the satellite.</li>
</ol>
<p>In every facility in scope the Contractor performs the sanitation and custodial services of TE-5 throughout the Sanitation Area shown in TE-1, Column (9), on each day of operation.</p>
<p><b>1.3 Definitions.</b> <i>Headcount</i> &ndash; one meal served to one authorized diner, recorded by the Contractor cashier in the Marine Corps Food Management Information System (MCFMIS) by category (meal card, Cash Meal Regular, reservist, other). <i>Meal period</i> &ndash; a scheduled serving window shown in TE-2. <i>Midrats</i> &ndash; midnight rations served 2300&ndash;0100 (2330&ndash;0100 at the Flight Line Satellite) to personnel on duty or night shifts; Midrats are a separate meal period. <i>Brunch / Supper</i> &ndash; the two meal periods served on Saturdays, Sundays and Federal holidays at mess halls not on a training schedule. <i>Training schedule</i> &ndash; breakfast, lunch and dinner served seven days a week to students in a formal course of instruction. <i>Field day</i> &ndash; the weekly top-to-bottom cleaning of the facility (TE-5).</p>
${RF('General, Page 1')}
<div class="pb"></div>
</div>

<!-- ============================ PAGE 2: GENERAL (cont.) ============================ -->
<div class="pg">
${RH('Attachment J-2 &ndash; General')}
<p><b>1.4 Facilities Not Included.</b> The following are not part of this requirement and shall not be priced: Marine-operated field messes and mobile field kitchens; Marine Corps Community Services (MCCS) clubs, food courts and snack bars, including the Paradise Cove Club (Bldg 1210) and the Wolf Creek Food Court (Bldg 1108); the Naval Hospital Camp Halloran galley (Bldg H-1), which is operated by Navy Medicine; and the Base Brig (Bldg 1041), where food service is performed by Government personnel. Bldg TC-410 is closed for renovation (TE-1, Note 5) and Bldg D-1720 is an optional line item only (TE-1, Note 6; TE-3A).</p>

<h2>PART 2 &ndash; BASIS OF ESTIMATES</h2>
<p><b>2.1 Source.</b> TE-3 shows the average headcount per meal period for a typical non-holiday weekday (Monday through Friday) and for a typical Saturday, Sunday or Federal holiday at each facility. The averages are taken from MCFMIS headcount reports (NAVMC 565-1) for the period 1 July 2025 through 30 June 2026, adjusted by the Government for known unit relocations (the reassignment of Bldg TC-410 diners to Bldg TC-575 on 5 January 2026).</p>
<p><b>2.2 Pricing basis.</b> Offerors shall price fifty-two (52) typical weeks per year at the TE-3 averages. A typical week is five (5) weekdays plus two (2) weekend days at facilities open seven days a week; five (5) weekdays plus one (1) Saturday at Bldg W-133 (Monday through Saturday); and five (5) weekdays at facilities open Monday through Friday. Federal holidays are served on the weekend and holiday schedule and are reflected in the TE-3 averages; Offerors shall not price Federal holidays as additional weekend days.</p>
<p><b>2.3 Historical data.</b> TE-4 shows total meals served by fiscal year as recorded in MCFMIS. It is provided for information only and reflects deployments, closures and openings described in its remarks. TE-4 is not the pricing basis.</p>
<p><b>2.4 Workload changes.</b> Unit deployments, training cycles and relocations cause headcount to vary. A change of fifteen percent (15%) or less in the average headcount of a meal period, measured over any ninety (90) consecutive days, is within the scope of the contract price. Changes greater than 15% will be addressed under the Changes clause.</p>

<h2>PART 3 &ndash; PERIOD OF PERFORMANCE AND CURRENT CONTRACT</h2>
<p><b>3.1 Period of performance.</b> Phase-in: 1 September 2027 through 30 September 2027 (30 days, not separately priced). Base period: 1 October 2027 through 30 September 2028 (12 months). Option periods: four (4) twelve-month option periods, Option Period 1 through Option Period 4, through 30 September 2032. The Government may also extend services for up to six (6) months under FAR 52.217-8, Option to Extend Services; any such extension is not an option period.</p>
<p><b>3.2 Current contract.</b> These services are currently performed by Longleaf Garrison Dining, LLC under firm-fixed-price Contract No. M67443-22-C-0004, awarded 15 September 2022 for a twelve-month base period and four twelve-month option periods (1 October 2022 through 30 September 2027). The total contract value, including all option periods and as modified through Modification P00011, is $298,746,215. Modification P00011 deleted the Bldg TC-410 line items effective 5 January 2026 and increased the Bldg TC-575 line items for the reassigned diners. The value of Option Period 4 (1 October 2026 through 30 September 2027), the current period, is $63,215,480. If award of this requirement is delayed, the Government may extend the current contract under FAR 52.217-8 for up to six months at an estimated $31,607,740. Banquet, holiday-meal and special-event support is ordered separately under Blanket Purchase Agreement M67443-24-A-0007 (ceiling $3,500,000) and is not part of this requirement.</p>
<p><b>3.3 Subsistence.</b> Subsistence is Government-furnished through the DLA Troop Support subsistence prime vendor and is not part of the contract price. Fiscal Year 2026 subsistence obligations for the facilities in TE-1 were approximately $38.9 million.</p>

<h2>ABBREVIATIONS</h2>
<table class="box">
<tr><th style="width:14%">Abbrev.</th><th style="width:36%">Meaning</th><th style="width:14%">Abbrev.</th><th>Meaning</th></tr>
<tr><td>BOD</td><td>Beneficial occupancy date</td><td>MCFMIS</td><td>Marine Corps Food Management Information System</td></tr>
<tr><td>FFS</td><td>Full Food Service</td><td>M&amp;MA</td><td>Management and Mess Attendant</td></tr>
<tr><td>iNFADS</td><td>internet Navy Facility Assets Data Store</td><td>M&ndash;F / M&ndash;Sa</td><td>Monday through Friday / Monday through Saturday</td></tr>
<tr><td>Midrats</td><td>Midnight rations (2300&ndash;0100)</td><td>N/S</td><td>Not served</td></tr>
<tr><td>MILCON</td><td>Military construction project</td><td>SAT</td><td>Satellite facility</td></tr>
</table>
${RF('General, Page 2')}
<div class="pb"></div>
</div>

<!-- ============================ TE-1 (1 of 2) ============================ -->
<div class="pg land">
${RH('TE-1 &ndash; Mess Hall Facility Data, Page 1 of 2')}
<p class="tcap">TECHNICAL EXHIBIT 1 (TE-1) &ndash; MESS HALL FACILITY DATA</p>
<p class="tsub">Facilities in which the Contractor shall perform food service and TE-5 sanitation. Notes appear on page 2 of 2.</p>
<table class="ex">
${TE1_HEAD}
<tbody>
${te1Rows(p1Rows)}</tbody>
</table>
<p class="cont">Continued on TE-1, Page 2 of 2</p>
${RF('TE-1, Page 1 of 2')}
<div class="pb"></div>
</div>

<!-- ============================ TE-1 (2 of 2) ============================ -->
<div class="pg land">
${RH('TE-1 &ndash; Mess Hall Facility Data, Page 2 of 2')}
<p class="tcap">TECHNICAL EXHIBIT 1 (TE-1) &ndash; MESS HALL FACILITY DATA (continued)</p>
<table class="ex">
${TE1_HEAD}
<tbody>
${te1Rows(p2Rows.filter((f) => f.inst === 'MCB'))}${te1TotRow(`Subtotal &ndash; MCB Camp Halloran (${origMCB.mh} mess halls, ${origMCB.sat} satellite; excludes Items 7 and 16)`, origMCB)}
${te1Rows(p2Rows.filter((f) => f.inst === 'AS'))}${te1TotRow(`Subtotal &ndash; MCAS Pell River (${origAS.mh} mess halls, ${origAS.sat} satellite)`, origAS)}
${te1TotRow(`TOTAL &ndash; FACILITIES IN SCOPE (${origAll.n}: ${origAll.mh} mess halls, ${origAll.sat} satellites)`, origAll, 'grand')}
</tbody>
</table>
<div class="fn">
<p><b>NOTES:</b></p>
<p><sup>1</sup> Gross SF is the building gross area recorded in iNFADS as of 30 June 2026 and includes kitchen, dining room, scullery, storerooms, heads, offices and mechanical rooms.</p>
<p><sup>2</sup> Sanitation Area is the interior area in which the Contractor performs TE-5 sanitation and custodial services. It excludes mechanical, electrical and telecommunications rooms, the Government Mess Hall Manager / Food Service Office spaces, and covered exterior loading docks and refuse pads (policed only, TE-5).</p>
<p><sup>3</sup> Dining Room SF is included in both Gross SF and Sanitation Area. It is shown for information (seating layout) and is not an additional area.</p>
<p><sup>4</sup> Days of operation: 7 = seven days a week including Federal holidays; M&ndash;F = Monday through Friday, closed Saturdays, Sundays and Federal holidays; M&ndash;Sa = Monday through Saturday, closed Sundays and Federal holidays. Sanitation is performed on each day of operation (TE-5).</p>
<p><sup>5</sup> Item 7, Bldg TC-410, has been closed for renovation since 5 January 2026 and its diners are fed at Bldg TC-575. No workload. Reopening is not scheduled. Figures in parentheses are for information only and are not included in the subtotals or total.</p>
<p><sup>6</sup> Item 16, Bldg D-1720, is new construction under MILCON P-1312 and will be added only if the Government exercises the optional line item (Section B). It is not part of the base requirement. Figures in parentheses are projected and are not included in the subtotals or total. Projected headcount is in TE-3A.</p>
<p><sup>7</sup> Satellite facilities are separate buildings. Their area is not included in the parent mess hall&rsquo;s area, and their headcount is not included in the parent mess hall&rsquo;s headcount.</p>
<p><b>Service Type:</b> FFS = Full Food Service; M&amp;MA = Management and Mess Attendant; SAT = satellite facility (food prepared at the parent mess hall).</p>
</div>
${RF('TE-1, Page 2 of 2')}
<div class="pb"></div>
</div>

<!-- ============================ TE-2 ============================ -->
<div class="pg land">
${RH('TE-2 &ndash; Mess Hall Hours of Operation')}
<p class="tcap">TECHNICAL EXHIBIT 2 (TE-2) &ndash; MESS HALL HOURS OF OPERATION (SERVING HOURS)</p>
<p class="tsub">Serving windows, local time. The Contractor shall open and close each serving line on time. Federal holidays follow the Saturday, Sunday and Federal holiday hours unless the facility is closed on holidays (TE-1, Column 12).</p>
<table class="ex">
<thead>
<tr><th rowspan="2" style="width:3.4%">Item</th><th rowspan="2" style="width:5.8%">Bldg<br>No.</th><th rowspan="2" style="width:19%">Mess Hall</th><th rowspan="2" style="width:5%">Days<br>of Opn</th><th colspan="4" class="g">MONDAY &ndash; FRIDAY</th><th colspan="5" class="g">SATURDAY, SUNDAY AND FEDERAL HOLIDAYS</th></tr>
<tr><th>Breakfast</th><th>Lunch</th><th>Dinner</th><th>Midrats</th><th>Breakfast</th><th>Brunch</th><th>Lunch</th><th>Supper / Dinner</th><th>Midrats</th></tr>
</thead>
<tbody>
<tr class="grp"><td colspan="13">MARINE CORPS BASE CAMP HALLORAN</td></tr>
${F.filter((f) => f.inst === 'MCB' && f.status !== 'option').map(te2Row).join('\n')}
<tr class="grp"><td colspan="13">MARINE CORPS AIR STATION PELL RIVER</td></tr>
${F.filter((f) => f.inst === 'AS').map(te2Row).join('\n')}
</tbody>
</table>
<div class="fn">
<p><b>NOTES:</b> (1) &ldquo;N/S&rdquo; = meal period not served at that facility. (2) Serving windows may be adjusted by the Contracting Officer&rsquo;s Representative (COR) with seven (7) calendar days&rsquo; notice; a change in serving hours of sixty (60) minutes or less per day is within scope. (3) The Contractor shall remain on duty for cleanup after each meal period until TE-5 tasks are complete. (4) Holiday meal (Thanksgiving, Christmas) and Marine Corps Birthday meal schedules are published by the Food Service Officer at least 14 days in advance and do not exceed normal weekday serving hours.</p>
</div>
${RF('TE-2, Page 1 of 1')}
<div class="pb"></div>
</div>

<!-- ============================ TE-3 ============================ -->
<div class="pg land">
${RH('TE-3 &ndash; Estimated Workload')}
<p class="tcap">TECHNICAL EXHIBIT 3 (TE-3) &ndash; ESTIMATED WORKLOAD: AVERAGE HEADCOUNT PER MEAL PERIOD</p>
<p class="tsub">Average headcount per meal period on a typical day, MCFMIS (NAVMC 565-1), 1 July 2025 &ndash; 30 June 2026, adjusted. Pricing basis: Part 2, paragraph 2.2.</p>
<table class="ex">
${TE3_HEAD}
<tbody>
<tr class="grp"><td colspan="17">MARINE CORPS BASE CAMP HALLORAN</td></tr>
${F.filter((f) => f.inst === 'MCB' && f.status !== 'option').map((f) => te3Row(f, te3Remarks[f.bn])).join('\n')}
<tr class="grp"><td colspan="17">MARINE CORPS AIR STATION PELL RIVER</td></tr>
${F.filter((f) => f.inst === 'AS').map((f) => te3Row(f, te3Remarks[f.bn])).join('\n')}
${te3TotRow(`TOTAL &ndash; ALL FACILITIES IN SCOPE (${orig.length})`, t3orig)}
</tbody>
</table>
<div class="fn">
<p><b>NOTES:</b></p>
<p><sup>1</sup> Monday through Friday columns are the average headcount per meal period on a non-holiday weekday.</p>
<p><sup>2</sup> Midrats are served 2300&ndash;0100 (AS-219: 2330&ndash;0100) and are counted as a separate meal period. A dash (&mdash;) means the meal period is not served at that facility.</p>
<p><sup>3</sup> Saturday, Sunday and Federal holiday columns are the average headcount per meal period on a weekend day or holiday. Mess halls on a training schedule (D-301, D-450, D-512) serve breakfast, lunch and dinner every day; other mess halls serve brunch and supper. Bldg W-133 opens on Saturdays only: its weekend columns are Saturday averages, and it is closed Sundays and Federal holidays.</p>
<p><sup>4</sup> Est. Weekly Meals = 5 &times; the Monday&ndash;Friday total + (weekend and holiday days open in a typical week) &times; the weekend total, i.e. 2 days at facilities open seven days, 1 day (Saturday) at W-133, and 0 at facilities open Monday through Friday. Shown for convenience; the pricing basis is paragraph 2.2.</p>
<p><sup>5</sup> Satellite headcount is recorded at the satellite by the Contractor cashier and is not included in the parent mess hall&rsquo;s headcount.</p>
<p><sup>6</sup> Lunch is not served at the Shell Point Range Satellite; units on the range draw Meals, Ready-to-Eat (MRE) through their own supply channels. MREs are not contract meals and are not counted.</p>
</div>
${RF('TE-3, Page 1 of 2')}
<div class="pb"></div>
</div>

<!-- ============================ TE-3A + TE-4 ============================ -->
<div class="pg land">
${RH('TE-3A &ndash; Optional Line Item; TE-4 &ndash; Historical Meals Served')}
<p class="tcap">TECHNICAL EXHIBIT 3A (TE-3A) &ndash; OPTIONAL LINE ITEM: PROJECTED HEADCOUNT, BLDG D-1720</p>
<p class="tsub">For pricing the optional line item only (Section B). Not part of the base requirement. Projected for the new Camp Dunning mess hall (MILCON P-1312), BOD estimated second quarter FY 2029, on a training schedule.</p>
<table class="ex" style="width:78%;margin:0 auto">
<thead>
<tr><th rowspan="2" style="width:9%">Bldg<br>No.</th><th rowspan="2" style="width:20%">Mess Hall</th><th colspan="4" class="g">MONDAY &ndash; FRIDAY</th><th colspan="4" class="g">SATURDAY, SUNDAY AND HOLIDAYS</th><th rowspan="2">Est. Weekly<br>Meals</th></tr>
<tr><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Total</th><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Total</th></tr>
</thead>
<tbody>
<tr class="na"><td>D-1720</td><td>Camp Dunning Mess Hall (New), MILCON P-1312</td><td class="num">${fmt(OPT.wk.B)}</td><td class="num">${fmt(OPT.wk.L)}</td><td class="num">${fmt(OPT.wk.D)}</td><td class="num">${fmt(sum(OPT.wk, WK))}</td><td class="num">${fmt(OPT.we.B)}</td><td class="num">${fmt(OPT.we.L)}</td><td class="num">${fmt(OPT.we.S)}</td><td class="num">${fmt(sum(OPT.we, WE))}</td><td class="num">${fmt(5 * sum(OPT.wk, WK) + 2 * sum(OPT.we, WE))}</td></tr>
</tbody>
</table>

<p class="tcap" style="margin-top:12pt">TECHNICAL EXHIBIT 4 (TE-4) &ndash; HISTORICAL MEALS SERVED (MCFMIS)</p>
<p class="tsub">Total meals served (all meal periods, all diner categories) by fiscal year. FOR INFORMATION ONLY &ndash; not the pricing basis (paragraph 2.3).</p>
<table class="ex">
<thead>
<tr><th style="width:4%">Item</th><th style="width:7%">Bldg<br>No.</th><th style="width:24%">Mess Hall</th><th style="width:11%">FY 2024<br>(1 Oct 23 &ndash;<br>30 Sep 24)</th><th style="width:11%">FY 2025<br>(1 Oct 24 &ndash;<br>30 Sep 25)</th><th style="width:11%">FY 2026<br>(1 Oct 25 &ndash;<br>30 Jun 26)<br>9 months</th><th>Remarks</th></tr>
</thead>
<tbody>
${hist.map(({ f, h }) => `<tr${f.status === 'closed' ? ' class="na"' : ''}><td class="c">${f.item}</td><td>${f.bn}</td><td>${f.name}</td><td class="num">${n(h[0])}</td><td class="num">${n(h[1])}</td><td class="num">${n(h[2])}</td><td class="sm">${f.histNote ?? ''}</td></tr>`).join('\n')}
<tr class="grand"><td colspan="3">TOTAL MEALS SERVED</td><td class="num">${fmt(histTot[0])}</td><td class="num">${fmt(histTot[1])}</td><td class="num">${fmt(histTot[2])}</td><td></td></tr>
</tbody>
</table>
${RF('TE-3, Page 2 of 2 / TE-4')}
<div class="pb"></div>
</div>

<!-- ============================ TE-5 ============================ -->
<div class="pg">
${RH('TE-5 &ndash; Sanitation and Custodial Requirements')}
<p class="tcap">TECHNICAL EXHIBIT 5 (TE-5) &ndash; SANITATION AND CUSTODIAL REQUIREMENTS</p>
<p><b>5.1 General.</b> The Contractor shall perform the sanitation and custodial tasks below throughout the Sanitation Area of each facility in TE-1, Column (9), on each day of operation shown in TE-1, Column (12), in accordance with NAVMED P-5010-1, Food Safety, and the Tri-Service Food Code (TB MED 530 / NAVMED P-5010-1 / AFMAN 48-147). Facilities open Monday through Friday require no sanitation on Saturdays, Sundays or Federal holidays; Bldg W-133 requires none on Sundays or Federal holidays. The Contractor furnishes cleaning chemicals, floor finish, equipment and supplies. The Government furnishes paper products, hand soap and can liners.</p>
<table class="box">
<tr><th style="width:24%">Area</th><th>Task</th><th style="width:19%">Frequency</th></tr>
<tr><td rowspan="4">Dining room, serving lines, salad and beverage bars</td><td>Clean and sanitize tables, chairs, booths, condiment stations and sneeze guards; sweep and damp mop</td><td>After each meal period</td></tr>
<tr><td>Vacuum entry mats; spot clean walls, doors and glass</td><td>Daily</td></tr>
<tr><td>High dusting (vents, light fixtures, ledges); clean window blinds</td><td>Weekly (field day)</td></tr>
<tr><td>Scrub and recoat resilient floors / strip and refinish resilient floors</td><td>Monthly / Semiannually</td></tr>
<tr><td rowspan="3">Kitchen, food preparation and bakery areas</td><td>Clean and sanitize food-contact surfaces and equipment</td><td>After each use</td></tr>
<tr><td>Degrease and scrub floors and floor drains; clean ranges, kettles, fryers and ovens</td><td>Daily</td></tr>
<tr><td>Clean exhaust hood filters; clean and sanitize walk-in refrigerators and freezers</td><td>Weekly</td></tr>
<tr><td rowspan="2">Scullery and pot-and-pan room</td><td>Wash, sanitize and air-dry all trays, flatware, pots and pans; clean dish machine and scrapping area</td><td>After each meal period</td></tr>
<tr><td>De-lime dish machine</td><td>Weekly</td></tr>
<tr><td>Heads and food service personnel locker rooms</td><td>Clean and disinfect fixtures, partitions and floors; restock Government-furnished supplies</td><td>Twice per day of operation</td></tr>
<tr><td>Offices, cashier station, storerooms</td><td>Empty trash; dust; sweep and damp mop</td><td>Daily</td></tr>
<tr><td>Exterior (within 50 ft of the facility)</td><td>Police litter on patios, walks, loading dock and refuse pad; pressure wash loading dock and refuse pad</td><td>Daily / Weekly</td></tr>
<tr><td>Entire facility</td><td>Field day: top-to-bottom cleaning of all areas</td><td>Weekly, as scheduled by the Mess Hall Manager</td></tr>
</table>
<p><b>5.2 Performed by the Government (not priced).</b> Pest control (Installation Pest Control); grease interceptor pumping; inspection and service of hood fire-suppression systems; exterior window washing; refuse and recycling collection (installation refuse contract); grounds maintenance and landscaping; and repair of real property and Government-furnished equipment.</p>
<p><b>5.3 Inspections.</b> Facilities are inspected by the Preventive Medicine Service and the COR. A facility rated &ldquo;unsatisfactory&rdquo; shall be re-cleaned within four (4) hours at no additional cost to the Government.</p>
${RF('TE-5, Page 1 of 1')}
<div class="pb"></div>
</div>

<!-- ============================ AMENDMENT 0001 (1 of 2) ============================ -->
<div class="pg">
${RHA('SF 30 Block 14 &ndash; Continuation, Page 1 of 2')}
<h1>AMENDMENT 0001 TO SOLICITATION NO. ${SOL}</h1>
<p class="ctr small">Amendment date: 18 December 2026 &nbsp;|&nbsp; Proposal due date unchanged: 21 January 2027, 2:00 p.m. Eastern Time</p>
<p><b>Purpose.</b> This amendment (1) revises Attachment J-2, Technical Exhibits TE-1, TE-2, TE-3 and TE-4, and Part 1, paragraph 1.2, and (2) answers questions received through 4 December 2026. Offerors shall acknowledge this amendment. Where this amendment conflicts with Attachment J-2 as issued, this amendment governs. All other terms and conditions remain unchanged.</p>
<h2>CHANGES TO ATTACHMENT J-2</h2>
<p><b>Item 1 &ndash; Bldg D-512 deleted.</b> TE-1 Item 14, TE-2 Item 14, TE-3 Item 14 and TE-4 Item 14, Bldg D-512, Mess Hall 512, Camp Dunning, are <b>DELETED</b> in their entirety. The Infantry Training Battalion will complete its consolidation into Bldg D-450 by 30 September 2027, and Mess Hall 512 will close on that date and be turned over to the Facilities Department for disposal. Do not price Bldg D-512.</p>
<p><b>Item 2 &ndash; Bldg D-450 workload revised.</b> As a result of Item 1, TE-3 Item 13, Bldg D-450, Mess Hall 450 (Infantry Training Battalion), is revised to read as follows. TE-1 Item 13 (Gross SF, Sanitation Area, seats) and TE-2 Item 13 (serving hours) are unchanged.</p>
<table class="box">
<tr><th rowspan="2">Bldg</th><th colspan="4" class="ctr">Monday &ndash; Friday</th><th colspan="4" class="ctr">Saturday, Sunday and Federal Holidays</th><th rowspan="2">Est. Weekly Meals</th></tr>
<tr><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Total</th><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Total</th></tr>
<tr><td>D-450 (was)</td><td class="num">${fmt(d450.wk.B)}</td><td class="num">${fmt(d450.wk.L)}</td><td class="num">${fmt(d450.wk.D)}</td><td class="num">${fmt(wkTot(d450))}</td><td class="num">${fmt(d450.we.B)}</td><td class="num">${fmt(d450.we.L)}</td><td class="num">${fmt(d450.we.S)}</td><td class="num">${fmt(weTot(d450))}</td><td class="num">${fmt(weekly(d450))}</td></tr>
<tr><td><b>D-450 (revised)</b></td><td class="num"><b>${fmt(d450a.wk.B)}</b></td><td class="num"><b>${fmt(d450a.wk.L)}</b></td><td class="num"><b>${fmt(d450a.wk.D)}</b></td><td class="num"><b>${fmt(wkTot(d450a))}</b></td><td class="num"><b>${fmt(d450a.we.B)}</b></td><td class="num"><b>${fmt(d450a.we.L)}</b></td><td class="num"><b>${fmt(d450a.we.S)}</b></td><td class="num"><b>${fmt(weTot(d450a))}</b></td><td class="num"><b>${fmt(weekly(d450a))}</b></td></tr>
</table>
<p><b>Item 3 &ndash; Bldg 227 area corrected.</b> TE-1 Item 2, Bldg 227, Mess Hall 227: Column (8), Gross SF, is revised from &ldquo;${fmt(b227.gross)}&rdquo; to read &ldquo;${fmt(b227.amend.gross)}&rdquo;, and Column (9), Sanitation Area SF, is revised from &ldquo;${fmt(b227.sanit)}&rdquo; to read &ldquo;${fmt(b227.amend.sanit)}&rdquo;. The figures as issued reflected the first service floor only. Columns (10) and (11) (Dining Room SF ${fmt(b227.dining)}, Seats ${fmt(b227.seats)}) already covered both service floors and are unchanged.</p>
<p><b>Item 4 &ndash; Paragraph 1.2.</b> &ldquo;sixteen (16) operating garrison mess halls and two (2) satellite facilities&rdquo; is revised to read &ldquo;fifteen (15) operating garrison mess halls and two (2) satellite facilities&rdquo;.</p>
<p><b>Item 5 &ndash; Revised totals.</b> The TE-1 subtotals and total and the TE-3 total are revised to read:</p>
<table class="box">
<tr><th>Line</th><th>Facilities</th><th>Gross SF</th><th>Sanitation Area SF</th><th>Dining Room SF</th><th>Seats</th></tr>
<tr><td>TE-1 Subtotal &ndash; MCB Camp Halloran</td><td>${finMCB.mh} mess halls, ${finMCB.sat} satellite</td><td class="num">${fmt(finMCB.gross)}</td><td class="num">${fmt(finMCB.sanit)}</td><td class="num">${fmt(finMCB.dining)}</td><td class="num">${fmt(finMCB.seats)}</td></tr>
<tr><td>TE-1 Subtotal &ndash; MCAS Pell River</td><td>${finAS.mh} mess halls, ${finAS.sat} satellite</td><td class="num">${fmt(finAS.gross)}</td><td class="num">${fmt(finAS.sanit)}</td><td class="num">${fmt(finAS.dining)}</td><td class="num">${fmt(finAS.seats)}</td></tr>
<tr><td><b>TE-1 TOTAL &ndash; FACILITIES IN SCOPE</b></td><td><b>${finAll.n} (${finAll.mh} mess halls, ${finAll.sat} satellites)</b></td><td class="num"><b>${fmt(finAll.gross)}</b></td><td class="num"><b>${fmt(finAll.sanit)}</b></td><td class="num"><b>${fmt(finAll.dining)}</b></td><td class="num"><b>${fmt(finAll.seats)}</b></td></tr>
</table>
<table class="box">
<tr><th>TE-3 TOTAL (${final.length})</th><th>Brkfst</th><th>Lunch</th><th>Dinner</th><th>Midrats</th><th>M&ndash;F Total</th><th>Brkfst</th><th>Brunch</th><th>Lunch</th><th>Supper / Dinner</th><th>Midrats</th><th>Wkd/Hol Total</th><th>Est. Weekly Meals</th></tr>
<tr><td>Revised</td>${WK.map((k) => `<td class="num">${fmt(t3fin.wk[k])}</td>`).join('')}<td class="num">${fmt(t3fin.wkT)}</td>${WE.map((k) => `<td class="num">${fmt(t3fin.we[k])}</td>`).join('')}<td class="num">${fmt(t3fin.weT)}</td><td class="num">${fmt(t3fin.weekly)}</td></tr>
</table>
${RFA('Page 1 of 2')}
<div class="pb"></div>
</div>

<!-- ============================ AMENDMENT 0001 (2 of 2) ============================ -->
<div class="pg">
${RHA('SF 30 Block 14 &ndash; Continuation, Page 2 of 2')}
<h2>QUESTIONS AND ANSWERS</h2>
<div class="qa">
<p><b>Q1.</b> Is the area of a satellite facility included in the area of its parent mess hall, and is satellite headcount included in the parent&rsquo;s headcount?<br><b>A1.</b> No to both. The satellites (SP-24 and AS-219) are separate buildings with their own TE-1 area and TE-3 headcount, and are priced as separate line items (TE-1 Note 7; TE-3 Note 5).</p>
<p><b>Q2.</b> Will Bldg TC-410 reopen during the contract? Should Offerors price it?<br><b>A2.</b> Reopening of TC-410 is not scheduled. Do not price TC-410. If it reopens, the Government will add it by modification and the TC-575 workload will be adjusted.</p>
<p><b>Q3.</b> Is the Gross SF or the Sanitation Area the area to be cleaned?<br><b>A3.</b> The Sanitation Area (TE-1, Column 9). Gross SF is the iNFADS building area and includes spaces the Contractor does not clean (TE-1 Note 2). Dining Room SF is part of the Sanitation Area, not in addition to it.</p>
<p><b>Q4.</b> Does Mess Hall 227 serve Midrats on weekends?<br><b>A4.</b> Yes. Mess Hall 227 and the Pell River Mess Hall (AS-4150) serve Midrats seven days a week, as shown in TE-2 and TE-3. The Flight Line Satellite (AS-219) serves Midrats Monday through Friday only.</p>
<p><b>Q5.</b> Bldg W-133 shows weekend headcount but is closed on Sundays. How should the weekend figures be applied?<br><b>A5.</b> W-133 is open Monday through Saturday. Its weekend and holiday columns are Saturday averages and apply to one day per week (paragraph 2.2; TE-3 Note 3). It is closed on Sundays and Federal holidays.</p>
<p><b>Q6.</b> Please confirm the current contract value and the amount invoiced to date.<br><b>A6.</b> See Part 3, paragraph 3.2: Contract No. M67443-22-C-0004 (Longleaf Garrison Dining, LLC), total value $298,746,215 including all option periods, as modified through P00011; Option Period 4 value $63,215,480. Total invoiced from 1 October 2022 through 30 September 2026 (48 months) was $233,418,605. The FAR 52.217-8 estimate ($31,607,740) and the special-event BPA (ceiling $3,500,000) are not part of the contract value.</p>
<p><b>Q7.</b> Will the Government provide Thanksgiving and Christmas meal headcounts?<br><b>A7.</b> Holiday-meal headcounts are reflected in the TE-3 weekend and holiday averages (paragraph 2.2). No separate holiday workload will be provided.</p>
<p><b>Q8.</b> Does the Contractor maintain the grounds around the mess halls?<br><b>A8.</b> No. Grounds maintenance is performed by the Government (TE-5, paragraph 5.2). The Contractor only polices litter within 50 feet of each facility.</p>
<p><b>Q9.</b> Is the optional line item for Bldg D-1720 evaluated?<br><b>A9.</b> Yes. The optional line item is evaluated in accordance with Section M, but it is not part of the base requirement and may never be exercised. The TE-3A projection is the pricing basis for that line item only.</p>
</div>
<p style="margin-top:10pt"><b>Acknowledgment.</b> Offerors must acknowledge receipt of this amendment by signing Block 15 of the SF 30 or by identifying the amendment number and date in the proposal. Failure to acknowledge may result in rejection of the proposal.</p>
<p class="small" style="margin-top:8pt;text-align:left">Contracting Officer: Major R. T. Okafor, USMC &nbsp;|&nbsp; Contract Specialist: Ms. Lynette Sabo, RCO Camp Halloran &nbsp;|&nbsp; rco.halloran.food@usmc.example.mil</p>
${RFA('Page 2 of 2')}
</div>

</body></html>
`;

fs.writeFileSync(path.join(here, 'm67443-27-r-0019-att-j2.html'), html);

// ---------- truth facilities ----------
const level = (f) => (f.weDays === 2 ? 'daily_7' : f.weDays === 1 ? 'daily_6' : 'daily_5');
const strip = (s) => s.replace(/&amp;/g, '&').replace(/<[^>]+>/g, '');
const facilities = final.map((f) => {
  const dpw = daysPerWeek(f);
  const mealsPerDay = Math.round(weekly(f) / dpw);
  const periods = WK.filter((k) => f.wk[k]).length;
  return {
    buildingNumber: f.bn, name: strip(f.name), grossSqft: f.gross, cleanableSqft: f.sanit, floors: f.floors,
    serviceLevel: level(f), category: 'dining',
    dining: { mealsPerDay, mealPeriods: periods, daysPerWeek: dpw },
  };
});
const truthPath = path.join(here, 'truth.json');
if (fs.existsSync(truthPath)) {
  const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  truth.expect.facilities = facilities;
  fs.writeFileSync(truthPath, JSON.stringify(truth, null, 2) + '\n');
}

// ---------- report for README ----------
console.log('in scope:', final.length, 'gross total:', fmt(finAll.gross), 'sanit total:', fmt(finAll.sanit));
console.log('orig totals TE-1:', origAll, 'TE-3 orig weekly', t3orig.weekly, 'final weekly', t3fin.weekly);
for (const f of final) {
  const wkS = WK.map((k) => f.wk[k] ?? '-').join('/'), weS = f.we ? WE.map((k) => f.we[k] ?? '-').join('/') : 'closed';
  console.log(`| ${f.bn} | ${f.type.replace('&amp;', '&')} | ${f.days.replace(/&ndash;/g, '-')} | ${wkS} = ${wkTot(f)} | ${weS} = ${weTot(f)} | ${weekly(f)} / ${daysPerWeek(f)} = ${(weekly(f) / daysPerWeek(f)).toFixed(2)} | ${Math.round(weekly(f) / daysPerWeek(f))} |`);
}
console.log('hist totals', histTot, 'tc575 hist', histFor(tc575));
