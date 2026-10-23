import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { IconType } from './Button';

export interface TabItem<T extends string> { id: T; label: ReactNode; count?: ReactNode; badge?: ReactNode; icon?: IconType; disabled?: boolean }

/**
 * Tabs (UI spec §5.12): 40 px tab strip, role=tablist with roving focus (←/→, Home/End).
 * Panels are rendered by the caller; give them id={`${idBase}-panel-${id}`} and role="tabpanel".
 */
export function Tabs<T extends string>({ value, items, onChange, label, idBase, className, size = 'md', end }: { value: T; items: TabItem<T>[]; onChange: (v: T) => void; label: string; idBase: string; className?: string; size?: 'md' | 'sm'; end?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const enabled = items.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === value);
    let n: TabItem<T> | undefined;
    if (e.key === 'ArrowRight') n = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') n = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') n = enabled[0];
    else if (e.key === 'End') n = enabled[enabled.length - 1];
    if (!n) return;
    e.preventDefault();
    onChange(n.id);
    const id = n.id;
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus());
  };
  return (
    <div className={cx('tabs', size === 'sm' && 'tabs--sm', className)}>
      <div ref={ref} role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKey}>
        {items.map((t) => {
          const on = t.id === value;
          return (
            <button key={t.id} type="button" role="tab" data-tab={t.id} id={`${idBase}-tab-${t.id}`} aria-selected={on} aria-controls={`${idBase}-panel-${t.id}`}
              tabIndex={on ? 0 : -1} disabled={t.disabled} className={cx('tabs__tab', on && 'is-on')} onClick={() => onChange(t.id)}>
              {t.icon && <t.icon size={16} strokeWidth={1.75} aria-hidden />}
              <span className="tabs__label">{t.label}</span>
              {t.count != null && <span className="tabs__count">{t.count}</span>}
              {t.badge != null && t.badge !== false && <span className="tabs__badge">{t.badge}</span>}
            </button>
          );
        })}
      </div>
      {end && <div className="tabs__end">{end}</div>}
    </div>
  );
}
