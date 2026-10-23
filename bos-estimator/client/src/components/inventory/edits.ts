// Manual edits with "edited" markers (UI spec §6.3 P1, §5.6 "Edited cell"): the first time a field moves away from
// its extracted value, review[id].edited[field] keeps the extracted value; editing it back removes the marker;
// R reverts a cell or a row. Each commit is one undo step (lib/history.ts groups the writes of one task).
//
// Store note: updateFacility/updateGrounds do not record `edited` yet (§6.3 says they should). Until they do, the
// marker is written here with useStore.setState right before the regular update action, which schedules the save
// that carries both. See the report's requested store changes.

import type { Facility, GroundsArea } from '@shared/types';
import { useStore } from '../../store';
import type { ReviewEntry } from '../lib/review';
import { labelNext } from '../lib/history';

type Row = Facility | GroundsArea;
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Field paths the markers use: top-level keys, plus "dining.mealsPerDay". */
function getPath(row: Row, path: string): unknown {
  if (path === 'dining.mealsPerDay') return (row as Facility).dining?.mealsPerDay;
  return (row as unknown as Record<string, unknown>)[path];
}
function changedPaths(row: Row, patch: Partial<Facility> | Partial<GroundsArea>): [string, unknown, unknown][] {
  const out: [string, unknown, unknown][] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'dining') { const before = (row as Facility).dining?.mealsPerDay; const after = (v as Facility['dining'])?.mealsPerDay; if (!same(before, after)) out.push(['dining.mealsPerDay', before, after]); continue; }
    const before = (row as unknown as Record<string, unknown>)[k];
    if (!same(before, v)) out.push([k, before, v]);
  }
  return out;
}

/** Writes the edited markers for `id` (no save by itself; the update that follows schedules it). */
function markEdited(id: string, changes: [string, unknown, unknown][]) {
  if (!changes.length) return;
  useStore.setState((s) => {
    const p = s.project; if (!p) return {};
    const prev = p.review?.[id];
    const edited: Record<string, unknown> = { ...(prev?.edited ?? {}) };
    let touched = false;
    for (const [k, before, after] of changes) {
      if (!(k in edited)) { edited[k] = before ?? null; touched = true; }
      else if (same(edited[k], after)) { delete edited[k]; touched = true; }
    }
    if (!touched) return {};
    const entry: ReviewEntry = { ...(prev ?? { status: 'unreviewed' as const }), at: prev?.at ?? Date.now() };
    if (Object.keys(edited).length) entry.edited = edited; else delete entry.edited;
    return { project: { ...p, review: { ...(p.review ?? {}), [id]: entry } } };
  });
}

const findRow = (id: string): { kind: 'facility'; row: Facility } | { kind: 'grounds'; row: GroundsArea } | null => {
  const inv = useStore.getState().project?.inventory; if (!inv) return null;
  const f = inv.facilities.find((x) => x.id === id); if (f) return { kind: 'facility', row: f };
  const g = inv.grounds.find((x) => x.id === id); return g ? { kind: 'grounds', row: g } : null;
};
const rowName = (r: Row) => ('buildingNumber' in r && r.buildingNumber ? r.buildingNumber : r.name.length > 28 ? `${r.name.slice(0, 27)}…` : r.name);

/** Commit a facility edit: one store update (plus its edited marker), one undo step. */
export function commitFacility(id: string, patch: Partial<Facility>, what?: string): void {
  const hit = findRow(id); if (!hit || hit.kind !== 'facility') return;
  const changes = changedPaths(hit.row, patch);
  if (!changes.length) return;
  labelNext(`${what ?? 'edit'} of ${rowName(hit.row)}`);
  markEdited(id, changes);
  useStore.getState().updateFacility(id, patch);
}

/** Commit a grounds edit (same rules). */
export function commitGrounds(id: string, patch: Partial<GroundsArea>, what?: string): void {
  const hit = findRow(id); if (!hit || hit.kind !== 'grounds') return;
  const changes = changedPaths(hit.row, patch);
  if (!changes.length) return;
  labelNext(`${what ?? 'edit'} of ${rowName(hit.row)}`);
  markEdited(id, changes);
  useStore.getState().updateGrounds(id, patch);
}

