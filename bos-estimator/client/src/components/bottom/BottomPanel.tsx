// Bottom panel (UI spec §5.9), between the side panels: Crews | Log. 112 px expanded, 36 px collapsed; hidden while
// the project is empty and in Table view. Crews: a fixed 200 px clock card plus crew cards (ring = working ÷ heads)
// in a horizontal scroller with edge fades and ‹ › buttons. Log: the AI log with filters, warnings first-class.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Pause, Play, TriangleAlert, X } from 'lucide-react';
import { useStore, type LogEntry, type LogFilter } from '../../store';
import { useDerived } from '../../derived';
import { clock } from '../../three/clock';
import { agentStates, fmtTime, peakHour, summarize, type CrewNow } from '../../three/sim';
import { crewMeta } from '@shared/factors';
import { CREW_ORDER, crewColor } from '../lib/theme';
import { useHotkey } from '../lib/keys';
import { cx } from '../lib/cx';
import { Chip, IconButton, Select, Tabs } from '../ui';
import { CREW_ICON, shiftLabel } from './crewIcons';
import { fitNum } from '../../fmt';
import '../../styles/bottom.css';

const SPEEDS = [1, 4, 12, 30, 90, 240];
const FILTERS: { id: LogFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'found', label: 'Found' }, { id: 'warnings', label: 'Warnings' }, { id: 'errors', label: 'Errors' }, { id: 'text', label: 'AI text' }, { id: 'status', label: 'Status' }];
const SPEED_OPTS = SPEEDS.map((s) => ({ value: String(s), label: `${s} min/s` }));

/** Whether the dock shows at all (hidden while the project is empty and in Table view). */
export function useBottomVisible(): boolean {
  const empty = useStore((s) => !s.project || s.project.inventory.facilities.length + s.project.inventory.grounds.length === 0);
  const view = useStore((s) => s.view);
  const running = useStore((s) => s.extraction.running);
  const hasLog = useStore((s) => s.extraction.log.length > 0);
  return view === 'map' && (!empty || running || hasLog);
}

/** P1: the clock starts at the hour with the most heads on shift, once per project load. */
let peakSetFor: string | null = null;
function usePeakHourDefault() {
  const { roster } = useDerived();
  const projectId = useStore((s) => s.projectId);
  const simSet = useStore((s) => s.simSet);
  useEffect(() => {
    if (!roster.length || peakSetFor === projectId) return;
    peakSetFor = projectId;
    const h = peakHour(roster);
    clock.time = h;
    simSet({ time: h });
  }, [roster, projectId, simSet]);
}

export const BottomPanel = memo(function BottomPanel() {
  const visible = useBottomVisible();
  const open = useStore((s) => s.bottomOpen);
  const tab = useStore((s) => s.bottomTab);
  const setTab = useStore((s) => s.setBottomTab);
  const setOpen = useStore((s) => s.setBottomOpen);
  const warnings = useStore((s) => s.extraction.warnings.length);
  const simSet = useStore((s) => s.simSet);
  usePeakHourDefault();

  const togglePlay = useCallback(() => { clock.playing = !useStore.getState().sim.playing; simSet({ playing: clock.playing }); }, [simSet]);
  const setSpeed = useCallback((v: number) => { clock.speed = v; simSet({ speed: v }); }, [simSet]);
  const step = (d: number) => { const i = SPEEDS.indexOf(useStore.getState().sim.speed); setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + d))]); };
  useHotkey('space', togglePlay, { label: 'Play / pause the crew clock', group: 'Map', enabled: visible, when: () => useStore.getState().view === 'map' });
  useHotkey('-', () => step(-1), { label: 'Slower crew clock', group: 'Map', enabled: visible });
  useHotkey('=', () => step(1), { label: 'Faster crew clock', group: 'Map', enabled: visible });

  if (!visible) return null;
  return (
    <section className={cx('bottom-panel', open ? 'is-open' : 'is-collapsed', open && tab === 'log' && 'is-log')} aria-label="Crews and log">
      <div className="bp__head">
        <Tabs idBase="bottom" label="Bottom panel" size="sm" value={tab} onChange={(t) => { setTab(t); if (!open) setOpen(true); }}
          items={[{ id: 'crews', label: 'Crews' }, { id: 'log', label: 'Log', badge: warnings ? <><TriangleAlert size={12} aria-hidden />{warnings}</> : undefined }]} />
        {!open && tab === 'crews' && <CollapsedCrews onPlay={togglePlay} onSpeed={setSpeed} />}
        {!open && tab === 'log' && <LastLogLine />}
        <IconButton className="bp__toggle" size="sm" icon={open ? ChevronDown : ChevronUp} label={open ? 'Collapse the bottom panel' : 'Expand the bottom panel'} tooltip={`${open ? 'Collapse' : 'Expand'} (\\)`} tooltipPlacement="top-end" onClick={() => setOpen(!open)} />
      </div>
      {open && (tab === 'crews'
        ? <div role="tabpanel" id="bottom-panel-crews" aria-labelledby="bottom-tab-crews" className="bp__body"><CrewsBody onPlay={togglePlay} onSpeed={setSpeed} /></div>
        : <div role="tabpanel" id="bottom-panel-log" aria-labelledby="bottom-tab-log" className="bp__body"><LogBody /></div>)}
    </section>
  );
});

