import { useMemo } from 'react';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { CATEGORY_DEFAULTS, CREWS, crewMeta, type Crew } from '@shared/factors';
import { DEFAULT_ASSUMPTIONS, type TaskLine } from '@shared/estimate';
import { FACILITY_CATEGORIES, GROUNDS_KINDS, SERVICE_LEVELS, type Facility, type GroundsArea, type ScopeItem } from '@shared/types';
import { n0, n1, n2, pct, unitLabel, usd } from '../fmt';

function LinesTable({ lines, onOverride, overrides }: { lines: TaskLine[]; onOverride: (id: string, v: number | null) => void; overrides: Record<string, number> }) {
  const groups = useMemo(() => { const m = new Map<Crew, TaskLine[]>(); for (const l of lines) { const a = m.get(l.crew) ?? []; a.push(l); m.set(l.crew, a); } return [...m.entries()]; }, [lines]);
  if (!lines.length) return <div className="empty">No applicable RS Means lines for this scope.</div>;
  return (
    <table className="lines">
      <thead><tr><th>Task · RS Means ref</th><th className="num">Qty</th><th className="num">×/yr</th><th className="num">LH/unit</th><th className="num">Hrs/yr</th></tr></thead>
      <tbody>
        {groups.map(([crew, ls]) => (
          <GroupRows key={crew} crew={crew} lines={ls} onOverride={onOverride} overrides={overrides} />
        ))}
      </tbody>
    </table>
  );
}
function GroupRows({ crew, lines, onOverride, overrides }: { crew: Crew; lines: TaskLine[]; onOverride: (id: string, v: number | null) => void; overrides: Record<string, number> }) {
  const meta = crewMeta(crew);
  const sum = lines.reduce((s, l) => s + l.annualHours, 0);
  return (
    <>
      <tr className="crewhead"><td colSpan={4}><span className="dot" style={{ background: meta.color, marginRight: 6 }} />{meta.label}</td><td className="num">{n0(sum)}</td></tr>
      {lines.map((l) => (
        <tr key={l.factorId}>
          <td>{l.name}<span className="ref">{l.ref}</span></td>
          <td className="num">{l.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {unitLabel[l.unit] ?? l.unit}</td>
          <td className="num">{l.frequencyPerYear}</td>
          <td className="num"><input type="number" step="0.01" value={l.lhPerUnit} style={{ borderColor: overrides[l.factorId] != null ? '#facc15' : undefined }} title="Labor-hours per unit (global factor — applies to every facility)" onChange={(e) => onOverride(l.factorId, e.target.value === '' ? null : Number(e.target.value))} /></td>
          <td className="num">{n0(l.annualHours)}</td>
        </tr>
      ))}
    </>
  );
}

function CrewSummary({ hoursByCrew, fteDivisor }: { hoursByCrew: Partial<Record<Crew, number>>; fteDivisor: number }) {
  const entries = (Object.entries(hoursByCrew) as [Crew, number][]).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="crew-summary">
      {entries.map(([c, h]) => { const m = crewMeta(c); return <div className="row" key={c}><span className="sw" style={{ background: m.color }} /><span>{m.label}</span><span className="n"><b>{n0(h)}</b> h</span><span className="n"><b>{n2(h / fteDivisor)}</b> FTE</span></div>; })}
    </div>
  );
}

