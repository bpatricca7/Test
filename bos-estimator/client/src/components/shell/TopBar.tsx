import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Calculator, ChevronDown, CircleAlert, Copy, Download, Ellipsis, FileJson, FileSpreadsheet, Keyboard, LayoutGrid, LoaderCircle, Map as MapIcon, Server, Table2 } from 'lucide-react';
import { useStore, type UiZoom } from '../../store';
import { useDerived, useTopDownLive } from '../../derived';
import { api } from '../../api';
import { compact, n0, n1, nonNeg, signedPct } from '../../fmt';
import { Button, IconButton, MenuButton, Num, Popover, Segmented, TextField, Tooltip, usePopover, type MenuItem } from '../ui';
import { cx } from '../lib/cx';
import { deltaTone } from '../lib/theme';
import { currentOrder } from '../lib/query';
import { confirmResetProject } from '../dialogs/confirms';
import { copyRowsTsv, exportBackup, exportEstimateCsv, exportInventoryCsv } from './exports';

/** Top bar (UI spec §5.1): name, view switch, save state, AI chip | priority metric strip (+N) | hero FTE + Δ | actions. */
export const TopBar = memo(function TopBar() {
  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="tb-logo" aria-hidden>BOS</div>
        <ProjectName />
        <ViewSwitch />
        <SaveState />
        <AiChip />
      </div>
      <MetricStrip />
      <Hero />
      <Actions />
    </header>
  );
});

function ProjectName() {
  const name = useStore((s) => s.project?.name ?? '');
  const setName = useStore((s) => s.setProjectName);
  const [editing, setEditing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (editing) {
    return (
      <TextField className="tb-name-input" value={name} autoFocus aria-label="Project name"
        onCommit={(v) => { if (v.trim()) setName(v.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); setEditing(false); requestAnimationFrame(() => btn.current?.focus()); } }}
        onBlur={() => setEditing(false)} />
    );
  }
  return (
    <Tooltip content={name ? `${name} · click to rename` : 'Name this project'} placement="bottom">
      <button ref={btn} type="button" className="tb-name" onClick={() => setEditing(true)}>{name || 'Untitled'}</button>
    </Tooltip>
  );
}

function ViewSwitch() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <Segmented className="tb-view" label="Center view" value={view} onChange={setView}
      options={[
        { value: 'map', label: 'Map', icon: MapIcon, tooltip: 'Map view (1)' },
        { value: 'table', label: 'Table', icon: Table2, tooltip: 'Inventory table (2)' },
      ]} />
  );
}

function SaveState() {
  const saving = useStore((s) => s.saving);
  const saveError = useStore((s) => s.saveError);
  const retry = useStore((s) => s.retrySave);
  if (saveError) {
    return (
      <Tooltip content={saveError} placement="bottom">
        <span className="tb-save tb-save--failed" role="status"><CircleAlert size={14} aria-hidden />Not saved · <button type="button" onClick={() => void retry()}>Retry</button></span>
      </Tooltip>
    );
  }
  if (saving) return <span className="tb-save" role="status"><LoaderCircle size={14} className="spin" aria-hidden />Saving…</span>;
  return <span className="tb-save" role="status">Saved</span>;
}

function AiChip() {
  const health = useStore((s) => s.health);
  const pop = usePopover<HTMLButtonElement>();
  const ok = Boolean(health?.aiAvailable);
  const label = health == null ? 'Checking reader…' : ok ? 'Claude ready' : 'Rule-based · no API key';
  return (
    <>
      <Tooltip content={label} placement="bottom">
        <button ref={pop.anchorRef} type="button" className={cx('tb-ai', !ok && 'tb-ai--warn')} aria-label={label} aria-expanded={pop.open} onClick={pop.toggle}>
          <span className="tb-ai__dot" aria-hidden /><span className="tb-ai__label">{label}</span>
        </button>
      </Tooltip>
      <Popover {...pop.props} placement="bottom-start" label="Reader status" className="tb-ai-pop">
        {ok
          ? <p style={{ margin: 0 }}><b>Claude reads the package.</b> The server has an <code>ANTHROPIC_API_KEY</code>, so documents go to Claude (model and effort are in the Documents tab). The rule-based parser remains available as a fallback.</p>
          : <p style={{ margin: 0 }}><b>No API key on the server.</b> The rule-based parser reads well-structured facility lists and workload tables. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart the server to let Claude read scanned exhibits, drawings and free-form PWS text.</p>}
      </Popover>
    </>
  );
}

