import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Part } from "../lib/types";
import { fmtDuration } from "../lib/format";
import { Markdown } from "./Markdown";
import { OrbitSpinner, useElapsed } from "./ThinkingSpinner";

type ReasoningPart = Extract<Part, { type: "reasoning" }>;

function currentHeading(text: string): string | null {
  const matches = [...text.matchAll(/\*\*([^*\n]{3,80})\*\*/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

export function ThinkingBlock({ part, expandDefault }: { part: ReasoningPart; expandDefault: boolean }) {
  const running = part.status === "running";
  const [open, setOpen] = useState(expandDefault);
  const bodyRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(part.started_at ? part.started_at * 1000 : null, running);
  const hasText = part.text.trim().length > 0;
  const heading = running ? currentHeading(part.text) : null;

  useEffect(() => {
    if (running && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [part.text, running]);

  const showBody = hasText && (running || open);
  const duration = part.duration_ms ?? elapsed;

  return (
    <div className={clsx("thinking", running && "is-running", showBody && "is-open")}>
      <button
        className="thinking-head"
        onClick={() => hasText && !running && setOpen((o) => !o)}
        aria-expanded={showBody}
        disabled={!hasText || running}
      >
        {running ? <OrbitSpinner size={22} /> : <span className="thinking-icon"><Brain size={15} /></span>}
        {running ? (
          <span className="thinking-label">
            <span className="shimmer-text">Thinking</span>
            {heading && <span className="thinking-heading">· {heading}</span>}
          </span>
        ) : (
          <span className="thinking-label done">
            {part.status === "stopped" ? "Stopped thinking" : "Thought"} for {duration >= 1000 ? fmtDuration(duration) : "a moment"}
          </span>
        )}
        {running && <span className="thinking-timer">{Math.floor(elapsed / 1000)}s</span>}
        {!running && hasText && <ChevronDown size={15} className={clsx("chev", open && "open")} />}
      </button>
      {showBody && (
        <div className="thinking-body" ref={bodyRef}>
          <Markdown text={part.text} className="thinking-md" />
        </div>
      )}
    </div>
  );
}
