import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import { ChevronDown, CircleCheck, CircleX, Plug, SquareTerminal, CircleStop } from "lucide-react";
import clsx from "clsx";
import type { CodeOutput, McpOutput, Part } from "../lib/types";
import { fmtDuration } from "../lib/format";
import { useStore } from "../lib/store";
import { FileCard } from "./Files";
import { CopyButton } from "./Markdown";
import { Loader } from "./ThinkingSpinner";

hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);

type ToolPart = Extract<Part, { type: "tool" }>;

function Highlighted({ code, lang }: { code: string; lang: "python" | "json" }) {
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    }
  }, [code, lang]);
  return (
    <pre className="hljs tool-code">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

function StatusBadge({ part }: { part: ToolPart }) {
  if (part.status === "running") {
    const writing = part.kind !== "mcp" && typeof part.input === "string" && !part.output;
    return (
      <span className="tool-status running">
        <Loader size={16} />
        <span className="status-label">{part.kind === "mcp" ? "Querying" : writing ? "Writing code" : "Running"}</span>
      </span>
    );
  }
  if (part.status === "stopped") return <span className="tool-status muted"><CircleStop size={14} /> Stopped</span>;
  if (part.status === "error")
    return <span className="tool-status error"><CircleX size={14} /> Error{part.duration_ms ? ` · ${fmtDuration(part.duration_ms)}` : ""}</span>;
  return <span className="tool-status ok"><CircleCheck size={14} /> {fmtDuration(part.duration_ms) || "Done"}</span>;
}

function CodeToolCard({ part }: { part: ToolPart }) {
  const running = part.status === "running";
  const [showCode, setShowCode] = useState<boolean | null>(null);
  const setPreview = useStore((s) => s.setPreview);
  const code = typeof part.input === "string" ? part.input : String((part.input as { code?: string }).code ?? "");
  const out = part.output as CodeOutput | undefined;
  const codeOpen = showCode ?? (running || !out);
  const textOut = [out?.stdout, ...(out?.results ?? [])].filter(Boolean).join("\n").trimEnd();

  return (
    <div className={clsx("tool-card code", running && "is-running", part.status === "error" && "is-error")}>
      <button className="tool-head" onClick={() => setShowCode(!codeOpen)}>
        <span className="tool-icon code"><SquareTerminal size={15} /></span>
        <span className="tool-title">Code interpreter</span>
        <span className="tool-sub">Python</span>
        <StatusBadge part={part} />
        <ChevronDown size={15} className={clsx("chev", codeOpen && "open")} />
      </button>
      {codeOpen && code && (
        <div className="tool-code-wrap">
          <div className="tool-code-actions"><CopyButton text={code} /></div>
          <Highlighted code={code} lang="python" />
        </div>
      )}
      {out && (textOut || out.stderr || out.error) && (
        <div className="tool-output">
          {textOut && <pre className="out-std">{textOut}</pre>}
          {out.stderr && !out.error && <pre className="out-err muted">{out.stderr}</pre>}
          {out.error && (
            <details className="out-error">
              <summary>
                <CircleX size={14} /> {out.error.name}: {out.error.value}
              </summary>
              {out.error.traceback && <pre>{out.error.traceback}</pre>}
            </details>
          )}
        </div>
      )}
      {out && out.images.length > 0 && (
        <div className="tool-images">
          {out.images.map((img, i) => (
            <button key={img.id ?? i} className="tool-image" onClick={() => img.id && setPreview({ ...img, kind: "image" })}>
              <img src={img.id ? `${img.url}?inline=1` : img.url} alt={img.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {out && out.files.length > 0 && (
        <div className="tool-files">
          {out.files.map((f) => (
            <FileCard key={f.id} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function prettyText(text: string): { lang: "json" | null; text: string } {
  const t = text.trim();
  if ((t.startsWith("{") || t.startsWith("[")) && t.length < 200_000) {
    try {
      return { lang: "json", text: JSON.stringify(JSON.parse(t), null, 2) };
    } catch {
      /* not json */
    }
  }
  return { lang: null, text };
}

function McpToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const out = part.output as McpOutput | undefined;
  const args = typeof part.input === "string" ? part.input : JSON.stringify(part.input, null, 2);
  const resultText = (out?.content ?? []).filter((c) => c.text).map((c) => c.text).join("\n") || out?.error || "";
  const pretty = prettyText(resultText);
  const images = (out?.content ?? []).filter((c) => c.file);
  return (
    <div className={clsx("tool-card mcp", part.status === "running" && "is-running", part.status === "error" && "is-error")}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-icon mcp"><Plug size={15} /></span>
        <span className="tool-title">{part.server || "Connector"}</span>
        <span className="tool-sub mono">{part.label || part.name}</span>
        <StatusBadge part={part} />
        <ChevronDown size={15} className={clsx("chev", open && "open")} />
      </button>
      {open && (
        <div className="tool-mcp-body">
          <div className="tool-section-label">Request</div>
          <Highlighted code={args && args !== "{}" ? args : "{}"} lang="json" />
          {out && (
            <>
              <div className="tool-section-label">
                Response {out.is_error && <span className="pill danger">error</span>}
                {resultText && <CopyButton text={resultText} />}
              </div>
              {pretty.lang ? <Highlighted code={pretty.text} lang="json" /> : <pre className="out-std">{pretty.text || "(empty)"}</pre>}
            </>
          )}
        </div>
      )}
      {images.length > 0 && (
        <div className="tool-images">
          {images.map((c, i) => c.file && <img key={i} src={`${c.file.url}?inline=1`} alt={c.file.name} />)}
        </div>
      )}
    </div>
  );
}

export function ToolCard({ part }: { part: ToolPart }) {
  return part.kind === "mcp" ? <McpToolCard part={part} /> : <CodeToolCard part={part} />;
}
