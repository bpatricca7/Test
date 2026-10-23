// Right panel › Estimate (UI spec §5.8): one scroll body. A bottom line, B crews with wages, C cross-check (sticky
// result row, previous-award form in two columns, assumption rows with lock icons, waterfall, rationale, stale badge),
// D manning per contract year, E estimating assumptions, F site. Every number comes from useDerived() and
// useTopDownLive(), so the top bar and this tab cannot disagree (A11).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { History, Lock, LockOpen, RefreshCw, Sparkles } from 'lucide-react';
import { useStore } from '../../store';
import { useDerived, useTopDownLive, type TopDownLive } from '../../derived';
import { crewMeta, CREWS } from '@shared/factors';
import { DEFAULT_ASSUMPTIONS, type EstimateResult } from '@shared/estimate';
import { CLEANING_LEVELS, type CleaningLevel, type ClimateZone, type PriorAward, type TopDownAssumptions, type TopDownEstimate } from '@shared/types';
import { compact, fitNum, n0, n1, n2, signedPct, usdCompact } from '../../fmt';
import { CREW_ORDER, crewColor, deltaTone } from '../lib/theme';
import { cx } from '../lib/cx';
import { Button, Field, Fields, IconButton, MoneyInput, NumField, Select, TextField, Tooltip } from '../ui';
import { CREW_ICON } from '../bottom/crewIcons';
import { useWidth } from '../inspector/parts';
import '../../styles/estimate.css';

interface SliderDef { key: keyof TopDownAssumptions; label: string; min: number; max: number; step: number; pct?: boolean; suffix?: string; decimals: number }
const SLIDERS: SliderDef[] = [
  { key: 'loadedCostPerFte', label: 'Loaded $/FTE-yr', min: 35000, max: 140000, step: 500, decimals: 0 },
  { key: 'odcMaterialsPct', label: 'ODC / materials', min: 0, max: 0.35, step: 0.005, pct: true, suffix: '%', decimals: 1 },
  { key: 'subcontractPct', label: 'Subcontract', min: 0, max: 0.6, step: 0.01, pct: true, suffix: '%', decimals: 1 },
  { key: 'gaPct', label: 'G&A', min: 0, max: 0.25, step: 0.005, pct: true, suffix: '%', decimals: 1 },
  { key: 'feePct', label: 'Fee / profit', min: 0, max: 0.2, step: 0.005, pct: true, suffix: '%', decimals: 1 },
  { key: 'escalationPct', label: 'Escalation / yr', min: 0, max: 0.1, step: 0.005, pct: true, suffix: '%', decimals: 1 },
  { key: 'yearsSinceAward', label: 'Years since award', min: 0, max: 10, step: 1, suffix: 'yr', decimals: 0 },
];
const BASIS_LABEL: Record<TopDownEstimate['basis'], string> = { award: 'total award ÷ period', spend: 'spend run-rate', annual: 'stated annual value', none: 'no award value yet' };
const WF: { key: keyof TopDownEstimate['priceBreakdown']; label: string; color: string }[] = [
  { key: 'loadedLabor', label: 'Loaded labor', color: 'var(--c-labor)' }, { key: 'odc', label: 'ODC', color: 'var(--c-odc)' }, { key: 'subcontract', label: 'Subs', color: 'var(--c-subs)' },
  { key: 'ga', label: 'G&A', color: 'var(--c-ga)' }, { key: 'fee', label: 'Fee', color: 'var(--c-fee)' },
];

/** last store.estimateFocus request already scrolled to (survives tab switches, so a remount does not re-scroll) */
let handledFocusSeq = 0;


