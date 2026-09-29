import { Coins, Moon, PanelLeft, ShieldCheck, Sun } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { fmtCost } from "../lib/format";

const ENV_LABEL: Record<string, string> = {
  azure_gcc_high: "GCC High",
  azure: "Azure",
  openai: "OpenAI · Test",
  demo: "Demo",
};

export function Header() {
  const { config, conversations, currentId, prefs, setPrefs, sidebarOpen, setSidebarOpen, setModal } = useStore(
    useShallow((s) => ({
      config: s.config, conversations: s.conversations, currentId: s.currentId, prefs: s.prefs, setPrefs: s.setPrefs,
      sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen, setModal: s.setModal,
    })),
  );
  const showUsage = useStore((s) => s.showUsage());
  const conv = conversations.find((c) => c.id === currentId);
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const provider = config?.provider;

  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
          <PanelLeft size={18} />
        </button>
      )}
      <div className="topbar-title">{conv?.title ?? "New conversation"}</div>
      <div className="topbar-right">
        {showUsage && conv && conv.cost_usd > 0 && (
          <button className="chip-btn mono" onClick={() => setModal("usage")} title="Cost of this conversation">
            <Coins size={13} /> {fmtCost(conv.cost_usd)}
          </button>
        )}
        {provider && (
          <span className={clsx("env-badge", provider)} title={config?.provider_label}>
            {provider === "azure_gcc_high" && <ShieldCheck size={12} />}
            <span className="env-dot" />
            <span className="env-text">{ENV_LABEL[provider] ?? provider}</span>
          </span>
        )}
        <button className="icon-btn" title="Toggle theme" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
