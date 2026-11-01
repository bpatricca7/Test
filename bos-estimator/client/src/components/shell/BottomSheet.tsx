// Phone bottom sheet (mobile contract): one sheet re-hosts the side panels' tabs (List, Inspector, Estimate,
// Documents) and the crews dock. Snap points peek ≈ 25 % (at least 216 px), half ≈ 55 %, full ≈ 92 % of the viewport
// (portrait), and 58 / 80 / 100 % of the map column beside the tab rail (landscape). Drag the head (or the content's own header,
// the drag zones below) with pointer events; release snaps with velocity (a fling goes one snap further). The handle
// is a button: Enter / Space cycles peek → half → full, ↑ / ↓ step, and the sheet is a labelled region.
// Heights are px on the sheet (`--m-sheet-h` on .m-main); during a drag the shell writes them every move, so the map
// (whose free rect stops at the half snap) and the overlays follow the finger.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { SheetSnap } from '../../store';
import { cx } from '../lib/cx';

export interface SheetSizes { peek: number; half: number; full: number; main: number; landscape: boolean }
export const SNAP_ORDER: SheetSnap[] = ['closed', 'peek', 'half', 'full'];
const OPEN_SNAPS: SheetSnap[] = ['peek', 'half', 'full'];
const SNAP_WORD: Record<SheetSnap, string> = { closed: 'closed', peek: 'peeking', half: 'half height', full: 'full height' };

export const heightOf = (z: SheetSizes, snap: SheetSnap) => (snap === 'closed' ? 0 : z[snap]);

/** Snap heights from the map column (.m-main) and the window. `peekMin` is the measured height the peek snap must
 * hold (the sheet head plus the Inspector's header with its review actions); it is capped below the half snap. */
export function useSheetSizes(mainRef: RefObject<HTMLElement | null>, landscape: boolean, peekMin = 0): SheetSizes {
  const read = useCallback((): SheetSizes => {
    const H = window.innerHeight;
    const M = Math.max(120, mainRef.current?.clientHeight ?? H - 104);
    // landscape: the sheet is a column beside the map, so even its lowest snap is a useful height
    if (landscape) return { peek: Math.round(M * 0.58), half: Math.round(M * 0.8), full: M, main: M, landscape };
    const full = Math.round(Math.min(H * 0.92, M - 8));
    const half = Math.round(Math.min(Math.max(H * 0.55, 300), full));
    // peek ≈ 25 %, but never shorter than a building summary (head + the Inspector's header with its actions)
    return { peek: Math.round(Math.min(Math.max(H * 0.25, 216, peekMin), half - 40, full)), half, full, main: M, landscape };
  }, [mainRef, landscape, peekMin]);
  const [z, setZ] = useState<SheetSizes>(() => (typeof window === 'undefined' ? { peek: 200, half: 440, full: 740, main: 748, landscape } : read()));
  useLayoutEffect(() => {
    const upd = () => setZ((p) => { const n = read(); return n.peek === p.peek && n.half === p.half && n.full === p.full && n.main === p.main && n.landscape === p.landscape ? p : n; });
    upd();
    const ro = new ResizeObserver(upd);
    if (mainRef.current) ro.observe(mainRef.current);
    window.addEventListener('resize', upd);
    return () => { ro.disconnect(); window.removeEventListener('resize', upd); };
  }, [read, mainRef]);
  return z;
}

/** Where the sheet's top settles for a release at height `h` moving at `v` px/ms (positive = downward). */
export function snapFor(z: SheetSizes, h: number, v: number, from: SheetSnap): SheetSnap {
  const hs = SNAP_ORDER.map((s) => heightOf(z, s));
  if (Math.abs(v) > 0.55) {
    // a fling: the next snap in its direction from where the finger let go
    if (v < 0) { const up = SNAP_ORDER.find((s, i) => hs[i] > h + 4); return up ?? 'full'; }
    const down = [...SNAP_ORDER].reverse().find((s) => heightOf(z, s) < h - 4);
    return down ?? 'closed';
  }
  const projected = h - v * 160;
  let best: SheetSnap = from, bd = Infinity;
  SNAP_ORDER.forEach((s, i) => { const d = Math.abs(hs[i] - projected); if (d < bd) { bd = d; best = s; } });
  // closing needs a deliberate pull: below half the peek height
  if (best === 'closed' && projected > z.peek * 0.5) best = 'peek';
  return best;
}

/** Elements that drag the sheet besides its head: content headers with no vertical scroll of their own. */
const DRAG_ZONES = '.m-sheet__head, .m-sheet__lead, .insp__head';
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-sheet-drag]';

