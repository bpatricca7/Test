// Table view columns (UI spec §5.6): widths, auto-hide order, sticky identifier columns, cell renderers, and the
// editors (text / number / select / review menu) with lib/parse.ts validation. Pure definitions; Grid.tsx renders.

import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, FileText, Flag } from 'lucide-react';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import { FACILITY_CATEGORIES, FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, type Facility, type GroundsArea, type GroundsUnit, type ServiceLevel } from '@shared/types';
import type { FacilityEstimate, GroundsEstimate } from '@shared/estimate';
import { groundsAcres, resolveMealsPerDay } from '@shared/estimate';
import type { SortKey } from '../../store';
import type { RowMeta } from '../../derived';
import { n0, n1, n2 } from '../../fmt';
import { CONF_COLOR, CONF_GLYPH, categoryColor } from '../lib/theme';
import { AREA_UNIT_LABEL, excerptCheck, ISSUE_INFO, issueDetail, type ReviewEntry } from '../lib/review';
import { checkNumber, parseArea, parseNumber } from '../lib/parse';

export type TableTab = 'facilities' | 'grounds';
export type Row = Facility | GroundsArea;

export interface CellCtx {
  meta?: RowMeta;
  est?: FacilityEstimate;
  gest?: GroundsEstimate;
  entry?: ReviewEntry;
  maxFte: number;
  hostLabel: (facilityId: string) => string | undefined;
  readOnly: boolean;
}

export type Parsed<P> = { ok: true; patch: P; label?: string } | { ok: false; error: string };
export interface SelectOpt { value: string; label: string; dot?: string; hint?: string }

export type EditSpec<R> =
  | { kind: 'text'; get: (r: R) => string; parse: (raw: string, r: R) => Parsed<Partial<R>>; what: string; path: string; optional?: boolean }
  | { kind: 'number'; get: (r: R) => number | undefined; parse: (raw: string, r: R) => Parsed<Partial<R>>; what: string; path: string; optional?: boolean; clear?: (r: R) => Partial<R> }
  | { kind: 'select'; options: (ctx: { facilities: readonly Facility[] }) => SelectOpt[]; get: (r: R) => string; set: (r: R, v: string) => Partial<R>; what: string; path: string }
  | { kind: 'review' };

export interface ColDef<R extends Row> {
  key: string;
  label: string;
  /** default width (CSS px, cell padding included) */
  w: number;
  /** minimum width (resizing, and shrink under pressure for `shrink` columns) */
  min: number;
  flex?: boolean;
  shrink?: boolean;
  align?: 'right' | 'center';
  sticky?: boolean;
  /** auto-hide rank as the sheet narrows (lower hides first) */
  hideRank?: number;
  /** shown only when the data needs it (campus present, rows out of scope, dining rows) */
  autoShow?: boolean;
  /** header sort: a shared SortKey, or a value for a table-only column sort */
  sort?: SortKey | ((r: R) => number | string | undefined);
  edit?: EditSpec<R>;
  render: (r: R, c: CellCtx) => ReactNode;
  /** plain value for copy / TSV */
  text: (r: R, c: CellCtx) => string | number | undefined;
  title?: (r: R, c: CellCtx) => string | undefined;
  /** chooser label when the header is an icon */
  menuLabel?: string;
}

