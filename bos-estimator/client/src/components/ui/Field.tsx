import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

/**
 * Field grid (UI spec §5.12): `repeat(2, minmax(0,1fr))`, three columns only in a container ≥ 380 px
 * (`cols={3}`), one column below 240 px. Every control inside gets min-width:0; width:100%.
 */
export function Fields({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  return <div className={cx('fields-wrap')}><div className={cx('fields', cols === 3 && 'fields--3', cols === 1 && 'fields--1', className)}>{children}</div></div>;
}

/**
 * One labelled field: label (12.5/500 --text-2, one line) above the control. `span="full"` spans the row.
 * Pass the control as children; its id comes from `htmlFor` or the render-prop form `children(id)`.
 */
export function Field({ label, children, span, hint, error, className, htmlFor }: { label: ReactNode; children: ReactNode | ((id: string) => ReactNode); span?: 'full' | 2; hint?: ReactNode; error?: ReactNode; className?: string; htmlFor?: string }) {
  const auto = useId();
  const id = htmlFor ?? auto;
  return (
    <div className={cx('field', span && 'field--full', error ? 'has-error' : undefined, className)}>
      <label className="field__label" htmlFor={id}>{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <div className="field__error" role="alert">{error}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue' | 'size'> {
  value: string | undefined;
  /** called once per commit (Enter, Tab or blur) when the text changed; Esc reverts */
  onCommit: (v: string) => void;
  /** commit on every keystroke instead (search boxes) */
  live?: boolean;
  size?: 'md' | 'sm';
  ref?: Ref<HTMLInputElement>;
}

/** Text input that commits on Enter / Tab / blur (never per keystroke unless `live`); Esc reverts. */
export function TextField({ value, onCommit, live, size = 'md', className, onKeyDown, onBlur, ref, ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value ?? '');
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value ?? ''); }, [value]);
  const commit = () => { editing.current = false; if (draft !== (value ?? '')) onCommit(draft); };
  return (
    <input ref={ref} className={cx('input', size === 'sm' && 'input--sm', className)} value={draft}
      onChange={(e) => { editing.current = true; setDraft(e.target.value); if (live) onCommit(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); }
        else if (e.key === 'Escape') { if (draft !== (value ?? '')) { e.stopPropagation(); e.preventDefault(); } editing.current = false; setDraft(value ?? ''); }
        onKeyDown?.(e);
      }}
      onBlur={(e) => { if (!live) commit(); else editing.current = false; onBlur?.(e); }}
      {...rest} />
  );
}

export interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean }
export interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'size'> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (v: T) => void;
  size?: 'md' | 'sm';
  ref?: Ref<HTMLSelectElement>;
}

/** Native select, 32 px (sm 26), min-width 0 / width 100%. One store write per change. */
export function Select<T extends string>({ value, options, onChange, size = 'md', className, ref, ...rest }: SelectProps<T>) {
  return (
    <select ref={ref} className={cx('select', size === 'sm' && 'select--sm', className)} value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}

/** Switch: role=switch with a visible label. */
export function Toggle({ checked, onChange, label, disabled, size = 'md', className, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; size?: 'md' | 'sm'; className?: string; hint?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx('toggle', size === 'sm' && 'toggle--sm', checked && 'is-on', className)} onClick={() => onChange(!checked)}>
      <span className="toggle__track" aria-hidden><span className="toggle__thumb" /></span>
      <span className="toggle__label">{label}{hint && <span className="toggle__hint">{hint}</span>}</span>
    </button>
  );
}

/** Checkbox with label (scope toggles, bulk selection). */
export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={cx('checkbox', disabled && 'is-disabled', className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
