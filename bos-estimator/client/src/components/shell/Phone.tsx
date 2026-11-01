// Phone chrome (< 768 px, or a short landscape window): the 3D map full-bleed under a compact top bar (+ the run
// strip), one bottom sheet that re-hosts the existing tab contents, a tab bar (a rail beside the map in landscape)
// and, on the Map tab, the crew clock as a compact strip. The map's free rect (.vp-area, measured by the insets
// writer exactly like the desktop's) ends at the top of the sheet, capped at the half snap, so CameraRig frames the
// site in what stays visible; it follows the sheet while it is dragged.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { BarChart3, Building2, FileStack, Map as MapIcon, Rows3 } from 'lucide-react';
import { useStore, type SheetSnap, type SheetTab } from '../../store';
import { useDerived } from '../../derived';
import { cx } from '../lib/cx';
import { ToastHost } from '../ui';
import { InventoryTab } from '../inventory/InventoryTab';
import { DocumentsTab } from '../documents/DocumentsTab';
import { Inspector, QueueNav } from '../inspector/Inspector';
import { EstimateTab } from '../estimate/EstimateTab';
import { BottomPanel, CrewMiniStrip } from '../bottom/BottomPanel';
import { RunStrip } from '../run/RunStrip';
import { ViewportOverlays } from '../overlays/ViewportOverlays';
import { BottomSheet, heightOf, useSheetSizes } from './BottomSheet';
import { MetricGrid, PhoneTopBar } from './TopBar';
import { useOrientation } from './responsive';
import { usePhoneKeyboard } from './keyboard';
import { n1 } from '../../fmt';

const TABS: { id: SheetTab; label: string; icon: typeof Rows3 }[] = [
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'list', label: 'List', icon: Rows3 },
  { id: 'inspector', label: 'Inspector', icon: Building2 },
  { id: 'estimate', label: 'Estimate', icon: BarChart3 },
  { id: 'documents', label: 'Docs', icon: FileStack },
];
const TITLE: Record<string, string> = { list: 'Inventory', inspector: 'Inspector', estimate: 'Estimate', documents: 'Documents', crews: 'Crews & log' };
/** a short phone (an SE, a 360 × 640 Android) or one on its side: the List opens at full height, since its search,
 * filters and metrics leave little room for rows lower down */
export const shortPhone = () => typeof window !== 'undefined' && (window.innerHeight < 700 || window.innerWidth > window.innerHeight);
/** the snap a tab opens at from the Map tab */
const defaultSnap = (tab: SheetTab, selected: boolean): SheetSnap => (tab === 'inspector' && selected ? 'peek' : tab === 'list' && shortPhone() ? 'full' : 'half');
const MINI_H = 60;
const SNAP_RANK: Record<SheetSnap, number> = { closed: 0, peek: 1, half: 2, full: 3 };

/** Height of the Inspector's header (the selection's summary and its review actions) while the sheet shows it, so the
 * peek snap can hold all of it. */
function useInspectorHeadHeight(mainRef: RefObject<HTMLElement | null>, active: boolean): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    if (!active) { setH(0); return; }
    const main = mainRef.current; if (!main) return;
    let ro: ResizeObserver | null = null; let watched: Element | null = null;
    const read = () => {
      const head = main.querySelector('.m-sheet .insp__head');
      if (head !== watched) { ro?.disconnect(); watched = head; if (head) { ro = new ResizeObserver(read); ro.observe(head); } }
      const next = head ? Math.ceil((head as HTMLElement).offsetHeight) : 0;
      setH((p) => (p === next ? p : next));
    };
    read();
    // the Inspector remounts per selection: follow its header element
    const mo = new MutationObserver(read);
    mo.observe(main, { childList: true, subtree: true });
    return () => { mo.disconnect(); ro?.disconnect(); };
  }, [mainRef, active]);
  return h;
}

