import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { IconType } from './Button';
import { Tooltip } from './Tooltip';

export interface SegOption<T extends string> { value: T; label: ReactNode; icon?: IconType; disabled?: boolean; tooltip?: ReactNode; kbd?: string }

/**
 * Segmented control (UI spec §5.12): one choice out of 2–4, 32 px (sm 26). Arrow keys move the choice.
 * `iconOnly` hides the labels (they stay as the accessible name and tooltip).
 */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', iconOnly, label, className, block }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; size?: 'md' | 'sm'; iconOnly?: boolean; label: string; className?: string; block?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const n = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    if (n) { onChange(n.value); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-value="${n.value}"]`)?.focus()); }
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cx('seg', size === 'sm' && 'seg--sm', block && 'seg--block', className)} onKeyDown={onKey}>
      {options.map((o) => {
        const on = o.value === value;
        const b = (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-value={o.value} tabIndex={on ? 0 : -1} disabled={o.disabled}
            aria-label={iconOnly && typeof o.label === 'string' ? o.label : undefined}
            className={cx('seg__opt', on && 'is-on')} onClick={() => onChange(o.value)}>
            {o.icon && <o.icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden />}
            {!iconOnly && <span>{o.label}</span>}
          </button>
        );
        const tip = o.tooltip ?? (iconOnly ? o.label : undefined);
        return tip ? <Tooltip key={o.value} content={tip} placement="bottom">{b}</Tooltip> : b;
      })}
    </div>
  );
}
