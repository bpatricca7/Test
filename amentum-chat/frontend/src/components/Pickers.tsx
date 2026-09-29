import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import type { ModelInfo } from "../lib/types";
import { effortDescription, effortLabel } from "../lib/format";

export function levelFor(m: ModelInfo, saved: Record<string, string>): string {
  const chosen = saved[m.id];
  return chosen && m.efforts.includes(chosen) ? chosen : m.default_effort;
}

export function LevelBars({ index, count }: { index: number; count: number }) {
  return (
    <span className="level-bars" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={clsx(i <= index && "on")} style={{ height: `${3 + (9 * i) / Math.max(count - 1, 1)}px` }} />
      ))}
    </span>
  );
}

/** Small dropdown anchored to the composer toolbar; opens upward. */
function Dropdown({ trigger, title, children, className, open, setOpen }: {
  trigger: ReactNode; title: string; children: ReactNode; className?: string;
  open: boolean; setOpen: (o: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  return (
    <div className={clsx("dd", className)} ref={ref}>
      <button type="button" className={clsx("dd-trigger", open && "active")} onClick={() => setOpen(!open)}
        title={title} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
        <ChevronDown size={13} className={clsx("chev", open && "open")} />
      </button>
      {open && (
        <div className="popover dd-menu" role="menu">
          <div className="popover-label">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

export function ModelDropdown() {
  const { config, setPrefs, prefs } = useStore(useShallow((s) => ({ config: s.config, setPrefs: s.setPrefs, prefs: s.prefs })));
  const model = useStore((s) => s.model());
  const showUsage = useStore((s) => s.showUsage());
  const [open, setOpen] = useState(false);
  const current = config?.models.find((m) => m.id === model);
  if (!config || !current) return null;
  const short = (label: string) => label.replace(/^GPT-[\d.]+\s*/i, "");

  return (
    <Dropdown open={open} setOpen={setOpen} className="dd-model" title="Model"
      trigger={<><span className="dd-full">{current.label}</span><span className="dd-short">{short(current.label)}</span></>}>
      {config.models.map((m) => (
        <button key={m.id} role="menuitemradio" aria-checked={m.id === model}
          className={clsx("dd-option", m.id === model && "selected")}
          onClick={() => {
            setPrefs({ model: m.id });
            setOpen(false);
          }}>
          <span className="dd-option-text">
            <strong>{m.label}<em>{m.tier}</em></strong>
            <span>{m.description}</span>
            <span className="dd-meta">
              {m.reasoning && <>Reasoning: {effortLabel(levelFor(m, prefs.efforts))}</>}
              {showUsage && <> · ${m.pricing.input.toFixed(2)} / ${m.pricing.output.toFixed(2)} per 1M</>}
            </span>
          </span>
          {m.id === model && <Check size={15} className="dd-check" />}
        </button>
      ))}
    </Dropdown>
  );
}

export function EffortDropdown() {
  const { config, setPrefs, prefs } = useStore(useShallow((s) => ({ config: s.config, setPrefs: s.setPrefs, prefs: s.prefs })));
  const model = useStore((s) => s.model());
  const [open, setOpen] = useState(false);
  const current = config?.models.find((m) => m.id === model);
  if (!current || !current.reasoning || current.efforts.length === 0) return null;
  const level = levelFor(current, prefs.efforts);
  const count = current.efforts.length;

  return (
    <Dropdown open={open} setOpen={setOpen} className="dd-effort" title={`Reasoning effort · ${current.label}`}
      trigger={<><LevelBars index={current.efforts.indexOf(level)} count={count} /><span className="dd-full">{effortLabel(level)}</span></>}>
      {current.efforts.map((e, i) => (
        <button key={e} role="menuitemradio" aria-checked={e === level}
          className={clsx("dd-option", e === level && "selected")}
          onClick={() => {
            setPrefs({ efforts: { ...prefs.efforts, [current.id]: e } });
            setOpen(false);
          }}>
          <LevelBars index={i} count={count} />
          <span className="dd-option-text">
            <strong>{effortLabel(e)}{e === current.default_effort && <em>Default</em>}</strong>
            <span>{effortDescription(e)}</span>
          </span>
          {e === level && <Check size={15} className="dd-check" />}
        </button>
      ))}
      <div className="dd-foot">Higher effort reasons longer: better on hard problems, slower, more output tokens. Saved per model.</div>
    </Dropdown>
  );
}