function FacilityDetail({ f }: { f: Facility }) {
  const update = useStore((s) => s.updateFacility);
  const remove = useStore((s) => s.removeFacility);
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const tab = useStore((s) => s.buildingTab);
  const setTab = useStore((s) => s.setBuildingTab);
  const grounds = useStore((s) => s.project?.inventory.grounds ?? []);
  const addGrounds = useStore((s) => s.addGrounds);
  const select = useStore((s) => s.select);
  const overrides = useStore((s) => s.project?.factorOverrides ?? {});
  const setFactorOverride = useStore((s) => s.setFactorOverride);
  const productive = useStore((s) => s.project?.assumptionOverrides?.productiveHoursPerFte ?? DEFAULT_ASSUMPTIONS.productiveHoursPerFte);
  const { est } = useDerived();
  const e = est?.facilities.find((x) => x.facilityId === f.id);
  const attached = grounds.filter((g) => g.facilityId === f.id);
  const gEst = est?.grounds.filter((g) => attached.some((a) => a.id === g.areaId)) ?? [];
  const groundsHours = gEst.reduce((s, g) => s + g.totalHours, 0);
  const toggleScope = (s: ScopeItem) => update(f.id, { scope: f.scope.includes(s) ? f.scope.filter((x) => x !== s) : [...f.scope, s] });
  const r = e?.resolved;
  const d = f.dining;
  return (
    <>
      <div className="panel-section detail">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2><input value={f.name} onChange={(ev) => update(f.id, { name: ev.target.value })} style={{ background: 'transparent', border: 'none', fontSize: 16, fontWeight: 700, width: '100%', padding: 0 }} /></h2>
            <div className="sub">Bldg <input value={f.buildingNumber ?? ''} placeholder="#" onChange={(ev) => update(f.id, { buildingNumber: ev.target.value || undefined })} style={{ width: 60, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }} /> · {CATEGORY_DEFAULTS[f.category]?.label} · confidence {pct(f.confidence)}</div>
          </div>
          <button className="btn sm" onClick={() => setFocusMode(focusMode === 'building' ? 'site' : 'building')}>{focusMode === 'building' ? '◱ Site view' : '⤢ Enter building'}</button>
        </div>
        <div className="tabs">
          <button className={tab === 'interior' ? 'on' : ''} onClick={() => setTab('interior')}>Interior · {e ? n0(e.totalHours) : 0} h/yr</button>
          <button className={tab === 'grounds' ? 'on' : ''} onClick={() => setTab('grounds')}>Grounds · {n0(groundsHours)} h/yr</button>
        </div>
        {f.source?.excerpt && <div className="source">“{f.source.excerpt}”<span className="f">{f.source.file}{f.source.page ? ` · p.${f.source.page}` : ''}</span></div>}
        {f.notes && <div className="note" style={{ marginBottom: 8 }}>{f.notes}</div>}
      </div>

      {tab === 'interior' ? (
        <>
          <div className="panel-section">
            <div className="kpis">
              <div className="kpi"><div className="v">{n0(f.grossSqft)}</div><div className="l">Gross SF</div></div>
              <div className="kpi"><div className="v">{r ? n0(r.cleanableSqft) : '–'}</div><div className="l">Cleanable SF</div></div>
              <div className="kpi"><div className="v">{e ? n2(e.fte) : '–'}</div><div className="l">FTE (interior)</div></div>
            </div>
            <div className="field-row three">
              <div className="field"><label>Gross SF</label><input type="number" value={f.grossSqft} onChange={(ev) => update(f.id, { grossSqft: Number(ev.target.value) })} /></div>
              <div className="field"><label>Cleanable SF</label><input type="number" value={f.cleanableSqft ?? ''} placeholder={r ? n0(r.cleanableSqft) : ''} onChange={(ev) => update(f.id, { cleanableSqft: ev.target.value === '' ? undefined : Number(ev.target.value) })} /></div>
              <div className="field"><label>Floors</label><input type="number" value={f.floors} onChange={(ev) => update(f.id, { floors: Number(ev.target.value) })} /></div>
            </div>
            <div className="field-row three">
              <div className="field"><label>Category</label><select value={f.category} onChange={(ev) => update(f.id, { category: ev.target.value as Facility['category'] })}>{FACILITY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_DEFAULTS[c].label}</option>)}</select></div>
              <div className="field"><label>Restroom fixtures</label><input type="number" value={f.restroomFixtures ?? ''} placeholder={r ? String(r.restroomFixtures) : ''} onChange={(ev) => update(f.id, { restroomFixtures: ev.target.value === '' ? undefined : Number(ev.target.value) })} /></div>
              <div className="field"><label>Service level</label><select value={f.serviceLevel} onChange={(ev) => update(f.id, { serviceLevel: ev.target.value as Facility['serviceLevel'] })}>{SERVICE_LEVELS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              {(['custodial', 'floor_care', 'dining'] as ScopeItem[]).map((s) => <label key={s} className="check"><input type="checkbox" checked={f.scope.includes(s)} onChange={() => toggleScope(s)} />{s === 'custodial' ? 'Custodial' : s === 'floor_care' ? 'Floor care' : 'Dining (FFS)'}</label>)}
            </div>
            {r && (
              <div className="note">Floor mix used: {(Object.entries(r.floorMix) as [string, number][]).filter(([, v]) => v > 0.01).map(([k, v]) => `${k} ${pct(v)}`).join(' · ')} · {r.serviceDaysPerYear} service days/yr{f.floorMix ? '' : ' (category default — edit via Factors ▸ categories or set per RFP)'}</div>
            )}
            {(f.scope.includes('dining') || f.category === 'dining') && (
              <div style={{ marginTop: 10 }}>
                <h3 style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '0 0 6px' }}>Dining facility profile</h3>
                <div className="field-row three">
                  <div className="field"><label>Meals / day</label><input type="number" value={d?.mealsPerDay ?? ''} onChange={(ev) => update(f.id, { dining: { mealPeriods: 3, daysPerWeek: 7, ...(d ?? {}), mealsPerDay: Number(ev.target.value) } })} /></div>
                  <div className="field"><label>Meal periods</label><input type="number" value={d?.mealPeriods ?? 3} onChange={(ev) => update(f.id, { dining: { mealsPerDay: 0, daysPerWeek: 7, ...(d ?? {}), mealPeriods: Number(ev.target.value) } })} /></div>
                  <div className="field"><label>Days / week</label><input type="number" value={d?.daysPerWeek ?? 7} onChange={(ev) => update(f.id, { dining: { mealsPerDay: 0, mealPeriods: 3, ...(d ?? {}), daysPerWeek: Number(ev.target.value) } })} /></div>
                </div>
                <div className="field-row three">
                  <div className="field"><label>Seats</label><input type="number" value={d?.seats ?? ''} onChange={(ev) => update(f.id, { dining: { mealsPerDay: 0, mealPeriods: 3, daysPerWeek: 7, ...(d ?? {}), seats: Number(ev.target.value) } })} /></div>
                  <div className="field"><label>Kitchen SF</label><input type="number" value={d?.kitchenSqft ?? ''} onChange={(ev) => update(f.id, { dining: { mealsPerDay: 0, mealPeriods: 3, daysPerWeek: 7, ...(d ?? {}), kitchenSqft: Number(ev.target.value) } })} /></div>
                  <div className="field"><label>Service style</label><select value={d?.serviceStyle ?? 'full_food_service'} onChange={(ev) => update(f.id, { dining: { mealsPerDay: 0, mealPeriods: 3, daysPerWeek: 7, ...(d ?? {}), serviceStyle: ev.target.value as NonNullable<Facility['dining']>['serviceStyle'] } })}><option value="full_food_service">Full food service</option><option value="dining_facility_attendant">DFA only</option><option value="management_only">Management only</option></select></div>
                </div>
              </div>
            )}
          </div>
          <div className="panel-section"><h3>Crews in this building</h3>{e && <CrewSummary hoursByCrew={e.hoursByCrew} fteDivisor={productive} />}</div>
          <div className="scroll" style={{ padding: '0 10px 12px' }}>{e && <LinesTable lines={e.lines} onOverride={setFactorOverride} overrides={overrides} />}</div>
        </>
      ) : (
        <>
          <div className="panel-section">
            <div className="kpis">
              <div className="kpi"><div className="v">{n1(gEst.reduce((s, g) => s + g.acres, 0))}</div><div className="l">Acres attached</div></div>
              <div className="kpi"><div className="v">{n0(groundsHours)}</div><div className="l">Hrs / yr</div></div>
              <div className="kpi"><div className="v">{n2(groundsHours / productive)}</div><div className="l">FTE (grounds)</div></div>
            </div>
            <div className="btn-row"><button className="btn sm" onClick={() => addGrounds(f.id)}>+ attach grounds area</button></div>
            {attached.length === 0 && <div className="empty">No grounds tied to this building yet. The RFP may list acreage site-wide (see the Grounds list) or you can attach an area here.</div>}
            {attached.map((g) => <GroundsEditor key={g.id} g={g} compact onOpen={() => select({ kind: 'grounds', id: g.id })} />)}
          </div>
          <div className="scroll" style={{ padding: '0 10px 12px' }}>{gEst.length > 0 && <LinesTable lines={gEst.flatMap((x) => x.lines)} onOverride={setFactorOverride} overrides={overrides} />}</div>
        </>
      )}
      <div className="panel-section" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}><button className="btn sm danger" onClick={() => { if (confirm(`Remove ${f.name} from the estimate?`)) remove(f.id); }}>Remove facility</button></div>
    </>
  );
}

