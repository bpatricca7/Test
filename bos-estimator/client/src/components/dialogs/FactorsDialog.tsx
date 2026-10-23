// FactorsDialog (UI spec §5.11): min(1180px,94vw) × min(820px,90vh); Esc, focus trap and focus return come from the
// Dialog primitive. Override inputs are empty with a "—" placeholder and commit on Enter / Tab / blur; overridden rows
// get a 3 px --edit bar; frequencies read as fractions (⅓× mowing cycles), never 0.3333…; each line shows its
// RS Means reference and benchmark basis. P1: "Hrs driven" and "% of total" summed from the estimate by factorId and
// sorted by hours driven by default, an "Overridden only" filter, and bulk paste of factorId,value lines.
import { useMemo, useRef, useState } from 'react';
import { ClipboardPaste, RotateCcw, Search } from 'lucide-react';
import { useStore } from '../../store';
import { useDerived } from '../../derived';
import { CREWS, FACTORS, crewMeta, factorById, type Crew, type Factor, type FrequencyRule } from '@shared/factors';
import { compact, unitLabel } from '../../fmt';
import { CREW_ORDER, crewColor } from '../lib/theme';
import { cx } from '../lib/cx';
import { parseNumber } from '../lib/parse';
import { Button, Dialog, IconButton, NumField, Popover, Segmented, Toggle, Tooltip, usePopover } from '../ui';
import { CREW_ICON, hhmm } from '../bottom/crewIcons';
import '../../styles/dialogs.css';

const fracTimes = (n: number) => (Math.abs(n - 1 / 3) < 0.01 ? '⅓' : Math.abs(n - 0.5) < 0.01 ? '½' : Math.abs(n - 0.25) < 0.01 ? '¼' : Math.abs(n - 2 / 3) < 0.01 ? '⅔' : Number.isInteger(n) ? String(n) : n.toFixed(2));
export const freqLabel = (f: FrequencyRule): string => {
  switch (f.kind) {
    case 'per_service_day': return 'each service day';
    case 'per_year': return `${fracTimes(f.times)}× / yr`;
    case 'mow_cycles': return f.multiplier === 1 ? 'each mowing cycle' : `${fracTimes(f.multiplier)}× mowing cycles`;
    case 'snow_events': return 'per snow event';
    case 'leaf_season': return '3× / yr (cold & temperate)';
    case 'dining_days': return 'each operating day';
    case 'dining_meal_periods': return 'each meal period';
    case 'per_meal': return 'per meal served';
  }
};

type SortMode = 'hours' | 'crew';

export function FactorsDialog() {
  const open = useStore((s) => s.factorsOpen);
  const setOpen = useStore((s) => s.setFactorsOpen);
  if (!open) return null;
  return <FactorsBody onClose={() => setOpen(false)} />;
}

/** factorId → annual hours it drives across every facility and grounds area. */
function useHoursDriven() {
  const { est } = useDerived();
  return useMemo(() => {
    const m = new Map<string, number>();
    let total = 0;
    if (est) {
      for (const fe of est.facilities) for (const l of fe.lines) { m.set(l.factorId, (m.get(l.factorId) ?? 0) + l.annualHours); total += l.annualHours; }
      for (const ge of est.grounds) for (const l of ge.lines) { m.set(l.factorId, (m.get(l.factorId) ?? 0) + l.annualHours); total += l.annualHours; }
    }
    return { byId: m, total, has: Boolean(est && (est.facilities.length || est.grounds.length)) };
  }, [est]);
}