export const EstimateTab = memo(function EstimateTab() {
  const { est } = useDerived();
  const live = useTopDownLive();
  const hasProject = useStore((s) => Boolean(s.project));
  const focus = useStore((s) => s.estimateFocus);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus || focus.seq === handledFocusSeq) return;
    handledFocusSeq = focus.seq;
    const run = () => {
      const sc = scroller.current; const el = sc?.querySelector<HTMLElement>(`#est-${focus.section}`);
      if (el && sc) sc.scrollTo({ top: el.offsetTop - 4, behavior: useStore.getState().reducedMotion ? 'auto' : 'smooth' });
    };
    requestAnimationFrame(run);
  }, [focus]);

  if (!hasProject) return null;
  return (
    <div ref={scroller} className="est panel__scroll">
      <BottomLine est={est} live={live} />
      {est && <CrewsTable est={est} />}
      <CrossCheck est={est} live={live} />
      {est && <Manning est={est} />}
      <AssumptionsSection />
      <SiteSection />
    </div>
  );
});

// ------------------------------------------------------------------ A. bottom line
/** The implied band: low/high come from the cost bounds, so order them (a base-cost override can sit outside). */
const band = (live: TopDownLive) => [Math.min(live.impliedLow, live.impliedHigh), Math.max(live.impliedLow, live.impliedHigh)] as const;

function BottomLine({ est, live }: { est: EstimateResult | null; live: TopDownLive }) {
  const td = live.td;
  const has = live.deltaPct != null;
  const [bLo, bHi] = band(live);
  const top = useMemo(() => {
    if (!est) return null;
    const total = est.crews.reduce((s, c) => s + c.hours, 0) || 1;
    const c = [...est.crews].sort((a, b) => b.hours - a.hours)[0];
    return c ? { name: crewMeta(c.crew).short, share: c.hours / total } : null;
  }, [est]);
  const gapFte = live.bottomUpFte - live.impliedBase;
  const sentence = !est ? 'Read a package to build the bottom-up estimate.'
    : !has ? 'Enter the previous award in Cross-check to compare against a top-down number.'
      : `Bottom-up is ${n1(Math.abs(gapFte))} FTE ${gapFte >= 0 ? 'above' : 'below'} the top-down midpoint${live.bottomUpFte > bHi ? ', above the implied range' : live.bottomUpFte < bLo ? ', below the implied range' : ', inside the implied range'}${top ? `; ${top.name} is ${Math.round(top.share * 100)}% of hours` : ''}.`;
  return (
    <section className="est__sec est__bl" id="est-bottomline" aria-label="Bottom line">
      <div className="est__cards">
        <div className="est__card">
          <span className="l">Bottom-up</span>
          <span className="v" title={est ? `${n1(live.bottomUpFte)} FTE` : undefined}><span className="est-bottomup-v">{est ? fitNum(live.bottomUpFte, 7, n1) : '—'}</span><small> FTE</small></span>
          <span className="s">{est ? `${fitNum(live.heads, 7)} heads · ${usdCompact(est.totalLaborCost)} base-yr labor` : 'No facilities yet'}</span>
        </div>
        <div className="est__card est__card--implied">
          <span className="l">Implied (previous award)</span>
          <span className="v" title={has ? `${n1(live.impliedBase)} FTE` : undefined}><span className="est-implied-v">{has ? fitNum(live.impliedBase, 7, n1) : '—'}</span><small> FTE</small></span>
          <span className="s">{has ? `${n1(bLo)}–${n1(bHi)} · ${usdCompact(live.annualValue)}/yr · ${td ? BASIS_LABEL[td.basis] : ''}` : 'Needs an award or spend value'}</span>
        </div>
        <div className="est__card est__card--gap">
          <span className="l">Gap</span>
          <span className="v">{has ? <span className={`delta-chip delta-chip--${deltaTone(live.deltaPct!)} est-delta-v`}>{signedPct(live.deltaPct!)}</span> : '—'}</span>
          <span className="s">{sentence}</span>
        </div>
      </div>
      {td?.recommendedFte ? <p className="est__ai"><Sparkles size={14} aria-hidden />AI recommends carrying {n1(td.recommendedFte)} FTE</p> : null}
      {est && has && <RangeLine live={live} />}
    </section>
  );
}