// ---------------------------------------------------------------- helpers
export const SERVICE_SHORT: Record<ServiceLevel, string> = { daily_7: 'Daily 7d', daily_6: 'Daily 6d', daily_5: 'Daily 5d', '3x_week': '3×/wk', '2x_week': '2×/wk', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly' };
export const UNIT_LABEL: Record<GroundsUnit, string> = { acres: 'ac', hectares: 'ha', sqft: 'SF', sqm: 'm²', sqyd: 'SY', lf: 'LF', each: 'ea' };
const UNIT_FULL: Record<GroundsUnit, string> = { acres: 'Acres', hectares: 'Hectares', sqft: 'Square feet', sqm: 'Square metres', sqyd: 'Square yards', lf: 'Linear feet', each: 'Each' };
const catShort = (c: Facility['category']) => CATEGORY_DEFAULTS[c]?.label.split(' /')[0] ?? c;
const statusShort = (s: Facility['status']) => (s && s !== 'in_scope' ? FACILITY_STATUSES.find((x) => x.id === s)?.label ?? s : '');
const fmtArea = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

const ok = <P,>(patch: P, label?: string): Parsed<P> => ({ ok: true, patch, label });
const bad = <P,>(error: string): Parsed<P> => ({ ok: false, error });

function num(raw: string, rule: Parameters<typeof checkNumber>[1], optional: boolean): Parsed<number | undefined> {
  const r = parseNumber(raw);
  if (!r.ok) return bad(r.error);
  if (r.value === undefined) return optional ? ok(undefined) : bad('Required');
  const err = checkNumber(r.value, rule);
  return err ? bad(err) : ok(rule?.integer ? Math.round(r.value) : r.value);
}

function matchOption(opts: SelectOpt[], raw: string): string | null {
  const q = raw.trim().toLowerCase(); if (!q) return null;
  return opts.find((o) => o.value.toLowerCase() === q || o.label.toLowerCase() === q)?.value
    ?? opts.find((o) => o.label.toLowerCase().startsWith(q) || o.value.toLowerCase().startsWith(q))?.value
    ?? opts.find((o) => o.label.toLowerCase().includes(q))?.value ?? null;
}
/** Parse pasted / typed text for a select column. */
export function parseSelect<R extends Row>(spec: Extract<EditSpec<R>, { kind: 'select' }>, raw: string, r: R, facilities: readonly Facility[]): Parsed<Partial<R>> {
  const v = matchOption(spec.options({ facilities }), raw);
  return v == null ? bad(`"${raw.trim()}" is not one of the choices`) : ok(spec.set(r, v));
}

export function ReviewIcon({ meta, row }: { meta?: RowMeta; row: Row }) {
  const issues = (meta?.issues ?? []).filter((i) => ISSUE_INFO[i].counts);
  if (meta?.review === 'verified') return <CircleCheck size={15} color="var(--ok)" aria-label="Verified" />;
  if (meta?.review === 'flagged') return <Flag size={14} color="var(--flag)" aria-label="Flagged" />;
  if (meta?.review === 'needs') return <CircleAlert size={15} color="var(--warn)" aria-label={`Needs review: ${issues.map((i) => issueDetail(i, row)).join('; ')}`} />;
  return <span className="tv-ring" aria-label="Not reviewed" />;
}
export function reviewTitle(meta: RowMeta | undefined, row: Row): string {
  const head = meta?.review === 'verified' ? 'Verified' : meta?.review === 'flagged' ? 'Flagged' : meta?.review === 'needs' ? 'Needs review' : 'Not reviewed';
  const lines = (meta?.issues ?? []).map((i) => `${ISSUE_INFO[i].counts ? '•' : '◦'} ${issueDetail(i, row)}`);
  return [`${head} · V verify · X flag · U clear`, ...lines].join('\n');
}

const confCell = (r: Row, c: CellCtx) => {
  const band = c.meta?.conf ?? 'mid';
  return <span style={{ color: CONF_COLOR[band] }}><span aria-hidden>{CONF_GLYPH[band]}</span> {Math.round(r.confidence * 100)}%</span>;
};
const fteBar = (fte: number | undefined, c: CellCtx, out = false) => (
  <span className="tv-fte">{out ? '—' : fte != null ? n2(fte) : ''}{!out && fte ? <i className="tv-fte__bar" style={{ width: `${Math.min(100, (fte / c.maxFte) * 100)}%` }} /> : null}</span>
);
const auto = (text: string) => <span className="tv-auto">auto {text}</span>;

// ---------------------------------------------------------------- shared columns
function selCol<R extends Row>(): ColDef<R> {
  return { key: 'sel', label: '', menuLabel: 'Select', w: 32, min: 32, sticky: true, align: 'center', render: () => null, text: () => undefined };
}
function reviewCol<R extends Row>(): ColDef<R> {
  return {
    key: 'review', label: 'Review', menuLabel: 'Review', w: 34, min: 34, sticky: true, align: 'center', edit: { kind: 'review' },
    render: (r, c) => <ReviewIcon meta={c.meta} row={r} />, text: (_r, c) => c.entry?.status ?? 'unreviewed', title: (r, c) => reviewTitle(c.meta, r),
  };
}
function confCol<R extends Row>(): ColDef<R> {
  return { key: 'conf', label: 'Conf', w: 60, min: 52, sticky: true, align: 'right', sort: 'conf', render: confCell, text: (r) => Math.round(r.confidence * 100), title: (r) => `Extraction confidence ${Math.round(r.confidence * 100)}%` };
}
function srcCol<R extends Row>(): ColDef<R> {
  return {
    key: 'src', label: 'Src', w: 44, min: 44, align: 'center', hideRank: 5,
    render: (r) => {
      if (!r.source?.file && !r.source?.excerpt) return <span className="tv-src tv-src--none" aria-label="No source">—</span>;
      const chk = 'grossSqft' in r ? excerptCheck(r) : { status: 'none' as const };
      return <span className={`tv-src tv-src--${chk.status}`}><FileText size={13} strokeWidth={1.75} aria-hidden />{chk.status === 'ok' ? <b aria-label="SF found in the excerpt">✓</b> : chk.status === 'miss' ? <b aria-label="SF not in the excerpt">✗</b> : null}</span>;
    },
    text: (r) => [r.source?.file, r.source?.page ? `p.${r.source.page}` : ''].filter(Boolean).join(' '),
    title: (r) => (r.source?.file ? `${r.source.file}${r.source.page ? ` · p.${r.source.page}` : ''}\nEnter or click for the excerpt` : 'No source document cited'),
  };
}

// ---------------------------------------------------------------- facilities
export function facilityColumns(): ColDef<Facility>[] {
  const catOpts = (): SelectOpt[] => FACILITY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_DEFAULTS[c].label, dot: categoryColor(c) }));
  const statusOpts = (): SelectOpt[] => FACILITY_STATUSES.map((s) => ({ value: s.id, label: s.label }));
  const svcOpts = (): SelectOpt[] => SERVICE_LEVELS.map((s) => ({ value: s.id, label: SERVICE_SHORT[s.id], hint: s.label }));
  return [
    selCol(), reviewCol(), confCol(),
    {
      key: 'bldg', label: 'Bldg #', w: 76, min: 56, sticky: true, sort: 'bldg',
      edit: { kind: 'text', what: 'Building #', path: 'buildingNumber', optional: true, get: (f) => f.buildingNumber ?? '', parse: (raw) => ok({ buildingNumber: raw.trim() || undefined }) },
      render: (f, c) => <span className={c.meta?.issues.includes('dup_bldg') ? 'tv-dup' : undefined}>{f.buildingNumber ?? ''}</span>,
      text: (f) => f.buildingNumber, title: (f, c) => (c.meta?.issues.includes('dup_bldg') ? issueDetail('dup_bldg', f) : undefined),
    },
    {
      key: 'name', label: 'Name', w: 200, min: 200, flex: true, sort: 'name',
      edit: { kind: 'text', what: 'Name', path: 'name', get: (f) => f.name, parse: (raw) => (raw.trim() ? ok({ name: raw.trim() }) : bad('A name is required')) },
      render: (f) => f.name, text: (f) => f.name, title: (f) => f.name,
    },
    {
      key: 'campus', label: 'Campus', w: 104, min: 72, shrink: true, autoShow: true, hideRank: 7, sort: (f) => f.campus?.toLowerCase(),
      edit: { kind: 'text', what: 'Campus', path: 'campus', optional: true, get: (f) => f.campus ?? '', parse: (raw) => ok({ campus: raw.trim() || undefined }) },
      render: (f) => f.campus ?? '', text: (f) => f.campus, title: (f) => f.campus,
    },
    {
      key: 'category', label: 'Category', w: 136, min: 100, shrink: true, sort: (f) => catShort(f.category),
      edit: { kind: 'select', what: 'Category', path: 'category', options: catOpts, get: (f) => f.category, set: (_f, v) => ({ category: v as Facility['category'] }) },
      render: (f) => <><i className="tv-dot" style={{ background: categoryColor(f.category) }} />{catShort(f.category)}</>,
      text: (f) => CATEGORY_DEFAULTS[f.category]?.label ?? f.category, title: (f) => CATEGORY_DEFAULTS[f.category]?.label,
    },
    {
      key: 'status', label: 'Status', w: 112, min: 92, shrink: true, autoShow: true, sort: (f) => statusShort(f.status) || 'In scope',
      edit: { kind: 'select', what: 'Status', path: 'status', options: statusOpts, get: (f) => f.status ?? 'in_scope', set: (_f, v) => ({ status: v === 'in_scope' ? undefined : v as Facility['status'] }) },
      render: (f) => (f.status && f.status !== 'in_scope' ? <span className="tv-status">{statusShort(f.status)}</span> : <span className="tv-muted">In scope</span>),
      text: (f) => FACILITY_STATUSES.find((x) => x.id === (f.status ?? 'in_scope'))?.label, title: (f) => (f.statusReason ? `${statusShort(f.status)}: ${f.statusReason}` : undefined),
    },
    {
      key: 'gross', label: 'Gross SF', w: 96, min: 80, shrink: true, align: 'right', sort: 'gross',
      edit: {
        kind: 'number', what: 'Gross SF', path: 'grossSqft', get: (f) => f.grossSqft,
        parse: (raw, f) => {
          const r = parseArea(raw);
          if (!r.ok) return bad(r.error);
          if (r.value === undefined) return bad('Gross SF is required');
          if (!(r.value > 0)) return bad('Gross SF must be greater than 0');
          if (f.cleanableSqft != null && f.cleanableSqft > r.value) return bad(`Cleanable SF (${n0(f.cleanableSqft)}) would exceed gross`);
          const v = Math.round(r.value);
          if (r.unit && r.printed != null) return ok({ grossSqft: v, originalArea: { ...(f.originalArea ?? {}), gross: r.printed, unit: r.unit } }, `${fmtArea(r.printed)} ${AREA_UNIT_LABEL[r.unit]} → ${n0(v)} SF`);
          const oa = f.originalArea && f.originalArea.cleanable != null ? { cleanable: f.originalArea.cleanable, unit: f.originalArea.unit } : undefined;
          return ok({ grossSqft: v, originalArea: oa });
        },
      },
      render: (f) => (f.grossSqft > 0 ? n0(f.grossSqft) : <span className="tv-bad">0</span>), text: (f) => f.grossSqft,
      title: (f) => (f.originalArea?.gross != null ? `As printed ${fmtArea(f.originalArea.gross)} ${AREA_UNIT_LABEL[f.originalArea.unit]}` : undefined),
    },
    {
      key: 'clean', label: 'Clean SF', w: 96, min: 80, shrink: true, align: 'right', hideRank: 4, sort: (f) => f.cleanableSqft,
      edit: {
        kind: 'number', what: 'Cleanable SF', path: 'cleanableSqft', optional: true, get: (f) => f.cleanableSqft,
        clear: () => ({ cleanableSqft: undefined }),
        parse: (raw, f) => {
          const r = parseArea(raw);
          if (!r.ok) return bad(r.error);
          if (r.value === undefined) return ok({ cleanableSqft: undefined });
          if (!(r.value > 0)) return bad('Cleanable SF must be greater than 0 (Delete for auto)');
          if (f.grossSqft > 0 && r.value > f.grossSqft) return bad(`Cleanable SF can't exceed gross (${n0(f.grossSqft)})`);
          const v = Math.round(r.value);
          if (r.unit && r.printed != null) return ok({ cleanableSqft: v, originalArea: { ...(f.originalArea ?? {}), cleanable: r.printed, unit: r.unit } });
          return ok({ cleanableSqft: v });
        },
      },
      render: (f, c) => (f.cleanableSqft != null ? n0(f.cleanableSqft) : c.est ? auto(n0(c.est.resolved.cleanableSqft)) : ''),
      text: (f) => f.cleanableSqft, title: (f, c) => (f.cleanableSqft == null && c.est ? `Derived from the category share (${n0(c.est.resolved.cleanableSqft)} SF). Type a value to override.` : undefined),
    },
    {
      key: 'floors', label: 'Floors', w: 56, min: 48, align: 'right', hideRank: 3, sort: (f) => f.floors,
      edit: { kind: 'number', what: 'Floors', path: 'floors', get: (f) => f.floors, parse: (raw) => { const r = num(raw, { integer: true, min: 1, max: 200 }, false); return r.ok ? ok({ floors: r.patch! }) : r; } },
      render: (f) => f.floors, text: (f) => f.floors,
    },
    {
      key: 'fixtures', label: 'Fixtures', w: 72, min: 60, align: 'right', hideRank: 2, sort: (f) => f.restroomFixtures,
      edit: { kind: 'number', what: 'Restroom fixtures', path: 'restroomFixtures', optional: true, get: (f) => f.restroomFixtures, clear: () => ({ restroomFixtures: undefined }), parse: (raw) => { const r = num(raw, { integer: true, min: 0 }, true); return r.ok ? ok({ restroomFixtures: r.patch }) : r; } },
      render: (f, c) => (f.restroomFixtures != null ? n0(f.restroomFixtures) : c.est ? auto(n0(c.est.resolved.restroomFixtures)) : ''),
      text: (f) => f.restroomFixtures,
    },
    {
      key: 'service', label: 'Service', w: 112, min: 84, shrink: true, sort: (f) => SERVICE_LEVELS.findIndex((s) => s.id === f.serviceLevel),
      edit: { kind: 'select', what: 'Service', path: 'serviceLevel', options: svcOpts, get: (f) => f.serviceLevel, set: (_f, v) => ({ serviceLevel: v as ServiceLevel }) },
      render: (f) => SERVICE_SHORT[f.serviceLevel] ?? f.serviceLevel, text: (f) => SERVICE_LEVELS.find((s) => s.id === f.serviceLevel)?.label,
      title: (f) => (f.serviceFrequencyText ? `As printed: ${f.serviceFrequencyText}` : SERVICE_LEVELS.find((s) => s.id === f.serviceLevel)?.label),
    },
    {
      key: 'meals', label: 'Meals/day', w: 84, min: 72, shrink: true, align: 'right', autoShow: true, hideRank: 6, sort: (f) => (f.dining ? resolveMealsPerDay(f.dining) : undefined),
      edit: {
        kind: 'number', what: 'Meals/day', path: 'dining.mealsPerDay', optional: true, get: (f) => (f.dining?.mealsPerDay || undefined),
        clear: (f) => (f.dining ? { dining: { ...f.dining, mealsPerDay: 0 } } : {}),
        parse: (raw, f) => {
          const r = num(raw, { min: 0 }, true); if (!r.ok) return r;
          if (!f.dining && f.category !== 'dining') return bad('Not a dining facility (set Category to Dining first)');
          return ok({ dining: { mealPeriods: 3, daysPerWeek: 7, ...(f.dining ?? {}), mealsPerDay: r.patch ?? 0 } });
        },
      },
      render: (f) => (!f.dining ? '' : f.dining.mealsPerDay > 0 ? n0(f.dining.mealsPerDay) : auto(n0(resolveMealsPerDay(f.dining)))),
      text: (f) => (f.dining ? resolveMealsPerDay(f.dining) : undefined),
      title: (f) => (f.dining?.mealPeriodsDetail?.length ? f.dining.mealPeriodsDetail.map((p) => `${p.period}: ${p.weekdayHeadcount ?? '—'} wkday / ${p.weekendHeadcount ?? '—'} wkend`).join('\n') : undefined),
    },
    {
      key: 'hrs', label: 'Hrs/yr', w: 88, min: 72, align: 'right', hideRank: 1, sort: () => undefined,
      render: (f, c) => (c.meta && !c.meta.inScope ? '—' : c.est ? n0(c.est.totalHours) : ''), text: (_f, c) => c.est?.totalHours,
    },
    {
      key: 'fte', label: 'FTE', w: 76, min: 64, shrink: true, align: 'right', sort: 'fte',
      render: (_f, c) => fteBar(c.est?.fte, c, Boolean(c.meta && !c.meta.inScope)), text: (_f, c) => (c.meta && !c.meta.inScope ? undefined : c.est?.fte),
      title: (_f, c) => (c.meta && !c.meta.inScope ? 'Out of scope: not estimated' : undefined),
    },
    srcCol(),
  ];
}

