import type { ReactElement, ReactNode, Ref } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import type { IconType } from './Button';
import { Tooltip } from './Tooltip';

export type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'flag' | 'new' | 'edit' | 'ai';

/**
 * Chip (UI spec §5.12): 22 px, radius 4. Static (span) unless onClick is given; `selected` renders the
 * filter-chip "on" state (aria-pressed); `onRemove` adds a separate × button.
 */
export function Chip({ children, tone = 'neutral', icon: Icon, count, selected, onClick, onRemove, removeLabel = 'Remove', tooltip, className, dot, ref }: { children?: ReactNode; tone?: ChipTone; icon?: IconType; count?: ReactNode; selected?: boolean; onClick?: () => void; onRemove?: () => void; removeLabel?: string; tooltip?: ReactNode; className?: string; dot?: string; ref?: Ref<HTMLElement> }) {
  const body = (
    <>
      {dot && <span className="chip__dot" style={{ background: dot }} aria-hidden />}
      {Icon && <Icon size={12} strokeWidth={2} aria-hidden />}
      {children != null && <span className="chip__label">{children}</span>}
      {count != null && <span className="chip__count">{count}</span>}
    </>
  );
  const cls = cx('chip', `chip--${tone}`, selected && 'is-on', onClick && 'chip--btn', onRemove && 'chip--removable', className);
  const main = onClick
    ? <button type="button" ref={ref as Ref<HTMLButtonElement>} className={onRemove ? 'chip__main' : cls} aria-pressed={selected === undefined ? undefined : selected} onClick={onClick}>{body}</button>
    : null;
  const tipped = (el: ReactNode) => (tooltip && el ? <Tooltip content={tooltip}>{el as ReactElement}</Tooltip> : el);
  if (!onRemove) return <>{tipped(main ?? <span ref={ref as Ref<HTMLSpanElement>} className={cls}>{body}</span>)}</>;
  return (
    <span className={cls} ref={main ? undefined : (ref as Ref<HTMLSpanElement>)}>
      {main ? tipped(main) : body}
      <button type="button" aria-label={removeLabel} className="chip__x" onClick={onRemove}><X size={12} aria-hidden /></button>
    </span>
  );
}
