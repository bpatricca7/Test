// The spreadsheet grid of the Table view (UI spec §5.6): one scroller with a sticky 34 px header and sticky
// identifier columns, ≤ 60 rows mounted, resizable and sortable columns, aria-activedescendant cell focus, and
// inline editing that commits on Enter / Tab / blur (lib/parse.ts validation; invalid input gets a --bad ring and
// an inline message and does not commit). Letters never start an edit: they are review commands (J/K/V/X/U).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, Flag, RotateCcw } from 'lucide-react';
import type { Facility, GroundsArea } from '@shared/types';
import type { FacilityEstimate, GroundsEstimate } from '@shared/estimate';
import { useStore } from '../../store';
import type { RowMeta } from '../../derived';
import { cx } from '../lib/cx';
import { sourceCheck, sourceContext, type ReviewEntry, type ReviewMap, type SourceCheck } from '../lib/review';
import { formatNumber } from '../lib/parse';
import { Button, Menu, Popover, Portal, placeFloating, zoomFactor, type MenuItem } from '../ui';
import { extractedValue } from '../inventory/edits';
import { parseSelect, type CellCtx, type ColDef, type Parsed, type Row, type TableTab } from './columns';

export const HEAD_H = 34;
const MAX_MOUNTED = 60;

export interface GridHandle { focus(): void; scrollToId(id: string): void; focusedId(): string | null; focusedCol(): string | null }
export interface CellRef { id: string; col: string }
export type Move = 'down' | 'up' | 'left' | 'right' | null;

interface Props<R extends Row> {
  tab: TableTab;
  rows: R[];
  cols: ColDef<R>[];
  template: string;
  minWidth: number;
  rowH: number;
  rowMeta: ReadonlyMap<string, RowMeta>;
  estById: ReadonlyMap<string, FacilityEstimate>;
  gestById: ReadonlyMap<string, GroundsEstimate>;
  review: ReviewMap | undefined;
  maxFte: number;
  hostLabel: (id: string) => string | undefined;
  facilities: readonly Facility[];
  readOnly: boolean;
  checked: ReadonlySet<string>;
  onCheck: (id: string, value: boolean, range: boolean) => void;
  onCheckAll: (value: boolean) => void;
  sortCol: { key: string; desc: boolean } | null;
  onSort: (col: ColDef<R>) => void;
  widths: Record<string, number>;
  onResize: (key: string, w: number | null, done: boolean) => void;
  onWidth: (w: number) => void;
  /** commit a parsed patch for a row (one store write); returns false when nothing changed */
  commit: (row: R, patch: Partial<R>, what: string) => void;
  onCopy: (focus: CellRef | null) => void;
  onPaste: (text: string, focus: CellRef | null) => void;
  onRevert: (id: string, path: string | null) => boolean;
  incoming: boolean;
  gridRef: React.Ref<GridHandle>;
  empty: ReactNode;
}

const cellDomId = (tab: TableTab, id: string, col: string) => `tv-${tab}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${col}`;
const editPath = <R extends Row>(c: ColDef<R>) => (c.edit && c.edit.kind !== 'review' ? c.edit.path : null);
const isEditable = <R extends Row>(c: ColDef<R>) => Boolean(c.edit);