// ---------------------------------------------------------------- grounds
export function groundsColumns(): ColDef<GroundsArea>[] {
  const kindOpts = (): SelectOpt[] => GROUNDS_KINDS.map((k) => ({ value: k.id, label: k.label }));
  const unitOpts = (): SelectOpt[] => (Object.keys(UNIT_LABEL) as GroundsUnit[]).map((u) => ({ value: u, label: UNIT_FULL[u], hint: UNIT_LABEL[u] }));
  const hostOpts = ({ facilities }: { facilities: readonly Facility[] }): SelectOpt[] => [
    { value: '', label: 'Site-wide' },
    ...facilities.map((f) => ({ value: f.id, label: `${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}` })),
  ];
  return [
    selCol(), reviewCol(), confCol(),
    {
      key: 'name', label: 'Name', w: 220, min: 200, flex: true, sort: 'name',
      edit: { kind: 'text', what: 'Name', path: 'name', get: (g) => g.name, parse: (raw) => (raw.trim() ? ok({ name: raw.trim() }) : bad('A name is required')) },
      render: (g) => <>{g.name}{g.documentLabel ? <span className="tv-muted"> · {g.documentLabel}</span> : null}</>, text: (g) => g.name, title: (g) => `${g.name}${g.documentLabel ? `\nDocument label: ${g.documentLabel}` : ''}`,
    },
    {
      key: 'kind', label: 'Kind', w: 150, min: 112, shrink: true, sort: (g) => g.kind,
      edit: { kind: 'select', what: 'Kind', path: 'kind', options: kindOpts, get: (g) => g.kind, set: (_g, v) => ({ kind: v as GroundsArea['kind'] }) },
      render: (g) => GROUNDS_KINDS.find((k) => k.id === g.kind)?.label ?? g.kind, text: (g) => GROUNDS_KINDS.find((k) => k.id === g.kind)?.label,
    },
    {
      key: 'qty', label: 'Qty', w: 96, min: 72, align: 'right', sort: 'gross',
      edit: { kind: 'number', what: 'Quantity', path: 'quantity', get: (g) => g.quantity, parse: (raw) => { const r = num(raw, { positive: true }, false); return r.ok ? ok({ quantity: r.patch! }) : r; } },
      render: (g) => (g.quantity > 0 ? g.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="tv-bad">0</span>), text: (g) => g.quantity,
    },
    {
      key: 'unit', label: 'Unit', w: 72, min: 60, sort: (g) => g.unit,
      edit: { kind: 'select', what: 'Unit', path: 'unit', options: unitOpts, get: (g) => g.unit, set: (_g, v) => ({ unit: v as GroundsUnit }) },
      render: (g) => UNIT_LABEL[g.unit] ?? g.unit, text: (g) => g.unit, title: (g) => UNIT_FULL[g.unit],
    },
    { key: 'acres', label: 'Acres', w: 80, min: 64, align: 'right', hideRank: 2, sort: (g) => groundsAcres(g), render: (_g, c) => (c.gest ? n1(c.gest.acres) : ''), text: (_g, c) => c.gest?.acres },
    {
      key: 'attached', label: 'Attached to', w: 168, min: 112, shrink: true, hideRank: 4, sort: (g) => g.facilityId ?? '',
      edit: { kind: 'select', what: 'Attached to', path: 'facilityId', options: hostOpts, get: (g) => g.facilityId ?? '', set: (_g, v) => ({ facilityId: v || undefined }) },
      render: (g, c) => (g.facilityId ? c.hostLabel(g.facilityId) ?? <span className="tv-muted">missing building</span> : <span className="tv-muted">Site-wide</span>),
      text: (g, c) => (g.facilityId ? c.hostLabel(g.facilityId) : 'Site-wide'),
    },
    {
      key: 'campus', label: 'Campus', w: 104, min: 80, shrink: true, autoShow: true, sort: (g) => g.campus?.toLowerCase(),
      edit: { kind: 'text', what: 'Campus', path: 'campus', optional: true, get: (g) => g.campus ?? '', parse: (raw) => ok({ campus: raw.trim() || undefined }) },
      render: (g) => g.campus ?? '', text: (g) => g.campus,
    },
    { key: 'hrs', label: 'Hrs/yr', w: 88, min: 72, align: 'right', hideRank: 1, sort: () => undefined, render: (_g, c) => (c.gest ? n0(c.gest.totalHours) : ''), text: (_g, c) => c.gest?.totalHours },
    { key: 'fte', label: 'FTE', w: 76, min: 64, align: 'right', sort: 'fte', render: (_g, c) => fteBar(c.gest?.fte, c), text: (_g, c) => c.gest?.fte },
    srcCol(),
  ];
}