export const PhoneChrome = memo(function PhoneChrome({ vpRef }: { vpRef: RefObject<HTMLDivElement | null> }) {
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const empty = useStore((s) => !s.project || s.project.inventory.facilities.length + s.project.inventory.grounds.length === 0);
  const landscape = useOrientation() === 'landscape';
  usePhoneKeyboard();
  const mainRef = useRef<HTMLDivElement>(null);
  const selected = useStore((s) => s.selection.kind !== null);
  // the tab whose content the sheet shows; kept while the sheet slides closed
  const [shown, setShown] = useState<string>(sheet.tab === 'map' ? 'list' : sheet.tab);
  useEffect(() => { if (sheet.tab !== 'map') setShown(sheet.tab); }, [sheet.tab]);
  // peek holds the whole Inspector header (summary, Verify / Flag / Inside / Locate): sheet head + header
  const inspHead = useInspectorHeadHeight(mainRef, shown === 'inspector' && selected && !landscape);
  const sizes = useSheetSizes(mainRef, landscape, inspHead ? inspHead + 49 : 0);
  const snap = sheet.tab === 'map' ? 'closed' : sheet.snap;
  const open = snap !== 'closed';
  const miniVisible = !open && !empty;

  // geometry → CSS variables on .m-main (the free rect, the sheet, the toasts)
  const apply = useCallback((h: number | null) => {
    const el = mainRef.current; if (!el) return;
    const sheetH = h ?? heightOf(sizes, snap);
    const visible = sheetH > 0;
    const cover = landscape ? (miniVisible && h == null ? MINI_H : 0) : (visible ? Math.min(sheetH, sizes.half) : miniVisible ? MINI_H : 0);
    el.style.setProperty('--m-sheet-h', `${Math.round(sheetH)}px`);
    el.style.setProperty('--m-cover', `${Math.round(cover)}px`);
    el.style.setProperty('--m-vp-left', landscape && visible ? 'var(--m-sheet-w)' : '0px');
    // toasts ride above whatever covers the bottom; over a full sheet they sit at its foot
    el.style.setProperty('--m-toast-b', `${Math.round((landscape ? (miniVisible ? MINI_H : 0) : (sheetH >= sizes.full - 1 ? 0 : visible ? sheetH : miniVisible ? MINI_H : 0)) + 8)}px`);
    el.dataset.sheet = h == null ? snap : 'drag';
  }, [sizes, snap, landscape, miniVisible]);
  useLayoutEffect(() => { apply(null); }, [apply]);

  const onSnap = useCallback((next: SheetSnap) => {
    if (next === 'closed') setSheet({ snap: 'closed', tab: 'map' });
    else setSheet({ snap: next });
  }, [setSheet]);

  // × on the Inspector closes the sheet and clears the selection (the Inspector's own × is hidden on phones);
  // swiping the sheet down only closes it
  const onClose = useCallback(() => {
    const s = useStore.getState();
    if (s.sheet.tab === 'inspector' && s.selection.kind !== null) s.select({ kind: null });
    setSheet({ snap: 'closed', tab: 'map' });
  }, [setSheet]);
  const pick = (tab: SheetTab) => {
    const s = useStore.getState();
    if (tab === 'map') { s.setSheet({ tab: 'map', snap: 'closed' }); return; }
    if (s.sheet.tab === tab && s.sheet.snap !== 'closed') { s.setSheet({ tab: 'map', snap: 'closed' }); return; }
    // switching tabs keeps the sheet's height; the List never opens lower than its default (rows need the room)
    const keep = s.sheet.snap !== 'closed' && s.sheet.tab !== 'map' ? s.sheet.snap : null;
    const want = defaultSnap(tab, selected);
    s.setSheet({ tab, snap: keep && tab === 'list' ? (SNAP_RANK[keep] >= SNAP_RANK[want] ? keep : want) : keep ?? want });
  };

  return (
    <>
      <div className="m-head">
        <PhoneTopBar />
        {!landscape && <RunStrip />}
      </div>
      {/* data-sheet (the snap, or "drag" while a finger moves the sheet) is written by apply() */}
      <div ref={mainRef} className="m-main">
        {/* landscape: the run strip heads the map column, so the sheet beside it gets the full height */}
        {landscape && <div className="m-run"><RunStrip /></div>}
        <div ref={vpRef} className="vp-area">
          <ViewportOverlays />
        </div>
        {miniVisible && <CrewMiniStrip onExpand={() => setSheet({ tab: 'crews', snap: 'half' })} />}
        <BottomSheet id="m-sheet" snap={snap} sizes={sizes} onSnap={onSnap} onClose={onClose} onDrag={apply} label={`${TITLE[shown] ?? 'Panel'} sheet`} title={<SheetTitle tab={shown} />}
          closeLabel={shown === 'inspector' && selected ? 'Close the inspector and clear the selection' : undefined}
          headEnd={shown === 'inspector' ? <SheetQueueNav /> : undefined}>
          <SheetContent tab={shown} />
        </BottomSheet>
        <div className="m-toasts"><ToastHost /></div>
      </div>
      {/* the Crews & log sheet is no tab of the bar: no tab shows as current while it is open */}
      <TabBar active={sheet.tab === 'crews' && open ? 'crews' : open ? sheet.tab : 'map'} onPick={pick} vertical={landscape} />
    </>
  );
});

function SheetTitle({ tab }: { tab: string }) {
  const sel = useStore((s) => s.selection);
  const { counts, est } = useDerived();
  let sub: string | null = null;
  // the Inspector's own header names the selection; the sheet title only says when there is none
  if (tab === 'inspector' && sel.kind === null) sub = 'Project summary';
  // the list's review footer moves up here (its rows get the room)
  if (tab === 'list' && counts.total > 0) sub = `Reviewed ${counts.verified.toLocaleString()}/${counts.total.toLocaleString()}${est ? ` · ${n1(est.totalFte)} FTE` : ''}`;
  return <>{TITLE[tab] ?? ''}{sub && <span className="m-sheet__sub">{sub}</span>}</>;
}

