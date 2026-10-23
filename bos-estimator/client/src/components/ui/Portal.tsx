import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders into #portal (inside .chrome, so dialogs, menus and toasts inherit --ui-zoom).
 * Falls back to document.body before the shell has mounted.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : document.getElementById('portal')));
  useEffect(() => { if (!host) setHost(document.getElementById('portal') ?? document.body); }, [host]);
  return host ? createPortal(children, host) : null;
}

/** Current UI zoom (the --ui-zoom value on :root). Floating elements inside .chrome divide viewport px by it. */
export function zoomFactor(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom'));
  return z > 0 ? z : 1;
}

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top' | 'right-start' | 'left-start';

/**
 * Position a floating box of `size` (viewport px) next to `anchor` (a getBoundingClientRect), flipping to the
 * other side when there is no room and clamping inside the window with an 8 px margin.
 * Returns CSS left/top for a position:fixed element inside the zoomed chrome (already divided by the zoom).
 */
export function placeFloating(anchor: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }, size: { w: number; h: number }, placement: Placement = 'bottom-start', gap = 6): { left: number; top: number; placement: Placement } {
  const W = window.innerWidth, H = window.innerHeight, m = 8;
  let p = placement;
  const vert = p.startsWith('bottom') || p.startsWith('top');
  let left = 0, top = 0;
  if (vert) {
    if (p.startsWith('bottom') && anchor.bottom + gap + size.h > H - m && anchor.top - gap - size.h >= m) p = p.replace('bottom', 'top') as Placement;
    else if (p.startsWith('top') && anchor.top - gap - size.h < m && anchor.bottom + gap + size.h <= H - m) p = p.replace('top', 'bottom') as Placement;
    top = p.startsWith('bottom') ? anchor.bottom + gap : anchor.top - gap - size.h;
    left = p.endsWith('-end') ? anchor.right - size.w : p.endsWith('-start') ? anchor.left : anchor.left + anchor.width / 2 - size.w / 2;
  } else {
    if (p === 'right-start' && anchor.right + gap + size.w > W - m) p = 'left-start';
    else if (p === 'left-start' && anchor.left - gap - size.w < m) p = 'right-start';
    left = p === 'right-start' ? anchor.right + gap : anchor.left - gap - size.w;
    top = anchor.top;
  }
  left = Math.max(m, Math.min(left, W - m - size.w));
  top = Math.max(m, Math.min(top, H - m - size.h));
  const z = zoomFactor();
  return { left: left / z, top: top / z, placement: p };
}
