// Client-side exports (UI spec §5.13, P1): "Inventory with review (CSV)", one row per facility plus one per grounds
// area with every field, confidence, review status, issues, edited fields with their extracted values, source
// file/page/excerpt, Hrs and FTE; plus TSV for copying rows. Pure string builders + a download helper.

import { CATEGORY_DEFAULTS } from '@shared/factors';
import type { EstimateResult } from '@shared/estimate';
import { FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, type Facility, type GroundsArea } from '@shared/types';
import type { ClientProject } from '../../store';
import { asPrinted, ISSUE_INFO, issueDetail, type ReviewContext, type RowMeta } from './review';

export type Cell = string | number | boolean | null | undefined;

/** RFC 4180 field; text that a spreadsheet would run as a formula (= + - @) is prefixed with an apostrophe. */
export function csvField(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: Cell[][]) => `${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;

/** TSV for the clipboard (tabs and newlines inside cells become spaces). */
export const tsvField = (v: Cell) => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v).replace(/[\t\r\n]+/g, ' '));
export const toTsv = (rows: Cell[][]) => rows.map((r) => r.map(tsvField).join('\t')).join('\n');

/** Parse TSV pasted from Excel or a PDF table (quoted cells with embedded tabs/newlines are honoured). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

const statusLabel = (s?: Facility['status']) => FACILITY_STATUSES.find((x) => x.id === (s ?? 'in_scope'))?.label ?? s ?? '';
const serviceLabel = (s: Facility['serviceLevel']) => SERVICE_LEVELS.find((x) => x.id === s)?.label ?? s;
const kindLabel = (k: GroundsArea['kind']) => GROUNDS_KINDS.find((x) => x.id === k)?.label ?? k;

const HEADER = [
  'Row type', 'Id', 'Building #', 'Name', 'Campus', 'Category / kind', 'Status', 'Status reason',
  'Gross SF', 'Cleanable SF', 'Floors', 'Restroom fixtures', 'Occupancy', 'Service level', 'Frequency as printed', 'Meals/day',
  'Quantity', 'Unit', 'Acres', 'Attached to',
  'Area as printed', 'Confidence %', 'Review status', 'Needs review', 'Issues', 'Edited fields (extracted → now)',
  'Source file', 'Source page', 'Source excerpt', 'Table', 'Hrs/yr', 'FTE', 'Notes',
];

function editedText(row: Facility | GroundsArea, edited: Record<string, unknown> | undefined): string {
  if (!edited) return '';
  return Object.entries(edited).map(([k, v]) => {
    const now = k === 'dining.mealsPerDay' ? (row as Facility).dining?.mealsPerDay : (row as unknown as Record<string, unknown>)[k];
    const fmt = (x: unknown) => (x == null ? '(blank)' : typeof x === 'object' ? JSON.stringify(x) : String(x));
    return `${k}: ${fmt(v)} → ${fmt(now)}`;
  }).join('; ');
}

/** "Inventory with review (CSV)" for the whole project. */
export function inventoryCsv(project: ClientProject, est: EstimateResult | null, rowMeta: ReadonlyMap<string, RowMeta>, ctx?: ReviewContext): string {
  const estF = new Map(est?.facilities.map((e) => [e.facilityId, e]) ?? []);
  const estG = new Map(est?.grounds.map((e) => [e.areaId, e]) ?? []);
  const inv = project.inventory;
  const byId = new Map(inv.facilities.map((f) => [f.id, f]));
  const rows: Cell[][] = [HEADER];
  for (const f of inv.facilities) {
    const m = rowMeta.get(f.id); const e = estF.get(f.id); const r = project.review?.[f.id];
    rows.push([
      'facility', f.id, f.buildingNumber, f.name, f.campus, CATEGORY_DEFAULTS[f.category]?.label ?? f.category, statusLabel(f.status), f.statusReason,
      f.grossSqft, f.cleanableSqft ?? e?.resolved.cleanableSqft, f.floors, f.restroomFixtures ?? e?.resolved.restroomFixtures, f.occupancy ?? e?.resolved.occupancy,
      serviceLabel(f.serviceLevel), f.serviceFrequencyText, f.dining ? (e?.resolved.dining?.mealsPerDay ?? f.dining.mealsPerDay) : undefined,
      undefined, undefined, undefined, undefined,
      asPrinted(f)?.replace(/^As printed /, ''), Math.round(f.confidence * 100), r?.status ?? 'unreviewed', m?.review === 'needs',
      (m?.issues ?? []).map((i) => `${ISSUE_INFO[i].label}: ${issueDetail(i, f, ctx)}`).join('; '), editedText(f, r?.edited),
      f.source?.file, f.source?.page, f.source?.excerpt, f.tableId, e?.totalHours, m && !m.inScope ? 0 : e?.fte, f.notes,
    ]);
  }
  for (const g of inv.grounds) {
    const m = rowMeta.get(g.id); const e = estG.get(g.id); const r = project.review?.[g.id];
    const host = g.facilityId ? byId.get(g.facilityId) : undefined;
    rows.push([
      'grounds', g.id, g.documentLabel, g.name, g.campus, kindLabel(g.kind), undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      g.quantity, g.unit, e?.acres, host ? `${host.buildingNumber ? `${host.buildingNumber} · ` : ''}${host.name}` : 'Site-wide',
      undefined, Math.round(g.confidence * 100), r?.status ?? 'unreviewed', m?.review === 'needs',
      (m?.issues ?? []).map((i) => `${ISSUE_INFO[i].label}: ${issueDetail(i, g, ctx)}`).join('; '), editedText(g, r?.edited),
      g.source?.file, g.source?.page, g.source?.excerpt, undefined, e?.totalHours, e?.fte, g.notes,
    ]);
  }
  return toCsv(rows);
}

/** Save text as a file (BOM so Excel reads UTF-8). */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([mime.startsWith('text/csv') ? '﻿' : '', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'inventory';

/** Writes text to the clipboard (falls back to a hidden textarea + execCommand). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* permission or insecure context */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
