// Clip 02: agent reads an RFP (Sections L & M), pulls every "shall" statement,
// and builds the compliance matrix in a spreadsheet, then fast-forwards through the rest.
import { h, box, css, text, toggle, range, lerp, E, spring, typed } from '../engine.js';

const PAGE_Y = 60; // page top in app coordinates (toolbar 40 + margin 20)
const PAGE_X = 36;

const DOC = [
  { y: 34, cls: 'h1', text: 'SECTION L: INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS' },
  { y: 64, cls: 'h2', text: 'L.4   VOLUME I: TECHNICAL APPROACH' },
  { y: 92, req: 0, text: 'L.4.1  The Offeror shall describe its approach to transitioning incumbent staff within 60 days of contract award.' },
  { y: 146, req: 1, text: 'L.4.2  The Offeror shall provide a staffing plan that identifies all key personnel and their qualifications.' },
  { y: 200, req: 2, text: 'L.4.3  The Technical Volume shall not exceed 25 pages, excluding résumés and the compliance matrix.' },
  { y: 254, req: 3, text: 'L.4.4  The Offeror shall describe its quality control program, including root-cause analysis and corrective action.' },
  { y: 316, cls: 'h2', text: 'L.5   VOLUME II: PAST PERFORMANCE' },
  { y: 344, fast: 0, text: 'L.5.1  The Offeror shall submit no more than three (3) past performance references of similar size and scope.' },
  { y: 398, fast: 1, text: 'L.5.2  References shall be for work performed within the last five (5) years.' },
  { y: 460, cls: 'h2', text: 'L.6   VOLUME III: PRICE' },
  { y: 488, fast: 2, text: 'L.6.1  The Offeror shall submit the price volume in the Government-provided Excel workbook.' },
  { y: 542, fast: 3, text: 'L.6.2  Fully burdened labor rates shall be provided for each labor category and CLIN.' },
  { y: 604, cls: 'h1', text: 'SECTION M: EVALUATION FACTORS FOR AWARD' },
  { y: 632, fast: 4, text: 'M.2.1  The Government will evaluate the realism of the proposed staffing approach and transition risk.' },
  { y: 686, fast: 5, text: 'M.3.1  Past performance will be assessed for recency, relevancy, and quality.' },
  { y: 740, fast: 6, text: 'L.7.1  The Offeror shall submit a Small Business Participation Plan with its proposal.' },
  { y: 794, fast: 7, text: 'L.8.1  Key personnel shall possess a SECRET clearance at time of proposal submission.' },
];

const ROWS = [
  ['R-001', 'L.4.1', 'Transition incumbent staff ≤ 60 days', 'I'],
  ['R-002', 'L.4.2', 'Staffing plan with key personnel', 'I'],
  ['R-003', 'L.4.3', 'Technical volume ≤ 25 pages', 'I'],
  ['R-004', 'L.4.4', 'QC program & corrective action', 'I'],
  ['R-005', 'L.5.1', '≤ 3 past performance references', 'II'],
  ['R-006', 'L.5.2', 'References within last 5 years', 'II'],
  ['R-007', 'L.6.1', 'Price in Government Excel workbook', 'III'],
  ['R-008', 'L.6.2', 'Burdened rates per LCAT & CLIN', 'III'],
  ['R-009', 'M.2.1', 'Staffing realism & transition risk', 'I'],
  ['R-010', 'M.3.1', 'Recency, relevancy, quality', 'II'],
  ['R-011', 'L.7.1', 'Small Business Participation Plan', 'IV'],
  ['R-012', 'L.8.1', 'Key personnel hold SECRET', 'I'],
  ['R-013', 'L.8.2', 'Facility clearance at award', 'IV'],
  ['R-014', 'L.9.1', 'OCI mitigation plan', 'IV'],
  ['R-015', 'L.9.2', 'Section K reps & certs', 'IV'],
  ['R-016', 'C.5.3', 'Work orders answered ≤ 4 hours', 'I'],
  ['R-017', 'C.6.1', 'Monthly status report (A003)', 'I'],
  ['R-018', 'C.7.2', 'QC plan within 30 days of award', 'I'],
];
const COLS = [34, 64, 64, 356, 44, 98]; // row#, ID, Ref, Requirement, Vol, Status
const SHEET_Y = 70;
const ROW0 = SHEET_Y + 52;

// Timing (clip-local seconds)
const HL = [0.7, 1.4, 2.1, 2.8]; // highlight sweeps for the four "slow" requirements
const FF0 = 3.4; // fast-forward window
const FF1 = 5.3;
const fastRowT = (k) => 3.5 + k * 0.125;
const EXPORT = 5.8;

