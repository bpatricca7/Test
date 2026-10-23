// Query controls shared by the rail list and the Table view (UI spec §5.3, §5.6): the search box with the §5.3
// syntax and the "12 of 370" count, the filter chips with counts (plus the campus menu chip), and the sort menu.

import { memo, useMemo, type KeyboardEvent, type Ref } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, MapPinned, Search, X } from 'lucide-react';
import { useStore, type QueryChip } from '../../store';
import { useDerived } from '../../derived';
import { normCampus } from '../lib/review';
import { cx } from '../lib/cx';
import { SORTS, sortLabel, sortPatch } from '../lib/query';
import { Chip, IconButton, Menu, usePopover, type ChipTone, type MenuItem } from '../ui';

export const SEARCH_HELP = 'Search # or name  ·  cat: conf< sf> is:';
export const SEARCH_SYNTAX = [
  'Search the inventory',
  '5995 or #59* — building number (prefix, or * wildcard)',
  'cat:dining — category · svc:weekly — service',
  'conf<60 — confidence below 60% · sf>50k — gross SF over 50,000',
  'is:needs · is:verified · is:flagged · is:new · is:excluded · is:edited',
  'campus:north · status:deleted · src:"TE-5" · issue:dup',
  'Prefix a token with - to exclude it (-is:verified)',
].join('\n');

/** Replace (or remove, with value null) the campus:"…" token in a query string. */
export function withCampusToken(text: string, campus: string | null): string {
  const rest = text.replace(/(^|\s)-?campus:("[^"]*"?|\S*)/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!campus) return rest;
  const tok = /\s/.test(campus) ? `campus:"${campus}"` : `campus:${campus}`;
  return rest ? `${rest} ${tok}` : tok;
}
export function campusOf(text: string): string | null {
  const m = /(?:^|\s)campus:("([^"]*)"?|(\S+))/i.exec(text);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

/** Search input with the count inside it on the right. `onEnter` selects the first match. */
export function QuerySearch({ count, onEnter, onArrowDown, className, inputRef, size = 'md' }: { count: string; onEnter: () => void; onArrowDown?: () => void; className?: string; inputRef?: Ref<HTMLInputElement>; size?: 'md' | 'sm' }) {
  const text = useStore((s) => s.query.text);
  const setQuery = useStore((s) => s.setQuery);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { if (text) { e.preventDefault(); e.stopPropagation(); setQuery({ text: '' }); } else (e.target as HTMLInputElement).blur(); }
    else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
    else if (e.key === 'ArrowDown' && onArrowDown) { e.preventDefault(); onArrowDown(); }
  };
  return (
    <label className={cx('qsearch', size === 'sm' && 'qsearch--sm', className)} title={SEARCH_SYNTAX}>
      <Search size={14} aria-hidden className="qsearch__icon" />
      <input ref={inputRef} className="qsearch__input inv__search-input" placeholder={SEARCH_HELP} value={text} aria-label="Search the inventory" spellCheck={false} autoComplete="off"
        onChange={(e) => setQuery({ text: e.target.value })} onKeyDown={onKeyDown} />
      {text && <button type="button" className="qsearch__clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery({ text: '' })}><X size={12} aria-hidden /></button>}
      <span className="qsearch__count" aria-live="polite">{count}</span>
    </label>
  );
}

/** The mutually exclusive filter chips (and the campus menu chip when the inventory has more than one campus). */
export const QueryChips = memo(function QueryChips({ className }: { className?: string }) {
  const chip = useStore((s) => s.query.chip);
  const text = useStore((s) => s.query.text);
  const setQuery = useStore((s) => s.setQuery);
  const staging = useStore((s) => s.extraction.staging);
  const changedCount = useStore((s) => s.extraction.result?.changedIds.length ?? 0);
  const facilities = useStore((s) => s.project?.inventory.facilities);
  const { counts } = useDerived();
  const campusPop = usePopover<HTMLElement>();

  const campuses = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const f of facilities ?? []) { if (!f.campus) continue; const k = normCampus(f.campus); const e = m.get(k); if (e) e.n++; else m.set(k, { label: f.campus, n: 1 }); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [facilities]);
  const activeCampus = campusOf(text);
  const incomingCount = staging.incoming.length + staging.incomingGrounds.length;
  const chips: { id: QueryChip; label: string; count: number; tone: ChipTone; show: boolean; tip?: string }[] = [
    { id: 'all', label: 'All', count: counts.total, tone: 'accent', show: true },
    { id: 'needs', label: 'Needs review', count: counts.needs, tone: 'warn', show: true, tip: 'Rows with an issue that counts: low confidence, SF not in the source, duplicate number, converted unit, exclusion…\nSorted by impact (FTE × (1 − confidence)). J / K walk them.' },
    { id: 'flagged', label: 'Flagged', count: counts.flagged, tone: 'flag', show: true },
    { id: 'out', label: 'Out of scope', count: counts.outOfScope, tone: 'neutral', show: true, tip: 'Excluded, deleted by amendment, demolished, vacant or option-only: shown, not estimated' },
    { id: 'incoming', label: 'Incoming', count: incomingCount, tone: 'new', show: staging.active || chip === 'incoming', tip: 'Rows the running Replace read has found so far (read-only until it finishes)' },
    { id: 'edited', label: 'Edited', count: counts.edited, tone: 'edit', show: counts.edited > 0 || chip === 'edited' },
    { id: 'changed', label: 'Changed by re-run', count: changedCount, tone: 'new', show: changedCount > 0 || chip === 'changed' },
  ];
  const choose = (c: QueryChip) => setQuery(c === 'needs' && chip !== 'needs' ? { chip: c, ...sortPatch('impact') } : { chip: c });
  return (
    <div className={cx('qchips', className)} role="toolbar" aria-label="Filter rows">
      {chips.filter((c) => c.show).map((c) => (
        <Chip key={c.id} tone={c.id === chip ? c.tone : c.tone === 'accent' ? 'neutral' : c.tone} className={cx('qchip', c.id !== chip && 'is-quiet')}
          selected={chip === c.id} count={c.count.toLocaleString()} tooltip={c.tip} onClick={() => choose(c.id)}>{c.label}</Chip>
      ))}
      {campuses.length > 1 && (
        <>
          <span className="qchips__sep" aria-hidden />
          <Chip ref={campusPop.anchorRef} icon={MapPinned} tone={activeCampus ? 'accent' : 'neutral'} selected={Boolean(activeCampus)} className={cx('qchip', !activeCampus && 'is-quiet')}
            tooltip="Filter by campus (adds campus: to the search)" onClick={campusPop.toggle}>
            <span className="qchip__campus">{activeCampus ?? 'Campus'}</span><ChevronDown size={12} aria-hidden />
          </Chip>
          <Menu open={campusPop.open} anchor={campusPop.anchorRef} onClose={campusPop.close} label="Campus" placement="bottom-start" items={[
            { id: '_all', label: 'All campuses', checked: !activeCampus, onSelect: () => setQuery({ text: withCampusToken(text, null) }) },
            { kind: 'separator' },
            ...campuses.map((c) => ({ id: c.label, label: c.label, hint: `${c.n.toLocaleString()} building${c.n === 1 ? '' : 's'}`, checked: activeCampus != null && normCampus(activeCampus) === normCampus(c.label), onSelect: () => setQuery({ text: withCampusToken(text, c.label) }) })),
          ]} />
        </>
      )}
    </div>
  );
});