export interface Metric { id: string; value: number | null; fmt: (v: number) => string; label: string; title: string }

/** The project metrics in priority order (the top bar's strip on desktop and tablet, the sheet's grid on phones). */
export function useMetrics(): Metric[] {
  const { est, counts, facById, groundsById } = useDerived();
  const empty = !est || counts.total === 0;
  const m = est?.metrics;
  const reviewedPct = counts.total ? Math.round((counts.verified / counts.total) * 100) : 0;
  const reviewed = `${reviewedPct}% reviewed${counts.outOfScope ? ` (+${counts.outOfScope} excl.)` : ''}`;
  // a grounds-only package (mowing, parks): Acres leads and the building metrics, all zero, drop out
  const groundsOnly = !empty && facById.size === 0 && groundsById.size > 0;
  const all: Metric[] = [
    { id: 'fac', value: empty ? null : nonNeg(m?.facilitiesCount ?? 0), fmt: (v) => `${n0(v)} fac`, label: empty ? 'Facilities' : reviewed, title: 'Facilities in scope' },
    { id: 'gsf', value: empty ? null : nonNeg(m?.grossSqft ?? 0), fmt: compact, label: 'Gross SF', title: 'Gross SF' },
    { id: 'csf', value: empty ? null : nonNeg(m?.cleanableSqft ?? 0), fmt: compact, label: 'Cleanable SF', title: 'Cleanable SF' },
    { id: 'ac', value: empty ? null : nonNeg(m?.acres ?? 0), fmt: (v) => (v >= 1000 ? compact(v) : n1(v)), label: groundsOnly ? `Acres · ${reviewed}` : 'Acres', title: 'Acres' },
    { id: 'meals', value: empty ? null : nonNeg(m?.mealsPerYear ?? 0), fmt: compact, label: 'Meals/yr', title: 'Meals per year' },
    { id: 'hrs', value: empty ? null : nonNeg(est?.directHours ?? 0), fmt: compact, label: 'Direct hrs', title: 'Direct labor hours per year' },
  ];
  return groundsOnly ? ['ac', 'hrs', 'meals'].map((id) => all.find((x) => x.id === id)!).filter((x) => x.id !== 'meals' || (x.value ?? 0) > 0) : all;
}

