// Manual edits from the table and the bulk bar (UI spec §6.3 P1, §5.6 "Edited cell"). The store records the edited
// markers (review[id].edited[field] = extracted value) in the same write as the edit, so every surface that edits a
// row (table, Inspector, paste, bulk) gets them. These wrappers name the undo step (lib/history.ts) and keep the
// table's call sites short; each one is a single store write and a single undo step.

import type { Facility, GroundsArea } from '@shared/types';
import { useStore } from '../../store';
import type { ReviewEntry } from '../lib/review';
import { labelNext } from '../lib/history';

type Row = Facility | GroundsArea;

const findRow = (id: string): Row | null => {
  const inv = useStore.getState().project?.inventory; if (!inv) return null;
  return inv.facilities.find((x) => x.id === id) ?? inv.grounds.find((x) => x.id === id) ?? null;
};
const rowName = (r: Row) => ('buildingNumber' in r && r.buildingNumber ? r.buildingNumber : r.name.length > 28 ? `${r.name.slice(0, 27)}…` : r.name);

/** Commit a facility edit: one store write (with its edited marker), one undo step. */
export function commitFacility(id: string, patch: Partial<Facility>, what?: string): void {
  const row = findRow(id); if (!row) return;
  labelNext(`${what ?? 'edit'} of ${rowName(row)}`);
  if (!useStore.getState().updateRows(new Map([[id, patch]]))) labelNext(null);
}

/** Commit a grounds edit (same rules). */
export function commitGrounds(id: string, patch: Partial<GroundsArea>, what?: string): void {
  const row = findRow(id); if (!row) return;
  labelNext(`${what ?? 'edit'} of ${rowName(row)}`);
  if (!useStore.getState().updateRows(new Map(), new Map([[id, patch]]))) labelNext(null);
}

/** The extracted value of an edited field, or undefined when the field is not edited. */
export function extractedValue(entry: ReviewEntry | undefined, path: string): { value: unknown } | undefined {
  if (!entry?.edited || !(path in entry.edited)) return undefined;
  return { value: entry.edited[path] };
}

/** R: revert one field (or every edited field of the row when `path` is omitted) to the extracted value. */
export function revertEdits(id: string, path?: string): boolean {
  const row = findRow(id); if (!row) return false;
  labelNext(`revert of ${rowName(row)}`);
  const ok = useStore.getState().revertEdits(id, path ? [path] : undefined);
  if (!ok) labelNext(null);
  return ok;
}

/** Bulk facility edit (Category ▾ / Service ▾ / Status ▾ on checked rows): one store write, one undo step. */
export function commitFacilitiesBulk(ids: string[], patch: Partial<Facility>, what: string): number {
  labelNext(what);
  const n = useStore.getState().updateRows(new Map(ids.map((id) => [id, patch])));
  if (!n) labelNext(null);
  return n;
}

/** Many cells at once (TSV paste): per-row patches, one store write, one undo step. */
export function commitPatches(fac: Map<string, Partial<Facility>>, grd: Map<string, Partial<GroundsArea>>, what: string): void {
  if (!fac.size && !grd.size) return;
  labelNext(what);
  if (!useStore.getState().updateRows(fac, grd)) labelNext(null);
}

/** Remove rows (bulk Remove): one store write, one undo step. */
export function removeRows(ids: string[]): void {
  labelNext(`removal of ${ids.length} row${ids.length === 1 ? '' : 's'}`);
  useStore.getState().removeRows(ids);
}

