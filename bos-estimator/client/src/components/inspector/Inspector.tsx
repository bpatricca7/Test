// Right panel › Inspector (UI spec §5.7): a fixed header plus ONE scroll body (no nested scrollers).
// Sections have collapsible 32 px heads whose state persists in bos.ui.v1 (store.uiSections). Every editable field
// commits on Enter / Tab / blur (NumField / TextField / Select), never per keystroke.
import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Crosshair, Flag, LogIn, Plus, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../../store';
import { useDerived, useTopDownLive } from '../../derived';
import { CATEGORY_DEFAULTS, crewMeta } from '@shared/factors';
import { DEFAULT_ASSUMPTIONS, groundsAcres, resolveMealsPerDay, diningMealsPerDay } from '@shared/estimate';
import { FACILITY_CATEGORIES, FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, isInScope, type DiningProfile, type Facility, type GroundsArea, type GroundsUnit, type ScopeItem } from '@shared/types';
import { n0, n1, n2, signedPct } from '../../fmt';
import { CONF_COLOR, CONF_GLYPH, CREW_ORDER, crewColor, categoryColor } from '../lib/theme';
import { ISSUE_INFO, sfInExcerpt, type IssueCode } from '../lib/review';
import { cx } from '../lib/cx';
import { Button, Chip, Field, Fields, IconButton, NumField, Select, TextField, Tooltip } from '../ui';
import { CrewBars, Excerpt, FloorMixBar, Section, Workload, closestAreaNumber, useFactorUsage } from './parts';
import { firstNeedsByImpact, goToRow } from './queue';
import { nextNeeds, useReviewPosition } from '../inventory/reviewLoop';
import '../../styles/inspector.css';

const BAND_WORD = { hi: 'high', mid: 'medium', lo: 'low' } as const;
const SCOPES: { id: ScopeItem; label: string }[] = [{ id: 'custodial', label: 'Custodial' }, { id: 'floor_care', label: 'Floor care' }, { id: 'dining', label: 'Dining' }, { id: 'grounds', label: 'Grounds' }];
const UNIT_LABEL: Record<string, string> = { sf: 'SF', sm: 'm²', sy: 'SY' };
const GROUNDS_UNITS: { value: GroundsUnit; label: string }[] = [{ value: 'acres', label: 'acres' }, { value: 'hectares', label: 'hectares' }, { value: 'sqft', label: 'SF' }, { value: 'sqm', label: 'm²' }, { value: 'sqyd', label: 'SY' }, { value: 'lf', label: 'LF' }, { value: 'each', label: 'each' }];
const SERVICE_STYLES: { value: NonNullable<DiningProfile['serviceStyle']>; label: string }[] = [{ value: 'full_food_service', label: 'Full food service' }, { value: 'dining_facility_attendant', label: 'DFA only' }, { value: 'management_only', label: 'Management only' }];

export const Inspector = memo(function Inspector() {
  const selection = useStore((s) => s.selection);
  const { facById, groundsById } = useDerived();
  if (selection.kind === 'facility') { const f = facById.get(selection.id); if (f) return <FacilityInspector key={f.id} f={f} />; }
  if (selection.kind === 'grounds') { const g = groundsById.get(selection.id); if (g) return <GroundsInspector key={g.id} g={g} />; }
  return <ProjectSummary />;
});

// ------------------------------------------------------------------ shared header pieces
/** "‹ K · 7 / 32 · J ›": the inventory's review loop (same order and wrap-around as the J / K keys). */
function QueueNav({ id }: { id: string }) {
  const pos = useReviewPosition();
  const total = pos.total;
  const only = total === 1 && pos.index === 1;
  return (
    <div className="insp__nav" role="group" aria-label="Needs-review queue" data-row={id}>
      <IconButton size="sm" icon={ChevronLeft} label="Previous row that needs review" tooltip="Previous needs-review row (K)" disabled={!total || only} onClick={() => nextNeeds(-1)} />
      <Tooltip content={total ? `${pos.index ? `Row ${pos.index} of ${total}` : 'This row is not'} in the needs-review queue (current sort and filter)` : 'Nothing needs review in the current filter'}>
        <span className="insp__nav-pos mono" tabIndex={0}>{pos.index || '–'} / {total}</span>
      </Tooltip>
      <IconButton size="sm" icon={ChevronRight} label="Next row that needs review" tooltip="Next needs-review row (J)" disabled={!total || only} onClick={() => nextNeeds(1)} />
    </div>
  );
}

