import { useMemo } from 'react';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { CREWS } from '@shared/factors';
import { clock } from '../three/clock';
import { agentStates, fmtTime, summarize } from '../three/sim';

const SPEEDS = [1, 4, 12, 30, 90, 240];

export function LiveBoard() {
  const sim = useStore((s) => s.sim);
  const simSet = useStore((s) => s.simSet);
  const crewFilter = useStore((s) => s.crewFilter);
  const setCrewFilter = useStore((s) => s.setCrewFilter);
  const { roster, layout } = useDerived();
  const now = useMemo(() => (layout ? summarize(agentStates(roster, sim.time, layout.depot)) : []), [roster, sim.time, layout]);
  const dayPart = sim.time < 5 ? 'Night shift' : sim.time < 12 ? 'Morning' : sim.time < 17 ? 'Afternoon' : sim.time < 21 ? 'Evening shift' : 'Night shift';
  return (
    <div className="overlay liveboard">
      <div className="clock glass">
        <div className="time">{fmtTime(sim.time)}</div>
        <div className="day">{dayPart} · live crew tracker</div>
        <input type="range" min={0} max={23.99} step={0.05} value={sim.time} onChange={(e) => { const t = Number(e.target.value); clock.time = t; simSet({ time: t }); }} />
        <div className="controls">
          <button className="btn sm" onClick={() => { clock.playing = !clock.playing; simSet({ playing: clock.playing }); }}>{sim.playing ? '❚❚' : '▶'}</button>
          <select className="btn sm" value={sim.speed} onChange={(e) => { clock.speed = Number(e.target.value); simSet({ speed: clock.speed }); }}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s} min/s</option>)}
          </select>
          {crewFilter && <button className="btn sm ghost" onClick={() => setCrewFilter(null)}>clear filter</button>}
        </div>
      </div>
      <div className="crewboard">
        {now.map((c) => {
          const meta = CREWS.find((m) => m.id === c.crew)!;
          return (
            <div key={c.crew} className={`crewcard glass ${crewFilter === c.crew ? 'on' : ''}`} style={{ ['--crew' as string]: meta.color, ['--p' as string]: c.heads ? (c.working / c.heads) * 100 : 0 }} onClick={() => setCrewFilter(crewFilter === c.crew ? null : c.crew)} title="Click to isolate this crew in the 3D view">
              <div className="ring"><span>{c.working}</span></div>
              <div style={{ minWidth: 0 }}>
                <div className="head"><span className="sw" />{meta.short}<span className="count"><b>{c.onShift}</b>/{c.heads} on</span></div>
                <div className="now">
                  {c.onShift === 0 ? `Off shift · ${fmtTime(meta.shift.start)}–${fmtTime(meta.shift.end)}` : c.where.length === 0 ? `${c.traveling} en route` : c.where.slice(0, 2).map((w) => `${w.n} · ${w.target}: ${w.task}`).join('\n')}
                </div>
              </div>
            </div>
          );
        })}
        {now.length === 0 && <div className="crewcard glass" style={{ ['--crew' as string]: '#64748b', ['--p' as string]: 0 }}><div className="ring"><span>0</span></div><div><div className="head">No crews yet</div><div className="now">Crews appear once facilities and grounds are estimated.</div></div></div>}
      </div>
    </div>
  );
}
