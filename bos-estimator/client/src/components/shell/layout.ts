// Shell layout plumbing (UI spec §2.2, §4): the insets writer, UI zoom, reduced-motion attribute,
// the minimum free rect and the panel auto-open rules.

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useStore, type UiZoom } from '../../store';
import { KB_EVENT, keyboardOpen } from './keyboard';

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface InsetsEvent extends Insets { animating: boolean }

/** Effective zoom for a UiZoom setting: auto = 1.125 at ≥ 2400 px wide, else 1. */
export function effectiveZoom(z: UiZoom, width = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  return z === 'auto' ? (width >= 2400 ? 1.125 : 1) : z;
}

/** Writes --ui-zoom on :root (applied as `zoom` on .chrome only; the canvas and label layer are never zoomed).
 * Phones always run at 100 % (their type scale is set for the hand, and a zoomed chrome would not fit). */
export function useUiZoomWriter() {
  const uiZoom = useStore((s) => s.uiZoom);
  const phone = useStore((s) => s.layoutMode === 'phone');
  useLayoutEffect(() => {
    const apply = () => document.documentElement.style.setProperty('--ui-zoom', String(phone ? 1 : effectiveZoom(uiZoom)));
    apply();
    if (uiZoom !== 'auto' || phone) return;
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [uiZoom, phone]);
}

/** Mirrors the reduced-motion choice (OS or the ⋯ menu) onto :root[data-reduced-motion] so the --dur-* tokens drop to 0. */
export function useReducedMotionAttr() {
  const reduced = useStore((s) => s.reducedMotion);
  useLayoutEffect(() => { document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false'; }, [reduced]);
}

/**
 * The single writer of --inset-* (UI spec §2.2). ResizeObserver on .vp-area plus window resize and the chrome's
 * grid transitions. Publishes integer px from the window edges to the free rect, and a `bos:insets` event with
 * `animating: true` while changes keep coming, then one final `animating: false` 150 ms after the last change.
 * After the final event it enforces the 320 × 240 minimum free rect (collapse bottom, then left, then right).
 */
export function useInsetsWriter(vpRef: RefObject<HTMLElement | null>, chromeRef: RefObject<HTMLElement | null>) {
  // the phone and desktop chromes mount different .vp-area elements: re-attach when the layout mode changes
  const mode = useStore((s) => s.layoutMode);
  useLayoutEffect(() => {
    const el = vpRef.current; if (!el) return;
    const root = document.documentElement;
    let last: Insets = { top: -1, right: -1, bottom: -1, left: -1 };
    let lastAnimating: boolean | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const measure = (): Insets => {
      // already includes CSS zoom, running track transitions and the tablet drawers' margin slide
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) };
    };
    const publish = (animating: boolean) => {
      // phone: while the on-screen keyboard is open the map is hidden behind the sheet (or the window is shortened
      // for a moment); the camera keeps its framing and the rect is published again once the keyboard closes
      if (keyboardOpen()) return;
      const i = measure();
      const changed = i.top !== last.top || i.right !== last.right || i.bottom !== last.bottom || i.left !== last.left;
      if (changed) {
        root.style.setProperty('--inset-top', `${i.top}px`);
        root.style.setProperty('--inset-right', `${i.right}px`);
        root.style.setProperty('--inset-bottom', `${i.bottom}px`);
        root.style.setProperty('--inset-left', `${i.left}px`);
        last = i;
      }
      if (changed || animating !== lastAnimating) {
        lastAnimating = animating;
        window.dispatchEvent(new CustomEvent<InsetsEvent>('bos:insets', { detail: { ...i, animating } }));
      }
    };
    const enforceMinimum = () => {
      const mode = useStore.getState().layoutMode;
      // phones size the map around the sheet; tablet drawers are opened and closed by the user (one at a time
      // below 1024 px, see useTabletDrawers), never auto-closed for room
      if (mode === 'phone') return;
      const r = el.getBoundingClientRect();
      const z = parseFloat(getComputedStyle(root).getPropertyValue('--ui-zoom')) || 1;
      const w = r.width / z, h = r.height / z;
      if (w >= 320 && h >= 240) return;
      const s = useStore.getState();
      if (h < 240 && s.bottomOpen) { s.setBottomOpen(false, { auto: true }); return; }
      if (mode === 'tablet') return;
      if (w < 320 && s.leftOpen) { s.setLeftOpen(false); return; }
      if (w < 320 && s.rightOpen) { s.setRightOpen(false); }
    };
    const onChange = () => {
      publish(true);
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { settle = null; publish(false); enforceMinimum(); }, 150);
    };

    publish(false);
    enforceMinimum();
    const ro = new ResizeObserver(onChange);
    ro.observe(el);
    window.addEventListener('resize', onChange);
    window.addEventListener(KB_EVENT, onChange);
    const chrome = chromeRef.current;
    chrome?.addEventListener('transitionrun', onChange);
    chrome?.addEventListener('transitionend', onChange);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onChange);
      window.removeEventListener(KB_EVENT, onChange);
      chrome?.removeEventListener('transitionrun', onChange);
      chrome?.removeEventListener('transitionend', onChange);
      if (settle) clearTimeout(settle);
    };
  }, [vpRef, chromeRef, mode]);
}

/**
 * Panel defaults (UI spec §4.1): the right panel opens on the first facility (unless the user collapsed it) and
 * when something is selected; the dock collapses below 860 px of window height at load.
 */
export function usePanelAutoRules() {
  const count = useStore((s) => (s.project ? s.project.inventory.facilities.length + s.project.inventory.grounds.length : 0));
  const selKind = useStore((s) => s.selection.kind);
  // phones have no side panels (the sheet follows the selection itself, see store.select)
  useEffect(() => {
    const s = useStore.getState();
    if (s.layoutMode === 'phone') return;
    if (count > 0 && !s.rightOpen && !s.rightUserCollapsed) s.setRightOpen(true);
  }, [count > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = useStore.getState();
    if (s.layoutMode === 'phone') return;
    if (selKind && !s.rightOpen && !s.rightUserCollapsed) s.setRightOpen(true);
  }, [selKind]);
}

/**
 * Tablet below 1024 px: the left and right panels are slide-over drawers and only one is open at a time. Opening one
 * closes the other (the right panel without marking it user-collapsed, so the next selection opens it again).
 */
export function useTabletDrawers() {
  useEffect(() => {
    const narrow = () => useStore.getState().layoutMode === 'tablet' && window.innerWidth < 1024;
    const off = useStore.subscribe((s, prev) => {
      if (!narrow()) return;
      if (s.leftOpen && !prev.leftOpen && s.rightOpen) s.setRightOpen(false);
      else if (s.rightOpen && !prev.rightOpen && s.leftOpen) s.setLeftOpen(false);
      // arriving here with both open (a rotation to portrait, a desktop window narrowed): the drawer gives way
      else if (s.leftOpen && s.rightOpen && s.layoutMode !== prev.layoutMode) s.setLeftOpen(false);
    });
    const onResize = () => { const s = useStore.getState(); if (narrow() && s.leftOpen && s.rightOpen) s.setLeftOpen(false); };
    window.addEventListener('resize', onResize);
    return () => { off(); window.removeEventListener('resize', onResize); };
  }, []);
}