function useCrewNow(): { now: CrewNow[]; time: number } {
  const { roster, layout } = useDerived();
  const time = useStore((s) => s.sim.time);
  const now = useMemo(() => {
    if (!layout || !roster.length) return [];
    const by = new Map(summarize(agentStates(roster, time, layout.depot)).map((c) => [c.crew, c]));
    // a grounds-only project shows only the grounds crews (A15); working supervisors stay in the estimate
    const buildingCrews = roster.some((a) => a.crew === 'custodial' || a.crew === 'floor_care' || a.crew === 'dining_prod' || a.crew === 'dining_san');
    return CREW_ORDER.filter((c) => c !== 'supervision' || buildingCrews).map((c) => by.get(c)).filter((c): c is CrewNow => Boolean(c) && c!.heads > 0);
  }, [roster, layout, time]);
  return { now, time };
}

const dayPart = (t: number) => (t < 5 ? 'Night' : t < 12 ? 'Morning' : t < 17 ? 'Afternoon' : t < 21 ? 'Evening' : 'Night');

function ClockControls({ onPlay, onSpeed, compact }: { onPlay: () => void; onSpeed: (v: number) => void; compact?: boolean }) {
  const playing = useStore((s) => s.sim.playing);
  const speed = useStore((s) => s.sim.speed);
  return (
    <>
      <IconButton size={compact ? 'sm' : 'md'} variant={compact ? 'ghost' : 'secondary'} icon={playing ? Pause : Play} label={playing ? 'Pause the crew clock' : 'Play the crew clock'} tooltip={`${playing ? 'Pause' : 'Play'} (Space)`} onClick={onPlay} />
      <Select size="sm" className="bp__speed" aria-label="Clock speed" value={String(speed)} onChange={(v) => onSpeed(Number(v))} options={SPEED_OPTS} />
    </>
  );
}

