"""Scripted behaviour for the demo simulator.

Given the conversation input and the available tools, decide what the fake
model "does": think, call the code interpreter or a connector, and answer.
Everything here is deterministic so the demo is reproducible.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

FILE_LINE = re.compile(r"^- (.+?) \((Word document|spreadsheet|PowerPoint deck|PDF|text file|code/data file|file|archive|image), ")


@dataclass
class Plan:
    reasoning: list[str] = field(default_factory=list)  # one entry per summary part
    call: tuple[str, dict[str, Any]] | None = None
    text: str = ""


def _files(text: str) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        m = FILE_LINE.match(line.strip())
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def _code_for_files(files: list[tuple[str, str]], wants_edit: bool, wants_pdf: bool) -> str:
    lines = ["import os", "import pandas as pd", "import matplotlib.pyplot as plt", "", "print('Files in workspace:')",
             "for f in sorted(os.listdir('.')):", "    print(f'  {f:40s} {os.path.getsize(f):>10,} bytes')", ""]
    for name, kind in files:
        q = json.dumps(name)
        if kind == "spreadsheet":
            reader = "pd.read_csv" if name.lower().endswith((".csv", ".tsv")) else "pd.read_excel"
            lines += [
                f"df = {reader}({q})",
                f"print('\\n=== ' + {q} + ' ===')",
                "print(df.shape[0], 'rows x', df.shape[1], 'columns')",
                "print(df.head(10).to_string())",
                "if df.shape[1] > 1 and not pd.api.types.is_numeric_dtype(df[df.columns[0]]): df = df.set_index(df.columns[0])",
                "num = df.select_dtypes('number')",
                "if not num.empty:",
                "    print('\\nSummary statistics:')",
                "    print(num.describe().round(2).to_string())",
                "    num.iloc[:, : min(4, num.shape[1])].head(20).plot(kind='bar', title=" + q + ")",
                "    plt.xticks(rotation=0); plt.tight_layout(); plt.show()",
            ]
            if wants_edit:
                out = name.rsplit(".", 1)[0] + "_analysis.xlsx"
                lines += [
                    f"with pd.ExcelWriter({json.dumps(out)}, engine='openpyxl') as xw:",
                    "    df.to_excel(xw, sheet_name='Data')",
                    "    if not num.empty: num.describe().to_excel(xw, sheet_name='Summary')",
                    f"print('Saved', {json.dumps(out)})",
                ]
        elif kind == "Word document" and name.lower().endswith(".docx"):
            lines += [
                "import docx",
                f"doc = docx.Document({q})",
                "paras = [p.text for p in doc.paragraphs if p.text.strip()]",
                f"print('\\n=== ' + {q} + ' ===')",
                "print(len(paras), 'paragraphs,', len(doc.tables), 'tables')",
                "for p in paras[:8]: print(' -', p[:120])",
            ]
            if wants_edit or wants_pdf:
                out = name.rsplit(".", 1)[0] + "_edited.docx"
                lines += [
                    "doc.paragraphs[0].insert_paragraph_before('Reviewed with Amentum AI (demo mode)')",
                    f"doc.save({json.dumps(out)})",
                    f"print('Saved', {json.dumps(out)})",
                ]
                if wants_pdf:
                    lines += [f"print('PDF:', to_pdf({json.dumps(out)}))"]
        elif kind == "PowerPoint deck" and name.lower().endswith(".pptx"):
            lines += [
                "from pptx import Presentation",
                f"prs = Presentation({q})",
                f"print('\\n=== ' + {q} + ' ===')",
                "for i, s in enumerate(prs.slides, 1):",
                "    title = s.shapes.title.text if s.shapes.title is not None else '(no title)'",
                "    print(f'Slide {i}: {title}')",
            ]
            if wants_edit:
                out = name.rsplit(".", 1)[0] + "_edited.pptx"
                lines += [
                    "layout = prs.slide_layouts[1] if len(prs.slide_layouts) > 1 else prs.slide_layouts[0]",
                    "slide = prs.slides.add_slide(layout)",
                    "if slide.shapes.title is not None: slide.shapes.title.text = 'Summary (added by Amentum AI)'",
                    f"prs.save({json.dumps(out)})",
                    f"print('Saved', {json.dumps(out)})",
                ]
        elif kind == "PDF":
            lines += [
                "from pypdf import PdfReader",
                f"r = PdfReader({q})",
                f"print('\\n=== ' + {q} + ' ===', len(r.pages), 'pages')",
                "print((r.pages[0].extract_text() or '')[:800])",
            ]
    return "\n".join(lines)


CHART_CODE = """import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

