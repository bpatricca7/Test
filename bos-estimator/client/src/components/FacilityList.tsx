import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { CATEGORY_DEFAULTS } from '@shared/factors';
import { SERVICE_LEVELS } from '@shared/types';
import { ZONE_LABELS } from '../three/layout';
import { confClass, n0, n1 } from '../fmt';

export function FacilityList() {
  const facilities = useStore((s) => s.project?.inventory.facilities ?? []);
  const grounds = useStore((s) => s.project?.inventory.grounds ?? []);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const addFacility = useStore((s) => s.addFacility);
  const addGrounds = useStore((s) => s.addGrounds);
  const recent = useStore((s) => s.extraction.recent);
  const running = useStore((s) => s.extraction.running);
  const { est } = useDerived();
  const [q, setQ] = useState('');
  const emap = useMemo(() => new Map(est?.facilities.map((e) => [e.facilityId, e]) ?? []), [est]);
  const gemap = useMemo(() => new Map(est?.grounds.map((g) => [g.areaId, g]) ?? []), [est]);
  const ql = q.trim().toLowerCase();
  const fList = facilities.filter((f) => !ql || `${f.buildingNumber ?? ''} ${f.name} ${f.category}`.toLowerCase().includes(ql));
  const gList = grounds.filter((g) => !ql || `${g.name} ${g.kind}`.toLowerCase().includes(ql));
  const totalSf = facilities.reduce((s, f) => s + f.grossSqft, 0);
  const isNew = (id: string) => running && recent[id] && Date.now() - recent[id] < 4000;
  const maxFte = Math.max(0.01, ...(est?.facilities.map((e) => e.fte) ?? [0]), ...(est?.grounds.map((g) => g.fte) ?? [0]));

  return (
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-section" style={{ paddingBottom: 6 }}>
        <h3>2 · Facilities to estimate</h3>
        <input className="search" placeholder="Search buildings, numbers, grounds…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="group-head"><span>Buildings · {facilities.length} · {n0(totalSf)} SF</span><button className="btn sm ghost" onClick={addFacility}>+ add</button></div>
      {fList.length === 0 && <div className="empty">{running ? 'Waiting for the reader to find buildings…' : <>No buildings yet.<br />Drop an RFP above or <b>try the sample</b>.</>}</div>}
      <div className="list">
        {fList.map((f) => {
          const e = emap.get(f.id);
          const sel = selection.kind === 'facility' && selection.id === f.id;
          return (
            <div key={f.id} className={`list-item ${sel ? 'selected' : ''} ${isNew(f.id) ? 'new' : ''}`} style={sel ? undefined : { borderLeftColor: `${CATEGORY_DEFAULTS[f.category]?.color ?? '#64748b'}66` }} onClick={() => select({ kind: 'facility', id: f.id })} onDoubleClick={() => { select({ kind: 'facility', id: f.id }); setFocusMode('building'); }} title="Click to select · double-click to enter the building">
              <span className="num">{f.buildingNumber ?? '—'}</span>
              <div style={{ minWidth: 0 }}>
                <div className="name">{f.name}</div>
                <div className="sub"><span className="dot" style={{ background: CATEGORY_DEFAULTS[f.category]?.color }} />{CATEGORY_DEFAULTS[f.category]?.label ?? f.category} · {SERVICE_LEVELS.find((s) => s.id === f.serviceLevel)?.label.replace(', ', ' ') ?? f.serviceLevel}{f.dining ? ` · ${n0(f.dining.mealsPerDay)} meals/day` : ''}</div>
              </div>
              <div className="right">
                <div>{n0(f.grossSqft)} SF</div>
                <div className="sub" style={{ justifyContent: 'flex-end' }}><span className={`dot ${confClass(f.confidence)}`} title={`Extraction confidence ${Math.round(f.confidence * 100)}%`} /><span className="fte">{e ? `${n2(e.fte)} FTE` : ''}</span></div>
              </div>
              <div className="ftebar"><div style={{ width: `${e ? Math.min(100, (e.fte / maxFte) * 100) : 0}%` }} /></div>
            </div>
          );
        })}
      </div>
      <div className="group-head"><span>Grounds · {grounds.length}</span><button className="btn sm ghost" onClick={() => addGrounds()}>+ add</button></div>
      <div className="list">
        {gList.map((g) => {
          const e = gemap.get(g.id);
          const sel = selection.kind === 'grounds' && selection.id === g.id;
          const parent = g.facilityId ? facilities.find((f) => f.id === g.facilityId) : undefined;
          return (
            <div key={g.id} className={`list-item ${sel ? 'selected' : ''} ${isNew(g.id) ? 'new' : ''}`} onClick={() => select({ kind: 'grounds', id: g.id })}>
              <span className="num">{parent?.buildingNumber ?? 'site'}</span>
              <div style={{ minWidth: 0 }}>
                <div className="name">{g.name}</div>
                <div className="sub">{ZONE_LABELS[g.kind]}{parent ? ` · ${parent.name}` : ' · site-wide'}</div>
              </div>
              <div className="right">
                <div>{g.unit === 'acres' ? `${n1(g.quantity)} ac` : `${n0(g.quantity)} ${g.unit === 'each' ? 'ea' : g.unit === 'sqyd' ? 'SY' : g.unit === 'lf' ? 'LF' : 'SF'}`}</div>
                <div className="sub" style={{ justifyContent: 'flex-end' }}><span className={`dot ${confClass(g.confidence)}`} /><span className="fte">{e ? `${n2(e.fte)} FTE` : ''}</span></div>
              </div>
              <div className="ftebar"><div style={{ width: `${e ? Math.min(100, (e.fte / maxFte) * 100) : 0}%`, background: 'linear-gradient(90deg,#199e70,#c98500)' }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
