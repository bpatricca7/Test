import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { MARK_GRID_Y, MARK_PATH, markGrids } from "../lib/mark";

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

// Pixel layers never change, so build them once, on first use. About a third of the cells
// twinkle, staggered.
let pixelLayers: ReactNode = null;
function getPixelLayers(): ReactNode {
  pixelLayers ??= markGrids().map(({ cols, cells }, g) => {
    const size = 100 / cols;
    const inset = size * 0.08;
    return (
      <g key={cols} className={`ll-grid ll-g${g}`}>
        {cells.map(([c, r, level], i) => {
          const h = (i * 37 + cols * 11) % 10;
          return (
            <rect key={i} x={c * size + inset} y={r * size + inset} width={size - inset * 2} height={size - inset * 2}
              className={clsx(`l${level}`, h < 3 && `tw${h + 1}`)} />
          );
        })}
      </g>
    );
  });
  return pixelLayers;
}

/**
 * Thinking spinner: the Amentum mark rendered as pixels that cycle coarse → fine → coarse while
 * the model works. With `solid`, the pixels resolve into the solid vector mark.
 */
export function LogoLoader({ width = 44, solid = false }: { width?: number; solid?: boolean }) {
  return (
    <span className={clsx("logo-loader", solid && "is-solid")} style={{ width, height: (width * 2) / 3 }} aria-hidden>
      <svg viewBox="0 0 100 66.67" width={width} height={(width * 2) / 3}>
        <path className="ll-mark" d={MARK_PATH} fillRule="evenodd" transform={`translate(0 ${MARK_GRID_Y})`} />
        {getPixelLayers()}
      </svg>
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
      <LogoLoader width={36} />
      <span className="status-label">{label}</span>
      {startedAt && <span className="thinking-timer">{clock(elapsed)}</span>}
    </div>
  );
}
