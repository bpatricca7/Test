import { useCallback, useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';
import { cx } from '../lib/cx';
import { checkNumber, formatMoney, formatNumber, parseArea, parseMoney, parseNumber, type NumberRule, type ParseResult } from '../lib/parse';
import type { AreaUnit } from '@shared/types';
import { Portal, placeFloating } from './Portal';

export interface NumFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue' | 'size'> {
  value: number | undefined | null;
  /**
   * Called exactly once per commit (Enter, Tab or blur) when the value changed. `undefined` means "cleared"
   * (only for optional fields). `meta.unit/printed` are set when an area was typed in another unit (P1).
   */
  onCommit: (v: number | undefined, meta?: { unit?: AreaUnit; printed?: number }) => void;
  /** a required field reverts on blank instead of committing undefined */
  required?: boolean;
  rule?: NumberRule;
  /** 'area' also accepts "4,320 m²"; 'percent' shows ×100 and stores ÷100; 'money' shows $48,500,000 at rest */
  kind?: 'number' | 'area' | 'percent' | 'money';
  /** display at rest (default: grouped, up to `decimals`) */
  format?: (v: number) => string;
  decimals?: number;
  suffix?: ReactNode;
  size?: 'md' | 'sm';
  align?: 'left' | 'right';
  /** extra validation after parsing; return an error message to block the commit */
  validate?: (v: number | undefined) => string | null;
  /** style as overridden (--edit border) */
  overridden?: boolean;
  /** class on the wrapper span */
  wrapClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * NumField (UI spec §5.12): holds a local draft string, commits on Enter / Tab / blur, Esc reverts.
 * Blank while typing is fine; blank on commit is undefined (optional) or a revert (required), never 0.
 * Accepts "46,500", "46.5k", "1.2M". Invalid input shows a --bad ring and an inline message and does not commit.
 * Exactly one onCommit call per commit, and none when the value did not change.
 */
export function NumField({ value, onCommit, required, rule, kind = 'number', format, decimals = 2, suffix, size = 'md', align = 'right', validate, overridden, className, wrapClassName, onKeyDown, onBlur, onFocus, ref, ...rest }: NumFieldProps) {
  const toText = useCallback((v: number | undefined | null, focused: boolean): string => {
    if (v == null || !Number.isFinite(v)) return '';
    if (kind === 'percent') return formatNumber(v * 100, decimals);
    if (kind === 'money') return focused ? String(v) : formatMoney(v);
    return format && !focused ? format(v) : formatNumber(v, decimals);
  }, [kind, decimals, format]);
  const [draft, setDraft] = useState(() => toText(value, false));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const dirty = useRef(false);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const setRefs = useCallback((el: HTMLInputElement | null) => {
    inputEl.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
  }, [ref]);

  // external value changes show up unless the user is mid-edit
  useEffect(() => { if (!dirty.current) { setDraft(toText(value, focused.current)); setError(null); } }, [value, toText]);

  const parse = (s: string): ParseResult & { unit?: AreaUnit; printed?: number } => {
    if (kind === 'area') return parseArea(s);
    if (kind === 'money') return parseMoney(s);
    const r = parseNumber(s);
    if (r.ok && kind === 'percent' && r.value !== undefined) return { ok: true, value: r.value / 100 };
    return r;
  };

  /** Validates and commits the draft. Returns false (and shows the error) when it is invalid. */
  const commit = (stayFocused: boolean): boolean => {
    const r = parse(draft);
    if (!r.ok) { setError(r.error); return false; }
    let v = r.value;
    if (v === undefined && required) { dirty.current = false; setError(null); setDraft(toText(value, stayFocused)); return true; }
    const msg = v !== undefined ? (checkNumber(v, rule) ?? validate?.(v) ?? null) : (validate?.(undefined) ?? null);
    if (msg) { setError(msg); return false; }
    if (v !== undefined && rule?.integer) v = Math.round(v);
    dirty.current = false;
    setError(null);
    const same = v === undefined ? value == null : value != null && Math.abs(v - value) < 1e-9;
    if (!same) onCommit(v, r.unit ? { unit: r.unit, printed: r.printed } : undefined);
    setDraft(toText(same ? value : v, stayFocused));
    return true;
  };

  return (
    <span className={cx('numfield-wrap', size === 'sm' && 'numfield-wrap--sm', suffix != null && 'has-suffix', wrapClassName)}>
      <input
        ref={setRefs}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className={cx('input', 'numfield', size === 'sm' && 'input--sm', align === 'right' && 'is-right', error && 'is-invalid', overridden && 'is-overridden', className)}
        value={draft}
        onChange={(e) => { dirty.current = true; setDraft(e.target.value); if (error) setError(null); }}
        onFocus={(e) => {
          focused.current = true;
          if (!dirty.current && kind === 'money') setDraft(toText(value, true));
          const t = e.currentTarget; requestAnimationFrame(() => { if (document.activeElement === t) t.select(); });
          onFocus?.(e);
        }}
        onBlur={(e) => { focused.current = false; if (dirty.current || error) commit(false); else setDraft(toText(value, false)); onBlur?.(e); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          else if (e.key === 'Escape') {
            if (dirty.current || error) { e.preventDefault(); e.stopPropagation(); }
            dirty.current = false; setError(null); setDraft(toText(value, true));
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
      {suffix != null && <span className="numfield__suffix" aria-hidden>{suffix}</span>}
      {error && <ErrorBubble anchor={inputEl} message={error} />}
    </span>
  );
}

function ErrorBubble({ anchor, message }: { anchor: RefObject<HTMLElement | null>; message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current, el = ref.current; if (!a || !el) return;
    const r = el.getBoundingClientRect();
    setPos(placeFloating(a.getBoundingClientRect(), { w: r.width, h: r.height }, 'bottom-start', 4));
  }, [anchor, message]);
  return <Portal><div ref={ref} role="alert" className="ui-tooltip ui-tooltip--error" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>{message}</div></Portal>;
}

/** MoneyInput (UI spec §5.12): "$48,500,000" at rest, the raw number while focused; accepts 48.5M, 485k, $48,500,000. */
export function MoneyInput(props: Omit<NumFieldProps, 'kind'>) {
  return <NumField {...props} kind="money" />;
}
