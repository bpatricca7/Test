// Clip 03: agent drives a (fictional) 3270-style green-screen logistics system by keyboard,
// updates an inventory record, then loops the rest of a reconciliation file at 12×.
import { h, box, css, text, toggle, range, lerp, E, typed, rng } from '../engine.js';

const CW = 12; // char width at 20px JetBrains Mono
const LH = 28;
const OX = 160;
const OY = 22;
const at = (col, row) => [OX + col * CW, OY + row * LH];

const STATIC = {
  0: [[1, 'LAMS001'], [23, 'LOGISTICS ASSET MANAGEMENT SYSTEM'], [71, '09/27/26']],
  1: [[1, 'SCREEN 04B'], [29, 'INVENTORY MAINTENANCE'], [71, '14:32:07']],
  3: [[1, '─'.repeat(78)]],
  5: [[2, 'NSN  . . . . . . . . :']],
  6: [[2, 'NOMENCLATURE . . . . :']],
  7: [[2, 'UNIT OF ISSUE  . . . :']],
  8: [[2, 'LOCATION . . . . . . :']],
  9: [[2, 'QTY ON HAND  . . . . :']],
  10: [[2, 'CONDITION CODE . . . :']],
  11: [[2, 'LAST INVENTORY . . . :']],
  12: [[2, 'UNIT PRICE . . . . . :']],
  14: [[1, '─'.repeat(78)]],
  15: [[2, 'SOURCE: reconciliation.csv'], [50, 'ROW']],
  20: [[1, 'MSG:']],
  21: [[1, 'COMMAND ===>']],
  23: [[1, 'F1=HELP  F3=EXIT  F5=UPDATE  F7=BKWD  F8=FWD  F12=CANCEL']],
};

const NSN = '5340-01-234-5678';
const FIRST = { nom: 'BRACKET, MOUNTING', ui: 'EA', loc: 'WHSE 03  BAY 12  BIN C4', qty: '0012', cond: 'A', inv: '03/14/26', price: '$    48.20' };
const NOMS = ['GASKET, FLAT', 'FILTER ELEMENT, FLUID', 'BEARING, BALL, ANNULAR', 'CABLE ASSEMBLY, RF', 'SEAL, NONMETALLIC', 'VALVE, CHECK', 'BATTERY, STORAGE', 'CONNECTOR, PLUG', 'PUMP, CENTRIFUGAL', 'LAMP, INCANDESCENT', 'HOSE ASSEMBLY', 'SWITCH, TOGGLE'];

const T = { nsn0: 0.55, nsn1: 1.25, enter: 1.4, load: 1.5, tab1: 1.75, tab2: 1.9, qty0: 2.05, qty1: 2.4, f5: 2.65, ff0: 3.3, ff1: 5.4, done: 5.5 };
const REC_DT = 0.068;

