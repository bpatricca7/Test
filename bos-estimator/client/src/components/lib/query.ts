// Inventory search, filter and sort (UI spec §5.3). One query model for the rail list and the Table view:
// store.query = { text, chip, sort, desc, tableTab }. This module
//   - parses the search syntax ("5995", "cat:dining conf<60 sf>50k #59* is:needs campus:north src:"TE-5" issue:dup"),
//   - filters and sorts facilities and grounds (Impact = fte × (1 − confidence)),
//   - publishes store.filterIds for the 3D (150 ms debounce, null when no query or chip is active),
//   - keeps the visible row order of the list and the table for the J/K review loop and the Inspector's "7 / 32".

import { useDeferredValue, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import { groundsSqft } from '@shared/estimate';
import { FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, type Facility, type FacilityCategory, type GroundsArea } from '@shared/types';
import { useStore, type InventoryQuery, type QueryChip, type SortKey } from '../../store';
import { useDerived } from '../../derived';
import { ISSUE_CODES, normBldg, normCampus, rowMetaFor, sharedContext, type IssueCode, type ReviewMap, type RowMeta } from './review';
import { parseNumber } from './parse';

// ------------------------------------------------------------------ parsing
export type Cmp = '<' | '<=' | '>' | '>=' | '=';
export interface QueryToken { key: string; value: string; op: Cmp | ':'; num?: number; neg: boolean; raw: string }
export interface ParsedQuery { terms: string[]; tokens: QueryToken[]; empty: boolean; uses: { recent: boolean; meta: boolean } }

const KEY_ALIAS: Record<string, string> = {
  cat: 'cat', category: 'cat', type: 'cat', kind: 'cat',
  conf: 'conf', confidence: 'conf',
  sf: 'sf', gross: 'sf', gsf: 'sf', area: 'sf',
  fte: 'fte',
  bldg: 'bldg', building: 'bldg', no: 'bldg', num: 'bldg',
  is: 'is', has: 'is',
  campus: 'campus', site: 'campus', zone: 'campus',
  status: 'status',
  src: 'src', source: 'src', file: 'src', table: 'src',
  issue: 'issue', issues: 'issue',
  svc: 'svc', service: 'svc', freq: 'svc',
};

/** Split on whitespace, keeping "quoted values" (and key:"quoted values") together. */
function split(text: string): string[] {
  const out: string[] = [];
  let cur = ''; let q = false;
  for (const ch of text) {
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (!q && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unquote = (s: string) => s.replace(/^"/, '').replace(/"$/, '');

export function parseQuery(text: string): ParsedQuery {
  const terms: string[] = []; const tokens: QueryToken[] = [];
  for (const raw0 of split(text.trim())) {
    let raw = raw0; let neg = false;
    if (raw.length > 1 && raw.startsWith('-') && !/^-\d/.test(raw)) { neg = true; raw = raw.slice(1); }
    // "#59*" / "#5995" → building number
    if (raw.startsWith('#') && raw.length > 1) { tokens.push({ key: 'bldg', value: unquote(raw.slice(1)), op: ':', neg, raw: raw0 }); continue; }
    const m = /^([a-z]+)(:|<=|>=|<|>|=)(.*)$/i.exec(raw);
    const key = m ? KEY_ALIAS[m[1].toLowerCase()] : undefined;
    if (!m || !key) { const t = unquote(raw).trim().toLowerCase(); if (t) terms.push(neg ? `-${t}` : t); continue; }
    let op = m[2] as QueryToken['op'];
    let value = unquote(m[3]).trim();
    // "conf:<60" is accepted too
    const inner = /^(<=|>=|<|>|=)(.*)$/.exec(value);
    if (op === ':' && inner) { op = inner[1] as Cmp; value = inner[2].trim(); }
    if (!value) continue; // "cat:" while typing: ignore until there is a value
    const tok: QueryToken = { key, value, op, neg, raw: raw0 };
    if (key === 'conf' || key === 'sf' || key === 'fte') {
      if (key === 'conf') {
        const pct = value.endsWith('%'); const v = Number(value.replace('%', ''));
        if (Number.isFinite(v)) tok.num = pct || v > 1 || !value.includes('.') ? v / 100 : v;
      } else {
        const r = parseNumber(value);
        if (r.ok && r.value !== undefined) tok.num = r.value;
      }
      if (tok.num === undefined) continue; // incomplete number while typing
      if (op === ':') tok.op = '=';
    }
    tokens.push(tok);
  }
  const uses = {
    recent: tokens.some((t) => t.key === 'is' && /^new/.test(t.value.toLowerCase())),
    meta: tokens.some((t) => t.key === 'is' || t.key === 'issue'),
  };
  return { terms, tokens, empty: !terms.length && !tokens.length, uses };
}

// ------------------------------------------------------------------ matching
export interface MatchCtx {
  meta: (id: string) => RowMeta | undefined;
  recent?: Record<string, number> | null;
  changed?: ReadonlySet<string> | null;
  incoming?: ReadonlySet<string> | null;
  fte?: (id: string) => number | undefined;
}

const cmp = (v: number, op: QueryToken['op'], n: number) => (op === '<' ? v < n : op === '<=' ? v <= n : op === '>' ? v > n : op === '>=' ? v >= n : Math.abs(v - n) < 1e-9);
const globRe = (pattern: string) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

function bldgMatch(no: string | undefined, value: string): boolean {
  const b = normBldg(no); if (!b) return false;
  if (value.includes('*')) {
    const v = value.toUpperCase();
    return globRe(v).test(b) || globRe(normBldg(v.replace(/\*/g, '\u0000')).replace(/\u0000/g, '*')).test(b);
  }
  return b === normBldg(value);
}

const catLabel = (c: FacilityCategory) => CATEGORY_DEFAULTS[c]?.label.toLowerCase() ?? c;
const kindLabel = (k: GroundsArea['kind']) => GROUNDS_KINDS.find((x) => x.id === k)?.label.toLowerCase() ?? k;
const statusLabel = (s: Facility['status']) => FACILITY_STATUSES.find((x) => x.id === (s ?? 'in_scope'))?.label.toLowerCase() ?? '';
const serviceLabel = (s: Facility['serviceLevel']) => SERVICE_LEVELS.find((x) => x.id === s)?.label.toLowerCase() ?? s;

function isMatch(id: string, value: string, m: RowMeta | undefined, ctx: MatchCtx): boolean {
  const v = value.toLowerCase();
  if (/^needs?/.test(v) || v === 'review') return m?.review === 'needs';
  if (/^verif/.test(v)) return m?.review === 'verified';
  if (/^flag/.test(v)) return m?.review === 'flagged';
  if (/^(unrev|open)/.test(v)) return m?.review === 'needs' || m?.review === 'ok';
  if (v === 'ok' || v === 'clean') return m?.review === 'ok';
  if (/^(excl|out|oos)/.test(v)) return m ? !m.inScope : false;
  if (/^(in|inscope|in_scope)$/.test(v)) return m ? m.inScope : true;
  if (/^edit/.test(v)) return Boolean(m?.edited);
  if (/^new/.test(v)) return Boolean(ctx.recent?.[id]);
  if (/^chang/.test(v)) return Boolean(ctx.changed?.has(id));
  if (/^incom/.test(v)) return Boolean(ctx.incoming?.has(id));
  if (/^(issue|issues|problem)/.test(v)) return Boolean(m?.issues.length);
  return false;
}
const ISSUE_ALIASES: [RegExp, IssueCode][] = [
  [/^dup/, 'dup_bldg'], [/^(low|conf)/, 'low_conf'], [/^(no_?b|no_?num|nonum|number)/, 'no_bldg_no'], [/^(zero_?s|nosf|no_?sf|sf$)/, 'zero_sf'],
  [/^(clean|gt)/, 'clean_gt_gross'], [/^(excerpt|mismatch|not_?in|sf_not)/, 'sf_not_in_excerpt'], [/^(unit|conv|metric|m2|sm)/, 'unit_converted'],
  [/^(out|scope|excl)/, 'out_of_scope'], [/^(no_?s|nosrc|source|src)/, 'no_source'], [/^(rerun|chang)/, 'rerun_changed'], [/^(zero_?q|qty|noqty)/, 'zero_qty'],
];
function issueOf(value: string): IssueCode | null {
  const v = value.toLowerCase();
  if ((ISSUE_CODES as string[]).includes(v)) return v as IssueCode;
  for (const [re, code] of ISSUE_ALIASES) if (re.test(v)) return code;
  return null;
}

function tokenMatchesFacility(f: Facility, t: QueryToken, ctx: MatchCtx): boolean {
  const v = t.value.toLowerCase();
  switch (t.key) {
    case 'cat': return f.category === v || f.category.startsWith(v) || catLabel(f.category).includes(v);
    case 'conf': return cmp(f.confidence, t.op, t.num!);
    case 'sf': return cmp(f.grossSqft || 0, t.op, t.num!);
    case 'fte': { const x = ctx.fte?.(f.id); return x != null && cmp(x, t.op, t.num!); }
    case 'bldg': return bldgMatch(f.buildingNumber, t.value);
    case 'is': return isMatch(f.id, t.value, ctx.meta(f.id), ctx);
    case 'campus': return v === 'none' ? !f.campus : normCampus(f.campus).includes(normCampus(t.value));
    case 'status': { const s = f.status ?? 'in_scope'; return s === v || s.startsWith(v) || statusLabel(f.status).includes(v); }
    case 'src': return (f.source?.file ?? '').toLowerCase().includes(v) || (f.tableId ?? '').toLowerCase().includes(v) || (f.source?.excerpt ?? '').toLowerCase().includes(v) || (v.startsWith('p') && Number(v.slice(1)) === f.source?.page);
    case 'issue': { const code = issueOf(t.value); return code ? Boolean(ctx.meta(f.id)?.issues.includes(code)) : false; }
    case 'svc': return f.serviceLevel === v || serviceLabel(f.serviceLevel).includes(v) || (f.serviceFrequencyText ?? '').toLowerCase().includes(v);
  }
  return false;
}
function tokenMatchesGrounds(g: GroundsArea, t: QueryToken, ctx: MatchCtx): boolean {
  const v = t.value.toLowerCase();
  switch (t.key) {
    case 'cat': return g.kind === v || g.kind.startsWith(v) || kindLabel(g.kind).includes(v) || v === 'grounds';
    case 'conf': return cmp(g.confidence, t.op, t.num!);
    case 'fte': { const x = ctx.fte?.(g.id); return x != null && cmp(x, t.op, t.num!); }
    case 'is': return isMatch(g.id, t.value, ctx.meta(g.id), ctx);
    case 'campus': return v === 'none' ? !g.campus : normCampus(g.campus).includes(normCampus(t.value));
    case 'src': return (g.source?.file ?? '').toLowerCase().includes(v) || (g.source?.excerpt ?? '').toLowerCase().includes(v) || (g.documentLabel ?? '').toLowerCase().includes(v);
    case 'issue': { const code = issueOf(t.value); return code ? Boolean(ctx.meta(g.id)?.issues.includes(code)) : false; }
    default: return false; // sf, bldg, status, svc are facility-only
  }
}

function termMatchesFacility(f: Facility, term: string): boolean {
  const q = term.replace(/^#/, '');
  if (!q) return true;
  const b = normBldg(f.buildingNumber).toLowerCase();
  const nq = normBldg(q).toLowerCase();
  return (b && (b.startsWith(nq || q) || (f.buildingNumber ?? '').toLowerCase().startsWith(q))) || f.name.toLowerCase().includes(q) || (f.campus ?? '').toLowerCase().includes(q);
}
function termMatchesGrounds(g: GroundsArea, term: string): boolean {
  return g.name.toLowerCase().includes(term) || (g.documentLabel ?? '').toLowerCase().includes(term) || (g.campus ?? '').toLowerCase().includes(term) || kindLabel(g.kind).includes(term);
}

/** Positive tokens with the same key are OR'ed, different keys AND'ed; negated tokens must not match; free-text terms AND. */
function matchAll<T>(row: T, pq: ParsedQuery, term: (r: T, t: string) => boolean, tok: (r: T, t: QueryToken) => boolean): boolean {
  for (const t of pq.terms) { const neg = t.startsWith('-') && t.length > 1; if (term(row, neg ? t.slice(1) : t) === neg) return false; }
  if (!pq.tokens.length) return true;
  const groups = new Map<string, boolean>();
  for (const t of pq.tokens) {
    const m = tok(row, t);
    if (t.neg) { if (m) return false; continue; }
    groups.set(t.key, (groups.get(t.key) ?? false) || m);
  }
  for (const ok of groups.values()) if (!ok) return false;
  return true;
}
export const matchFacility = (f: Facility, pq: ParsedQuery, ctx: MatchCtx) => matchAll(f, pq, termMatchesFacility, (r, t) => tokenMatchesFacility(r, t, ctx));
export const matchGrounds = (g: GroundsArea, pq: ParsedQuery, ctx: MatchCtx) => matchAll(g, pq, termMatchesGrounds, (r, t) => tokenMatchesGrounds(r, t, ctx));

export function matchChip(chip: QueryChip, id: string, m: RowMeta | undefined, ctx: MatchCtx): boolean {
  switch (chip) {
    case 'all': return true;
    case 'needs': return m?.review === 'needs';
    case 'flagged': return m?.review === 'flagged';
    case 'out': return m ? !m.inScope : false;
    case 'edited': return Boolean(m?.edited);
    case 'changed': return Boolean(ctx.changed?.has(id));
    case 'incoming': return Boolean(ctx.incoming?.has(id));
  }
}

export const queryActive = (q: Pick<InventoryQuery, 'text' | 'chip'>) => q.chip !== 'all' || q.text.trim() !== '';

// ------------------------------------------------------------------ sorting
export const SORTS: { id: SortKey; label: string; desc: boolean; hint?: string }[] = [
  { id: 'source', label: 'Source order', desc: false, hint: 'As the reader found them (matches the printed table)' },
  { id: 'impact', label: 'Impact', desc: true, hint: 'FTE × (1 − confidence): the rows that move the estimate most' },
  { id: 'bldg', label: 'Building #', desc: false },
  { id: 'name', label: 'Name', desc: false },
  { id: 'gross', label: 'Gross SF', desc: true },
  { id: 'fte', label: 'FTE', desc: true },
  { id: 'conf', label: 'Confidence', desc: false, hint: 'Lowest first' },
];
export const sortLabel = (k: SortKey) => SORTS.find((s) => s.id === k)?.label ?? k;
/** Choosing a sort applies its natural direction (Impact, SF and FTE descend; the rest ascend). */
export const sortPatch = (k: SortKey): Partial<InventoryQuery> => ({ sort: k, desc: SORTS.find((s) => s.id === k)?.desc ?? false });

/** Building number, or a grounds area's document label ("Type II", "GE-01"). */
const idOf = (r: Facility | GroundsArea) => ('grossSqft' in r ? r.buildingNumber : r.documentLabel);
/** Gross SF, or a grounds area's size in SF, so "Gross SF" also orders the grounds section by size. */
const sizeOf = (r: Facility | GroundsArea) => ('grossSqft' in r ? r.grossSqft || 0 : groundsSqft(r));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Natural building-number order ("59" < "590" < "5995", "PB-2" < "PB-10"); rows without a number go last. */
export function compareBldg(a: string | undefined, b: string | undefined): number {
  const x = normBldg(a), y = normBldg(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return collator.compare(x, y);
}
export const compareText = (a: string, b: string) => collator.compare(a, b);

export type ExtraSort = { key: string; desc: boolean; value: (row: Facility | GroundsArea) => number | string | undefined } | null;

/**
 * Stable sort of one section. `desc` reverses the comparison (ties stay in source order).
 * `extra` (Table view column sorts that the shared SortKey does not cover) wins over `sort`.
 */
export function sortRows<T extends Facility | GroundsArea>(rows: readonly T[], sort: SortKey, desc: boolean, fte: (id: string) => number, extra?: ExtraSort): T[] {
  if (!extra && sort === 'source') return desc ? [...rows].reverse() : rows as T[];
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  const dir = (extra ? extra.desc : desc) ? -1 : 1;
  let f: (a: T, b: T) => number;
  if (extra) {
    const val = new Map(rows.map((r) => [r.id, extra.value(r)]));
    f = (a, b) => {
      const x = val.get(a.id), y = val.get(b.id);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
    };
  } else {
    switch (sort) {
      case 'impact': { const v = (r: T) => (fte(r.id) || 0) * (1 - r.confidence); f = (a, b) => dir * (v(a) - v(b)); break; }
      case 'bldg': f = (a, b) => {
        const x = idOf(a), y = idOf(b);
        if (!normBldg(x) || !normBldg(y)) return compareBldg(x, y); // no number: always last
        return dir * compareBldg(x, y);
      }; break;
      case 'name': f = (a, b) => dir * collator.compare(a.name, b.name); break;
      case 'gross': f = (a, b) => dir * (sizeOf(a) - sizeOf(b)); break;
      case 'fte': f = (a, b) => dir * ((fte(a.id) || 0) - (fte(b.id) || 0)); break;
      case 'conf': f = (a, b) => dir * (a.confidence - b.confidence); break;
      default: f = () => 0;
    }
  }
  return [...rows].sort((a, b) => f(a, b) || idx.get(a.id)! - idx.get(b.id)!);
}

// ------------------------------------------------------------------ the shared view (React)
export interface InventoryView {
  /** filtered + sorted */
  facilities: Facility[];
  grounds: GroundsArea[];
  /** staged rows of a Replace run (shown only under the Incoming chip; read-only) */
  incomingFacilities: Facility[];
  incomingGrounds: GroundsArea[];
  /** inventory sizes */
  totalFacilities: number;
  totalGrounds: number;
  /** matching rows (facilities + grounds, or incoming rows under the Incoming chip) */
  shown: number;
  active: boolean;
  parsed: ParsedQuery;
}

const EMPTY_F: Facility[] = [];
const EMPTY_G: GroundsArea[] = [];

/** The filtered, sorted inventory for the current store.query. Used by the rail list and the table. */
export function useInventoryView(extra?: ExtraSort): InventoryView {
  const facilities = useStore((s) => s.project?.inventory.facilities) ?? EMPTY_F;
  const grounds = useStore((s) => s.project?.inventory.grounds) ?? EMPTY_G;
  const chip = useStore((s) => s.query.chip);
  const sort = useStore((s) => s.query.sort);
  const desc = useStore((s) => s.query.desc);
  const rawText = useStore((s) => s.query.text);
  const changedIds = useStore((s) => s.extraction.result?.changedIds);
  const staging = useStore((s) => s.extraction.staging);
  const { rowMeta, estById, gestById } = useDerived();
  const text = useDeferredValue(rawText);
  const parsed = useMemo(() => parseQuery(text), [text]);
  const recent = useStore((s) => (parsed.uses.recent ? s.extraction.recent : null));

  const filtered = useMemo(() => {
    const changed = changedIds?.length ? new Set(changedIds) : null;
    const incoming = staging.active ? new Set([...staging.incoming.map((f) => f.id), ...staging.incomingGrounds.map((g) => g.id)]) : null;
    const ctx: MatchCtx = { meta: (id) => rowMeta.get(id), recent, changed, incoming, fte: (id) => estById.get(id)?.fte ?? gestById.get(id)?.fte };
    if (chip === 'incoming') {
      const metaCtx: MatchCtx = { ...ctx, meta: () => undefined };
      return {
        f: EMPTY_F, g: EMPTY_G,
        inF: staging.incoming.filter((f) => matchFacility(f, parsed, metaCtx)),
        inG: staging.incomingGrounds.filter((g) => matchGrounds(g, parsed, metaCtx)),
      };
    }
    const noFilter = parsed.empty && chip === 'all';
    return {
      f: noFilter ? facilities : facilities.filter((f) => matchChip(chip, f.id, rowMeta.get(f.id), ctx) && matchFacility(f, parsed, ctx)),
      g: noFilter ? grounds : grounds.filter((g) => matchChip(chip, g.id, rowMeta.get(g.id), ctx) && matchGrounds(g, parsed, ctx)),
      inF: EMPTY_F, inG: EMPTY_G,
    };
    // estById/gestById only matter for fte: tokens
  }, [facilities, grounds, parsed, chip, rowMeta, recent, changedIds, staging, parsed.tokens.some((t) => t.key === 'fte') ? estById : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const fteOf = useMemo(() => (id: string) => estById.get(id)?.fte ?? gestById.get(id)?.fte ?? 0, [estById, gestById]);
  const needsFte = sort === 'impact' || sort === 'fte' || Boolean(extra);
  const sorted = useMemo(() => ({
    f: sortRows(filtered.f, sort, desc, fteOf, extra),
    g: sortRows(filtered.g, sort, desc, fteOf, extra),
  }), [filtered, sort, desc, extra, needsFte ? fteOf : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    facilities: sorted.f,
    grounds: sorted.g,
    incomingFacilities: filtered.inF,
    incomingGrounds: filtered.inG,
    totalFacilities: facilities.length,
    totalGrounds: grounds.length,
    shown: chip === 'incoming' ? filtered.inF.length + filtered.inG.length : sorted.f.length + sorted.g.length,
    active: chip !== 'all' || !parsed.empty,
    parsed,
  };
}

// ------------------------------------------------------------------ visible order (J/K loop, Inspector position)
export type NavSource = 'list' | 'table';
interface NavState { list: readonly string[]; table: readonly string[] }
/** Visible row order of each surface, newest render wins. Read with currentOrder(). */
export const useNavOrder = create<NavState>(() => ({ list: [], table: [] }));

/** Publish a surface's visible order (call from an effect). */
export function usePublishOrder(source: NavSource, ids: readonly string[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const cur = useNavOrder.getState()[source];
    if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return;
    useNavOrder.setState({ [source]: ids } as Partial<NavState>);
  }, [source, ids, enabled]);
}

/** The order J/K walk: the table's in Table view, the rail list's otherwise; falls back to inventory order. */
export function currentOrder(): readonly string[] {
  const s = useStore.getState();
  const nav = useNavOrder.getState();
  const o = s.view === 'table' ? nav.table : nav.list;
  if (o.length) return o;
  const inv = s.project?.inventory; if (!inv) return [];
  return [...inv.facilities.map((f) => f.id), ...inv.grounds.map((g) => g.id)];
}

// ------------------------------------------------------------------ RowMeta outside React (same cache as derived.ts)
/** RowMeta for every row, computed from the store (shares the per-row cache with derived.ts). */
export function metaSnapshot(): Map<string, RowMeta> {
  const s = useStore.getState(); const p = s.project; const m = new Map<string, RowMeta>();
  if (!p) return m;
  const ctx = sharedContext(p.inventory.facilities, s.extraction.result?.changedIds ?? []);
  const review: ReviewMap = p.review ?? {};
  for (const f of p.inventory.facilities) m.set(f.id, rowMetaFor(f, 'facility', ctx, review[f.id]));
  for (const g of p.inventory.grounds) m.set(g.id, rowMetaFor(g, 'grounds', ctx, review[g.id]));
  return m;
}
/** RowMeta of one row, from the store. */
export function metaOf(id: string): RowMeta | undefined {
  const s = useStore.getState(); const p = s.project; if (!p) return undefined;
  const ctx = sharedContext(p.inventory.facilities, s.extraction.result?.changedIds ?? []);
  const f = p.inventory.facilities.find((x) => x.id === id);
  if (f) return rowMetaFor(f, 'facility', ctx, p.review?.[id]);
  const g = p.inventory.grounds.find((x) => x.id === id);
  return g ? rowMetaFor(g, 'grounds', ctx, p.review?.[id]) : undefined;
}

// ------------------------------------------------------------------ filterIds publisher (§2.9: 150 ms debounce)
/** The ids matching the active query and chip (facilities, grounds and staged rows), or null when nothing is active. */
export function computeFilterIds(): ReadonlySet<string> | null {
  const s = useStore.getState(); const q = s.query; const p = s.project;
  if (!p || !queryActive(q)) return null;
  const pq = parseQuery(q.text);
  if (pq.empty && q.chip === 'all') return null;
  const st = s.extraction.staging;
  const incoming = st.active ? new Set([...st.incoming.map((f) => f.id), ...st.incomingGrounds.map((g) => g.id)]) : null;
  const changed = s.extraction.result?.changedIds?.length ? new Set(s.extraction.result.changedIds) : null;
  const metas = q.chip !== 'all' || pq.uses.meta ? metaSnapshot() : null;
  const ctx: MatchCtx = { meta: (id) => metas?.get(id), recent: s.extraction.recent, changed, incoming };
  const out = new Set<string>();
  if (q.chip === 'incoming') {
    const c: MatchCtx = { ...ctx, meta: () => undefined };
    for (const f of st.incoming) if (matchFacility(f, pq, c)) out.add(f.id);
    for (const g of st.incomingGrounds) if (matchGrounds(g, pq, c)) out.add(g.id);
    return out;
  }
  for (const f of p.inventory.facilities) if (matchChip(q.chip, f.id, metas?.get(f.id), ctx) && matchFacility(f, pq, ctx)) out.add(f.id);
  for (const g of p.inventory.grounds) if (matchChip(q.chip, g.id, metas?.get(g.id), ctx) && matchGrounds(g, pq, ctx)) out.add(g.id);
  return out;
}

const sameSet = (a: ReadonlySet<string> | null, b: ReadonlySet<string> | null) => {
  if (a === b) return true; if (!a || !b || a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

let pubTimer: ReturnType<typeof setTimeout> | null = null;
let pubFirst = 0;
function publishNow() {
  pubTimer = null; pubFirst = 0;
  const next = computeFilterIds();
  const s = useStore.getState();
  if (!sameSet(s.filterIds, next)) s.setFilterIds(next);
}
/** Trailing 150 ms debounce, at most 600 ms behind while changes keep coming (streaming). */
function schedulePublish() {
  const now = performance.now();
  if (!pubFirst) pubFirst = now;
  if (pubTimer) clearTimeout(pubTimer);
  pubTimer = setTimeout(publishNow, now - pubFirst > 450 ? 0 : 150);
}

let unsubscribe: (() => void) | null = null;
/** Starts the filterIds publisher once (idempotent; the import of this module starts it). */
export function startFilterPublisher() {
  if (unsubscribe) return;
  unsubscribe = useStore.subscribe((s, prev) => {
    const queryChanged = s.query.text !== prev.query.text || s.query.chip !== prev.query.chip;
    const active = queryActive(s.query);
    if (!active && !queryChanged) return; // nothing to keep in sync
    const dataChanged = s.project?.inventory !== prev.project?.inventory || s.project?.review !== prev.project?.review
      || s.extraction.staging !== prev.extraction.staging || s.extraction.result !== prev.extraction.result
      || (s.extraction.recent !== prev.extraction.recent && /is:new/i.test(s.query.text));
    if (queryChanged || dataChanged) schedulePublish();
  });
  // a query restored before this module loaded
  if (queryActive(useStore.getState().query)) schedulePublish();
}
startFilterPublisher();
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe?.(); unsubscribe = null; if (pubTimer) clearTimeout(pubTimer); });
