// The rail list (UI spec §5.3): a hand-written virtual list with fixed 40 px rows and sticky section headers
// ("Buildings 350", "Grounds areas 20"): the 28 px column header above the scroller names the section at the top of
// the viewport (so it costs no row), later sections get a 28 px in-flow header. At most 40 rows mounted, role=listbox with aria-activedescendant
// (↑/↓, Home/End, PgUp/PgDn move; Enter selects and frames), hover ↔ store.hoverId, a 600 ms flash and scroll when
// the selection comes from elsewhere (3D, J/K, Add), and an "N new ↓" pill while a read streams rows below the fold.

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, CircleAlert, CircleCheck, Flag } from 'lucide-react';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import { FACILITY_STATUSES, type Facility, type GroundsArea } from '@shared/types';
import { useStore } from '../../store';
import type { RowMeta } from '../../derived';
import { ZONE_COLORS, ZONE_LABELS } from '../../three/layout';
import { n0, n1, n2 } from '../../fmt';
import { CONF_COLOR, CONF_GLYPH, categoryColor } from '../lib/theme';
import { ISSUE_INFO, issueDetail } from '../lib/review';
import { cx } from '../lib/cx';
import { localSelectId, markLocalSelect, selectRow } from './reviewLoop';

export type ListItem =
  | { t: 'head'; key: string; label: string; count: number; note?: string }
  | { t: 'f'; f: Facility; incoming?: boolean }
  | { t: 'g'; g: GroundsArea; incoming?: boolean };

export const ROW_H = 40;
export const HEAD_H = 28;
const MAX_MOUNTED = 40;