function GroundsEditor({ g, compact, onOpen }: { g: GroundsArea; compact?: boolean; onOpen?: () => void }) {
  const update = useStore((s) => s.updateGrounds);
  const remove = useStore((s) => s.removeGrounds);
  const facilities = useStore((s) => s.project?.inventory.facilities ?? []);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginTop: 8 }}>
      <div className="field"><label>Name</label><input value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} /></div>
      <div className="field-row three">
        <div className="field"><label>Kind</label><select value={g.kind} onChange={(e) => { const k = GROUNDS_KINDS.find((x) => x.id === e.target.value)!; update(g.id, { kind: k.id, unit: k.defaultUnit }); }}>{GROUNDS_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></div>
        <div className="field"><label>Quantity</label><input type="number" value={g.quantity} onChange={(e) => update(g.id, { quantity: Number(e.target.value) })} /></div>
        <div className="field"><label>Unit</label><select value={g.unit} onChange={(e) => update(g.id, { unit: e.target.value as GroundsArea['unit'] })}><option value="acres">acres</option><option value="sqft">SF</option><option value="sqyd">SY</option><option value="lf">LF</option><option value="each">each</option></select></div>
      </div>
      {!compact && <div className="field"><label>Attached to building</label><select value={g.facilityId ?? ''} onChange={(e) => update(g.id, { facilityId: e.target.value || undefined })}><option value="">Site-wide (not tied to a building)</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.buildingNumber ? `${f.buildingNumber} · ` : ''}{f.name}</option>)}</select></div>}
      {g.source?.excerpt && <div className="source">“{g.source.excerpt}”<span className="f">{g.source.file}</span></div>}
      {g.notes && <div className="note">{g.notes}</div>}
      <div className="btn-row" style={{ marginTop: 6 }}>{onOpen && <button className="btn sm" onClick={onOpen}>Open</button>}<button className="btn sm danger" onClick={() => { if (confirm('Remove this grounds area?')) remove(g.id); }}>Remove</button></div>
    </div>
  );
}

