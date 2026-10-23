import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';

/**
 * Animated number (UI spec §5.1 "Num fix"). Tweens over 400 ms with t = clamp((now − start)/400, 0, 1),
 * starting from the value currently shown. Snaps (no tween) while a run streams, with reduced motion,
 * when the previous change was < 600 ms ago, or for non-finite values. Negative inputs are never produced
 * by the tween itself (it interpolates between two shown values).
 */
export function Num({ value, format, snap }: { value: number; format: (v: number) => string; snap?: boolean }) {
  const running = useStore((s) => s.extraction.running);
  const reduced = useStore((s) => s.reducedMotion);
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const lastChange = useRef(0);
  const raf = useRef(0);
  const snapNow = useRef(false);
  snapNow.current = Boolean(snap || running || reduced);
  useEffect(() => {
    const now = performance.now();
    const since = now - lastChange.current;
    lastChange.current = now;
    cancelAnimationFrame(raf.current);
    const from = shownRef.current;
    if (snapNow.current || since < 600 || !Number.isFinite(from) || !Number.isFinite(value) || from === value) {
      shownRef.current = value; setShown(value); return;
    }
    const start = now;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - start) / 400));
      const e = 1 - Math.pow(1 - k, 3);
      const v = k >= 1 ? value : from + (value - from) * e;
      shownRef.current = v; setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{format(shown)}</>;
}
