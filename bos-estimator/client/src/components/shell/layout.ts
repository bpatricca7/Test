// Shell layout plumbing (UI spec §2.2, §4): the insets writer, UI zoom, reduced-motion attribute,
// the minimum free rect and the panel auto-open rules.

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useStore, type UiZoom } from '../../store';

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface InsetsEvent extends Insets { animating: boolean }

/** Effective zoom for a UiZoom setting: auto = 1.125 at ≥ 2400 px wide, else 1. */
export function effectiveZoom(z: UiZoom, width = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  return z === 'auto' ? (width >= 2400 ? 1.125 : 1) : z;
}

/** Writes --ui-zoom on :root (applied as `zoom` on .chrome only; the canvas and label layer are never zoomed). */
export function useUiZoomWriter() {
  const uiZoom = useStore((s) => s.uiZoom);
  useLayoutEffect(() => {
    const apply = () => document.documentElement.style.setProperty('--ui-zoom', String(effectiveZoom(uiZoom)));
    apply();
    if (uiZoom !== 'auto') return;
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [uiZoom]);
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
  useLayoutEffect(() => {
    const el = vpRef.current; if (!el) return;
    const root = document.documentElement;
    let last: Insets = { top: -1, right: -1, bottom: -1, left: -1 };
    let lastAnimating: boolean | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const measure = (): Insets => {
      const r = el.getBoundingClientRect(); // already includes CSS zoom and running track transitions
      return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) };
    };
    const publish = (animating: boolean) => {
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
      const r = el.getBoundingClientRect();
      const z = parseFloat(getComputedStyle(root).getPropertyValue('--ui-zoom')) || 1;
      const w = r.width / z, h = r.height / z;
      if (w >= 320 && h >= 240) return;
      const s = useStore.getState();
      if (h < 240 && s.bottomOpen) { s.setBottomOpen(false, { auto: true }); return; }
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
    const chrome = chromeRef.current;
    chrome?.addEventListener('transitionrun', onChange);
    chrome?.addEventListener('transitionend', onChange);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onChange);
      chrome?.removeEventListener('transitionrun', onChange);
      chrome?.removeEventListener('transitionend', onChange);
      if (settle) clearTimeout(settle);
    };
  }, [vpRef, chromeRef]);
}

/**
 * Panel defaults (UI spec §4.1): the right panel opens on the first facility (unless the user collapsed it) and
 * when something is selected; the dock collapses below 860 px of window height at load.
 */
export function usePanelAutoRules() {
  const count = useStore((s) => (s.project ? s.project.inventory.facilities.length + s.project.inventory.grounds.length : 0));
  const selKind = useStore((s) => s.selection.kind);
  useEffect(() => {
    const s = useStore.getState();
    if (count > 0 && !s.rightOpen && !s.rightUserCollapsed) s.setRightOpen(true);
  }, [count > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = useStore.getState();
    if (selKind && !s.rightOpen && !s.rightUserCollapsed) s.setRightOpen(true);
  }, [selKind]);
}