export function createTerminal() {
  const screen = h('div', { class: 't-screen', style: box(0, 0, 1280, 716) });
  const rowsEls = [];
  for (const [row, parts] of Object.entries(STATIC)) {
    for (const [col, s] of parts) {
      const [x, y] = at(col, +row);
      const el = h('div', { class: `t-txt${+row <= 1 ? ' hi' : ''}`, style: { left: `${x}px`, top: `${y}px` }, text: s });
      screen.append(el);
      rowsEls.push([+row, el]);
    }
  }
  const field = (col, row, cls = '') => {
    const [x, y] = at(col, row);
    const el = h('div', { class: `t-fld ${cls}`, style: { left: `${x}px`, top: `${y}px` } });
    screen.append(el);
    rowsEls.push([row, el]);
    return el;
  };
  const f = {
    nsn: field(27, 5, 'input'),
    nom: field(27, 6),
    ui: field(27, 7),
    loc: field(27, 8),
    qty: field(27, 9, 'input'),
    cond: field(27, 10, 'input'),
    inv: field(27, 11),
    price: field(27, 12),
    row: field(54, 15),
    msg: field(6, 20, 'msg'),
    cmd: field(14, 21, 'input'),
  };
  const caret = h('div', { class: 't-caret' });
  screen.append(caret);
  const root = h('div', { class: 'app terminal', style: box(0, 0, 1280, 716) }, screen, h('div', { class: 't-scan' }), h('div', { class: 't-vig' }));

  // Deterministic stream of records for the fast-forward section.
  const r = rng(7);
  const recs = Array.from({ length: 40 }, () => {
    const d = (n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
    const q0 = Math.floor(r() * 60);
    const q1 = Math.max(0, q0 + Math.floor(r() * 30) - 10);
    return {
      nsn: `${d(4)}-01-${d(3)}-${d(4)}`,
      nom: NOMS[Math.floor(r() * NOMS.length)],
      ui: r() > 0.3 ? 'EA' : 'PG',
      loc: `WHSE 0${1 + Math.floor(r() * 4)}  BAY ${10 + Math.floor(r() * 20)}  BIN ${'ABCDE'[Math.floor(r() * 5)]}${1 + Math.floor(r() * 9)}`,
      q0: String(q0).padStart(4, '0'),
      qty: String(q1).padStart(4, '0'),
      cond: 'A',
      inv: `0${1 + Math.floor(r() * 9)}/${10 + Math.floor(r() * 18)}/26`,
      price: `$ ${(r() * 900 + 3).toFixed(2).padStart(8, ' ')}`,
    };
  });
  const pad = (s, n) => s + '_'.repeat(Math.max(0, n - s.length));
  const clock = (t) => (t < T.ff0 ? t : t < T.ff1 ? T.ff0 + (t - T.ff0) * 12 : T.ff0 + (T.ff1 - T.ff0) * 12 + (t - T.ff1));

  return {
    root,
    agent: 'agent-03',
    task: 'Reconcile 312 inventory records in LAMS from reconciliation.csv.',
    url: 'tn3270 · lams.depot.internal:992',
    cursor: null,
    clicks: [],
    keys: [[T.enter, 'ENTER'], [T.tab1, 'TAB'], [T.tab2, 'TAB'], [T.f5, 'F5']],
    camera: [[0, 1, 640, 358], [0.35, 1, 640, 358], [0.85, 1.55, 560, 210], [2.45, 1.55, 560, 210], [2.95, 1.4, 520, 480], [3.35, 1.4, 520, 480], [3.95, 1, 640, 358]],
    typing: [[T.nsn0, T.nsn1, NSN.length], [T.qty0, T.qty1, 4]],
    sfx: [
      [T.load, 'blip'],
      [T.f5 + 0.1, 'blip'],
      [T.ff0, 'ff'],
      ...Array.from({ length: Math.floor((T.ff1 - T.ff0) / (REC_DT * 2)) }, (_, i) => [T.ff0 + i * REC_DT * 2, 'tick']),
      [T.done, 'success'],
    ],
    log: [
      { t: 0.1, verb: 'CONNECT', text: 'LAMS · TN3270 session' },
      { t: T.nsn0, verb: 'TYPE', text: `NSN ${NSN}` },
      { t: T.enter, verb: 'KEY', text: 'ENTER → record loaded' },
      { t: T.qty0, verb: 'EDIT', text: 'QTY ON HAND 0012 → 0036' },
      { t: T.f5, verb: 'KEY', text: 'F5 → RECORD UPDATED' },
      { t: T.ff0, verb: 'LOOP', text: '311 more rows from reconciliation.csv' },
      { t: T.done, verb: 'DONE', text: '312 updated · 0 exceptions', done: true },
    ],
    speed: (t) => (t >= T.ff0 && t < T.ff1 ? '12× speed' : '1× speed'),
    clock,
    update(t) {
      // Boot: rows paint top to bottom.
      for (const [row, el] of rowsEls) css(el, { opacity: t >= 0.04 + row * 0.012 ? '1' : '0' });

      let rec;
      let nsn;
      let n = 1;
      let msg = '';
      let msgFlash = false;
      if (t < T.ff0) {
        nsn = pad(typed(t, NSN, T.nsn0, T.nsn1), 16);
        const loaded = t >= T.load;
        rec = loaded ? { ...FIRST, qty: t < T.qty0 ? FIRST.qty : pad(typed(t, '0036', T.qty0, T.qty1), 4).replace(/_/g, (_, i) => FIRST.qty[i]) } : null;
        if (t >= T.f5 + 0.1) {
          msg = `RECORD UPDATED  NSN ${NSN}  QTY 0012 → 0036`;
          msgFlash = t < T.f5 + 0.45;
        }
      } else {
        const k = Math.min(recs.length - 1, Math.floor((t - T.ff0) / REC_DT));
        const cyc = recs[k % recs.length];
        rec = cyc;
        nsn = cyc.nsn;
        n = t >= T.ff1 ? 312 : Math.min(311, 2 + Math.floor(range(t, T.ff0, T.ff1) * 310));
        msg = t >= T.done ? 'BATCH COMPLETE  312 RECORDS UPDATED  0 EXCEPTIONS' : `RECORD UPDATED  NSN ${cyc.nsn}  QTY ${cyc.q0} → ${cyc.qty}`;
        msgFlash = t >= T.done && t < T.done + 0.5 ? true : t < T.done && Math.floor((t - T.ff0) / REC_DT) % 2 === 0;
      }
      text(f.nsn, nsn);
      text(f.nom, rec ? rec.nom : '');
      text(f.ui, rec ? rec.ui : '');
      text(f.loc, rec ? rec.loc : '');
      text(f.qty, rec ? rec.qty : '____');
      text(f.cond, rec ? rec.cond : '_');
      text(f.inv, rec ? rec.inv : '');
      text(f.price, rec ? rec.price : '');
      text(f.row, `${String(n).padStart(4, '0')} / 0312`);
      text(f.msg, msg);
      toggle(f.msg, 'inv', msgFlash);
      text(f.cmd, '________');
      toggle(f.nom, 'flash', t >= T.load && t < T.load + 0.25);

      // Block caret follows the field being edited.
      let cc = 27;
      let cr = 5;
      if (t < T.tab1) cc = 27 + Math.min(15, typed(t, NSN, T.nsn0, T.nsn1).length);
      else if (t < T.tab2) [cc, cr] = [27, 6];
      else if (t < T.ff0) [cc, cr] = [27 + Math.min(3, typed(t, '0036', T.qty0, T.qty1).length), 9];
      else [cc, cr] = [14, 21];
      const [x, y] = at(cc, cr);
      const blink = Math.floor(t * 3.2) % 2 === 0 || (t > T.nsn0 && t < T.qty1 + 0.1);
      css(caret, { transform: `translate(${x}px, ${y + 2}px)`, opacity: t > 0.3 && t < T.done && blink ? '1' : '0' });
    },
  };
}
