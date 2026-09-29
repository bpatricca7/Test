import { ArrowUpRight, Database, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { effortLabel } from "../lib/format";
import { levelFor } from "./Pickers";

const STARTERS = [
  {
    icon: FileSpreadsheet,
    title: "Analyze a workbook",
    body: "Trends, variances and a chart from an attached Excel file.",
    prompt: "Analyze the attached Excel workbook: summarize key trends, flag anomalies, and chart the most important metrics.",
  },
  {
    icon: FileText,
    title: "Edit a Word document",
    body: "Tighten the language, keep the formatting, produce a PDF.",
    prompt: "Edit the attached Word document for clarity and concision, keep the formatting, and give me a PDF printout.",
  },
  {
    icon: Presentation,
    title: "Draft a briefing deck",
    body: "Turn notes into a clean PowerPoint for leadership.",
    prompt: "Create a 5-slide PowerPoint briefing from these notes:\n\n",
  },
  {
    icon: Database,
    title: "Query a data source",
    body: "Ask a connected system, such as the program portfolio.",
    prompt: "Which programs have the highest open risks right now, and what are the mitigations?",
  },
];

export function EmptyState() {
  const { config, setDraft, prefs, connectors } = useStore(
    useShallow((s) => ({ config: s.config, setDraft: s.setDraft, prefs: s.prefs, connectors: s.connectors })),
  );
  const modelId = useStore((s) => s.model());
  const model = config?.models.find((m) => m.id === modelId);
  const first = (config?.user.name ?? "").split(" ")[0];
  const connected = connectors.filter((c) => c.status === "connected").length;
  const ciOn = config?.code_interpreter !== "off" && prefs.codeInterpreter;

  return (
    <div className="empty">
      <div className="empty-head">
        <p className="eyebrow">{config?.app_name ?? "Amentum AI"}</p>
        <h1 className="empty-title">
          {first && first.toLowerCase() !== "local" ? `What are we working on, ${first}?` : "What are we working on?"}
        </h1>
        <p className="empty-sub">
          Ask a question, attach Word, Excel or PowerPoint files, or pull from a connected data source.
        </p>
      </div>

      <div className="starters">
        {STARTERS.map((s, i) => (
          <button key={s.title} className="starter" onClick={() => {
            setDraft(s.prompt);
            document.getElementById("composer-input")?.focus();
          }}>
            <span className="starter-index">{String(i + 1).padStart(2, "0")}</span>
            <s.icon size={17} className="starter-icon" />
            <span className="starter-text">
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </span>
            <ArrowUpRight size={15} className="starter-go" />
          </button>
        ))}
      </div>

      <dl className="readout">
        <div><dt>Model</dt><dd>{model?.label ?? "—"}</dd></div>
        <div><dt>Reasoning</dt><dd>{model?.reasoning ? effortLabel(levelFor(model, prefs.efforts)) : "Off"}</dd></div>
        <div><dt>Code interpreter</dt><dd>{ciOn ? "On" : "Off"}</dd></div>
        <div><dt>Connectors</dt><dd>{connected}</dd></div>
        <div><dt>Environment</dt><dd>{config?.provider_label}</dd></div>
      </dl>
    </div>
  );
}
