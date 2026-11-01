// Device and input context for the 3D view on touch screens (mobile contract). The SHELL owns `layoutMode` and
// `sheet` in the store; the scene only reads them, with a matchMedia fallback for builds where the contract is
// absent. Input mode follows the last pointer the user actually used, so a touch laptop with a mouse attached
// keeps the desktop behaviour while the mouse is in use.
import { useStore } from '../store';

export type LayoutMode = 'desktop' | 'tablet' | 'phone';
type Snap = 'closed' | 'peek' | 'half' | 'full';
interface ContractState { layoutMode?: LayoutMode; sheet?: { snap?: Snap; tab?: string } }

const mq = (q: string) => { try { return typeof window !== 'undefined' && window.matchMedia(q).matches; } catch { return false; } };
const fallbackMode = (): LayoutMode => (mq('(max-width: 767.98px), (max-height: 539.98px) and (max-width: 1279.98px)') ? 'phone' : mq('(max-width: 1279.98px)') ? 'tablet' : 'desktop');

/** layout mode from the store contract (SHELL keeps it in sync), else from the window size */
export const layoutModeOf = (s: unknown): LayoutMode => (s as ContractState).layoutMode ?? fallbackMode();
export const sheetSnapOf = (s: unknown): Snap => (s as ContractState).sheet?.snap ?? 'closed';
export const layoutModeNow = () => layoutModeOf(useStore.getState());
export const useLayoutMode = () => useStore((s) => layoutModeOf(s));
export const useSheetSnap = () => useStore((s) => sheetSnapOf(s));

/** a phone's on-screen keyboard is open (the shell sets :root[data-kb="open"]): the map is behind the sheet or the
 * window is briefly shorter, so the camera keeps its framing (no refits, no selection pans) until it closes */
export const keyboardUp = () => typeof document !== 'undefined' && document.documentElement.dataset.kb === 'open';

/** the primary pointer is coarse (a phone or tablet without a mouse) */
export const coarsePointer = () => mq('(pointer: coarse)');

export const input = {
  /** the last pointer the user pressed or moved was a finger */
  touch: false,
  /** performance.now() of the last touch pointer event */
  touchAt: 0,
};

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  input.touch = coarsePointer();
  const note = (e: PointerEvent) => {
    if (e.pointerType === 'touch') { input.touch = true; input.touchAt = performance.now(); }
    // a mouse moving shortly after a touch is the compatibility mouse event of that touch, not a mouse
    else if (e.pointerType === 'mouse' && performance.now() - input.touchAt > 800) input.touch = false;
  };
  window.addEventListener('pointerdown', note, { capture: true, passive: true });
  window.addEventListener('pointermove', note, { capture: true, passive: true });
}
install();

/** touch UI: the user is working with fingers (labels get finger-sized hit areas, the tooltip opens on tap) */
export const touchUI = () => input.touch;

/**
 * Battery-conscious rendering: a phone, or any coarse-pointer device. Defaults the quality tier to Fast and caps
 * the frame rate while the crews animate.
 */
export const lowPower = () => coarsePointer() || layoutModeNow() === 'phone';
