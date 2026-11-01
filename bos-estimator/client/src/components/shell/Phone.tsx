// Phone chrome (< 768 px, or a short landscape window): the 3D map full-bleed under a compact top bar (+ the run
// strip), one bottom sheet that re-hosts the existing tab contents, a tab bar (a rail beside the map in landscape)
// and, on the Map tab, the crew clock as a compact strip. The map's free rect (.vp-area, measured by the insets
// writer exactly like the desktop's) ends at the top of the sheet, capped at the half snap, so CameraRig frames the
// site in what stays visible; it follows the sheet while it is dragged.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BarChart3, Building2, FileStack, Map as MapIcon, Rows3 } from 'lucide-react';
import { useStore, type SheetSnap, type SheetTab } from '../../store';
import { useDerived } from '../../derived';
import { cx } from '../lib/cx';
import { ToastHost } from '../ui';
import { InventoryTab } from '../inventory/InventoryTab';
import { DocumentsTab } from '../documents/DocumentsTab';
import { Inspector } from '../inspector/Inspector';
import { EstimateTab } from '../estimate/EstimateTab';
import { BottomPanel, CrewMiniStrip } from '../bottom/BottomPanel';
import { RunStrip } from '../run/RunStrip';
import { ViewportOverlays } from '../overlays/ViewportOverlays';
import { BottomSheet, heightOf, useSheetSizes } from './BottomSheet';
import { MetricGrid, PhoneTopBar } from './TopBar';

const TABS: { id: SheetTab; label: string; icon: typeof Rows3 }[] = [
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'list', label: 'List', icon: Rows3 },
  { id: 'inspector', label: 'Inspector', icon: Building2 },
  { id: 'estimate', label: 'Estimate', icon: BarChart3 },
  { id: 'documents', label: 'Docs', icon: FileStack },
];
const TITLE: Record<string, string> = { list: 'Inventory', inspector: 'Inspector', estimate: 'Estimate', documents: 'Documents', crews: 'Crew clock' };
/** the snap a tab opens at from the Map tab */
const defaultSnap = (tab: SheetTab, selected: boolean): SheetSnap => (tab === 'inspector' && selected ? 'peek' : 'half');
const MINI_H = 56;

const useLandscape = () => {
  const read = () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
  const [l, setL] = useState(read);
  useEffect(() => { const on = () => setL(read()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return l;
};

export const PhoneChrome = memo(function PhoneChrome({ vpRef }: { vpRef: RefObject<HTMLDivElement | null> }) {
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const empty = useStore((s) => !s.project || s.project.inventory.facilities.length + s.project.inventory.grounds.length === 0);
  const landscape = useLandscape();
  const mainRef = useRef<HTMLDivElement>(null);
  const sizes = useSheetSizes(mainRef, landscape);
  const snap = sheet.tab === 'map' ? 'closed' : sheet.snap;
  const open = snap !== 'closed';
  const miniVisible = !open && !empty;
  // the tab whose content the sheet shows; kept while the sheet slides closed
  const [shown, setShown] = useState<string>(sheet.tab === 'map' ? 'list' : sheet.tab);
  useEffect(() => { if (sheet.tab !== 'map') setShown(sheet.tab); }, [sheet.tab]);

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

  const selected = useStore((s) => s.selection.kind !== null);
  const pick = (tab: SheetTab) => {
    const s = useStore.getState();
    if (tab === 'map') { s.setSheet({ tab: 'map', snap: 'closed' }); return; }
    if (s.sheet.tab === tab && s.sheet.snap !== 'closed') { s.setSheet({ tab: 'map', snap: 'closed' }); return; }
    s.setSheet({ tab, snap: s.sheet.snap !== 'closed' && s.sheet.tab !== 'map' ? s.sheet.snap : defaultSnap(tab, selected) });
  };

  return (
    <>
      <div className="m-head">
        <PhoneTopBar />
        <RunStrip />
      </div>
      <div ref={mainRef} className="m-main" data-sheet={snap}>
        <div ref={vpRef} className="vp-area">
          <ViewportOverlays />
        </div>
        {miniVisible && <CrewMiniStrip onExpand={() => setSheet({ tab: 'crews', snap: 'half' })} />}
        <BottomSheet id="m-sheet" snap={snap} sizes={sizes} onSnap={onSnap} onDrag={apply} label={`${TITLE[shown] ?? 'Panel'} sheet`} title={<SheetTitle tab={shown} />}>
          <SheetContent tab={shown} />
        </BottomSheet>
        <div className="m-toasts"><ToastHost /></div>
      </div>
      <TabBar active={sheet.tab === 'crews' ? 'map' : open ? sheet.tab : 'map'} onPick={pick} />
    </>
  );
});

function SheetTitle({ tab }: { tab: string }) {
  const { facById, groundsById, counts } = useDerived();
  const sel = useStore((s) => s.selection);
  let sub: string | null = null;
  if (tab === 'inspector' && sel.kind === 'facility') { const f = facById.get(sel.id); sub = f ? (f.buildingNumber || f.name) : null; }
  else if (tab === 'inspector' && sel.kind === 'grounds') sub = groundsById.get(sel.id)?.name ?? null;
  else if (tab === 'inspector') sub = 'Project summary';
  else if (tab === 'list' && counts.total) sub = `${counts.total.toLocaleString()} rows`;
  return <>{TITLE[tab] ?? ''}{sub && <span className="m-sheet__sub">{sub}</span>}</>;
}

const SheetContent = memo(function SheetContent({ tab }: { tab: string }) {
  switch (tab) {
    case 'list': return <div className="m-sheet__panel m-sheet__panel--list"><div className="m-sheet__lead" data-scroll-x=""><MetricGrid className="m-metrics--strip" /></div><InventoryTab /></div>;
    case 'inspector': return <div className="m-sheet__panel"><Inspector /></div>;
    case 'estimate': return <div className="m-sheet__panel"><EstimateTab lead={<MetricGrid className="m-metrics--grid" />} /></div>;
    case 'documents': return <div className="m-sheet__panel"><DocumentsTab /></div>;
    case 'crews': return <div className="m-sheet__panel"><BottomPanel variant="sheet" /></div>;
    default: return null;
  }
});

/** Tab bar (bottom; a rail at the left in landscape): Map, List (needs-review badge), Inspector, Estimate, Docs (run dot). */
function TabBar({ active, onPick }: { active: string; onPick: (t: SheetTab) => void }) {
  const { counts } = useDerived();
  const phase = useStore((s) => s.extraction.phase);
  const running = useStore((s) => s.extraction.running);
  const runDot = running ? 'running' : phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : null;
  return (
    <nav className="m-tabbar" aria-label="Views">
      <div className="m-tabbar__list" role="tablist" aria-label="Views" aria-orientation="horizontal">
        {TABS.map((t) => {
          const on = active === t.id;
          const badge = t.id === 'list' && counts.needs > 0 ? (counts.needs > 99 ? '99+' : String(counts.needs)) : null;
          const label = t.id === 'list' && counts.needs ? `${t.label}, ${counts.needs} need review` : t.id === 'documents' && runDot ? `Documents, read ${runDot}` : t.id === 'documents' ? 'Documents' : t.label;
          return (
            <button key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={on} aria-controls={t.id === 'map' ? undefined : 'm-sheet'} aria-label={label}
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