export const itemId = (it: ListItem) => (it.t === 'head' ? `head-${it.key}` : it.t === 'f' ? it.f.id : it.g.id);
const optId = (id: string) => `inv-opt-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export const SERVICE_SHORT: Record<string, string> = { daily_7: 'Daily 7d', daily_6: 'Daily 6d', daily_5: 'Daily 5d', '3x_week': '3×/wk', '2x_week': '2×/wk', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly' };
const catShort = (f: Facility) => CATEGORY_DEFAULTS[f.category]?.label.split(' /')[0] ?? f.category;
const statusText = (f: Facility) => FACILITY_STATUSES.find((s) => s.id === f.status)?.label ?? 'Not in scope';
const UNIT_SHORT: Record<string, string> = { acres: 'ac', hectares: 'ha', each: 'ea', sqyd: 'SY', lf: 'LF', sqm: 'm²', sqft: 'SF' };
/** The rail's 72 px metrics column: full digits while they fit (≤ 7 characters), then 1.42M / 68.5K. */
export const railNum = (v: number, decimals = 0, max = 7) => {
  const full = decimals ? n1(v) : n0(v);
  if (full.length <= max) return full;
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 2)}M` : `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
};
/** quantity and unit within the column's 9 characters ("6,850 SF", "310.0K SF", "1.42M SF", "42.5 ac") */
const groundsQty = (g: GroundsArea) => { const u = UNIT_SHORT[g.unit] ?? g.unit; return `${railNum(g.quantity, g.unit === 'acres' || g.unit === 'hectares' ? 1 : 0, 8 - u.length)} ${u}`; };
/** Short kind label for the # column of a grounds row (never cut in code). */
export const KIND_SHORT: Record<GroundsArea['kind'], string> = { improved_turf: 'Turf', semi_improved: 'Semi', unimproved: 'Rough', athletic_field: 'Field', shrub_bed: 'Beds', parking: 'Lots', sidewalk: 'Walks', tree_canopy: 'Trees' };

/** The list set hoverId for this row (so an unmounting row clears only its own hover, not one the 3D view set). */
let listHover: string | null = null;
const hoverFromList = (id: string | null) => { listHover = id; useStore.getState().setHover(id); };
/** A hovered row filtered away (typing, a chip) unmounts without mouseleave: drop its hover with it. */
function useHoverCleanup(id: string) {
  useEffect(() => () => { const s = useStore.getState(); if (listHover === id && s.hoverId === id) { listHover = null; s.setHover(null); } }, [id]);
}

export interface InventoryListHandle { scrollToId(id: string, align?: 'nearest' | 'center'): void; focus(): void; element: HTMLDivElement | null }

interface Props {
  items: ListItem[];
  rowMeta: ReadonlyMap<string, RowMeta>;
  fteOf: (id: string) => number | undefined;
  maxFte: number;
  hostName: (id: string) => string | undefined;
  empty: ReactNode;
  label: string;
  /** the column header row; receives the section at the top of the viewport (the sticky section header) */
  header: (section: { label: string; count: number; note?: string } | null, sections: number) => ReactNode;
}

export const InventoryList = memo(forwardRef<InventoryListHandle, Props>(function InventoryList({ items, rowMeta, fteOf, maxFte, hostName, empty, label, header }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, h: 500 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const reduced = useStore((s) => s.reducedMotion);
  const selectedId = useStore((s) => (s.selection.kind === null ? null : s.selection.id));
  const recent = useStore((s) => (s.extraction.running ? s.extraction.recent : null));

  // geometry: cumulative tops (heads 28, rows 40)
  const { tops, total, index } = useMemo(() => {
    const t = new Float64Array(items.length + 1); let y = 0;
    const idx = new Map<string, number>();
    // the first section header lives in the column header row (zero height in the list)
    for (let i = 0; i < items.length; i++) { t[i] = y; y += items[i].t === 'head' ? (i === 0 ? 0 : HEAD_H) : ROW_H; idx.set(itemId(items[i]), i); }
    t[items.length] = y;
    return { tops: t, total: y, index: idx };
  }, [items]);
  const at = useCallback((y: number) => { // first item whose bottom is below y
    let lo = 0, hi = items.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid + 1] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  }, [tops, items.length]);

  const measure = useCallback(() => {
    const s = el.current; if (!s) return;
    setVp((v) => (v.top === s.scrollTop && v.h === s.clientHeight ? v : { top: s.scrollTop, h: s.clientHeight }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const s = el.current; if (!s) return;
    const ro = new ResizeObserver(measure); ro.observe(s);
    return () => ro.disconnect();
  }, [measure]);

  const scrollToIndex = useCallback((i: number, align: 'nearest' | 'center' = 'nearest') => {
    const s = el.current; if (!s || i < 0 || i >= items.length) return;
    const top = tops[i], bottom = tops[i + 1];
    let next = s.scrollTop;
    if (align === 'center') next = top - (s.clientHeight - (bottom - top)) / 2;
    else if (top < s.scrollTop) next = top;
    else if (bottom > s.scrollTop + s.clientHeight) next = bottom - s.clientHeight;
    s.scrollTop = Math.max(0, next);
    measure();
  }, [items, tops, measure]);

  useImperativeHandle(ref, () => ({
    element: el.current,
    focus: () => el.current?.focus({ preventScroll: true }),
    scrollToId(id, align = 'nearest') { const i = index.get(id); if (i != null) scrollToIndex(i, align); },
  }), [index, scrollToIndex]);

  // the selection came from elsewhere (3D click, J/K, Add, search Enter): scroll to it and flash it once (600 ms)
  const firstRender = useRef(true);
  useEffect(() => {
    if (!selectedId) return;
    const local = localSelectId === selectedId; markLocalSelect(null);
    const i = index.get(selectedId);
    if (i == null) return;
    setCursor(selectedId);
    if (local && !firstRender.current) return;
    const s = el.current;
    const far = s ? tops[i] < s.scrollTop - 4 * ROW_H || tops[i] > s.scrollTop + s.clientHeight + 4 * ROW_H : false;
    scrollToIndex(i, far ? 'center' : 'nearest');
    if (!firstRender.current && !reduced) { setFlash(selectedId); const t = setTimeout(() => setFlash(null), 650); return () => clearTimeout(t); }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { firstRender.current = false; }, []);

  // ---- keyboard (listbox) ----
  const selectable = (i: number) => i >= 0 && i < items.length && items[i].t !== 'head' && !(items[i] as { incoming?: boolean }).incoming;
  const moveCursor = (i: number) => {
    const it = items[i]; if (!it || it.t === 'head') return;
    const id = itemId(it);
    setCursor(id);
    scrollToIndex(i);
    hoverFromList(id);
  };
  const step = (from: number, dir: 1 | -1, n = 1) => {
    let i = from; let moved = 0;
    while (moved < n) { let j = i + dir; while (j >= 0 && j < items.length && items[j].t === 'head') j += dir; if (j < 0 || j >= items.length) break; i = j; moved++; }
    return i;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = cursor != null ? index.get(cursor) ?? -1 : -1;
    const page = Math.max(1, Math.floor(vp.h / ROW_H) - 1);
    let next = -2;
    switch (e.key) {
      case 'ArrowDown': next = cur < 0 ? step(-1, 1) : step(cur, 1); break;
      case 'ArrowUp': next = cur < 0 ? step(items.length, -1) : step(cur, -1); break;
      case 'PageDown': next = step(Math.max(cur, 0), 1, page); break;
      case 'PageUp': next = step(Math.max(cur, 0), -1, page); break;
      case 'Home': next = step(-1, 1); break;
      case 'End': next = step(items.length, -1); break;
      case 'Enter': {
        const i = cur >= 0 ? cur : step(-1, 1);
        if (selectable(i)) { e.preventDefault(); setKbd(true); selectRow(itemId(items[i]), { local: true }); }
        return;
      }
      default: return;
    }
    e.preventDefault();
    setKbd(true);
    if (next >= 0 && next < items.length) moveCursor(next);
  };

  // ---- render window ----
  const n = items.length;
  let first = 0, last = -1;
  if (n) {
    const visFirst = at(vp.top), visLast = at(vp.top + vp.h);
    const visible = visLast - visFirst + 1;
    const over = Math.max(0, Math.min(8, Math.floor((MAX_MOUNTED - visible) / 2)));
    first = Math.max(0, visFirst - over); last = Math.min(n - 1, visLast + over);
  }
  const heads = useMemo(() => items.reduce((k, it) => k + (it.t === 'head' ? 1 : 0), 0), [items]);
  // sticky section header: the section of the first visible row (shown in the column header row)
  let sticky: Extract<ListItem, { t: 'head' }> | null = null;
  if (n) {
    const top = at(vp.top + 0.5);
    for (let i = top; i >= 0; i--) if (items[i].t === 'head') { sticky = items[i] as Extract<ListItem, { t: 'head' }>; break; }
  }
  // "N new ↓": rows found in this run below the viewport
  let below = 0; let firstBelow = -1;
  if (recent) {
    const lastVisible = at(vp.top + vp.h - 1);
    for (let i = lastVisible + 1; i < n; i++) { const id = itemId(items[i]); if (recent[id]) { below++; if (firstBelow < 0) firstBelow = i; } }
  }

  const rows: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const it = items[i];
    const id = itemId(it);
    const style = { top: tops[i], height: tops[i + 1] - tops[i] };
    let node: ReactNode;
    if (it.t === 'head') { if (i === 0) continue; node = <SectionHead label={it.label} count={it.count} note={it.note} />; }
    else if (it.t === 'f') node = <FacilityRow f={it.f} meta={it.incoming ? undefined : rowMeta.get(id)} fte={it.incoming ? undefined : fteOf(id)} maxFte={maxFte} incoming={it.incoming} flash={flash === id} cursor={kbd && cursor === id} />;
    else node = <GroundsRow g={it.g} meta={it.incoming ? undefined : rowMeta.get(id)} fte={it.incoming ? undefined : fteOf(id)} maxFte={maxFte} host={it.g.facilityId ? hostName(it.g.facilityId) : undefined} incoming={it.incoming} flash={flash === id} cursor={kbd && cursor === id} />;
    rows.push(<div key={id} className="inv-vrow" style={style}>{node}</div>);
  }
  const activeId = cursor && index.has(cursor) && items[index.get(cursor)!].t !== 'head' ? optId(cursor) : undefined;

  return (
    <div className="inv__listwrap">
    {header(sticky ? { label: sticky.label, count: sticky.count, note: sticky.note } : null, heads)}
    <div ref={el} className="inv__list" role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={activeId}
      onScroll={measure} onKeyDown={onKeyDown}
      onMouseDown={() => setKbd(false)}
      onFocus={() => { if (!cursor && selectedId) setCursor(selectedId); }}
      onBlur={() => { if (kbd && cursor && useStore.getState().hoverId === cursor) hoverFromList(null); }}>
      {n === 0 ? empty : (
        <>
          <div className="inv__inner" style={{ height: total }}>{rows}</div>
        </>
      )}
      {below > 0 && (
        <button type="button" className="inv-newpill" onClick={() => scrollToIndex(firstBelow, 'center')}>
          {below.toLocaleString()} new <ArrowDown size={12} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
    </div>
  );
}));

function SectionHead({ label, count, note }: { label: string; count: number; note?: string }) {
  return <div className="inv-sec" role="presentation"><span className="inv-sec__label">{label}</span><span className="inv-sec__count">{count.toLocaleString()}</span>{note && <span className="inv-sec__note">{note}</span>}</div>;
}

function useRowState(id: string, incoming?: boolean) {
  const selected = useStore((s) => !incoming && s.selection.kind !== null && s.selection.id === id);
  const hovered = useStore((s) => s.hoverId === id);
  const recentAt = useStore((s) => (s.extraction.running ? s.extraction.recent[id] : undefined));
  return { selected, hovered, isNew: recentAt != null && Date.now() - recentAt < 2500 };
}

function issuesTitle(meta: RowMeta | undefined, row: Facility | GroundsArea): string {
  if (!meta) return '';
  const counting = meta.issues.filter((i) => ISSUE_INFO[i].counts);
  return counting.map((i) => issueDetail(i, row)).join('\n');
}

function StateIcon({ meta, row }: { meta?: RowMeta; row: Facility | GroundsArea }) {
  if (meta?.review === 'flagged') return <span title="Flagged" className="inv-row__icon"><Flag size={13} color="var(--flag)" aria-label="Flagged" /></span>;
  if (meta?.review === 'needs') return <span title={`Needs review\n${issuesTitle(meta, row)}`} className="inv-row__icon"><CircleAlert size={13} color="var(--warn)" aria-label="Needs review" /></span>;
  return null;
}

function ConfLine({ meta, conf }: { meta?: RowMeta; conf: number }) {
  const band = meta?.conf ?? 'mid';
  const pct = `${Math.round(conf * 100)}%`;
  if (meta?.review === 'verified') return <span className="inv-row__conf is-verified" title={`Verified · extracted at ${pct}`}><CircleCheck size={11} strokeWidth={2.4} aria-hidden /> {pct}</span>;
  return <span className="inv-row__conf" style={{ color: CONF_COLOR[band] }} title={`Extraction confidence ${pct}`}><span aria-hidden>{CONF_GLYPH[band]}</span> {pct}</span>;
}

const FacilityRow = memo(function FacilityRow({ f, meta, fte, maxFte, incoming, flash, cursor }: { f: Facility; meta?: RowMeta; fte?: number; maxFte: number; incoming?: boolean; flash: boolean; cursor: boolean }) {
  const { selected, hovered, isNew } = useRowState(f.id, incoming);
  const out = meta ? !meta.inScope : Boolean(f.status && f.status !== 'in_scope');
  const sub = out ? null : `${catShort(f)} · ${f.serviceFrequencyText || SERVICE_SHORT[f.serviceLevel] || f.serviceLevel}${f.dining?.mealsPerDay ? ` · ${n0(f.dining.mealsPerDay)} meals/d` : ''}`;
  const s = useStore.getState;
  useHoverCleanup(f.id);
  return (
    <div id={optId(f.id)} role="option" aria-selected={selected} aria-disabled={incoming || undefined}
      className={cx('inv-row', selected && 'is-sel', hovered && 'is-hover', isNew && 'is-new', out && 'is-out', incoming && 'is-incoming', flash && 'is-flash', cursor && 'is-cursor')}
      style={{ ['--cat' as string]: categoryColor(f.category), ['--fte' as string]: `${fte && !out ? Math.min(100, (fte / maxFte) * 100) : 0}%` }}
      onClick={incoming ? undefined : () => selectRow(f.id, { local: true })}
      onDoubleClick={incoming ? undefined : () => { selectRow(f.id, { local: true, frame: false }); if (!out) s().setFocusMode('building'); }}
      onMouseEnter={() => hoverFromList(f.id)} onMouseLeave={() => { if (s().hoverId === f.id) hoverFromList(null); }}>
      <div className="inv-row__no">
        <span className={cx('inv-row__num', !f.buildingNumber && 'is-name')} title={f.buildingNumber || f.name}>{f.buildingNumber || f.name}</span>
        <ConfLine meta={meta} conf={f.confidence} />
      </div>
      <div className="inv-row__name">
        <span className="inv-row__title" title={f.name}><span className="inv-row__title-text">{f.name}</span>{meta?.edited && <i className="inv-row__edited" title="Edited by you" aria-label="Edited" />}{!incoming && <StateIcon meta={meta} row={f} />}</span>
        {sub != null ? <span className="inv-row__sub" title={f.serviceFrequencyText ? `Frequency as printed: ${f.serviceFrequencyText}` : undefined}>{sub}</span>
          : <span className="inv-row__sub"><span className="inv-status" title={f.statusReason}>{statusText(f)}</span>{f.statusReason ? <span className="inv-row__reason"> · {f.statusReason}</span> : null}</span>}
      </div>
      <div className="inv-row__metrics">
        <span title={f.grossSqft > 0 ? `${n0(f.grossSqft)} SF gross` : undefined}>{f.grossSqft > 0 ? railNum(f.grossSqft) : '—'}</span>
        <span className="inv-row__fte" title={fte != null && !out ? `${n2(fte)} FTE` : undefined}>{out ? '—' : fte != null ? (fte >= 1e4 ? railNum(fte) : n2(fte)) : ''}</span>
      </div>
    </div>
  );
});

const GroundsRow = memo(function GroundsRow({ g, meta, fte, maxFte, host, incoming, flash, cursor }: { g: GroundsArea; meta?: RowMeta; fte?: number; maxFte: number; host?: string; incoming?: boolean; flash: boolean; cursor: boolean }) {
  const { selected, hovered, isNew } = useRowState(g.id, incoming);
  const s = useStore.getState;
  useHoverCleanup(g.id);
  const sub = [ZONE_LABELS[g.kind], host ? `at ${host}` : null, g.campus].filter(Boolean).join(' · ');
  const tip = [g.name, g.documentLabel ? `As printed: ${g.documentLabel}` : null].filter(Boolean).join('\n');
  return (
    <div id={optId(g.id)} role="option" aria-selected={selected} aria-disabled={incoming || undefined}
      className={cx('inv-row', 'inv-row--grounds', selected && 'is-sel', hovered && 'is-hover', isNew && 'is-new', incoming && 'is-incoming', flash && 'is-flash', cursor && 'is-cursor')}
      style={{ ['--cat' as string]: ZONE_COLORS[g.kind] ?? '#3f6e40', ['--fte' as string]: `${fte ? Math.min(100, (fte / maxFte) * 100) : 0}%` }}
      onClick={incoming ? undefined : () => selectRow(g.id, { local: true })}
      onMouseEnter={() => hoverFromList(g.id)} onMouseLeave={() => { if (s().hoverId === g.id) hoverFromList(null); }}>
      <div className="inv-row__no">
        <span className="inv-row__num inv-row__kind" title={ZONE_LABELS[g.kind]}>{KIND_SHORT[g.kind] ?? 'Site'}</span>
        <ConfLine meta={meta} conf={g.confidence} />
      </div>
      <div className="inv-row__name" title={tip}>
        <span className="inv-row__title"><span className="inv-row__title-text">{g.name}</span>{meta?.edited && <i className="inv-row__edited" title="Edited by you" aria-label="Edited" />}{!incoming && <StateIcon meta={meta} row={g} />}</span>
        <span className="inv-row__sub">{sub}</span>
      </div>
      <div className="inv-row__metrics">
        <span title={`${n1(g.quantity)} ${g.unit}`}>{groundsQty(g)}</span>
        <span className="inv-row__fte">{fte != null ? (fte >= 1e4 ? railNum(fte) : n2(fte)) : ''}</span>
      </div>
    </div>
  );
});
