import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { CREWS, FACTORS, crewMeta, type FrequencyRule } from '@shared/factors';
import { unitLabel } from '../fmt';

const freqLabel = (f: FrequencyRule) => {
  switch (f.kind) {
    case 'per_service_day': return 'each service day';
    case 'per_year': return `${f.times}× / yr`;
    case 'mow_cycles': return f.multiplier === 1 ? 'each mowing cycle' : `${f.multiplier}× mowing cycles`;
    case 'snow_events': return 'per snow event';
    case 'leaf_season': return '3× / yr (cold & temperate)';
    case 'dining_days': return 'each operating day';
    case 'dining_meal_periods': return 'each meal period';
    case 'per_meal': return 'per meal served';
  }
};

export function FactorsModal() {
  const open = useStore((s) => s.factorsOpen);
  const setOpen = useStore((s) => s.setFactorsOpen);
  const overrides = useStore((s) => s.project?.factorOverrides ?? {});
  const setOverride = useStore((s) => s.setFactorOverride);
  const [q, setQ] = useState('');
  const groups = useMemo(() => CREWS.map((c) => ({ crew: c, factors: FACTORS.filter((f) => f.crew === c.id && (!q || `${f.name} ${f.ref} ${f.id}`.toLowerCase().includes(q.toLowerCase()))) })).filter((g) => g.factors.length), [q]);
  if (!open) return null;
  const overridden = Object.keys(overrides).length;
  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>RS Means-style productivity factors</h2>
          <span className="chip">{FACTORS.length} lines · {overridden} overridden</span>
          <input className="search" style={{ width: 260, margin: 0 }} placeholder="Filter tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn close" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="body">
          <div className="side">
            <div className="note">
              <b>How these are used.</b> Every line is a labor-hour-per-unit productivity rate in the format of RSMeans Facilities Maintenance &amp; Repair data (task · crew · unit · frequency). Annual hours = quantity × rate × occurrences per year. FTE = hours ÷ productive hours per FTE.
              <br /><br />
              <b>Reconcile before bidding.</b> RSMeans data is licensed; the defaults here are representative BOS estimating values. Open your current RSMeans edition (or your historical productivity) and type the licensed value into the override column. Overrides are saved with the project and highlighted in yellow throughout the app.
              <br /><br />
              Category defaults (floor mix, cleanable share, fixtures per 1,000 SF) live in <code>shared/factors.ts</code>.
            </div>
            <div style={{ marginTop: 12 }}>
              {CREWS.map((c) => <div key={c.id} className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12 }}><span className="dot" style={{ background: c.color }} />{c.label}<span style={{ marginLeft: 'auto', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>{String(Math.floor(c.shift.start)).padStart(2, '0')}:{String(Math.round((c.shift.start % 1) * 60)).padStart(2, '0')}–{String(Math.floor(c.shift.end)).padStart(2, '0')}:{String(Math.round((c.shift.end % 1) * 60)).padStart(2, '0')}</span></div>)}
            </div>
            {overridden > 0 && <button className="btn sm danger" style={{ marginTop: 12 }} onClick={() => { for (const k of Object.keys(overrides)) setOverride(k, null); }}>Reset all overrides</button>}
          </div>
          <div className="main">
            <table className="lines">
              <thead><tr><th>Task</th><th>RS Means reference</th><th>Unit</th><th>Frequency</th><th className="num">Default LH/unit</th><th className="num">Override</th><th /></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <GroupBlock key={g.crew.id} crewId={g.crew.id} factors={g.factors} overrides={overrides} setOverride={setOverride} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupBlock({ crewId, factors, overrides, setOverride }: { crewId: string; factors: typeof FACTORS; overrides: Record<string, number>; setOverride: (id: string, v: number | null) => void }) {
  const meta = crewMeta(crewId as typeof CREWS[number]['id']);
  return (
    <>
      <tr className="crewhead"><td colSpan={7}><span className="dot" style={{ background: meta.color, marginRight: 6 }} />{meta.label}</td></tr>
      {factors.map((f) => (
        <tr key={f.id}>
          <td>{f.name}{f.note && <span className="ref">{f.note}</span>}</td>
          <td style={{ color: 'var(--muted)' }}>{f.ref}</td>
          <td>{unitLabel[f.unit] ?? f.unit}</td>
          <td>{freqLabel(f.frequency)}</td>
          <td className="num">{f.lhPerUnit}</td>
          <td className="num"><input type="number" step="0.01" value={overrides[f.id] ?? ''} placeholder={String(f.lhPerUnit)} style={{ borderColor: overrides[f.id] != null ? '#facc15' : undefined }} onChange={(e) => setOverride(f.id, e.target.value === '' ? null : Number(e.target.value))} /></td>
          <td>{overrides[f.id] != null && <button className="btn sm ghost" onClick={() => setOverride(f.id, null)}>↺</button>}</td>
        </tr>
      ))}
    </>
  );
}
