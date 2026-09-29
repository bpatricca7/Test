import { useEffect, useState } from "react";
import { Activity, CircleCheck, CircleX, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api, type Diagnostics } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { Modal, Segmented, Switch } from "./ui";
import { Loader } from "./ThinkingSpinner";

export function SettingsModal() {
  const { setModal, prefs, setPrefs, config } = useStore(useShallow((s) => ({ setModal: s.setModal, prefs: s.prefs, setPrefs: s.setPrefs, config: s.config })));
  const showUsage = useStore((s) => s.showUsage());
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    api.diagnostics(false).then(setDiag).catch(() => undefined);
  }, []);

  const probe = async () => {
    setProbing(true);
    try {
      setDiag(await api.diagnostics(true));
    } finally {
      setProbing(false);
    }
  };

  const rows: [string, string | undefined][] = diag
    ? [
        ["Provider", String(diag.llm.label ?? "")],
        ["Endpoint", String(diag.llm.host ?? "")],
        ["Authentication", String(diag.llm.auth ?? "")],
        ...(diag.llm.authority ? [["Entra authority", String(diag.llm.authority)] as [string, string]] : []),
        ...(diag.llm.api_style ? [["Azure API", `${diag.llm.api_style}${diag.llm.api_version ? ` (${diag.llm.api_version})` : ""}`] as [string, string]] : []),
        ["Outbound proxy / custom CA", `${diag.llm.proxy ? "proxy" : "direct"} · ${diag.llm.custom_ca ? "custom CA" : "system CAs"}`],
        ["Code interpreter", `${diag.code_interpreter}${diag.sandbox?.mode ? ` · ${diag.sandbox.mode} sandbox` : ""}${diag.sandbox?.libreoffice ? " · PDF export ready" : ""}`],
        ["Connectors", `${diag.connectors.connected} of ${diag.connectors.total} connected`],
      ]
    : [];

  return (
    <Modal title="Settings" icon={<Settings size={18} />} onClose={() => setModal(null)}>
      <div className="settings">
        <section>
          <h4>Appearance</h4>
          <div className="setting-row">
            <div><strong>Theme</strong><span>Dark is tuned for long sessions; light for bright offices.</span></div>
            <Segmented value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[
              { value: "system", label: <><Monitor size={13} /> Auto</> }, { value: "dark", label: <><Moon size={13} /> Dark</> },
              { value: "light", label: <><Sun size={13} /> Light</> }]} />
          </div>
          <div className="setting-row">
            <div><strong>Expand thinking by default</strong><span>Keep reasoning traces open after the answer arrives.</span></div>
            <Switch checked={prefs.expandThinking} onChange={(v) => setPrefs({ expandThinking: v })} />
          </div>
          <div className="setting-row">
            <div><strong>Show usage & cost</strong><span>Tokens, reasoning tokens and estimated cost for every answer.</span></div>
            <Switch checked={showUsage} onChange={(v) => setPrefs({ showUsage: v })} />
          </div>
        </section>

        <section>
          <div className="section-head">
            <h4>System status</h4>
            <button className="btn ghost small" onClick={probe} disabled={probing}>
              {probing ? <Loader size={14} /> : <Activity size={14} />} Test model connection
            </button>
          </div>
          {!diag && <div className="center-pad"><Loader size={20} /></div>}
          {diag && (
            <dl className="status-grid">
              {rows.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
          {diag?.probe && (
            <div className={`test-result ${diag.probe.ok ? "ok" : "fail"}`}>
              {diag.probe.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
              <div>
                <strong>{diag.probe.ok ? `Model reachable · ${diag.probe.latency_ms} ms` : "Model call failed"}</strong>
                <span>{diag.probe.ok ? `Deployment ${diag.probe.model}` : diag.probe.error}</span>
              </div>
            </div>
          )}
          {(diag?.problems ?? config?.problems ?? []).map((p) => (
            <div key={p} className="notice warning">{p}</div>
          ))}
        </section>
        <p className="settings-foot">
          Signed in as <strong>{config?.user.id}</strong>{config?.user.is_admin ? " · administrator" : ""}
        </p>
      </div>
    </Modal>
  );
}
