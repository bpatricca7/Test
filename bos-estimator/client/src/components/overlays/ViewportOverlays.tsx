// Viewport overlays (UI spec §5.10, §8): inside .vp-area, 12 px margin, --overlay-bg, radius 8, --sh-overlay, and
// every element carries data-occluder so THREE keeps labels, pins and auto-fit framing out of their rects.
//   top-left   SiteToolbar: [Site | Inside building] or the "← Site / 5995 …" breadcrumb with [Interior | Grounds]
//   top-right  ViewToolbar: colour-by, labels, lighting, legend, fit, table, ⋯ (quality, orbit, re-layout, motion)
//   top-centre RelayoutChip and OffShiftCallout (P1)
//   bottom     LegendChip (left) and HintChip (centre; raised a row when the legend would collide)
//   centre     EmptyCard (§8)
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ArrowLeft, Clock3, CloudUpload, Ellipsis, FileArchive, FileSpreadsheet, FileText, FileType, Focus, Layers, LayoutGrid, Moon, Palette, Sun, Table2, Tag, TriangleAlert, X } from 'lucide-react';
import { useStore, type ColorBy, type LabelMode } from '../../store';
import { useDerived } from '../../derived';
import { crewMeta } from '@shared/factors';
import { isInScope } from '@shared/types';
import { legendFor } from '../lib/theme';
import { ZONE_COLORS, ZONE_LABELS } from '../../three/layout';
import type { FacilityCategory, GroundsKind } from '@shared/types';
import { useHotkey } from '../lib/keys';
import { cx } from '../lib/cx';
import { ACCEPT_LABELS } from '../lib/files';
import { Button, IconButton, MenuButton, Popover, Segmented, Tooltip, usePopover, zoomFactor, type MenuItem } from '../ui';
import { chooseFiles } from '../shell/fileChooser';
import { analyzeNow, readerLine, usesRuleBased } from '../documents/reader';
import { hhmm, onShift } from '../bottom/crewIcons';
import { clock } from '../../three/clock';
import '../../styles/overlays.css';

const COLOR_BY: { id: ColorBy; label: string; hint: string }[] = [
  { id: 'category', label: 'Category', hint: 'Facility type' }, { id: 'confidence', label: 'Confidence', hint: 'Extraction confidence band' },
  { id: 'review', label: 'Review', hint: 'Verified, flagged, needs review' }, { id: 'fte', label: 'FTE', hint: 'Estimated FTE per building' },
];
const LABELS: { id: LabelMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Names where they fit, numbers elsewhere' }, { id: 'numbers', label: 'Numbers', hint: 'Building numbers only' }, { id: 'off', label: 'Off', hint: 'Only the selected and hovered building' },
];
const HINTS_KEY = 'bos.hints.v1';
const readHints = (): { mapHint?: number } => { try { const v = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const writeHints = (patch: Record<string, unknown>) => { try { localStorage.setItem(HINTS_KEY, JSON.stringify({ ...readHints(), ...patch })); } catch { /* storage unavailable */ } };

/** Free-rect width in chrome CSS px (after --ui-zoom), from the bos:insets events the shell publishes. */
function useFreeWidth(): number {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const l = parseFloat(cs.getPropertyValue('--inset-left')) || 0, r = parseFloat(cs.getPropertyValue('--inset-right')) || 0;
    return Math.max(0, (window.innerWidth - l - r) / zoomFactor());
  };
  const [w, setW] = useState(read);
  useEffect(() => {
    const on = () => setW(read());
    window.addEventListener('bos:insets', on);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('bos:insets', on); window.removeEventListener('resize', on); };
  }, []);
  return w;
}

/** The legend for the current colour mode, narrowed to the categories and grounds kinds this project has. */
function useLegend() {
  const colorBy = useStore((s) => s.colorBy);
  const facilities = useStore((s) => s.project?.inventory.facilities);
  const grounds = useStore((s) => s.project?.inventory.grounds);
  const { fteBreaks } = useDerived();
  const present = useMemo(() => {
    if (colorBy !== 'category') return undefined;
    const cat = new Map<FacilityCategory, number>();
    for (const f of facilities ?? []) cat.set(f.category, (cat.get(f.category) ?? 0) + 1);
    const kinds = new Map<GroundsKind, number>();
    for (const g of grounds ?? []) kinds.set(g.kind, (kinds.get(g.kind) ?? 0) + 1);
    return {
      categories: [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      grounds: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => ({ color: ZONE_COLORS[k] ?? '#3f6e40', label: ZONE_LABELS[k] ?? k })),
    };
  }, [colorBy, facilities, grounds]);
  return useMemo(() => legendFor(colorBy, fteBreaks, present), [colorBy, fteBreaks, present]);
}

