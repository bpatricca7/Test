// Table view (UI spec §5.6): the inventory as a spreadsheet on an opaque sheet over .vp-area. Shares store.query
// (search, chips, sort) with the rail list. Toolbar: [Facilities | Grounds] tabs, chips, search with count, sort,
// columns chooser (P1), + Add, ⋯ (CSV / TSV export, verify rows without issues, undo/redo); a bulk bar replaces it
// while rows are checked (P1). Footer: "32 of 350 · 1.20M SF · 287.4 FTE", review meter, key hint.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CircleCheck, Columns3, Copy, Download, Ellipsis, Flag, Plus, Redo2, Trash2, Trees, Undo2, X } from 'lucide-react';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import { FACILITY_CATEGORIES, FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, type Facility, type GroundsArea } from '@shared/types';
import { useStore } from '../../store';
import { useDerived } from '../../derived';
import { compact, n1 } from '../../fmt';
import { useHotkey, useEscape } from '../lib/keys';
import { cx } from '../lib/cx';
import { categoryColor } from '../lib/theme';
import type { ReviewMap } from '../lib/review';
import { sortPatch, usePublishOrder, useInventoryView, type ExtraSort } from '../lib/query';
import { copyText, parseTsv, toTsv, type Cell } from '../lib/csv';
import { exportInventoryCsv } from '../shell/exports';
import { redo, undo, useHistory, labelNext } from '../lib/history';
import { Button, Chip, IconButton, Menu, Meter, Tabs, usePopover, type MenuItem } from '../ui';
import { QueryChips, QuerySearch, SortMenuButton } from '../inventory/QueryControls';
import { selectRow } from '../inventory/reviewLoop';
import { commitFacilitiesBulk, commitFacility, commitGrounds, commitPatches, removeRows, revertEdits } from '../inventory/edits';
import { autoShown, facilityColumns, gridTemplate, groundsColumns, parseSelect, SERVICE_SHORT, visibleColumns, type ColDef, type ColPref, type Row, type TableTab } from './columns';
import { Grid, type CellRef, type GridHandle } from './Grid';
import '../../styles/inventory.css';
import '../../styles/table.css';

// ---------------------------------------------------------------- persisted table prefs (inside bos.ui.v1)
interface TablePrefs { widths: Record<TableTab, Record<string, number>>; cols: Record<TableTab, Record<string, ColPref>>; density: 32 | 28 }
const UI_KEY = 'bos.ui.v1';
function readPrefs(): TablePrefs {
  const base: TablePrefs = { widths: { facilities: {}, grounds: {} }, cols: { facilities: {}, grounds: {} }, density: 32 };
  try {
    const t = (JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as { table?: Partial<TablePrefs> }).table;
    if (!t || typeof t !== 'object') return base;
    return { widths: { ...base.widths, ...(t.widths ?? {}) }, cols: { ...base.cols, ...(t.cols ?? {}) }, density: t.density === 28 ? 28 : 32 };
  } catch { return base; }
}
function writePrefs(p: TablePrefs) {
  try { const all = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Record<string, unknown>; localStorage.setItem(UI_KEY, JSON.stringify({ ...all, table: p })); } catch { /* storage unavailable */ }
}

const FAC_COLS = facilityColumns();
const GR_COLS = groundsColumns();
const REVIEW_RANK = { needs: 0, flagged: 1, ok: 2, verified: 3 } as const;