function ReviewButtons({ id }: { id: string }) {
  const status = useStore((s) => s.project?.review?.[id]?.status);
  const setReview = useStore((s) => s.setReview);
  const verified = status === 'verified', flagged = status === 'flagged';
  return (
    <>
      <Button size="sm" variant={verified ? 'secondary' : 'primary'} icon={CircleCheck} kbd="v" className={cx('insp__verify', verified && 'is-verified')} pressed={verified}
        tooltip={verified ? 'Verified · click to clear the mark' : 'Mark as checked against the source (V)'} onClick={() => setReview([id], verified ? null : 'verified')}>{verified ? 'Verified' : 'Verify'}</Button>
      <Button size="sm" variant="secondary" icon={Flag} kbd="x" className={cx('insp__flag', flagged && 'is-flagged')} pressed={flagged}
        tooltip={flagged ? 'Flagged · click to clear' : 'Flag for follow-up (X)'} onClick={() => setReview([id], flagged ? null : 'flagged')}>Flag</Button>
    </>
  );
}

function ConfBadge({ c }: { c: number }) {
  const band = c >= 0.75 ? 'hi' : c >= 0.45 ? 'mid' : 'lo';
  return <span className="insp__conf" style={{ color: CONF_COLOR[band] }} title="Extraction confidence">{CONF_GLYPH[band]} {Math.round(c * 100)}% <span className="insp__conf-word">{BAND_WORD[band]}</span></span>;
}

function IssueChips({ issues }: { issues: IssueCode[] }) {
  const shown = issues.filter((i) => ISSUE_INFO[i].counts && i !== 'out_of_scope');
  if (!shown.length) return null;
  return (
    <>
      {shown.slice(0, 2).map((i) => <Chip key={i} tone="warn" icon={CircleAlert}>{ISSUE_INFO[i].label}</Chip>)}
      {shown.length > 2 && <Chip tone="warn" tooltip={shown.slice(2).map((i) => ISSUE_INFO[i].label).join('\n')}>+{shown.length - 2}</Chip>}
    </>
  );
}

