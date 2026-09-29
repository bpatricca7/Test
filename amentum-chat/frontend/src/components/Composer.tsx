import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Plug, Settings2, SlidersHorizontal, Square, SquareTerminal, Upload, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import type { FileRef } from "../lib/types";
import { fmtBytes } from "../lib/format";
import { FileIcon } from "./Files";
import { EffortDropdown, ModelDropdown } from "./Pickers";
import { Loader } from "./ThinkingSpinner";
import { Switch } from "./ui";

interface Pending {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  file?: FileRef;
  error?: string;
}

const ACCEPT =
  ".docx,.doc,.xlsx,.xlsm,.xls,.csv,.tsv,.pptx,.ppt,.pdf,.txt,.md,.json,.xml,.html,.py,.png,.jpg,.jpeg,.gif,.webp,.zip,.odt,.ods,.odp,.rtf";

function ToolsMenu({ onClose }: { onClose: () => void }) {
  const { config, prefs, setPrefs, connectors, toggleChatConnector, setModal } = useStore(useShallow((s) => ({ config: s.config, prefs: s.prefs, setPrefs: s.setPrefs, connectors: s.connectors, toggleChatConnector: s.toggleChatConnector, setModal: s.setModal })));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc));
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  const ciAvailable = config?.code_interpreter !== "off";
  return (
    <div className="popover tools-menu" ref={ref}>
      <div className="popover-section">
        <div className="menu-row">
          <span className="tool-icon code"><SquareTerminal size={15} /></span>
          <div className="menu-text">
            <strong>Code interpreter</strong>
            <span>{ciAvailable ? "Run Python · analyze and edit Word, Excel, PowerPoint" : "Disabled by administrator"}</span>
          </div>
          <Switch checked={ciAvailable && prefs.codeInterpreter} disabled={!ciAvailable}
            onChange={(v) => setPrefs({ codeInterpreter: v })} />
        </div>
      </div>
      <div className="popover-section">
        <div className="popover-label">Data connectors</div>
        {connectors.length === 0 && <div className="menu-empty">No connectors yet.</div>}
        {connectors.map((c) => {
          const usable = c.status === "connected";
          return (
            <div key={c.id} className={clsx("menu-row", !usable && "dim")}>
              <span className="tool-icon mcp"><Plug size={15} /></span>
              <div className="menu-text">
                <strong>{c.name}</strong>
                <span>{usable ? `${c.tools.length} tools` : c.status === "disabled" ? "Disabled" : c.error || c.status}</span>
              </div>
              <Switch checked={usable && !prefs.disabledConnectors.includes(c.id)} disabled={!usable}
                onChange={() => toggleChatConnector(c.id)} />
            </div>
          );
        })}
        <button className="menu-link" onClick={() => { onClose(); setModal("connectors"); }}>
          <Settings2 size={14} /> Manage connectors
        </button>
      </div>
    </div>
  );
}

export function Composer() {
  const { send, stop, streaming, config, prefs, connectors, toast, draft, setDraft, currentId } = useStore(useShallow((s) => ({ send: s.send, stop: s.stop, streaming: s.streaming, config: s.config, prefs: s.prefs, connectors: s.connectors, toast: s.toast, draft: s.draft, setDraft: s.setDraft, currentId: s.currentId })));
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const resize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, []);
  useEffect(resize, [draft, resize]);
  useEffect(() => inputRef.current?.focus(), [currentId]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const limit = (config?.max_upload_mb ?? 100) * 1024 * 1024;
      const items: Pending[] = files.map((f) => ({
        key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, size: f.size,
        status: f.size > limit ? "error" : "uploading", error: f.size > limit ? "Too large" : undefined,
      }));
      setPending((p) => [...p, ...items]);
      const ok = files.filter((f) => f.size <= limit);
      const okItems = items.filter((i) => i.status === "uploading");
      if (!ok.length) return;
      try {
        const uploaded = await api.upload(ok);
        setPending((p) =>
          p.map((it) => {
            const idx = okItems.findIndex((o) => o.key === it.key);
            return idx >= 0 ? { ...it, status: "ready", file: uploaded[idx] } : it;
          }),
        );
      } catch (e) {
        toast(`Upload failed: ${(e as Error).message}`, "error");
        setPending((p) => p.map((it) => (okItems.some((o) => o.key === it.key) ? { ...it, status: "error", error: "Failed" } : it)));
      }
    },
    [config, toast],
  );

  // Page-wide drag & drop
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  const uploading = pending.some((p) => p.status === "uploading");
  const ready = pending.filter((p) => p.status === "ready" && p.file).map((p) => p.file!);
  const canSend = !streaming && !uploading && (draft.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    const text = draft.trim() || "Please review the attached file(s).";
    send(text, ready);
    setDraft("");
    setPending([]);
  };

  const activeConnectors = connectors.filter(
    (c) => c.status === "connected" && !prefs.disabledConnectors.includes(c.id),
  ).length;
  const ciOn = config?.code_interpreter !== "off" && prefs.codeInterpreter;

  return (
    <>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={34} />
            <strong>Drop files to attach</strong>
            <span>Word, Excel, PowerPoint, PDF, CSV, images · up to {config?.max_upload_mb ?? 100} MB each</span>
          </div>
        </div>
      )}
      <div className={clsx("composer", streaming && "is-streaming")}>
        {streaming && <div className="composer-progress" aria-hidden />}
        <div className="composer-inner">
          {pending.length > 0 && (
            <div className="composer-files">
              {pending.map((p) => (
                <div key={p.key} className={clsx("attach-chip", p.status)}>
                  {p.status === "uploading" ? (
                    <span className="file-icon"><Loader size={16} /></span>
                  ) : (
                    <FileIcon file={p.file ?? { id: null, name: p.name, mime: "", url: "", kind: "file" }} size={16} />
                  )}
                  <div className="attach-meta">
                    <span className="attach-name" title={p.name}>{p.name}</span>
                    <span className="attach-sub">{p.status === "error" ? p.error : p.status === "uploading" ? "Uploading…" : fmtBytes(p.size)}</span>
                  </div>
                  <button className="icon-btn subtle" title="Remove" onClick={() => setPending((x) => x.filter((i) => i.key !== p.key))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            id="composer-input"
            ref={inputRef}
            value={draft}
            rows={1}
            placeholder="Ask anything, or attach Word, Excel, PowerPoint or PDF files…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
          />
          <div className="composer-bar">
            <input ref={fileRef} type="file" multiple hidden accept={ACCEPT}
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <button className="icon-btn" title="Attach files" onClick={() => fileRef.current?.click()}>
              <Paperclip size={16} />
            </button>
            <span className="bar-sep" aria-hidden />
            <ModelDropdown />
            <EffortDropdown />
            <div className="tools-anchor">
              <button className={clsx("dd-trigger", toolsOpen && "active")} onClick={() => setToolsOpen((o) => !o)}
                title="Tools and data connectors">
                <SlidersHorizontal size={14} />
                <span className="dd-full">Tools</span>
                {ciOn && <span className="tool-flag" title="Code interpreter on">PY</span>}
                {activeConnectors > 0 && <span className="tool-flag" title="Connectors enabled">{activeConnectors}</span>}
              </button>
              {toolsOpen && <ToolsMenu onClose={() => setToolsOpen(false)} />}
            </div>
            <span className="composer-hint">Enter to send · Shift+Enter for new line</span>
            {streaming ? (
              <button className="send-btn stop" title="Stop" onClick={stop}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" title="Send" disabled={!canSend} onClick={submit}>
                <ArrowUp size={17} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
