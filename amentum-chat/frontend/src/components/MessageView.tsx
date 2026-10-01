import { memo, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CircleStop, Clock, Coins, Cpu, Pencil, RefreshCw, TriangleAlert, Info, CircleAlert } from "lucide-react";
import clsx from "clsx";
import type { Message, Part, UsageInfo } from "../lib/types";
import { effortLabel, fmtCost, fmtDuration, fmtInt, fmtTokens } from "../lib/format";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { FileCard } from "./Files";
import { CopyButton, Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ThinkingIndicator } from "./ThinkingSpinner";
import { ToolCard } from "./ToolCard";

function UsageBar({ usage }: { usage: UsageInfo }) {
  const config = useStore((s) => s.config);
  const label = config?.models.find((m) => m.id === usage.model)?.label ?? usage.model;
  const title =
    `Input ${fmtInt(usage.input_tokens)} tokens (${fmtInt(usage.cached_tokens)} cached)\n` +
    `Output ${fmtInt(usage.output_tokens)} tokens (${fmtInt(usage.reasoning_tokens)} reasoning)\n` +
    `${usage.calls} model call(s)`;
  return (
    <div className="usage-bar" title={title}>
      <span className="usage-chip"><Cpu size={12} /> {label}{usage.effort ? ` · ${effortLabel(usage.effort)}` : ""}</span>
      <span className="usage-chip"><ArrowUpRight size={12} /> {fmtTokens(usage.input_tokens)} in
        {usage.cached_tokens > 0 && <em> ({fmtTokens(usage.cached_tokens)} cached)</em>}</span>
      <span className="usage-chip"><ArrowDownRight size={12} /> {fmtTokens(usage.output_tokens)} out
        {usage.reasoning_tokens > 0 && <em> ({fmtTokens(usage.reasoning_tokens)} reasoning)</em>}</span>
      <span className="usage-chip cost"><Coins size={12} /> {fmtCost(usage.cost_usd)}</span>
      {usage.duration_ms ? <span className="usage-chip"><Clock size={12} /> {fmtDuration(usage.duration_ms)}</span> : null}
    </div>
  );
}

function Notice({ part }: { part: Extract<Part, { type: "notice" }> }) {
  const Icon = part.level === "error" ? CircleAlert : part.level === "warning" ? TriangleAlert : Info;
  return (
    <div className={clsx("notice", part.level)}>
      <Icon size={16} />
      <span>{part.text}</span>
    </div>
  );
}

function liveLabel(parts: Part[]): string | null {
  const last = parts[parts.length - 1];
  if (!last) return "Working";
  if (last.type === "tool" && last.status !== "running") return "Reviewing results";
  if (last.type === "reasoning" && last.status !== "running") return "Working";
  return null;
}

const AssistantMessage = memo(function AssistantMessage({ msg, isLast, streamingStart }: {
  msg: Message; isLast: boolean; streamingStart: number | null;
}) {
  const { prefs, regenerate, streaming, config } = useStore(useShallow((s) => ({ prefs: s.prefs, regenerate: s.regenerate, streaming: s.streaming, config: s.config })));
  const showUsage = useStore((s) => s.showUsage());
  const live = msg.status === "streaming";
  const text = msg.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n");
  const label = live ? liveLabel(msg.parts) : null;
  const fileLinks = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of msg.parts) {
      const found = p.type === "files" ? p.files : p.type === "tool" && p.output && "files" in p.output ? p.output.files : [];
      for (const f of found) {
        if (!f.id) continue;
        map[f.name] = map[f.name.toLowerCase()] = f.url;
      }
    }
    return map;
  }, [msg.parts]);

  return (
    <div className={clsx("msg assistant", live && "is-live")}>
      <div className="msg-body">
        {msg.parts.map((p, i) => {
          switch (p.type) {
            case "reasoning":
              return <ThinkingBlock key={p.id} part={p} expandDefault={prefs.expandThinking} />;
            case "tool":
              return <ToolCard key={p.id} part={p} />;
            case "text":
              return (
                <div key={`t${i}`} className="msg-text">
                  <Markdown text={p.text} files={fileLinks} />
                </div>
              );
            case "files":
              return (
                <div key={`f${i}`} className="tool-files">
                  {p.files.map((f) => <FileCard key={f.id} file={f} />)}
                </div>
              );
            case "notice":
              return <Notice key={`n${i}`} part={p} />;
            default:
              return null;
          }
        })}
        {label && <ThinkingIndicator label={label} startedAt={streamingStart} />}
        {!live && (
          <div className="msg-footer">
            <div className="msg-actions">
              {text && <CopyButton text={text} />}
              {isLast && !streaming && (
                <button className="icon-btn subtle" title="Regenerate" onClick={regenerate}>
                  <RefreshCw size={14} />
                </button>
              )}
              {msg.status === "stopped" && <span className="stopped-tag"><CircleStop size={12} /> Stopped</span>}
            </div>
            {!showUsage && msg.usage?.model && (
              <span className="msg-meta">
                {config?.models.find((m) => m.id === msg.usage?.model)?.label ?? msg.usage.model}
                {msg.usage.effort ? ` · ${effortLabel(msg.usage.effort)}` : ""}
                {msg.usage.duration_ms ? ` · ${fmtDuration(msg.usage.duration_ms)}` : ""}
              </span>
            )}
            {showUsage && msg.usage && msg.usage.calls > 0 && <UsageBar usage={msg.usage} />}
          </div>
        )}
      </div>
    </div>
  );
});

const UserMessage = memo(function UserMessage({ msg }: { msg: Message }) {
  const { send, streaming } = useStore(useShallow((s) => ({ send: s.send, streaming: s.streaming })));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  return (
    <div className="msg user">
      <div className="msg-body">
        {msg.attachments.length > 0 && (
          <div className="msg-attachments">
            {msg.attachments.map((f) => <FileCard key={f.id} file={f} />)}
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={Math.min(10, draft.split("\n").length + 1)} />
            <div className="edit-actions">
              <button className="btn ghost" onClick={() => { setEditing(false); setDraft(msg.content); }}>Cancel</button>
              <button className="btn primary" disabled={!draft.trim() || !!streaming}
                onClick={() => { setEditing(false); send(draft, msg.attachments, msg.id); }}>
                Send
              </button>
            </div>
          </div>
        ) : (
          msg.content && <div className="user-bubble">{msg.content}</div>
        )}
        {!editing && (
          <div className="msg-actions user-actions">
            <CopyButton text={msg.content} />
            {!streaming && (
              <button className="icon-btn subtle" title="Edit" onClick={() => setEditing(true)}>
                <Pencil size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export function MessageView({ msg, isLast }: { msg: Message; isLast: boolean }) {
  const streamingStart = useStore((s) => (s.streaming?.assistantId === msg.id ? s.streaming.startedAt : null));
  return msg.role === "user" ? <UserMessage msg={msg} /> : <AssistantMessage msg={msg} isLast={isLast} streamingStart={streamingStart} />;
}
