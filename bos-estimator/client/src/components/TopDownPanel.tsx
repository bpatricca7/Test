import { useMemo } from 'react';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { computeTopDown, DEFAULT_TOPDOWN } from '@shared/topdown';
import type { TopDownAssumptions } from '@shared/types';
import { n1, usdCompact } from '../fmt';

const SLIDERS: { key: keyof TopDownAssumptions; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'loadedCostPerFte', label: 'Loaded cost / FTE-yr', min: 35000, max: 140000, step: 500, fmt: (v) => `$${Math.round(v / 1000)}k` },
  { key: 'odcMaterialsPct', label: 'ODC / materials', min: 0, max: 0.35, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'subcontractPct', label: 'Subcontract pass-through', min: 0, max: 0.6, step: 0.01, fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'gaPct', label: 'G&A', min: 0, max: 0.25, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'feePct', label: 'Fee / profit', min: 0, max: 0.2, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'escalationPct', label: 'Escalation / yr', min: 0, max: 0.1, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'yearsSinceAward', label: 'Years since award', min: 0, max: 10, step: 1, fmt: (v) => `${v} yr` },
];

/** Top-down should-cost cross-check: implied FTE from the previous award vs the bottom-up estimate. */
export function TopDownPanel() {
  const project = useStore((s) => s.project);
  const running = useStore((s) => s.topDownRunning);
  const extracting = useStore((s) => s.extraction.running);
  const runTopDown = useStore((s) => s.runTopDown);
  const setOverride = useStore((s) => s.setTopDownOverride);
  const clearOverrides = useStore((s) => s.clearTopDownOverrides);
  const health = useStore((s) => s.health);
  const { est } = useDerived();
  const stored = project?.topDown;
  const overrides = project?.topDownOverrides ?? {};
  const pa = project?.priorAward;

  // Live recompute: AI-proposed assumptions + estimator overrides, against the current bottom-up estimate.
  const live = useMemo(() => {
    if (!est) return null;
    const base: TopDownAssumptions = { ...DEFAULT_TOPDOWN, ...(stored?.assumptions ?? {}), ...overrides };
    return computeTopDown(pa, base, est, { rationale: stored?.rationale ?? '', risks: stored?.risks ?? [], recommendedFte: stored?.recommendedFte, provider: stored?.provider ?? 'heuristic', model: stored?.model });
  }, [est, stored, overrides, pa]);
  if (!est || !live) return null;

  const a = live.assumptions;
  const hasValue = live.impliedFte.base > 0;
  const delta = live.deltaPct;
  const deltaClass = delta == null ? '' : Math.abs(delta) <= 0.1 ? 'ok' : delta > 0 ? 'hi' : 'lo';
  const max = Math.max(live.bottomUpFte, live.impliedFte.high, live.recommendedFte ?? 0, 1) * 1.08;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const bd = live.priceBreakdown;
  const total = Math.max(1, live.annualValue);
  const seg = (v: number) => `${(v / total) * 100}%`;
  const basisLabel = { award: 'total award ÷ period', spend: 'spend run-rate', annual: 'stated annual value', none: 'no award value yet' }[live.basis];

  return (
    <div className="panel-section">
      <h3>Top-down cross-check <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{stored ? `${stored.provider === 'claude' ? stored.model : 'rule-based'} · ${new Date(stored.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not run yet'}</span></h3>
      <div className="xcheck">
        <div className="big" style={{ ['--c' as string]: 'var(--accent)' }}>
          <div className="v">{n1(live.bottomUpFte)}<small>FTE</small></div>
          <div className="l">Bottom-up · RS Means</div>
          <div className="rng">{usdCompact(live.bottomUpLaborCost)} base wages · ≈{usdCompact(live.bottomUpLoadedCostPerFte)} loaded / FTE</div>
        </div>
        <div className="big" style={{ ['--c' as string]: '#c98500' }}>
          <div className="v">{hasValue ? n1(live.impliedFte.base) : '—'}<small>FTE</small></div>
          <div className="l">Implied · previous award</div>
          <div className="rng">{hasValue ? `${n1(live.impliedFte.low)} – ${n1(live.impliedFte.high)} range · ${usdCompact(live.annualValue)}/yr` : 'enter award or spend value'}</div>
        </div>
      </div>
      {hasValue && delta != null && (
        <div className={`delta ${deltaClass}`}>Bottom-up is <b>{delta >= 0 ? '+' : ''}{Math.round(delta * 100)}%</b> vs implied{live.recommendedFte ? <> · AI recommends carrying <b>{n1(live.recommendedFte)} FTE</b></> : null}</div>
      )}
      <div className="cmpbars" role="img" aria-label="Bottom-up FTE versus implied FTE range">
        <div className="row"><span>Bottom-up</span><div className="track"><div style={{ width: pct(live.bottomUpFte), background: 'var(--accent)' }} /></div><span className="n">{n1(live.bottomUpFte)}</span></div>
        <div className="row"><span>Implied range</span><div className="track">{hasValue && <><div className="band" style={{ left: pct(live.impliedFte.low), width: `calc(${pct(live.impliedFte.high)} - ${pct(live.impliedFte.low)})` }} /><div className="tick" style={{ left: pct(live.impliedFte.base), background: '#c98500' }} /></>}</div><span className="n">{hasValue ? n1(live.impliedFte.base) : '—'}</span></div>
        {live.recommendedFte ? <div className="row"><span>AI recommends</span><div className="track"><div style={{ width: pct(live.recommendedFte), background: 'var(--accent-2)' }} /></div><span className="n">{n1(live.recommendedFte)}</span></div> : null}
      </div>

      {hasValue && (
        <>
          <div className="waterfall" title="How the annual value splits under these assumptions">
            <div style={{ width: seg(bd.loadedLabor), background: '#3987e5' }} /><div style={{ width: seg(bd.odc), background: '#c98500' }} /><div style={{ width: seg(bd.subcontract), background: '#9085e9' }} /><div style={{ width: seg(bd.ga), background: '#199e70' }} /><div style={{ width: seg(bd.fee), background: '#d55181' }} />
          </div>
          <div className="wf-legend">
            <span><i className="sw" style={{ background: '#3987e5' }} />Loaded labor {usdCompact(bd.loadedLabor)}</span>
            <span><i className="sw" style={{ background: '#c98500' }} />ODC {usdCompact(bd.odc)}</span>
            {bd.subcontract > 0 && <span><i className="sw" style={{ background: '#9085e9' }} />Subs {usdCompact(bd.subcontract)}</span>}
            <span><i className="sw" style={{ background: '#199e70' }} />G&A {usdCompact(bd.ga)}</span>
            <span><i className="sw" style={{ background: '#d55181' }} />Fee {usdCompact(bd.fee)}</span>
            <span style={{ marginLeft: 'auto' }}>{basisLabel}{live.rawAnnualValue !== live.annualValue ? ` · ${usdCompact(live.rawAnnualValue)} escalated` : ''}</span>
          </div>
        </>
      )}

      {stored?.rationale && (
        <div className="rationale">
          <div className="who">{stored.provider === 'claude' ? '✦ AI pricing lead' : 'Rule-based assumptions'}</div>
          {stored.rationale}
          {stored.risks.length > 0 && <ul className="risks">{stored.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      )}

      <div className="assume">
        {SLIDERS.map((s) => {
          const v = a[s.key] as number;
          const locked = overrides[s.key] != null;
          return (
            <div className={`field ${locked ? 'locked' : ''}`} key={s.key}>
              <label><span>{s.label}{locked ? ' · locked' : ''}</span><b>{s.fmt(v)}</b></label>
              <input type="range" min={s.min} max={s.max} step={s.step} value={v} onChange={(e) => setOverride(s.key, Number(e.target.value) as never)} />
            </div>
          );
        })}
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn primary sm" disabled={running || extracting} onClick={() => void runTopDown('auto')}>{running ? 'Re-running…' : health?.aiAvailable ? '✦ Re-run AI cross-check' : 'Re-run cross-check'}</button>
        {Object.keys(overrides).length > 0 && <button className="btn sm" onClick={clearOverrides}>Unlock AI assumptions</button>}
      </div>
      <div className="note" style={{ marginTop: 8 }}>Formula: loaded labor = annual value ÷ ((1 + G&A)(1 + fee)) − ODC − subs; implied FTE = loaded labor ÷ loaded cost per FTE. Dragging a slider locks that assumption for future AI runs.</div>
    </div>
  );
}