/** The review queue (‹ 6 / 27 ›) in the sheet head while the Inspector shows a row: visible at every snap. */
function SheetQueueNav() {
  const sel = useStore((s) => (s.selection.kind === null ? null : s.selection.id));
  if (!sel) return null;
  return <div className="m-sheet__nav" data-no-sheet-drag=""><QueueNav id={sel} /></div>;
}

/** List sheet: the metric strip and the filter chips slide away while the list scrolls down and come back on the way
 * up (or at the top), so a short sheet still shows rows. */
function ListPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let last = -1, lockUntil = 0, state = false;
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.classList?.contains('inv__list')) return;
      const y = t.scrollTop;
      const dy = last < 0 ? 0 : y - last;
      last = y;
      // the collapse itself resizes the list (and may clamp its scroll): ignore the scroll events it causes
      if (performance.now() < lockUntil) return;
      let next = state;
      if (y < 8) next = false;
      else if (dy > 6 && y > 32 && t.scrollHeight - t.clientHeight > 160) next = true;
      else if (dy < -10) next = false;
      if (next !== state) { state = next; lockUntil = performance.now() + 320; setCollapsed(next); }
    };
    el.addEventListener('scroll', onScroll, true);
    return () => el.removeEventListener('scroll', onScroll, true);
  }, []);
  // at the peek height the metrics and filters would leave no room for a row: they wait for a taller sheet
  const peek = useStore((s) => s.sheet.snap === 'peek');
  return (
    <div ref={ref} className={cx('m-sheet__panel m-sheet__panel--list', (collapsed || peek) && 'is-collapsed')}>
      <div className="m-sheet__lead" data-scroll-x=""><MetricGrid className="m-metrics--strip" /></div>
      <InventoryTab />
    </div>
  );
}

const SheetContent = memo(function SheetContent({ tab }: { tab: string }) {
  switch (tab) {
    case 'list': return <ListPanel />;
    case 'inspector': return <div className="m-sheet__panel"><Inspector /></div>;
    case 'estimate': return <div className="m-sheet__panel"><EstimateTab lead={<MetricGrid className="m-metrics--grid" />} /></div>;
    case 'documents': return <div className="m-sheet__panel"><DocumentsTab /></div>;
    case 'crews': return <div className="m-sheet__panel"><BottomPanel variant="sheet" /></div>;
    default: return null;
  }
});

/** Tab bar (bottom; a rail at the left in landscape): Map, List (needs-review badge), Inspector, Estimate, Docs (run dot). */
function TabBar({ active, onPick, vertical }: { active: string; onPick: (t: SheetTab) => void; vertical: boolean }) {
  const { counts } = useDerived();
  const phase = useStore((s) => s.extraction.phase);
  const running = useStore((s) => s.extraction.running);
  const runDot = running ? 'running' : phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : null;
  const list = useRef<HTMLDivElement>(null);
  // roving focus across the tabs (arrow keys along the bar, Home / End)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const btns = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    let n = -1;
    if (e.key === keys[1]) n = (i + 1) % btns.length; else if (e.key === keys[0]) n = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = btns.length - 1;
    if (n < 0) return;
    e.preventDefault(); btns[n].focus();
  };
  return (
    <nav className="m-tabbar" aria-label="Views">
      <div ref={list} className="m-tabbar__list" role="tablist" aria-label="Views" aria-orientation={vertical ? 'vertical' : 'horizontal'} onKeyDown={onKey}>
        {TABS.map((t) => {
          const on = active === t.id;
          // roving focus needs one focusable tab even while none is current (the Crews sheet)
          const focusable = on || (!TABS.some((x) => x.id === active) && t.id === 'map');
          const badge = t.id === 'list' && counts.needs > 0 ? (counts.needs > 99 ? '99+' : String(counts.needs)) : null;
          const label = t.id === 'list' && counts.needs ? `${t.label}, ${counts.needs} need review` : t.id === 'documents' && runDot ? `Documents, read ${runDot}` : t.id === 'documents' ? 'Documents' : t.label;
          return (
            <button key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={on} aria-controls={t.id === 'map' ? undefined : 'm-sheet'} aria-label={label} tabIndex={focusable ? 0 : -1}
              className={cx('m-tab', on && 'is-on')} onClick={() => onPick(t.id)}>
              <span className="m-tab__icon"><t.icon size={22} strokeWidth={1.75} aria-hidden />
                {badge && <span className="m-tab__badge" aria-hidden>{badge}</span>}
                {t.id === 'documents' && runDot && <span className={`rail__dot rail__dot--${runDot} m-tab__dot`} aria-hidden />}
              </span>
              <span className="m-tab__label" aria-hidden>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