function GroundsDetail({ g }: { g: GroundsArea }) {
  const { est } = useDerived();
  const overrides = useStore((s) => s.project?.factorOverrides ?? {});
  const setFactorOverride = useStore((s) => s.setFactorOverride);
  const productive = useStore((s) => s.project?.assumptionOverrides?.productiveHoursPerFte ?? DEFAULT_ASSUMPTIONS.productiveHoursPerFte);
  const e = est?.grounds.find((x) => x.areaId === g.id);
  return (
    <>
      <div className="panel-section detail">
        <h2>{g.name}</h2>
        <div className="sub">{GROUNDS_KINDS.find((k) => k.id === g.kind)?.label} · confidence {pct(g.confidence)}</div>
        <div className="kpis">
          <div className="kpi"><div className="v">{g.unit === 'acres' ? n1(g.quantity) : n0(g.quantity)}</div><div className="l">{g.unit}</div></div>
          <div className="kpi"><div className="v">{e ? n0(e.totalHours) : '–'}</div><div className="l">Hrs / yr</div></div>
          <div className="kpi"><div className="v">{e ? n2(e.fte) : '–'}</div><div className="l">FTE</div></div>
        </div>
        <GroundsEditor g={g} />
      </div>
      <div className="panel-section"><h3>Crews on this area</h3>{e && <CrewSummary hoursByCrew={e.hoursByCrew} fteDivisor={productive} />}</div>
      <div className="scroll" style={{ padding: '0 10px 12px' }}>{e && <LinesTable lines={e.lines} onOverride={setFactorOverride} overrides={overrides} />}</div>
    </>
  );
}