export const TableView = memo(function TableView() {
  const tab = useStore((s) => s.query.tableTab);
  const chip = useStore((s) => s.query.chip);
  const sort = useStore((s) => s.query.sort);
  const desc = useStore((s) => s.query.desc);
  const setQuery = useStore((s) => s.setQuery);
  const running = useStore((s) => s.extraction.running);
  const review = useStore((s) => s.project?.review) as ReviewMap | undefined;
  const project = useStore((s) => s.project);
  const facilitiesAll = project?.inventory.facilities ?? EMPTY_F;
  const groundsAll = project?.inventory.grounds ?? EMPTY_G;
  const { rowMeta, counts, est, estById, gestById, facById } = useDerived();
  const gridRef = useRef<GridHandle>(null);

  const [prefs, setPrefs] = useState<TablePrefs>(readPrefs);
  const [liveWidths, setLiveWidths] = useState<Record<string, number> | null>(null);
  const [avail, setAvail] = useState(900);
  const [colSort, setColSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const lastCheck = useRef<string | null>(null);

  const all = (tab === 'facilities' ? FAC_COLS : GR_COLS) as ColDef<Row>[];
  // a table-only column sort (Category, Service, Hrs/yr, Review…) wins over the shared sort until one is picked again
  useEffect(() => { setColSort(null); }, [sort, desc, tab]);
  const extra = useMemo<ExtraSort>(() => {
    if (!colSort) return null;
    const c = all.find((x) => x.key === colSort.key); if (!c) return null;
    if (c.key === 'review') return { key: c.key, desc: colSort.desc, value: (r) => REVIEW_RANK[rowMeta.get(r.id)?.review ?? 'ok'] };
    if (c.key === 'hrs') return { key: c.key, desc: colSort.desc, value: (r) => estById.get(r.id)?.totalHours ?? gestById.get(r.id)?.totalHours };
    if (typeof c.sort === 'function') return { key: c.key, desc: colSort.desc, value: c.sort as (r: Row) => number | string | undefined };
    return null;
  }, [colSort, all, colSort?.key === 'review' ? rowMeta : null, colSort?.key === 'hrs' ? estById : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useInventoryView(extra);
  const incoming = chip === 'incoming';
  const rows = (tab === 'facilities' ? (incoming ? view.incomingFacilities : view.facilities) : (incoming ? view.incomingGrounds : view.grounds)) as Row[];
  usePublishOrder('table', useMemo(() => (incoming ? [] : rows.map((r) => r.id)), [rows, incoming]));

  // grounds-only projects open on Grounds
  useEffect(() => {
    if (tab === 'facilities' && facilitiesAll.length === 0 && groundsAll.length > 0) setQuery({ tableTab: 'grounds' });
  }, [tab, facilitiesAll.length, groundsAll.length, setQuery]);
  useEffect(() => { setChecked(new Set()); }, [tab]);

  // ---- columns ----
  const widths = liveWidths ?? prefs.widths[tab];
  const shown = useMemo(() => autoShown(tab, { facilities: facilitiesAll, grounds: groundsAll }), [tab, facilitiesAll, groundsAll]);
  const cols = useMemo(() => visibleColumns(all, avail, shown, prefs.cols[tab], widths), [all, avail, shown, prefs.cols, tab, widths]);
  const { template, minWidth } = useMemo(() => gridTemplate(cols, widths), [cols, widths]);
  const onResize = useCallback((key: string, w: number | null, done: boolean) => {
    const next = { ...(liveWidthsRef.current ?? prefsRef.current.widths[tabRef.current]) };
    if (w == null) delete next[key]; else next[key] = w;
    if (!done) { setLiveWidths(next); return; }
    setLiveWidths(null);
    const p = { ...prefsRef.current, widths: { ...prefsRef.current.widths, [tabRef.current]: next } };
    setPrefs(p); writePrefs(p);
  }, []);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const liveWidthsRef = useRef(liveWidths); liveWidthsRef.current = liveWidths;
  const tabRef = useRef(tab); tabRef.current = tab;
  const setColPref = (key: string, v: ColPref | null) => {
    const cur = { ...prefs.cols[tab] }; if (v) cur[key] = v; else delete cur[key];
    const p = { ...prefs, cols: { ...prefs.cols, [tab]: cur } }; setPrefs(p); writePrefs(p);
  };
  const setDensity = (d: 32 | 28) => { const p = { ...prefs, density: d }; setPrefs(p); writePrefs(p); };

  const sortCol = useMemo(() => {
    if (colSort) return colSort;
    const c = cols.find((x) => x.sort === sort);
    return c && sort !== 'source' ? { key: c.key, desc } : null;
  }, [colSort, cols, sort, desc]);
  const onSort = useCallback((c: ColDef<Row>) => {
    const q = useStore.getState().query;
    if (typeof c.sort === 'string') { setQuery(q.sort === c.sort && !colSortRef.current ? { desc: !q.desc } : sortPatch(c.sort)); setColSort(null); return; }
    setColSort((prev) => (prev?.key === c.key ? { key: c.key, desc: !prev.desc } : { key: c.key, desc: c.key === 'hrs' || c.key === 'review' ? c.key === 'hrs' : false }));
  }, [setQuery]);
  const colSortRef = useRef(colSort); colSortRef.current = colSort;

  // ---- checks (bulk, P1) ----
  const onCheck = useCallback((id: string, value: boolean, range: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const ids = rowsRef.current.map((r) => r.id);
      if (range && lastCheck.current && ids.includes(lastCheck.current)) {
        const a = ids.indexOf(lastCheck.current), b = ids.indexOf(id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { if (value) next.add(ids[i]); else next.delete(ids[i]); }
      } else if (value) next.add(id); else next.delete(id);
      lastCheck.current = id;
      return next;
    });
  }, []);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const onCheckAll = useCallback((v: boolean) => setChecked(v ? new Set(rowsRef.current.map((r) => r.id)) : new Set()), []);
  // drop checks of rows that left the inventory
  useEffect(() => { setChecked((prev) => { if (!prev.size) return prev; const ids = new Set([...facilitiesAll.map((f) => f.id), ...groundsAll.map((g) => g.id)]); const next = new Set([...prev].filter((x) => ids.has(x))); return next.size === prev.size ? prev : next; }); }, [facilitiesAll, groundsAll]);
  useEscape(() => { if (!checked.size) return false; setChecked(new Set()); return true; }, 'search', checked.size > 0);

  // ---- commits ----
  const commit = useCallback((row: Row, patch: Partial<Row>, what: string) => {
    if ('grossSqft' in row) commitFacility(row.id, patch as Partial<Facility>, what); else commitGrounds(row.id, patch as Partial<GroundsArea>, what);
  }, []);
  const hostLabel = useCallback((id: string) => { const f = facById.get(id); return f ? `${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}` : undefined; }, [facById]);
  const maxFte = useMemo(() => Math.max(0.01, ...(est?.facilities.map((e) => e.fte) ?? [0]), ...(est?.grounds.map((g) => g.fte) ?? [0])), [est]);

  // ---- copy / paste (P1) ----
  const ctxOf = useCallback((r: Row) => ({ meta: rowMeta.get(r.id), est: estById.get(r.id), gest: gestById.get(r.id), entry: review?.[r.id], maxFte, hostLabel, readOnly: running }), [rowMeta, estById, gestById, review, maxFte, hostLabel, running]);
  const onCopy = useCallback((focus: CellRef | null) => {
    const dataCols = cols.filter((c) => c.key !== 'sel');
    let text: string; let what: string;
    if (checked.size) {
      const list = rows.filter((r) => checked.has(r.id));
      text = toTsv([dataCols.map((c) => c.menuLabel ?? c.label), ...list.map((r) => dataCols.map((c) => c.text(r, ctxOf(r)) as Cell))]);
      what = `${list.length} row${list.length === 1 ? '' : 's'}`;
    } else if (focus) {
      const r = rows.find((x) => x.id === focus.id); const c = cols.find((x) => x.key === focus.col);
      if (!r || !c) return;
      text = toTsv([[c.text(r, ctxOf(r)) as Cell]]); what = 'the cell';
    } else return;
    void copyText(text).then((ok) => useStore.getState().pushToast({ text: ok ? `Copied ${what}` : 'Copy failed (clipboard unavailable)', tone: ok ? 'ok' : 'warn', ttl: 1800 }));
  }, [cols, rows, checked, ctxOf]);

  const onPaste = useCallback((text: string, focus: CellRef | null) => {
    const s = useStore.getState();
    if (running || incoming) { s.pushToast({ text: 'Pasting is paused while a read is running', tone: 'warn', ttl: 2500 }); return; }
    const grid = parseTsv(text);
    if (!grid.length || !focus) return;
    const start = rows.findIndex((r) => r.id === focus.id);
    const editable = cols.filter((c) => c.edit && c.edit.kind !== 'review');
    let ci0 = editable.findIndex((c) => c.key === focus.col);
    if (ci0 < 0) { const fi = cols.findIndex((c) => c.key === focus.col); ci0 = editable.findIndex((c) => cols.indexOf(c) > fi); }
    if (start < 0 || ci0 < 0) { s.pushToast({ text: 'Focus an editable cell, then paste', ttl: 2500 }); return; }
    const fac = new Map<string, Partial<Facility>>(); const grd = new Map<string, Partial<GroundsArea>>();
    let applied = 0; const skipped: string[] = [];
    grid.forEach((line, dr) => {
      const r0 = rows[start + dr];
      if (!r0) { skipped.push(...line.map((v) => `row +${dr + 1} “${v}” (past the last row)`)); return; }
      let r = r0;
      line.forEach((raw, dc) => {
        const c = editable[ci0 + dc];
        if (!c || !c.edit || c.edit.kind === 'review') { if (raw.trim()) skipped.push(`“${raw}” (no column)`); return; }
        if (!raw.trim() && !(c.edit.kind !== 'select' && c.edit.optional)) return; // blank: leave as is
        const res = c.edit.kind === 'select' ? parseSelect(c.edit, raw, r, facilitiesAll) : c.edit.parse(raw, r);
        if (!res.ok) { skipped.push(`${'buildingNumber' in r && r.buildingNumber ? r.buildingNumber : r.name.slice(0, 18)} ${c.edit.what} “${raw}”: ${res.error}`); return; }
        r = { ...r, ...res.patch } as Row;
        const m = ('grossSqft' in r ? fac : grd) as Map<string, Partial<Row>>;
        m.set(r.id, { ...(m.get(r.id) ?? {}), ...res.patch });
        applied++;
      });
    });
    commitPatches(fac, grd, `paste of ${applied} cell${applied === 1 ? '' : 's'}`);
    s.pushToast({
      text: `Pasted ${applied} cell${applied === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} skipped: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; …' : ''})` : ''}`,
      tone: skipped.length ? 'warn' : 'ok', ttl: skipped.length ? 8000 : 4000, action: applied ? { label: 'Undo', run: () => { undo(); } } : undefined,
    });
  }, [rows, cols, running, incoming, facilitiesAll]);

  const onRevert = useCallback((id: string, path: string | null) => {
    const ok = revertEdits(id, path ?? undefined);
    if (ok) useStore.getState().pushToast({ text: path ? 'Reverted the cell to the extracted value' : 'Reverted the row to the extracted values', tone: 'ok', ttl: 2500, action: { label: 'Undo', run: () => { undo(); } } });
    return ok;
  }, []);

  // ---- table-only keys ----
  useHotkey('i', () => {
    const s = useStore.getState();
    if (s.selection.kind !== 'facility') return false;
    const m = rowMeta.get(s.selection.id);
    if (m && !m.inScope) { s.pushToast({ text: 'Out-of-scope buildings have no crews to show inside', ttl: 2500 }); return; }
    s.setView('map'); s.setFocusMode('building');
  }, { label: 'Inside the selected building', group: 'Review', when: () => useStore.getState().view === 'table' });

  // ---- totals ----
  const totals = useMemo(() => {
    let sf = 0, fte = 0;
    for (const r of rows) {
      const m = rowMeta.get(r.id);
      if ('grossSqft' in r) { if (!m || m.inScope) { sf += r.grossSqft || 0; fte += estById.get(r.id)?.fte ?? 0; } }
      else fte += gestById.get(r.id)?.fte ?? 0;
    }
    return { sf, fte };
  }, [rows, rowMeta, estById, gestById]);
  const tabTotal = incoming ? rows.length : tab === 'facilities' ? facilitiesAll.length : groundsAll.length;
  const shownCount = view.active ? `${rows.length.toLocaleString()} of ${tabTotal.toLocaleString()}` : tabTotal.toLocaleString();

  // ---- export (P1) ----
  const exportCsv = () => exportInventoryCsv(est, rowMeta, counts.needs);
  const copyVisible = () => {
    const dataCols = cols.filter((c) => c.key !== 'sel');
    const text = toTsv([dataCols.map((c) => c.menuLabel ?? c.label), ...rows.map((r) => dataCols.map((c) => c.text(r, ctxOf(r)) as Cell))]);
    void copyText(text).then((ok) => useStore.getState().pushToast({ text: ok ? `Copied ${rows.length} visible rows (TSV)` : 'Copy failed', tone: ok ? 'ok' : 'warn', ttl: 2000 }));
  };
  const verifyClean = async () => {
    const ids = rows.filter((r) => rowMeta.get(r.id)?.review === 'ok').map((r) => r.id);
    if (!ids.length) { useStore.getState().pushToast({ text: 'No unreviewed rows without issues in this view', ttl: 2500 }); return; }
    const ok = await useStore.getState().confirm({ title: 'Verify rows without issues?', body: `Verify ${ids.length.toLocaleString()} row${ids.length === 1 ? '' : 's'} that have no issues? Rows that need review, flagged rows and rows already verified are left alone.`, confirmLabel: `Verify ${ids.length.toLocaleString()}` });
    if (ok) { labelNext(`verify of ${ids.length} rows`); useStore.getState().setReview(ids, 'verified'); }
  };
  const hist = useHistory();
  const more = usePopover<HTMLButtonElement>();
  const colsPop = usePopover<HTMLButtonElement>();
  const add = usePopover<HTMLButtonElement>();
  const moreItems: MenuItem[] = [
    { id: 'csv', label: 'Download inventory with review (CSV)', icon: Download, hint: 'Every facility and grounds row, issues, edits, source, Hrs and FTE', onSelect: exportCsv },
    { id: 'tsv', label: 'Copy visible rows (TSV)', icon: Copy, hint: `${rows.length.toLocaleString()} rows · paste into Excel`, onSelect: copyVisible },
    { kind: 'separator' },
    { id: 'verify', label: 'Verify rows without issues…', icon: CircleCheck, disabled: incoming, onSelect: () => { void verifyClean(); } },
    { kind: 'separator' },
    { id: 'undo', label: hist.canUndo ? `Undo ${hist.undoLabel}` : 'Undo', icon: Undo2, kbd: 'mod+z', disabled: !hist.canUndo, onSelect: () => { undo(); } },
    { id: 'redo', label: hist.canRedo ? `Redo ${hist.redoLabel}` : 'Redo', icon: Redo2, kbd: 'mod+shift+z', disabled: !hist.canRedo, onSelect: () => { redo(); } },
  ];
  const optional = all.filter((c) => c.key !== 'sel' && c.key !== 'name' && c.key !== 'review');
  const colItems: MenuItem[] = [
    { kind: 'header', label: 'Columns (auto hides as the sheet narrows)' },
    ...optional.map((c) => {
      const pref = prefs.cols[tab][c.key];
      const visible = cols.includes(c);
      return { id: c.key, label: c.menuLabel ?? c.label, checked: visible, keepOpen: true, hint: pref ? (pref === 'show' ? 'Always shown' : 'Hidden') : 'Auto',
        onSelect: () => setColPref(c.key, pref ? null : visible ? 'hide' : 'show') };
    }),
    { kind: 'separator' },
    { id: 'reset', label: 'Reset columns and widths', onSelect: () => { const p = { ...prefs, cols: { ...prefs.cols, [tab]: {} }, widths: { ...prefs.widths, [tab]: {} } }; setPrefs(p); writePrefs(p); } },
    { id: 'density', label: 'Compact rows (28 px)', checked: prefs.density === 28, onSelect: () => setDensity(prefs.density === 28 ? 32 : 28) },
  ];

  // ---- bulk bar (P1) ----
  const checkedIds = useMemo(() => rows.filter((r) => checked.has(r.id)).map((r) => r.id), [rows, checked]);
  const bulk = checkedIds.length > 0;
  const bulkSet = (patch: Partial<Facility>, what: string) => { const n = commitFacilitiesBulk(checkedIds, patch, what); useStore.getState().pushToast({ text: n ? `${what}: ${n} row${n === 1 ? '' : 's'}` : 'Nothing to change', tone: n ? 'ok' : 'info', ttl: 2500, action: n ? { label: 'Undo', run: () => { undo(); } } : undefined }); };
  const bulkKind = (kind: GroundsArea['kind']) => { const m = new Map<string, Partial<GroundsArea>>(); for (const id of checkedIds) m.set(id, { kind }); commitPatches(new Map(), m, `kind of ${checkedIds.length} areas`); };
  const bulkRemove = async () => {
    const n = checkedIds.length;
    const ok = await useStore.getState().confirm({ title: `Remove ${n} row${n === 1 ? '' : 's'}?`, body: `${n === 1 ? 'It leaves' : 'They leave'} the estimate. Grounds attached to removed buildings become site-wide. Ctrl+Z undoes this.`, confirmLabel: `Remove ${n}`, danger: true });
    if (ok) { removeRows(checkedIds); setChecked(new Set()); }
  };
  const bulkReview = (st: 'verified' | 'flagged' | null) => { labelNext(`${st ?? 'clear'} of ${checkedIds.length} rows`); useStore.getState().setReview(checkedIds, st); };
  const cat = usePopover<HTMLButtonElement>(); const svc = usePopover<HTMLButtonElement>(); const stat = usePopover<HTMLButtonElement>(); const kind = usePopover<HTMLButtonElement>();
  const firstId = rows[0]?.id;

  return (
    <div className="tv vp-ui" data-occluder="">
      <div className={cx('tv__toolbar', bulk && 'is-bulk')}>
        {bulk ? (
          <div className="tv__bulk" role="toolbar" aria-label="Bulk actions">
            <span className="tv__bulk-count">{checkedIds.length.toLocaleString()} selected</span>
            <Button size="sm" variant="secondary" icon={CircleCheck} onClick={() => bulkReview('verified')}>Verify</Button>
            <Button size="sm" variant="secondary" icon={Flag} onClick={() => bulkReview('flagged')}>Flag</Button>
            {tab === 'facilities' ? (
              <>
                <Button ref={cat.anchorRef} size="sm" variant="ghost" onClick={cat.toggle} disabled={running} aria-haspopup="menu">Category ▾</Button>
                <Menu open={cat.open} anchor={cat.anchorRef} onClose={cat.close} label="Category" items={FACILITY_CATEGORIES.map((c) => ({ id: c, label: <span className="tv-opt"><i className="tv-dot" style={{ background: categoryColor(c) }} />{CATEGORY_DEFAULTS[c].label}</span>, onSelect: () => bulkSet({ category: c }, `Category → ${CATEGORY_DEFAULTS[c].label}`) }))} />
                <Button ref={svc.anchorRef} size="sm" variant="ghost" onClick={svc.toggle} disabled={running} aria-haspopup="menu">Service ▾</Button>
                <Menu open={svc.open} anchor={svc.anchorRef} onClose={svc.close} label="Service" items={SERVICE_LEVELS.map((x) => ({ id: x.id, label: SERVICE_SHORT[x.id], hint: x.label, onSelect: () => bulkSet({ serviceLevel: x.id }, `Service → ${SERVICE_SHORT[x.id]}`) }))} />
                <Button ref={stat.anchorRef} size="sm" variant="ghost" onClick={stat.toggle} disabled={running} aria-haspopup="menu">Status ▾</Button>
                <Menu open={stat.open} anchor={stat.anchorRef} onClose={stat.close} label="Status" items={FACILITY_STATUSES.map((x) => ({ id: x.id, label: x.label, onSelect: () => bulkSet({ status: x.id === 'in_scope' ? undefined : x.id }, `Status → ${x.label}`) }))} />
              </>
            ) : (
              <>
                <Button ref={kind.anchorRef} size="sm" variant="ghost" onClick={kind.toggle} disabled={running} aria-haspopup="menu">Kind ▾</Button>
                <Menu open={kind.open} anchor={kind.anchorRef} onClose={kind.close} label="Kind" items={GROUNDS_KINDS.map((k) => ({ id: k.id, label: k.label, onSelect: () => bulkKind(k.id) }))} />
              </>
            )}
            <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => { void bulkRemove(); }} disabled={running}>Remove</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => setChecked(new Set())}>Clear</Button>
          </div>
        ) : (
          <>
            <Tabs idBase="table" label="Table" size="sm" value={tab} onChange={(t) => setQuery({ tableTab: t })} className="tv__tabs"
              items={[{ id: 'facilities', label: 'Facilities', count: facilitiesAll.length.toLocaleString() }, { id: 'grounds', label: 'Grounds', count: groundsAll.length.toLocaleString() }]} />
            <QueryChips className="tv__chips" />
            <QuerySearch className="tv-search" size="md" count={shownCount} onEnter={() => { if (firstId) { selectRow(firstId, { frame: false }); gridRef.current?.focus(); } }} onArrowDown={() => gridRef.current?.focus()} />
            <div className="tv__tools">
              <SortMenuButton extraLabel={colSort ? `${all.find((c) => c.key === colSort.key)?.menuLabel ?? all.find((c) => c.key === colSort.key)?.label} ${colSort.desc ? '↓' : '↑'}` : null} onPick={() => setColSort(null)} />
              <IconButton ref={colsPop.anchorRef} icon={Columns3} label="Columns" tooltip="Columns and density" aria-haspopup="menu" aria-expanded={colsPop.open} onClick={colsPop.toggle} />
              <Menu open={colsPop.open} anchor={colsPop.anchorRef} onClose={colsPop.close} label="Columns" items={colItems} />
              <IconButton ref={add.anchorRef} icon={Plus} label="Add" tooltip="Add a building or grounds area" aria-haspopup="menu" aria-expanded={add.open} onClick={add.toggle} disabled={running} />
              <Menu open={add.open} anchor={add.anchorRef} onClose={add.close} label="Add" items={[
                { id: 'b', label: 'Add building', icon: Building2, onSelect: () => { setQuery({ tableTab: 'facilities' }); useStore.getState().addFacility(); } },
                { id: 'g', label: 'Add grounds area', icon: Trees, onSelect: () => { setQuery({ tableTab: 'grounds' }); useStore.getState().addGrounds(); } },
              ]} />
              <IconButton ref={more.anchorRef} icon={Ellipsis} label="More" tooltip="Export, verify, undo" aria-haspopup="menu" aria-expanded={more.open} onClick={more.toggle} />
              <Menu open={more.open} anchor={more.anchorRef} onClose={more.close} label="More" items={moreItems} />
            </div>
          </>
        )}
      </div>
      <Grid<Row> gridRef={gridRef} tab={tab} rows={rows} cols={cols} template={template} minWidth={minWidth} rowH={prefs.density} rowMeta={rowMeta} estById={estById} gestById={gestById}
        review={review} maxFte={maxFte} hostLabel={hostLabel} facilities={facilitiesAll} readOnly={running} checked={checked} onCheck={onCheck} onCheckAll={onCheckAll}
        sortCol={sortCol} onSort={onSort} widths={widths} onResize={onResize} onWidth={setAvail} commit={commit} onCopy={onCopy} onPaste={onPaste} onRevert={onRevert}
        incoming={incoming}
        empty={incoming ? 'The read has not found any rows yet.' : tabTotal ? <>No rows match this filter. <button type="button" className="link-btn" onClick={() => setQuery({ text: '', chip: 'all' })}>Clear filters</button></> : tab === 'facilities' ? 'No buildings yet.' : 'No grounds areas yet.'} />
      <div className="tv__foot">
        <span className="tv__totals">{rows.length.toLocaleString()} of {tabTotal.toLocaleString()}{tab === 'facilities' ? ` · ${compact(totals.sf)} SF` : ''} · {n1(totals.fte)} FTE{checkedIds.length ? <b> · {checkedIds.length} selected</b> : null}</span>
        <span className="tv__meter" title={`${counts.verified} verified · ${counts.needs} need review · ${counts.flagged} flagged`}>Reviewed {counts.verified.toLocaleString()}/{counts.total.toLocaleString()} <Meter value={counts.verified} max={counts.total} label="Review progress" /></span>
        {counts.edited > 0 && <Chip tone="edit" className="tv__edited">{counts.edited} edited</Chip>}
        <span className="tv__hint">{running ? 'Editing paused while reading · V verify · J next' : 'Enter edit · V verify · X flag · J next · R revert'}</span>
      </div>
    </div>
  );
});

const EMPTY_F: Facility[] = [];
const EMPTY_G: GroundsArea[] = [];
