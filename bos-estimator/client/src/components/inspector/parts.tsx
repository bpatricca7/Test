// Inspector building blocks (UI spec §5.7): collapsible section, source excerpt with the SF check, crew bars,
// floor-mix bar and the RS Means workload table (in the body flow, never a nested scroller).
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../../store';
import { crewMeta, factorById, type Crew } from '@shared/factors';
import type { EstimateResult, TaskLine } from '@shared/estimate';
import type { FloorMix } from '@shared/types';
import { n0, n2, unitLabel } from '../../fmt';
import { CREW_ORDER, crewColor, FINISH_COLORS } from '../lib/theme';
import { normBldg } from '../lib/review';
import { cx } from '../lib/cx';
import { Button, NumField, Tooltip } from '../ui';
import { CREW_ICON } from '../bottom/crewIcons';

// ------------------------------------------------------------------ section (32 px head, collapse persisted)
export function Section({ id, title, extra, children, className }: { id: string; title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  const key = `insp.${id}`;
  const collapsed = useStore((s) => s.uiSections[key] ?? false);
  const setUiSection = useStore((s) => s.setUiSection);
  const bodyId = `insp-sec-${id}`;
  return (
    <section className={cx('insp__sec', collapsed && 'is-collapsed', className)} data-section={id}>
      <div className="insp__sec-head">
        <button type="button" className="insp__sec-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setUiSection(key, !collapsed)}>
          <ChevronDown size={14} strokeWidth={2} aria-hidden className="insp__chev" />
          <span>{title}</span>
        </button>
        {extra && <span className="insp__sec-extra">{extra}</span>}
      </div>
      {!collapsed && <div id={bodyId} className="insp__sec-body">{children}</div>}
    </section>
  );
}

/** Width of an element (ResizeObserver), for container-dependent columns. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ------------------------------------------------------------------ source excerpt
const NUM = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s*[kK](?![a-zA-Z]))?/g;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 0.005;
const isYear = (raw: string, v: number) => !raw.includes(',') && raw.length === 4 && v >= 1900 && v <= 2100;

export interface ExcerptToken { text: string; value?: number; tone?: 'ok' | 'warn' }

/** Split an excerpt into text and numbers: numbers equal to a row field are `ok`, other area-like numbers `warn`. */
export function tokenizeExcerpt(text: string, rowValues: number[], bldgNo?: string): ExcerptToken[] {
  const out: ExcerptToken[] = [];
  const bn = normBldg(bldgNo);
  let last = 0;
  NUM.lastIndex = 0;
  for (let m = NUM.exec(text); m; m = NUM.exec(text)) {
    const prev = text[m.index - 1] ?? ' ';
    const raw = m[1];
    let v = Number(raw.replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''));
    if (m[3]) v *= 1000;
    if (/[A-Za-z_\-/]/.test(prev) || !Number.isFinite(v)) continue; // part of an identifier (W912QR-20-C-0015, TE-5)
    const isRow = rowValues.some((c) => c > 0 && near(v, c));
    const areaLike = !isRow && v >= 1000 && !isYear(raw, v) && normBldg(raw) !== bn;
    if (!isRow && !areaLike) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], value: v, tone: isRow ? 'ok' : 'warn' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function Excerpt({ text, rowValues, bldgNo }: { text: string; rowValues: number[]; bldgNo?: string }) {
  const tokens = useMemo(() => tokenizeExcerpt(text, rowValues, bldgNo), [text, rowValues, bldgNo]);
  return (
    <blockquote className="insp__quote">
      {tokens.map((t, i) => (t.tone ? <mark key={i} className={`ex-${t.tone}`} title={t.tone === 'ok' ? 'Matches a field of this row' : 'Area-like number not used by this row'}>{t.text}</mark> : <span key={i}>{t.text}</span>))}
    </blockquote>
  );
}

// ------------------------------------------------------------------ crew bars
export function CrewBars({ hoursByCrew, productive }: { hoursByCrew: Partial<Record<Crew, number>>; productive: number }) {
  const entries = CREW_ORDER.map((c) => [c, hoursByCrew[c] ?? 0] as const).filter(([, h]) => h > 0);
  if (!entries.length) return <p className="muted insp__empty">No crew hours: nothing in scope for this row.</p>;
  const max = Math.max(1, ...entries.map(([, h]) => h));
  return (
    <div className="insp__crews">
      {entries.map(([c, h]) => {
        const Icon = CREW_ICON[c];
        return (
          <div key={c} className="insp__crew">
            <span className="insp__crew-name"><span className="dot" style={{ background: crewColor(c) }} aria-hidden /><Icon size={14} strokeWidth={1.75} aria-hidden />{crewMeta(c).short}</span>
            <span className="mono">{n0(h)} h · {n2(h / productive)} FTE</span>
            <span className="bar" aria-hidden><span style={{ width: `${(h / max) * 100}%`, background: crewColor(c) }} /></span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ floor mix
const FINISH_LABEL: Record<keyof FloorMix, string> = { carpet: 'Carpet', resilient: 'Resilient', hardTile: 'Hard tile', concrete: 'Concrete', wood: 'Wood' };
export function FloorMixBar({ mix }: { mix: FloorMix }) {
  const parts = (Object.keys(FINISH_LABEL) as (keyof FloorMix)[]).map((k) => [k, mix[k] ?? 0] as const).filter(([, v]) => v > 0.005);
  const sum = parts.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="insp__mix">
      <div className="insp__mix-bar" role="img" aria-label={`Floor mix: ${parts.map(([k, v]) => `${FINISH_LABEL[k]} ${Math.round((v / sum) * 100)}%`).join(', ')}`}>
        {parts.map(([k, v]) => <span key={k} style={{ width: `${(v / sum) * 100}%`, background: FINISH_COLORS[k] }} />)}
      </div>
      <div className="insp__mix-legend">
        {parts.map(([k, v]) => <span key={k}><i style={{ background: FINISH_COLORS[k] }} aria-hidden />{FINISH_LABEL[k]} {Math.round((v / sum) * 100)}%</span>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ workload (RS Means lines)
/** ⅓× / ½× / 250× / 1.50× */
export const fracFreq = (v: number) => {
  if (Math.abs(v - 1 / 3) < 0.005) return '⅓×';
  if (Math.abs(v - 0.5) < 0.005) return '½×';
  if (Math.abs(v - 0.25) < 0.005) return '¼×';
  if (Math.abs(v - 2 / 3) < 0.005) return '⅔×';
  return Number.isInteger(Math.round(v * 1000) / 1000) ? `${Math.round(v)}×` : `${v.toFixed(2)}×`;
};

/** factorId → number of facilities and grounds areas whose estimate uses it. */
export function useFactorUsage(est: EstimateResult | null): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    if (!est) return m;
    for (const fe of est.facilities) for (const l of fe.lines) m.set(l.factorId, (m.get(l.factorId) ?? 0) + 1);
    for (const ge of est.grounds) for (const l of ge.lines) m.set(l.factorId, (m.get(l.factorId) ?? 0) + 1);
    return m;
  }, [est]);
}

export const Workload = memo(function Workload({ lines, overrides, usage, productive }: { lines: TaskLine[]; overrides: Record<string, number>; usage: Map<string, number>; productive: number }) {
  const setOverride = useStore((s) => s.setFactorOverride);
  const [ref, width] = useWidth<HTMLDivElement>();
  const wide = width >= 420;
  const groups = useMemo(() => CREW_ORDER.map((crew) => ({ crew, lines: lines.filter((l) => l.crew === crew).sort((a, b) => b.annualHours - a.annualHours) })).filter((g) => g.lines.length), [lines]);
  if (!lines.length) return <p className="muted insp__empty">No RS Means lines apply to this scope.</p>;
  const cols = wide ? 6 : 4;
  const overriddenHere = lines.filter((l) => overrides[l.factorId] != null);
  return (
    <div ref={ref} className="wl">
      <table className={cx('wl__table', wide && 'is-wide')}>
        <colgroup><col />{wide && <><col className="c-qty" /><col className="c-unit" /></>}<col className="c-freq" /><col className="c-lh" /><col className="c-hrs" /></colgroup>
        <thead>
          <tr><th scope="col">Task</th>{wide && <><th scope="col" className="r">Qty</th><th scope="col">Unit</th></>}<th scope="col" className="r">×/yr</th><th scope="col" className="r">LH/unit</th><th scope="col" className="r">Hrs/yr</th></tr>
        </thead>
        {groups.map((g) => {
          const hrs = g.lines.reduce((s, l) => s + l.annualHours, 0);
          const Icon = CREW_ICON[g.crew];
          return (
            <tbody key={g.crew}>
              <tr className="wl__sub">
                <th scope="rowgroup" colSpan={cols}>
                  <span className="wl__sub-in"><span className="dot" style={{ background: crewColor(g.crew) }} aria-hidden /><Icon size={13} strokeWidth={1.75} aria-hidden />{crewMeta(g.crew).short}
                    <span className="wl__sub-n mono">{n0(hrs)} h · {n2(hrs / productive)} FTE</span></span>
                </th>
              </tr>
              {g.lines.map((l) => {
                const on = overrides[l.factorId] != null;
                const def = factorById(l.factorId)?.lhPerUnit;
                const n = usage.get(l.factorId) ?? 1;
                return (
                  <tr key={l.factorId} className={cx(on && 'is-overridden')}>
                    <td className="wl__task"><span className="task">{l.name}</span><span className="ref">{l.ref}{wide ? '' : ` · ${l.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unitLabel[l.unit] ?? l.unit}`}</span></td>
                    {wide && <><td className="r mono">{l.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td><td className="muted">{unitLabel[l.unit] ?? l.unit}</td></>}
                    <td className="r mono">{fracFreq(l.frequencyPerYear)}</td>
                    <td className="r">
                      <Tooltip content={`${on ? `Overridden (default ${def})` : `Default ${def}`} · applies to ${n.toLocaleString()} row${n === 1 ? '' : 's'} using this factor`}>
                        <span className="wl__lh">
                          <NumField size="sm" value={l.lhPerUnit} decimals={4} rule={{ min: 0 }} overridden={on} placeholder={def != null ? String(def) : ''}
                            aria-label={`Labor-hours per unit for ${l.name}`} onCommit={(v) => setOverride(l.factorId, v ?? null)} />
                        </span>
                      </Tooltip>
                    </td>
                    <td className="r mono">{n0(l.annualHours)}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      <p className="wl__note">LH/unit overrides apply to every facility and area using that factor{overriddenHere.length ? ` · ${overriddenHere.length} overridden here` : ''}.
        {overriddenHere.length > 0 && <Button size="sm" variant="ghost" onClick={() => { for (const l of overriddenHere) setOverride(l.factorId, null); }}>Revert</Button>}
      </p>
    </div>
  );
});