function FactorsBody({ onClose }: { onClose: () => void }) {
  const overrides = useStore((s) => s.project?.factorOverrides ?? EMPTY);
  const setOverride = useStore((s) => s.setFactorOverride);
  const hours = useHoursDriven();
  const [q, setQ] = useState('');
  const [onlyOverridden, setOnlyOverridden] = useState(false);
  const [sort, setSort] = useState<SortMode>(() => (hours.has ? 'hours' : 'crew'));
  const overridden = Object.keys(overrides).length;
  const match = (f: Factor) => (!q || `${f.name} ${f.ref} ${f.id} ${crewMeta(f.crew).short}`.toLowerCase().includes(q.toLowerCase())) && (!onlyOverridden || overrides[f.id] != null);
  const flat = useMemo(() => FACTORS.filter(match).sort((a, b) => (hours.byId.get(b.id) ?? 0) - (hours.byId.get(a.id) ?? 0) || CREW_ORDER.indexOf(a.crew) - CREW_ORDER.indexOf(b.crew)), [q, onlyOverridden, overrides, hours]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => CREW_ORDER.map((crew) => ({ crew, factors: FACTORS.filter((f) => f.crew === crew && match(f)) })).filter((g) => g.factors.length), [q, onlyOverridden, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = sort === 'hours' ? flat.length : groups.reduce((s, g) => s + g.factors.length, 0);
  const resetAll = async () => {
    const ok = await useStore.getState().confirm({ title: `Reset ${overridden} factor override${overridden === 1 ? '' : 's'}?`, body: 'Every line goes back to its default labor-hours per unit.', confirmLabel: 'Reset overrides', danger: true });
    if (ok) for (const k of Object.keys(overrides)) setOverride(k, null);
  };
  return (
    <Dialog open onClose={onClose} title="RS Means-style productivity factors" subtitle={`${FACTORS.length} lines · ${overridden} overridden${hours.has ? ` · ${compact(hours.total)} direct hrs/yr` : ''}`}
      width="min(1180px, 94vw)" height="min(820px, 90vh)" className="factors" initialFocus=".factors__search input"
      headerExtra={<label className="factors__search"><Search size={14} aria-hidden /><input placeholder="Filter tasks, refs, crews…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter factors" /></label>}>
      <div className="factors__body">
        <aside className="factors__side">
          <p><b>How these are used.</b> Every line is a labor-hour-per-unit rate in the format of RSMeans Facilities Maintenance &amp; Repair data (task · crew · unit · frequency). Annual hours = quantity × rate × occurrences per year; FTE = hours ÷ productive hours per FTE.</p>
          <p><b>Reconcile before bidding.</b> RSMeans data is licensed; the defaults are representative BOS values with the benchmark basis shown under each line. Type the licensed value (or your own historical productivity) into Override. Overrides are saved with the project and apply to every facility using the line.</p>
          <ul className="factors__crews" aria-label="Crew shifts">
            {CREWS.map((c) => { const Icon = CREW_ICON[c.id]; return <li key={c.id}><span className="dot" style={{ background: crewColor(c.id) }} aria-hidden /><Icon size={13} strokeWidth={1.75} aria-hidden />{c.short}<span className="mono">{hhmm(c.shift.start)}–{hhmm(c.shift.end)}</span></li>; })}
          </ul>
          <BulkPaste />
          {overridden > 0 && <Button size="sm" variant="danger-ghost" icon={RotateCcw} onClick={() => void resetAll()}>Reset all overrides</Button>}
        </aside>
        <div className="factors__main">
          <div className="factors__bar">
            <Segmented size="sm" label="Order" value={sort} onChange={setSort} options={[{ value: 'hours', label: 'By hours driven', disabled: !hours.has, tooltip: hours.has ? undefined : 'Needs an estimate' }, { value: 'crew', label: 'By crew' }]} />
            <Toggle size="sm" checked={onlyOverridden} onChange={setOnlyOverridden} label={`Overridden only${overridden ? ` (${overridden})` : ''}`} disabled={!overridden && !onlyOverridden} />
            <span className="factors__count">{shown} of {FACTORS.length}</span>
          </div>
          <table className="factors__table">
            <colgroup><col /><col className="c-unit" /><col className="c-freq" /><col className="c-def" /><col className="c-ovr" /><col className="c-hrs" /><col className="c-pct" /><col className="c-x" /></colgroup>
            <thead>
              <tr><th scope="col">Task · reference · basis</th><th scope="col">Unit</th><th scope="col">Frequency</th><th scope="col" className="r" title="Default labor-hours per unit">Default</th><th scope="col" className="r">Override</th>
                <th scope="col" className="r">Hrs driven</th><th scope="col" className="r">% of total</th><th scope="col"><span className="sr-only">Revert</span></th></tr>
            </thead>
            {sort === 'hours'
              ? <tbody>{flat.map((f) => <Row key={f.id} f={f} overrides={overrides} hours={hours} showCrew />)}</tbody>
              : groups.map((g) => <Group key={g.crew} crew={g.crew} factors={g.factors} overrides={overrides} hours={hours} />)}
          </table>
          {shown === 0 && <p className="muted factors__none">{onlyOverridden && !q ? 'No overrides yet.' : `No factor matches “${q}”.`}</p>}
        </div>
      </div>
    </Dialog>
  );
}
const EMPTY: Record<string, number> = {};
type Hours = ReturnType<typeof useHoursDriven>;

function Group({ crew, factors, overrides, hours }: { crew: Crew; factors: Factor[]; overrides: Record<string, number>; hours: Hours }) {
  const meta = crewMeta(crew);
  const Icon = CREW_ICON[crew];
  const sum = factors.reduce((s, f) => s + (hours.byId.get(f.id) ?? 0), 0);
  return (
    <tbody>
      <tr className="factors__crewhead"><th scope="rowgroup" colSpan={8}><span className="in"><span className="dot" style={{ background: crewColor(crew) }} aria-hidden /><Icon size={14} strokeWidth={1.75} aria-hidden />{meta.label}{hours.has && <span className="hrs mono">{compact(sum)} hrs/yr</span>}</span></th></tr>
      {factors.map((f) => <Row key={f.id} f={f} overrides={overrides} hours={hours} />)}
    </tbody>
  );
}

function Row({ f, overrides, hours, showCrew }: { f: Factor; overrides: Record<string, number>; hours: Hours; showCrew?: boolean }) {
  const setOverride = useStore((s) => s.setFactorOverride);
  const on = overrides[f.id] != null;
  const h = hours.byId.get(f.id) ?? 0;
  const pct = hours.total > 0 ? h / hours.total : 0;
  return (
    <tr className={cx(on && 'is-overridden', h === 0 && hours.has && 'is-idle')}>
      <td className="factors__task">
        <span className="nm">{showCrew && <span className="dot" style={{ background: crewColor(f.crew) }} title={crewMeta(f.crew).short} aria-label={crewMeta(f.crew).short} />}{f.name}</span>
        <span className="ref mono">{f.ref}{f.note ? ` · ${f.note}` : ''}</span>
        {f.basis && <Tooltip content={f.basis} placement="bottom-start"><span className="basis" tabIndex={0}>Basis: {f.basis}</span></Tooltip>}
      </td>
      <td>{unitLabel[f.unit] ?? f.unit}</td>
      <td>{freqLabel(f.frequency)}</td>
      <td className="r mono">{f.lhPerUnit}</td>
      <td className="r"><NumField size="sm" value={overrides[f.id]} decimals={4} placeholder="—" rule={{ min: 0 }} overridden={on} aria-label={`Override for ${f.name}`} onCommit={(v) => setOverride(f.id, v ?? null)} wrapClassName="factors__ovr" /></td>
      <td className="r mono">{hours.has ? (h > 0 ? compact(h) : '—') : '—'}</td>
      <td className="r mono factors__pct">{hours.has && h > 0 ? <><span className="bar" style={{ width: `${Math.min(100, pct * 100 * 2)}%` }} aria-hidden /><span>{pct >= 0.001 ? `${(pct * 100).toFixed(1)}%` : '<0.1%'}</span></> : '—'}</td>
      <td>{on && <IconButton size="sm" icon={RotateCcw} label={`Revert ${f.name} to ${f.lhPerUnit}`} tooltip={`Revert to the default (${f.lhPerUnit})`} onClick={() => setOverride(f.id, null)} />}</td>
    </tr>
  );
}

/** P1: paste "factorId,value" (or tab-separated) lines; reports applied and skipped lines. */
function BulkPaste() {
  const pop = usePopover<HTMLButtonElement>();
  const setOverride = useStore((s) => s.setFactorOverride);
  const [text, setText] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = () => {
    let ok = 0; const skipped: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const [id, val] = line.split(/[,\t;]\s*/);
      const f = id ? factorById(id.trim()) : undefined;
      const r = val != null ? parseNumber(val) : { ok: false as const, error: 'no value' };
      if (!f) { skipped.push(`${id ?? line}: unknown factor`); continue; }
      if (!r.ok || r.value === undefined || r.value < 0) { skipped.push(`${id}: bad value`); continue; }
      setOverride(f.id, r.value); ok++;
    }
    setReport(`Applied ${ok} override${ok === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.length}: ${skipped.slice(0, 4).join('; ')}${skipped.length > 4 ? '…' : ''}` : ''}.`);
    if (ok) setText('');
  };
  return (
    <>
      <Button ref={pop.anchorRef} size="sm" variant="secondary" icon={ClipboardPaste} aria-expanded={pop.open} onClick={() => { setReport(null); pop.toggle(); }}>Paste overrides…</Button>
      <Popover {...pop.props} placement="right-start" label="Paste overrides" className="factors__paste" initialFocus="textarea">
        <label className="factors__paste-l" htmlFor="factors-paste">One <code>factorId,value</code> per line (tab or comma), e.g. <code>cust_trash,0.06</code></label>
        <textarea id="factors-paste" ref={area} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'cust_trash,0.06\nfc_strip_wax\t7.2'} spellCheck={false} />
        {report && <p className="factors__paste-r" role="status">{report}</p>}
        <div className="factors__paste-foot"><Button size="sm" variant="ghost" onClick={pop.close}>Close</Button><Button size="sm" variant="primary" disabled={!text.trim()} onClick={apply}>Apply</Button></div>
      </Popover>
    </>
  );
}
