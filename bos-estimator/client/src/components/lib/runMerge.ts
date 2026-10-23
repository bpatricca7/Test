// Re-run safety (UI spec §6.3, §7.3): hand edits survive a re-read, verified marks that no longer vouch for the
// numbers go back to review, and Restore previous puts back only what the run wrote. Pure functions; store.ts calls
// them from the run's `done` merge, the streaming upsert and restorePrevious.

import type { Facility, GroundsArea, Inventory } from '@shared/types';
import { fieldValue, normBldg, normCampus, normName, sameValue, type ReviewEntry, type ReviewMap } from './review';

type Row = Facility | GroundsArea;

/** Field labels for notes and dialogs ("Cleanable SF"). */
export const FIELD_LABELS: Record<string, string> = {
  grossSqft: 'Gross SF', cleanableSqft: 'Cleanable SF', floors: 'Floors', category: 'Category', serviceLevel: 'Service',
  status: 'Status', name: 'Name', buildingNumber: 'Building #', campus: 'Campus', restroomFixtures: 'Restroom fixtures',
  occupancy: 'Occupancy', 'dining.mealsPerDay': 'Meals/day', quantity: 'Quantity', unit: 'Unit', kind: 'Kind',
  facilityId: 'Building', scope: 'Scope', serviceFrequencyText: 'Frequency as printed',
};
export const fieldLabel = (path: string) => FIELD_LABELS[path] ?? path;
const fmtValue = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : v == null || v === '' ? '—' : String(v));

export interface RunResultCounts { added: number; removed: number; changed: number; unchanged: number; changedIds: string[] }

/**
 * §7.3.3: match by id, then by normalized (campus, building #), then by normalized name. A facility counts as changed
 * when gross, cleanable, floors, category, serviceLevel or status changed; a grounds area when kind, quantity, unit or
 * its building changed.
 */
export function diffInventories(before: Inventory, after: Inventory): RunResultCounts {
  const used = new Set<string>();
  const byId = new Map(before.facilities.map((f) => [f.id, f]));
  const byNo = new Map<string, Facility>();
  const byName = new Map<string, Facility | null>();
  for (const f of before.facilities) {
    const b = normBldg(f.buildingNumber); if (b) byNo.set(`${normCampus(f.campus)}|${b}`, f);
    const n = normName(f.name); byName.set(n, byName.has(n) ? null : f); // ambiguous names never match
  }
  let added = 0, changed = 0, unchanged = 0; const changedIds: string[] = [];
  for (const f of after.facilities) {
    let prev = byId.get(f.id);
    if (!prev || used.has(prev.id)) { const b = normBldg(f.buildingNumber); prev = b ? byNo.get(`${normCampus(f.campus)}|${b}`) : undefined; }
    if (!prev || used.has(prev.id)) prev = byName.get(normName(f.name)) ?? undefined;
    if (!prev || used.has(prev.id)) { added++; continue; }
    used.add(prev.id);
    const diff = prev.grossSqft !== f.grossSqft || (prev.cleanableSqft ?? null) !== (f.cleanableSqft ?? null) || prev.floors !== f.floors || prev.category !== f.category || prev.serviceLevel !== f.serviceLevel || (prev.status ?? 'in_scope') !== (f.status ?? 'in_scope');
    if (diff) { changed++; changedIds.push(f.id); } else unchanged++;
  }
  const gUsed = new Set<string>();
  const gById = new Map(before.grounds.map((g) => [g.id, g]));
  const gByName = new Map(before.grounds.map((g) => [normName(g.name), g]));
  for (const g of after.grounds) {
    let prev = gById.get(g.id);
    if (!prev || gUsed.has(prev.id)) prev = gByName.get(normName(g.name));
    if (!prev || gUsed.has(prev.id)) { added++; continue; }
    gUsed.add(prev.id);
    if (prev.kind !== g.kind || prev.quantity !== g.quantity || prev.unit !== g.unit || (prev.facilityId ?? '') !== (g.facilityId ?? '')) { changed++; changedIds.push(g.id); } else unchanged++;
  }
  const removed = before.facilities.filter((f) => !used.has(f.id)).length + before.grounds.filter((g) => !gUsed.has(g.id)).length;
  return { added, removed, changed, unchanged, changedIds };
}