function CollapsedCrews({ onPlay, onSpeed }: { onPlay: () => void; onSpeed: (v: number) => void }) {
  const { now, time } = useCrewNow();
  const crewFilter = useStore((s) => s.crewFilter);
  const setCrewFilter = useStore((s) => s.setCrewFilter);
  return (
    <div className="bp__mini">
      <span className="bp__time mono" aria-label={`Crew clock ${fmtTime(time)}`}>{fmtTime(time)}</span>
      <ClockControls onPlay={onPlay} onSpeed={onSpeed} compact />
      <div className="bp__mini-crews">
        {now.map((c) => (
          <Chip key={c.crew} className="bp__mini-chip" dot={crewColor(c.crew)} icon={CREW_ICON[c.crew]} selected={crewFilter === c.crew} onClick={() => setCrewFilter(crewFilter === c.crew ? null : c.crew)}
            tooltip={`${crewMeta(c.crew).label}: ${c.onShift.toLocaleString()} of ${c.heads.toLocaleString()} on shift`} count={`${fitNum(c.onShift, 4)}/${fitNum(c.heads, 4)}`}>
            <span className="bp__mini-name">{crewMeta(c.crew).short}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}

function CrewsBody({ onPlay, onSpeed }: { onPlay: () => void; onSpeed: (v: number) => void }) {
  const { now, time } = useCrewNow();
  const crewFilter = useStore((s) => s.crewFilter);
  const setCrewFilter = useStore((s) => s.setCrewFilter);
  const simSet = useStore((s) => s.simSet);
  const playing = useStore((s) => s.sim.playing);
  const speed = useStore((s) => s.sim.speed);
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current; if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [measure, now.length]);
  const page = (d: number) => { const el = scroller.current; if (el) el.scrollBy({ left: d * Math.max(160, el.clientWidth * 0.7), behavior: useStore.getState().reducedMotion ? 'auto' : 'smooth' }); };
  const setTime = (t: number) => { clock.time = t; simSet({ time: t }); };
  return (
    <div className="bp__crews">
      <div className="bp__clock">
        <div className="bp__clock-row">
          <span className="bp__clock-time mono">{fmtTime(time)}</span>
          <span className="bp__clock-part">{dayPart(time)}</span>
          <IconButton className="bp__play" variant="secondary" icon={playing ? Pause : Play} label={playing ? 'Pause the crew clock' : 'Play the crew clock'} tooltip={`${playing ? 'Pause' : 'Play'} (Space)`} onClick={onPlay} />
        </div>
        <div className="bp__clock-row">
          <input className="bp__scrub" type="range" min={0} max={23.99} step={0.05} value={time} aria-label="Time of day" style={{ '--p': `${Math.max(0, Math.min(100, (time / 23.99) * 100))}%` } as CSSProperties} onChange={(e) => setTime(Number(e.target.value))} />
          <Select size="sm" className="bp__speed" aria-label="Clock speed" value={String(speed)} onChange={(v) => onSpeed(Number(v))} options={SPEED_OPTS} />
        </div>
      </div>
      <div className={cx('bp__cards-wrap', edge.left && 'fade-l', edge.right && 'fade-r')}>
        {edge.left && <IconButton className="bp__pg bp__pg--l" size="sm" variant="secondary" icon={ChevronLeft} label="Scroll crews left" tooltip={false} onClick={() => page(-1)} />}
        <div ref={scroller} className="bp__cards" onScroll={measure}>
          {now.map((c) => {
            const meta = crewMeta(c.crew);
            const Icon = CREW_ICON[c.crew];
            const on = crewFilter === c.crew;
            const off = c.onShift === 0;
            const nowText = c.where.length === 0 ? (c.traveling ? `${c.traveling} en route` : 'Standing by') : c.where.slice(0, 2).map((w) => `${w.n} · ${w.target}`).join(' · ');
            return (
              <div key={c.crew} className={cx('bp__card', on && 'is-on', off && 'is-off')} style={{ ['--crew' as string]: crewColor(c.crew), ['--p' as string]: c.heads ? (c.working / c.heads) * 100 : 0 }}>
                <button type="button" className="bp__card-main" aria-pressed={on} onClick={() => setCrewFilter(on ? null : c.crew)}
                  title={`${meta.label}: ${c.onShift} of ${c.heads} on shift, ${c.working} working${on ? ' · showing only this crew; click to show all' : ' · click to show only this crew in the 3D view'}`}>
                  <span className="ring" aria-hidden><span>{ringNum(c.working)}</span></span>
                  <span className="txt">
                    <span className="name"><Icon size={13} strokeWidth={1.75} aria-hidden /><span className="nm">{meta.short}</span></span>
                    <span className="cnt mono">{off ? `Off · ${shiftLabel(meta.shift)}` : `${fitNum(c.onShift, 5)}/${fitNum(c.heads, 5)} on`}</span>
                    {!off && <span className="now">{nowText}</span>}
                  </span>
                </button>
                {off && <button type="button" className="bp__jump" onClick={() => setTime((meta.shift.start + 0.5) % 24)}>Jump to {fmtTime(meta.shift.start)}</button>}
                {on && <button type="button" className="bp__card-x" aria-label={`Show all crews (clear the ${meta.short} filter)`} onClick={() => setCrewFilter(null)}><X size={12} aria-hidden /></button>}
              </div>
            );
          })}
          {now.length === 0 && <div className="bp__empty">Crews appear once facilities and grounds are estimated.</div>}
        </div>
        {edge.right && <IconButton className="bp__pg bp__pg--r" size="sm" variant="secondary" icon={ChevronRight} label="Scroll crews right" tooltip={false} onClick={() => page(1)} />}
      </div>
    </div>
  );
}

/** The 24 px ring shows at most three characters: 68562 → 69K. */
const ringNum = (v: number) => (v < 1000 ? String(v) : v < 999_500 ? `${Math.round(v / 1000)}K` : `${Math.max(1, Math.round(v / 1e6))}M`);

function LastLogLine() {
  const line = useStore((s) => { const l = s.extraction.log; for (let i = l.length - 1; i >= 0; i--) if (l[i].kind !== 'thinking') return l[i].text; return ''; });
  return <span className="bp__lastlog mono" title={line}>{line || 'No log entries yet.'}</span>;
}

const matchFilter = (f: LogFilter, l: LogEntry) => f === 'all' || (f === 'found' && l.kind === 'found') || (f === 'warnings' && l.kind === 'warning') || (f === 'errors' && l.kind === 'error') || (f === 'text' && (l.kind === 'text' || l.kind === 'thinking' || l.kind === 'tool')) || (f === 'status' && l.kind === 'status');
const KIND_TAG: Record<LogEntry['kind'], string> = { status: 'status', text: 'ai', thinking: 'think', tool: 'tool', error: 'error', found: 'found', warning: 'warn' };

function LogBody() {
  const log = useStore((s) => s.extraction.log);
  const filter = useStore((s) => s.logFilter);
  const setFilter = useStore((s) => s.setLogFilter);
  const docs = useStore((s) => s.project?.documents);
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const rows = useMemo(() => log.filter((l) => matchFilter(filter, l)), [log, filter]);
  const counts = useMemo(() => { const c: Partial<Record<LogFilter, number>> = {}; for (const f of FILTERS) c[f.id] = f.id === 'all' ? log.length : log.filter((l) => matchFilter(f.id, l)).length; return c; }, [log]);
  // persisted document warnings, shown when this session has no run warnings
  const docWarnings = useMemo(() => (docs ?? []).flatMap((d) => (d.warnings ?? []).map((w) => `${d.name}: ${w}`)), [docs]);
  const showDocWarnings = (filter === 'warnings' || (filter === 'all' && log.length === 0)) && counts.warnings === 0 && docWarnings.length > 0;
  useLayoutEffect(() => { const el = ref.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [rows]);
  // the pane grows (dock transition, wrapped lines settling): keep the newest line fully in view while following the end
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const stick = () => { if (atBottom.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(stick); ro.observe(el);
    const raf = requestAnimationFrame(stick);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  const copy = () => { void navigator.clipboard?.writeText(log.map((l) => `${new Date(l.t).toISOString()} ${l.kind}: ${l.text}`).join('\n')).then(() => useStore.getState().pushToast({ text: `Copied ${log.length} log lines`, tone: 'ok', ttl: 2000 })).catch(() => {}); };
  return (
    <div className="bp__log">
      <div className="bp__log-bar" role="group" aria-label="Log filter">
        {FILTERS.map((f) => <Chip key={f.id} tone={f.id === 'warnings' && counts.warnings ? 'warn' : f.id === 'errors' && counts.errors ? 'bad' : 'neutral'} selected={filter === f.id} count={counts[f.id] || undefined} onClick={() => setFilter(f.id)}>{f.label}</Chip>)}
        <IconButton size="sm" icon={Copy} label="Copy log" tooltip="Copy the log" disabled={!log.length} onClick={copy} />
      </div>
      <div ref={ref} className="bp__log-list mono" role="log" aria-live="off" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {showDocWarnings && (
          <>
            <div className="bp__log-sep">Warnings recorded with this project's documents</div>
            {docWarnings.map((w, i) => <div key={`dw${i}`} className="bp__log-line is-warning"><span className="t" /><span className="tag">warn</span><span className="txt">{w}</span></div>)}
          </>
        )}
        {rows.length === 0 && !showDocWarnings
          ? <div className="bp__empty">{log.length ? 'Nothing matches this filter.' : 'No log entries yet. The log fills while a package is read.'}</div>
          : rows.slice(-600).map((l, i) => (
            <div key={i} className={`bp__log-line is-${l.kind}`}>
              <span className="t">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
              <span className="tag">{KIND_TAG[l.kind]}</span>
              <span className="txt">{l.text}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