export function createCompliance() {
  // PDF side
  const page = h('div', { class: 'c-page', style: box(PAGE_X, 20, 548, 900) });
  const hls = [];
  const fastHls = [];
  for (const d of DOC) {
    if (d.req != null || d.fast != null) {
      const hl = h('div', { class: 'c-hl', style: box(34, d.y - 4, 482, 46) });
      page.append(hl);
      (d.req != null ? hls : fastHls).push(hl);
    }
    page.append(h('div', { class: `c-p ${d.cls || ''}`, style: box(40, d.y, 468, null), text: d.text }));
  }
  const pageArea = h('div', { class: 'c-pagearea', style: box(0, 40, 620, 676) }, page);
  const pdf = h(
    'div',
    { class: 'c-pdf', style: box(0, 0, 620, 716) },
    h('div', { class: 'c-pdfbar', style: box(0, 0, 620, 40) }, h('b', { text: 'RFP_Sections_L_M.pdf' }), h('span', { class: 'pg', text: '4 / 142' }), h('span', { text: '100%' })),
    pageArea,
  );

  // Spreadsheet side
  const counter = h('b', { text: '0' });
  const exportBtn = h('div', { class: 'c-export', style: box(1180 - 620, 7, 76, 26), text: 'Export' });
  const fx = h('span', { class: 'fxv' });
  const colX = COLS.reduce((a, w, i) => (a.push((a[i - 1] ?? 0) + (i ? COLS[i - 1] : 0)), a), []);
  const letters = ['', 'A', 'B', 'C', 'D', 'E'].map((l, i) => h('div', { class: 'c-col', style: box(colX[i], 0, COLS[i], 22), text: l }));
  const heads = ['', 'ID', 'Ref', 'Requirement', 'Vol', 'Status'].map((l, i) => h('div', { class: 'c-cell c-headcell', style: box(colX[i], 22, COLS[i], 30), text: l }));
  const rows = ROWS.map((r, i) => {
    const cells = [String(i + 2), ...r].map((v, j) => h('div', { class: `c-cell${j === 0 ? ' c-rn' : ''}`, style: box(colX[j], 0, COLS[j], 30), text: j === 3 ? '' : v }));
    const status = h('div', { class: 'c-cell', style: box(colX[5], 0, COLS[5], 30) }, h('span', { class: 'c-ok', text: 'Mapped' }));
    const row = h('div', { class: 'c-row', style: box(0, ROW0 - SHEET_Y + i * 30, 660, 30) }, cells.slice(0, 5), status);
    return { row, req: cells[3], status: status.firstChild, text: r[2] };
  });
  const sel = h('div', { class: 'c-sel' });
  const grid = h('div', { class: 'c-grid', style: box(0, SHEET_Y, 660, 716 - SHEET_Y) }, letters, heads, rows.map((r) => r.row), sel);
  const sheet = h(
    'div',
    { class: 'c-sheet', style: box(620, 0, 660, 716) },
    h(
      'div',
      { class: 'c-sheetbar', style: box(0, 0, 660, 40) },
      h('i', { class: 'xl' }),
      h('b', { text: 'Compliance_Matrix.xlsx' }),
      h('div', { class: 'c-counter' }, counter, h('span', { text: ' requirements mapped' })),
      exportBtn,
    ),
    h('div', { class: 'c-fx', style: box(0, 40, 660, 30) }, h('i', { text: 'fx' }), fx),
    grid,
  );

  // Pill that flies from the highlighted clause to its new spreadsheet row.
  const flyer = h('div', { class: 'c-fly' });
  const toast = h(
    'div',
    { class: 'p-toast', style: box(760, 612, 380, 74) },
    h('div', { class: 'tick', text: '✓' }),
    h('div', {}, h('b', { text: 'Exported compliance matrix' }), h('span', { text: '214 rows · Volume I–IV outline' })),
  );
  const root = h('div', { class: 'app compliance', style: box(0, 0, 1280, 716) }, pdf, sheet, flyer, toast);

  const hlY = (i) => PAGE_Y + DOC.find((d) => d.req === i).y;
  const cursor = [[0.15, 700, 600]];
  HL.forEach((t0, i) => {
    cursor.push([t0 - 0.02, 108, hlY(i) + 6], [t0 + 0.3, 470, hlY(i) + 26, E.inOutCubic], [t0 + 0.55, 470, hlY(i) + 26]);
  });
  cursor.push([3.3, 520, 380], [5.3, 520, 380], [5.72, 1215, 18], [6.3, 1215, 18]);

  const clock = (t) => (t < FF0 ? t : t < FF1 ? FF0 + (t - FF0) * 8 : FF0 + (FF1 - FF0) * 8 + (t - FF1));

  return {
    root,
    agent: 'agent-02',
    task: 'Build a compliance matrix from Sections L & M of the RFP.',
    url: 'workspace.proposals.internal/rfp-4471/compliance',
    cursor,
    clicks: [EXPORT],
    camera: [[0, 1, 640, 358], [0.3, 1, 640, 358], [0.85, 1.32, 520, 250], [1.9, 1.32, 520, 250], [2.6, 1.32, 760, 250], [3.3, 1.32, 760, 250], [3.85, 1, 640, 358]],
    typing: HL.map((t0) => [t0 + 0.45, t0 + 0.8, 8]),
    sfx: [
      ...HL.map((t0) => [t0 + 0.4, 'whip']),
      ...ROWS.slice(4).map((_, k) => [fastRowT(k), 'tick']),
      [FF0, 'ff'],
      [EXPORT + 0.15, 'success'],
    ],
    log: [
      { t: 0.2, verb: 'OPEN', text: 'RFP_Sections_L_M.pdf · 142 pp' },
      { t: 0.95, verb: 'FIND', text: 'L.4.1 shall → transition ≤ 60 days' },
      { t: 1.65, verb: 'FIND', text: 'L.4.2 shall → key personnel plan' },
      { t: 2.35, verb: 'FIND', text: 'L.4.3 shall → 25-page limit' },
      { t: 3.05, verb: 'FIND', text: 'L.4.4 shall → QC program' },
      { t: FF0 + 0.05, verb: 'SCAN', text: 'pp. 5–142 · every "shall", "must", "will"' },
      { t: FF1, verb: 'MAP', text: '214 requirements → Vols I–IV' },
      { t: EXPORT, verb: 'CLICK', text: 'Export' },
      { t: EXPORT + 0.2, verb: 'DONE', text: 'Compliance matrix ready', done: true },
    ],
    speed: (t) => (t >= FF0 && t < FF1 ? '8× speed' : '1× speed'),
    clock,
    update(t) {
      hls.forEach((hl, i) => {
        const p = E.inOutCubic(range(t, HL[i], HL[i] + 0.3));
        css(hl, { clipPath: `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`, opacity: p > 0 ? '1' : '0' });
      });
      fastHls.forEach((hl, k) => {
        const t0 = fastRowT(k) - 0.1;
        const p = range(t, t0, t0 + 0.12);
        css(hl, { clipPath: `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`, opacity: p > 0 ? '1' : '0' });
      });
      const scroll = lerp(0, 300, E.inOutCubic(range(t, FF0 + 0.2, FF1 - 0.4)));
      css(page, { transform: `translateY(${(-scroll).toFixed(1)}px)` });

      // Rows: four typed slowly, the rest stream in at 8×.
      let active = -1;
      rows.forEach((r, i) => {
        const t0 = i < 4 ? HL[i] + 0.4 : fastRowT(i - 4);
        const p = E.outExpo(range(t, t0, t0 + 0.3));
        css(r.row, { opacity: t >= t0 ? '1' : '0', transform: `translateX(${lerp(-10, 0, p).toFixed(1)}px)` });
        text(r.req, i < 4 ? typed(t, r.text, t0 + 0.05, t0 + 0.4) : r.text);
        const sp = spring(t - (t0 + (i < 4 ? 0.45 : 0.12)), 4, 0.6);
        css(r.status, { opacity: String(Math.min(1, sp * 2)), transform: `scale(${lerp(0.5, 1, sp).toFixed(3)})` });
        if (t >= t0) active = i;
      });
      if (active >= 0) {
        css(sel, { opacity: '1', transform: `translate(${34 + 64 + 64}px, ${ROW0 - SHEET_Y + active * 30}px)` });
        text(fx, rows[active].text);
      } else css(sel, { opacity: '0' });

      // Flying clause pill (slow rows only).
      let fly = null;
      HL.forEach((t0, i) => {
        if (t >= t0 + 0.28 && t < t0 + 0.62) fly = { i, p: range(t, t0 + 0.28, t0 + 0.62) };
      });
      if (fly) {
        const p = E.inOutCubic(fly.p);
        const x0 = PAGE_X + 44;
        const y0 = hlY(fly.i) - 6;
        const x1 = 620 + 34 + 64;
        const y1 = ROW0 + fly.i * 30 + 2;
        const x = lerp(x0, x1, p);
        const y = lerp(y0, y1, p) - Math.sin(Math.PI * p) * 70;
        text(flyer, ROWS[fly.i][1]);
        css(flyer, { opacity: String(Math.min(1, fly.p * 6, (1 - fly.p) * 6)), transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 + 0.25 * Math.sin(Math.PI * p)).toFixed(3)})` });
      } else css(flyer, { opacity: '0' });

      const n = t < FF0 ? rows.filter((_, i) => i < 4 && t >= HL[i] + 0.4).length : Math.round(lerp(4, 214, E.inOutCubic(range(t, FF0, FF1))));
      text(counter, String(n));
      toggle(exportBtn, 'pressed', t >= EXPORT && t < EXPORT + 0.12);
      const tp = spring(t - (EXPORT + 0.15), 3, 0.62);
      css(toast, { opacity: String(Math.min(1, tp * 2)), transform: `translateY(${lerp(40, 0, tp).toFixed(2)}px)` });
    },
  };
}
