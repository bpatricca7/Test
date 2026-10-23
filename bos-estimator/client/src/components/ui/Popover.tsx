import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from '../lib/cx';
import { pushEscape } from '../lib/keys';
import { Portal, placeFloating, zoomFactor, type Placement } from './Portal';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface PopoverProps {
  open: boolean;
  /** the invoker: focus returns here on close; the popover is placed next to it */
  anchor: RefObject<HTMLElement | null> | HTMLElement | null;
  onClose: () => void;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  /** accessible name of the popup */
  label?: string;
  role?: 'dialog' | 'menu' | 'listbox' | 'group';
  /** 'first' focuses the first focusable child (default), 'none' leaves focus on the invoker, or a CSS selector */
  initialFocus?: 'first' | 'none' | string;
  /** min width = anchor width */
  matchWidth?: boolean;
  id?: string;
}

const anchorEl = (a: PopoverProps['anchor']) => (a && 'current' in (a as object) ? (a as RefObject<HTMLElement | null>).current : (a as HTMLElement | null));

/**
 * Popover (UI spec §5.12): --sh-pop, radius 8, rendered in #portal with data-occluder (so 3D labels avoid it).
 * Closes on Esc (menu layer of the Esc stack), outside pointer-down and window resize; returns focus to the invoker.
 */
export function Popover({ open, anchor, onClose, placement = 'bottom-start', children, className, label, role = 'dialog', initialFocus = 'first', matchWidth, id }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [minW, setMinW] = useState<number | undefined>(undefined);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  const place = useCallback(() => {
    const a = anchorEl(anchor); const el = ref.current;
    if (!a || !el) return;
    const ar = a.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPos(placeFloating(ar, { w: r.width, h: r.height }, placement, 6));
    if (matchWidth) setMinW(ar.width / zoomFactor());
  }, [anchor, placement, matchWidth]);

  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const ro = new ResizeObserver(() => place());
    if (ref.current) ro.observe(ref.current);
    const onResize = () => onCloseRef.current();
    window.addEventListener('resize', onResize);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorEl(anchor)?.contains(t)) return;
      onCloseRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    const pop = pushEscape(() => { onCloseRef.current(); return true; }, 'menu');
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize); window.removeEventListener('pointerdown', onDown, true); pop(); };
  }, [open, anchor, place]);

  // focus in on open, back to the invoker on close
  useEffect(() => {
    if (!open) return;
    const a = anchorEl(anchor);
    const raf = requestAnimationFrame(() => {
      const el = ref.current; if (!el || initialFocus === 'none') return;
      const target = initialFocus === 'first' ? el.querySelector<HTMLElement>(FOCUSABLE) : el.querySelector<HTMLElement>(initialFocus);
      (target ?? el).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      const active = document.activeElement;
      if (a && a.isConnected && (!active || active === document.body || ref.current?.contains(active) || !active.isConnected)) a.focus({ preventScroll: true });
    };
  }, [open, anchor, initialFocus]);

  if (!open) return null;
  return (
    <Portal>
      <div ref={ref} id={id} role={role} aria-label={label} tabIndex={-1} data-occluder="" className={cx('ui-pop', className)}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth: minW, visibility: pos ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </Portal>
  );
}

/** Small state helper: const pop = usePopover(); <button ref={pop.anchorRef} onClick={pop.toggle}/> <Popover {...pop.props}>… */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, setOpen, toggle, close, anchorRef, props: { open, onClose: close, anchor: anchorRef as RefObject<HTMLElement | null> } };
}