/** Name shown as an 18/24 heading (two lines max); click to edit, Enter / blur commits, Esc reverts. */
function EditableName({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (editing) {
    const done = () => { setEditing(false); requestAnimationFrame(() => btn.current?.focus()); };
    return (
      <TextField className="insp__name-input" value={value} autoFocus aria-label={label}
        onCommit={(v) => { if (v.trim()) onCommit(v.trim()); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') done(); else if (e.key === 'Escape') { e.preventDefault(); done(); } }}
        onBlur={() => setEditing(false)} />
    );
  }
  return (
    <Tooltip content={`${value} · click to rename`} placement="bottom-start">
      <button ref={btn} type="button" className="insp__name" onClick={() => setEditing(true)}><h2>{value}</h2></button>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ facility
function FacilityInspector({ f }: { f: Facility }) {
  const s = useStore.getState;
  const update = useStore((st) => st.updateFacility);
  const focusMode = useStore((st) => st.focusMode);
  const overrides = useStore((st) => st.project?.factorOverrides ?? EMPTY_OV);
  const productive = useStore((st) => st.project?.assumptionOverrides?.productiveHoursPerFte ?? DEFAULT_ASSUMPTIONS.productiveHoursPerFte);
  const grounds = useStore((st) => st.project?.inventory.grounds);
  const { estById, rowMeta, gestById, est } = useDerived();
  const usage = useFactorUsage(est);
  const e = estById.get(f.id);
  const r = e?.resolved;
  const meta = rowMeta.get(f.id);
  const inScope = isInScope(f);
  const attached = useMemo(() => (grounds ?? []).filter((g) => g.facilityId === f.id), [grounds, f.id]);
  const siteWideGrounds = useMemo(() => (grounds ?? []).filter((g) => !g.facilityId).length, [grounds]);
  const d = f.dining;
  const setDining = (patch: Partial<DiningProfile>) => update(f.id, { dining: { mealsPerDay: 0, mealPeriods: 3, daysPerWeek: 7, ...(d ?? {}), ...patch } });
  const toggleScope = (x: ScopeItem) => update(f.id, { scope: f.scope.includes(x) ? f.scope.filter((y) => y !== x) : [...f.scope, x] });
  const remove = async () => {
    const ok = await s().confirm({ title: `Remove ${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}?`, body: `The facility leaves the inventory and the estimate${e ? ` (${n2(e.fte)} FTE)` : ''}.${attached.length ? ` ${attached.length} grounds area${attached.length > 1 ? 's' : ''} attached to it become${attached.length > 1 ? '' : 's'} site-wide.` : ''}`, confirmLabel: 'Remove facility', danger: true });
    if (ok) s().removeFacility(f.id);
  };
  const rowValues = useMemo(() => [f.grossSqft, f.cleanableSqft ?? 0, f.originalArea?.gross ?? 0, f.originalArea?.cleanable ?? 0, (f.restroomFixtures ?? 0) > 2 ? f.restroomFixtures! : 0, (f.occupancy ?? 0) > 2 ? f.occupancy! : 0], [f]);
  const dining = f.scope.includes('dining') || f.category === 'dining';
  const catLabel = CATEGORY_DEFAULTS[f.category]?.label ?? f.category;

  return (
    <div className="insp">
      <header className="insp__head">
        <div className="insp__row1">
          <span className="insp__no" style={{ ['--cat' as string]: categoryColor(f.category) }}>
            <TextField size="sm" value={f.buildingNumber ?? ''} placeholder="#" aria-label="Building number" onCommit={(v) => update(f.id, { buildingNumber: v.trim() || undefined })} />
          </span>
          <EditableName value={f.name} label="Facility name" onCommit={(v) => update(f.id, { name: v })} />
          <IconButton icon={X} size="sm" label="Clear selection" tooltip="Clear selection (Esc)" onClick={() => s().select({ kind: null })} />
        </div>
        <div className="insp__row2">
          <span className="insp__facts">{catLabel}{f.campus ? ` · ${f.campus}` : ''} · {f.floors} fl</span>
          <ConfBadge c={f.confidence} />
          {!inScope && <Chip tone="neutral">{FACILITY_STATUSES.find((x) => x.id === f.status)?.label}</Chip>}
          <IssueChips issues={meta?.issues ?? []} />
        </div>
        <div className="insp__row3">
          <ReviewButtons id={f.id} />
          <Button size="sm" variant="ghost" icon={LogIn} kbd="i" className={cx('insp__inside', !inScope && 'is-blocked')} aria-disabled={!inScope || undefined} pressed={focusMode === 'building'}
            tooltip={inScope ? (focusMode === 'building' ? 'Back to the site view (I)' : 'Cut-away view of this building (I)') : 'Out-of-scope buildings have no crews to show'}
            onClick={() => { if (inScope) s().setFocusMode(focusMode === 'building' ? 'site' : 'building'); }}>Inside</Button>
          <IconButton icon={Crosshair} size="sm" label="Locate" tooltip="Locate in the map (F)" onClick={() => s().requestCamera('frame-selection')} />
          <QueueNav id={f.id} />
        </div>
      </header>

      <div className="insp__body panel__scroll">
        <Section id="source" title="Source" extra={f.source?.page ? <span className="muted">p.{f.source.page}</span> : undefined}>
          <SourceBlock f={f} rowValues={rowValues} />
        </Section>

        <Section id="quantities" title="Quantities">
          <Fields>
            <Field label="Gross SF">{(id) => <NumField id={id} value={f.grossSqft} required rule={{ positive: true }} kind="area" decimals={0} suffix="SF"
              validate={(v) => (v != null && f.cleanableSqft != null && f.cleanableSqft > v ? 'Gross SF is below the cleanable SF' : null)}
              onCommit={(v, m) => { if (v != null) update(f.id, { grossSqft: v, ...(m?.unit ? { originalArea: { ...(f.originalArea ?? {}), gross: m.printed, unit: m.unit } } : {}) }); }} />}</Field>
            <Field label="Cleanable SF">{(id) => <NumField id={id} value={f.cleanableSqft} decimals={0} suffix="SF" placeholder={r ? `auto ${n0(r.cleanableSqft)}` : 'auto'}
              rule={{ min: 0 }} validate={(v) => (v != null && v > f.grossSqft ? 'Cleanable SF exceeds gross' : null)} onCommit={(v) => update(f.id, { cleanableSqft: v })} />}</Field>
            <Field label="Floors">{(id) => <NumField id={id} value={f.floors} required rule={{ min: 1, integer: true }} decimals={0} suffix="fl" onCommit={(v) => { if (v != null) update(f.id, { floors: v }); }} />}</Field>
            <Field label="Restroom fixtures">{(id) => <NumField id={id} value={f.restroomFixtures} decimals={0} placeholder={r ? `auto ${n0(r.restroomFixtures)}` : 'auto'} rule={{ min: 0, integer: true }} onCommit={(v) => update(f.id, { restroomFixtures: v })} />}</Field>
            <Field label="Occupancy">{(id) => <NumField id={id} value={f.occupancy} decimals={0} placeholder={r ? `auto ${n0(r.occupancy)}` : 'auto'} rule={{ min: 0, integer: true }} onCommit={(v) => update(f.id, { occupancy: v })} />}</Field>
            <Field label="Campus">{(id) => <TextField id={id} value={f.campus ?? ''} placeholder="—" onCommit={(v) => update(f.id, { campus: v.trim() || undefined })} />}</Field>
            <Field label="Category" span="full">{(id) => <Select id={id} value={f.category} onChange={(v) => update(f.id, { category: v })} options={FACILITY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_DEFAULTS[c].label }))} />}</Field>
            <Field label="Status" span="full" hint={inScope ? undefined : 'Shown in the inventory but not estimated.'}>{(id) => <Select id={id} value={f.status ?? 'in_scope'} onChange={(v) => update(f.id, { status: v === 'in_scope' ? undefined : v })} options={FACILITY_STATUSES.map((x) => ({ value: x.id, label: x.label }))} />}</Field>
            {!inScope && <Field label="Reason" span="full">{(id) => <TextField id={id} value={f.statusReason ?? ''} placeholder="e.g. Deleted by Amendment 0002" onCommit={(v) => update(f.id, { statusReason: v.trim() || undefined })} />}</Field>}
          </Fields>
        </Section>

        <Section id="service" title="Service">
          <Fields>
            <Field label="Service level" span="full" hint={f.serviceFrequencyText ? `As printed: ${f.serviceFrequencyText}` : undefined}>{(id) => <Select id={id} value={f.serviceLevel} onChange={(v) => update(f.id, { serviceLevel: v })} options={SERVICE_LEVELS.map((x) => ({ value: x.id, label: x.label }))} />}</Field>
          </Fields>
          <div className="insp__scope" role="group" aria-label="Scope">
            {SCOPES.map((x) => <Chip key={x.id} tone={f.scope.includes(x.id) ? 'accent' : 'neutral'} selected={f.scope.includes(x.id)} onClick={() => toggleScope(x.id)}>{x.label}</Chip>)}
          </div>
          {r && <FloorMixBar mix={r.floorMix} />}
          {r && <p className="muted insp__small">{r.serviceDaysPerYear} service days / yr</p>}
        </Section>

        {dining && <DiningSection f={f} setDining={setDining} />}

        {e && inScope && (
          <Section id="crews" title="Crews in this building" extra={<span className="muted mono">{n2(e.fte)} FTE</span>}>
            <CrewBars hoursByCrew={e.hoursByCrew} productive={productive} />
          </Section>
        )}

        {e && inScope && (
          <Section id="workload" title="Workload (RS Means lines)" extra={<span className="muted mono">{n0(e.totalHours)} h/yr</span>}>
            <Workload lines={e.lines} overrides={overrides} usage={usage} productive={productive} />
          </Section>
        )}

        <Section id="grounds" title="Grounds attached" extra={attached.length ? <span className="muted">{attached.length}</span> : undefined}>
          {attached.length === 0
            ? <p className="muted insp__empty">{siteWideGrounds ? `No grounds tied to this building; the package lists ${siteWideGrounds} area${siteWideGrounds > 1 ? 's' : ''} site-wide.` : 'No grounds tied to this building, and the package lists no grounds areas.'}</p>
            : (
              <ul className="insp__grounds">
                {attached.map((g) => {
                  const ge = gestById.get(g.id);
                  return <li key={g.id}><button type="button" onClick={() => s().select({ kind: 'grounds', id: g.id })} title={g.name}>{g.name}</button><span className="mono">{n1(ge?.acres ?? groundsAcres(g))} ac · {n2(ge?.fte ?? 0)} FTE</span></li>;
                })}
              </ul>
            )}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => s().addGrounds(f.id)}>Attach grounds area</Button>
        </Section>

        {(f.notes || f.statusReason) && (
          <Section id="notes" title="Notes">
            {f.statusReason && <p className="insp__small"><b>Status:</b> {f.statusReason}</p>}
            {f.notes && <p className="insp__small insp__notes">{f.notes}</p>}
          </Section>
        )}

        <div className="insp__danger"><Button size="sm" variant="danger-ghost" onClick={() => void remove()}>Remove facility…</Button></div>
      </div>
    </div>
  );
}
const EMPTY_OV: Record<string, number> = {};

function SourceBlock({ f, rowValues }: { f: Facility; rowValues: number[] }) {
  const update = useStore((st) => st.updateFacility);
  const ex = f.source?.excerpt;
  const check = sfInExcerpt(f);
  const unit = f.originalArea ? UNIT_LABEL[f.originalArea.unit] ?? f.originalArea.unit : 'SF';
  let line: ReactNode = null;
  if (ex && check != null) {
    if (check) {
      const grossHit = rowValues[0] > 0 && tokenHas(ex, f.grossSqft);
      const origHit = f.originalArea?.gross != null && tokenHas(ex, f.originalArea.gross);
      line = <p className="insp__check is-ok"><CircleCheck size={14} aria-hidden />{grossHit ? `Gross SF ${n0(f.grossSqft)} appears in the excerpt` : origHit ? `Gross ${n0(f.originalArea!.gross!)} ${unit} (as printed) appears in the excerpt` : `Cleanable SF ${n0(f.cleanableSqft ?? 0)} appears in the excerpt; gross is not printed`}</p>;
    } else {
      const shows = closestAreaNumber(ex, f.originalArea?.gross ?? f.grossSqft, f.buildingNumber);
      const useVal = shows != null && f.originalArea ? null : shows; // a converted row needs the unit, not the raw number
      line = (
        <div className="insp__check is-bad">
          <TriangleAlert size={14} aria-hidden />
          <span>Gross SF {n0(f.grossSqft)} not in excerpt{shows != null ? ` (excerpt shows ${n0(shows)})` : ''}</span>
          {useVal != null && useVal > 0 && <Button size="sm" variant="secondary" onClick={() => update(f.id, { grossSqft: Math.round(useVal) })}>Use {n0(useVal)}</Button>}
        </div>
      );
    }
  }
  return (
    <>
      {ex ? <Excerpt text={ex} rowValues={rowValues} bldgNo={f.buildingNumber} /> : <p className="muted insp__empty">No excerpt recorded for this row.</p>}
      {line}
      <dl className="insp__src">
        {f.source?.file && <><dt>Document</dt><dd title={f.source.file}>{f.source.file}{f.source.page ? ` · p.${f.source.page}` : ''}</dd></>}
        {f.tableId && <><dt>Table</dt><dd>{f.tableId}</dd></>}
        {f.originalArea && <><dt>As printed</dt><dd>{f.originalArea.gross != null ? `${n0(f.originalArea.gross)} ${unit}` : ''}{f.originalArea.cleanable != null ? `${f.originalArea.gross != null ? ' · ' : ''}${n0(f.originalArea.cleanable)} ${unit} cleanable` : ''} → {n0(f.grossSqft)} SF</dd></>}
        {f.serviceFrequencyText && <><dt>Frequency as printed</dt><dd>{f.serviceFrequencyText}</dd></>}
      </dl>
    </>
  );
}
function tokenHas(excerpt: string, v: number): boolean { return sfInExcerpt({ grossSqft: v, source: { excerpt } }) === true; }

function DiningSection({ f, setDining }: { f: Facility; setDining: (p: Partial<DiningProfile>) => void }) {
  const d = f.dining;
  const auto = d ? resolveMealsPerDay(d) : 0;
  const periods = d?.mealPeriodsDetail ?? [];
  const derived = periods.length ? diningMealsPerDay(periods, d?.daysPerWeek || 7) : null;
  return (
    <Section id="dining" title="Dining" extra={auto ? <span className="muted mono">{n0(auto)} meals/day</span> : undefined}>
      <Fields>
        <Field label="Meals / day" hint={derived && !(d && d.mealsPerDay > 0) ? `From the meal periods: (5 × weekday + 2 × weekend) ÷ 7${derived.assumedWeekend ? ', weekend assumed = weekday' : ''}` : undefined}>
          {(id) => <NumField id={id} value={d && d.mealsPerDay > 0 ? d.mealsPerDay : undefined} decimals={0} placeholder={auto ? `auto ${n0(auto)}` : '0'} rule={{ min: 0 }} onCommit={(v) => setDining({ mealsPerDay: v ?? 0 })} />}
        </Field>
        <Field label="Meal periods">{(id) => <NumField id={id} value={d?.mealPeriods ?? 3} decimals={0} rule={{ min: 1, max: 6, integer: true }} required onCommit={(v) => { if (v != null) setDining({ mealPeriods: v }); }} />}</Field>
        <Field label="Days / week">{(id) => <NumField id={id} value={d?.daysPerWeek ?? 7} decimals={0} rule={{ min: 1, max: 7, integer: true }} required onCommit={(v) => { if (v != null) setDining({ daysPerWeek: v }); }} />}</Field>
        <Field label="Seats">{(id) => <NumField id={id} value={d?.seats} decimals={0} placeholder="—" rule={{ min: 0, integer: true }} onCommit={(v) => setDining({ seats: v })} />}</Field>
        <Field label="Kitchen SF">{(id) => <NumField id={id} value={d?.kitchenSqft} decimals={0} placeholder="—" suffix="SF" rule={{ min: 0 }} onCommit={(v) => setDining({ kitchenSqft: v })} />}</Field>
        <Field label="Service style">{(id) => <Select id={id} value={d?.serviceStyle ?? 'full_food_service'} onChange={(v) => setDining({ serviceStyle: v })} options={SERVICE_STYLES} />}</Field>
      </Fields>
      {periods.length > 0 && (
        <table className="insp__meals">
          <caption>Meal periods as printed</caption>
          <thead><tr><th scope="col">Period</th><th scope="col" className="r">Weekday</th><th scope="col" className="r">Weekend</th></tr></thead>
          <tbody>
            {periods.map((p, i) => <tr key={`${p.period}-${i}`}><td>{p.period}</td><td className="r mono">{p.weekdayHeadcount != null ? n0(p.weekdayHeadcount) : '—'}</td><td className="r mono">{p.weekendHeadcount != null ? n0(p.weekendHeadcount) : '—'}</td></tr>)}
            <tr className="total"><td>Total</td><td className="r mono">{n0(periods.reduce((s, p) => s + (p.weekdayHeadcount ?? 0), 0))}</td><td className="r mono">{periods.some((p) => p.weekendHeadcount != null) ? n0(periods.reduce((s, p) => s + (p.weekendHeadcount ?? 0), 0)) : '—'}</td></tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ grounds
function GroundsInspector({ g }: { g: GroundsArea }) {
  const s = useStore.getState;
  const update = useStore((st) => st.updateGrounds);
  const facilities = useStore((st) => st.project?.inventory.facilities);
  const overrides = useStore((st) => st.project?.factorOverrides ?? EMPTY_OV);
  const productive = useStore((st) => st.project?.assumptionOverrides?.productiveHoursPerFte ?? DEFAULT_ASSUMPTIONS.productiveHoursPerFte);
  const { gestById, rowMeta, est, facById } = useDerived();
  const usage = useFactorUsage(est);
  const e = gestById.get(g.id);
  const meta = rowMeta.get(g.id);
  const kind = GROUNDS_KINDS.find((k) => k.id === g.kind);
  const parent = g.facilityId ? facById.get(g.facilityId) : undefined;
  const remove = async () => { if (await s().confirm({ title: `Remove ${g.name}?`, body: `The area leaves the inventory and the estimate${e ? ` (${n2(e.fte)} FTE)` : ''}.`, confirmLabel: 'Remove area', danger: true })) s().removeGrounds(g.id); };
  const facOptions = useMemo(() => [{ value: '', label: 'Site-wide' }, ...(facilities ?? []).map((f) => ({ value: f.id, label: `${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}` }))], [facilities]);
  return (
    <div className="insp">
      <header className="insp__head">
        <div className="insp__row1">
          <span className="insp__swatch" aria-hidden style={{ background: 'var(--ok)' }} />
          <EditableName value={g.name} label="Grounds area name" onCommit={(v) => update(g.id, { name: v })} />
          <IconButton icon={X} size="sm" label="Clear selection" tooltip="Clear selection (Esc)" onClick={() => s().select({ kind: null })} />
        </div>
        <div className="insp__row2">
          <span className="insp__facts">{kind?.label ?? g.kind}{g.documentLabel ? ` · ${g.documentLabel}` : ''}{g.campus ? ` · ${g.campus}` : ''}{parent ? ` · at ${parent.buildingNumber ?? parent.name}` : ''}</span>
          <ConfBadge c={g.confidence} />
          <IssueChips issues={meta?.issues ?? []} />
        </div>
        <div className="insp__row3">
          <ReviewButtons id={g.id} />
          <IconButton icon={Crosshair} size="sm" label="Locate" tooltip="Locate in the map (F)" onClick={() => s().requestCamera('frame-selection')} />
          <QueueNav id={g.id} />
        </div>
      </header>
      <div className="insp__body panel__scroll">
        <Section id="g-quantities" title="Quantities" extra={e ? <span className="muted mono">{n1(e.acres)} ac</span> : undefined}>
          <Fields>
            <Field label="Kind" span="full">{(id) => <Select id={id} value={g.kind} onChange={(v) => { const k = GROUNDS_KINDS.find((x) => x.id === v)!; update(g.id, { kind: k.id, unit: k.defaultUnit }); }} options={GROUNDS_KINDS.map((k) => ({ value: k.id, label: k.label }))} />}</Field>
            <Field label="Quantity">{(id) => <NumField id={id} value={g.quantity} required rule={{ min: 0 }} decimals={2} onCommit={(v) => { if (v != null) update(g.id, { quantity: v }); }} />}</Field>
            <Field label="Unit">{(id) => <Select<GroundsUnit> id={id} value={g.unit} onChange={(v) => update(g.id, { unit: v })} options={GROUNDS_UNITS} />}</Field>
            <Field label="Attached to" span="full">{(id) => <Select id={id} value={g.facilityId ?? ''} onChange={(v) => update(g.id, { facilityId: v || undefined })} options={facOptions} />}</Field>
            <Field label="Campus">{(id) => <TextField id={id} value={g.campus ?? ''} placeholder="—" onCommit={(v) => update(g.id, { campus: v.trim() || undefined })} />}</Field>
            <Field label="Label as printed">{(id) => <TextField id={id} value={g.documentLabel ?? ''} placeholder="—" onCommit={(v) => update(g.id, { documentLabel: v.trim() || undefined })} />}</Field>
          </Fields>
        </Section>
        <Section id="g-source" title="Source">
          {g.source?.excerpt ? <Excerpt text={g.source.excerpt} rowValues={[g.quantity]} /> : <p className="muted insp__empty">No excerpt recorded for this row.</p>}
          {g.source?.file && <dl className="insp__src"><dt>Document</dt><dd title={g.source.file}>{g.source.file}{g.source.page ? ` · p.${g.source.page}` : ''}</dd></dl>}
        </Section>
        {e && (
          <Section id="g-crews" title="Crews" extra={<span className="muted mono">{n2(e.fte)} FTE</span>}>
            <CrewBars hoursByCrew={e.hoursByCrew} productive={productive} />
          </Section>
        )}
        {e && (
          <Section id="g-workload" title="Workload (RS Means lines)" extra={<span className="muted mono">{n0(e.totalHours)} h/yr</span>}>
            <Workload lines={e.lines} overrides={overrides} usage={usage} productive={productive} />
          </Section>
        )}
        {g.notes && <Section id="g-notes" title="Notes"><p className="insp__small insp__notes">{g.notes}</p></Section>}
        <div className="insp__danger"><Button size="sm" variant="danger-ghost" onClick={() => void remove()}>Remove grounds area…</Button></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ no selection: project summary
function ReviewRing({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.min(1, value / max) : 0;
  const r = 24, c = 2 * Math.PI * r;
  return (
    <svg className="insp__ring" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${value} of ${max} verified`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--ok)" strokeWidth="6" strokeDasharray={`${c * p} ${c}`} strokeLinecap={p > 0 ? 'round' : 'butt'} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle" className="insp__ring-t">{Math.round(p * 100)}%</text>
    </svg>
  );
}

function deltaTone(d: number) { const a = Math.abs(d); return a <= 0.1 ? 'ok' : a <= 0.25 ? 'warn' : 'bad'; }

function ProjectSummary() {
  const { counts, est, rowMeta, estById, gestById } = useDerived();
  const live = useTopDownLive();
  const project = useStore((s) => s.project);
  const warnings = useStore((s) => s.extraction.warnings);
  const openEstimate = useStore((s) => s.openEstimate);
  const openLog = useStore((s) => s.openLog);
  if (!project) return null;
  const site = project.inventory.site;
  const empty = counts.total === 0;
  const docWarnings = project.documents.flatMap((d) => (d.warnings ?? []).map((w) => ({ message: w, file: d.name })));
  const allWarnings = warnings.length ? warnings : docWarnings;
  const crews = est ? [...est.crews].sort((a, b) => CREW_ORDER.indexOf(a.crew) - CREW_ORDER.indexOf(b.crew)).filter((c) => c.fte > 0) : [];
  const totalFte = crews.reduce((s, c) => s + c.fte, 0) || 1;
  const start = () => { if (!nextNeeds(1, { quiet: true })) goToRow(firstNeedsByImpact(project.inventory, rowMeta, estById, gestById)); };
  if (empty) {
    return (
      <div className="insp__body panel__scroll insp__summary">
        <p className="muted insp__hint">The inspector shows the selected building or grounds area. Read a solicitation package in the Documents tab to start.</p>
      </div>
    );
  }
  return (
    <div className="insp__body panel__scroll insp__summary">
      <section className="insp__card">
        <h3>Review</h3>
        <div className="insp__review">
          <ReviewRing value={counts.verified} max={counts.total} />
          <div className="insp__review-txt">
            <b>{counts.verified.toLocaleString()} / {counts.total.toLocaleString()} verified</b>
            <span className="muted">{counts.needs.toLocaleString()} need review · {counts.flagged.toLocaleString()} flagged{counts.edited ? ` · ${counts.edited} edited` : ''}{counts.outOfScope ? ` · ${counts.outOfScope} out of scope` : ''}</span>
          </div>
        </div>
        <Button size="sm" variant={counts.needs ? 'primary' : 'secondary'} kbd="j" disabled={!counts.needs} onClick={start}>Start review</Button>
      </section>

      {est && (
        <section className="insp__card">
          <h3>Estimate</h3>
          <div className="insp__est">
            <div><span className="v mono">{n1(live.bottomUpFte)}</span><span className="l">Bottom-up FTE</span></div>
            <div><span className="v mono implied">{live.deltaPct != null ? n1(live.impliedBase) : '—'}</span><span className="l">Implied FTE</span></div>
            {live.deltaPct != null && <span className={`delta-chip delta-chip--${deltaTone(live.deltaPct)}`}>{signedPct(live.deltaPct)}</span>}
          </div>
          {crews.length > 0 && (
            <>
              <div className="insp__stack" role="img" aria-label={`FTE by crew: ${crews.map((c) => `${crewMeta(c.crew).short} ${n1(c.fte)}`).join(', ')}`}>
                {crews.map((c) => <span key={c.crew} style={{ width: `${(c.fte / totalFte) * 100}%`, background: crewColor(c.crew) }} title={`${crewMeta(c.crew).short} ${n1(c.fte)} FTE`} />)}
              </div>
              <div className="insp__stack-legend">{crews.map((c) => <span key={c.crew}><i style={{ background: crewColor(c.crew) }} aria-hidden />{crewMeta(c.crew).short} {n1(c.fte)}</span>)}</div>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => openEstimate('bottomline')}>Open Estimate →</Button>
        </section>
      )}

      {allWarnings.length > 0 && (
        <section className="insp__card">
          <h3>{warnings.length ? 'Last-run warnings' : 'Document warnings'} <span className="muted">{allWarnings.length}</span></h3>
          <ul className="insp__warns">
            {allWarnings.slice(0, 3).map((w, i) => <li key={i}><TriangleAlert size={13} aria-hidden /><span>{w.file ? <b>{w.file}: </b> : null}{w.message}</span></li>)}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => openLog('warnings')}>{allWarnings.length > 3 ? `All ${allWarnings.length} in Log →` : 'Open Log →'}</Button>
        </section>
      )}

      <section className="insp__card">
        <h3>Site</h3>
        <dl className="insp__src">
          {site.installationName && <><dt>Installation</dt><dd>{site.installationName}</dd></>}
          {site.location && <><dt>Location</dt><dd>{site.location}</dd></>}
          {site.solicitation && <><dt>Solicitation</dt><dd>{site.solicitation}</dd></>}
          {site.contractName && <><dt>Contract</dt><dd>{site.contractName}</dd></>}
          <dt>Inventory</dt><dd>{project.inventory.facilities.length.toLocaleString()} buildings · {project.inventory.grounds.length.toLocaleString()} grounds areas</dd>
          {est && <><dt>Area</dt><dd>{n0(est.metrics.grossSqft)} SF gross · {n1(est.metrics.acres)} ac</dd></>}
          <dt>Documents</dt><dd>{project.documents.length}</dd>
        </dl>
      </section>
      <p className="muted insp__hint">Select a building or grounds area in the list or the map to inspect it.</p>
    </div>
  );
}