/** Columns the data asks for: Campus when any row has one, Status when any row is out of scope, Meals/day when any row is dining. */
export function autoShown(tab: TableTab, rows: { facilities: readonly Facility[]; grounds: readonly GroundsArea[] }): Set<string> {
  const s = new Set<string>();
  if (tab === 'facilities') {
    if (rows.facilities.some((f) => f.campus)) s.add('campus');
    if (rows.facilities.some((f) => f.status && f.status !== 'in_scope')) s.add('status');
    if (rows.facilities.some((f) => f.dining || f.category === 'dining')) s.add('meals');
  } else if (rows.grounds.some((g) => g.campus)) s.add('campus');
  return s;
}

export type ColPref = 'show' | 'hide';
/**
 * Visible columns for a sheet width: data-driven columns first, user overrides next, then the auto-hide order
 * (Hrs/yr, Fixtures, Floors, Clean SF, then Src) while the minimum row width exceeds the sheet.
 */
export function visibleColumns<R extends Row>(all: ColDef<R>[], avail: number, shown: Set<string>, prefs: Record<string, ColPref>, widths: Record<string, number>): ColDef<R>[] {
  let cols = all.filter((c) => (prefs[c.key] === 'hide' ? false : prefs[c.key] === 'show' ? true : c.autoShow ? shown.has(c.key) : true));
  const minW = (c: ColDef<R>) => (c.flex ? Math.max(c.min, widths[c.key] ?? c.min) : c.shrink ? Math.min(c.min, widths[c.key] ?? c.w) : widths[c.key] ?? c.w);
  const need = (cs: ColDef<R>[]) => cs.reduce((s, c) => s + minW(c), 0);
  const ranked = cols.filter((c) => c.hideRank != null && prefs[c.key] !== 'show').sort((a, b) => a.hideRank! - b.hideRank!);
  for (const c of ranked) {
    if (need(cols) <= avail) break;
    cols = cols.filter((x) => x !== c);
  }
  return cols;
}

/** CSS grid template for the visible columns (Name flexes; shrinkable columns give way before the row overflows). */
export function gridTemplate<R extends Row>(cols: ColDef<R>[], widths: Record<string, number>): { template: string; minWidth: number } {
  let minWidth = 0;
  const parts = cols.map((c) => {
    const w = widths[c.key] ?? c.w;
    if (c.flex) { const m = Math.max(c.min, widths[c.key] ?? c.min); minWidth += m; return `minmax(${m}px,1fr)`; }
    if (c.shrink) { const m = Math.min(c.min, w); minWidth += m; return `minmax(${m}px,${w}px)`; }
    minWidth += w; return `${w}px`;
  });
  return { template: parts.join(' '), minWidth };
}
