import { useEffect, useMemo, useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { api, type UsageReport, type UsageRow } from "../lib/api";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { fmtCost, fmtInt, fmtTokens } from "../lib/format";
import { Modal, Segmented } from "./ui";
import { OrbitSpinner } from "./ThinkingSpinner";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function fillDays(rows: UsageRow[], days: number): UsageRow[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: UsageRow[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(map.get(key) ?? { day: key, requests: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cost_usd: 0, calls: 0 });
  }
  return out;
}

/** Daily spend: single-series column chart with per-column hover tooltip. */
function DailyChart({ rows }: { rows: UsageRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, padL = 52, padR = 12, padT = 14, padB = 28;
  const max = niceMax(Math.max(...rows.map((r) => r.cost_usd), 0));
  const band = (W - padL - padR) / rows.length;
  const barW = Math.min(24, Math.max(3, band - 2));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(rows.length / 8);
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Daily spend">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="tick" textAnchor="end">{fmtCost(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + band * i + (band - barW) / 2;
          const top = y(r.cost_usd);
          const hgt = Math.max(0, y(0) - top);
          const rad = Math.min(4, hgt, barW / 2);
          const path = hgt > 0
            ? `M${x},${y(0)} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + barW - rad} Q${x + barW},${top} ${x + barW},${top + rad} V${y(0)} Z`
            : "";
          return (
            <g key={r.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} className="hit" />
              {path && <path d={path} className={hover === i ? "bar hover" : "bar"} />}
              {i % labelEvery === 0 && (
                <text x={padL + band * i + band / 2} y={H - 8} className="tick" textAnchor="middle">
                  {new Date(`${r.day}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="axis" />
      </svg>
      {h && hover !== null && (
        <div className="chart-tip" style={(() => {
          const pct = ((padL + band * hover + band / 2) / W) * 100;
          const shift = pct > 80 ? "-100%" : pct < 20 ? "0%" : "-50%";
          return { left: `${pct}%`, transform: `translate(${shift}, -4px)` };
        })()}>
          <strong>{new Date(`${h.day}T00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</strong>
          <span>{fmtCost(h.cost_usd)} · {fmtInt(h.requests)} requests</span>
          <span>{fmtTokens(h.input_tokens + h.output_tokens)} tokens</span>
        </div>
      )}
    </div>
  );
}

export function UsageModal() {
  const { setModal, config } = useStore(useShallow((s) => ({ setModal: s.setModal, config: s.config })));
  const [days, setDays] = useState("30");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.usage(Number(days), scope).then(setData).catch((e) => setError(e.message));
  }, [days, scope]);

  const daily = useMemo(() => (data ? fillDays(data.by_day, Number(days)) : []), [data, days]);
  const t = data?.totals;
  const totalCost = t?.cost_usd ?? 0;

  return (
    <Modal wide title="Usage & cost" subtitle="Token consumption and estimated spend, priced from config/models.json"
      icon={<ChartColumn size={18} />} onClose={() => setModal(null)}>
      <div className="usage-filters">
        <Segmented value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        {config?.user.is_admin && (
          <Segmented value={scope} onChange={(v) => setScope(v as "me" | "all")} options={[{ value: "me", label: "Me" }, { value: "all", label: "Organization" }]} />
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      {!data && !error && <div className="center-pad"><OrbitSpinner size={36} /></div>}
      {data && t && (
        <>
          <div className="stat-row">
            <div className="stat hero">
              <span className="stat-label">Estimated spend</span>
              <span className="stat-value">{fmtCost(totalCost)}</span>
              <span className="stat-note">last {days} days</span>
            </div>
            <div className="stat">
              <span className="stat-label">Requests</span>
              <span className="stat-value">{fmtInt(t.requests)}</span>
              <span className="stat-note">{fmtInt(t.calls)} model calls</span>
            </div>
            <div className="stat">
              <span className="stat-label">Tokens</span>
              <span className="stat-value">{fmtTokens(t.input_tokens + t.output_tokens)}</span>
              <span className="stat-note">{fmtTokens(t.cached_tokens)} cached · {fmtTokens(t.reasoning_tokens)} reasoning</span>
            </div>
            <div className="stat">
              <span className="stat-label">Avg per request</span>
              <span className="stat-value">{fmtCost(t.requests ? totalCost / t.requests : 0)}</span>
              <span className="stat-note">{fmtTokens(t.requests ? (t.input_tokens + t.output_tokens) / t.requests : 0)} tokens</span>
            </div>
          </div>

          <div className="panel-card">
            <div className="panel-card-head">
              <h4>Daily spend</h4>
              <Segmented value={view} onChange={setView} options={[
                { value: "chart", label: <ChartColumn size={14} /> }, { value: "table", label: <Table2 size={14} /> }]} />
            </div>
            {view === "chart" ? <DailyChart rows={daily} /> : (
              <div className="table-wrap tall">
                <table className="data-table">
                  <thead><tr><th>Day</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead>
                  <tbody>
                    {daily.filter((r) => r.calls > 0).reverse().map((r) => (
                      <tr key={r.day}><td>{r.day}</td><td>{fmtInt(r.requests)}</td><td>{fmtInt(r.input_tokens)}</td>
                        <td>{fmtInt(r.output_tokens)}</td><td>{fmtCost(r.cost_usd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel-card">
            <div className="panel-card-head"><h4>By model</h4></div>
            <table className="data-table">
              <thead><tr><th>Model</th><th>Requests</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning</th><th>Cost</th><th className="share-col">Share</th></tr></thead>
              <tbody>
                {data.by_model.map((r) => (
                  <tr key={r.model}>
                    <td><strong>{data.labels[r.model!] ?? r.model}</strong></td>
                    <td>{fmtInt(r.requests)}</td><td>{fmtTokens(r.input_tokens)}</td><td>{fmtTokens(r.cached_tokens)}</td>
                    <td>{fmtTokens(r.output_tokens)}</td><td>{fmtTokens(r.reasoning_tokens)}</td><td>{fmtCost(r.cost_usd)}</td>
                    <td className="share-col"><span className="share-bar"><i style={{ width: `${totalCost ? (r.cost_usd / totalCost) * 100 : 0}%` }} /></span></td>
                  </tr>
                ))}
                {data.by_model.length === 0 && <tr><td colSpan={8} className="muted">No usage in this period yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {scope === "all" && data.by_user.length > 0 && (
            <div className="panel-card">
              <div className="panel-card-head"><h4>By user</h4></div>
              <table className="data-table">
                <thead><tr><th>User</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr></thead>
                <tbody>
                  {data.by_user.map((r) => (
                    <tr key={r.user}><td>{r.user}</td><td>{fmtInt(r.requests)}</td>
                      <td>{fmtTokens(r.input_tokens + r.output_tokens)}</td><td>{fmtCost(r.cost_usd)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