function Totals() {
  const { est } = useDerived();
  const project = useStore((s) => s.project);
  const setAssumption = useStore((s) => s.setAssumption);
  const setWage = useStore((s) => s.setWage);
  const patchInventory = useStore((s) => s.patchInventory);
  const a = { ...DEFAULT_ASSUMPTIONS, ...(project?.assumptionOverrides ?? {}) };
  const site = project?.inventory.site ?? {};
  if (!est) return null;
  return (
    <>
      <div className="panel-section detail">
        <h2>Bid manning summary</h2>
        <div className="sub">{[site.installationName, site.location, site.solicitation].filter(Boolean).join(' · ') || 'Select a building or grounds area to drill in'}</div>
        <div className="kpis">
          <div className="kpi"><div className="v">{n1(est.totalFte)}</div><div className="l">Total FTE</div></div>
          <div className="kpi"><div className="v">{est.totalHeadcount}</div><div className="l">Headcount</div></div>
          <div className="kpi"><div className="v">{usd(est.totalLaborCost)}</div><div className="l">Base-yr labor $</div></div>
        </div>
        <table className="years">
          <thead><tr><th>Crew</th><th>Hours</th><th>FTE</th><th>Heads</th><th>$/hr</th><th>Labor $</th></tr></thead>
          <tbody>
            {est.crews.map((c) => (
              <tr key={c.crew}><td><span className="dot" style={{ background: c.color, marginRight: 6 }} />{c.label}</td><td>{n0(c.hours)}</td><td>{n2(c.fte)}</td><td>{c.headcount}</td><td><input type="number" step="0.25" value={c.wage} onChange={(e) => setWage(c.crew, Number(e.target.value))} style={{ width: 58, background: 'rgba(2,6,23,.6)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', textAlign: 'right' }} /></td><td>{usd(c.annualCost)}</td></tr>
            ))}
            <tr className="total"><td>Total</td><td>{n0(est.directHours)}</td><td>{n2(est.totalFte)}</td><td>{est.totalHeadcount}</td><td /><td>{usd(est.totalLaborCost)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel-section">
        <h3>Manning per contract year</h3>
        <table className="years">
          <thead><tr><th>Period</th><th>Hours</th><th>FTE</th><th>Heads</th><th>Labor $</th></tr></thead>
          <tbody>{est.years.map((y) => <tr key={y.year}><td>{y.label}</td><td>{n0(y.hours)}</td><td>{n2(y.fte)}</td><td>{y.headcount}</td><td>{usd(y.laborCost)}</td></tr>)}
            <tr className="total"><td>Contract total</td><td>{n0(est.years.reduce((s, y) => s + y.hours, 0))}</td><td>{n2(est.years.reduce((s, y) => s + y.fte, 0))} FTE-yrs</td><td /><td>{usd(est.years.reduce((s, y) => s + y.laborCost, 0))}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel-section scroll">
        <h3>Assumptions</h3>
        <div className="field-row">
          <div className="field"><label>Productive hrs / FTE / yr</label><input type="number" value={a.productiveHoursPerFte} onChange={(e) => setAssumption('productiveHoursPerFte', Number(e.target.value))} /></div>
          <div className="field"><label>Supervisor ratio (1 per N)</label><input type="number" value={a.supervisorRatio} onChange={(e) => setAssumption('supervisorRatio', Number(e.target.value))} /></div>
          <div className="field"><label>Contract years (base + options)</label><input type="number" value={a.contractYears} onChange={(e) => setAssumption('contractYears', Number(e.target.value))} /></div>
          <div className="field"><label>Workload growth / yr</label><input type="number" step="0.01" value={a.workloadGrowthPerYear} onChange={(e) => setAssumption('workloadGrowthPerYear', Number(e.target.value))} /></div>
          <div className="field"><label>Wage escalation / yr</label><input type="number" step="0.005" value={a.wageEscalationPerYear} onChange={(e) => setAssumption('wageEscalationPerYear', Number(e.target.value))} /></div>
          <div className="field"><label>Climate zone</label><select value={a.climateZone} onChange={(e) => setAssumption('climateZone', e.target.value as typeof a.climateZone)}><option value="cold">Cold (snow)</option><option value="temperate">Temperate</option><option value="hot_humid">Hot / humid</option><option value="arid">Arid</option></select></div>
          <div className="field"><label>Growing season (weeks)</label><input type="number" value={a.growingSeasonWeeks} onChange={(e) => setAssumption('growingSeasonWeeks', Number(e.target.value))} /></div>
          <div className="field"><label>Snow events / yr</label><input type="number" value={a.snowEventsPerYear} onChange={(e) => setAssumption('snowEventsPerYear', Number(e.target.value))} /></div>
        </div>
        <h3 style={{ marginTop: 6 }}>Site</h3>
        <div className="field-row">
          <div className="field"><label>Installation</label><input value={site.installationName ?? ''} onChange={(e) => patchInventory((inv) => ({ ...inv, site: { ...inv.site, installationName: e.target.value } }))} /></div>
          <div className="field"><label>Solicitation</label><input value={site.solicitation ?? ''} onChange={(e) => patchInventory((inv) => ({ ...inv, site: { ...inv.site, solicitation: e.target.value } }))} /></div>
        </div>
        {site.notes && <div className="note">{site.notes}</div>}
        <div className="note" style={{ marginTop: 8 }}>Crews on shift right now: {CREWS.map((c) => c.short).join(', ')}. Shift windows drive the live tracker and can be tuned in <code>shared/factors.ts</code>.</div>
      </div>
    </>
  );
}

export function DetailPanel() {
  const selection = useStore((s) => s.selection);
  const facilities = useStore((s) => s.project?.inventory.facilities ?? []);
  const grounds = useStore((s) => s.project?.inventory.grounds ?? []);
  if (selection.kind === 'facility') { const f = facilities.find((x) => x.id === selection.id); if (f) return <FacilityDetail f={f} />; }
  if (selection.kind === 'grounds') { const g = grounds.find((x) => x.id === selection.id); if (g) return <GroundsDetail g={g} />; }
  return <Totals />;
}
