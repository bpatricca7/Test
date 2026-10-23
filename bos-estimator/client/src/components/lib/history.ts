// Undo / redo (UI spec §5.13, P1). Keeps past/future snapshots of the inventory and review marks (structural
// sharing: a snapshot is the project's own immutable inventory/review objects), capped at 50. Every store change made
// in one task is one step (a commit, a bulk action, a paste, a removal, a restore); a whole extraction run, from the
// pre-run state to the merged reload, is one step. Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z or Ctrl+Y redoes.
//
// Note: the store has no "replace inventory and review" action, so apply() writes `review` with useStore.setState
// and the inventory through patchInventory (which schedules the save). See the report: a store-level history /
// `restoreDoc` action would replace this.

import { create } from 'zustand';
import type { Inventory } from '@shared/types';
import { useStore, type ClientProject } from '../../store';
import type { ReviewMap } from './review';
import { registerHotkey } from './keys';

interface Doc { inventory: Inventory; review: ReviewMap | undefined }
interface Step { before: Doc; after: Doc; label: string }

const CAP = 50;
const past: Step[] = [];
const future: Step[] = [];
let applying = false;
let pendingBefore: Doc | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let nextLabel: string | null = null;
let runBase: Doc | null = null;
let runTimer: ReturnType<typeof setTimeout> | null = null;

/** UI state for buttons and menus. */
export const useHistory = create(() => ({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' }));
const sync = () => useHistory.setState({
  canUndo: past.length > 0, canRedo: future.length > 0,
  undoLabel: past[past.length - 1]?.label ?? '', redoLabel: future[future.length - 1]?.label ?? '',
});

const docOf = (p: ClientProject): Doc => ({ inventory: p.inventory, review: p.review });
const sameDoc = (a: Doc, b: Doc) => a.inventory === b.inventory && a.review === b.review;

/** Name the next step ("Gross SF of 5995", "Verify 12 rows"); used by the toast after undo / redo. */
export function labelNext(label: string) { nextLabel = label; }

function inferLabel(a: Doc, b: Doc): string {
  const df = b.inventory.facilities.length - a.inventory.facilities.length;
  const dg = b.inventory.grounds.length - a.inventory.grounds.length;
  if (df > 0 || dg > 0) return 'add';
  if (df < 0 || dg < 0) return 'removal';
  if (a.inventory === b.inventory) return 'review change';
  return 'edit';
}

function push(step: Step) {
  past.push(step);
  if (past.length > CAP) past.shift();
  future.length = 0;
  sync();
}

function flushPending() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  const before = pendingBefore; pendingBefore = null;
  const label = nextLabel; nextLabel = null;
  const p = useStore.getState().project;
  if (!before || !p) return;
  const after = docOf(p);
  if (sameDoc(before, after)) return;
  push({ before, after, label: label ?? inferLabel(before, after) });
}

function finishRun() {
  if (runTimer) { clearTimeout(runTimer); runTimer = null; }
  const base = runBase; runBase = null;
  const p = useStore.getState().project;
  if (!base || !p) return;
  const after = docOf(p);
  if (!sameDoc(base, after)) push({ before: base, after, label: 'the last read' });
}

function reset() {
  past.length = 0; future.length = 0;
  pendingBefore = null; runBase = null; nextLabel = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  if (runTimer) clearTimeout(runTimer);
  pendingTimer = runTimer = null;
  sync();
}

const unsubscribe = useStore.subscribe((s, prev) => {
  if (applying) return;
  const p = s.project, q = prev.project;
  if (!p || !q || p.id !== q.id) { if (p?.id !== q?.id) reset(); return; }
  // a run is one step: from the state before it started to the merged reload after it
  if (s.extraction.running && !prev.extraction.running) { flushPending(); runBase = docOf(q); return; }
  if (s.extraction.running) return;
  if (!s.extraction.running && prev.extraction.running) { if (runTimer) clearTimeout(runTimer); runTimer = setTimeout(finishRun, 3000); }
  if (p.inventory === q.inventory && p.review === q.review) return;
  if (runBase) return; // the reload and review merge after a run belong to the run step
  if (!pendingBefore) pendingBefore = docOf(q);
  if (!pendingTimer) pendingTimer = setTimeout(flushPending, 0);
});

function apply(doc: Doc) {
  const s = useStore.getState(); const p = s.project; if (!p) return;
  applying = true;
  try {
    if (p.review !== doc.review) useStore.setState({ project: { ...p, review: doc.review } });
    // patchInventory goes through the store's mutate path, which schedules the save (with the review above)
    useStore.getState().patchInventory(() => doc.inventory);
    const sel = useStore.getState().selection;
    if (sel.kind !== null) {
      const exists = sel.kind === 'facility' ? doc.inventory.facilities.some((f) => f.id === sel.id) : doc.inventory.grounds.some((g) => g.id === sel.id);
      if (!exists) useStore.getState().select({ kind: null });
    }
  } finally { applying = false; }
}

function blockedByRun(): boolean {
  if (!useStore.getState().extraction.running) return false;
  useStore.getState().pushToast({ text: 'Undo is paused while a read is running', tone: 'warn', ttl: 2500 });
  return true;
}

export function undo(): boolean {
  flushPending();
  if (runBase) finishRun();
  const step = past.pop(); if (!step) return false;
  if (blockedByRun()) { past.push(step); return true; }
  apply(step.before);
  future.push(step);
  sync();
  useStore.getState().pushToast({ text: `Undid ${step.label}`, ttl: 3500, action: { label: 'Redo', run: () => { redo(); } } });
  return true;
}

export function redo(): boolean {
  flushPending();
  const step = future.pop(); if (!step) return false;
  if (blockedByRun()) { future.push(step); return true; }
  apply(step.after);
  past.push(step);
  sync();
  useStore.getState().pushToast({ text: `Redid ${step.label}`, ttl: 3000, action: { label: 'Undo', run: () => { undo(); } } });
  return true;
}

const offs = [
  registerHotkey('mod+z', () => { if (!undo()) useStore.getState().pushToast({ text: 'Nothing to undo', ttl: 1500 }); }, { label: 'Undo', group: 'History' }),
  registerHotkey(['mod+shift+z', 'ctrl+y'], () => { if (!redo()) useStore.getState().pushToast({ text: 'Nothing to redo', ttl: 1500 }); }, { label: 'Redo', group: 'History' }),
];
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe(); for (const off of offs) off(); reset(); });