function GridImpl<R extends Row>(p: Props<R>) {
  const { tab, rows, cols, template, minWidth, rowH, readOnly } = p;
  const el = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, h: 600, w: 900 });
  const [focus, setFocus] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<{ id: string; col: string; draft: string; error?: string; replace: boolean } | null>(null);
  const [menu, setMenu] = useState<{ id: string; col: string; kind: 'select' | 'review' | 'src' } | null>(null);
  const [kbd, setKbd] = useState(false);
  const selectedId = useStore((s) => (s.selection.kind === null ? null : s.selection.id));

  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const colIndex = useMemo(() => new Map(cols.map((c, i) => [c.key, i])), [cols]);
  const stickyLeft = useMemo(() => { const m: Record<string, number> = {}; let x = 0; for (const c of cols) { if (!c.sticky) break; m[c.key] = x; x += p.widths[c.key] ?? c.w; } return m; }, [cols, p.widths]);

  const measure = useCallback(() => {
    const s = el.current; if (!s) return;
    setVp((v) => (v.top === s.scrollTop && v.h === s.clientHeight && v.w === s.clientWidth ? v : { top: s.scrollTop, h: s.clientHeight, w: s.clientWidth }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const s = el.current; if (!s) return;
    const ro = new ResizeObserver(measure); ro.observe(s);
    return () => ro.disconnect();
  }, [measure]);
  const { onWidth } = p;
  useEffect(() => { onWidth(vp.w); }, [vp.w, onWidth]);

  const scrollToIndex = useCallback((i: number) => {
    const s = el.current; if (!s || i < 0) return;
    const top = i * rowH, bottom = top + rowH, view = s.clientHeight - HEAD_H;
    if (top < s.scrollTop) s.scrollTop = top;
    else if (bottom > s.scrollTop + view) s.scrollTop = bottom - view;
    measure();
  }, [rowH, measure]);
  const scrollToCol = useCallback((key: string) => {
    const s = el.current; if (!s) return;
    const cell = s.querySelector<HTMLElement>(`[data-row-focus] [data-col="${key}"]`); if (!cell) return;
    const stickyW = Object.keys(stickyLeft).reduce((w, k) => w + (p.widths[k] ?? cols[colIndex.get(k)!]?.w ?? 0), 0);
    const c = cols[colIndex.get(key)!]; if (!c || c.sticky) return;
    const left = cell.offsetLeft, right = left + cell.offsetWidth;
    if (left < s.scrollLeft + stickyW) s.scrollLeft = left - stickyW;
    else if (right > s.scrollLeft + s.clientWidth) s.scrollLeft = right - s.clientWidth;
  }, [cols, colIndex, stickyLeft, p.widths]);

  // keep focus on a visible column; follow the selection when it changes elsewhere (J/K, 3D, Inspector)
  const focusCol = focus && colIndex.has(focus.col) ? focus.col : 'name';
  useEffect(() => {
    if (!selectedId) return;
    const i = index.get(selectedId); if (i == null) return;
    if (focus?.id !== selectedId) setFocus({ id: selectedId, col: focusCol });
    scrollToIndex(i);
  }, [selectedId, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridFocus = () => el.current?.focus({ preventScroll: true });
  useEffect(() => {
    const h = p.gridRef;
    const api: GridHandle = { focus: gridFocus, scrollToId: (id) => { const i = index.get(id); if (i != null) scrollToIndex(i); }, focusedId: () => focus?.id ?? null, focusedCol: () => focus?.col ?? null };
    if (typeof h === 'function') h(api); else if (h) (h as { current: GridHandle | null }).current = api;
  });

  const base = useMemo(() => ({ maxFte: p.maxFte, hostLabel: p.hostLabel, readOnly }), [p.maxFte, p.hostLabel, readOnly]);

  // ---- focus / selection ----
  const moveTo = useCallback((id: string, col: string, select = true) => {
    setFocus({ id, col });
    const i = index.get(id); if (i != null) scrollToIndex(i);
    requestAnimationFrame(() => scrollToCol(col));
    if (select && !p.incoming) {
      const s = useStore.getState();
      if ((s.selection.kind === null ? null : s.selection.id) !== id) s.select({ kind: tab === 'facilities' ? 'facility' : 'grounds', id });
    }
  }, [index, scrollToIndex, scrollToCol, tab, p.incoming]);

  const neighbour = (from: CellRef, move: Move): CellRef => {
    const ri = index.get(from.id) ?? 0, ci = colIndex.get(from.col) ?? 0;
    if (move === 'down') return { id: rows[Math.min(rows.length - 1, ri + 1)]?.id ?? from.id, col: from.col };
    if (move === 'up') return { id: rows[Math.max(0, ri - 1)]?.id ?? from.id, col: from.col };
    if (move === 'right') return { id: from.id, col: cols[Math.min(cols.length - 1, ci + 1)]?.key ?? from.col };
    if (move === 'left') return { id: from.id, col: cols[Math.max(0, ci - 1)]?.key ?? from.col };
    return from;
  };

  // ---- editing ----
  const startEdit = (id: string, colKey: string, seed?: string) => {
    const c = cols[colIndex.get(colKey)!]; const r = rows[index.get(id)!];
    if (!c || !r) return;
    if (c.key === 'sel') { p.onCheck(id, !p.checked.has(id), false); return; }
    if (c.key === 'src') { setMenu({ id, col: colKey, kind: 'src' }); return; }
    if (!c.edit) return;
    if (p.incoming) { useStore.getState().pushToast({ text: 'Incoming rows are read-only until the read finishes', ttl: 2500 }); return; }
    if (c.edit.kind === 'review') { setMenu({ id, col: colKey, kind: 'review' }); return; }
    if (readOnly) { useStore.getState().pushToast({ text: 'Editing is paused while a read is running (review marks still work)', tone: 'warn', ttl: 3000 }); return; }
    if (c.edit.kind === 'select') { setMenu({ id, col: colKey, kind: 'select' }); return; }
    const v = c.edit.get(r);
    const draft = seed ?? (typeof v === 'number' ? formatNumber(v, 2).replace(/,/g, '') : v ?? '');
    setEditing({ id, col: colKey, draft: String(draft), replace: seed != null });
  };

  /** Validate and commit an edit. Returns true when the editor can close. */
  const finishEdit = (draft: string, move: Move, viaBlur: boolean): boolean => {
    if (!editing) return true;
    const c = cols[colIndex.get(editing.col)!]; const r = rows[index.get(editing.id)!];
    if (!c || !r || !c.edit || (c.edit.kind !== 'text' && c.edit.kind !== 'number')) { setEditing(null); return true; }
    const res: Parsed<Partial<R>> = c.edit.parse(draft, r);
    if (!res.ok) {
      if (viaBlur) {
        setEditing(null);
        useStore.getState().pushToast({ text: `${c.edit.what} not changed: ${res.error}`, tone: 'warn', ttl: 3500 });
        return true;
      }
      setEditing({ ...editing, draft, error: res.error });
      return false;
    }
    p.commit(r, res.patch, c.edit.what);
    if (res.label) useStore.getState().pushToast({ text: `${c.edit.what}: ${res.label}`, tone: 'ok', ttl: 2500 });
    setEditing(null);
    const from = { id: editing.id, col: editing.col };
    // the focus moves on (Enter ↓, Tab →) but the selection stays on the edited row, so the Inspector shows the result
    if (!viaBlur) { const to = neighbour(from, move); moveTo(to.id, to.col, false); gridFocus(); }
    return true;
  };
  const cancelEdit = () => { setEditing(null); gridFocus(); };
  const finishRef = useRef(finishEdit); finishRef.current = finishEdit;
  const cancelRef = useRef(cancelEdit); cancelRef.current = cancelEdit;
  const onFinish = useCallback((d: string, m: Move, b: boolean) => finishRef.current(d, m, b), []);
  const onCancel = useCallback(() => cancelRef.current(), []);

  // ---- keyboard on the grid ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.target !== el.current) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); p.onCopy(focus); return; }
    if (mod || e.altKey) return; // let paste (Ctrl+V) and history keys through
    const cur: CellRef = focus && index.has(focus.id) ? { id: focus.id, col: focusCol } : { id: rows[0]?.id, col: focusCol };
    if (!cur.id) return;
    const ri = index.get(cur.id) ?? 0, ci = colIndex.get(cur.col) ?? 0;
    const page = Math.max(1, Math.floor((vp.h - HEAD_H) / rowH) - 1);
    const go = (id: string | undefined, col: string) => { if (!id) return; e.preventDefault(); setKbd(true); moveTo(id, col); };
    switch (e.key) {
      case 'ArrowDown': return go(rows[Math.min(rows.length - 1, ri + (focus ? 1 : 0))]?.id, cur.col);
      case 'ArrowUp': return go(rows[Math.max(0, ri - 1)]?.id, cur.col);
      case 'ArrowRight': return go(cur.id, cols[Math.min(cols.length - 1, ci + 1)].key);
      case 'ArrowLeft': return go(cur.id, cols[Math.max(0, ci - 1)].key);
      case 'PageDown': return go(rows[Math.min(rows.length - 1, ri + page)]?.id, cur.col);
      case 'PageUp': return go(rows[Math.max(0, ri - page)]?.id, cur.col);
      case 'Home': return go(e.shiftKey ? rows[0]?.id : cur.id, cols[0].key);
      case 'End': return go(e.shiftKey ? rows[rows.length - 1]?.id : cur.id, cols[cols.length - 1].key);
      case 'Enter': case 'F2': e.preventDefault(); setKbd(true); if (!focus) setFocus(cur); startEdit(cur.id, cur.col); return;
      case ' ': e.preventDefault(); if (!p.incoming) p.onCheck(cur.id, !p.checked.has(cur.id), e.shiftKey); return;
      case 'Delete': case 'Backspace': {
        const c = cols[ci]; const r = rows[ri];
        if (!c?.edit || p.incoming) return;
        e.preventDefault();
        if (readOnly) { startEdit(cur.id, cur.col); return; }
        if (c.edit.kind === 'number' && c.edit.optional && c.edit.clear) p.commit(r, c.edit.clear(r), c.edit.what);
        else if (c.edit.kind === 'text' && c.edit.optional) { const res = c.edit.parse('', r); if (res.ok) p.commit(r, res.patch, c.edit.what); }
        else useStore.getState().pushToast({ text: `${c.edit.kind === 'review' ? 'Review' : c.edit.what} can't be cleared`, ttl: 2000 });
        return;
      }
      case 'r': case 'R': {
        if (e.shiftKey || !p.onRevert(cur.id, editPath(cols[ci]))) { if (!p.onRevert(cur.id, null)) return; }
        e.preventDefault(); e.stopPropagation();
        return;
      }
      default: {
        // digits, "." and "-" start a numeric edit that replaces the value
        const c = cols[ci];
        if (c?.edit?.kind === 'number' && /^[0-9.\-]$/.test(e.key) && !e.shiftKey) { e.preventDefault(); setKbd(true); startEdit(cur.id, cur.col, e.key); }
      }
    }
  };

  // ---- pointer ----
  const cellFromEvent = (target: EventTarget | null): CellRef | null => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('[data-col]');
    const row = cell?.closest<HTMLElement>('[data-row]');
    return cell && row ? { id: row.dataset.row!, col: cell.dataset.col! } : null;
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const c = cellFromEvent(e.target); if (!c) return;
    setKbd(false);
    if (editing && editing.id === c.id && editing.col === c.col) return; // clicks inside the editor
    if (c.col === 'sel') { e.preventDefault(); gridFocus(); setFocus(c); p.onCheck(c.id, !p.checked.has(c.id), e.shiftKey); return; }
    moveTo(c.id, c.col);
  };
  const onClick = (e: React.MouseEvent) => {
    const c = cellFromEvent(e.target); if (!c) return;
    if (c.col === 'review' || c.col === 'src') startEdit(c.id, c.col);
  };
  const onDoubleClick = (e: React.MouseEvent) => { const c = cellFromEvent(e.target); if (c && c.col !== 'sel' && c.col !== 'review' && c.col !== 'src') startEdit(c.id, c.col); };

  // ---- render window ----
  const n = rows.length;
  const visFirst = Math.max(0, Math.floor(vp.top / rowH));
  const visLast = Math.min(n - 1, Math.floor((vp.top + vp.h - HEAD_H) / rowH));
  const over = Math.max(0, Math.min(8, Math.floor((MAX_MOUNTED - (visLast - visFirst + 1)) / 2)));
  const first = Math.max(0, visFirst - over), last = Math.min(n - 1, visLast + over);
  const mounted: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const r = rows[i];
    const focused = focus?.id === r.id;
    mounted.push(
      <GridRow key={r.id} tab={tab} r={r} i={i} cols={cols} template={template} rowH={rowH} stickyLeft={stickyLeft}
        meta={p.incoming ? undefined : p.rowMeta.get(r.id)} est={p.incoming ? undefined : p.estById.get(r.id)} gest={p.incoming ? undefined : p.gestById.get(r.id)} entry={p.incoming ? undefined : p.review?.[r.id]} base={base}
        focusCol={focused ? focusCol : null} showFocus={kbd} checked={p.checked.has(r.id)} incoming={p.incoming}
        editing={editing && editing.id === r.id ? editing : null} onFinish={onFinish} onCancel={onCancel} />,
    );
  }
  const allChecked = n > 0 && rows.every((r) => p.checked.has(r.id));
  const someChecked = !allChecked && rows.some((r) => p.checked.has(r.id));
  const activeId = focus && index.has(focus.id) ? cellDomId(tab, focus.id, focusCol) : undefined;

  // ---- popups anchored to cells (select / review / source) ----
  const menuRow = menu ? rows[index.get(menu.id) ?? -1] : undefined;
  const menuCol = menu ? cols[colIndex.get(menu.col) ?? -1] : undefined;
  const anchor = menu ? document.getElementById(cellDomId(tab, menu.id, menu.col)) : null;
  const closeMenu = () => { setMenu(null); requestAnimationFrame(gridFocus); };
  let popup: ReactNode = null;
  if (menu && menuRow && menuCol && anchor) {
    if (menu.kind === 'select' && menuCol.edit?.kind === 'select') {
      const spec = menuCol.edit;
      const cur = spec.get(menuRow);
      const items: MenuItem[] = [{ kind: 'header', label: `${spec.what} · ${'name' in menuRow ? menuRow.name : ''}`.slice(0, 60) }, ...spec.options({ facilities: p.facilities }).map((o) => ({
        id: o.value || '_none', label: o.dot ? <span className="tv-opt"><i className="tv-dot" style={{ background: o.dot }} />{o.label}</span> : o.label, hint: o.hint, checked: o.value === cur,
        onSelect: () => { const res = parseSelect(spec, o.value || 'Site-wide', menuRow, p.facilities); if (res.ok) p.commit(menuRow, spec.set(menuRow, o.value), spec.what); },
      }))];
      popup = <Menu open anchor={anchor} onClose={closeMenu} label={spec.what} items={items} placement="bottom-start" className="tv-menu" />;
    } else if (menu.kind === 'review') {
      const st = p.review?.[menuRow.id]?.status;
      const s = useStore.getState();
      popup = <Menu open anchor={anchor} onClose={closeMenu} label="Review" placement="bottom-start" items={[
        { id: 'v', label: 'Verified', icon: CircleCheck, kbd: 'v', checked: st === 'verified', onSelect: () => s.setReview([menuRow.id], st === 'verified' ? null : 'verified') },
        { id: 'x', label: 'Flagged', icon: Flag, kbd: 'x', checked: st === 'flagged', onSelect: () => s.setReview([menuRow.id], st === 'flagged' ? null : 'flagged') },
        { kind: 'separator' },
        { id: 'u', label: 'Clear the mark', icon: CircleX, kbd: 'u', disabled: !st || st === 'unreviewed', onSelect: () => s.setReview([menuRow.id], null) },
      ]} />;
    } else if (menu.kind === 'src') {
      popup = <SourcePopover anchor={anchor} row={menuRow} onClose={closeMenu} readOnly={readOnly || p.incoming} onUse={(v) => { if ('grossSqft' in menuRow) p.commit(menuRow, { grossSqft: v } as unknown as Partial<R>, 'Gross SF'); closeMenu(); }} />;
    }
  }

  const headStyle: CSSProperties = { gridTemplateColumns: template, height: HEAD_H };
  return (
    <div ref={el} className="tv-grid" role="grid" aria-label={tab === 'facilities' ? 'Facilities' : 'Grounds areas'} aria-rowcount={n + 1} aria-colcount={cols.length}
      aria-activedescendant={activeId} tabIndex={0} onScroll={measure} onKeyDown={onKeyDown} onMouseDown={onMouseDown} onClick={onClick} onDoubleClick={onDoubleClick}
      onPaste={(e) => { if (editing) return; const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); p.onPaste(t, focus); } }}
      onFocus={(e) => { if (e.target === el.current && !focus && rows[0]) setFocus({ id: selectedId && index.has(selectedId) ? selectedId : rows[0].id, col: 'name' }); }}>
      <div className="tv-canvas" style={{ minWidth }}>
        <div className="tv-head" role="row" aria-rowindex={1} style={headStyle}>
          {cols.map((c) => <HeadCell key={c.key} c={c} sticky={stickyLeft[c.key]} sortCol={p.sortCol} onSort={p.onSort} onResize={p.onResize} width={p.widths[c.key] ?? c.w}
            check={c.key === 'sel' ? { all: allChecked, some: someChecked, onChange: (v) => p.onCheckAll(v), disabled: p.incoming || !n } : undefined} />)}
        </div>
        {n === 0 ? <div className="tv-empty">{p.empty}</div> : <div className="tv-body" role="rowgroup" style={{ height: n * rowH }}>{mounted}</div>}
      </div>
      {popup}
    </div>
  );
}
export const Grid = memo(GridImpl) as typeof GridImpl;

