import { create } from 'zustand';
import { api, runExtraction, type ExtractOptions, type Health } from './api';
import type { Assumptions, ExtractionEvent, Facility, GroundsArea, Inventory, PriorAward, Project, TopDownAssumptions } from '@shared/types';
import type { Crew } from '@shared/factors';

export interface LogEntry { kind: 'status' | 'text' | 'thinking' | 'tool' | 'error' | 'found' | 'warning'; text: string; t: number }
export type Selection = { kind: 'facility'; id: string } | { kind: 'grounds'; id: string } | { kind: null };

// ---------------- UI contract shared with the 3D scene (see the UI spec §2.4) ----------------
export type CenterView = 'map' | 'table';
export type ColorBy = 'category' | 'confidence' | 'review' | 'fte';
export type LabelMode = 'auto' | 'numbers' | 'off';
export type Lighting = 'review' | 'live';
export type RunPhase = 'idle' | 'uploading' | 'reading' | 'extracting' | 'merging' | 'crosscheck' | 'done' | 'failed' | 'cancelled';
export interface CamCmd { kind: 'fit-site' | 'frame-selection'; seq: number }
export type ReviewStatus = 'verified' | 'flagged';
export interface ReviewEntry { status: ReviewStatus; at: number; note?: string }
/** Project as the client keeps it: the server PUT merges unknown top-level keys, so review marks persist without a server change. */
export type ClientProject = Project & { review?: Record<string, ReviewEntry> };
export interface ExtractionDoc { name: string; pages?: number; chars: number; mode: string; kind?: string; role?: string; amendment?: number; scannedPages?: number[]; warnings?: string[] }
export interface ExtractionState {
  running: boolean;
  phase: RunPhase;
  mode: 'replace' | 'append' | null;
  log: LogEntry[];
  docs: ExtractionDoc[];
  /** id → ms timestamp when the reader found it */
  recent: Record<string, number>;
  /** newest first, at most 8 */
  recentIds: string[];
  progress: { registered: number; expected?: number; grounds: number };
  warnings: { message: string; file?: string; t: number }[];
  startedAt?: number;
  endedAt?: number;
  error?: string;
  staging: { active: boolean; seenIds: ReadonlySet<string>; incoming: Facility[]; incomingGrounds: GroundsArea[] };
  snapshot?: ClientProject;
  result?: { added: number; removed: number; changed: number; unchanged: number; changedIds: string[] };
  abort?: AbortController;
}
export const emptyExtraction = (): ExtractionState => ({
  running: false, phase: 'idle', mode: null, log: [], docs: [], recent: {}, recentIds: [],
  progress: { registered: 0, grounds: 0 }, warnings: [],
  staging: { active: false, seenIds: new Set(), incoming: [], incomingGrounds: [] },
});

const VIEW_KEY = 'bos.view.v1';
function loadViewPrefs(): { colorBy?: ColorBy; labelMode?: LabelMode; lighting?: Lighting } {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}'); return typeof v === 'object' && v ? v : {}; } catch { return {}; }
}
function saveViewPrefs(p: { colorBy: ColorBy; labelMode: LabelMode; lighting: Lighting }) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
const prefersReducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

