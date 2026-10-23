// Left panel › Inventory tab (UI spec §5.3): toolbar (search with the §5.3 query syntax and "12 of 370", sort menu,
// add menu), filter chips with counts (All, Needs review, Flagged, Out of scope, Incoming, Edited, Changed, Campus),
// a sortable 28 px column header, the virtualized list with sticky "Buildings" / "Grounds areas" sections, and the
// review footer. The query lives in store.query and is shared with the Table view (lib/query.ts).

import { memo, useCallback, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Building2, Plus, Trees } from 'lucide-react';
import { useStore, type SortKey } from '../../store';
import { useDerived } from '../../derived';
import { n1 } from '../../fmt';
import { cx } from '../lib/cx';
import { sortLabel, sortPatch, usePublishOrder, useInventoryView } from '../lib/query';
import { IconButton, Menu, Meter, usePopover } from '../ui';
import { InventoryList, type InventoryListHandle, type ListItem, itemId } from './InventoryList';
import { QueryChips, QuerySearch, SortMenuButton } from './QueryControls';
import { selectRow } from './reviewLoop';
import '../../styles/inventory.css';

export const InventoryTab = memo(function InventoryTab() {
  const chip = useStore((s) => s.query.chip);
  const text = useStore((s) => s.query.text);
  const sort = useStore((s) => s.query.sort);
  const desc = useStore((s) => s.query.desc);
  const setQuery = useStore((s) => s.setQuery);
  const running = useStore((s) => s.extraction.running);
  const incomingTotal = useStore((s) => s.extraction.staging.incoming.length + s.extraction.staging.incomingGrounds.length);
  const { rowMeta, counts, est, estById, gestById, facById } = useDerived();
  const view = useInventoryView();
  const listRef = useRef<InventoryListHandle>(null);
  const add = usePopover<HTMLButtonElement>();

  // ---- items: sections, or the staged rows under the Incoming chip ----
  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    if (chip === 'incoming') {
      if (view.incomingFacilities.length) { out.push({ t: 'head', key: 'in-f', label: 'Incoming buildings', count: view.incomingFacilities.length, note: 'read-only' }); for (const f of view.incomingFacilities) out.push({ t: 'f', f, incoming: true }); }
      if (view.incomingGrounds.length) { out.push({ t: 'head', key: 'in-g', label: 'Incoming grounds', count: view.incomingGrounds.length, note: 'read-only' }); for (const g of view.incomingGrounds) out.push({ t: 'g', g, incoming: true }); }
      return out;
    }
    if (view.facilities.length) { out.push({ t: 'head', key: 'f', label: 'Buildings', count: view.facilities.length }); for (const f of view.facilities) out.push({ t: 'f', f }); }
    if (view.grounds.length) { out.push({ t: 'head', key: 'g', label: 'Grounds areas', count: view.grounds.length }); for (const g of view.grounds) out.push({ t: 'g', g }); }
    return out;
  }, [view, chip]);

  const order = useMemo(() => items.filter((i) => i.t !== 'head' && !(i as { incoming?: boolean }).incoming).map(itemId), [items]);
  usePublishOrder('list', order);

  const fteOf = useCallback((id: string) => estById.get(id)?.fte ?? gestById.get(id)?.fte, [estById, gestById]);
  const maxFte = useMemo(() => Math.max(0.01, ...(est?.facilities.map((e) => e.fte) ?? [0]), ...(est?.grounds.map((g) => g.fte) ?? [0])), [est]);
  const hostName = useCallback((id: string) => { const f = facById.get(id); return f ? f.buildingNumber || f.name : undefined; }, [facById]);

  const total = view.totalFacilities + view.totalGrounds;
  const count = view.active ? `${view.shown.toLocaleString()} of ${(chip === 'incoming' ? incomingTotal : total).toLocaleString()}` : total.toLocaleString();

  const headerSort = (k: SortKey) => setQuery(sort === k ? { desc: !desc } : sortPatch(k));
  const ariaSort = (k: SortKey) => (sort === k ? (desc ? 'descending' : 'ascending') : 'none') as 'none' | 'ascending' | 'descending';
  const Arrow = desc ? ArrowDown : ArrowUp;
  const arrow = (k: SortKey) => (sort === k ? <Arrow size={11} aria-hidden /> : null);

  const byHint = sort !== 'source' && !['bldg', 'name', 'gross', 'fte'].includes(sort) ? `${sortLabel(sort)} ${desc ? '↓' : '↑'}` : null;
  const renderHeader = (section: { label: string; count: number } | null, sections: number) => (
    <div className="inv__head" role="row">
      <button type="button" role="columnheader" className={cx('inv__th', sort === 'bldg' && 'is-on')} aria-sort={ariaSort('bldg')} onClick={() => headerSort('bldg')} title="Sort by building number">#{arrow('bldg')}</button>
      <button type="button" role="columnheader" className={cx('inv__th', 'inv__th--name', sort === 'name' && 'is-on')} aria-sort={ariaSort('name')} onClick={() => headerSort('name')} title={`Sort by name${byHint ? ` (now: ${byHint})` : ''}`}>
        <span className="inv__th-sec">{section && !(byHint && sections < 2) ? <>{section.label}{byHint ? null : <span className="inv__th-count"> {section.count.toLocaleString()}</span>}</> : 'Name'}</span>{arrow('name')}
        {byHint && <span className="inv__th-by">· {byHint}</span>}
      </button>
      <span className="inv__th inv__th--r" role="columnheader">
        <button type="button" className={cx('inv__th-part', sort === 'gross' && 'is-on')} aria-sort={ariaSort('gross')} onClick={() => headerSort('gross')} title="Sort by gross SF">SF{arrow('gross')}</button>
        <span aria-hidden>·</span>
        <button type="button" className={cx('inv__th-part', sort === 'fte' && 'is-on')} aria-sort={ariaSort('fte')} onClick={() => headerSort('fte')} title="Sort by FTE">FTE{arrow('fte')}</button>
      </span>
    </div>
  );

  return (
    <div className="inv">
      <div className="inv__toolbar">
        <QuerySearch className="inv__search" count={count} onEnter={() => { if (order[0]) selectRow(order[0]); }} onArrowDown={() => listRef.current?.focus()} />
        <SortMenuButton />
        <IconButton ref={add.anchorRef} icon={Plus} label="Add" tooltip="Add a building or grounds area" aria-haspopup="menu" aria-expanded={add.open} onClick={add.toggle} disabled={running} />
        <Menu open={add.open} anchor={add.anchorRef} onClose={add.close} label="Add" items={[
          { id: 'b', label: 'Add building', icon: Building2, onSelect: () => useStore.getState().addFacility() },
          { id: 'g', label: 'Add grounds area', icon: Trees, onSelect: () => useStore.getState().addGrounds() },
        ]} />
      </div>
      <QueryChips className="inv__chips" />
      <InventoryList ref={listRef} items={items} rowMeta={rowMeta} fteOf={fteOf} maxFte={maxFte} hostName={hostName} label="Facilities and grounds" header={renderHeader}
        empty={<div className="inv__empty">{
          chip === 'incoming' ? 'The read has not found any rows yet.'
            : running && !total ? 'Waiting for the reader to find buildings…'
              : total ? <>No rows match{text ? <> “{text}”</> : null}{chip !== 'all' ? <> under this filter</> : null}. <button type="button" className="link-btn" onClick={() => setQuery({ text: '', chip: 'all' })}>Clear filters</button></>
                : 'No buildings yet. Drop the solicitation in Documents or try the sample.'
        }</div>} />
      <div className="inv__foot">
        <span title={`${counts.verified} verified · ${counts.needs} need review · ${counts.flagged} flagged`}>Reviewed {counts.verified.toLocaleString()}/{counts.total.toLocaleString()}</span>
        <Meter value={counts.verified} max={counts.total} label="Review progress" />
        <span className="inv__foot-fte">{est ? `${n1(est.totalFte)} FTE` : '—'}</span>
      </div>
    </div>
  );
});
