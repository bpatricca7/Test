import { memo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { FileStack, Keyboard, Rows3, Settings2 } from 'lucide-react';
import { useStore, type LeftTab } from '../../store';
import { useDerived } from '../../derived';
import { MenuButton, Tooltip } from '../ui';
import { cx } from '../lib/cx';
import { displayMenuItems } from './TopBar';

/**
 * Rail (UI spec §5.2): 44 px. Inventory (amber needs-review badge) and Documents (run dot) tabs; clicking the
 * active tab collapses the left panel, any tab while collapsed opens it. Bottom: shortcuts and display settings.
 */
export const Rail = memo(function Rail() {
  const leftOpen = useStore((s) => s.leftOpen);
  const leftTab = useStore((s) => s.leftTab);
  const phase = useStore((s) => s.extraction.phase);
  const running = useStore((s) => s.extraction.running);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const { counts } = useDerived();
  const listRef = useRef<HTMLDivElement>(null);

  const click = (t: LeftTab) => {
    const s = useStore.getState();
    if (s.leftOpen && s.leftTab === t) s.setLeftOpen(false);
    else s.openLeft(t);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };
  const runDot = running ? 'running' : phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : null;
  const needs = counts.needs;
  const tab = (id: LeftTab, Icon: typeof Rows3, label: string, extra: ReactNode, tip: string) => {
    const on = leftOpen && leftTab === id;
    return (
      <Tooltip content={tip} placement="right-start">
        <button type="button" role="tab" aria-selected={on} aria-controls={`left-panel-${id}`} aria-label={label} tabIndex={leftTab === id ? 0 : -1}
          className={cx('rail__btn', on && 'is-on')} onClick={() => click(id)}>
          <Icon size={20} strokeWidth={1.75} aria-hidden />
          {extra}
        </button>
      </Tooltip>
    );
  };
  return (
    <nav className="rail" aria-label="Panels">
      <div ref={listRef} className="rail__group" role="tablist" aria-label="Left panel" aria-orientation="vertical" onKeyDown={onKey}>
        {tab('inventory', Rows3, `Inventory${needs ? `, ${needs} need review` : ''}`, needs > 0 ? <span className="rail__badge" aria-hidden>{needs > 99 ? '99+' : needs}</span> : null, needs ? `Inventory · ${needs} need review` : 'Inventory')}
        {tab('documents', FileStack, `Documents${runDot ? `, read ${runDot}` : ''}`, runDot ? <span className={`rail__dot rail__dot--${runDot}`} aria-hidden /> : null, running ? 'Documents · reading…' : 'Documents')}
      </div>
      <div className="rail__group">
        <Tooltip content="Keyboard shortcuts (?)" placement="right-start">
          <button type="button" className="rail__btn" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard size={20} strokeWidth={1.75} aria-hidden /></button>
        </Tooltip>
        <MenuButton label="Display settings" placement="right-start" items={displayMenuItems}
          trigger={(t) => (
            <Tooltip content="UI zoom and motion" placement="right-start">
              <button ref={t.ref} type="button" className={cx('rail__btn', t.open && 'is-on')} aria-label="Display settings" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}><Settings2 size={20} strokeWidth={1.75} aria-hidden /></button>
            </Tooltip>
          )} />
      </div>
    </nav>
  );
});