/** The extracted value of an edited field, or undefined when the field is not edited. */
export function extractedValue(entry: ReviewEntry | undefined, path: string): { value: unknown } | undefined {
  if (!entry?.edited || !(path in entry.edited)) return undefined;
  return { value: entry.edited[path] };
}

function patchFor(row: Row, paths: string[], edited: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const path of paths) {
    const v = edited[path] ?? undefined;
    if (path === 'dining.mealsPerDay') {
      const d = (row as Facility).dining;
      if (d) patch.dining = { ...d, mealsPerDay: typeof v === 'number' ? v : 0 };
    } else patch[path] = v;
  }
  return patch;
}

/** R: revert one field (or every edited field of the row when `path` is omitted) to the extracted value. */
export function revertEdits(id: string, path?: string): boolean {
  const hit = findRow(id); if (!hit) return false;
  const entry = useStore.getState().project?.review?.[id];
  const edited = entry?.edited; if (!edited) return false;
  const paths = path ? (path in edited ? [path] : []) : Object.keys(edited);
  if (!paths.length) return false;
  const patch = patchFor(hit.row, paths, edited);
  labelNext(`revert of ${rowName(hit.row)}`);
  // drop the markers first (the update below schedules the save that carries them)
  useStore.setState((s) => {
    const p = s.project; if (!p) return {};
    const prev = p.review?.[id]; if (!prev) return {};
    const left = { ...(prev.edited ?? {}) }; for (const k of paths) delete left[k];
    const next: ReviewEntry = { ...prev }; if (Object.keys(left).length) next.edited = left; else delete next.edited;
    return { project: { ...p, review: { ...(p.review ?? {}), [id]: next } } };
  });
  if (hit.kind === 'facility') useStore.getState().updateFacility(id, patch as Partial<Facility>);
  else useStore.getState().updateGrounds(id, patch as Partial<GroundsArea>);
  return true;
}

/** Bulk facility edit (Category ▾ / Service ▾ / Status ▾ on checked rows): one store write, one undo step, markers per row. */
export function commitFacilitiesBulk(ids: string[], patch: Partial<Facility>, what: string): number {
  const inv = useStore.getState().project?.inventory; if (!inv) return 0;
  const set = new Set(ids);
  const rows = inv.facilities.filter((f) => set.has(f.id) && changedPaths(f, patch).length);
  if (!rows.length) return 0;
  labelNext(what);
  for (const f of rows) markEdited(f.id, changedPaths(f, patch));
  const changed = new Set(rows.map((f) => f.id));
  useStore.getState().patchInventory((i) => ({ ...i, facilities: i.facilities.map((f) => (changed.has(f.id) ? { ...f, ...patch } : f)) }));
  return rows.length;
}

/** Many cells at once (TSV paste): per-row patches, one store write, one undo step. */
export function commitPatches(fac: Map<string, Partial<Facility>>, grd: Map<string, Partial<GroundsArea>>, what: string): void {
  const inv = useStore.getState().project?.inventory; if (!inv) return;
  if (!fac.size && !grd.size) return;
  labelNext(what);
  for (const f of inv.facilities) { const p = fac.get(f.id); if (p) markEdited(f.id, changedPaths(f, p)); }
  for (const g of inv.grounds) { const p = grd.get(g.id); if (p) markEdited(g.id, changedPaths(g, p)); }
  useStore.getState().patchInventory((i) => ({
    ...i,
    facilities: fac.size ? i.facilities.map((f) => (fac.has(f.id) ? { ...f, ...fac.get(f.id) } : f)) : i.facilities,
    grounds: grd.size ? i.grounds.map((g) => (grd.has(g.id) ? { ...g, ...grd.get(g.id) } : g)) : i.grounds,
  }));
}

/** Remove rows (bulk Remove): one store write, one undo step. */
export function removeRows(ids: string[]): void {
  const set = new Set(ids);
  labelNext(`removal of ${ids.length} row${ids.length === 1 ? '' : 's'}`);
  useStore.getState().patchInventory((i) => ({
    ...i,
    facilities: i.facilities.filter((f) => !set.has(f.id)),
    grounds: i.grounds.filter((g) => !set.has(g.id)).map((g) => (g.facilityId && set.has(g.facilityId) ? { ...g, facilityId: undefined } : g)),
  }));
  const sel = useStore.getState().selection;
  if (sel.kind !== null && set.has(sel.id)) useStore.getState().select({ kind: null });
}

export { getPath };
