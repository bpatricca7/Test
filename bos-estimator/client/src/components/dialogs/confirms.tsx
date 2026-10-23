// ConfirmDialog content for the two destructive flows (UI spec §5.11). The shell owns where they are called
// (store.analyze for Replace, TopBar's ⋯ › Reset project for Reset); these helpers give both a structured body that
// lists exactly what is affected, and Reset gets the P1 [Download backup] action. Both resolve through store.confirm.
import type { ReactNode } from 'react';
import { useStore, type ClientProject } from '../../store';
import type { ConfirmOptions } from '../ui';
import '../../styles/dialogs.css';

function List({ items }: { items: ReactNode[] }) {
  return <ul className="confirm-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

/** Replace on a populated project: [Append instead] [Cancel] [Replace]. Resolves 'replace' | 'append' | null. */
export function replaceConfirmOptions(p: ClientProject): ConfirmOptions {
  const inv = p.inventory;
  const verified = Object.values(p.review ?? {}).filter((r) => r.status === 'verified').length;
  return {
    title: 'Replace the inventory?',
    body: (
      <div className="confirm-body">
        <p>Replace {inv.facilities.length.toLocaleString()} facilities and {inv.grounds.length.toLocaleString()} grounds areas? The new read goes to a staging list; your current inventory stays until it finishes and can be restored.</p>
        {verified > 0 && <p>{verified.toLocaleString()} verified rows keep their marks by building id.</p>}
      </div>
    ),
    actions: [{ id: 'append', label: 'Append instead' }, { id: 'cancel', label: 'Cancel' }, { id: 'replace', label: 'Replace', variant: 'primary' }],
  };
}

/** Download the project as JSON (P1 backup before Reset). */
export function downloadBackup(p: ClientProject) {
  try {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(p.name || p.id).replace(/[^\w.-]+/g, '-')}-backup.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { /* download blocked */ }
}

/** Reset: lists what is lost; [Download backup] [Cancel] [Reset project]. Downloading keeps the dialog's question open. */
export async function confirmResetProject(): Promise<boolean> {
  for (;;) {
    const s = useStore.getState(); const p = s.project; if (!p) return false;
    const reviewed = Object.values(p.review ?? {}).filter((r) => r.status !== 'unreviewed').length;
    const lost: ReactNode[] = [
      `${p.inventory.facilities.length.toLocaleString()} facilities and ${p.inventory.grounds.length.toLocaleString()} grounds areas`,
      `${Object.keys(p.factorOverrides ?? {}).length} factor overrides and ${Object.keys(p.wages ?? {}).length} custom wages`,
      `${reviewed.toLocaleString()} review marks`,
      p.priorAward || p.topDown ? 'the previous-award facts and the cross-check' : null,
      p.documents.length ? `the record of ${p.documents.length} read document${p.documents.length > 1 ? 's' : ''}` : null,
    ].filter(Boolean);
    const choice = await s.confirm({
      title: 'Reset this project?',
      body: <div className="confirm-body"><p>This clears:</p><List items={lost} /><p>It cannot be undone.</p></div>,
      actions: [{ id: 'backup', label: 'Download backup' }, { id: 'cancel', label: 'Cancel', autoFocus: true }, { id: 'reset', label: 'Reset project', variant: 'danger' }],
    });
    if (choice === 'backup') { downloadBackup(p); continue; }
    if (choice !== 'reset') return false;
    await s.clearProject();
    return true;
  }
}