months = pd.period_range("2026-01", periods=9, freq="M").astype(str)
rng = np.random.default_rng(7)
df = pd.DataFrame({
    "Month": months,
    "Planned hours": rng.integers(18_000, 22_000, len(months)),
})
df["Actual hours"] = (df["Planned hours"] * rng.uniform(0.88, 1.07, len(months))).round().astype(int)
df["Variance %"] = ((df["Actual hours"] / df["Planned hours"] - 1) * 100).round(1)
print(df.to_string(index=False))

ax = df.plot(x="Month", y=["Planned hours", "Actual hours"], kind="bar", title="Labor hours: planned vs actual")
ax.set_ylabel("Hours"); plt.xticks(rotation=0); plt.tight_layout(); plt.show()

with pd.ExcelWriter("labor_hours_demo.xlsx", engine="openpyxl") as xw:
    df.to_excel(xw, sheet_name="Hours", index=False)
    xw.sheets["Hours"].freeze_panes = "A2"
print("Saved labor_hours_demo.xlsx")
"""

SHOWCASE = """### {title}

You're running **{app} in demo mode** - responses come from the built-in simulator, so you can explore the \
interface without any API keys. Switch `LLM_PROVIDER` to `openai` on your PC, or `azure_gcc_high` at work, and the \
exact same interface talks to GPT-5.6.

**What you can try**

| Capability | How to try it |
|---|---|
| Thinking traces | Expand the *Thought for …* panel above this answer |
| Code interpreter | Ask for *"a chart of planned vs actual hours"* |
| Office files | Attach a Word, Excel or PowerPoint file and ask to analyse or edit it |
| Data connectors | Open **Connectors**, add the sample *Program Portfolio*, then ask about program risks |
| Cost tracking | Toggle **Show usage** in Settings to see tokens and cost per answer |

```python
# Your question, echoed back by the simulator
question = {question!r}
```