// ---------------------------------------------------------------- header cell
function HeadCell<R extends Row>({ c, sticky, sortCol, onSort, onResize, width, check }: { c: ColDef<R>; sticky?: number; sortCol: { key: string; desc: boolean } | null; onSort: (c: ColDef<R>) => void; onResize: (key: string, w: number | null, done: boolean) => void; width: number; check?: { all: boolean; some: boolean; onChange: (v: boolean) => void; disabled: boolean } }) {
  const sorted = sortCol?.key === c.key ? (sortCol.desc ? 'descending' : 'ascending') : 'none';
  const Arrow = sortCol?.desc ? ArrowDown : ArrowUp;
  const startResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation();
    const target = e.currentTarget; target.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width, z = zoomFactor();
    let last = w0;
    const move = (ev: PointerEvent) => { last = Math.max(c.min, Math.min(900, Math.round(w0 + (ev.clientX - x0) / z))); onResize(c.key, last, false); };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onResize(c.key, last, true); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  };
  const style: CSSProperties | undefined = sticky != null ? { left: sticky } : undefined;
  return (
    <div role="columnheader" aria-sort={c.sort || c.key === 'review' ? sorted : undefined} className={cx('tv-th', c.align && `is-${c.align}`, sticky != null && 'is-sticky', sorted !== 'none' && 'is-sorted')} style={style} data-col={c.key}>
      {check ? (
        <input type="checkbox" className="tv-check" aria-label="Select all visible rows" checked={check.all} disabled={check.disabled}
          ref={(el) => { if (el) el.indeterminate = check.some; }} onChange={(e) => check.onChange(e.target.checked)} />
      ) : c.sort || c.key === 'review' ? (
        <button type="button" className="tv-th__btn" onClick={() => onSort(c)} title={c.key === 'review' ? 'Review status (click to sort: needs review first)' : `Sort by ${c.menuLabel ?? c.label}`}>
          {c.key === 'review' ? <CircleCheck size={13} strokeWidth={2} aria-label="Review" /> : <span className="tv-th__label">{c.label}</span>}{sorted !== 'none' && <Arrow size={11} aria-hidden />}
        </button>
      ) : <span className="tv-th__label">{c.label}</span>}
      {c.key !== 'sel' && <span className="tv-th__resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.menuLabel ?? c.label}`} title="Drag to resize · double-click to reset"
        onPointerDown={startResize} onDoubleClick={(e) => { e.stopPropagation(); onResize(c.key, null, true); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- row
interface RowProps<R extends Row> {
  tab: TableTab; r: R; i: number; cols: ColDef<R>[]; template: string; rowH: number; stickyLeft: Record<string, number>;
  meta?: RowMeta; est?: FacilityEstimate; gest?: GroundsEstimate; entry?: ReviewEntry; base: Pick<CellCtx, 'maxFte' | 'hostLabel' | 'readOnly'>;
  focusCol: string | null; showFocus: boolean; checked: boolean; incoming: boolean;
  editing: { id: string; col: string; draft: string; error?: string; replace: boolean } | null;
  onFinish: (draft: string, move: Move, viaBlur: boolean) => boolean; onCancel: () => void;
}
function GridRowImpl<R extends Row>({ tab, r, i, cols, template, rowH, stickyLeft, meta, est, gest, entry, base, focusCol, showFocus, checked, incoming, editing, onFinish, onCancel }: RowProps<R>) {
  const ctx: CellCtx = useMemo(() => ({ meta, est, gest, entry, ...base }), [meta, est, gest, entry, base]);
  const selected = useStore((s) => !incoming && s.selection.kind !== null && s.selection.id === r.id);
  const out = ctx.meta ? !ctx.meta.inScope : false;
  return (
    <div role="row" aria-rowindex={i + 2} aria-selected={selected} data-row={r.id} data-row-focus={focusCol ? '' : undefined}
      className={cx('tv-row', selected && 'is-sel', out && 'is-out', checked && 'is-checked', incoming && 'is-incoming', ctx.meta?.review === 'needs' && 'is-needs')}
      style={{ top: i * rowH, height: rowH, gridTemplateColumns: template }}>
      {cols.map((c) => {
        const isFocus = focusCol === c.key;
        const path = editPath(c);
        const ext = path ? extractedValue(ctx.entry, path) : undefined;
        const isEditing = editing?.col === c.key;
        const title = c.title?.(r, ctx);
        const editedTitle = ext ? `Extracted ${fmtVal(ext.value)} → you ${fmtVal(path === 'dining.mealsPerDay' ? (r as Facility).dining?.mealsPerDay : (r as unknown as Record<string, unknown>)[path!])} · R to revert` : undefined;
        return (
          <div key={c.key} id={cellDomId(tab, r.id, c.key)} role="gridcell" data-col={c.key} aria-readonly={!isEditable(c) || undefined}
            className={cx('tv-c', c.align && `is-${c.align}`, c.sticky && 'is-sticky', c.key === 'name' && 'tv-c--name', c.key === 'bldg' && 'tv-c--mono', isFocus && 'is-focus', isFocus && showFocus && 'is-kbd', isEditing && 'is-editing', isEditing && editing?.error && 'is-invalid', ext && 'is-edited')}
            style={c.sticky ? { left: stickyLeft[c.key] } : undefined} title={isEditing ? undefined : [editedTitle, title].filter(Boolean).join('\n') || undefined}>
            {c.key === 'sel' ? <input type="checkbox" className="tv-check" tabIndex={-1} aria-label={`Select ${'buildingNumber' in r && r.buildingNumber ? r.buildingNumber : r.name}`} checked={checked} readOnly disabled={incoming} />
              : isEditing && editing ? <CellInput draft={editing.draft} replace={editing.replace} error={editing.error} numeric={c.edit?.kind === 'number'} onFinish={onFinish} onCancel={onCancel} />
                : <span className="tv-c__v">{c.render(r, ctx)}</span>}
            {ext && !isEditing && <i className="tv-edited" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
const GridRow = memo(GridRowImpl) as typeof GridRowImpl;

const fmtVal = (v: unknown) => (v == null || v === '' ? '(blank)' : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ---------------------------------------------------------------- inline editor
function CellInput({ draft, replace, error, numeric, onFinish, onCancel }: { draft: string; replace: boolean; error?: string; numeric: boolean; onFinish: (d: string, m: Move, blur: boolean) => boolean; onCancel: () => void }) {
  const [v, setV] = useState(draft);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus({ preventScroll: true });
    if (replace) el.setSelectionRange(el.value.length, el.value.length); else el.select();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (move: Move, blur: boolean) => { if (done.current) return; const closed = onFinish(v, move, blur); if (closed) done.current = true; };
  return (
    <>
      <input ref={ref} className={cx('tv-input', numeric && 'is-num')} value={v} spellCheck={false} autoComplete="off" inputMode={numeric ? 'decimal' : undefined} aria-invalid={error ? true : undefined}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(e.shiftKey ? 'up' : 'down', false); }
          else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); finish(e.shiftKey ? 'left' : 'right', false); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
        }}
        onBlur={() => finish(null, true)} />
      {error && <ErrorTip anchor={ref} message={error} />}
    </>
  );
}

function ErrorTip({ anchor, message }: { anchor: React.RefObject<HTMLElement | null>; message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current?.parentElement, el = ref.current; if (!a || !el) return;
    const r = el.getBoundingClientRect();
    setPos(placeFloating(a.getBoundingClientRect(), { w: r.width, h: r.height }, 'bottom-start', 4));
  }, [anchor, message]);
  return <Portal><div ref={ref} role="alert" className="ui-tooltip ui-tooltip--error" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>{message}</div></Portal>;
}

// ---------------------------------------------------------------- source popover (Src column)
function SourcePopover({ anchor, row, onClose, onUse, readOnly }: { anchor: HTMLElement; row: Row; onClose: () => void; onUse: (v: number) => void; readOnly: boolean }) {
  const f = 'grossSqft' in row ? row : null;
  const entry = useStore((s) => s.project?.review?.[row.id]);
  const facilities = useStore((s) => s.project?.inventory.facilities);
  const chk: SourceCheck = f ? sourceCheck(f, entry, facilities ? sourceContext(facilities) : undefined) : { status: 'none' };
  const src = row.source;
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" label="Source" className="tv-srcpop">
      <div className="tv-srcpop__file">{src?.file ?? 'No source document cited'}{src?.page ? <span className="muted"> · p.{src.page}</span> : null}{f?.tableId ? <span className="muted"> · {f.tableId}</span> : null}</div>
      {src?.excerpt ? <blockquote className="tv-srcpop__quote">{src.excerpt}</blockquote> : <p className="muted tv-srcpop__none">No excerpt was captured for this row.</p>}
      {f && chk.status === 'ok' && <p className="tv-srcpop__ok">✓ {chk.match === 'sum' ? `Gross SF ${f.grossSqft.toLocaleString()} = ${chk.sumText}` : chk.match === 'cleanable' ? `Cleanable SF ${(f.cleanableSqft ?? f.originalArea?.cleanable ?? 0).toLocaleString()} appears; gross is not printed` : chk.match === 'original' ? 'Gross as printed appears in the excerpt' : `Gross SF ${f.grossSqft.toLocaleString()} appears in the excerpt`}</p>}
      {f && chk.status === 'revised' && <p className="tv-srcpop__ok">✓ Gross SF {f.grossSqft.toLocaleString()} is the revised value in the notes (the excerpt shows the superseded {(chk.revisedFrom ?? 0).toLocaleString()})</p>}
      {f && (chk.status === 'miss' || chk.status === 'differs') && (
        <div className={chk.status === 'miss' ? 'tv-srcpop__miss' : 'tv-srcpop__miss is-warn'}>
          <span>{chk.status === 'miss' ? '✗' : '⚠'} Gross SF {f.grossSqft.toLocaleString()} {chk.shows != null && chk.showsWhy !== 'near' ? `differs from the excerpt (${chk.shows.toLocaleString()}${chk.showsWhy === 'extracted' ? ', extracted' : ''})` : `not in the excerpt${chk.shows != null ? ` (it shows ${chk.shows.toLocaleString()})` : ''}`}</span>
          {chk.suggest != null && !readOnly && <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => onUse(chk.suggest!)}>Use {chk.suggest.toLocaleString()}</Button>}
        </div>
      )}
    </Popover>
  );
}

export type { ReviewEntry, GroundsArea };
