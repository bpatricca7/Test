// The keyboard review loop (UI spec §6.4, §11): J/K next/previous row needing review in the current sort and filter,
// Shift+J/K next/previous row, V verify and advance (120 ms), X flag, U unreview, / search. Registered once at module
// load (this module is imported by the Inventory tab), so the keys work in Map and Table view whichever left tab shows.
// The Inspector can call the same functions for its "‹ K · 7 / 32 · J ›" control and read useReviewPosition().

import { useStore } from '../../store';
import { registerHotkey } from '../lib/keys';
import { currentOrder, metaOf, metaSnapshot, useNavOrder } from '../lib/query';
import { useDerived } from '../../derived';

type Sel = { kind: 'facility' | 'grounds'; id: string };
const st = useStore.getState;

/** Last position of the selection in the order, so a row that leaves the filter (verified under "Needs review") keeps its place. */
let anchor: { id: string; index: number } | null = null;
let pending: { timer: ReturnType<typeof setTimeout> } | null = null;
/** The id the list/table just selected itself (they do not flash or scroll for their own clicks). */
export let localSelectId: string | null = null;
export const markLocalSelect = (id: string | null) => { localSelectId = id; };

function selectedId(): string | null { const s = st().selection; return s.kind === null ? null : s.id; }

function kindOf(id: string): Sel['kind'] | null {
  const inv = st().project?.inventory; if (!inv) return null;
  if (inv.facilities.some((f) => f.id === id)) return 'facility';
  if (inv.grounds.some((g) => g.id === id)) return 'grounds';
  return null;
}

/** Select a row, frame it in Map view (§2.9: row click, J/K, search Enter). */
export function selectRow(id: string, opts: { frame?: boolean; local?: boolean } = {}) {
  const kind = kindOf(id); if (!kind) return;
  const s = st();
  if (opts.local) markLocalSelect(id);
  s.select({ kind, id });
  if (opts.frame !== false && s.view === 'map') s.requestCamera('frame-selection');
}

function startIndex(order: readonly string[], dir: 1 | -1): number {
  const cur = selectedId();
  if (!cur) return dir === 1 ? 0 : order.length - 1;
  const i = order.indexOf(cur);
  if (i >= 0) return i + dir;
  // the selection left the filtered order (e.g. just verified under "Needs review"): continue from where it was
  if (anchor && anchor.id === cur) return dir === 1 ? anchor.index : anchor.index - 1;
  return dir === 1 ? 0 : order.length - 1;
}

function rememberAnchor() {
  const cur = selectedId(); if (!cur) return;
  const i = currentOrder().indexOf(cur);
  if (i >= 0) anchor = { id: cur, index: i };
}

function flushPending(): boolean {
  if (!pending) return false;
  clearTimeout(pending.timer); pending = null;
  nextNeeds(1, { quiet: true });
  return true;
}

/** J / K: next or previous row that needs review, wrapping once. Returns false when there is none. */
export function nextNeeds(dir: 1 | -1 = 1, opts: { quiet?: boolean } = {}): boolean {
  if (pending && !opts.quiet) flushPending();
  rememberAnchor();
  const order = currentOrder();
  if (!order.length) return false;
  const metas = metaSnapshot();
  const isNeeds = (id: string) => metas.get(id)?.review === 'needs';
  const n = order.length;
  let i = startIndex(order, dir);
  let wrapped = false;
  for (let step = 0; step < n; step++) {
    if (i >= n) { i = 0; wrapped = true; } else if (i < 0) { i = n - 1; wrapped = true; }
    const id = order[i];
    if (isNeeds(id) && id !== selectedId()) {
      anchor = { id, index: i };
      selectRow(id);
      if (wrapped && !opts.quiet) st().pushToast({ text: dir === 1 ? 'Back to the first row that needs review' : 'Back to the last row that needs review', ttl: 1800 });
      return true;
    }
    i += dir;
  }
  if (!opts.quiet) {
    const cur = selectedId();
    const anyNeeds = [...metas.values()].some((m) => m.review === 'needs');
    st().pushToast({ text: anyNeeds && cur && isNeeds(cur) ? 'This is the only row that needs review here' : anyNeeds ? 'No rows in this filter need review' : 'No rows need review', tone: 'ok', ttl: 2200 });
  }
  return false;
}

