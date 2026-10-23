// Review queue for the Inspector's "‹ K · 7 / 32 · J ›" control, the project summary's [Start review] and the run
// strip's [Review N] (UI spec §5.7, §6.4). It orders rows by store.query (sort + chip + text) the way the inventory
// list does, then keeps the rows whose review key is `needs`.
//
// The inventory engineer owns components/lib/query.ts; this is a small local reading of the same query model
// (free text, the P0 tokens, the chips and the sort keys) so the inspector does not depend on that file landing.

import type { FacilityEstimate, GroundsEstimate } from '@shared/estimate';
import type { Facility, GroundsArea, Inventory } from '@shared/types';
import { useStore, type InventoryQuery } from '../../store';
import type { RowMeta } from '../../derived';
import { normBldg } from '../lib/review';

export interface QueueRow { kind: 'facility' | 'grounds'; id: string }

type Row = { kind: 'facility'; f: Facility } | { kind: 'grounds'; g: GroundsArea };

const TOKEN = /(\w+)([:<>])("[^"]*"|\S*)/g;

function parseSize(v: string): number {
  const m = /^([\d.,]+)\s*([km])?$/i.exec(v.trim());
  if (!m) return NaN;
  const n = Number(m[1].replace(/,/g, ''));
  return n * (m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1);
}

