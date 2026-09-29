import { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, Coins, Menu, Moon, ShieldCheck, Sparkles, Sun, Zap, FlaskConical } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { effortDescription, effortLabel, fmtCost } from "../lib/format";
import type { ModelInfo } from "../lib/types";

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open, close]);
  return ref;
}

const TIER_ICON: Record<string, typeof Sparkles> = { Flagship: Sparkles, Balanced: Brain, Fast: Zap };

function levelFor(m: ModelInfo, saved: Record<string, string>): string {
  const chosen = saved[m.id];
  return chosen && m.efforts.includes(chosen) ? chosen : m.default_effort;
}

function LevelBars({ index, count }: { index: number; count: number }) {
  return (
    <span className="effort-bars" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={clsx(i <= index && "on")} style={{ height: `${4 + (10 * i) / Math.max(count - 1, 1)}px` }} />
      ))}
    </span>
  );
}

/** Thinking level (reasoning effort) for the selected model. Each model remembers its own level. */
export function ThinkingPicker() {
  const { config, setPrefs, prefs } = useStore(useShallow((s) => ({ config: s.config, setPrefs: s.setPrefs, prefs: s.prefs })));
  const model = useStore((s) => s.model());
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const current = config?.models.find((m) => m.id === model);
  if (!current || !current.reasoning || current.efforts.length === 0) return null;
  const level = levelFor(current, prefs.efforts);
  const count = current.efforts.length;

  return (
    <div className="thinking-picker" ref={ref}>
      <button className={clsx("thinking-btn", open && "active")} onClick={() => setOpen((o) => !o)}
        title="Thinking level" aria-haspopup="menu" aria-expanded={open}>
        <Brain size={15} className="thinking-btn-icon" />
        <span className="thinking-btn-label">{effortLabel(level)}</span>
        <LevelBars index={current.efforts.indexOf(level)} count={count} />
        <ChevronDown size={14} className={clsx("chev", open && "open")} />
      </button>
      {open && (
        <div className="popover thinking-menu" role="menu">
          <div className="popover-label">Thinking level · {current.label}</div>
          {current.efforts.map((e, i) => (
            <button key={e} role="menuitemradio" aria-checked={e === level}
              className={clsx("thinking-option", e === level && "selected")}
              onClick={() => {
                setPrefs({ efforts: { ...prefs.efforts, [current.id]: e } });
                setOpen(false);
              }}>
              <LevelBars index={i} count={count} />
              <span className="thinking-option-text">
                <strong>
                  {effortLabel(e)}
                  {e === current.default_effort && <em>Default</em>}
                </strong>
                <span>{effortDescription(e)}</span>
              </span>
              {e === level && <Check size={16} className="model-check" />}
            </button>
          ))}
          <div className="thinking-menu-foot">
            Higher levels think longer before answering: better on hard problems, slower, and more output tokens.
            Each model remembers its own level.
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelPicker() {
  const { config, setPrefs, prefs } = useStore(useShallow((s) => ({ config: s.config, setPrefs: s.setPrefs, prefs: s.prefs })));
  const model = useStore((s) => s.model());
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const current = config?.models.find((m) => m.id === model);
  if (!config || !current) return null;
  const showUsage = useStore.getState().showUsage();

  return (
    <div className="model-picker" ref={ref}>
      <button className={clsx("model-btn", open && "active")} onClick={() => setOpen((o) => !o)}>
        <span className="model-name">{current.label}</span>
        <ChevronDown size={15} className={clsx("chev", open && "open")} />
      </button>
      {open && (
        <div className="popover model-menu">
          <div className="popover-label">Model</div>
          {config.models.map((m) => {
            const Icon = TIER_ICON[m.tier] ?? Sparkles;
            return (
              <button key={m.id} className={clsx("model-option", m.id === model && "selected")}
                onClick={() => {
                  setPrefs({ model: m.id });
                  setOpen(false);
                }}>
                <span className={clsx("model-icon", m.tier.toLowerCase())}><Icon size={16} /></span>
                <span className="model-text">
                  <strong>{m.label} <em>{m.tier}</em></strong>
                  <span>{m.description}</span>
                  {m.reasoning && (
                    <span className="model-level">
                      <Brain size={11} /> Thinking: {effortLabel(levelFor(m, prefs.efforts))}
                    </span>
                  )}
                  {showUsage && (
                    <span className="model-price">${m.pricing.input.toFixed(2)} in · ${m.pricing.output.toFixed(2)} out / 1M tokens</span>
                  )}
                </span>
                {m.id === model && <Check size={16} className="model-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { config, conversations, currentId, prefs, setPrefs, sidebarOpen, setSidebarOpen, setModal } = useStore(useShallow((s) => ({ config: s.config, conversations: s.conversations, currentId: s.currentId, prefs: s.prefs, setPrefs: s.setPrefs, sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen, setModal: s.setModal })));
  const showUsage = useStore((s) => s.showUsage());
  const conv = conversations.find((c) => c.id === currentId);
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const provider = config?.provider;

  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
          <Menu size={19} />
        </button>
      )}
      <ModelPicker />
      <ThinkingPicker />
      <div className="topbar-title">{conv?.title}</div>
      <div className="topbar-right">
        {showUsage && conv && conv.cost_usd > 0 && (
          <button className="chip-btn" onClick={() => setModal("usage")} title="Cost of this conversation">
            <Coins size={14} /> {fmtCost(conv.cost_usd)}
          </button>
        )}
        {provider && (
          <span className={clsx("env-badge", provider)} title={config?.provider_label}>
            {provider === "azure_gcc_high" ? <ShieldCheck size={13} /> : provider === "demo" ? <FlaskConical size={13} /> : <Zap size={13} />}
            <span>{provider === "azure_gcc_high" ? "GCC High" : provider === "demo" ? "Demo" : provider === "azure" ? "Azure" : "OpenAI · Test"}</span>
          </span>
        )}
        <button className="icon-btn" title="Toggle theme" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
