import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { Portal, placeFloating, type Placement } from './Portal';

type AnyProps = Record<string, unknown> & { onMouseEnter?: (e: SyntheticEvent) => void; onMouseLeave?: (e: SyntheticEvent) => void; onFocus?: (e: SyntheticEvent) => void; onBlur?: (e: SyntheticEvent) => void; onMouseDown?: (e: SyntheticEvent) => void };

/**
 * Tooltip (UI spec §5.12): 500 ms delay, 12.5 px text on --surface-3. Wraps exactly one element and adds hover
 * and focus handlers to it (no wrapper span, so flex and grid layouts are untouched). Keyboard focus shows it too.
 */
export function Tooltip({ content, children, placement = 'top', delay = 500, disabled }: { content: ReactNode; children: ReactElement; placement?: Placement; delay?: number; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const hide = () => { clear(); setAnchor(null); setPos(null); };
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
    onMouseEnter: (e: SyntheticEvent) => { p.onMouseEnter?.(e); show(e.currentTarget as Element); },
    onMouseLeave: (e: SyntheticEvent) => { p.onMouseLeave?.(e); hide(); },
    onFocus: (e: SyntheticEvent) => { p.onFocus?.(e); const el = e.currentTarget as Element; if (el.matches(':focus-visible')) show(el); },
    onBlur: (e: SyntheticEvent) => { p.onBlur?.(e); hide(); },
    onMouseDown: (e: SyntheticEvent) => { p.onMouseDown?.(e); hide(); },
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
