import { create } from 'zustand';
import { api, runExtraction, type ExtractOptions, type Health } from './api';
import type { Assumptions, ExtractionEvent, Facility, GroundsArea, Inventory, Project } from '@shared/types';
import type { Crew } from '@shared/factors';

export interface LogEntry { kind: 'status' | 'text' | 'thinking' | 'tool' | 'error' | 'found'; text: string; t: number }
export type Selection = { kind: 'facility'; id: string } | { kind: 'grounds'; id: string } | { kind: null };

interface State {
  projectId: string;
  project: Project | null;
  health: Health | null;
  loading: boolean;
  saving: boolean;
  selection: Selection;
  focusMode: 'site' | 'building';
  buildingTab: 'interior' | 'grounds';
  crewFilter: Crew | null;
  selectedAgentId: string | null;
  factorsOpen: boolean;
  toast: string | null;
  extraction: { running: boolean; log: LogEntry[]; docs: { name: string; pages?: number; chars: number; mode: string }[]; recent: Record<string, number>; abort?: AbortController };
  sim: { playing: boolean; speed: number; time: number };

  init(): Promise<void>;
  setProjectName(name: string): void;
  patchInventory(fn: (inv: Inventory) => Inventory): void;
  updateFacility(id: string, patch: Partial<Facility>): void;
  removeFacility(id: string): void;
  addFacility(): void;
  updateGrounds(id: string, patch: Partial<GroundsArea>): void;
  removeGrounds(id: string): void;
  addGrounds(facilityId?: string): void;
  setFactorOverride(id: string, value: number | null): void;
  setAssumption<K extends keyof Assumptions>(key: K, value: Assumptions[K] | undefined): void;
  setAi(patch: Partial<Project['ai']>): void;
  setWage(crew: Crew, value: number | null): void;
  select(sel: Selection): void;
  setFocusMode(m: 'site' | 'building'): void;
  setBuildingTab(t: 'interior' | 'grounds'): void;
  setCrewFilter(c: Crew | null): void;
  setSelectedAgent(id: string | null): void;
  setFactorsOpen(v: boolean): void;
  setToast(t: string | null): void;
  startExtraction(o: Omit<ExtractOptions, 'projectId' | 'onEvent' | 'signal' | 'model' | 'effort'> & { model?: string; effort?: string }): Promise<void>;
  cancelExtraction(): void;
  clearProject(): Promise<void>;
  simSet(patch: Partial<State['sim']>): void;
  simTick(dtSeconds: number): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = get().project; if (!p || get().extraction.running) return;
      set({ saving: true });
      try { await api.saveProject(p); } finally { set({ saving: false }); }
    }, 700);
  };
  const mutateProject = (fn: (p: Project) => Project) => {
    const p = get().project; if (!p) return;
    set({ project: fn(p) });
    scheduleSave();
  };
  const log = (e: LogEntry) => set((s) => {
    const prev = s.extraction.log[s.extraction.log.length - 1];
    if (prev && (e.kind === 'text' || e.kind === 'thinking') && prev.kind === e.kind && e.t - prev.t < 3000) {
      return { extraction: { ...s.extraction, log: [...s.extraction.log.slice(0, -1), { ...prev, text: prev.text + e.text, t: e.t }] } };
    }
    return { extraction: { ...s.extraction, log: [...s.extraction.log.slice(-400), e] } };
  });

  return {
    projectId: 'default',
    project: null,
    health: null,
    loading: true,
    saving: false,
    selection: { kind: null },
    focusMode: 'site',
    buildingTab: 'interior',
    crewFilter: null,
    selectedAgentId: null,
    factorsOpen: false,
    toast: null,
    extraction: { running: false, log: [], docs: [], recent: {} },
    sim: { playing: true, speed: 12, time: 18.25 },

    async init() {
      const params = new URLSearchParams(location.search);
      const projectId = params.get('project') || 'default';
      set({ projectId, loading: true });
      const [health, project] = await Promise.all([api.health(), api.getProject(projectId)]);
      set({ health, project, loading: false });
    },
    setProjectName(name) { mutateProject((p) => ({ ...p, name })); },
    patchInventory(fn) { mutateProject((p) => ({ ...p, inventory: fn(p.inventory) })); },
    updateFacility(id, patch) { get().patchInventory((inv) => ({ ...inv, facilities: inv.facilities.map((f) => (f.id === id ? { ...f, ...patch } : f)) })); },
    removeFacility(id) {
      get().patchInventory((inv) => ({ ...inv, facilities: inv.facilities.filter((f) => f.id !== id), grounds: inv.grounds.map((g) => (g.facilityId === id ? { ...g, facilityId: undefined } : g)) }));
      if (get().selection.kind === 'facility' && (get().selection as { id: string }).id === id) set({ selection: { kind: null }, focusMode: 'site' });
    },
    addFacility() {
      const id = `b-manual-${Date.now().toString(36)}`;
      const f: Facility = { id, name: 'New facility', category: 'admin', grossSqft: 10000, floors: 1, serviceLevel: 'daily_5', scope: ['custodial', 'floor_care'], confidence: 1, notes: 'Added manually' };
      get().patchInventory((inv) => ({ ...inv, facilities: [...inv.facilities, f] }));
      set({ selection: { kind: 'facility', id }, focusMode: 'site' });
    },
    updateGrounds(id, patch) { get().patchInventory((inv) => ({ ...inv, grounds: inv.grounds.map((g) => (g.id === id ? { ...g, ...patch } : g)) })); },
    removeGrounds(id) {
      get().patchInventory((inv) => ({ ...inv, grounds: inv.grounds.filter((g) => g.id !== id) }));
      if (get().selection.kind === 'grounds' && (get().selection as { id: string }).id === id) set({ selection: { kind: null } });
    },
    addGrounds(facilityId) {
      const id = `g-manual-${Date.now().toString(36)}`;
      const g: GroundsArea = { id, name: facilityId ? 'Improved turf (manual)' : 'Improved turf', facilityId, kind: 'improved_turf', quantity: 5, unit: 'acres', confidence: 1, notes: 'Added manually' };
      get().patchInventory((inv) => ({ ...inv, grounds: [...inv.grounds, g] }));
      set({ selection: { kind: 'grounds', id } });
    },
    setFactorOverride(id, value) {
      mutateProject((p) => { const o = { ...(p.factorOverrides ?? {}) }; if (value == null || !isFinite(value)) delete o[id]; else o[id] = value; return { ...p, factorOverrides: o }; });
    },
    setAssumption(key, value) {
      mutateProject((p) => { const a = { ...(p.assumptionOverrides ?? {}) } as Record<string, unknown>; if (value === undefined || (typeof value === 'number' && !isFinite(value))) delete a[key]; else a[key] = value; return { ...p, assumptionOverrides: a as Partial<Assumptions> }; });
    },
    setAi(patch) { mutateProject((p) => ({ ...p, ai: { ...p.ai, ...patch } })); },
    setWage(crew, value) { mutateProject((p) => { const w = { ...(p.wages ?? {}) }; if (value == null || !isFinite(value)) delete w[crew]; else w[crew] = value; return { ...p, wages: w }; }); },
    select(sel) { set({ selection: sel, selectedAgentId: null, focusMode: sel.kind === 'facility' ? get().focusMode : 'site' }); },
    setFocusMode(m) { set({ focusMode: m }); },
    setBuildingTab(t) { set({ buildingTab: t }); },
    setCrewFilter(c) { set({ crewFilter: c }); },
    setSelectedAgent(id) { set({ selectedAgentId: id }); },
    setFactorsOpen(v) { set({ factorsOpen: v }); },
    setToast(t) { set({ toast: t }); if (t) setTimeout(() => { if (get().toast === t) set({ toast: null }); }, 5000); },

    async startExtraction(o) {
      const { projectId, project } = get();
      if (!project) return;
      const abort = new AbortController();
      const model = o.model ?? project.ai.model; const effort = o.effort ?? project.ai.effort;
      set((s) => ({
        extraction: { running: true, log: [{ kind: 'status', text: `Starting ${o.provider === 'heuristic' ? 'rule-based' : 'AI'} extraction…`, t: Date.now() }], docs: [], recent: {}, abort },
        project: o.mode === 'replace' ? { ...s.project!, inventory: { site: {}, facilities: [], grounds: [] } } : s.project,
        selection: { kind: null }, focusMode: 'site',
      }));
      const onEvent = (e: ExtractionEvent) => {
        switch (e.type) {
          case 'status': log({ kind: 'status', text: e.message, t: Date.now() }); break;
          case 'document': set((s) => ({ extraction: { ...s.extraction, docs: [...s.extraction.docs, { name: e.name, pages: e.pages, chars: e.chars, mode: e.mode }] } })); log({ kind: 'status', text: `Read ${e.name}: ${e.pages ? `${e.pages} pages, ` : ''}${e.chars.toLocaleString()} chars (${e.mode === 'native_pdf' ? 'native PDF → model reads tables & drawings' : 'text'})`, t: Date.now() }); break;
          case 'ai_text': log({ kind: e.kind === 'tool' ? 'tool' : e.kind === 'thinking' ? 'thinking' : 'text', text: e.text, t: Date.now() }); break;
          case 'facility': {
            set((s) => {
              const p = s.project!; const exists = p.inventory.facilities.some((f) => f.id === e.facility.id);
              const facilities = exists ? p.inventory.facilities.map((f) => (f.id === e.facility.id ? e.facility : f)) : [...p.inventory.facilities, e.facility];
              return { project: { ...p, inventory: { ...p.inventory, facilities } }, extraction: { ...s.extraction, recent: { ...s.extraction.recent, [e.facility.id]: Date.now() } } };
            });
            log({ kind: 'found', text: `＋ ${e.facility.buildingNumber ? `Bldg ${e.facility.buildingNumber} · ` : ''}${e.facility.name} — ${e.facility.grossSqft.toLocaleString()} SF${e.facility.cleanableSqft ? ` (${e.facility.cleanableSqft.toLocaleString()} cleanable)` : ''} · ${Math.round(e.facility.confidence * 100)}%`, t: Date.now() });
            break;
          }
          case 'grounds': {
            set((s) => { const p = s.project!; const exists = p.inventory.grounds.some((g) => g.id === e.area.id); return { project: { ...p, inventory: { ...p.inventory, grounds: exists ? p.inventory.grounds.map((g) => (g.id === e.area.id ? e.area : g)) : [...p.inventory.grounds, e.area] } }, extraction: { ...s.extraction, recent: { ...s.extraction.recent, [e.area.id]: Date.now() } } }; });
            log({ kind: 'found', text: `＋ ${e.area.name} — ${e.area.quantity.toLocaleString()} ${e.area.unit}`, t: Date.now() });
            break;
          }
          case 'site': set((s) => ({ project: { ...s.project!, inventory: { ...s.project!.inventory, site: { ...s.project!.inventory.site, ...e.site } } } })); log({ kind: 'status', text: `Site: ${[e.site.installationName, e.site.location, e.site.solicitation].filter(Boolean).join(' · ')}`, t: Date.now() }); break;
          case 'done':
            set((s) => ({ project: { ...s.project!, inventory: e.inventory, extraction: { provider: e.provider, model: e.model, finishedAt: new Date().toISOString(), durationMs: e.durationMs, usage: e.usage }, name: s.project!.name === 'Untitled BOS estimate' && e.inventory.site.installationName ? `${e.inventory.site.installationName} BOS` : s.project!.name } }));
            log({ kind: 'status', text: `Done in ${(e.durationMs / 1000).toFixed(1)}s via ${e.provider === 'claude' ? e.model : 'rule-based parser'}: ${e.inventory.facilities.length} facilities, ${e.inventory.grounds.length} grounds areas${e.usage ? ` · ${e.usage.input.toLocaleString()} in / ${e.usage.output.toLocaleString()} out tokens` : ''}`, t: Date.now() });
            break;
          case 'error': log({ kind: 'error', text: e.message, t: Date.now() }); get().setToast(e.message); break;
        }
      };
      try {
        await runExtraction({ ...o, projectId, model, effort, signal: abort.signal, onEvent });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') { log({ kind: 'error', text: (err as Error).message, t: Date.now() }); get().setToast((err as Error).message); }
      } finally {
        set((s) => ({ extraction: { ...s.extraction, running: false, abort: undefined } }));
        // reload authoritative project from server (it was saved there)
        try { const p = await api.getProject(projectId); set({ project: p }); } catch { /* keep local */ }
      }
    },
    cancelExtraction() { get().extraction.abort?.abort(); },
    async clearProject() {
      const p = await api.resetProject(get().projectId);
      set({ project: p, selection: { kind: null }, focusMode: 'site', extraction: { running: false, log: [], docs: [], recent: {} } });
    },
    simSet(patch) { set((s) => ({ sim: { ...s.sim, ...patch } })); },
    simTick(dt) {
      const s = get().sim; if (!s.playing) return;
      set({ sim: { ...s, time: (s.time + (dt * s.speed) / 60) % 24 } });
    },
  };
});
