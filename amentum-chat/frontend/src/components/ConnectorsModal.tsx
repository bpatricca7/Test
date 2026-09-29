import { useEffect, useState } from "react";
import { ArrowLeft, Braces, Briefcase, CircleCheck, CircleX, Database, Folder, Globe, Pencil, Plug, Plus, RefreshCw, Trash2, Wrench, X } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import type { Connector, ConnectorPreset } from "../lib/types";
import { Modal, Segmented, StatusDot, Switch } from "./ui";
import { OrbitSpinner } from "./ThinkingSpinner";

const PRESET_ICON: Record<string, typeof Plug> = { briefcase: Briefcase, globe: Globe, folder: Folder, database: Database };
const STATUS_LABEL: Record<string, string> = {
  connected: "Connected", connecting: "Connecting…", error: "Error", disconnected: "Disconnected", disabled: "Disabled",
};
const TRANSPORT_LABEL = { stdio: "Local command", http: "Streamable HTTP", sse: "HTTP + SSE" };

type Draft = {
  id?: string;
  name: string;
  description: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: [string, string][];
  headers: [string, string][];
  enabled: boolean;
};

const emptyDraft = (transport: Draft["transport"] = "http"): Draft => ({
  name: "", description: "", transport, command: "", args: "", cwd: "", url: "", env: [], headers: [], enabled: true,
});

function toDraft(c: Partial<Connector>, name?: string, description?: string): Draft {
  return {
    id: c.id, name: name ?? c.name ?? "", description: description ?? c.description ?? "",
    transport: c.transport ?? "http", command: c.command ?? "", args: (c.args ?? []).join("\n"), cwd: c.cwd ?? "",
    url: c.url ?? "", env: Object.entries(c.env ?? {}), headers: Object.entries(c.headers ?? {}), enabled: c.enabled ?? true,
  };
}

function fromDraft(d: Draft): Partial<Connector> {
  return {
    id: d.id, name: d.name.trim(), description: d.description.trim(), transport: d.transport, command: d.command.trim(),
    args: d.args.split("\n").map((a) => a.trim()).filter(Boolean), cwd: d.cwd.trim(), url: d.url.trim(),
    env: Object.fromEntries(d.env.filter(([k]) => k.trim())), headers: Object.fromEntries(d.headers.filter(([k]) => k.trim())),
    enabled: d.enabled,
  };
}

