import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { Portal, placeFloating, type Placement } from './Portal';

type AnyProps = Record<string, unknown> & { onMouseEnter?: (e: SyntheticEvent) => void; onMouseLeave?: (e: SyntheticEvent) => void; onFocus?: (e: SyntheticEvent) => void; onBlur?: (e: SyntheticEvent) => void; onMouseDown?: (e: SyntheticEvent) => void;
  onPointerDown?: (e: PointerEvent) => void; onPointerUp?: (e: PointerEvent) => void; onPointerCancel?: (e: PointerEvent) => void };
/** touch: a press held this long shows the tooltip; it stays this long after the finger lifts */
const LONG_PRESS_MS = 450;
const TOUCH_LINGER_MS = 1600;
/** the compatibility mouse events a tap fires (mouseenter right after touchend) are not hover. Starts with no touch
 * at all, so a mouse resting on a control when the page loads still gets its hover tooltip. */
let lastTouch = -Infinity;
/** the last pointer pressed was a finger and no Tab key has moved focus since: focus that follows (a field committed
 * with the on-screen keyboard's Enter, a menu closing) is not keyboard navigation, so it shows no tooltip */
let touchFocus = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { touchFocus = e.pointerType === 'touch'; if (touchFocus) lastTouch = performance.now(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) touchFocus = false; }, true);
}
const fromTouch = () => performance.now() - lastTouch < 1200;
/** "tap" on a touch-first screen, else "click" (tooltip and hint wording) */
export const clickWord = () => { try { return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'tap' : 'click'; } catch { return 'click'; } };

/**
 * Tooltip (UI spec §5.12): 500 ms delay, 12.5 px text on --surface-3. Wraps exactly one element and adds hover
 * and focus handlers to it (no wrapper span, so flex and grid layouts are untouched). Keyboard focus shows it too.
 * Touch screens have no hover: a long press (450 ms) shows it, and it lingers 1.6 s after the finger lifts.
 */
export function Tooltip({ content, children, placement = 'top', delay = 500, disabled }: { content: ReactNode; children: ReactElement; placement?: Placement; delay?: number; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const pressed = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const hide = () => { clear(); pressed.current = false; setAnchor(null); setPos(null); };
  /** the finger lifted: a long-pressed tooltip lingers, a pending one is dropped */
  const release = () => { clear(); if (pressed.current) timer.current = setTimeout(hide, TOUCH_LINGER_MS); };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onScroll = () => hide();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); };
  }, [anchor]);
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const r = tipRef.current.getBoundingClientRect();
    setPos(placeFloating(anchor, { w: r.width, h: r.height }, placement, 6));
  }, [anchor, placement, content]);

  if (!isValidElement(children)) return children as unknown as ReactElement;
  const off = disabled || content == null || content === '';
  const p = children.props as AnyProps;
  const show = (el: Element, now = false) => { clear(); const go = () => setAnchor(el.getBoundingClientRect()); if (now) go(); else timer.current = setTimeout(go, delay); };
  // Always clone (same element type and key), so toggling `disabled` never remounts the child.
  const child = cloneElement(children as ReactElement<AnyProps>, off ? {} : {
    'aria-describedby': anchor ? id : (p['aria-describedby'] as string | undefined),
    onMouseEnter: (e: SyntheticEvent) => { p.onMouseEnter?.(e); if (!fromTouch()) show(e.currentTarget as Element); },
    onMouseLeave: (e: SyntheticEvent) => { p.onMouseLeave?.(e); hide(); },
    onFocus: (e: SyntheticEvent) => { p.onFocus?.(e); const el = e.currentTarget as Element; if (el.matches(':focus-visible') && !touchFocus) show(el); },
    onBlur: (e: SyntheticEvent) => { p.onBlur?.(e); hide(); },
    onMouseDown: (e: SyntheticEvent) => { p.onMouseDown?.(e); if (!pressed.current) hide(); },
    onPointerDown: (e: PointerEvent) => {
      p.onPointerDown?.(e);
      if (e.pointerType !== 'touch') return;
      const el = e.currentTarget as Element;
      clear(); pressed.current = false;
      timer.current = setTimeout(() => { pressed.current = true; setAnchor(el.getBoundingClientRect()); }, LONG_PRESS_MS);
    },
    onPointerUp: (e: PointerEvent) => { p.onPointerUp?.(e); if (e.pointerType === 'touch') release(); },
    onPointerCancel: (e: PointerEvent) => { p.onPointerCancel?.(e); if (e.pointerType === 'touch') release(); },
  });
  return (
    <>
      {child}
      {anchor && !off && (
        <Portal>
          <div ref={tipRef} id={id} role="tooltip" className="ui-tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>{content}</div>
        </Portal>
      )}
    </>
  );
}
