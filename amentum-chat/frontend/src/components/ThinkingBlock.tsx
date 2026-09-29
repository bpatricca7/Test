import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Part } from "../lib/types";
import { Markdown } from "./Markdown";
import { clock, LogoLoader, useElapsed } from "./ThinkingSpinner";
import { BrandMark } from "./Brand";

type ReasoningPart = Extract<Part, { type: "reasoning" }>;

const HEADINGS = /\*\*([^*\n]{3,80})\*\*/g;

function currentHeading(text: string): string | null {
  const matches = [...text.matchAll(HEADINGS)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

/** Reasoning trace: live while the model reasons, then a collapsible record of its steps. */
export function ThinkingBlock({ part, expandDefault }: { part: ReasoningPart; expandDefault: boolean }) {
  const running = part.status === "running";
  const [open, setOpen] = useState(expandDefault);
  const bodyRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(part.started_at ? part.started_at * 1000 : null, running);
  const hasText = part.text.trim().length > 0;
  const heading = running ? currentHeading(part.text) : null;
  const steps = Math.max(1, [...part.text.matchAll(HEADINGS)].length);

  // When reasoning finishes live, hold the header briefly so the pixel mark can resolve to solid.
  const [settling, setSettling] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (!finished || part.status === "stopped") return;
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 1100);
    return () => clearTimeout(t);
  }, [running]);

  useEffect(() => {
    if (running && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [part.text, running]);

  const showBody = hasText && (running || settling || open);
  const duration = part.duration_ms ?? elapsed;
  const secs = Math.max(1, Math.round(duration / 1000));

  return (
    <div className={clsx("thinking", running && "is-running", showBody && "is-open")}>
      {running || settling ? (
        <div className={clsx("thinking-live", !running && "is-settled")} role="status" aria-live="polite">
          <LogoLoader width={44} solid={!running} />
          <span className="thinking-live-text">
            <span className="thinking-live-top">
              <span className="thinking-kicker">{running ? "Reasoning" : "Complete"}</span>
              <span className="thinking-timer">
                {running ? clock(duration) : `${steps} step${steps === 1 ? "" : "s"}`}
              </span>
            </span>
            <span className="thinking-heading">
              {running ? heading ?? "Working through the problem" : `Reasoned for ${secs}s`}
            </span>
          </span>
        </div>
      ) : (
        <button
          className="thinking-head"
          onClick={() => hasText && setOpen((o) => !o)}
          aria-expanded={showBody}
          disabled={!hasText}
        >
          <BrandMark width={15} className="thinking-mark" />
          <span className="thinking-label done">
            {part.status === "stopped" ? "Reasoning stopped" : `Reasoned for ${secs}s`}
            {hasText && <span className="thinking-steps">{steps} step{steps === 1 ? "" : "s"}</span>}
          </span>
          {hasText && <ChevronRight size={14} className={clsx("chev-r", open && "open")} />}
        </button>
      )}
      {showBody && (
        <div className="thinking-body" ref={bodyRef}>
          <Markdown text={part.text} className="thinking-md" />
        </div>
      )}
    </div>
  );
}
