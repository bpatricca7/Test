// Frame-rate governor for the High tier (UI spec §10: FPS high ≥ 4). When High cannot hold 4 fps while the
// scene renders continuously (sim playing, nothing else loading the main thread), it sheds cost in steps:
//   1. SMAA off (in Review lighting the composer, and its full-screen passes, go away entirely);
//   2. the canvas renders at 0.75× the §9.4 DPR (never below 0.75);
//   3. in Live lighting, the bloom and vignette go too.
// It steps back up when frames are fast again. On a GPU the High tier never comes near the threshold; on
// software rasterizers (swiftshader) each full-screen post pass costs as much as the scene.
import { useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store';
import { rt } from './runtime';

const MAX_LEVEL = 3;
const SLOW_MS = 250;   // median frame slower than 4 fps → step down
const FAST_MS = 110;   // median frame faster than ~9 fps → step back up
const WINDOW_MS = 4000;

const listeners = new Set<() => void>();
const setLevel = (n: number) => { if (n === rt.perf.level) return; rt.perf.level = n; rt.perf.changedAt = performance.now(); for (const fn of listeners) fn(); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const usePerfLevel = () => useSyncExternalStore(subscribe, () => rt.perf.level, () => 0);

export function PerfGovernor() {
  const get = useThree((s) => s.get);
  const quality = useStore((s) => s.quality);
  useFrame(() => {
    const now = performance.now();
    const p = rt.perf;
    const dt = now - p.last; p.last = now;
    if (quality !== 'high') { p.samples.length = 0; if (p.level) setLevel(0); return; }
    // only frames rendered back to back say anything about the renderer's cost
    const st = useStore.getState();
    if (get().frameloop !== 'always' || st.extraction.running || document.hidden || dt <= 0 || dt > 3000) { p.samples.length = 0; p.since = now; return; }
    p.samples.push(dt);
    if (p.samples.length > 60) p.samples.shift();
    if (now - p.since < WINDOW_MS || now - p.changedAt < WINDOW_MS || p.samples.length < 6) return;
    const sorted = p.samples.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    p.median = med;
    const live = (st.lighting ?? 'review') === 'live';
    const max = live ? MAX_LEVEL : 2;
    if (med > SLOW_MS && p.level < max) {
      // a level that was too slow is not retried for 30 s (no oscillation around the threshold)
      p.noUpUntil = now + 30000;
      setLevel(p.level + 1); p.samples.length = 0; p.since = now;
    } else if (med < FAST_MS && p.level > 0 && now > p.noUpUntil) { setLevel(p.level - 1); p.samples.length = 0; p.since = now; }
  });
  return null;
}
