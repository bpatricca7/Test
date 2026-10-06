import { useEffect, useRef, useState } from 'react';

/** Animates between numeric values (count-up / count-down) over ~600 ms. */
export function Num({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now(); const a = from.current; const b = value;
    if (!isFinite(a) || !isFinite(b) || a === b) { setShown(b); from.current = b; return; }
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600); const k = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * k);
      if (t < 1) raf.current = requestAnimationFrame(tick); else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{format(shown)}</>;
}
