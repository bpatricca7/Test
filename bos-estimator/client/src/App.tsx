import { useEffect, useMemo } from 'react';
import { useStore } from './store';
import { DerivedContext, type Derived } from './derived';
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
  useEffect(() => { void init(); }, [init]);

  const inventory = project?.inventory;
  const assumptions = project?.assumptionOverrides;
  const overrides = project?.factorOverrides;
  const wages = project?.wages;
  const derived = useMemo<Derived>(() => {
    if (!inventory) return { est: null, layout: null, roster: [] };
    const est = estimateInventory(inventory, assumptions ?? {}, overrides, wages as never);
    const layout = computeLayout(est.facilities.map((f) => f.resolved), inventory.grounds);
    const roster = buildRoster(est, layout);
    return { est, layout, roster };
  }, [inventory, assumptions, overrides, wages]);

  if (loading) return <div className="empty" style={{ paddingTop: 120 }}>Loading project…</div>;

  return (
    <DerivedContext.Provider value={derived}>
      <div className="app">
        <TopBar />
        <aside className="panel">
          <IngestPanel />
          <FacilityList />
        </aside>
        <main className="viewport">
          <Scene />
          <div className="overlay view-toggle">
            <button className={`btn ${focusMode === 'site' ? 'on' : ''}`} onClick={() => { setFocusMode('site'); }}>Site</button>
            <button className={`btn ${focusMode === 'building' ? 'on' : ''}`} disabled={selection.kind !== 'facility'} onClick={() => setFocusMode('building')} title={selection.kind === 'facility' ? 'Cut-away view of the selected building' : 'Select a building first'}>Inside building</button>
            {focusMode === 'building' && (
              <div className="pill-toggle" style={{ background: 'var(--panel)' }}>
                <button className={buildingTab === 'interior' ? 'on' : ''} onClick={() => setBuildingTab('interior')}>Interior crews</button>
                <button className={buildingTab === 'grounds' ? 'on' : ''} onClick={() => setBuildingTab('grounds')}>Grounds crews</button>
              </div>
            )}
            {selection.kind !== null && <button className="btn" onClick={() => { select({ kind: null }); setFocusMode('site'); }}>Clear selection</button>}
          </div>
          <div className="overlay legend">
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Crews</div>
            {CREWS.map((c) => <div className="row" key={c.id}><span className="sw" style={{ background: c.color, borderRadius: '50%' }} />{c.short}</div>)}
            <div style={{ fontWeight: 600, margin: '6px 0 2px' }}>Grounds</div>
            {(['improved_turf', 'semi_improved', 'unimproved', 'athletic_field', 'shrub_bed', 'parking', 'sidewalk'] as const).map((k) => <div className="row" key={k}><span className="sw" style={{ background: ZONE_COLORS[k] }} />{ZONE_LABELS[k]}</div>)}
          </div>
          <LiveBoard />
          <div className="hint">drag · orbit &nbsp;|&nbsp; wheel · zoom &nbsp;|&nbsp; click building / crew member &nbsp;|&nbsp; double-click · enter building</div>
          {toast && <div className="toast">{toast}</div>}
        </main>
        <aside className="panel right scroll">
          <DetailPanel />
        </aside>
        <FactorsModal />
      </div>
    </DerivedContext.Provider>
  );
}
