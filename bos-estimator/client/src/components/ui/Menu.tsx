import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../lib/cx';
import type { IconType } from './Button';
import { Kbd } from './Kbd';
import { Popover, usePopover } from './Popover';
import type { Placement } from './Portal';

export type MenuItem =
  | { kind?: 'item'; id: string; label: ReactNode; icon?: IconType; kbd?: string; hint?: ReactNode; disabled?: boolean; danger?: boolean;
      /** radio/checkbox state; renders a check mark and role=menuitemradio */
      checked?: boolean; onSelect: () => void; keepOpen?: boolean }
  | { kind: 'separator' }
  | { kind: 'header'; label: ReactNode }
  | { kind: 'custom'; node: ReactNode };

/**
 * Menu (UI spec §5.12): a Popover with role=menu and roving focus (↑/↓, Home/End, Enter/Space).
 * Items close the menu after onSelect unless keepOpen is set.
 */
export function Menu({ open, anchor, onClose, items, label, placement = 'bottom-end', className }: { open: boolean; anchor: RefObject<HTMLElement | null> | HTMLElement | null; onClose: () => void; items: MenuItem[]; label: string; placement?: Placement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-menuitem]:not([disabled])') ?? [])];
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    let n = -1;
    if (e.key === 'ArrowDown') n = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = els.length - 1;
    else if (e.key === 'Tab') { onClose(); return; }
    if (n < 0) return;
    e.preventDefault();
    els[n].focus();
  };
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} placement={placement} role="menu" label={label} className={cx('ui-menu', className)} initialFocus="[data-menuitem]:not([disabled])">
      <div ref={ref} onKeyDown={onKey} className="ui-menu__list">
        {items.map((it, i) => {
          if (it.kind === 'separator') return <div key={`s${i}`} role="separator" className="ui-menu__sep" />;
          if (it.kind === 'header') return <div key={`h${i}`} className="ui-menu__header">{it.label}</div>;
          if (it.kind === 'custom') return <div key={`c${i}`} className="ui-menu__custom">{it.node}</div>;
          const radio = it.checked !== undefined;
          return (
            <button key={it.id} type="button" data-menuitem="" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? it.checked : undefined}
              disabled={it.disabled} tabIndex={-1} className={cx('ui-menu__item', it.danger && 'is-danger', radio && 'is-radio')}
              onClick={() => { it.onSelect(); if (!it.keepOpen) onClose(); }}>
              <span className="ui-menu__icon" aria-hidden>{radio ? (it.checked ? <Check size={14} strokeWidth={2} /> : null) : it.icon ? <it.icon size={16} strokeWidth={1.75} /> : null}</span>
              <span className="ui-menu__label">{it.label}{it.hint && <span className="ui-menu__hint">{it.hint}</span>}</span>
              {it.kbd && <Kbd combo={it.kbd} />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** A trigger plus its Menu. `trigger` receives the ref, open state and toggle so any Button/IconButton can be used. */
export function MenuButton({ items, label, placement, trigger, className }: { items: MenuItem[] | (() => MenuItem[]); label: string; placement?: Placement; className?: string;
  trigger: (p: { ref: RefObject<HTMLButtonElement | null>; open: boolean; toggle: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode }) {
  const pop = usePopover<HTMLButtonElement>();
  return (
    <>
      {trigger({ ref: pop.anchorRef, open: pop.open, toggle: pop.toggle, 'aria-haspopup': 'menu', 'aria-expanded': pop.open })}
      {pop.open && <Menu open anchor={pop.anchorRef} onClose={pop.close} items={typeof items === 'function' ? items() : items} label={label} placement={placement} className={className} />}
    </>
  );
}
