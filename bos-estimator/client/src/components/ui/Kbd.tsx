import { formatCombo } from '../lib/keys';

/** Key cap: <Kbd combo="mod+o" /> → "Ctrl+O". Pass children to print text verbatim. */
export function Kbd({ combo, children }: { combo?: string; children?: string }) {
  return <kbd className="kbd">{children ?? (combo ? formatCombo(combo) : '')}</kbd>;
}
