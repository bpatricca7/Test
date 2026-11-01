// Responsive layout (mobile contract): the SHELL keeps store.layoutMode in sync with the window and mirrors it onto
// :root[data-layout] so CSS and portaled overlays can follow it. The scene reads layoutMode and never writes it.
//   phone   width < 768, or a short landscape window (height < 540 and width < 1280)
//   tablet  768–1279
//   desktop ≥ 1280 (unchanged)
import { useLayoutEffect } from 'react';
import { PHONE_QUERY, TABLET_QUERY, layoutModeFor, useStore, type LayoutMode } from '../../store';

const root = () => (typeof document === 'undefined' ? null : document.documentElement);
const orientation = () => (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');

function apply(mode: LayoutMode) {
  const r = root(); if (!r) return;
  r.dataset.layout = mode;
  r.dataset.orientation = orientation();
}

// first paint already carries the right attribute (the store computed the mode from the window at startup)
if (typeof window !== 'undefined') apply(useStore.getState().layoutMode);

/** Keeps store.layoutMode (and :root[data-layout], [data-orientation]) in sync from matchMedia. Mount once. */
export function useLayoutModeSync() {
  useLayoutEffect(() => {
    let phone: MediaQueryList | null = null, tablet: MediaQueryList | null = null;
    const sync = () => {
      const mode: LayoutMode = phone && tablet
        ? (phone.matches ? 'phone' : tablet.matches ? 'tablet' : 'desktop')
        : layoutModeFor(window.innerWidth, window.innerHeight);
      apply(mode);
      useStore.getState().setLayoutMode(mode);
    };
    try { phone = window.matchMedia(PHONE_QUERY); tablet = window.matchMedia(TABLET_QUERY); } catch { /* no matchMedia: window size */ }
    sync();
    phone?.addEventListener('change', sync);
    tablet?.addEventListener('change', sync);
    // orientation flips inside one mode (phone portrait ↔ landscape) change no query above
    window.addEventListener('resize', sync);
    return () => { phone?.removeEventListener('change', sync); tablet?.removeEventListener('change', sync); window.removeEventListener('resize', sync); };
  }, []);
}

export const useLayoutMode = () => useStore((s) => s.layoutMode);
export const useIsPhone = () => useStore((s) => s.layoutMode === 'phone');
/** True on a touch-first device (coarse primary pointer): no drag-and-drop of files, no hover. */
export const isCoarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