interface State {
  projectId: string;
  project: ClientProject | null;
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
  autoOrbit: boolean;
  quality: 'high' | 'fast';
  topDownRunning: boolean;
  extraction: ExtractionState;
  sim: { playing: boolean; speed: number; time: number };
  // --- view contract (THREE reads these; only SHELL writes them) ---
  view: CenterView;
  colorBy: ColorBy;
  labelMode: LabelMode;
  lighting: Lighting;
  planView: boolean;
  focusFloor: number | null;
  reducedMotion: boolean;
  hoverId: string | null;
  /** ids matching the active inventory query; null when no query or chip is active */
  filterIds: ReadonlySet<string> | null;
  camCmd: CamCmd;
  layoutEpoch: number;

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
  setPriorAward(patch: Partial<PriorAward>): void;
  setTopDownOverride<K extends keyof TopDownAssumptions>(key: K, value: TopDownAssumptions[K] | undefined): void;
  clearTopDownOverrides(): void;
  runTopDown(provider?: 'auto' | 'claude' | 'heuristic'): Promise<void>;
  select(sel: Selection): void;
  setFocusMode(m: 'site' | 'building'): void;
  setBuildingTab(t: 'interior' | 'grounds'): void;
  setCrewFilter(c: Crew | null): void;
  setSelectedAgent(id: string | null): void;
  setFactorsOpen(v: boolean): void;
  setAutoOrbit(v: boolean): void;
  setQuality(q: 'high' | 'fast'): void;
  setToast(t: string | null): void;
  startExtraction(o: Omit<ExtractOptions, 'projectId' | 'onEvent' | 'signal' | 'model' | 'effort'> & { model?: string; effort?: string }): Promise<void>;
  cancelExtraction(): void;
  clearProject(): Promise<void>;
  simSet(patch: Partial<State['sim']>): void;
  simTick(dtSeconds: number): void;
  // --- view contract actions ---
  setHover(id: string | null): void;
  setView(v: CenterView): void;
  setColorBy(c: ColorBy): void;
  setLabelMode(m: LabelMode): void;
  setLighting(l: Lighting): void;
  setPlanView(v: boolean): void;
  setFocusFloor(f: number | null): void;
  setFilterIds(ids: ReadonlySet<string> | null): void;
  requestCamera(kind: CamCmd['kind']): void;
  relayout(): void;
  setReview(ids: string[], status: ReviewStatus | null, note?: string): void;
  restorePrevious(): Promise<void>;
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
    autoOrbit: false,
    topDownRunning: false,
    quality: (localStorage.getItem('bos.quality') as 'high' | 'fast') || 'high',
    extraction: emptyExtraction(),
    sim: { playing: true, speed: 12, time: 18.25 },
    view: 'map',
    colorBy: loadViewPrefs().colorBy ?? 'category',
    labelMode: loadViewPrefs().labelMode ?? 'auto',
    lighting: loadViewPrefs().lighting ?? 'review',
    planView: false,
    focusFloor: null,
    reducedMotion: prefersReducedMotion(),
    hoverId: null,
    filterIds: null,
    camCmd: { kind: 'fit-site', seq: 0 },
    layoutEpoch: 0,

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
    setPriorAward(patch) { mutateProject((p) => { const next = { ...(p.priorAward ?? {}), ...patch } as PriorAward; for (const k of Object.keys(next) as (keyof PriorAward)[]) if (next[k] === undefined || (next[k] as unknown) === '' || (typeof next[k] === 'number' && !isFinite(next[k] as number))) delete next[k]; return { ...p, priorAward: next }; }); },
    setTopDownOverride(key, value) { mutateProject((p) => { const o = { ...(p.topDownOverrides ?? {}) } as Record<string, unknown>; if (value === undefined || (typeof value === 'number' && !isFinite(value))) delete o[key]; else o[key] = value; return { ...p, topDownOverrides: o as Partial<TopDownAssumptions> }; }); },
    clearTopDownOverrides() { mutateProject((p) => ({ ...p, topDownOverrides: {} })); },
    async runTopDown(provider = 'auto') {
      const { projectId, project } = get(); if (!project) return;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      set({ topDownRunning: true });
      try {
        await api.saveProject(project);
        const topDown = await api.runTopDown(projectId, { provider, priorAward: project.priorAward, overrides: project.topDownOverrides });
        set((s) => ({ project: s.project ? { ...s.project, topDown } : s.project }));
      } catch (err) { get().setToast((err as Error).message); }
      finally { set({ topDownRunning: false }); }
    },
    setWage(crew, value) { mutateProject((p) => { const w = { ...(p.wages ?? {}) }; if (value == null || !isFinite(value)) delete w[crew]; else w[crew] = value; return { ...p, wages: w }; }); },
    select(sel) { set({ selection: sel, selectedAgentId: null, focusMode: sel.kind === 'facility' ? get().focusMode : 'site' }); },
    setFocusMode(m) { set({ focusMode: m }); },
    setBuildingTab(t) { set({ buildingTab: t }); },
    setCrewFilter(c) { set({ crewFilter: c }); },
    setSelectedAgent(id) { set({ selectedAgentId: id }); },
    setFactorsOpen(v) { set({ factorsOpen: v }); },
    setAutoOrbit(v) { set({ autoOrbit: v }); },
    setQuality(q) { try { localStorage.setItem('bos.quality', q); } catch { /* ignore */ } set({ quality: q }); },
    setToast(t) { set({ toast: t }); if (t) setTimeout(() => { if (get().toast === t) set({ toast: null }); }, 5000); },