> Tip: every answer can be copied, and generated files come with **Download**, **Preview** and **Print** buttons."""


def plan_for(user_text: str, tool_names: list[str], after_tool: str | None, tool_name_used: str | None) -> Plan:
    text = user_text or ""
    low = text.lower()
    has_python = "python" in tool_names
    mcp_tools = [t for t in tool_names if t.startswith("mcp__")]

    if after_tool is not None:
        snippet = after_tool.strip()
        if len(snippet) > 1500:
            snippet = snippet[:1500] + "\n…"
        if tool_name_used == "python":
            files = re.findall(r"Files created/updated[^:]*: (.+)", after_tool)
            names = re.findall(r"([^,]+?) \([\d,]+ bytes\)", files[0]) if files else []
            made = ("\n\n**Files ready:** " + ", ".join(f"`{n.strip()}`" for n in names)) if names else ""
            err = "ERROR" in after_tool
            m = re.search(r"stdout:\n(.*?)(?:\n\n(?:result:|stderr:|ERROR|Files created|\[)|\Z)", after_tool, re.S)
            snippet = (m.group(1) if m else snippet).strip()
            lines = snippet.splitlines()
            if len(lines) > 24:
                snippet = "\n".join(lines[:24] + ["…"])
            return Plan(
                reasoning=["**Reviewing the output**\n\nThe code ran; I'll summarise the key figures and point the "
                           "user to any files it produced." if not err else
                           "**Handling an error**\n\nThe code raised an error. In demo mode I'll report it instead "
                           "of retrying."],
                text=("Done - here's the key output from the code interpreter:\n\n```text\n" + snippet + "\n```" + made +
                      ("\n\nUse the buttons on the file cards above to **download**, **preview** or **print** them."
                       if names else "")),
            )
        return Plan(
            reasoning=["**Interpreting connector data**\n\nThe connector returned structured records. I'll pull out the "
                       "highest-priority items and present them as a table."],
            text=_connector_answer(after_tool),
        )

    files = _files(text)
    wants_edit = any(w in low for w in ("edit", "update", "modify", "add", "create", "save", "export", "fix", "rewrite"))
    wants_pdf = any(w in low for w in ("pdf", "print", "printout"))
    if has_python and files:
        return Plan(
            reasoning=[
                "**Inspecting the uploaded files**\n\nThe user attached "
                + ", ".join(f"`{n}`" for n, _ in files)
                + ". I'll open each one with the right library (pandas/openpyxl, python-docx, python-pptx) to "
                "understand its structure before answering.",
                "**Planning the output**\n\nI'll print a concise summary, chart any numeric data, and save "
                "edited copies as new files so the originals stay untouched.",
            ],
            call=("python", {"code": _code_for_files(files, wants_edit, wants_pdf)}),
        )
    if has_python and any(w in low for w in ("chart", "plot", "graph", "excel", "spreadsheet", "calculate", "python",
                                             "analy", "visual", "hours")):
        return Plan(
            reasoning=[
                "**Framing the analysis**\n\nThe user wants a quantitative view. I'll build a small dataset, compute "
                "the variance, and visualise planned vs actual values.",
                "**Choosing the chart**\n\nA grouped bar chart makes month-by-month comparison easiest. I'll also "
                "export the table to Excel with a frozen header row.",
            ],
            call=("python", {"code": CHART_CODE}),
        )
    if mcp_tools and any(w in low for w in ("program", "portfolio", "risk", "connector", "contract", "milestone",
                                            "labor", "data source")):
        tool = next((t for t in mcp_tools if "risk" in t), None) if "risk" in low else None
        tool = tool or next((t for t in mcp_tools if "search" in t), mcp_tools[0])
        args: dict[str, Any] = {"min_score": 6} if "risk" in tool else {}
        return Plan(
            reasoning=["**Picking a data source**\n\nThis question is about program data, and a connector for it is "
                       f"available. I'll call `{tool.split('__')[-1]}` rather than guess."],
            call=(tool, args),
        )
    title = "Hello from Amentum AI" if len(low) < 40 else "Here's how I'd approach this"
    return Plan(
        reasoning=[
            "**Understanding the request**\n\nThe user asked: \"" + text[:160].replace("\n", " ") + "\". No files or "
            "connectors are needed, so I'll answer directly.",
            "**Structuring the answer**\n\nA short overview plus a table of capabilities will be the most useful "
            "format here.",
        ],
        text=SHOWCASE.format(title=title, app="Amentum AI", question=text[:200]),
    )


def _connector_answer(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return "The connector returned:\n\n```text\n" + raw[:1500] + "\n```"
    rows = data if isinstance(data, list) else data.get("hours") or [data]
    if not rows or not isinstance(rows[0], dict):
        return "```json\n" + json.dumps(data, indent=2)[:1500] + "\n```"
    cols = [c for c in rows[0].keys() if not isinstance(rows[0][c], (list, dict))][:6]
    table = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    for r in rows[:10]:
        table += "| " + " | ".join(str(r.get(c, "")) for c in cols) + " |\n"
    return ("Here's what the **Program Portfolio** connector returned (synthetic sample data):\n\n" + table +
            f"\n{len(rows)} record(s) in total. Ask a follow-up to drill into any program.")


def title_for(prompt: str) -> str:
    msg = prompt.split("Message:", 1)[-1].strip()
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", msg)
    stop = {"the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "me", "my", "please", "can", "you",
            "could", "would", "this", "that", "is", "are", "i", "it", "what", "how"}
    keep = [w for w in words if w.lower() not in stop][:5] or ["New", "conversation"]
    return " ".join(w.capitalize() if w.islower() else w for w in keep)
