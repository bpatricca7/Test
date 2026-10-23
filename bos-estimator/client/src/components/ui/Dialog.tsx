import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';
import { pushEscape } from '../lib/keys';
import { Button, IconButton, type ButtonVariant } from './Button';
import { Portal } from './Portal';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** short line under the title */
  subtitle?: ReactNode;
  /** header content after the title (search box, chips) */
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** CSS width/height, e.g. 'min(1180px,94vw)' */
  width?: string;
  height?: string;
  className?: string;
  /** CSS selector of the element to focus first (default: [data-autofocus], else the first focusable in the body, else the close button) */
  initialFocus?: string;
  role?: 'dialog' | 'alertdialog';
  dismissOnScrim?: boolean;
  /** no × button in the header */
  hideClose?: boolean;
}

/**
 * Dialog (UI spec §5.11): role=dialog aria-modal, focus trap, initial focus, Esc closes (dialog layer of the
 * Esc stack, which also blocks plain hotkeys), focus returns to the invoker, --scrim backdrop, radius 12, --sh-dialog.
 */
export function Dialog({ open, onClose, title, subtitle, headerExtra, children, footer, width, height, className, initialFocus, role = 'dialog', dismissOnScrim = true, hideClose }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const invoker = document.activeElement as HTMLElement | null;
    const pop = pushEscape(() => { onCloseRef.current(); return true; }, 'dialog');
    const raf = requestAnimationFrame(() => {
      const el = ref.current; if (!el) return;
      const target = (initialFocus && el.querySelector<HTMLElement>(initialFocus)) || el.querySelector<HTMLElement>('[data-autofocus]') || el.querySelector<HTMLElement>(`.ui-dialog__body ${FOCUSABLE}`) || el.querySelector<HTMLElement>(FOCUSABLE) || el;
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement) target.select();
    });
    return () => {
      cancelAnimationFrame(raf);
      pop();
      if (invoker && invoker.isConnected && invoker !== document.body) requestAnimationFrame(() => invoker.focus({ preventScroll: true }));
    };
  }, [open, initialFocus]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const els = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  const style: CSSProperties = { width, height };
  return (
    <Portal>
      <div className="ui-scrim" onPointerDown={(e) => { if (dismissOnScrim && e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('ui-dialog', className)} style={style} onKeyDown={onKeyDown}>
          <header className="ui-dialog__head">
            <div className="ui-dialog__titles">
              <h2 id={titleId} className="ui-dialog__title">{title}</h2>
              {subtitle && <div className="ui-dialog__subtitle">{subtitle}</div>}
            </div>
            {headerExtra}
            {!hideClose && <IconButton icon={X} label="Close" tooltip="Close (Esc)" onClick={onClose} className="ui-dialog__close" />}
          </header>
          <div className="ui-dialog__body">{children}</div>
          {footer && <footer className="ui-dialog__foot">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

export interface ConfirmAction { id: string; label: ReactNode; variant?: ButtonVariant; autoFocus?: boolean }
export interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  /** buttons left → right; the last one is the primary. Default: Cancel + Confirm */
  actions?: ConfirmAction[];
  confirmLabel?: ReactNode;
  danger?: boolean;
  width?: string;
}

/**
 * ConfirmDialog (UI spec §5.11): replaces every window.confirm. Resolves with the chosen action id, or null on
 * Esc / Cancel / scrim. Initial focus goes to the action marked autoFocus, else Cancel when the primary is
 * destructive, else the primary.
 */
export function ConfirmDialog({ open, title, body, actions, confirmLabel = 'Confirm', danger, width = 'min(520px, 92vw)', onResolve }: ConfirmOptions & { open: boolean; onResolve: (id: string | null) => void }) {
  const acts: ConfirmAction[] = actions ?? [{ id: 'cancel', label: 'Cancel', variant: 'secondary' }, { id: 'confirm', label: confirmLabel, variant: danger ? 'danger' : 'primary' }];
  const primary = acts[acts.length - 1];
  const focusId = acts.find((a) => a.autoFocus)?.id ?? (primary.variant === 'danger' ? acts.find((a) => a.id === 'cancel')?.id ?? primary.id : primary.id);
  return (
    <Dialog open={open} onClose={() => onResolve(null)} title={title} width={width} role="alertdialog" className="ui-confirm" initialFocus={`[data-action="${focusId}"]`}
      footer={acts.map((a) => <Button key={a.id} data-action={a.id} variant={a.variant ?? 'secondary'} onClick={() => onResolve(a.id === 'cancel' ? null : a.id)}>{a.label}</Button>)}>
      {typeof body === 'string' ? <p className="ui-confirm__body">{body}</p> : body}
    </Dialog>
  );
}