/** Shift+J / Shift+K: next or previous row in the visible order. */
export function nextRow(dir: 1 | -1 = 1): boolean {
  if (pending) flushPending();
  rememberAnchor();
  const order = currentOrder(); if (!order.length) return false;
  let i = startIndex(order, dir);
  i = Math.max(0, Math.min(order.length - 1, i));
  const id = order[i];
  if (id === selectedId()) return false;
  anchor = { id, index: i };
  selectRow(id);
  return true;
}

function target(): string | null { return selectedId(); }

/** V: verify the selected row, then advance to the next row needing review after 120 ms. */
export function verifyAndAdvance(): boolean {
  const id = target(); if (!id) return false;
  if (pending) { clearTimeout(pending.timer); pending = null; }
  rememberAnchor();
  st().setReview([id], 'verified');
  pending = { timer: setTimeout(() => { pending = null; nextNeeds(1, { quiet: true }); }, 120) };
  return true;
}

/** X: toggle the flag on the selected row. */
export function toggleFlag(): boolean {
  const id = target(); if (!id) return false;
  if (pending) flushPending();
  const status = st().project?.review?.[id]?.status;
  st().setReview([id], status === 'flagged' ? null : 'flagged');
  return true;
}

/** U: clear the review mark. */
export function unreview(): boolean {
  const id = target(); if (!id) return false;
  if (pending) flushPending();
  st().setReview([id], null);
  return true;
}

/** "/" focuses the search of the visible surface (opens the left panel on Inventory in Map view). */
export function focusSearch(): void {
  const s = st();
  if (s.view === 'map' && (!s.leftOpen || s.leftTab !== 'inventory')) s.openLeft('inventory');
  const sel = s.view === 'table' ? '.tv-search input' : '.inv__search-input';
  let tries = 0;
  const go = () => {
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el && el.offsetParent !== null) { el.focus(); el.select(); return; }
    if (++tries < 10) requestAnimationFrame(go);
  };
  go();
}

/** Position of the selection among the rows that need review in the current order: "7 / 32". */
export function useReviewPosition(): { index: number; total: number } {
  const sel = useStore((s) => (s.selection.kind === null ? null : s.selection.id));
  const view = useStore((s) => s.view);
  const order = useNavOrder((n) => (view === 'table' ? n.table : n.list));
  const { rowMeta } = useDerived();
  let total = 0; let index = 0;
  for (const id of order) {
    const m = rowMeta.get(id);
    if (m?.review === 'needs' || id === sel) { if (m?.review === 'needs') total++; if (id === sel) index = m?.review === 'needs' ? total : 0; }
  }
  return { index, total };
}

// ---- hotkeys (once per module instance; HMR disposes the previous ones) ----
const G = 'Review';
const offs = [
  registerHotkey('j', () => nextNeeds(1), { label: 'Next row that needs review', group: G }),
  registerHotkey('k', () => nextNeeds(-1), { label: 'Previous row that needs review', group: G }),
  registerHotkey('shift+j', () => nextRow(1), { label: 'Next row', group: G }),
  registerHotkey('shift+k', () => nextRow(-1), { label: 'Previous row', group: G }),
  registerHotkey('v', () => verifyAndAdvance(), { label: 'Verify and go to the next row that needs review', group: G }),
  registerHotkey('x', () => toggleFlag(), { label: 'Flag / unflag', group: G }),
  registerHotkey('u', () => unreview(), { label: 'Clear the review mark', group: G }),
  registerHotkey('/', () => focusSearch(), { label: 'Search the inventory', group: 'Everywhere' }),
];
if (import.meta.hot) import.meta.hot.dispose(() => { for (const off of offs) off(); if (pending) clearTimeout(pending.timer); });

/** For tests and the Inspector: the review entry of the selection, from the store. */
export const selectionMeta = () => { const id = selectedId(); return id ? metaOf(id) : undefined; };
