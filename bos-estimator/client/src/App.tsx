import { useEffect, useMemo } from 'react';
import { useStore } from './store';
import { DerivedContext, EMPTY_DERIVED, type Derived, type RowMeta } from './derived';
import { confBand, REVIEW_CONF_THRESHOLD } from './components/lib/theme';
import { isInScope } from '@shared/types';
import { estimateInventory } from '@shared/estimate';
import { CREWS } from '@shared/factors';
import { computeLayout, ZONE_COLORS, ZONE_LABELS } from './three/layout';
import { buildRoster } from './three/sim';
import { Scene } from './three/Scene';
import { TopBar } from './components/TopBar';
import { IngestPanel } from './components/IngestPanel';
import { FacilityList } from './components/FacilityList';
import { DetailPanel } from './components/DetailPanel';
import { LiveBoard } from './components/LiveBoard';
import { FactorsModal } from './components/FactorsModal';

export default function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const setBuildingTab = useStore((s) => s.setBuildingTab);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const autoOrbit = useStore((s) => s.autoOrbit);
  const setAutoOrbit = useStore((s) => s.setAutoOrbit);
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  useEffect(() => { void init(); }, [init]);

  const inventory = project?.inventory;
  const assumptions = project?.assumptionOverrides;
  const overrides = project?.factorOverrides;
  const wages = project?.wages;
  const review = project?.review;
  const derived = useMemo<Derived>(() => {
    if (!inventory) return EMPTY_DERIVED;
    const est = estimateInventory(inventory, assumptions ?? {}, overrides, wages as never);
    const layout = computeLayout(est.facilities.map((f) => f.resolved), inventory.grounds);
    const roster = buildRoster(est, layout);
    const estById = new Map(est.facilities.map((e) => [e.facilityId, e]));
    const gestById = new Map(est.grounds.map((g) => [g.areaId, g]));
    const rowMeta = new Map<string, RowMeta>();
    for (const f of inventory.facilities) {
      const r = review?.[f.id]?.status;
      rowMeta.set(f.id, { conf: confBand(f.confidence), review: r ?? (f.confidence < REVIEW_CONF_THRESHOLD || !f.grossSqft ? 'needs' : 'ok'), issues: [], inScope: isInScope(f), edited: false });
    }
    for (const g of inventory.grounds) rowMeta.set(g.id, { conf: confBand(g.confidence), review: review?.[g.id]?.status ?? (g.confidence < REVIEW_CONF_THRESHOLD ? 'needs' : 'ok'), issues: [], inScope: true, edited: false });
    const ftes = est.facilities.map((e) => e.fte).sort((a, b) => a - b);
    const q = (p: number) => (ftes.length ? ftes[Math.min(ftes.length - 1, Math.floor(p * ftes.length))] : 0);
    const fteBreaks: Derived['fteBreaks'] = ftes.length >= 5 ? [q(0.2), q(0.4), q(0.6), q(0.8)] : [0.5, 1, 2, 4];
    return { est, estById, gestById, layout, layoutRev: 0, estRev: 0, roster, rowMeta, fteBreaks };
  }, [inventory, assumptions, overrides, wages, review]);
  useEffect(() => { (window as unknown as { __bos?: Record<string, unknown> }).__bos = Object.assign((window as unknown as { __bos?: Record<string, unknown> }).__bos ?? {}, { store: useStore }); }, []);

  if (loading) return <div className="loading"><div><div className="logo">BOS</div><p>Loading estimate…</p></div></div>;

  return (
    <DerivedContext.Provider value={derived}>
      <div className="app">
        <main className="viewport"><Scene /></main>
        <TopBar />
        <aside className="panel left glass">
          <IngestPanel />
          <FacilityList />
        </aside>
        <div className="overlay view-toggle">
          <button className={`btn ${focusMode === 'site' ? 'on' : ''}`} onClick={() => setFocusMode('site')}>Site</button>
          <button className={`btn ${focusMode === 'building' ? 'on' : ''}`} disabled={selection.kind !== 'facility'} onClick={() => setFocusMode('building')} title={selection.kind === 'facility' ? 'Cut-away view of the selected building' : 'Select a building first'}>Inside building</button>
          {focusMode === 'building' && (
            <div className="pill-toggle">
              <button className={buildingTab === 'interior' ? 'on' : ''} onClick={() => setBuildingTab('interior')}>Interior crews</button>
              <button className={buildingTab === 'grounds' ? 'on' : ''} onClick={() => setBuildingTab('grounds')}>Grounds crews</button>
            </div>
          )}
          {selection.kind !== null && <button className="btn" onClick={() => { select({ kind: null }); setFocusMode('site'); }}>Clear</button>}
          <button className={`btn ${autoOrbit ? 'on' : ''}`} onClick={() => setAutoOrbit(!autoOrbit)} title="Slowly orbit the site when idle">◌ Orbit</button>
          <button className="btn" onClick={() => setQuality(quality === 'high' ? 'fast' : 'high')} title="Toggle bloom and anti-aliasing">{quality === 'high' ? '✦ Cinematic' : '⚡ Fast'}</button>
        </div>
        <div className="hint">drag · orbit &nbsp;·&nbsp; wheel · zoom &nbsp;·&nbsp; click building or crew member &nbsp;·&nbsp; double-click · enter building</div>
        <div className="overlay legend glass">
          <div className="ttl">Crews</div>
          {CREWS.map((c) => <div className="row" key={c.id}><span className="sw" style={{ background: c.color, color: c.color, borderRadius: '50%' }} />{c.short}</div>)}
          <div className="ttl" style={{ marginTop: 6 }}>Grounds</div>
          {(['improved_turf', 'semi_improved', 'unimproved', 'athletic_field', 'shrub_bed', 'parking', 'sidewalk'] as const).map((k) => <div className="row" key={k}><span className="sw" style={{ background: ZONE_COLORS[k], color: 'transparent' }} />{ZONE_LABELS[k]}</div>)}
        </div>
        <LiveBoard />
        {toast && <div className="toast glass">{toast}</div>}
        <aside className="panel right glass scroll">
          <DetailPanel />
        </aside>
        <FactorsModal />
      </div>
    </DerivedContext.Provider>
  );
}