/** Priority metric strip: a ResizeObserver hides metrics from the lowest priority up; hidden ones go in a +N popover. */
function MetricStrip() {
  const metrics = useMetrics();
  const strip = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(metrics.length);
  const pop = usePopover<HTMLButtonElement>();
  const sig = metrics.map((x) => (x.value == null ? '—' : x.fmt(x.value)) + x.label).join('|');

  useLayoutEffect(() => {
    const el = strip.current, ms = measure.current; if (!el || !ms) return;
    const fit = () => {
      const widths = [...ms.children].map((c) => (c as HTMLElement).offsetWidth);
      const avail = el.clientWidth;
      const gap = 20, more = 44;
      let n = widths.length;
      const total = (k: number) => widths.slice(0, k).reduce((a, b) => a + b, 0) + gap * Math.max(0, k - 1) + (k < widths.length ? gap + more : 0);
      while (n > 0 && total(n) > avail) n--;
      setVisible(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);

  const hidden = metrics.slice(visible);
  const cell = (x: Metric, live: boolean) => (
    <div key={x.id} className="tb-metric" title={live ? x.title : undefined}>
      <span className="tb-metric__v">{x.value == null ? '—' : live ? <Num value={x.value} format={x.fmt} /> : x.fmt(x.value)}</span>
      <span className="tb-metric__l">{x.label}</span>
    </div>
  );
  return (
    <div ref={strip} className="tb-metrics" aria-label="Project metrics">
      <div ref={measure} className="tb-measure" aria-hidden>{metrics.map((x) => cell(x, false))}</div>
      {metrics.slice(0, visible).map((x) => cell(x, true))}
      {hidden.length > 0 && (
        <>
          <button ref={pop.anchorRef} type="button" className="tb-more" aria-label={`${hidden.length} more metrics`} aria-expanded={pop.open} onClick={pop.toggle}>+{hidden.length}</button>
          <Popover {...pop.props} placement="bottom-end" label="More metrics" className="tb-more-pop">
            {hidden.map((x) => <div key={x.id} className="row"><span>{x.title}</span><span>{x.value == null ? '—' : x.fmt(x.value)}</span></div>)}
          </Popover>
        </>
      )}
    </div>
  );
}


/** Hero FTE from useTopDownLive() only; click opens Estimate › Cross-check. */
function Hero() {
  const td = useTopDownLive();
  const { counts } = useDerived();
  const openEstimate = useStore((s) => s.openEstimate);
  const empty = counts.total === 0 || !td.td;
  return (
    <button type="button" className="tb-hero" onClick={() => openEstimate('crosscheck')} aria-label={empty ? 'Manning estimate (no data yet)' : `${n1(td.bottomUpFte)} FTE bottom-up. Open the Estimate cross-check`}>
      <span className="tb-hero__row">
        <span><span className="tb-hero__v">{empty ? '—' : <Num value={nonNeg(td.bottomUpFte)} format={n1} />}</span><span className="tb-hero__u">FTE</span></span>
        {!empty && td.deltaPct != null && <span className={`delta-chip delta-chip--${deltaTone(td.deltaPct)}`} title="Bottom-up vs implied from the previous award">{signedPct(td.deltaPct)}</span>}
      </span>
      <span className="tb-hero__sub">{empty ? 'Manning' : `${n0(td.heads)} heads${td.deltaPct != null ? ` · ${n1(td.impliedBase)} implied` : ''}`}</span>
    </button>
  );
}

export const ZOOM_OPTIONS: { value: UiZoom; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 0.9, label: '90%' }, { value: 1, label: '100%' }, { value: 1.125, label: '112.5%' }, { value: 1.25, label: '125%' },
];

/** UI zoom + reduced-motion items shared by the ⋯ menu and the rail's Settings menu. */
export function displayMenuItems(): MenuItem[] {
  const s = useStore.getState();
  return [
    { kind: 'header', label: 'UI zoom' },
    ...ZOOM_OPTIONS.map((z): MenuItem => ({ id: `zoom-${z.value}`, label: z.label, checked: s.uiZoom === z.value, onSelect: () => s.setUiZoom(z.value) })),
    { kind: 'separator' },
    { id: 'reduced', label: 'Reduced motion', hint: s.reducedMotionPref == null ? 'Following the system setting' : undefined, checked: s.reducedMotion, onSelect: () => s.setReducedMotionPref(!s.reducedMotion) },
  ];
}

function Actions() {
  const setFactorsOpen = useStore((s) => s.setFactorsOpen);
  const projectId = useStore((s) => s.projectId);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const { counts, est, rowMeta } = useDerived();
  const download = (href: string) => { const a = document.createElement('a'); a.href = href; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const unreviewed = counts.total - counts.verified;
  const empty = counts.total === 0;
  return (
    <div className="tb-actions">
      <Button className="btn--collapse" variant="ghost" icon={Calculator} tooltip="RS Means factors (Shift+M)" aria-label="Factors" onClick={() => setFactorsOpen(true)}>Factors</Button>
      <MenuButton label="Export" placement="bottom-end"
        items={() => [
          ...(unreviewed > 0 ? [{ kind: 'header', label: `${unreviewed.toLocaleString()} rows not reviewed` } as MenuItem] : []),
          { id: 'inv', label: 'Inventory with review (CSV)', icon: FileSpreadsheet, hint: 'Every row: fields, review, issues, edits, source, Hrs, FTE', disabled: empty, onSelect: () => exportInventoryCsv(est, rowMeta, counts.needs) },
          { id: 'est', label: 'Estimate detail (CSV)', icon: FileSpreadsheet, hint: 'Task lines, crews with your wages, manning by year', disabled: !est || empty, onSelect: () => exportEstimateCsv(est) },
          { id: 'tsv', label: 'Copy visible rows (TSV)', icon: Copy, hint: 'The inventory rows in the current filter and sort', disabled: empty, onSelect: () => copyRowsTsv(currentOrder(), est, rowMeta) },
          { id: 'json', label: 'Project backup (.json)', icon: FileJson, onSelect: exportBackup },
          { kind: 'separator' },
          { id: 'csv', label: 'Estimate CSV (server)', icon: Server, hint: 'Uses the default wages', disabled: empty, onSelect: () => download(api.exportCsvUrl(projectId)) },
        ]}
        trigger={(t) => <Button ref={t.ref} className="btn--collapse" variant="ghost" icon={Download} iconEnd={ChevronDown} tooltip="Export" aria-label="Export" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>Export</Button>} />
      <MenuButton label="More" placement="bottom-end"
        items={() => [
          { id: 'reset', label: 'Reset project…', danger: true, onSelect: () => void confirmResetProject() },
          { kind: 'separator' },
          ...displayMenuItems(),
          { kind: 'separator' },
          { id: 'keys', label: 'Keyboard shortcuts', kbd: '?', onSelect: () => setShortcutsOpen(true) },
        ]}
        trigger={(t) => <IconButton ref={t.ref} icon={Ellipsis} label="More" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle} />} />
    </div>
  );
}

// ------------------------------------------------------------------ phone (< 768 px or a short landscape window)

/**
 * Phone top bar: logo, project name, the hero FTE (tap: Estimate › Cross-check) and one ⋯ menu that holds what the
 * desktop bar shows inline: reader status, save state, Factors, Export, the view options and the display settings.
 * The metric strip moves into the sheet (MetricGrid on the List and Estimate tabs); nothing is dropped.
 */
export const PhoneTopBar = memo(function PhoneTopBar() {
  return (
    <header className="topbar m-top">
      <div className="tb-logo" aria-hidden>BOS</div>
      <ProjectName />
      <PhoneSaveState />
      <Hero />
      <PhoneMore />
    </header>
  );
});

/** Saving shows a spinner, a failed save a tappable "Not saved" (Retry); a clean save shows nothing (it is in ⋯). */
function PhoneSaveState() {
  const saving = useStore((s) => s.saving);
  const saveError = useStore((s) => s.saveError);
  const retry = useStore((s) => s.retrySave);
  if (saveError) return <button type="button" className="m-top__save is-failed" onClick={() => void retry()} aria-label={`Not saved: ${saveError}. Retry`}><CircleAlert size={14} aria-hidden />Retry</button>;
  if (saving) return <span className="m-top__save" role="status" aria-label="Saving"><LoaderCircle size={14} className="spin" aria-hidden /></span>;
  return null;
}

/** All project metrics, the hero's heads and implied FTE included, as a compact grid (phone sheet). */
export const MetricGrid = memo(function MetricGrid({ className }: { className?: string }) {
  const metrics = useMetrics();
  const td = useTopDownLive();
  const { counts } = useDerived();
  const empty = counts.total === 0 || !td.td;
  const cells: { id: string; v: string; l: string; title: string }[] = metrics.map((x) => ({ id: x.id, v: x.value == null ? '—' : x.fmt(x.value), l: x.label, title: x.title }));
  cells.push({ id: 'heads', v: empty ? '—' : n0(td.heads), l: 'Heads', title: 'Heads (bottom-up manning)' });
  if (!empty && td.deltaPct != null) cells.push({ id: 'implied', v: n1(td.impliedBase), l: 'Implied FTE', title: 'Implied from the previous award' });
  return (
    <dl className={cx('m-metrics', className)} aria-label="Project metrics">
      {cells.map((c) => <div key={c.id} className="m-metric" title={c.title}><dt>{c.l}</dt><dd>{c.v}</dd></div>)}
    </dl>
  );
});

const COLOR_BY_ITEMS = [['category', 'Category'], ['confidence', 'Confidence'], ['review', 'Review'], ['fte', 'FTE']] as const;
const LABEL_ITEMS = [['auto', 'Auto'], ['numbers', 'Numbers'], ['off', 'Off']] as const;

function PhoneMore() {
  const { counts, est, rowMeta } = useDerived();
  const projectId = useStore((s) => s.projectId);
  const download = (href: string) => { const a = document.createElement('a'); a.href = href; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const items = (): MenuItem[] => {
    const s = useStore.getState();
    const unreviewed = counts.total - counts.verified;
    const empty = counts.total === 0;
    const ok = Boolean(s.health?.aiAvailable);
    const reader = s.health == null ? 'Checking reader…' : ok ? 'Claude reads the package' : 'Rule-based reader · no API key';
    const save = s.saveError ? `Not saved: ${s.saveError}` : s.saving ? 'Saving…' : 'All changes saved';
    return [
      { kind: 'custom', node: (
        <div className="m-more__status">
          <span className={cx('tb-ai__dot', !ok && 'is-warn')} aria-hidden /><span>{reader}</span>
          <span className={cx('m-more__save', s.saveError && 'is-failed')}>{save}</span>
        </div>
      ) },
      { id: 'reader', label: 'Reader settings', icon: Server, hint: ok ? 'Model and effort, in Documents' : 'Add ANTHROPIC_API_KEY on the server for Claude', onSelect: () => s.openLeft('documents') },
      { id: 'factors', label: 'RS Means factors', icon: Calculator, onSelect: () => s.setFactorsOpen(true) },
      ...(s.saveError ? [{ id: 'retry', label: 'Retry saving', onSelect: () => void s.retrySave() } as MenuItem] : []),
      { kind: 'separator' },
      { kind: 'header', label: unreviewed > 0 && !empty ? `Export · ${unreviewed.toLocaleString()} rows not reviewed` : 'Export' },
      { id: 'inv', label: 'Inventory with review (CSV)', icon: FileSpreadsheet, disabled: empty, onSelect: () => exportInventoryCsv(est, rowMeta, counts.needs) },
      { id: 'est', label: 'Estimate detail (CSV)', icon: FileSpreadsheet, disabled: !est || empty, onSelect: () => exportEstimateCsv(est) },
      { id: 'tsv', label: 'Copy visible rows (TSV)', icon: Copy, disabled: empty, onSelect: () => copyRowsTsv(currentOrder(), est, rowMeta) },
      { id: 'json', label: 'Project backup (.json)', icon: FileJson, onSelect: exportBackup },
      { id: 'csv', label: 'Estimate CSV (server)', icon: Download, hint: 'Uses the default wages', disabled: empty, onSelect: () => download(api.exportCsvUrl(projectId)) },
      { kind: 'separator' },
      { kind: 'header', label: 'Color buildings by' },
      ...COLOR_BY_ITEMS.map(([id, label]): MenuItem => ({ id: `c-${id}`, label, checked: s.colorBy === id, onSelect: () => s.setColorBy(id) })),
      { kind: 'header', label: 'Labels' },
      ...LABEL_ITEMS.map(([id, label]): MenuItem => ({ id: `l-${id}`, label, checked: s.labelMode === id, onSelect: () => s.setLabelMode(id) })),
      { kind: 'header', label: 'View' },
      { id: 'live', label: 'Live lighting', hint: 'Follows the crew clock (day and night)', checked: s.lighting === 'live', onSelect: () => s.setLighting(s.lighting === 'live' ? 'review' : 'live') },
      { id: 'plan', label: 'Plan view', hint: 'Top-down, north up', checked: s.planView, disabled: s.focusMode === 'building', onSelect: () => s.setPlanView(!s.planView) },
      { id: 'fast', label: 'Fast rendering', hint: 'For large sites and older phones', checked: s.quality === 'fast', onSelect: () => s.setQuality(s.quality === 'fast' ? 'high' : 'fast') },
      { id: 'orbit', label: 'Orbit when idle', checked: s.autoOrbit, onSelect: () => s.setAutoOrbit(!s.autoOrbit) },
      { id: 'reduced', label: 'Reduced motion', hint: s.reducedMotionPref == null ? 'Following the system setting' : undefined, checked: s.reducedMotion, onSelect: () => s.setReducedMotionPref(!s.reducedMotion) },
      { id: 'relayout', label: 'Re-layout site', icon: LayoutGrid, onSelect: () => s.relayout() },
      { kind: 'separator' },
      { id: 'keys', label: 'Keyboard shortcuts', icon: Keyboard, onSelect: () => s.setShortcutsOpen(true) },
      { id: 'reset', label: 'Reset project…', danger: true, onSelect: () => void confirmResetProject() },
    ];
  };
  return (
    <MenuButton label="Project menu" placement="bottom-end" className="m-more" items={items}
      trigger={(t) => <IconButton ref={t.ref} className="m-top__more" icon={Ellipsis} label="Project menu: factors, export, view, reader" tooltip={false} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle} />} />
  );
}
