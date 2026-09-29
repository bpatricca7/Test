import { FileSpreadsheet, FileText, Plug, Presentation } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { greeting } from "../lib/format";
import { BrandMark } from "./Brand";

const SUGGESTIONS = [
  { icon: FileSpreadsheet, color: "#1fae5f", title: "Analyze a workbook", body: "Attach an Excel file and get trends, pivots and a chart", prompt: "Analyze the attached Excel workbook: summarize key trends, flag anomalies, and chart the most important metrics." },
  { icon: FileText, color: "#3b82f6", title: "Edit a Word document", body: "Tighten the language, fix formatting, export a PDF printout", prompt: "Edit the attached Word document for clarity and concision, keep the formatting, and give me a PDF printout." },
  { icon: Presentation, color: "#ea6a2e", title: "Build a briefing deck", body: "Turn notes into a clean PowerPoint for leadership", prompt: "Create a 5-slide PowerPoint briefing from these notes:\n\n" },
  { icon: Plug, color: "#8a7cf6", title: "Ask your data", body: "Query connected sources like the program portfolio", prompt: "Which programs have the highest open risks right now, and what are the mitigations?" },
];

export function EmptyState() {
  const { config, setDraft } = useStore(useShallow((s) => ({ config: s.config, setDraft: s.setDraft })));
  return (
    <div className="empty">
      <div className="hero-mark">
        <div className="hero-rings" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <BrandMark size={76} animated />
      </div>
      <h1 className="hero-title">
        {greeting(config?.user.name ?? "")}
        <span className="gradient-text">.</span>
      </h1>
      <p className="hero-sub">{config?.tagline}</p>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="suggestion" onClick={() => { setDraft(s.prompt); document.getElementById("composer-input")?.focus(); }}>
            <span className="suggestion-icon" style={{ color: s.color, background: `${s.color}1c` }}>
              <s.icon size={18} />
            </span>
            <strong>{s.title}</strong>
            <span>{s.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
