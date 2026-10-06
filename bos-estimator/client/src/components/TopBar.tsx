import { useStore } from '../store';
import { useDerived } from '../derived';
import { api } from '../api';
import { n0, n1 } from '../fmt';
import { Num } from './Num';

export function TopBar() {
  const project = useStore((s) => s.project);
  const health = useStore((s) => s.health);
  const saving = useStore((s) => s.saving);
  const setProjectName = useStore((s) => s.setProjectName);
  const setFactorsOpen = useStore((s) => s.setFactorsOpen);
  const clearProject = useStore((s) => s.clearProject);
  const projectId = useStore((s) => s.projectId);
  const { est } = useDerived();
  const m = est?.metrics;
  return (
    <header className="topbar glass">
      <div className="brand">
        <div className="logo">BOS</div>
        <input value={project?.name ?? ''} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" title="Project name" />
        <span className="chip" title={health?.aiAvailable ? 'ANTHROPIC_API_KEY detected on the server' : 'Set ANTHROPIC_API_KEY on the server to enable Claude extraction'} style={{ color: health?.aiAvailable ? '#4ade80' : '#facc15' }}>
          {health == null ? '…' : health.aiAvailable ? 'Claude ready' : 'AI key missing'}
        </span>
        {saving && <span className="chip">saving…</span>}
      </div>
      <div className="metrics">
        <div className="metric"><span className="v"><Num value={m?.facilitiesCount ?? 0} format={n0} /></span><span className="l">Facilities</span></div>
        <div className="metric"><span className="v"><Num value={m?.grossSqft ?? 0} format={n0} /></span><span className="l">Gross SF</span></div>
        <div className="metric"><span className="v"><Num value={m?.cleanableSqft ?? 0} format={n0} /></span><span className="l">Cleanable SF</span></div>
        <div className="metric"><span className="v"><Num value={m?.acres ?? 0} format={n1} /></span><span className="l">Acres</span></div>
        <div className="metric"><span className="v"><Num value={m?.mealsPerYear ?? 0} format={n0} /></span><span className="l">Meals / yr</span></div>
        <div className="metric"><span className="v"><Num value={est?.directHours ?? 0} format={n0} /></span><span className="l">Direct hrs / yr</span></div>
        <div className="metric hero"><span className="v"><Num value={est?.totalFte ?? 0} format={(v) => `${n1(v)} FTE`} /></span><span className="l">{est ? `${est.totalHeadcount} heads · base year` : 'Manning'}</span></div>
      </div>
      <div className="actions">
        <button className="btn" onClick={() => setFactorsOpen(true)}>RS Means factors</button>
        <a className="btn" href={api.exportCsvUrl(projectId)} download>Export CSV</a>
        <button className="btn danger" onClick={() => { if (confirm('Clear all facilities, grounds and overrides for this project?')) void clearProject(); }}>Reset</button>
      </div>
    </header>
  );
}