function KeyValues({ rows, onChange, keyPh, valPh }: { rows: [string, string][]; onChange: (r: [string, string][]) => void; keyPh: string; valPh: string }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input placeholder={keyPh} value={k} onChange={(e) => onChange(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <input placeholder={valPh} value={v} type={/token|key|secret|auth|pass/i.test(k) ? "password" : "text"}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <button className="icon-btn subtle" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button className="btn ghost small" onClick={() => onChange([...rows, ["", ""]])}><Plus size={13} /> Add</button>
    </div>
  );
}

function ServerCard({ c, canManage, onEdit }: { c: Connector; canManage: boolean; onEdit: () => void }) {
  const { loadConnectors, toast } = useStore(useShallow((s) => ({ loadConnectors: s.loadConnectors, toast: s.toast })));
  const [busy, setBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      loadConnectors();
    }
  };
  const status = busy ? "connecting" : c.status;
  return (
    <div className={clsx("server-card", status)}>
      <div className="server-head">
        <span className="server-icon"><Plug size={17} /></span>
        <div className="server-title">
          <strong>{c.name}</strong>
          <span className="server-sub">
            <StatusDot status={status} /> {STATUS_LABEL[status] ?? status}
            <span className="sep">·</span> {TRANSPORT_LABEL[c.transport]}
            {c.server_info?.version && <><span className="sep">·</span> v{c.server_info.version}</>}
          </span>
        </div>
        {canManage && (
          <div className="server-actions">
            <button className="icon-btn subtle" title="Reconnect" disabled={busy || !c.enabled}
              onClick={() => run(() => api.reconnectConnector(c.id))}><RefreshCw size={15} /></button>
            <button className="icon-btn subtle" title="Edit" onClick={onEdit}><Pencil size={15} /></button>
            <button className={clsx("icon-btn subtle", confirm && "danger")} title={confirm ? "Click again to remove" : "Remove"}
              onClick={() => (confirm ? run(() => api.deleteConnector(c.id)) : setConfirm(true))} onMouseLeave={() => setConfirm(false)}>
              <Trash2 size={15} />
            </button>
            <Switch checked={c.enabled} disabled={busy} onChange={(v) => run(() => api.updateConnector(c.id, { enabled: v }))} />
          </div>
        )}
      </div>
      {c.description && <p className="server-desc">{c.description}</p>}
      {c.status === "error" && c.error && <div className="server-error"><CircleX size={14} /> {c.error}</div>}
      {c.tools.length > 0 && (
        <>
          <button className="tools-toggle" onClick={() => setShowTools((s) => !s)}>
            <Wrench size={13} /> {c.tools.length} tool{c.tools.length === 1 ? "" : "s"} {showTools ? "▴" : "▾"}
          </button>
          {showTools && (
            <div className="tool-list">
              {c.tools.map((t) => (
                <div key={t.name} className="tool-item">
                  <code>{t.name}</code>
                  <span>{t.description}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConnectorForm({ initial, presets, allowStdio, onDone }: {
  initial: Draft; presets: ConnectorPreset[]; allowStdio: boolean; onDone: () => void;
}) {
  const { toast, loadConnectors } = useStore(useShallow((s) => ({ toast: s.toast, loadConnectors: s.loadConnectors })));
  const editing = !!initial.id;
  const [tab, setTab] = useState<"gallery" | "custom" | "json">(editing ? "custom" : "gallery");
  const [d, setD] = useState<Draft>(initial);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState<null | "test" | "save">(null);
  const [test, setTest] = useState<null | { ok: boolean; error: string; tools: Connector["tools"] }>(null);
  const up = (p: Partial<Draft>) => {
    setD({ ...d, ...p });
    setTest(null);
  };

  const doTest = async () => {
    setBusy("test");
    try {
      setTest(await api.testConnector(fromDraft(d)));
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message, tools: [] });
    } finally {
      setBusy(null);
    }
  };
  const doSave = async () => {
    setBusy("save");
    try {
      const saved = d.id ? await api.updateConnector(d.id, fromDraft(d)) : await api.addConnector(fromDraft(d));
      toast(saved.status === "connected" ? `${saved.name} connected · ${saved.tools.length} tools` : `${saved.name} saved (${saved.status})`,
        saved.status === "connected" ? "success" : "info");
      await loadConnectors();
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const doImport = async () => {
    setBusy("save");
    try {
      const res = await api.importConnectors(json);
      const ok = res.filter((r) => r.status === "connected").length;
      toast(`Imported ${res.length} connector(s), ${ok} connected`, ok ? "success" : "info");
      await loadConnectors();
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const valid = d.name.trim() && (d.transport === "stdio" ? d.command.trim() : /^https?:\/\//.test(d.url.trim()));

  return (
    <div className="connector-form">
      {!editing && (
        <Segmented value={tab} onChange={setTab} options={[
          { value: "gallery", label: "Gallery" }, { value: "custom", label: "Custom" }, { value: "json", label: <><Braces size={13} /> Paste JSON</> }]} />
      )}
      {tab === "gallery" && (
        <div className="preset-grid">
          {presets.map((p) => {
            const Icon = PRESET_ICON[p.icon] ?? Plug;
            return (
              <button key={p.key} className="preset" onClick={() => { setD(toDraft(p.config, p.name, p.description)); setTab("custom"); setTest(null); }}>
                <span className="preset-icon"><Icon size={18} /></span>
                <strong>{p.name}</strong>
                <span>{p.description}</span>
                <em>{TRANSPORT_LABEL[p.config.transport ?? "http"]}</em>
              </button>
            );
          })}
        </div>
      )}
      {tab === "json" && (
        <div className="form-grid">
          <label className="field full">
            <span>Paste an MCP configuration (Claude Desktop, VS Code or Cursor format)</span>
            <textarea className="mono" rows={11} value={json} onChange={(e) => setJson(e.target.value)}
              placeholder={`{\n  "mcpServers": {\n    "sharepoint": {\n      "url": "https://mcp.internal.amentum.com/sharepoint/mcp",\n      "headers": { "Authorization": "Bearer <token>" }\n    },\n    "files": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/Shares"]\n    }\n  }\n}`} />
          </label>
          <div className="form-actions full">
            <button className="btn primary" disabled={!json.trim() || !!busy} onClick={doImport}>
              {busy === "save" ? <OrbitSpinner size={16} /> : <Plus size={15} />} Import & connect
            </button>
          </div>
        </div>
      )}
      {tab === "custom" && (
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={d.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. SharePoint - Engineering" />
          </label>
          <label className="field">
            <span>Connection type</span>
            <Segmented value={d.transport} onChange={(v) => up({ transport: v })} options={[
              ...(allowStdio ? [{ value: "stdio" as const, label: "Local command" }] : []),
              { value: "http" as const, label: "HTTP" }, { value: "sse" as const, label: "SSE" }]} />
          </label>
          <label className="field full">
            <span>Description <em>- tells the assistant what data lives here</em></span>
            <input value={d.description} onChange={(e) => up({ description: e.target.value })}
              placeholder="Program schedules, risks and EVM metrics for all active contracts" />
          </label>
          {d.transport === "stdio" ? (
            <>
              <label className="field">
                <span>Command</span>
                <input className="mono" value={d.command} onChange={(e) => up({ command: e.target.value })} placeholder="npx, uvx, python, node…" />
              </label>
              <label className="field">
                <span>Working directory <em>(optional)</em></span>
                <input className="mono" value={d.cwd} onChange={(e) => up({ cwd: e.target.value })} />
              </label>
              <label className="field full">
                <span>Arguments <em>- one per line</em></span>
                <textarea className="mono" rows={3} value={d.args} onChange={(e) => up({ args: e.target.value })} />
              </label>
              <div className="field full">
                <span>Environment variables</span>
                <KeyValues rows={d.env} onChange={(env) => up({ env })} keyPh="NAME" valPh="value" />
              </div>
            </>
          ) : (
            <>
              <label className="field full">
                <span>Server URL</span>
                <input className="mono" value={d.url} onChange={(e) => up({ url: e.target.value })} placeholder="https://mcp.internal.amentum.com/mcp" />
              </label>
              <div className="field full">
                <span>Headers <em>- e.g. Authorization</em></span>
                <KeyValues rows={d.headers} onChange={(headers) => up({ headers })} keyPh="Header" valPh="value" />
              </div>
            </>
          )}
          {test && (
            <div className={clsx("test-result full", test.ok ? "ok" : "fail")}>
              {test.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
              <div>
                <strong>{test.ok ? `Connected · ${test.tools.length} tools available` : "Connection failed"}</strong>
                {test.ok ? (
                  <div className="tool-chips">{test.tools.slice(0, 16).map((t) => <code key={t.name}>{t.name}</code>)}</div>
                ) : <span>{test.error}</span>}
              </div>
            </div>
          )}
          <div className="form-actions full">
            <button className="btn ghost" disabled={!valid || !!busy} onClick={doTest}>
              {busy === "test" ? <OrbitSpinner size={16} /> : <Plug size={15} />} Test connection
            </button>
            <button className="btn primary" disabled={!valid || !!busy} onClick={doSave}>
              {busy === "save" ? <OrbitSpinner size={16} /> : <CircleCheck size={15} />} {editing ? "Save changes" : "Save & connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectorsModal() {
  const { setModal, connectors, loadConnectors, canManageConnectors } = useStore(useShallow((s) => ({ setModal: s.setModal, connectors: s.connectors, loadConnectors: s.loadConnectors, canManageConnectors: s.canManageConnectors })));
  const [view, setView] = useState<{ mode: "list" } | { mode: "form"; draft: Draft }>({ mode: "list" });
  const [meta, setMeta] = useState<{ presets: ConnectorPreset[]; allow_stdio: boolean }>({ presets: [], allow_stdio: true });

  useEffect(() => {
    api.connectors().then((r) => setMeta({ presets: r.presets, allow_stdio: r.allow_stdio })).catch(() => undefined);
    loadConnectors();
  }, [loadConnectors]);
  useEffect(() => {
    if (!connectors.some((c) => c.status === "connecting")) return;
    const t = setInterval(loadConnectors, 1500);
    return () => clearInterval(t);
  }, [connectors, loadConnectors]);

  const inForm = view.mode === "form";
  return (
    <Modal wide icon={<Plug size={18} />} onClose={() => setModal(null)}
      title={inForm ? (view.draft.id ? `Edit ${view.draft.name}` : "Add a data connector") : "Data connectors"}
      subtitle={inForm ? "Model Context Protocol (MCP) server" :
        "Connect MCP servers inside the Amentum network. Only the model call leaves the network - connector traffic stays internal."}>
      {inForm ? (
        <>
          <button className="btn ghost small back" onClick={() => setView({ mode: "list" })}><ArrowLeft size={14} /> All connectors</button>
          <ConnectorForm key={view.draft.id ?? "new"} initial={view.draft} presets={meta.presets} allowStdio={meta.allow_stdio}
            onDone={() => setView({ mode: "list" })} />
        </>
      ) : (
        <div className="server-list">
          {canManageConnectors && (
            <button className="add-connector" onClick={() => setView({ mode: "form", draft: emptyDraft(meta.allow_stdio ? "stdio" : "http") })}>
              <Plus size={17} /> Add connector
              <span>Gallery · custom · paste JSON</span>
            </button>
          )}
          {connectors.length === 0 && (
            <div className="empty-connectors">
              <Plug size={26} />
              <strong>No connectors yet</strong>
              <span>Start with the sample <em>Program Portfolio</em> source from the gallery to see MCP in action.</span>
            </div>
          )}
          {connectors.map((c) => (
            <ServerCard key={c.id} c={c} canManage={canManageConnectors} onEdit={() => setView({ mode: "form", draft: toDraft(c) })} />
          ))}
        </div>
      )}
    </Modal>
  );
}