/** Writes `value` at a marker path into a patch for `row` ("dining.mealsPerDay" patches the dining object). */
function setPath(patch: Record<string, unknown>, row: Row, src: Row, path: string, value: unknown) {
  if (path === 'dining.mealsPerDay') {
    const d = (patch.dining as Facility['dining']) ?? (row as Facility).dining ?? (src as Facility).dining;
    if (d) patch.dining = { ...d, mealsPerDay: typeof value === 'number' ? value : 0 };
  } else patch[path] = value;
}

/** `row` with the values of the given marker paths copied from `src` (the hand-edited copy of the same row). */
export function withHandValues<T extends Row>(row: T, src: Row, paths: Iterable<string>): T {
  const patch: Record<string, unknown> = {};
  for (const path of paths) {
    const hand = fieldValue(src, path);
    if (!sameValue(hand, fieldValue(row, path))) setPath(patch, row, src, path, hand);
  }
  return Object.keys(patch).length ? { ...row, ...patch } as T : row;
}

export interface EditConflict { id: string; path: string; was: unknown; now: unknown; hand: unknown }
export interface HandEditMerge {
  inventory: Inventory;
  review: ReviewMap;
  /** rows whose hand-edited values were put back onto the re-read rows */
  kept: string[];
  /** fields the re-read changed although they were edited by hand: the hand value is kept and the row is flagged */
  conflicts: EditConflict[];
  /** review entries the merge rewrote, as they were before (Restore previous puts them back) */
  before: Record<string, ReviewEntry | undefined>;
}

/**
 * The run's `done` merge for hand edits (review[id].edited: field → extracted value). For every edited field of a
 * row the re-read returned:
 *  - the re-read value equals the hand value → the marker is dropped (nothing left to keep);
 *  - the re-read left the extracted value as it was → the hand value is put back, the marker stays;
 *  - the re-read changed it to something else → a conflict: the hand value is kept, the marker now holds the new
 *    extracted value (R takes it), and the row is flagged with a note naming both numbers.
 * `local` holds the hand values (the inventory the user saw); `next` is the run's inventory.
 */
export function mergeHandEdits(local: Inventory, review: ReviewMap | undefined, next: Inventory, at: number): HandEditMerge {
  const out: HandEditMerge = { inventory: next, review: review ?? {}, kept: [], conflicts: [], before: {} };
  if (!review) return out;
  const ids = new Set(Object.keys(review).filter((id) => Object.keys(review[id]?.edited ?? {}).length));
  if (!ids.size) return out;
  const localF = new Map(local.facilities.map((f) => [f.id, f]));
  const localG = new Map(local.grounds.map((g) => [g.id, g]));
  let copied: ReviewMap | null = null;
  const one = <T extends Row>(row: T, src: Row | undefined): T => {
    if (!ids.has(row.id) || !src) return row;
    const e = review[row.id]; const marks = e.edited!;
    const edited: Record<string, unknown> = {}; const keep: string[] = []; const notes: string[] = [];
    for (const [path, was] of Object.entries(marks)) {
      const hand = fieldValue(src, path); const now = fieldValue(row, path);
      if (sameValue(hand, now)) continue;
      keep.push(path);
      edited[path] = now ?? null;
      if (!sameValue(was, now)) {
        out.conflicts.push({ id: row.id, path, was, now, hand });
        notes.push(`Re-read changed ${fieldLabel(path)} from ${fmtValue(was)} to ${fmtValue(now)}; your ${fmtValue(hand)} is kept (R takes the new value)`);
      }
    }
    const nextRow = keep.length ? withHandValues(row, src, keep) : row;
    if (keep.length) out.kept.push(row.id);
    const sameMarks = Object.keys(edited).length === Object.keys(marks).length && Object.entries(edited).every(([k, v]) => k in marks && sameValue(marks[k], v));
    if (!sameMarks || notes.length) {
      const entry: ReviewEntry = { ...e, at };
      if (Object.keys(edited).length) entry.edited = edited; else delete entry.edited;
      if (notes.length) {
        entry.status = 'flagged';
        entry.note = [notes.join(' · '), e.note].filter(Boolean).join(' · ');
      }
      if (!copied) copied = { ...review };
      copied[row.id] = entry;
      out.before[row.id] = e;
    }
    return nextRow;
  };
  let changed = false;
  const facilities = next.facilities.map((f) => { const r = one(f, localF.get(f.id)); if (r !== f) changed = true; return r; });
  const grounds = next.grounds.map((g) => { const r = one(g, localG.get(g.id)); if (r !== g) changed = true; return r; });
  if (changed) out.inventory = { ...next, facilities, grounds };
  if (copied) out.review = copied;
  return out;
}

