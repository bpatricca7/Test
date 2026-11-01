// Phone on-screen keyboard (mobile contract). While a text field has focus (or the keyboard covers the visual
// viewport) :root[data-kb="open"] is set and --kb-h holds the height the keyboard covers at the bottom of the layout
// viewport (0 when the keyboard shortens the window instead). mobile.css then hides the tab bar, the run strip and
// the crew strip, lifts the open sheet above the keyboard and lets it fill the map column, and collapses the
// Inspector header to its first row, so the field being edited stays in view. The field is centred in its own
// scroller after every keyboard resize; nothing else scrolls (the sheet, the chrome). The camera keeps its framing:
// the insets writer and CameraRig ignore the free rect while the keyboard is open.
import { useLayoutEffect } from 'react';
import { isEditable, keyboardLikelyUp } from './responsive';

export const KB_EVENT = 'bos:kb';
export const keyboardOpen = () => typeof document !== 'undefined' && document.documentElement.dataset.kb === 'open';

const scrollParent = (el: Element): HTMLElement | null => {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
};

/** Centre `el` in the part of its scroller that the keyboard leaves visible (no scrollIntoView: it would also scroll
 * the overflow-hidden sheet and chrome). */
export function revealAboveKeyboard(el: HTMLElement) {
  const sc = scrollParent(el); if (!sc) return;
  const vv = window.visualViewport;
  const r = el.getBoundingClientRect(), c = sc.getBoundingClientRect();
  const visTop = Math.max(c.top, vv ? vv.offsetTop : 0);
  const visBottom = Math.min(c.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
  if (visBottom - visTop < 24) return;
  const margin = Math.min(48, (visBottom - visTop) / 4);
  if (r.top >= visTop + margin && r.bottom <= visBottom - margin) return;
  sc.scrollTop += r.top + r.height / 2 - (visTop + visBottom) / 2;
}

/** Mount once in the phone chrome. */
export function usePhoneKeyboard() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let open = false;
    let raf = 0;
    const covered = () => (vv ? Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height))) : 0);
    const reveal = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { const a = document.activeElement; if (open && isEditable(a)) revealAboveKeyboard(a); }); });
    };
    const update = () => {
      const editing = isEditable(document.activeElement);
      const next = editing || (vv != null && vv.height * vv.scale < window.innerHeight - 120);
      root.style.setProperty('--kb-h', `${next ? covered() : 0}px`);
      if (next !== open) {
        open = next;
        if (open) root.dataset.kb = 'open'; else delete root.dataset.kb;
        window.dispatchEvent(new CustomEvent(KB_EVENT, { detail: { open } }));
      }
      if (open) reveal();
    };
    // focus moves synchronously; the keyboard (and the resize it causes) follows. On blur, wait a moment: focus may
    // be moving to the next field, and a closing keyboard should not drop the layout mid-animation.
    let blurT: ReturnType<typeof setTimeout> | null = null;
    const onIn = () => { if (blurT) { clearTimeout(blurT); blurT = null; } update(); };
    const onOut = () => { if (blurT) clearTimeout(blurT); blurT = setTimeout(() => { blurT = null; update(); if (!open && keyboardLikelyUp()) setTimeout(update, 400); }, 120); };
    document.addEventListener('focusin', onIn, true);
    document.addEventListener('focusout', onOut, true);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      document.removeEventListener('focusin', onIn, true);
      document.removeEventListener('focusout', onOut, true);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (blurT) clearTimeout(blurT);
      cancelAnimationFrame(raf);
      if (open) { delete root.dataset.kb; window.dispatchEvent(new CustomEvent(KB_EVENT, { detail: { open: false } })); }
      root.style.removeProperty('--kb-h');
    };
  }, []);
}