/** P1 range line (48 px): implied band (amber, 25%), implied tick, bottom-up ◆ (accent), AI ▼ (--ai). */
function RangeLine({ live }: { live: TopDownLive }) {
  const rec = live.td?.recommendedFte ?? 0;
  const [bLo, bHi] = band(live);
  const lo = Math.min(bLo, live.impliedBase, live.bottomUpFte, rec || Infinity) * 0.9;
  const hi = Math.max(bHi, live.impliedBase, live.bottomUpFte, rec) * 1.06;
  const x = (v: number) => `${((v - lo) / Math.max(1e-9, hi - lo)) * 100}%`;
  return (
    <div className="est__range" role="img" aria-label={`Implied range ${n1(bLo)} to ${n1(bHi)} FTE, midpoint ${n1(live.impliedBase)}; bottom-up ${n1(live.bottomUpFte)}${rec ? `; AI ${n1(rec)}` : ''}`}>
      <div className="est__range-track">
        <span className="band" style={{ left: x(bLo), width: `calc(${x(bHi)} - ${x(bLo)})` }} />
        <span className="tick" style={{ left: x(live.impliedBase) }} />
        <span className="bu" style={{ left: x(live.bottomUpFte) }}>◆</span>
        {rec > 0 && <span className="ai" style={{ left: x(rec) }}>▼</span>}
      </div>
      <div className="est__range-legend">
        <span><i className="sw-band" />Implied {n1(bLo)}–{n1(bHi)} · mid {n1(live.impliedBase)}</span>
        <span className="bu">◆ Bottom-up {n1(live.bottomUpFte)}</span>
        {rec > 0 && <span className="ai">▼ AI {n1(rec)}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ B. crews
function CrewsTable({ est }: { est: EstimateResult }) {
  const setWage = useStore((s) => s.setWage);
  const wages = useStore((s) => s.project?.wages);
  const crews = useMemo(() => [...est.crews].sort((a, b) => CREW_ORDER.indexOf(a.crew) - CREW_ORDER.indexOf(b.crew)), [est]);
  const [ref, width] = useWidth<HTMLElement>();
  const wide = width === 0 || width >= 376; // below this container width Hrs moves into the crew tooltip (spec: 360 with narrower columns)
  return (
    <section ref={ref} className="est__sec" id="est-crews">
      <h3>Crews <span className="muted">{n1(est.totalFte)} FTE · {usdCompact(est.totalLaborCost)}/yr</span></h3>
      <table className="est__table est__table--crews">
        <colgroup><col />{wide && <col className="c-hrs" />}<col className="c-fte" /><col className="c-heads" /><col className="c-wage" /><col className="c-labor" /></colgroup>
        <thead><tr><th scope="col">Crew</th>{wide && <th scope="col" className="r">Hrs</th>}<th scope="col" className="r">FTE</th><th scope="col" className="r">Heads</th><th scope="col" className="r">$/hr</th><th scope="col" className="r">Labor</th></tr></thead>
        <tbody>
          {crews.map((c) => {
            const Icon = CREW_ICON[c.crew];
            const meta = crewMeta(c.crew);
            const on = wages?.[c.crew] != null;
            return (
              <tr key={c.crew}>
                <td><Tooltip content={`${meta.label} · ${n0(c.hours)} hrs/yr · shift ${meta.shift.start}:00`}><span className="est__crew" tabIndex={0} style={{ ['--crew' as string]: crewColor(c.crew) }}><Icon size={14} strokeWidth={2} aria-hidden /><span className="nm">{meta.short}</span></span></Tooltip></td>
                {wide && <td className="r mono">{compact(c.hours)}</td>}
                <td className="r mono" title={`${n1(c.fte)} FTE`}>{fitNum(c.fte, 7, n1)}</td>
                <td className="r mono" title={`${c.headcount.toLocaleString()} heads`}>{fitNum(c.headcount, 5)}</td>
                <td className="r"><NumField size="sm" value={c.wage} decimals={2} rule={{ min: 0 }} overridden={on} placeholder={String(meta.defaultWage)} aria-label={`${meta.short} wage per hour`} onCommit={(v) => setWage(c.crew, v ?? null)} wrapClassName="wage" /></td>
                <td className="r mono">{usdCompact(c.annualCost)}</td>
              </tr>
            );
          })}
          <tr className="total"><td>Total</td>{wide && <td className="r mono">{compact(est.directHours)}</td>}<td className="r mono" title={`${n1(est.totalFte)} FTE`}>{fitNum(est.totalFte, 7, n1)}</td><td className="r mono" title={`${est.totalHeadcount.toLocaleString()} heads`}>{fitNum(est.totalHeadcount, 5)}</td><td /><td className="r mono">{usdCompact(est.totalLaborCost)}</td></tr>
        </tbody>
      </table>
      {wages && Object.keys(wages).length > 0 && <p className="est__note">{Object.keys(wages).length} custom wage{Object.keys(wages).length > 1 ? 's' : ''} (violet border). Defaults: {CREWS.filter((c) => wages[c.id] != null).map((c) => `${c.short} $${c.defaultWage}`).join(', ')}.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ C. cross-check
function CrossCheck({ est, live }: { est: EstimateResult | null; live: TopDownLive }) {
  const project = useStore((s) => s.project);
  const setPriorAward = useStore((s) => s.setPriorAward);
  const setOverride = useStore((s) => s.setTopDownOverride);
  const clearOverrides = useStore((s) => s.clearTopDownOverrides);
  const runTopDown = useStore((s) => s.runTopDown);
  const topDownRunning = useStore((s) => s.topDownRunning);
  const extracting = useStore((s) => s.extraction.running);
  const aiOk = useStore((s) => Boolean(s.health?.aiAvailable));
  const [more, setMore] = useState(false);
  if (!project) return null;
  const pa: PriorAward = project.priorAward ?? {};
  const overrides = project.topDownOverrides ?? {};
  const stored = project.topDown;
  const td = live.td;
  const has = live.deltaPct != null;
  const year = new Date().getFullYear();
  const months = td?.basis === 'spend' ? pa.spendPeriodMonths : td?.basis === 'award' ? pa.periodMonths : undefined;
  const locks = Object.values(overrides).filter((v) => v !== undefined).length;
  const total = Math.max(1, td?.annualValue ?? 1);
  return (
    <section className="est__sec est__xc" id="est-crosscheck" aria-label="Top-down cross-check">
      <div className="est__sticky" role="group" aria-label="Cross-check result">
        <span className="est__sticky-item"><span className="lbl">Bottom-up</span><b className="mono">{est ? fitNum(live.bottomUpFte, 7, n1) : '—'}</b></span>
        <span className="sep" aria-hidden>│</span>
        <span className="est__sticky-item"><span className="lbl">Implied</span><b className="mono implied">{has ? fitNum(live.impliedBase, 7, n1) : '—'}</b></span>
        <span className="sep" aria-hidden>│</span>
        <span className="est__sticky-delta">Δ {has ? <span className={`delta-chip delta-chip--${deltaTone(live.deltaPct!)}`}>{signedPct(live.deltaPct!)}</span> : <b>—</b>}</span>
        {live.stale && <Tooltip content="Numbers are live; the rationale was written for earlier inputs"><span className="est__stale-dot" tabIndex={0} aria-label="The rationale was written for earlier inputs"><History size={14} aria-hidden /></span></Tooltip>}
      </div>

      <h3>Previous award</h3>
      <Fields>
        <Field label="Incumbent" span="full">{(id) => <TextField id={id} value={pa.incumbent ?? ''} placeholder="—" onCommit={(v) => setPriorAward({ incumbent: v.trim() || undefined })} />}</Field>
        <Field label="Contract #">{(id) => <TextField id={id} value={pa.contractNumber ?? ''} placeholder="—" onCommit={(v) => setPriorAward({ contractNumber: v.trim() || undefined })} />}</Field>
        <Field label="Award year">{(id) => <NumField id={id} value={pa.awardYear} align="left" decimals={0} format={(v) => String(v)} placeholder="—" rule={{ min: 1990, max: year, integer: true }} onCommit={(v) => setPriorAward({ awardYear: v })} />}</Field>
        <Field label="Total award $">{(id) => <MoneyInput id={id} value={pa.totalValue} placeholder="—" rule={{ min: 0 }} onCommit={(v) => setPriorAward({ totalValue: v })} />}</Field>
        <Field label="Period (mo)">{(id) => <NumField id={id} value={pa.periodMonths} decimals={0} placeholder="60" rule={{ positive: true, integer: true }} onCommit={(v) => setPriorAward({ periodMonths: v })} />}</Field>
        <Field label="Spend to date $">{(id) => <MoneyInput id={id} value={pa.spendToDate} placeholder="—" rule={{ min: 0 }} onCommit={(v) => setPriorAward({ spendToDate: v })} />}</Field>
        <Field label="Spend months">{(id) => <NumField id={id} value={pa.spendPeriodMonths} decimals={0} placeholder="—" rule={{ positive: true, integer: true }} onCommit={(v) => setPriorAward({ spendPeriodMonths: v })} />}</Field>
        <Field label="Annual value $" span="full" hint="A stated annual value wins over total ÷ period and the spend run-rate.">{(id) => <MoneyInput id={id} value={pa.annualValue} placeholder="—" rule={{ min: 0 }} onCommit={(v) => setPriorAward({ annualValue: v })} />}</Field>
      </Fields>
      <p className="est__derived">{td && td.basis !== 'none'
        ? <>= <b>{usdCompact(td.rawAnnualValue)}/yr</b>{months ? ` over ${months} mo` : ''} · basis: {BASIS_LABEL[td.basis]}{td.rawAnnualValue !== td.annualValue ? ` · ${usdCompact(td.annualValue)}/yr escalated to today` : ''}</>
        : 'Enter a total award with its period, the spend to date with its months, or an annual value.'}</p>
      {pa.source?.excerpt && <blockquote className="est__quote">{pa.source.excerpt}<span>{pa.source.file}{pa.source.page ? ` · p.${pa.source.page}` : ''}</span></blockquote>}

      <div className="est__h3row">
        <h3>Pricing assumptions</h3>
        {locks > 0 && <Button size="sm" variant="ghost" icon={LockOpen} onClick={clearOverrides}>Unlock all ({locks})</Button>}
      </div>
      <div className="est__sliders">
        {td && SLIDERS.map((sl) => {
          const v = td.assumptions[sl.key] as number;
          const locked = overrides[sl.key] != null;
          return (
            <div key={sl.key} className={cx('est__slider', locked && 'is-locked')}>
              <span className="lbl" title={sl.label}>{sl.label}</span>
              <input type="range" min={sl.min} max={sl.max} step={sl.step} value={v} aria-label={sl.label} onChange={(e) => setOverride(sl.key, Number(e.target.value) as never)} />
              <NumField size="sm" value={v} kind={sl.pct ? 'percent' : 'number'} decimals={sl.decimals} suffix={sl.suffix} aria-label={`${sl.label} value`} rule={{ min: 0 }} onCommit={(x) => setOverride(sl.key, (x ?? undefined) as never)} wrapClassName="num" />
              <IconButton size="sm" icon={locked ? Lock : LockOpen} className={cx('est__lock', locked && 'is-locked')} pressed={locked}
                label={locked ? `${sl.label} is locked; click to use the reader's value` : `Lock ${sl.label} at this value`}
                tooltip={locked ? 'Locked: kept for future cross-check runs. Click to unlock.' : 'Lock this value (a slider move also locks it)'}
                onClick={() => setOverride(sl.key, (locked ? undefined : v) as never)} />
            </div>
          );
        })}
        {!td && <p className="muted est__note">The assumptions appear once facilities are estimated.</p>}
      </div>

      {td && td.annualValue > 0 && (
        <>
          <div className="est__wf" role="img" aria-label="How the annual value splits">
            {WF.map((w) => <span key={w.key} style={{ width: `${(td.priceBreakdown[w.key] / total) * 100}%`, background: w.color }} />)}
          </div>
          <div className="est__wf-legend">
            {WF.filter((w) => td.priceBreakdown[w.key] > 0).map((w) => <span key={w.key}><i style={{ background: w.color }} aria-hidden />{w.label} {usdCompact(td.priceBreakdown[w.key])}</span>)}
          </div>
        </>
      )}

      {live.stale && stored && (
        <div className="est__stale" role="status">
          <History size={14} aria-hidden />
          <span>Numbers are live; the rationale below was written for earlier inputs</span>
          <Button size="sm" variant="secondary" icon={RefreshCw} disabled={topDownRunning || extracting || !est} onClick={() => void runTopDown('auto')}>{topDownRunning ? 'Re-running…' : 'Re-run'}</Button>
        </div>
      )}
      {stored?.rationale && (
        <div className="est__rat">
          <div className="who">{stored.provider === 'claude' ? <><Sparkles size={13} aria-hidden /> AI pricing lead · {stored.model}</> : 'Rule-based assumptions'} · {new Date(stored.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {new Date(stored.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <p className={cx('est__rationale', more && 'is-open')}>{stored.rationale}</p>
          {more && stored.risks.length > 0 && <ul className="est__risks">{stored.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <button type="button" className="est__more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Less' : stored.risks.length ? `More · ${stored.risks.length} risks` : 'More'}</button>
        </div>
      )}
      <div className="est__btns">
        <Button size="sm" variant="secondary" icon={RefreshCw} disabled={topDownRunning || extracting || !est} onClick={() => void runTopDown('auto')}>{topDownRunning ? 'Re-running…' : aiOk ? 'Re-run AI cross-check' : 'Re-run cross-check'}</Button>
      </div>
      <p className="est__note">Loaded labor = annual value ÷ ((1 + G&amp;A)(1 + fee)) − ODC − subs; implied FTE = loaded labor ÷ loaded cost per FTE. Moving a slider locks that assumption.</p>
    </section>
  );
}

// ------------------------------------------------------------------ D. manning per contract year
function Manning({ est }: { est: EstimateResult }) {
  const max = Math.max(1, ...est.years.map((y) => y.fte));
  return (
    <section className="est__sec" id="est-years">
      <h3>Manning per contract year</h3>
      <table className="est__table est__table--years">
        <colgroup><col /><col className="c-h" /><col className="c-f" /><col className="c-hd" /><col className="c-l" /></colgroup>
        <thead><tr><th scope="col">Period</th><th scope="col" className="r">Hours</th><th scope="col" className="r">FTE</th><th scope="col" className="r">Heads</th><th scope="col" className="r">Labor</th></tr></thead>
        <tbody>{est.years.map((y) => (
          <tr key={y.year}>
            <td title={y.label}>{y.label}</td>
            <td className="r mono">{compact(y.hours)}</td>
            <td className="r mono est__fte-cell" title={`${n2(y.fte)} FTE`}><span className="bar" style={{ width: `${(y.fte / max) * 100}%` }} aria-hidden /><span>{fitNum(y.fte, 8, n2)}</span></td>
            <td className="r mono" title={`${y.headcount.toLocaleString()} heads`}>{fitNum(y.headcount, 5)}</td>
            <td className="r mono">{usdCompact(y.laborCost)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

// ------------------------------------------------------------------ E. assumptions, F. site
function AssumptionsSection() {
  const ov = useStore((s) => s.project?.assumptionOverrides);
  const setAssumption = useStore((s) => s.setAssumption);
  const a = { ...DEFAULT_ASSUMPTIONS, ...(ov ?? {}) };
  const ovr = (k: keyof typeof a) => ov?.[k] !== undefined;
  const ownLevel = useStore((s) => s.project?.inventory.facilities.filter((f) => f.cleaningLevel).length ?? 0);
  return (
    <section className="est__sec" id="est-assumptions">
      <h3>Estimating assumptions</h3>
      <Fields>
        <Field label="Productive hrs / FTE">{(id) => <NumField id={id} value={a.productiveHoursPerFte} decimals={0} required overridden={ovr('productiveHoursPerFte')} rule={{ positive: true }} onCommit={(v) => setAssumption('productiveHoursPerFte', v)} />}</Field>
        <Field label="Supervisor ratio (1 : N)">{(id) => <NumField id={id} value={a.supervisorRatio} decimals={0} required overridden={ovr('supervisorRatio')} rule={{ positive: true }} onCommit={(v) => setAssumption('supervisorRatio', v)} />}</Field>
        <Field label="Contract years">{(id) => <NumField id={id} value={a.contractYears} decimals={0} required overridden={ovr('contractYears')} rule={{ min: 1, max: 15, integer: true }} onCommit={(v) => setAssumption('contractYears', v)} />}</Field>
        <Field label="Workload growth / yr">{(id) => <NumField id={id} value={a.workloadGrowthPerYear} kind="percent" decimals={1} suffix="%" overridden={ovr('workloadGrowthPerYear')} onCommit={(v) => setAssumption('workloadGrowthPerYear', v)} />}</Field>
        <Field label="Wage escalation / yr">{(id) => <NumField id={id} value={a.wageEscalationPerYear} kind="percent" decimals={1} suffix="%" overridden={ovr('wageEscalationPerYear')} onCommit={(v) => setAssumption('wageEscalationPerYear', v)} />}</Field>
        <Field label="Climate zone">{(id) => <Select<ClimateZone> id={id} value={a.climateZone} onChange={(v) => setAssumption('climateZone', v)} options={[{ value: 'cold', label: 'Cold (snow)' }, { value: 'temperate', label: 'Temperate' }, { value: 'hot_humid', label: 'Hot / humid' }, { value: 'arid', label: 'Arid' }]} />}</Field>
        <Field label="Growing season (wk)">{(id) => <NumField id={id} value={a.growingSeasonWeeks} decimals={0} overridden={ovr('growingSeasonWeeks')} rule={{ min: 0, max: 52 }} onCommit={(v) => setAssumption('growingSeasonWeeks', v)} />}</Field>
        <Field label="Snow events / yr">{(id) => <NumField id={id} value={a.snowEventsPerYear} decimals={0} overridden={ovr('snowEventsPerYear')} rule={{ min: 0 }} onCommit={(v) => setAssumption('snowEventsPerYear', v)} />}</Field>
        <Field label="Cleaning standard" span="full" hint={`${CLEANING_LEVELS.find((x) => x.id === a.cleaningLevel)?.sfPerShift ?? ''}${ownLevel ? ` · ${ownLevel.toLocaleString()} ${ownLevel === 1 ? 'facility sets its' : 'facilities set their'} own level` : ''}`}>{(id) => <Select id={id} value={String(a.cleaningLevel)} onChange={(v) => setAssumption('cleaningLevel', Number(v) as CleaningLevel)} options={CLEANING_LEVELS.map((x) => ({ value: String(x.id), label: x.label }))} />}</Field>
        <Field label="Cleanable share (default)">{(id) => <NumField id={id} value={a.cleanableShareDefault} kind="percent" decimals={0} suffix="%" overridden={ovr('cleanableShareDefault')} rule={{ min: 0, max: 1 }} onCommit={(v) => setAssumption('cleanableShareDefault', v)} />}</Field>
      </Fields>
    </section>
  );
}

function SiteSection() {
  const site = useStore((s) => s.project?.inventory.site);
  const patchInventory = useStore((s) => s.patchInventory);
  if (!site) return null;
  const set = (k: 'installationName' | 'location' | 'solicitation' | 'contractName') => (v: string) => patchInventory((inv) => ({ ...inv, site: { ...inv.site, [k]: v.trim() || undefined } }));
  return (
    <section className="est__sec" id="est-site">
      <h3>Site</h3>
      <Fields>
        <Field label="Installation">{(id) => <TextField id={id} value={site.installationName ?? ''} placeholder="—" onCommit={set('installationName')} />}</Field>
        <Field label="Location">{(id) => <TextField id={id} value={site.location ?? ''} placeholder="—" onCommit={set('location')} />}</Field>
        <Field label="Solicitation">{(id) => <TextField id={id} value={site.solicitation ?? ''} placeholder="—" onCommit={set('solicitation')} />}</Field>
        <Field label="Contract">{(id) => <TextField id={id} value={site.contractName ?? ''} placeholder="—" onCommit={set('contractName')} />}</Field>
      </Fields>
      {site.notes && <p className="est__note">{site.notes}</p>}
    </section>
  );
}
