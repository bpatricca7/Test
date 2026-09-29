import { useEffect, useState } from "react";

/** Activity indicator: four bars rising in sequence (same geometry as the brand mark). */
export function Loader({ size = 16 }: { size?: number }) {
  return (
    <span className="loader" style={{ width: size, height: size }} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Thinking spinner: a radar sweep with contacts that light up as the beam passes. */
export function Radar({ size = 30 }: { size?: number }) {
  return (
    <span className="radar" style={{ width: size, height: size }} aria-hidden>
      <i className="radar-sweep" />
      <i className="radar-blip" />
      <i className="radar-blip" />
      <i className="radar-blip" />
    </span>
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

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Status line shown while the assistant is working. */
export function ThinkingIndicator({ label, startedAt }: { label: string; startedAt: number | null }) {
  const elapsed = useElapsed(startedAt, true);
  return (
    <div className="thinking-indicator" role="status" aria-live="polite">
      <Radar size={30} />
      <span className="status-label">{label}</span>
      {startedAt && <span className="thinking-timer">{clock(elapsed)}</span>}
    </div>
  );
}
