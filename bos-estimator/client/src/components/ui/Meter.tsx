import { cx } from '../lib/cx';

/** Thin progress meter (review progress "Reviewed 214/370", 64 px by default). */
export function Meter({ value, max, width = 64, tone = 'ok', label, className }: { value: number; max: number; width?: number; tone?: 'ok' | 'accent' | 'warn'; label?: string; className?: string }) {
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={cx('meter', `meter--${tone}`, className)} style={{ width }} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="meter__fill" style={{ width: `${p * 100}%` }} />
    </span>
  );
}
