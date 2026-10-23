// Free-rect insets published by the shell (UI spec §2.2). The shell is the single writer: it sets
// --inset-top/right/bottom/left on :root and dispatches `bos:insets`. The scene reads them through a ref,
// never React state, so a panel animation never re-renders the 3D tree.
import { useRef, type MutableRefObject } from 'react';

export interface ViewInsets { top: number; right: number; bottom: number; left: number; animating: boolean }

const readVar = (name: string): number => {
  try { return Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0); } catch { return 0; }
};

/**
 * Shared, mutable insets (module singleton). `version` increments only when the free rect itself changes
 * (top, right, bottom or left); a change of `animating` alone bumps `animVersion` instead, so an event that
 * repeats the same rect never reads as a new free rect.
 */
export const insets: ViewInsets & { version: number; animVersion: number; fromEvent: boolean; rectAt: number } = { top: 0, right: 0, bottom: 0, left: 0, animating: false, version: 0, animVersion: 0, fromEvent: false, rectAt: 0 };

/**
 * True while a panel transition is really moving the free rect: `animating` is set and the rect changed within
 * the last 400 ms (a transition publishes every frame). An `animating: true` that repeats an unchanged rect
 * does not hold back refits, scissoring or the streaming growth check.
 */
export const insetsSettling = () => insets.animating && performance.now() - insets.rectAt < 400;

const listeners = new Set<() => void>();
const animListeners = new Set<() => void>();
/** Called when the free rect changes (not when only `animating` flips). */
export function onInsetsChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Called when `animating` flips (a panel transition starts or ends). */
export function onInsetsAnimating(fn: () => void): () => void { animListeners.add(fn); return () => { animListeners.delete(fn); }; }

function set(next: Partial<ViewInsets>) {
  let rect = false;
  for (const k of ['top', 'right', 'bottom', 'left'] as const) {
    const v = next[k];
    if (typeof v === 'number' && isFinite(v) && Math.max(0, v) !== insets[k]) { insets[k] = Math.max(0, v); rect = true; }
  }
  const anim = typeof next.animating === 'boolean' && next.animating !== insets.animating;
  if (anim) insets.animating = next.animating as boolean;
  if (rect) { insets.version++; insets.rectAt = performance.now(); for (const fn of listeners) fn(); }
  if (anim) { insets.animVersion++; for (const fn of animListeners) fn(); }
}

/** A key for the current free rect of a W×H canvas (camera fits remember the rect they were made for). */
export const rectKey = (W: number, H: number) => `${W}x${H}:${insets.top},${insets.right},${insets.bottom},${insets.left}`;

function readCss() {
  set({ top: readVar('--inset-top'), right: readVar('--inset-right'), bottom: readVar('--inset-bottom'), left: readVar('--inset-left') });
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  readCss();
  window.addEventListener('bos:insets', (e) => {
    const d = (e as CustomEvent<Partial<ViewInsets>>).detail ?? {};
    insets.fromEvent = true;
    set({ ...d, animating: Boolean(d.animating) });
  });
  // Until the shell publishes events, follow the CSS defaults (they change with breakpoints).
  window.addEventListener('resize', () => { if (!insets.fromEvent) readCss(); });
}

/** The free rect in viewport px for a canvas of size W×H. */
export function freeRect(W: number, H: number) {
  const x0 = Math.min(insets.left, W - 1), y0 = Math.min(insets.top, H - 1);
  const x1 = Math.max(x0 + 1, W - insets.right), y1 = Math.max(y0 + 1, H - insets.bottom);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function useViewInsets(): MutableRefObject<ViewInsets> {
  install();
  const ref = useRef<ViewInsets>(insets);
  ref.current = insets;
  return ref;
}

install();
