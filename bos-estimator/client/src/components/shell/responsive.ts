// Responsive layout (mobile contract): the SHELL keeps store.layoutMode in sync with the window and mirrors it onto
// :root[data-layout] so CSS and portaled overlays can follow it. The scene reads layoutMode and never writes it.
//   phone   width < 768, or a phone on its side (touch-first, short screen, landscape, width < 1280)
//   tablet  768–1279
//   desktop ≥ 1280 (unchanged)
// The mode and the orientation never change while a text field has focus or an on-screen keyboard is up: a keyboard
// that shortens the window would otherwise remount the shell under the field being edited (and close the keyboard).
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { PHONE_QUERY, TABLET_QUERY, detectLayoutMode, tallestWindowHeight, useStore, type LayoutMode } from '../../store';

export type Orientation = 'portrait' | 'landscape';
const root = () => (typeof document === 'undefined' ? null : document.documentElement);
const readOrientation = (): Orientation => (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');

/** Text entry that raises an on-screen keyboard (not checkboxes, ranges, buttons or selects). */
export const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color]):not([readonly]), textarea:not([readonly]), [contenteditable=""], [contenteditable="true"]';
export const isEditable = (el: Element | null | undefined): el is HTMLElement => !!el && el instanceof HTMLElement && el.matches(EDITABLE);
const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
/** An on-screen keyboard is (probably) up: it covers the visual viewport (iOS, Chrome's default), or it shortened the
 * window of a touch device at an unchanged width (Firefox for Android, installed apps, resizes-content). */
export function keyboardLikelyUp(): boolean {
  if (typeof window === 'undefined') return false;
  const vv = window.visualViewport;
  if (vv && vv.height * vv.scale < window.innerHeight - 100) return true;
  return coarse() && window.innerHeight < tallestWindowHeight() - 120;
}

// ---- orientation as a tiny external store (the phone chrome lays out by it; frozen with the mode) ----
let orientation: Orientation = typeof window === 'undefined' ? 'portrait' : readOrientation();
const orientationListeners = new Set<() => void>();
const subscribeOrientation = (fn: () => void) => { orientationListeners.add(fn); return () => { orientationListeners.delete(fn); }; };
/** Portrait or landscape, as :root[data-orientation] shows it (frozen while a keyboard is up). */
export const useOrientation = () => useSyncExternalStore(subscribeOrientation, () => orientation, () => orientation);

function apply(mode: LayoutMode, ori: Orientation) {
  const r = root(); if (!r) return;
  r.dataset.layout = mode;
  r.dataset.orientation = ori;
  if (ori !== orientation) { orientation = ori; for (const fn of orientationListeners) fn(); }
}

// first paint already carries the right attribute (the store computed the mode from the window at startup)
if (typeof window !== 'undefined') apply(useStore.getState().layoutMode, orientation);

/** Keeps store.layoutMode (and :root[data-layout], [data-orientation]) in sync with the window. Mount once. */
export function useLayoutModeSync() {
  useLayoutEffect(() => {
    let blurAt = -Infinity;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // (touch devices only: a mouse-and-keyboard window has no on-screen keyboard to wait for)
    const frozen = () => keyboardLikelyUp() || (coarse() && (isEditable(document.activeElement) || performance.now() - blurAt < 900));
    const sync = () => {
      const mode = detectLayoutMode();
      const ori = readOrientation();
      const s = useStore.getState();
      if (mode === s.layoutMode && ori === orientation) return;
      // a text field is being edited, or its keyboard is still on its way out: keep the layout, look again later
      if (frozen()) { if (!retry) retry = setTimeout(() => { retry = null; sync(); }, 400); return; }
      apply(mode, ori);
      s.setLayoutMode(mode);
    };
    const onFocusOut = () => { if (!coarse()) return; blurAt = performance.now(); if (retry) clearTimeout(retry); retry = setTimeout(() => { retry = null; sync(); }, 950); };
    let phone: MediaQueryList | null = null, tablet: MediaQueryList | null = null;
    try { phone = window.matchMedia(PHONE_QUERY); tablet = window.matchMedia(TABLET_QUERY); } catch { /* no matchMedia: resize only */ }
    // startup: nothing is focused yet, apply as computed
    { const mode = detectLayoutMode(); apply(mode, readOrientation()); useStore.getState().setLayoutMode(mode); }
    phone?.addEventListener('change', sync);
    tablet?.addEventListener('change', sync);
    // a phone turning on its side changes no width query; neither does the coarse / screen part of the phone rule
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    document.addEventListener('focusout', onFocusOut, true);
    return () => {
      phone?.removeEventListener('change', sync); tablet?.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      document.removeEventListener('focusout', onFocusOut, true);
      if (retry) clearTimeout(retry);
    };
  }, []);
}

export const useLayoutMode = () => useStore((s) => s.layoutMode);
export const useIsPhone = () => useStore((s) => s.layoutMode === 'phone');
/** True on a touch-first device (coarse primary pointer): no drag-and-drop of files, no hover. */
export const isCoarse = () => coarse();