export const ViewportOverlays = memo(function ViewportOverlays() {
  const view = useStore((s) => s.view);
  const empty = useStore((s) => !s.project || s.project.inventory.facilities.length + s.project.inventory.grounds.length === 0);
  const running = useStore((s) => s.extraction.running);
  useMapHotkeys(view === 'map');
  if (view !== 'map') return null;
  if (empty) return running ? null : <EmptyCard />;
  return (
    <>
      <SiteToolbar />
      <ViewToolbar />
      <CenterChips />
      <BottomOverlays />
    </>
  );
});

function useMapHotkeys(enabled: boolean) {
  const s = useStore.getState;
  useHotkey('h', () => s().requestCamera('fit-site'), { label: 'Fit the site', group: 'Map', enabled });
  useHotkey('f', () => s().requestCamera(s().selection.kind ? 'frame-selection' : 'fit-site'), { label: 'Frame the selection', group: 'Map', enabled });
  useHotkey('c', () => { const i = COLOR_BY.findIndex((c) => c.id === s().colorBy); s().setColorBy(COLOR_BY[(i + 1) % COLOR_BY.length].id); }, { label: 'Cycle colour-by', group: 'Map', enabled });
  useHotkey('l', () => { const i = LABELS.findIndex((c) => c.id === s().labelMode); s().setLabelMode(LABELS[(i + 1) % LABELS.length].id); }, { label: 'Cycle labels', group: 'Map', enabled });
  useHotkey('p', () => { if (s().focusMode === 'building') return false; s().setPlanView(!s().planView); }, { label: 'Plan view (top-down, north up)', group: 'Map', enabled });
  useHotkey('i', () => {
    const st = s();
    if (st.focusMode === 'building') { st.setFocusMode('site'); return; }
    if (st.selection.kind !== 'facility') return false;
    const f = st.project?.inventory.facilities.find((x) => x.id === (st.selection as { id: string }).id);
    if (!f || !isInScope(f)) return false;
    st.setFocusMode('building');
  }, { label: 'Inside the selected building', group: 'Review', enabled });
}

/**
 * A small segmented control whose unavailable options stay hoverable and focusable (aria-disabled, not disabled),
 * so their tooltip can say why (A15: "Inside building" disabled with a tooltip).
 */
function SoftSeg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; blocked?: boolean; tooltip?: string }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const ok = options.filter((o) => !o.blocked);
    const i = ok.findIndex((o) => o.value === value);
    const n = ok[(i + (e.key === 'ArrowRight' ? 1 : -1) + ok.length) % ok.length];
    if (n && n.value !== value) onChange(n.value);
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className="seg seg--sm vo-seg" onKeyDown={onKey}>
      {options.map((o) => {
        const on = o.value === value;
        const btn = (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-disabled={o.blocked || undefined} tabIndex={on || o.blocked ? 0 : -1}
            className={cx('seg__opt', on && 'is-on', o.blocked && 'is-blocked')} onClick={() => { if (!o.blocked && !on) onChange(o.value); }}>
            <span>{o.label}</span>
          </button>
        );
        return o.tooltip ? <Tooltip key={o.value} content={o.tooltip} placement="bottom" delay={o.blocked ? 250 : 500}>{btn}</Tooltip> : btn;
      })}
    </div>
  );
}

