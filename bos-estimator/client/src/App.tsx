// App shell (UI spec §2.1): a full-bleed .stage holding the 3D Scene under an opaque, zoomable .chrome grid
// (top bar, rail, left panel, center = run strip / free rect / bottom panel, right panel, #portal).
// styles.css is imported first so tokens, primitives and the shell come before every feature stylesheet in the
// bundle (feature CSS can then override primitives at equal specificity).
import './styles.css';
import { lazy, memo, Suspense, useEffect, useRef } from 'react';
import { useStore } from './store';
import { DerivedContext, useComputeDerived } from './derived';
import { Scene } from './three/Scene';
import { TopBar } from './components/shell/TopBar';
import { Rail } from './components/shell/Rail';
import { LeftPanel, RightEdgeHandle, RightPanel } from './components/shell/Panels';
import { ShortcutsSheet } from './components/shell/ShortcutsSheet';
import { usePanelAutoRules, useInsetsWriter, useReducedMotionAttr, useUiZoomWriter } from './components/shell/layout';
import { chooseFiles } from './components/shell/fileChooser';
import { RunStrip } from './components/run/RunStrip';
import { TableView } from './components/table/TableView';
import { BottomPanel } from './components/bottom/BottomPanel';
import { ViewportOverlays } from './components/overlays/ViewportOverlays';
import { ConfirmHost, ToastHost } from './components/ui';
import { registerHotkey, pushEscape } from './components/lib/keys';

const FactorsDialog = lazy(() => import('./components/dialogs/FactorsDialog').then((m) => ({ default: m.FactorsDialog })));

// Test hook (spec §2.7): registered at module load so harnesses can reach the store before the first render.
type BosWindow = Window & { __bos?: Record<string, unknown> };
(window as BosWindow).__bos = Object.assign((window as BosWindow).__bos ?? {}, { store: useStore });

export default function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => { (window as BosWindow).__bos = Object.assign((window as BosWindow).__bos ?? {}, { store: useStore }); }, []);
  const derived = useComputeDerived();

  if (loading || loadError) {
    return (
      <div className="boot" role="status">
        <div className="boot__card"><div className="boot__logo">BOS</div><p>{loadError ? `Could not load the project: ${loadError}` : 'Loading estimate…'}</p></div>
      </div>
    );
  }
  return (
    <DerivedContext.Provider value={derived}>
      <Shell />
    </DerivedContext.Provider>
  );
}

const Stage = memo(function Stage() {
  return <div className="stage"><Scene /></div>;
});

const Shell = memo(function Shell() {
  const view = useStore((s) => s.view);
  const phase = useStore((s) => s.extraction.phase);
  const empty = useStore((s) => !s.project || s.project.inventory.facilities.length + s.project.inventory.grounds.length === 0);
  const lighting = useStore((s) => s.lighting);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const factorsOpen = useStore((s) => s.factorsOpen);
  const vpRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  useUiZoomWriter();
  useReducedMotionAttr();
  useInsetsWriter(vpRef, chromeRef);
  usePanelAutoRules();
  useGlobalHotkeys();

  return (
    <div className="app" data-view={view} data-phase={phase} data-empty={empty ? 'true' : 'false'} data-lighting={lighting}>
      <Stage />
      <div ref={chromeRef} className="chrome" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
        <TopBar />
        <Rail />
        <aside className="panel-left" aria-label="Inventory and documents" inert={!leftOpen}><LeftPanel /></aside>
        <section className="center" aria-label="Site">
          <RunStrip />
          <div ref={vpRef} className="vp-area">
            {view === 'table' && <TableView />}
            <ViewportOverlays />
            <RightEdgeHandle />
            <ToastHost />
          </div>
          <BottomPanel />
        </section>
        <aside className="panel-right" aria-label="Inspector and estimate" inert={!rightOpen}><RightPanel /></aside>
        <div id="portal" />
      </div>
      <ConfirmHost />
      <ShortcutsSheet />
      {factorsOpen && <Suspense fallback={null}><FactorsDialog /></Suspense>}
    </div>
  );
});

/** Global keys (UI spec §11). Feature-scoped keys are registered by their components. */
function useGlobalHotkeys() {
  useEffect(() => {
    const s = useStore.getState;
    const offs = [
      registerHotkey('1', () => s().setView('map'), { label: 'Map view', group: 'Everywhere' }),
      registerHotkey('2', () => s().setView('table'), { label: 'Table view', group: 'Everywhere' }),
      registerHotkey('[', () => s().setLeftOpen(!s().leftOpen), { label: 'Toggle the left panel', group: 'Everywhere' }),
      registerHotkey(']', () => s().setRightOpen(!s().rightOpen, { user: true }), { label: 'Toggle the right panel', group: 'Everywhere' }),
      registerHotkey('\\', () => s().setBottomOpen(!s().bottomOpen), { label: 'Collapse / expand the bottom panel', group: 'Everywhere' }),
      registerHotkey('?', () => s().setShortcutsOpen(true), { label: 'Keyboard shortcuts', group: 'Everywhere' }),
      registerHotkey('shift+m', () => s().setFactorsOpen(true), { label: 'RS Means factors', group: 'Everywhere' }),
      registerHotkey('mod+o', () => { if (!s().extraction.running) chooseFiles(); }, { label: 'Add documents', group: 'Everywhere', allowInInput: true }),
      registerHotkey('mod+enter', () => { const st = s(); if (st.pendingFiles.length && !st.extraction.running) void st.analyze(); else return false; }, { label: 'Analyze pending documents', group: 'Everywhere', allowInInput: true }),
      // Esc, lowest layers: clear the selection, then leave the building
      pushEscape(() => { const st = s(); if (st.selection.kind === null) return false; st.select({ kind: null }); return true; }, 'selection'),
      pushEscape(() => { const st = s(); if (st.focusMode !== 'building') return false; st.setFocusMode('site'); return true; }, 'base'),
    ];
    return () => { for (const off of offs) off(); };
  }, []);
}
