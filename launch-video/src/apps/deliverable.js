// Clip 04: agent fills a (fictional) contractor deliverables portal, uploads the CDRL,
// pauses for a human approval, then submits.
import { h, box, css, text, toggle, range, lerp, E, spring, typed } from '../engine.js';

const CONTRACT = 'FA0000-26-C-0042';
const PERIOD = 'Sep 2026';
const OPTIONS = ['A001 · Contract Work Breakdown Structure', 'A002 · Quality Control Plan', 'A003 · Monthly Status Report'];
const CARD_X = 190;
const CARD_Y = 104;

const T = {
  c0: 0.7, c1: 1.3, open: 1.72, pick: 2.15, p0: 2.55, p1: 2.85, browse: 3.25, up0: 3.35, up1: 3.95,
  notify: 4.2, wait: 4.6, approved: 5.3, submit: 5.7, success: 5.85,
};

const CHECK =
  '<svg width="120" height="120" viewBox="0 0 120 120"><circle class="ring" cx="60" cy="60" r="52" fill="none" stroke="#39B54A" stroke-width="6" pathLength="1"/><path class="mark" d="M38 62 L53 77 L84 45" fill="none" stroke="#39B54A" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>';
const UP =
  '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 20V6M9 12l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20v4h20v-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export function createDeliverable() {
  const input = (x, y, w) => {
    const v = h('span', { class: 'v' });
    const caret = h('span', { class: 'caret' });
    const el = h('div', { class: 'd-input', style: box(x, y, w, 46) }, v, caret);
    return { el, v, caret };
  };
  const contract = input(40, 122, 820);
  const selV = h('span', { class: 'v ph', text: 'Select a deliverable…' });
  const select = h('div', { class: 'd-input d-select', style: box(40, 208, 820, 46) }, selV, h('span', { class: 'chev', text: '▾' }));
  const optEls = OPTIONS.map((o, i) => h('div', { class: 'd-opt', style: box(0, i * 42, 820, 42), text: o }));
  const dropdown = h('div', { class: 'd-dd', style: box(40, 258, 820, 126) }, optEls);
  const period = input(40, 294, 400);
  const format = h('div', { class: 'd-input d-select', style: box(460, 294, 400, 46) }, h('span', { class: 'v', text: 'PDF' }), h('span', { class: 'chev', text: '▾' }));

  const bar = h('i');
  const fileState = h('span', { class: 'fs', text: 'Uploading…' });
  const file = h(
    'div',
    { class: 'd-file' },
    h('div', { class: 'pdf', text: 'PDF' }),
    h('div', { class: 'fn' }, h('b', { text: 'A003_MSR_Sep2026.pdf' }), h('span', { text: '2.4 MB' })),
    fileState,
    h('div', { class: 'd-prog' }, bar),
  );
  const dropHint = h('div', { class: 'd-drophint' }, h('span', { html: UP }), h('span', {}, 'Drop files here or ', h('u', { text: 'browse' })));
  const drop = h('div', { class: 'd-drop', style: box(40, 362, 820, 104) }, dropHint, file);
  const notifyCb = h('div', { class: 'cb', text: '✓' });
  const notify = h('div', { class: 'p-opt d-notify', style: box(40, 488, 400, 22) }, notifyCb, h('span', { text: 'Notify COR on submission' }));
  const submitLbl = h('span', { text: 'Submit' });
  const spin = h('span', { class: 'spin' });
  const submit = h('div', { class: 'd-btn primary', style: box(700, 528, 160, 46) }, spin, submitLbl);

  const form = h(
    'div',
    { class: 'd-form', style: box(0, 0, 900, 596) },
    h('div', { class: 'd-h', style: box(40, 26, 700, 32), text: 'Submit deliverable' }),
    h('div', { class: 'd-sub', style: box(40, 62, 700, 20), text: 'CDRLs are routed to the COR and Contracting Officer on submission.' }),
    h('label', { style: box(40, 100, 300, 18), text: 'Contract number' }),
    contract.el,
    h('label', { style: box(40, 186, 300, 18), text: 'CDRL / Deliverable' }),
    select,
    h('label', { style: box(40, 272, 300, 18), text: 'Reporting period' }),
    period.el,
    h('label', { style: box(460, 272, 300, 18), text: 'Format' }),
    format,
    drop,
    notify,
    h('div', { class: 'd-btn', style: box(530, 528, 150, 46), text: 'Save draft' }),
    submit,
    dropdown,
  );
  const success = h(
    'div',
    { class: 'd-success', style: box(0, 0, 900, 596) },
    h('div', { class: 'd-check', html: CHECK }),
    h('div', { class: 'd-sh', text: 'Deliverable submitted' }),
    h('div', { class: 'd-ss', text: 'Confirmation DLV-58213  ·  Sep 27, 2026 14:41 ET  ·  COR notified' }),
  );
  const card = h('div', { class: 'd-card', style: box(CARD_X, CARD_Y, 900, 596) }, form, success);

  const root = h(
    'div',
    { class: 'app deliverable', style: box(0, 0, 1280, 716) },
    h(
      'div',
      { class: 'd-head', style: box(0, 0, 1280, 56) },
      h('div', { class: 'd-logo' }, h('i'), h('b', { text: 'Contractor Deliverables Portal' })),
      h('div', { class: 'p-nav' }, h('span', { text: 'Contracts' }), h('span', { class: 'on', text: 'Deliverables' }), h('span', { text: 'Messages' }), h('i', { class: 'avatar' })),
    ),
    h('div', { class: 'd-crumb', style: box(CARD_X, 70, 900, 20), text: `Contracts  /  ${CONTRACT}  /  Deliverables  /  New submission` }),
    card,
  );

  const at = (x, y) => [CARD_X + x, CARD_Y + y];
  const [cx, cy] = at(420, 145);
  const [sx, sy] = at(420, 231);
  const [ox, oy] = at(330, 258 + 2 * 42 + 21);
  const [px, py] = at(160, 317);
  const [dx, dy] = at(420, 414);
  const [nx, ny] = at(49, 499);
  const [bx, by] = at(780, 551);

  return {
    root,
    agent: 'agent-04',
    task: 'Submit the September CDRL A003 status report. Get PM approval before submitting.',
    url: 'deliverables.contractor-portal.fed/contracts/FA0000-26-C-0042/new',
    cursor: [
      [0.2, 980, 660], [0.6, cx, cy], [1.4, cx, cy], [1.68, sx, sy], [1.8, sx, sy], [2.08, ox, oy], [2.2, ox, oy],
      [2.45, px, py], [3.0, px, py], [3.2, dx, dy], [3.95, dx, dy], [4.15, nx, ny], [4.3, nx, ny], [4.55, bx, by], [6.4, bx + 20, by + 10],
    ],
    clicks: [0.65, T.open, T.pick, 2.5, T.browse, T.notify, T.submit],
    camera: [
      [0, 1, 640, 358], [0.3, 1, 640, 358], [0.75, 1.3, 640, 300], [2.9, 1.3, 640, 330], [3.25, 1.3, 640, 470],
      [3.95, 1.3, 640, 470], [4.45, 1, 640, 358], [5.85, 1, 640, 358], [6.5, 1.1, 640, 400],
    ],
    typing: [[T.c0, T.c1, CONTRACT.length], [T.p0, T.p1, PERIOD.length]],
    sfx: [[T.open + 0.03, 'blip'], [T.up1, 'blip'], [T.wait, 'alert'], [T.success, 'success']],
    log: [
      { t: 0.2, verb: 'OPEN', text: `Deliverables portal · ${CONTRACT}` },
      { t: T.c0, verb: 'TYPE', text: 'Contract number' },
      { t: T.pick, verb: 'SELECT', text: 'CDRL A003 · Monthly Status Report' },
      { t: T.p0, verb: 'TYPE', text: 'Reporting period · Sep 2026' },
      { t: T.up0, verb: 'UPLOAD', text: 'A003_MSR_Sep2026.pdf · 2.4 MB' },
      { t: T.notify, verb: 'CHECK', text: 'Notify COR on submission' },
      { t: T.wait, verb: 'PAUSE', text: 'Human approval required to submit' },
      { t: T.approved, verb: 'APPROVED', text: 'Program Manager' },
      { t: T.submit, verb: 'CLICK', text: 'Submit' },
      { t: T.success + 0.05, verb: 'DONE', text: 'Confirmation DLV-58213', done: true },
    ],
    // Human-in-the-loop card rendered at stage level by the clip scene.
    approval: { show: T.wait, click: 5.2, approved: T.approved, hide: 5.95 },
    speed: () => '1× speed',
    update(t) {
      const c = typed(t, CONTRACT, T.c0, T.c1);
      text(contract.v, c);
      css(contract.caret, { opacity: t >= 0.65 && t < T.open && (t < T.c1 + 0.1 || Math.floor(t * 3) % 2 === 0) ? '1' : '0' });
      toggle(contract.el, 'focus', t >= 0.65 && t < T.open);

      const open = t >= T.open && t < T.pick + 0.05;
      toggle(select, 'focus', open);
      const dp = E.outExpo(range(t, T.open, T.open + 0.2));
      css(dropdown, { opacity: open ? String(dp) : '0', transform: `translateY(${lerp(-8, 0, dp).toFixed(1)}px)` });
      optEls.forEach((o, i) => toggle(o, 'hover', i === 2 && t >= 2.0));
      text(selV, t >= T.pick ? OPTIONS[2] : 'Select a deliverable…');
      toggle(selV, 'ph', t < T.pick);

      const p = typed(t, PERIOD, T.p0, T.p1);
      text(period.v, p);
      toggle(period.el, 'focus', t >= 2.5 && t < T.browse);
      css(period.caret, { opacity: t >= 2.5 && t < T.browse && (t < T.p1 + 0.1 || Math.floor(t * 3) % 2 === 0) ? '1' : '0' });

      const up = range(t, T.up0, T.up1);
      css(dropHint, { opacity: t < T.up0 ? '1' : '0' });
      css(file, { opacity: t >= T.up0 ? '1' : '0', transform: `scale(${lerp(0.96, 1, E.outExpo(range(t, T.up0, T.up0 + 0.3))).toFixed(3)})` });
      css(bar, { width: `${(E.inOutCubic(up) * 100).toFixed(1)}%` });
      text(fileState, t >= T.up1 ? '✓ Uploaded · scanned clean' : `Uploading… ${Math.round(E.inOutCubic(up) * 100)}%`);
      toggle(fileState, 'ok', t >= T.up1);
      toggle(drop, 'active', t >= T.browse && t < T.up0 + 0.1);

      toggle(notifyCb, 'on', t >= T.notify + 0.02);

      const waiting = t >= T.wait && t < T.approved;
      toggle(submit, 'waiting', waiting);
      toggle(submit, 'ready', t >= T.approved && t < T.submit);
      toggle(submit, 'pressed', t >= T.submit && t < T.submit + 0.12);
      text(submitLbl, waiting ? 'Awaiting approval' : 'Submit');

      const sp = E.outExpo(range(t, T.success, T.success + 0.5));
      css(form, { opacity: String(1 - range(t, T.success, T.success + 0.15)) });
      css(success, { opacity: String(sp), transform: `scale(${lerp(0.96, 1, sp).toFixed(3)})` });
      const ring = success.querySelector('.ring');
      const mark = success.querySelector('.mark');
      css(ring, { strokeDashoffset: String(1 - E.outCubic(range(t, T.success, T.success + 0.45))), strokeDasharray: '1' });
      css(mark, { strokeDashoffset: String(1 - E.outCubic(range(t, T.success + 0.25, T.success + 0.55))), strokeDasharray: '1' });
    },
  };
}
