"""Sample MCP server: a (fictional) program-portfolio data source.

Use it to try the Connectors feature end to end before wiring up real Amentum
systems. All data below is synthetic.

    # stdio (the chatbot launches it for you)
    python mcp-servers/amentum-demo/server.py

    # Streamable HTTP on http://127.0.0.1:8765/mcp
    python mcp-servers/amentum-demo/server.py --http --port 8765
"""

from __future__ import annotations

import argparse
import json
from datetime import date

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server  # type: ignore[no-redef]

server = _Server(
    "Program Portfolio (sample)",
    instructions="Synthetic program portfolio data: programs, risks, milestones and labor hours. "
    "Use search_programs first to find program ids.",
)

PROGRAMS = [
    {"id": "PRG-1001", "name": "Harbor Logistics Modernization", "customer": "U.S. Navy", "sector": "Defense",
     "contract_value_musd": 412.5, "funded_musd": 268.0, "cpi": 1.04, "spi": 0.97, "status": "On track",
     "program_manager": "J. Alvarez", "start": "2024-03-01", "end": "2029-02-28"},
    {"id": "PRG-1002", "name": "Environmental Remediation - Site 7", "customer": "Department of Energy",
     "sector": "Environment", "contract_value_musd": 189.2, "funded_musd": 151.4, "cpi": 0.93, "spi": 0.91,
     "status": "At risk", "program_manager": "R. Chen", "start": "2023-06-15", "end": "2027-06-14"},
    {"id": "PRG-1003", "name": "Satellite Ground Systems Sustainment", "customer": "U.S. Space Force",
     "sector": "Space", "contract_value_musd": 276.8, "funded_musd": 120.3, "cpi": 1.01, "spi": 1.03,
     "status": "On track", "program_manager": "K. Okafor", "start": "2025-01-10", "end": "2030-01-09"},
    {"id": "PRG-1004", "name": "Fusion Research Facility Support", "customer": "Department of Energy",
     "sector": "Energy", "contract_value_musd": 98.6, "funded_musd": 71.9, "cpi": 0.98, "spi": 0.95,
     "status": "Watch", "program_manager": "S. Patel", "start": "2024-09-01", "end": "2028-08-31"},
    {"id": "PRG-1005", "name": "Rotary Wing Maintenance & Readiness", "customer": "U.S. Army", "sector": "Defense",
     "contract_value_musd": 534.0, "funded_musd": 402.7, "cpi": 1.06, "spi": 1.00, "status": "On track",
     "program_manager": "M. Brooks", "start": "2022-11-01", "end": "2027-10-31"},
]

RISKS = [
    {"program_id": "PRG-1002", "id": "R-17", "title": "Groundwater sampling backlog", "likelihood": 4, "impact": 4,
     "owner": "R. Chen", "mitigation": "Add second lab vendor; weekend shifts through Q4."},
    {"program_id": "PRG-1002", "id": "R-21", "title": "Permit renewal delay", "likelihood": 3, "impact": 5,
     "owner": "Legal", "mitigation": "Pre-submission meeting scheduled with state regulator."},
    {"program_id": "PRG-1004", "id": "R-05", "title": "Cryogenic supplier lead time", "likelihood": 3, "impact": 3,
     "owner": "S. Patel", "mitigation": "Qualify alternate supplier; buffer stock of 2 units."},
    {"program_id": "PRG-1001", "id": "R-09", "title": "Legacy ERP data quality", "likelihood": 2, "impact": 4,
     "owner": "J. Alvarez", "mitigation": "Data cleansing sprint before cutover."},
    {"program_id": "PRG-1005", "id": "R-02", "title": "Parts obsolescence (T700)", "likelihood": 2, "impact": 3,
     "owner": "M. Brooks", "mitigation": "Lifetime buy analysis in progress."},
]

MILESTONES = {
    "PRG-1001": [("Phase 2 cutover", "2026-11-15", "Planned"), ("Warehouse WMS go-live", "2026-08-01", "Complete")],
    "PRG-1002": [("Soil excavation complete", "2026-10-30", "Late"), ("Q3 regulator report", "2026-09-30", "Complete")],
    "PRG-1003": [("Ground station 3 upgrade", "2027-01-20", "Planned")],
    "PRG-1004": [("Magnet assembly support", "2026-12-05", "Planned")],
    "PRG-1005": [("Fleet readiness review", "2026-10-15", "Planned")],
}


def _program(program_id: str) -> dict:
    for p in PROGRAMS:
        if p["id"].lower() == program_id.lower():
            return p
    raise ValueError(f"Unknown program id {program_id}. Use search_programs to find valid ids.")


@server.tool()
def search_programs(query: str = "", sector: str = "") -> str:
    """Search the program portfolio by name, customer or sector. Returns matching programs as JSON."""
    q, s = query.lower(), sector.lower()
    rows = [p for p in PROGRAMS
            if (not q or q in json.dumps(p).lower()) and (not s or s in p["sector"].lower())]
    return json.dumps(rows, indent=2)


@server.tool()
def get_program_details(program_id: str) -> str:
    """Full details for one program including EVM metrics (CPI/SPI), risks and milestones."""
    p = dict(_program(program_id))
    p["risks"] = [r for r in RISKS if r["program_id"] == p["id"]]
    p["milestones"] = [{"name": n, "date": d, "status": st} for n, d, st in MILESTONES.get(p["id"], [])]
    return json.dumps(p, indent=2)


@server.tool()
def list_open_risks(min_score: int = 0) -> str:
    """List open risks across the portfolio with score = likelihood x impact (1-25)."""
    rows = []
    for r in RISKS:
        score = r["likelihood"] * r["impact"]
        if score >= min_score:
            rows.append({**r, "score": score, "program": _program(r["program_id"])["name"]})
    return json.dumps(sorted(rows, key=lambda r: -r["score"]), indent=2)


@server.tool()
def get_labor_hours(program_id: str, months: int = 6) -> str:
    """Monthly planned vs actual labor hours for a program (last N months, max 12)."""
    p = _program(program_id)
    seed = sum(ord(c) for c in p["id"])
    today = date.today()
    rows = []
    for i in range(min(max(months, 1), 12), 0, -1):
        m = (today.month - i - 1) % 12 + 1
        y = today.year + ((today.month - i - 1) // 12)
        planned = 18000 + (seed * 37 + i * 911) % 6000
        actual = int(planned * (0.9 + ((seed + i * 7) % 20) / 100))
        rows.append({"month": f"{y}-{m:02d}", "planned_hours": planned, "actual_hours": actual})
    return json.dumps({"program": p["name"], "hours": rows}, indent=2)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", action="store_true", help="serve Streamable HTTP instead of stdio")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    if a.http:
        try:
            server.run("streamable-http", host=a.host, port=a.port)
        except TypeError:  # mcp 1.x takes host/port from settings
            server.settings.host, server.settings.port = a.host, a.port
            server.run("streamable-http")
    else:
        server.run()
