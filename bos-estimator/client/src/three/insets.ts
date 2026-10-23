// Free-rect insets published by the shell (UI spec §2.2). The shell is the single writer: it sets
// --inset-top/right/bottom/left on :root and dispatches `bos:insets`. The scene reads them through a ref,
// never React state, so a panel animation never re-renders the 3D tree.
import { useRef, type MutableRefObject } from 'react';

export interface ViewInsets { top: number; right: number; bottom: number; left: number; animating: boolean }

const readVar = (name: string): number => {
  try { return Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0); } catch { return 0; }
};

/** Shared, mutable insets (module singleton). `version` increments on every change. */
export const insets: ViewInsets & { version: number; fromEvent: boolean } = { top: 0, right: 0, bottom: 0, left: 0, animating: false, version: 0, fromEvent: false };

const listeners = new Set<() => void>();
export function onInsetsChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

function set(next: Partial<ViewInsets>) {
  let changed = false;
  for (const k of ['top', 'right', 'bottom', 'left'] as const) {
    const v = next[k];
    if (typeof v === 'number' && isFinite(v) && v !== insets[k]) { insets[k] = Math.max(0, v); changed = true; }
  }
  if (typeof next.animating === 'boolean' && next.animating !== insets.animating) { insets.animating = next.animating; changed = true; }
  if (changed) { insets.version++; for (const fn of listeners) fn(); }
}

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
