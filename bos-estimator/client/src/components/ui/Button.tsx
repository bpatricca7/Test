import type { ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx';
import { Tooltip } from './Tooltip';
import { Kbd } from './Kbd';
import type { Placement } from './Portal';

export type IconType = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconType;
  /** trailing icon (e.g. ChevronDown on a menu button) */
  iconEnd?: IconType;
  /** shortcut hint shown inside the button, e.g. "V" */
  kbd?: string;
  /** toggle state (renders aria-pressed and the "on" style) */
  pressed?: boolean;
  tooltip?: ReactNode;
  tooltipPlacement?: Placement;
  block?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Button (UI spec §5.12): 32 px (sm 26); primary, secondary, ghost, danger. */
export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconEnd: IconEnd, kbd, pressed, tooltip, tooltipPlacement, block, className, children, type = 'button', ...rest }: ButtonProps) {
  const btn = (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', block && 'btn--block', pressed && 'is-on', !children && Icon && 'btn--icon-only', className)}
      aria-pressed={pressed === undefined ? undefined : pressed}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden />}
      {children != null && children !== false && <span className="btn__label">{children}</span>}
      {kbd && <Kbd combo={kbd} />}
      {IconEnd && <IconEnd size={14} strokeWidth={1.75} aria-hidden className="btn__end" />}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip} placement={tooltipPlacement}>{btn}</Tooltip> : btn;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconType;
  /** accessible name; also the tooltip unless `tooltip` is given */
  label: string;
  tooltip?: ReactNode | false;
  tooltipPlacement?: Placement;
  size?: 'md' | 'sm';
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  pressed?: boolean;
  /** small badge in the top-right corner (count or dot) */
  badge?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** IconButton (UI spec §5.12): 32×32, icon 16 at stroke 1.75. */
export function IconButton({ icon: Icon, label, tooltip, tooltipPlacement = 'bottom', size = 'md', variant = 'ghost', pressed, badge, className, type = 'button', ...rest }: IconButtonProps) {
  const btn = (
    <button type={type} aria-label={label} aria-pressed={pressed === undefined ? undefined : pressed}
      className={cx('icon-btn', `icon-btn--${variant}`, size === 'sm' && 'icon-btn--sm', pressed && 'is-on', className)} {...rest}>
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} aria-hidden />
      {badge != null && badge !== false && <span className="icon-btn__badge">{badge}</span>}
    </button>
  );
  return tooltip === false ? btn : <Tooltip content={tooltip ?? label} placement={tooltipPlacement}>{btn}</Tooltip>;
}