/** A predicate for the free-text part of the query (building # prefix, name, campus) plus the P0 tokens. */
export function textPredicate(text: string, rowMeta: ReadonlyMap<string, RowMeta>, recent: Readonly<Record<string, number>>): (r: Row) => boolean {
  const tests: ((r: Row) => boolean)[] = [];
  const rest = text.replace(TOKEN, (_m, key: string, op: string, raw: string) => {
    const k = key.toLowerCase(); const v = raw.replace(/^"|"$/g, '').toLowerCase();
    if (k === 'cat' && op === ':') tests.push((r) => r.kind === 'facility' && r.f.category.startsWith(v.replace(/\s+/g, '_')));
    else if (k === 'conf' && op !== ':') { const n = Number(v) / (Number(v) > 1 ? 100 : 1); tests.push((r) => { const c = r.kind === 'facility' ? r.f.confidence : r.g.confidence; return op === '<' ? c < n : c > n; }); }
    else if (k === 'sf' && op !== ':') { const n = parseSize(v); tests.push((r) => r.kind === 'facility' && (op === '<' ? r.f.grossSqft < n : r.f.grossSqft > n)); }
    else if (k === 'bldg' && op === ':') { const p = normBldg(v.replace(/\*$/, '')); tests.push((r) => r.kind === 'facility' && normBldg(r.f.buildingNumber).startsWith(p)); }
    else if (k === 'is' && op === ':') {
      tests.push((r) => {
        const id = r.kind === 'facility' ? r.f.id : r.g.id; const m = rowMeta.get(id);
        if (v === 'needs') return m?.review === 'needs';
        if (v === 'verified') return m?.review === 'verified';
        if (v === 'flagged') return m?.review === 'flagged';
        if (v === 'excluded') return m ? !m.inScope : false;
        if (v === 'new') return recent[id] != null;
        if (v === 'edited') return Boolean(m?.edited);
        return true;
      });
    } else return _m;
    return ' ';
  }).trim().toLowerCase();
  if (rest) {
    const q = rest.replace(/^#/, '').replace(/\*$/, '');
    const nq = normBldg(q).toLowerCase();
    tests.push((r) => {
      const x = r.kind === 'facility' ? r.f : r.g;
      const no = r.kind === 'facility' ? normBldg(r.f.buildingNumber).toLowerCase() : '';
      return (nq !== '' && no.startsWith(nq)) || x.name.toLowerCase().includes(q) || (x.campus ?? '').toLowerCase().includes(q);
    });
  }
  return (r) => tests.every((t) => t(r));
}

/** Rows in the order the inventory shows them for the current query. */
export function orderedRows(inv: Inventory, q: InventoryQuery, rowMeta: ReadonlyMap<string, RowMeta>, estById: ReadonlyMap<string, FacilityEstimate>, gestById: ReadonlyMap<string, GroundsEstimate>, recent: Readonly<Record<string, number>> = {}, changedIds: readonly string[] = []): QueueRow[] {
  const pred = textPredicate(q.text, rowMeta, recent);
  const changed = new Set(changedIds);
  const chipOk = (id: string) => {
    const m = rowMeta.get(id);
    switch (q.chip) {
      case 'needs': return m?.review === 'needs';
      case 'flagged': return m?.review === 'flagged';
      case 'out': return m ? !m.inScope : false;
      case 'edited': return Boolean(m?.edited);
      case 'changed': return changed.has(id);
      default: return true;
    }
  };
  const rows: (Row & { i: number })[] = [];
  inv.facilities.forEach((f, i) => { const r: Row = { kind: 'facility', f }; if (chipOk(f.id) && pred(r)) rows.push({ ...r, i }); });
  inv.grounds.forEach((g, i) => { const r: Row = { kind: 'grounds', g }; if (chipOk(g.id) && pred(r)) rows.push({ ...r, i: 1e6 + i }); });
  const fte = (r: Row) => (r.kind === 'facility' ? estById.get(r.f.id)?.fte ?? 0 : gestById.get(r.g.id)?.fte ?? 0);
  const conf = (r: Row) => (r.kind === 'facility' ? r.f.confidence : r.g.confidence);
  const name = (r: Row) => (r.kind === 'facility' ? r.f.name : r.g.name);
  let cmp: (a: Row & { i: number }, b: Row & { i: number }) => number;
  switch (q.sort) {
    case 'impact': cmp = (a, b) => fte(b) * (1 - conf(b)) - fte(a) * (1 - conf(a)) || a.i - b.i; break;
    case 'bldg': cmp = (a, b) => (a.kind === 'facility' ? a.f.buildingNumber ?? '￿' : '￿').localeCompare(b.kind === 'facility' ? b.f.buildingNumber ?? '￿' : '￿', undefined, { numeric: true }) || a.i - b.i; break;
    case 'name': cmp = (a, b) => name(a).localeCompare(name(b)) || a.i - b.i; break;
    case 'gross': cmp = (a, b) => (a.kind === 'facility' ? a.f.grossSqft : 0) - (b.kind === 'facility' ? b.f.grossSqft : 0) || a.i - b.i; break;
    case 'fte': cmp = (a, b) => fte(a) - fte(b) || a.i - b.i; break;
    case 'conf': cmp = (a, b) => conf(a) - conf(b) || a.i - b.i; break;
    default: cmp = (a, b) => a.i - b.i;
  }
  rows.sort(cmp);
  if (q.desc) rows.reverse();
  // facilities before grounds (the list has two sections), keeping the order inside each
  const out: QueueRow[] = [];
  for (const r of rows) if (r.kind === 'facility') out.push({ kind: 'facility', id: r.f.id });
  for (const r of rows) if (r.kind === 'grounds') out.push({ kind: 'grounds', id: r.g.id });
  return out;
}

export interface QueuePos { index: number | null; total: number; prev: QueueRow | null; next: QueueRow | null }

/** Position of `id` in the needs queue, and the needs rows before and after it in list order. */
export function queuePosition(rows: readonly QueueRow[], rowMeta: ReadonlyMap<string, RowMeta>, id: string | null): QueuePos {
  const needs: number[] = [];
  let at = -1;
  rows.forEach((r, i) => { if (rowMeta.get(r.id)?.review === 'needs') needs.push(i); if (r.id === id) at = i; });
  const qi = at >= 0 ? needs.indexOf(at) : -1;
  if (at < 0) return { index: null, total: needs.length, prev: null, next: needs.length ? rows[needs[0]] : null };
  const before = needs.filter((i) => i < at); const after = needs.filter((i) => i > at);
  return {
    index: qi >= 0 ? qi + 1 : null,
    total: needs.length,
    prev: before.length ? rows[before[before.length - 1]] : null,
    next: after.length ? rows[after[0]] : null,
  };
}

/** Select a row and frame it in the map (J/K, Start review, Review N). */
export function goToRow(r: QueueRow | null) {
  if (!r) return;
  const s = useStore.getState();
  s.select({ kind: r.kind, id: r.id });
  s.requestCamera('frame-selection');
}

/** The first needs-review row by impact (fte × (1 − confidence)), used by [Review N] and [Start review]. */
export function firstNeedsByImpact(inv: Inventory, rowMeta: ReadonlyMap<string, RowMeta>, estById: ReadonlyMap<string, FacilityEstimate>, gestById: ReadonlyMap<string, GroundsEstimate>): QueueRow | null {
  const rows = orderedRows(inv, { text: '', chip: 'needs', sort: 'impact', desc: false, tableTab: 'facilities' }, rowMeta, estById, gestById);
  return rows[0] ?? null;
}