/** Sort menu button (Source order, Impact, Building #, Name, Gross SF, FTE, Confidence; direction). */
export function SortMenuButton({ extraLabel, onPick }: { extraLabel?: string | null; onPick?: () => void }) {
  const sort = useStore((s) => s.query.sort);
  const desc = useStore((s) => s.query.desc);
  const setQuery = useStore((s) => s.setQuery);
  const pop = usePopover<HTMLButtonElement>();
  const items: MenuItem[] = [
    { kind: 'header', label: 'Sort rows by' },
    ...SORTS.map((s) => ({ id: s.id, label: s.label, hint: s.hint, checked: !extraLabel && sort === s.id, onSelect: () => { setQuery(sortPatch(s.id)); onPick?.(); } })),
    { kind: 'separator' },
    { id: 'dir', label: desc ? 'Descending' : 'Ascending', hint: 'Reverse the order', icon: desc ? ArrowDown : ArrowUp, onSelect: () => { setQuery({ desc: !desc }); onPick?.(); } },
  ];
  const label = extraLabel ?? `${sortLabel(sort)}${sort === 'source' ? '' : desc ? ' ↓' : ' ↑'}`;
  return (
    <>
      <IconButton ref={pop.anchorRef} icon={ArrowUpDown} label={`Sort: ${label}`} tooltip={`Sort: ${label}`} pressed={Boolean(extraLabel) || sort !== 'source'} aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle} />
      <Menu open={pop.open} anchor={pop.anchorRef} onClose={pop.close} label="Sort" items={items} />
    </>
  );
}
