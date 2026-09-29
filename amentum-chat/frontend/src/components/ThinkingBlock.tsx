import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Part } from "../lib/types";
import { Markdown } from "./Markdown";
import { clock, LogoSpinner, useElapsed } from "./ThinkingSpinner";

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

  useEffect(() => {
    if (running && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [part.text, running]);

  const showBody = hasText && (running || open);
  const duration = part.duration_ms ?? elapsed;
  const secs = Math.max(1, Math.round(duration / 1000));

  return (
    <div className={clsx("thinking", running && "is-running", showBody && "is-open")}>
      <button
        className="thinking-head"
        onClick={() => hasText && !running && setOpen((o) => !o)}
        aria-expanded={showBody}
        disabled={!hasText || running}
      >
        <LogoSpinner size={20} done={!running} />
        {running ? (
          <span className="thinking-label">
            <span className="status-label">Reasoning</span>
            {heading && <span className="thinking-heading">{heading}</span>}
          </span>
        ) : (
          <span className="thinking-label done">
            {part.status === "stopped" ? "Reasoning stopped" : `Reasoned for ${secs}s`}
            {hasText && <span className="thinking-steps">{steps} step{steps === 1 ? "" : "s"}</span>}
          </span>
        )}
        {running && <span className="thinking-timer">{clock(elapsed)}</span>}
        {!running && hasText && <ChevronRight size={14} className={clsx("chev-r", open && "open")} />}
      </button>
      {showBody && (
        <div className="thinking-body" ref={bodyRef}>
          <Markdown text={part.text} className="thinking-md" />
        </div>
      )}
    </div>
  );
}
