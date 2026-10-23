// Export actions shared by the top bar's Export ▾ menu and the table's ⋯ menu (UI spec §5.13, P1 client-side
// exports). The server's estimate CSV stays available as well (it ignores custom wages; the client one does not).

import type { EstimateResult } from '@shared/estimate';
import { useStore } from '../../store';
import { sharedContext, type RowMeta } from '../lib/review';
import { copyText, downloadText, estimateCsv, inventoryCsv, rowsTsv, safeFileName } from '../lib/csv';
import { downloadBackup } from '../dialogs/confirms';

/** "Inventory with review (CSV)": every facility and grounds row with review, issues, edits, source, Hrs and FTE. */
export function exportInventoryCsv(est: EstimateResult | null, rowMeta: ReadonlyMap<string, RowMeta>, needs: number): void {
  const s = useStore.getState(); const p = s.project; if (!p) return;
  const ctx = sharedContext(p.inventory.facilities, s.extraction.result?.changedIds ?? [], p.extraction?.provider === 'heuristic');
  downloadText(`${safeFileName(p.name)} - inventory with review.csv`, inventoryCsv(p, est, rowMeta, ctx));
  s.pushToast({ text: `Downloaded ${(p.inventory.facilities.length + p.inventory.grounds.length).toLocaleString()} rows${needs ? ` · ${needs.toLocaleString()} still need review` : ''}`, tone: 'ok', ttl: 3000 });
}

/** "Estimate detail (CSV)": task lines, crews with the project's wages, manning by year. */
export function exportEstimateCsv(est: EstimateResult | null): void {
  const s = useStore.getState(); const p = s.project; if (!p || !est) return;
  downloadText(`${safeFileName(p.name)} - estimate detail.csv`, estimateCsv(p, est));
  s.pushToast({ text: 'Downloaded the estimate detail (with your wages)', tone: 'ok', ttl: 2500 });
}

/** "Project backup (.json)". */
export function exportBackup(): void {
  const p = useStore.getState().project; if (p) downloadBackup(p);
}

/** "Copy visible rows (TSV)": the given rows, in order. */
export function copyRowsTsv(ids: readonly string[], est: EstimateResult | null, rowMeta: ReadonlyMap<string, RowMeta>): void {
  const s = useStore.getState(); const p = s.project; if (!p) return;
  void copyText(rowsTsv(p, ids, est, rowMeta)).then((ok) => s.pushToast({ text: ok ? `Copied ${ids.length.toLocaleString()} rows (TSV)` : 'Copy failed (clipboard unavailable)', tone: ok ? 'ok' : 'warn', ttl: 2000 }));
}