/** `base` with the hand values of the given rows' edited fields copied from `local` (rows matched by id). */
export function overlayHandEdits(base: Inventory, local: Inventory, review: ReviewMap | undefined, include: (id: string, e: ReviewEntry) => boolean): Inventory {
  if (!review) return base;
  const ids = new Set(Object.keys(review).filter((id) => Object.keys(review[id]?.edited ?? {}).length && include(id, review[id])));
  if (!ids.size) return base;
  const lf = new Map(local.facilities.map((f) => [f.id, f]));
  const lg = new Map(local.grounds.map((g) => [g.id, g]));
  let changed = false;
  const facilities = base.facilities.map((f) => { const src = ids.has(f.id) ? lf.get(f.id) : undefined; if (!src) return f; const r = withHandValues(f, src, Object.keys(review[f.id].edited!)); if (r !== f) changed = true; return r; });
  const grounds = base.grounds.map((g) => { const src = ids.has(g.id) ? lg.get(g.id) : undefined; if (!src) return g; const r = withHandValues(g, src, Object.keys(review[g.id].edited!)); if (r !== g) changed = true; return r; });
  return changed ? { ...base, facilities, grounds } : base;
}

/**
 * Restore previous (§7.5, A9): the snapshot's rows exactly (deep-equal to the inventory before the run). Review marks
 * and notes set since the run started stay (the run's own rewrites are swapped back for what they replaced); edited
 * markers follow the restored rows, so they are the snapshot's. `mergeAt` / `mergeBefore` identify the merge's rewrites.
 */
export function restoreRows(snapshot: { inventory: Inventory; review?: ReviewMap }, current: { inventory: Inventory; review?: ReviewMap }, startedAt: number, mergeAt: number | undefined, mergeBefore: Record<string, ReviewEntry | undefined> | undefined): { inventory: Inventory; review: ReviewMap } {
  const cur = current.review ?? {};
  const snapReview = snapshot.review ?? {};
  const userEntry = (id: string): ReviewEntry | undefined => {
    let e: ReviewEntry | undefined = cur[id];
    if (e && mergeAt != null && e.at === mergeAt && mergeBefore && id in mergeBefore) e = mergeBefore[id];
    return e && e.at > startedAt ? e : undefined;
  };
  const review: ReviewMap = { ...cur };
  for (const row of [...snapshot.inventory.facilities, ...snapshot.inventory.grounds]) {
    const was = snapReview[row.id];
    const u = userEntry(row.id);
    if (!u) { if (was) review[row.id] = was; else delete review[row.id]; continue; }
    const entry: ReviewEntry = { ...u };
    if (was?.edited && Object.keys(was.edited).length) entry.edited = was.edited; else delete entry.edited;
    review[row.id] = entry;
  }
  return { inventory: snapshot.inventory, review };
}

/** Rows whose hand edits made since the run started the restore discards (their markers differ from the snapshot's). */
export function editsSince(review: ReviewMap | undefined, snapReview: ReviewMap | undefined, mergeAt?: number, mergeBefore?: Record<string, ReviewEntry | undefined>): number {
  let n = 0;
  for (const [id, e0] of Object.entries(review ?? {})) {
    let e: ReviewEntry | undefined = e0;
    if (mergeAt != null && e.at === mergeAt && mergeBefore && id in mergeBefore) e = mergeBefore[id];
    const now = e?.edited && Object.keys(e.edited).length ? e.edited : null;
    const was = snapReview?.[id]?.edited && Object.keys(snapReview[id].edited!).length ? snapReview[id].edited! : null;
    if (now && !sameValue(now, was)) n++;
  }
  return n;
}

/** Rows of `inv` that carry hand-edit markers. */
export function handEditedRows(inv: Inventory, review: ReviewMap | undefined): number {
  if (!review) return 0;
  let n = 0;
  for (const f of inv.facilities) if (Object.keys(review[f.id]?.edited ?? {}).length) n++;
  for (const g of inv.grounds) if (Object.keys(review[g.id]?.edited ?? {}).length) n++;
  return n;
}