export interface BottomSheetProps {
  snap: SheetSnap;
  sizes: SheetSizes;
  onSnap: (s: SheetSnap) => void;
  /** visible heading in the head; also names the region */
  title: ReactNode;
  label: string;
  /** live px height while dragging (the shell mirrors it onto the map's free rect) */
  onDrag: (h: number | null) => void;
  children: ReactNode;
  className?: string;
  /** extra controls in the head (right side, before ×) */
  headEnd?: ReactNode;
  /** the × button (default: close the sheet) and its label */
  onClose?: () => void;
  closeLabel?: string;
  id?: string;
}

export function BottomSheet({ snap, sizes, onSnap, title, label, onDrag, children, className, headEnd, onClose, closeLabel, id }: BottomSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; y0: number; h0: number; active: boolean; samples: { t: number; y: number }[] } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const open = snap !== 'closed';

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !open) return;
    const t = e.target as Element;
    if (!t.closest(DRAG_ZONES) || t.closest(NO_DRAG)) return;
    const h = ref.current?.getBoundingClientRect().height ?? heightOf(sizes, snap);
    drag.current = { id: e.pointerId, y0: e.clientY, h0: h, active: false, samples: [{ t: e.timeStamp, y: e.clientY }] };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) < 6) return;
      d.active = true;
      setDragging(true);
      // capture only once it is a drag, so a tap still clicks the button under the finger
      try { ref.current?.setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
    }
    const h = Math.max(0, Math.min(sizes.full, d.h0 - dy));
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 90) d.samples.shift();
    if (ref.current) ref.current.style.height = `${h}px`;
    onDrag(h);
  };
  const end = (e: ReactPointerEvent, cancelled: boolean) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    // where the finger let go (moves can be coalesced on a busy frame, so not the last height drawn)
    if (!cancelled) d.samples.push({ t: e.timeStamp, y: e.clientY });
    const h = cancelled ? ref.current?.getBoundingClientRect().height ?? d.h0 : Math.max(0, Math.min(sizes.full, d.h0 - (e.clientY - d.y0)));
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 90) d.samples.shift();
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = !cancelled && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    const next = snapFor(sizes, h, v, snap);
    setDragging(false);
    if (ref.current) ref.current.style.height = '';
    onDrag(null);
    if (next !== snap) onSnap(next);
  };

  const cycle = () => {
    if (suppressClick.current) return;
    onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
  };
  const onHandleKey = (e: KeyboardEvent) => {
    const i = OPEN_SNAPS.indexOf(snap);
    if (e.key === 'ArrowUp') { e.preventDefault(); onSnap(OPEN_SNAPS[Math.min(OPEN_SNAPS.length - 1, i + 1)]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onSnap(i <= 0 ? 'closed' : OPEN_SNAPS[i - 1]); }
    else if (e.key === 'Home') { e.preventDefault(); onSnap('peek'); }
    else if (e.key === 'End') { e.preventDefault(); onSnap('full'); }
  };
  // Esc (no hotkey layer of its own: the dialog / menu layers come first) collapses a full sheet one step
  useEffect(() => {
    if (snap !== 'full') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !ref.current?.contains(document.activeElement)) return;
      if (document.querySelector('.ui-scrim, .ui-pop')) return;
      onSnap('half');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap, onSnap]);

  const next = snap === 'peek' ? 'expand to half height' : snap === 'half' ? 'expand to full height' : 'collapse to peek';
  return (
    <section ref={ref} id={id} className={cx('m-sheet', className, dragging && 'is-dragging')} data-snap={snap} role="region" aria-label={label}
      inert={!open} aria-hidden={!open || undefined}
      // the sheet clips (overflow hidden) but a focused field can still scroll it, hiding its head: undo that
      onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)}>
      <div className="m-sheet__head">
        <button type="button" className="m-sheet__handle" onClick={cycle} onKeyDown={onHandleKey}
          aria-label={`${label}, ${SNAP_WORD[snap]}. Activate to ${next}; arrow keys resize`}>
          <span className="m-sheet__grab" aria-hidden />
          <span className="m-sheet__title">{title}</span>
        </button>
        {headEnd}
        <button type="button" className="m-sheet__x" aria-label={closeLabel ?? `Close ${label}`} onClick={() => (onClose ? onClose() : onSnap('closed'))}><X size={18} aria-hidden /></button>
      </div>
      <div className="m-sheet__body">{children}</div>
    </section>
  );
}