    async startExtraction(o) {
      const { projectId, project } = get();
      if (!project) return;
      const abort = new AbortController();
      const model = o.model ?? project.ai.model; const effort = o.effort ?? project.ai.effort;
      set((s) => ({
        extraction: { ...emptyExtraction(), running: true, phase: 'uploading', mode: o.mode, startedAt: Date.now(), log: [{ kind: 'status', text: `Starting ${o.provider === 'heuristic' ? 'rule-based' : 'AI'} extraction…`, t: Date.now() }], abort },
        project: o.mode === 'replace' ? { ...s.project!, inventory: { site: {}, facilities: [], grounds: [] } } : s.project,
        selection: { kind: null }, focusMode: 'site',
      }));
      const onEvent = (e: ExtractionEvent) => {
        switch (e.type) {
          case 'status': log({ kind: 'status', text: e.message, t: Date.now() }); break;
          case 'document': set((s) => ({ extraction: { ...s.extraction, phase: 'reading', docs: [...s.extraction.docs, { name: e.name, pages: e.pages, chars: e.chars, mode: e.mode, kind: e.kind, role: e.role, amendment: e.amendment, scannedPages: e.scannedPages, warnings: e.warnings }] } })); log({ kind: 'status', text: `Read ${e.name}: ${e.pages ? `${e.pages} pages, ` : ''}${e.chars.toLocaleString()} chars (${e.mode === 'native_pdf' ? 'native PDF → model reads tables & drawings' : 'text'})`, t: Date.now() }); break;
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
          case 'prior_award':
            set((s) => ({ project: { ...s.project!, priorAward: e.award } }));
            log({ kind: 'found', text: `＄ Previous award: ${[e.award.incumbent, e.award.contractNumber].filter(Boolean).join(' · ') || 'facts'}${e.award.totalValue ? ` · $${e.award.totalValue.toLocaleString()} / ${e.award.periodMonths ?? '?'} mo` : ''}${e.award.spendToDate ? ` · spend $${e.award.spendToDate.toLocaleString()}` : ''}${e.award.annualValue ? ` · $${e.award.annualValue.toLocaleString()}/yr` : ''}`, t: Date.now() });
            break;
          case 'topdown':
            set((s) => ({ project: { ...s.project!, topDown: e.topDown } }));
            log({ kind: 'status', text: e.topDown.impliedFte.base > 0 ? `Top-down: ${e.topDown.impliedFte.base} FTE implied from ${e.topDown.basis} basis ($${e.topDown.annualValue.toLocaleString()}/yr at $${e.topDown.assumptions.loadedCostPerFte.toLocaleString()}/FTE, ${Math.round(e.topDown.assumptions.odcMaterialsPct * 100)}% ODC) vs ${e.topDown.bottomUpFte} bottom-up` : 'Top-down: assumptions ready, award value still needed to back into FTEs', t: Date.now() });
            break;
          case 'done':
            set((s) => ({ project: { ...s.project!, inventory: e.inventory, extraction: { provider: e.provider, model: e.model, finishedAt: new Date().toISOString(), durationMs: e.durationMs, usage: e.usage }, name: s.project!.name === 'Untitled BOS estimate' && e.inventory.site.installationName ? `${e.inventory.site.installationName} BOS` : s.project!.name } }));
            log({ kind: 'status', text: `Done in ${(e.durationMs / 1000).toFixed(1)}s via ${e.provider === 'claude' ? e.model : 'rule-based parser'}: ${e.inventory.facilities.length} facilities, ${e.inventory.grounds.length} grounds areas${e.usage ? ` · ${e.usage.input.toLocaleString()} in / ${e.usage.output.toLocaleString()} out tokens` : ''}`, t: Date.now() });
            break;
          case 'error': set((s) => ({ extraction: { ...s.extraction, phase: 'failed', error: e.message } })); log({ kind: 'error', text: e.message, t: Date.now() }); get().setToast(e.message); break;
          case 'warning': set((s) => ({ extraction: { ...s.extraction, warnings: [...s.extraction.warnings, { message: e.message, file: e.file, t: Date.now() }] } })); log({ kind: 'warning', text: `${e.file ? `${e.file}: ` : ''}${e.message}`, t: Date.now() }); break;
          case 'progress': set((s) => ({ extraction: { ...s.extraction, phase: s.extraction.phase === 'reading' || s.extraction.phase === 'uploading' ? 'extracting' : s.extraction.phase, progress: { registered: e.registered, expected: e.expected ?? s.extraction.progress.expected, grounds: e.grounds ?? s.extraction.progress.grounds } } })); break;
        }
      };
      try {
        await runExtraction({ ...o, projectId, model, effort, signal: abort.signal, onEvent });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') { log({ kind: 'error', text: (err as Error).message, t: Date.now() }); get().setToast((err as Error).message); }
      } finally {
        set((s) => ({ extraction: { ...s.extraction, running: false, abort: undefined, endedAt: Date.now(), phase: s.extraction.phase === 'failed' ? 'failed' : abort.signal.aborted ? 'cancelled' : 'done' } }));
        // reload authoritative project from server (it was saved there)
        try { const p = await api.getProject(projectId); set({ project: p }); } catch { /* keep local */ }
      }
    },
    cancelExtraction() { get().extraction.abort?.abort(); },
    async clearProject() {
      const p = await api.resetProject(get().projectId);
      set({ project: p, selection: { kind: null }, focusMode: 'site', extraction: emptyExtraction() });
    },
    simSet(patch) { set((s) => ({ sim: { ...s.sim, ...patch } })); },
    setHover(id) { if (get().hoverId !== id) set({ hoverId: id }); },
    setView(v) { set({ view: v }); },
    setColorBy(c) { set({ colorBy: c }); const s = get(); saveViewPrefs({ colorBy: c, labelMode: s.labelMode, lighting: s.lighting }); },
    setLabelMode(m) { set({ labelMode: m }); const s = get(); saveViewPrefs({ colorBy: s.colorBy, labelMode: m, lighting: s.lighting }); },
    setLighting(l) { set({ lighting: l }); const s = get(); saveViewPrefs({ colorBy: s.colorBy, labelMode: s.labelMode, lighting: l }); },
    setPlanView(v) { set({ planView: v }); },
    setFocusFloor(f) { set({ focusFloor: f }); },
    setFilterIds(ids) { set({ filterIds: ids }); },
    requestCamera(kind) { set((s) => ({ camCmd: { kind, seq: s.camCmd.seq + 1 } })); },
    relayout() { set((s) => ({ layoutEpoch: s.layoutEpoch + 1 })); get().requestCamera('fit-site'); },
    setReview(ids, status, note) {
      mutateProject((p) => {
        const review = { ...(((p as ClientProject).review) ?? {}) };
        for (const id of ids) { if (status) review[id] = { status, at: Date.now(), note }; else delete review[id]; }
        return { ...p, review } as ClientProject;
      });
    },
    async restorePrevious() {
      const snap = get().extraction.snapshot; if (!snap) return;
      const saved = await api.saveProject(snap);
      set({ project: saved as ClientProject, extraction: { ...get().extraction, snapshot: undefined, result: undefined } });
    },
    simTick(dt) {
      const s = get().sim; if (!s.playing) return;
      set({ sim: { ...s, time: (s.time + (dt * s.speed) / 60) % 24 } });
    },
  };
});
