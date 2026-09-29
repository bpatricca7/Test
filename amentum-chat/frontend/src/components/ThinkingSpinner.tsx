import { useEffect, useRef, useState } from "react";
import { LogoSpinnerEngine } from "../lib/logoSpinner";

/** Small inline busy indicator for buttons and panels: three pixels stepping in sequence. */
export function Loader({ size = 16 }: { size?: number }) {
  return (
    <span className="loader" style={{ width: size, height: size }} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Thinking spinner: the Amentum mark breaks into pixels that swirl in two counter-rotating rings
 * while the model works. When `done` turns true the pixels spiral back and form the solid logo,
 * which stays in place. Mounted with `done` already true, it simply shows the logo.
 */
export function LogoSpinner({ size = 20, done = false }: { size?: number; done?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<LogoSpinnerEngine | null>(null);
  const initialDone = useRef(done);
  useEffect(() => {
    if (!ref.current) return;
    const e = new LogoSpinnerEngine(ref.current, size, initialDone.current);
    engine.current = e;
    return () => e.destroy();
  }, [size]);
  useEffect(() => {
    initialDone.current = done;
    engine.current?.setDone(done);
  }, [done]);
  return <canvas ref={ref} className="logo-spinner" style={{ width: size, height: size }} aria-hidden />;
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
      <LogoSpinner size={20} />
      <span className="status-label">{label}</span>
      {startedAt && <span className="thinking-timer">{clock(elapsed)}</span>}
    </div>
  );
}
