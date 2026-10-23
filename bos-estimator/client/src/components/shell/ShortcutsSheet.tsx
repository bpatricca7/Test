import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { listHotkeys, onHotkeysChanged } from '../lib/keys';
import { Dialog, Kbd } from '../ui';

/** Keyboard shortcuts (`?`): lists every hotkey registered with a label (UI spec §11; the full sheet is P1). */
export function ShortcutsSheet() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  const [, bump] = useState(0);
  useEffect(() => onHotkeysChanged(() => bump((n) => n + 1)), []);
  if (!open) return null;
  const groups = new Map<string, { combo: string; label: string }[]>();
  for (const h of listHotkeys()) { const g = groups.get(h.group) ?? []; g.push(h); groups.set(h.group, g); }
  groups.set('Everywhere', [...(groups.get('Everywhere') ?? []), { combo: 'escape', label: 'Close the topmost layer' }]);
  return (
    <Dialog open onClose={() => setOpen(false)} title="Keyboard shortcuts" width="min(860px, 94vw)">
      <div className="shortcuts">
        {[...groups.entries()].map(([g, items]) => (
          <section key={g}>
            <h3>{g}</h3>
            {items.map((h) => <div key={h.combo + h.label} className="row"><span>{h.label}</span><Kbd combo={h.combo} /></div>)}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
