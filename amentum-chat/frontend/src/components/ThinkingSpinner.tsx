import { useEffect, useId, useState } from "react";

/** "Orbit" spinner: three counter-rotating gradient arcs around a pulsing core. */
export function OrbitSpinner({ size = 22 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="orbit" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id={`og-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f8bff" />
          <stop offset="0.5" stopColor="#36b3e8" />
          <stop offset="1" stopColor="#22d08a" />
        </linearGradient>
        <radialGradient id={`oc-${id}`}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#7ef0c0" />
          <stop offset="1" stopColor="#22d08a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="orbit-track" cx="24" cy="24" r="21" />
      <circle className="orbit-arc orbit-arc-1" cx="24" cy="24" r="21" stroke={`url(#og-${id})`} />
      <circle className="orbit-arc orbit-arc-2" cx="24" cy="24" r="14.5" stroke={`url(#og-${id})`} />
      <circle className="orbit-arc orbit-arc-3" cx="24" cy="24" r="8" stroke={`url(#og-${id})`} />
      <circle className="orbit-core" cx="24" cy="24" r="5" fill={`url(#oc-${id})`} />
      <circle className="orbit-sat" cx="24" cy="3" r="2.4" />
    </svg>
  );
}

export function useElapsed(startMs: number | null, running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  return startMs ? Math.max(0, (running ? now : Date.now()) - startMs) : 0;
}

/** Spinner + shimmering status label + live timer. */
export function ThinkingIndicator({ label, startedAt }: { label: string; startedAt: number | null }) {
  const elapsed = useElapsed(startedAt, true);
  return (
    <div className="thinking-indicator" role="status" aria-live="polite">
      <OrbitSpinner size={24} />
      <span className="shimmer-text">{label}</span>
      {startedAt && <span className="thinking-timer">{Math.floor(elapsed / 1000)}s</span>}
    </div>
  );
}