// ------------------------------------------------------------------ top-left: site / building
function SiteToolbar() {
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const setBuildingTab = useStore((s) => s.setBuildingTab);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const noBuildings = useStore((s) => (s.project?.inventory.facilities.length ?? 0) === 0);
  const { facById, groundsById } = useDerived();
  const f = selection.kind === 'facility' ? facById.get(selection.id) : undefined;
  const g = selection.kind === 'grounds' ? groundsById.get(selection.id) : undefined;
  const hasGrounds = useStore((s) => (f ? s.project?.inventory.grounds.some((x) => x.facilityId === f.id) ?? false : false));
  const inScope = f ? isInScope(f) : false;

  if (focusMode === 'building' && f) {
    return (
      <div className="vo-toolbar vo-toolbar--left vo-crumbs" data-occluder="" role="toolbar" aria-label="Building view">
        <Button size="sm" variant="ghost" icon={ArrowLeft} tooltip="Back to the site (I or Esc)" onClick={() => setFocusMode('site')}>Site</Button>
        <span className="vo-crumbs__sep" aria-hidden>/</span>
        <span className="vo-crumbs__here" title={`${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}`}>{f.buildingNumber ? <b className="mono">{f.buildingNumber}</b> : null}<span className="nm">{f.name}</span></span>
        <SoftSeg label="Crews shown" value={buildingTab} onChange={setBuildingTab}
          options={[{ value: 'interior', label: 'Interior', tooltip: 'Cut-away with the crews inside' }, { value: 'grounds', label: 'Grounds', blocked: !hasGrounds, tooltip: hasGrounds ? 'Grounds attached to this building' : 'No grounds areas are attached to this building' }]} />
      </div>
    );
  }
  const insideTip = noBuildings ? 'This project has grounds areas only; there is no building to go inside'
    : !f ? 'Select a building first (or double-click one)'
      : !inScope ? 'Out-of-scope buildings have no crews to show'
        : 'Cut-away view of the selected building (I)';
  return (
    <div className="vo-toolbar vo-toolbar--left" data-occluder="" role="toolbar" aria-label="Site view">
      <SoftSeg label="Site or building" value="site" onChange={(v) => { if (v === 'building' && f && inScope) setFocusMode('building'); }}
        options={[{ value: 'site', label: 'Site' }, { value: 'building', label: 'Inside building', blocked: !f || !inScope, tooltip: insideTip }]} />
      {(f || g) && (
        <span className="vo-sel">
          <span className="vo-sel__txt" title={f ? `${f.buildingNumber ? `${f.buildingNumber} · ` : ''}${f.name}` : g!.name}>{f ? <>{f.buildingNumber && <b className="mono">{f.buildingNumber}</b>}{f.buildingNumber ? ' · ' : ''}{f.name}</> : g!.name}</span>
          <button type="button" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => select({ kind: null })}><X size={14} aria-hidden /></button>
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ top-right: view toolbar
function ViewToolbar() {
  const colorBy = useStore((s) => s.colorBy);
  const labelMode = useStore((s) => s.labelMode);
  const lighting = useStore((s) => s.lighting);
  const st = useStore.getState;
  const legend = usePopover<HTMLButtonElement>();
  const moreItems = (): MenuItem[] => {
    const s = st();
    return [
      { kind: 'header', label: 'Quality' },
      { id: 'q-high', label: 'High', hint: 'Shadows, ambient occlusion, bloom in live lighting', checked: s.quality === 'high', onSelect: () => s.setQuality('high') },
      { id: 'q-fast', label: 'Fast', hint: 'For large sites and slower machines', checked: s.quality === 'fast', onSelect: () => s.setQuality('fast') },
      { kind: 'separator' },
      { id: 'plan', label: 'Plan view', hint: 'Top-down, north up, numbers on the roofs', kbd: 'p', checked: s.planView, disabled: s.focusMode === 'building', onSelect: () => s.setPlanView(!s.planView) },
      { id: 'orbit', label: 'Orbit when idle', checked: s.autoOrbit, onSelect: () => s.setAutoOrbit(!s.autoOrbit) },
      { id: 'reduced', label: 'Reduced motion', checked: s.reducedMotion, onSelect: () => s.setReducedMotionPref(!s.reducedMotion) },
      { kind: 'separator' },
      { id: 'relayout', label: 'Re-layout site', icon: LayoutGrid, hint: 'Re-pack buildings by category', onSelect: () => s.relayout() },
    ];
  };
  return (
    <div className="vo-toolbar vo-toolbar--right" data-occluder="" role="toolbar" aria-label="Map display">
      <MenuButton label="Color by" placement="bottom-end" items={() => COLOR_BY.map((c) => ({ id: c.id, label: c.label, hint: c.hint, checked: st().colorBy === c.id, onSelect: () => st().setColorBy(c.id) }))}
        trigger={(t) => <Button ref={t.ref} size="sm" variant="ghost" icon={Palette} className="vo-tb-label" tooltip="Color buildings by (C)" aria-label={`Color by: ${colorBy}`} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>{COLOR_BY.find((c) => c.id === colorBy)?.label}</Button>} />
      <MenuButton label="Labels" placement="bottom-end" items={() => LABELS.map((c) => ({ id: c.id, label: c.label, hint: c.hint, checked: st().labelMode === c.id, onSelect: () => st().setLabelMode(c.id) }))}
        trigger={(t) => <IconButton ref={t.ref} size="sm" icon={Tag} label={`Labels: ${labelMode}`} tooltip={`Labels: ${LABELS.find((l) => l.id === labelMode)?.label} (L)`} pressed={labelMode !== 'auto'} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle} />} />
      <IconButton size="sm" icon={lighting === 'review' ? Sun : Moon} label={lighting === 'review' ? 'Lighting: review (daylight)' : 'Lighting: live (follows the crew clock)'}
        tooltip={lighting === 'review' ? 'Review lighting · switch to live' : 'Live lighting · switch to review'} pressed={lighting === 'live'} onClick={() => st().setLighting(lighting === 'review' ? 'live' : 'review')} />
      <IconButton ref={legend.anchorRef} size="sm" icon={Layers} label="Legend" tooltip="Legend" pressed={legend.open} aria-expanded={legend.open} aria-haspopup="dialog" onClick={legend.toggle} />
      <LegendPopover open={legend.open} anchor={legend.anchorRef} onClose={legend.close} />
      <IconButton size="sm" icon={Focus} label="Fit the site" tooltip="Fit the site (H)" onClick={() => st().requestCamera('fit-site')} />
      <IconButton size="sm" icon={Table2} label="Inventory table" tooltip="Inventory table (2)" onClick={() => st().setView('table')} />
      <MenuButton label="View options" placement="bottom-end" items={moreItems}
        trigger={(t) => <IconButton ref={t.ref} size="sm" icon={Ellipsis} label="View options" tooltip="Quality, plan view, orbit, re-layout" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle} />} />
    </div>
  );
}

function LegendPopover({ open, anchor, onClose, placement = 'bottom-end' }: { open: boolean; anchor: RefObject<HTMLElement | null>; onClose: () => void; placement?: 'bottom-end' | 'top-start' }) {
  const colorBy = useStore((s) => s.colorBy);
  const setColorBy = useStore((s) => s.setColorBy);
  const lg = useLegend();
  return (
    <Popover open={open} anchor={anchor} onClose={onClose} placement={placement} label="Legend" className="vo-legend-pop" initialFocus="none">
      <div className="vo-legend-pop__head">
        <span className="vo-legend-pop__title">{lg.title}</span>
      </div>
      <Segmented size="sm" block label="Color by" value={colorBy} onChange={setColorBy} options={COLOR_BY.map((c) => ({ value: c.id, label: c.label }))} />
      <ul className="vo-legend-pop__list">
        {lg.items.map((it) => <li key={it.label}><span className="sw" style={{ background: it.color }} aria-hidden>{it.glyph}</span>{it.label}</li>)}
      </ul>
      <p className="vo-legend-pop__note">Out-of-scope buildings are greyed; hover a building for its numbers.</p>
    </Popover>
  );
}

// ------------------------------------------------------------------ top-centre chips (P1)
function CenterChips() {
  const { layout, roster } = useDerived();
  const relayout = useStore((s) => s.relayout);
  const running = useStore((s) => s.extraction.running);
  const crewFilter = useStore((s) => s.crewFilter);
  const time = useStore((s) => s.sim.time);
  const simSet = useStore((s) => s.simSet);
  const stale = Boolean((layout as { stale?: boolean } | null)?.stale) && !running;
  const meta = crewFilter ? crewMeta(crewFilter) : null;
  const hasCrew = crewFilter ? roster.some((a) => a.crew === crewFilter) : false;
  const offShift = meta && hasCrew && !onShift(meta.shift, time);
  if (!stale && !offShift) return null;
  const jump = () => { if (!meta) return; const t = (meta.shift.start + 0.25) % 24; clock.time = t; simSet({ time: t }); };
  return (
    <div className="vo-center">
      {offShift && meta && (
        <div className="vo-chip" data-occluder="" role="status">
          <Clock3 size={14} aria-hidden />
          <span>{meta.short} is off shift ({hhmm(meta.shift.start)}–{hhmm(meta.shift.end)})</span>
          <button type="button" onClick={jump}>Jump to {hhmm(meta.shift.start)}</button>
        </div>
      )}
      {stale && (
        <div className="vo-chip" data-occluder="" role="status">
          <LayoutGrid size={14} aria-hidden />
          <span>Layout changed</span>
          <button type="button" onClick={relayout}>Re-layout</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bottom: legend chip + hint chip
function BottomOverlays() {
  const freeW = useFreeWidth();
  const lg = useLegend();
  const max = freeW >= 1000 ? 6 : freeW >= 760 ? 4 : freeW >= 560 ? 3 : 2;
  const shown = lg.items.slice(0, max);
  const pop = usePopover<HTMLButtonElement>();
  const legendRef = pop.anchorRef;
  const hintRef = useRef<HTMLDivElement>(null);
  const [raised, setRaised] = useState(false);
  const [hintVisible, setHintVisible] = useState(() => (readHints().mapHint ?? 0) < 3);
  const hideHint = useCallback(() => setHintVisible(false), []);
  const place = useCallback(() => {
    const l = legendRef.current, h = hintRef.current;
    if (!l || !h) { setRaised(false); return; }
    const lr = l.getBoundingClientRect(), hr = h.parentElement?.getBoundingClientRect();
    const hw = h.offsetWidth * zoomFactor();
    if (!hr) return;
    const hintLeft = hr.left + hr.width / 2 - hw / 2;
    setRaised(hintLeft < lr.right + 12 * zoomFactor());
  }, [legendRef]);
  useLayoutEffect(() => { place(); }, [place, freeW, shown.length, lg, hintVisible]);
  return (
    <>
      <button ref={legendRef} type="button" className="vo-legend" data-occluder="" aria-label={`Legend: ${lg.title}`} aria-expanded={pop.open} onClick={pop.toggle}>
        {shown.map((it) => <span key={it.label} className="vo-legend__item"><span className="sw" style={{ background: it.color }} aria-hidden>{it.glyph}</span>{it.label.split(' /')[0]}</span>)}
        {lg.items.length > shown.length && <span className="vo-legend__more">+{lg.items.length - shown.length}</span>}
      </button>
      <LegendPopover open={pop.open} anchor={legendRef} onClose={pop.close} placement="top-start" />
      {hintVisible && <HintChip hintRef={hintRef} raised={raised} onHide={hideHint} />}
    </>
  );
}

function HintChip({ hintRef, raised, onHide }: { hintRef: RefObject<HTMLDivElement | null>; raised: boolean; onHide: () => void }) {
  useEffect(() => {
    let n = readHints().mapHint ?? 0;
    const isCanvas = (t: EventTarget | null) => t instanceof HTMLCanvasElement && Boolean(t.closest('.stage'));
    const bump = (e: Event) => {
      if (!isCanvas(e.target)) return;
      n++; writeHints({ mapHint: n });
      if (n >= 3) onHide();
    };
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('wheel', bump, { capture: true, passive: true });
    return () => { window.removeEventListener('pointerdown', bump, true); window.removeEventListener('wheel', bump, true); };
  }, [onHide]);
  return (
    <div className="vo-hint-row" aria-hidden={false}>
      <div ref={hintRef} className={cx('vo-hint', raised && 'is-raised')} data-occluder="" role="note">
        <span>Drag to pan · Right-drag to orbit · Scroll to zoom · Double-click a building to go inside</span>
        <button type="button" aria-label="Hide this hint" title="Hide this hint" onClick={() => { writeHints({ mapHint: 3 }); onHide(); }}><X size={12} aria-hidden /></button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ §8 empty state
const TYPE_ICONS = [{ icon: FileText, label: 'PDF' }, { icon: FileType, label: 'DOCX' }, { icon: FileSpreadsheet, label: 'XLSX / CSV' }, { icon: FileArchive, label: 'ZIP' }];

function EmptyCard() {
  const pending = useStore((s) => s.pendingFiles);
  const addPending = useStore((s) => s.addPendingFiles);
  const removePending = useStore((s) => s.removePendingFile);
  useStore((s) => s.reader); useStore((s) => s.health); useStore((s) => s.project?.ai); // re-render the reader line
  const [drag, setDrag] = useState(false);
  const cta = useRef<HTMLButtonElement>(null);
  const why = usePopover<HTMLButtonElement>();
  useEffect(() => { if (pending.length) requestAnimationFrame(() => cta.current?.focus()); }, [pending.length]);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addPending(e.dataTransfer.files); };
  const rule = usesRuleBased();
  const noKey = useStore((s) => s.health != null && !s.health.aiAvailable);
  const line = readerLine().replace(/^with /, '');
  // a read already ran on this project and found nothing: say so, and why, instead of the first-run invitation
  const nothing = useStore((s) => (s.extraction.phase === 'done' && s.extraction.found === 0) || (!s.extraction.running && s.extraction.phase === 'idle' && (s.project?.documents.length ?? 0) > 0));
  const reason = useStore((s) => {
    const end = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
    const w = s.extraction.warnings[0]; if (w) return end(w.message);
    for (const d of s.project?.documents ?? []) if (d.warnings?.length) return end(d.warnings[0]);
    return null;
  });
  const docCount = useStore((s) => Math.max(s.project?.documents.length ?? 0, s.extraction.docs.length));
  return (
    <div className={cx('vo-empty', nothing && 'is-nothing')} data-occluder="" role="region" aria-label={nothing ? 'The last read found nothing' : 'New solicitation'}>
      {nothing ? (
        <>
          <div className="vo-empty__eyebrow vo-empty__eyebrow--warn"><TriangleAlert size={13} aria-hidden /> The last read found nothing</div>
          <h2 className="vo-empty__title">No facilities or grounds in {docCount === 1 ? 'that document' : docCount > 1 ? `those ${docCount} documents` : 'that read'}</h2>
          <p className="vo-empty__body">{reason ? <><span className="vo-empty__why">{reason}</span> </> : null}Add a text-layer PDF, an XLSX or CSV facility list, or {rule && noKey ? 'set up the Claude reader (scanned pages and drawings need it)' : 'try a different reader setting'}, then read again. The <button type="button" className="link" onClick={() => useStore.getState().openLeft('documents')}>Documents tab</button> lists what each file gave.</p>
        </>
      ) : (
        <>
          <div className="vo-empty__eyebrow">New solicitation</div>
          <h2 className="vo-empty__title">Drop the solicitation package to build the estimate</h2>
          <p className="vo-empty__body">PWS / SOW, technical exhibits (facility lists, grounds maps), workload tables. PDF, DOCX, XLSX, CSV, TSV, TXT, MD or a ZIP package.</p>
        </>
      )}
      <div className={cx('vo-empty__drop', drag && 'is-drag', pending.length > 0 && 'has-files')}
        onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
        onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
        onDrop={onDrop}>
        {pending.length ? (
          <ul className="vo-empty__files" aria-label="Files to analyze">
            {pending.slice(0, 4).map((f) => (
              <li key={`${f.name}-${f.size}`}><FileText size={14} aria-hidden /><span title={f.name}>{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removePending(f)}><X size={12} aria-hidden /></button></li>
            ))}
            {pending.length > 4 && <li className="more">+{pending.length - 4} more</li>}
          </ul>
        ) : (
          <>
            <CloudUpload size={28} strokeWidth={1.5} aria-hidden className="vo-empty__up" />
            <span className="vo-empty__drop-t">{drag ? 'Drop to add' : 'Drop files here'}</span>
            <span className="vo-empty__types">{TYPE_ICONS.map((t) => <span key={t.label}><t.icon size={14} strokeWidth={1.6} aria-hidden />{t.label}</span>)}</span>
            <span className="sr-only">Accepted: {ACCEPT_LABELS.join(', ')}</span>
          </>
        )}
      </div>
      <div className="vo-empty__actions">
        {pending.length
          ? <Button ref={cta} variant="primary" onClick={() => void analyzeNow()}>Analyze {pending.length} file{pending.length > 1 ? 's' : ''} {readerLine()} →</Button>
          : <Button variant="primary" onClick={chooseFiles}>Choose files</Button>}
        <Button variant="secondary" onClick={() => void analyzeNow({ sample: true })}>Try sample RFP</Button>
        {pending.length > 0 && <Button variant="ghost" onClick={chooseFiles}>Add more</Button>}
      </div>
      <p className="vo-empty__reader">
        {rule && noKey ? <>Rule-based reader (no API key on the server) · </> : <>Reader: {line.replace(/^the /, '')} · </>}
        {rule && noKey
          ? <button ref={why.anchorRef} type="button" aria-expanded={why.open} onClick={why.toggle}>why?</button>
          : <button type="button" onClick={() => useStore.getState().openLeft('documents')}>change</button>}
      </p>
      <Popover {...why.props} placement="bottom-start" label="About the reader" className="vo-why-pop">
        <p>The server has no <code>ANTHROPIC_API_KEY</code>, so the rule-based parser reads the package. It reads clean facility lists and workload tables (XLSX, CSV, text-layer PDFs), but on layouts it has not seen it can miss facilities or take the wrong area column, and it cannot read scans. Every row it reads is marked for review: compare the count and totals with the document before pricing.</p>
        <p>Add the key to <code>.env</code> and restart the server to let Claude read scanned exhibits and free-form PWS text. Reader settings are in the <button type="button" className="link" onClick={() => { why.close(); useStore.getState().openLeft('documents'); }}>Documents tab</button>.</p>
      </Popover>
    </div>
  );
}

