// Clip 01: agent searches a (fictional) federal contract-opportunities portal,
// scores results, extracts key dates, and adds the best fit to the capture pipeline.
import { h, box, css, text, toggle, range, lerp, E, spring, typed } from '../engine.js';

const QUERY = 'base operations support';
const RESULTS = [
  {
    title: 'Base Operations Support Services (BOSS), Southeast Region',
    meta: 'Department of the Army  ·  Solicitation  ·  NAICS 561210',
    tags: ['Small Business Set-Aside', 'Due Oct 28, 2026'],
    fit: 96,
  },
  {
    title: 'Facilities Maintenance & Logistics Support, Naval Station',
    meta: 'Department of the Navy  ·  Sources Sought  ·  NAICS 561210',
    tags: ['Full & Open', 'Due Oct 14, 2026'],
    fit: 88,
  },
  {
    title: 'Installation Support Services IDIQ',
    meta: 'Department of the Air Force  ·  Presolicitation  ·  NAICS 561210',
    tags: ['Full & Open', 'Due Nov 3, 2026'],
    fit: 81,
  },
  {
    title: 'Supply Chain & Warehouse Operations Support',
    meta: 'Defense Logistics Agency  ·  Solicitation  ·  NAICS 493110',
    tags: ['8(a) Set-Aside', 'Due Nov 12, 2026'],
    fit: 74,
  },
];
const FILTERS = [
  ['Notice type', [['Solicitation', true], ['Sources sought', false], ['Presolicitation', false]]],
  ['NAICS', [['561210 · Facilities support', false, 'naics'], ['488190 · Air transport support', false]]],
  ['Set-aside', [['Small business', false], ['8(a)', false]]],
  ['Response due', [['Next 45 days', true]]],
];

const SEAL =
  '<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15.5" fill="none" stroke="#C9D6EA" stroke-width="1.6"/><circle cx="17" cy="17" r="11.5" fill="none" stroke="#C9D6EA" stroke-width="1"/><path d="M17 9.5l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L17 20.3l-4.4 2.5 1.1-4.9-3.8-3.3 5-.5z" fill="#C9D6EA"/></svg>';
const MAG =
  '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export function createPortal() {
  const qText = h('span', { class: 'qtext' });
  const caret = h('span', { class: 'caret' });
  const placeholder = h('span', { class: 'ph', text: 'Search keywords, NAICS, agency…' });
  const input = h('div', { class: 'p-input', style: box(40, 118, 780, 52) }, h('span', { class: 'mag', html: MAG }), placeholder, qText, caret);
  const btn = h('div', { class: 'p-btn', style: box(836, 118, 150, 52), text: 'Search' });

  // Filters sidebar (absolute rows so the cursor can target them exactly).
  const side = h('div', { class: 'p-side', style: box(40, 196, 250, 500) }, h('div', { class: 'p-sideh', text: 'Filters' }));
  let y = 36;
  let naicsBox;
  for (const [label, opts] of FILTERS) {
    side.append(h('div', { class: 'p-glabel', style: box(0, y, 250, 20), text: label }));
    y += 24;
    for (const [name, on, key] of opts) {
      const cb = h('div', { class: `cb${on ? ' on' : ''}`, text: '✓' });
      side.append(h('div', { class: 'p-opt', style: box(0, y, 250, 22) }, cb, h('span', { text: name })));
      if (key === 'naics') naicsBox = cb;
      y += 28;
    }
    y += 12;
  }

  const count = h('div', { class: 'p-count', style: box(0, 0, 924, 28) }, h('b', { text: '38 results' }), h('span', { text: '  ·  sorted by best match' }));
  const empty = h('div', { class: 'p-empty', style: box(0, 60, 924, 300) }, h('div', { class: 'p-emptyi', html: MAG }), h('div', { text: 'Search to see matching opportunities' }));
  const skels = [0, 1, 2, 3].map((i) =>
    h('div', { class: 'p-skel', style: box(0, 40 + i * 118, 924, 106) }, h('i', { style: { width: '62%' } }), h('i', { style: { width: '40%' } }), h('i', { style: { width: '28%' } })),
  );
  const cards = RESULTS.map((r, i) => {
    const fit = h('div', { class: 'p-fit', style: box(924 - 118, 16, 98, 28) }, h('b', { text: `${r.fit}%` }), h('span', { text: ' fit' }));
    const add = h('div', { class: 'p-add', style: box(924 - 170, 60, 150, 34), text: 'Add to pipeline' });
    const tagEls = r.tags.map((tg, j) => h('div', { class: 'p-tag', style: box(20 + j * 206, 68, j ? 150 : 196, 26), text: tg }));
    const hl = [0, 1].map((j) =>
      h('div', { class: 'p-hl', style: box(14 + j * 206, 62, (j ? 150 : 196) + 12, 38) }, h('span', { text: j ? 'due date' : 'set-aside' })),
    );
    const card = h(
      'div',
      { class: 'p-card', style: box(0, 40 + i * 118, 924, 106) },
      h('div', { class: 'p-ctitle', style: box(20, 14, 740, 24), text: r.title }),
      h('div', { class: 'p-cmeta', style: box(20, 42, 740, 20), text: r.meta }),
      tagEls,
      fit,
      add,
      i === 0 ? hl : null,
    );
    return { card, fit, add, hl };
  });
  const scan = h('div', { class: 'p-scan', style: box(-8, 40, 940, 90) });
  const results = h('div', { class: 'p-results', style: box(316, 196, 924, 510) }, count, empty, skels, cards.map((c) => c.card), scan);

  const toast = h(
    'div',
    { class: 'p-toast', style: box(890, 612, 360, 74) },
    h('div', { class: 'tick', text: '✓' }),
    h('div', {}, h('b', { text: 'Added to capture pipeline' }), h('span', { text: 'Bid / no-bid review · Tue 10:00' })),
  );

  const root = h(
    'div',
    { class: 'app portal', style: box(0, 0, 1280, 716) },
    h(
      'div',
      { class: 'p-head', style: box(0, 0, 1280, 58) },
      h('span', { class: 'seal', html: SEAL }),
      h('div', { class: 'p-brand' }, h('b', { text: 'Contract Opportunities' }), h('span', { text: 'Federal Acquisition Portal' })),
      h('div', { class: 'p-nav' }, h('span', { class: 'on', text: 'Search' }), h('span', { text: 'Workspace' }), h('span', { text: 'Saved' }), h('i', { class: 'avatar' })),
    ),
    h('div', { class: 'p-title', style: box(40, 76, 700, 30), text: 'Search contract opportunities' }),
    input,
    btn,
    side,
    results,
    toast,
  );

  const T = { type0: 1.0, type1: 1.85, naics: 2.4, search: 2.9, results: 3.25, add: 4.7, toast: 5.1 };

  return {
    root,
    agent: 'agent-01',
    task: 'Find base-ops opportunities that fit our past performance. Add the best one to the pipeline.',
    url: 'opportunities.acquisition-portal.fed/search',
    cursor: [
      [0.2, 1010, 560], [0.9, 300, 146], [1.95, 300, 146], [2.35, 50, 386], [2.5, 50, 386],
      [2.85, 911, 146], [3.35, 911, 146], [4.0, 860, 420], [4.62, 1140, 312], [5.3, 1140, 312], [6.2, 1180, 360],
    ],
    clicks: [0.95, T.naics, T.search, T.add],
    camera: [[0, 1, 640, 358], [3.3, 1, 640, 358], [3.95, 1.4, 770, 300], [4.9, 1.4, 770, 300], [5.45, 1, 640, 358]],
    typing: [[T.type0, T.type1, QUERY.length]],
    sfx: [[T.results, 'pop'], [3.55, 'blip'], [4.05, 'blip'], [4.15, 'blip'], [T.toast, 'success']],
    log: [
      { t: 0.2, verb: 'NAVIGATE', text: 'Contract Opportunities portal' },
      { t: 0.95, verb: 'TYPE', text: '"base operations support"' },
      { t: 2.4, verb: 'FILTER', text: 'NAICS 561210 · Facilities support' },
      { t: 2.9, verb: 'CLICK', text: 'Search → 38 results' },
      { t: 3.45, verb: 'READ', text: '38 notices, ranked vs. past performance' },
      { t: 4.05, verb: 'EXTRACT', text: 'Due Oct 28 · SB set-aside · Army' },
      { t: 4.7, verb: 'CLICK', text: 'Add to pipeline' },
      { t: 5.15, verb: 'DONE', text: 'Bid/no-bid review scheduled', done: true },
    ],
    speed: () => '1× speed',
    update(t) {
      const q = typed(t, QUERY, T.type0, T.type1);
      text(qText, q);
      css(placeholder, { opacity: q ? '0' : '1' });
      toggle(input, 'focus', t >= 0.95);
      const blink = t < T.type1 + 0.15 || Math.floor(t * 3) % 2 === 0;
      css(caret, { opacity: t >= 0.95 && t < T.search && blink ? '1' : '0' });
      toggle(naicsBox, 'on', t >= T.naics + 0.02);
      toggle(btn, 'pressed', t >= T.search && t < T.search + 0.12);

      css(empty, { opacity: t < T.search + 0.05 ? '1' : '0' });
      css(count, { opacity: String(range(t, T.results, T.results + 0.2)) });
      skels.forEach((s) => css(s, { opacity: t >= T.search + 0.05 && t < T.results + 0.1 ? '1' : '0' }));
      cards.forEach((c, i) => {
        const p = E.outExpo(range(t, T.results + i * 0.07, T.results + i * 0.07 + 0.45));
        css(c.card, { opacity: String(p), transform: `translateY(${lerp(18, 0, p).toFixed(2)}px)` });
        const fp = spring(t - (3.55 + i * 0.1), 4, 0.55);
        css(c.fit, { opacity: String(Math.min(1, fp * 1.5)), transform: `scale(${lerp(0.6, 1, fp).toFixed(3)})` });
        c.hl.forEach((hl, j) => {
          const hp = spring(t - (4.05 + j * 0.1), 3.6, 0.6);
          css(hl, { opacity: String(Math.min(1, hp * 1.6)), transform: `scale(${lerp(1.18, 1, hp).toFixed(3)})` });
        });
      });
      const added = t >= T.add + 0.02;
      toggle(cards[0].add, 'added', added);
      text(cards[0].add, added ? '✓ In pipeline' : 'Add to pipeline');

      const sp = range(t, 3.4, 4.0);
      css(scan, { opacity: sp > 0 && sp < 1 ? '1' : '0', transform: `translateY(${lerp(0, 380, E.inOutCubic(sp)).toFixed(1)}px)` });

      const tp = spring(t - T.toast, 3, 0.62);
      css(toast, { opacity: String(Math.min(1, tp * 2)), transform: `translateY(${lerp(40, 0, tp).toFixed(2)}px)` });
    },
  };
}
