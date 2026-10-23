import { create } from 'zustand';
import { api, runExtraction, type ExtractOptions, type Health } from './api';
import type { Assumptions, ExtractionEvent, Facility, GroundsArea, Inventory, PriorAward, Project, TopDownAssumptions } from '@shared/types';
import type { Crew } from '@shared/factors';
import { changedFields, isManualRow, revertPatch, withEditMarkers, type ReviewEntry, type ReviewMap, type ReviewStatus } from './components/lib/review';
import { diffInventories, handEditedRows, mergeHandEdits, overlayHandEdits, restoreRows, withHandValues } from './components/lib/runMerge';
import { ACCEPT, isAccepted, skipReason } from './components/lib/files';
import type { ConfirmOptions } from './components/ui/Dialog';

export type { ReviewEntry, ReviewStatus } from './components/lib/review';

export interface LogEntry { kind: 'status' | 'text' | 'thinking' | 'tool' | 'error' | 'found' | 'warning'; text: string; t: number }
export type Selection = { kind: 'facility'; id: string } | { kind: 'grounds'; id: string } | { kind: null };

// ---------------- UI contract shared with the 3D scene (see the UI spec §2.4) ----------------
export type CenterView = 'map' | 'table';
export type ColorBy = 'category' | 'confidence' | 'review' | 'fte';
export type LabelMode = 'auto' | 'numbers' | 'off';
export type Lighting = 'review' | 'live';
export type RunPhase = 'idle' | 'uploading' | 'reading' | 'extracting' | 'merging' | 'crosscheck' | 'done' | 'failed' | 'cancelled';
export interface CamCmd { kind: 'fit-site' | 'frame-selection'; seq: number }
/** Project as the client keeps it: the server PUT merges unknown top-level keys, so review marks persist without a server change. */
export type ClientProject = Project & { review?: ReviewMap };
export interface ExtractionDoc { name: string; pages?: number; chars: number; mode: string; kind?: string; role?: string; amendment?: number; scannedPages?: number[]; warnings?: string[] }
export interface RunResult {
  added: number; removed: number; changed: number; unchanged: number; changedIds: string[];
  /** SHELL: rows whose hand edits were put back onto the re-read rows */
  kept?: number;
  /** SHELL: rows flagged because the re-read changed a field that was edited by hand */
  conflicts?: number;
  /** SHELL: verified rows the re-read changed, back to unreviewed (§6.3 P1) */
  unverified?: number;
}
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
  /** the project as it was before the run */
  snapshot?: ClientProject;
  result?: RunResult;
  abort?: AbortController;
  /** SHELL-only: the run started on a populated inventory, or a failed run left it different, so [Restore previous] applies */
  restorable?: boolean;
  /** SHELL-only: inventory size when the run started */
  startCount?: number;
  /** SHELL-only: distinct facility and grounds rows this run's reader streamed (0: the read found nothing) */
  found?: number;
  /** SHELL-only: the `at` the done merge wrote on the review entries it changed, and those entries as they were */
  mergeAt?: number;
  mergeBefore?: Record<string, ReviewEntry | undefined>;
}
const emptyStaging = (): ExtractionState['staging'] => ({ active: false, seenIds: new Set(), incoming: [], incomingGrounds: [] });
export const emptyExtraction = (): ExtractionState => ({
  running: false, phase: 'idle', mode: null, log: [], docs: [], recent: {}, recentIds: [],
  progress: { registered: 0, grounds: 0 }, warnings: [], staging: emptyStaging(),
});

// ---------------- SHELL-only UI state (THREE must not read these) ----------------
export type LeftTab = 'inventory' | 'documents';
export type RightTab = 'inspector' | 'estimate';
export type BottomTab = 'crews' | 'log';
export type UiZoom = 'auto' | 0.9 | 1 | 1.125 | 1.25;
export type QueryChip = 'all' | 'needs' | 'flagged' | 'out' | 'incoming' | 'edited' | 'changed';
export type SortKey = 'source' | 'impact' | 'bldg' | 'name' | 'gross' | 'fte' | 'conf';
/** Shared by the rail list and the table (UI spec §5.3); components/lib/query.ts interprets it. */
export interface InventoryQuery { text: string; chip: QueryChip; sort: SortKey; desc: boolean; tableTab: 'facilities' | 'grounds' }
export type LogFilter = 'all' | 'found' | 'warnings' | 'errors' | 'text' | 'status';
export interface ToastItem { id: number; text: string; tone?: 'info' | 'ok' | 'warn' | 'error'; action?: { label: string; run: () => void }; ttl?: number }
export interface ConfirmRequest extends ConfirmOptions { id: number; resolve: (v: string | null) => void }
export interface ReaderSettings { provider: 'auto' | 'claude' | 'heuristic'; ingest: 'auto' | 'native_pdf' | 'text'; mode: 'replace' | 'append' }
export type StartOptions = Omit<ExtractOptions, 'projectId' | 'onEvent' | 'signal' | 'model' | 'effort' | 'onResponse'> & { model?: string; effort?: string };

// ---------------- persistence (every access wrapped; spec §1) ----------------
const VIEW_KEY = 'bos.view.v1';
const UI_KEY = 'bos.ui.v1';
function readJson(key: string): Record<string, unknown> {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '{}'); return typeof v === 'object' && v ? v as Record<string, unknown> : {}; } catch { return {}; }
}
function writeJson(key: string, patch: Record<string, unknown>) {
  try { localStorage.setItem(key, JSON.stringify({ ...readJson(key), ...patch })); } catch { /* storage unavailable */ }
}
const viewPrefs = readJson(VIEW_KEY) as { colorBy?: ColorBy; labelMode?: LabelMode; lighting?: Lighting };
const uiPrefs = readJson(UI_KEY) as { uiZoom?: UiZoom; sections?: Record<string, boolean>; reducedMotion?: boolean | null };
const ZOOMS: UiZoom[] = ['auto', 0.9, 1, 1.125, 1.25];
const mediaReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const readQuality = (): 'high' | 'fast' => { try { return localStorage.getItem('bos.quality') === 'fast' ? 'fast' : 'high'; } catch { return 'high'; } };
const innerH = () => (typeof window === 'undefined' ? 900 : window.innerHeight);

// ---------------- run helpers ----------------
const PHASE_ORDER: Record<RunPhase, number> = { idle: 0, uploading: 1, reading: 2, extracting: 3, merging: 4, crosscheck: 5, done: 6, failed: 7, cancelled: 7 };
const terminal = (p: RunPhase) => p === 'done' || p === 'failed' || p === 'cancelled';

/** Whether a patch changes any field of the row (objects and arrays compared by value). */
function changes(row: object, patch: object): boolean {
  const r = row as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const before = r[k];
    if (before === v || ((before ?? null) === null && (v ?? null) === null)) continue;
    if (typeof v === 'object' && v !== null && typeof before === 'object' && before !== null && JSON.stringify(before) === JSON.stringify(v)) continue;
    return true;
  }
  return false;
}

const sameInventory = (a: Inventory, b: Inventory) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
const fmtFound = (f: Facility) => `＋ ${f.buildingNumber ? `Bldg ${f.buildingNumber} · ` : ''}${f.name} — ${f.grossSqft.toLocaleString()} SF${f.cleanableSqft ? ` (${f.cleanableSqft.toLocaleString()} cleanable)` : ''} · ${Math.round(f.confidence * 100)}%`;

interface State {
  projectId: string;
  project: ClientProject | null;
  health: Health | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  /** last save failure, shown as "Not saved · Retry" */
  saveError: string | null;
  selection: Selection;
  focusMode: 'site' | 'building';
  buildingTab: 'interior' | 'grounds';
  crewFilter: Crew | null;
  selectedAgentId: string | null;
  factorsOpen: boolean;
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
  // --- SHELL-only ---
  leftOpen: boolean;
  leftTab: LeftTab;
  /** left panel state to restore when leaving Table view */
  leftBeforeTable: boolean | null;
  rightOpen: boolean;
  rightTab: RightTab;
  /** the user collapsed the right panel; auto-open rules leave it alone */
  rightUserCollapsed: boolean;
  /** dock expanded (112) vs collapsed (36); whether it shows at all is derived (hidden while empty and in Table view) */
  bottomOpen: boolean;
  bottomTab: BottomTab;
  /** the user touched the bottom panel during the current run (then it does not switch back to Crews at done) */
  bottomTouched: boolean;
  uiZoom: UiZoom;
  /** user override for reduced motion (null = follow the OS) */
  reducedMotionPref: boolean | null;
  /** collapsed state of named sections (Inspector etc.), persisted in bos.ui.v1 */
  uiSections: Record<string, boolean>;
  query: InventoryQuery;
  logFilter: LogFilter;
  /** request to scroll the Estimate tab to a section; seq increments per request */
  estimateFocus: { section: string; seq: number } | null;
  shortcutsOpen: boolean;
  toasts: ToastItem[];
  confirms: ConfirmRequest[];
  /** files waiting for Analyze (Documents tab, empty card, drop overlay) */
  pendingFiles: File[];
  pendingSkipped: { name: string; reason: string }[];
  reader: ReaderSettings;

  init(): Promise<void>;
  setProjectName(name: string): void;
  patchInventory(fn: (inv: Inventory) => Inventory): void;
  /** Edits record edited markers (§6.3 P1: field → extracted value) in the same store write; no-op patches write nothing. */
  updateFacility(id: string, patch: Partial<Facility>): void;
  removeFacility(id: string): void;
  addFacility(): void;
  updateGrounds(id: string, patch: Partial<GroundsArea>): void;
  removeGrounds(id: string): void;
  addGrounds(facilityId?: string): void;
  /** Per-row patches for many rows (bulk actions, TSV paste) with their edited markers: one store write. Returns the rows changed. */
  updateRows(facilities: ReadonlyMap<string, Partial<Facility>>, grounds?: ReadonlyMap<string, Partial<GroundsArea>>): number;
  /** Remove facilities and grounds areas in one write; grounds attached to a removed building become site-wide. */
  removeRows(ids: readonly string[]): void;
  /** R: put the given edited fields (default: every edited field of the row) back to the extracted values. */
  revertEdits(id: string, paths?: readonly string[]): boolean;
  /** Undo / redo: replace the inventory and the review marks in one write (drops a selection that no longer exists). */
  restoreDoc(doc: { inventory: Inventory; review: ReviewMap | undefined }): void;
  setFactorOverride(id: string, value: number | null): void;
  /** Several factor overrides in one write (null removes one): reset all, bulk paste. */
  setFactorOverrides(patch: Record<string, number | null>): void;
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
  /** compat: pushes a plain toast */
  setToast(t: string | null): void;
  /** §7: snapshot, staging, 250 ms coalescing, post-run merge. Prefer analyze(), which asks before replacing. */
  startExtraction(o: StartOptions): Promise<void>;
  cancelExtraction(): void;
  /** Analyze the pending files (or the built-in sample) with the reader settings; confirms Replace on a populated project. */
  analyze(opts?: { sample?: boolean }): Promise<void>;
  /** Re-run the last read with the same files and settings. */
  retryExtraction(): Promise<void>;
  /** Hide the run strip after done / failed / cancelled. */
  dismissRun(): void;
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
  /** status null (or 'unreviewed') clears the mark; one store write and one save for any number of ids */
  setReview(ids: string[], status: ReviewStatus | null, note?: string): void;
  restorePrevious(): Promise<void>;
  // --- SHELL-only actions ---
  setLeftOpen(v: boolean): void;
  setLeftTab(t: LeftTab): void;
  /** open the left panel on a tab */
  openLeft(t: LeftTab): void;
  setRightOpen(v: boolean, opts?: { user?: boolean }): void;
  setRightTab(t: RightTab): void;
  openRight(t: RightTab): void;
  /** open the Estimate tab and ask it to scroll to a section (e.g. 'crosscheck') */
  openEstimate(section?: string): void;
  /** `auto` (minimum free rect, run start) does not count as the user touching the panel */
  setBottomOpen(v: boolean, opts?: { auto?: boolean }): void;
  setBottomTab(t: BottomTab): void;
  /** open the bottom panel on the Log tab with a filter */
  openLog(filter?: LogFilter): void;
  setLogFilter(f: LogFilter): void;
  setUiZoom(z: UiZoom): void;
  setReducedMotionPref(v: boolean | null): void;
  setUiSection(id: string, collapsed: boolean): void;
  setQuery(patch: Partial<InventoryQuery>): void;
  setShortcutsOpen(v: boolean): void;
  pushToast(t: Omit<ToastItem, 'id'>): number;
  dismissToast(id: number): void;
  /** ConfirmDialog as a promise: resolves with the chosen action id, or null on cancel / Esc */
  confirm(opts: ConfirmOptions): Promise<string | null>;
  resolveConfirm(id: number, value: string | null): void;
  addPendingFiles(files: File[] | FileList): void;
  removePendingFile(f: File): void;
  clearPending(): void;
  clearSkipped(): void;
  setReader(patch: Partial<ReaderSettings>): void;
  /** flush the debounced save now; resolves false when the PUT failed */
  saveNow(): Promise<boolean>;
  retrySave(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** bumps on every local project edit; a save clears `dirty` only if nothing changed while it was in flight */
let editVersion = 0;
let savedVersion = 0;
let toastSeq = 0;
let confirmSeq = 0;
let lastRun: StartOptions | null = null;
/** the post-run reconcile (save of the merged rows, reload) is in flight; it saves any edit made meanwhile */
let reconciling = false;
/** updatedAt of the last server copy loaded or saved (the base of the unsaved-changes journal) */
let serverStamp: string | null = null;

// ---------------- unsaved-changes journal (A9): edits survive a reload or close that beats the debounced save ----------------
// On pagehide / hidden / beforeunload the unsaved user fields go to localStorage synchronously (a keepalive PUT is
// capped at 64 KB, far below a 400-row inventory); init() re-applies them when the server copy has not moved on since.
const JOURNAL_KEYS = ['name', 'inventory', 'review', 'wages', 'factorOverrides', 'assumptionOverrides', 'priorAward', 'topDownOverrides', 'ai'] as const;
type JournalKey = typeof JOURNAL_KEYS[number];
interface Journal { v: 1; at: number; base: string | null; created?: string; fields: Partial<Pick<ClientProject, JournalKey>> }
const journalKey = (id: string) => `bos.unsaved.v1.${id}`;
function readJournal(id: string): Journal | null {
  try { const j = JSON.parse(localStorage.getItem(journalKey(id)) ?? 'null') as Journal | null; return j && j.v === 1 && j.fields && typeof j.at === 'number' ? j : null; } catch { return null; }
}
function clearJournal(id: string) { try { localStorage.removeItem(journalKey(id)); } catch { /* storage unavailable */ } }
const sameJson = (a: unknown, b: unknown) => { if (a === b) return true; try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); } catch { return false; } };

export const useStore = create<State>((set, get) => {
  const doSave = async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    const p = get().project; if (!p) return true;
    const v = editVersion;
    set({ saving: true });
    try {
      // only the fields this client edits: documents, the read record and the cross-check belong to the server
      // (a run or Re-run writes them), so a save can never put back a stale copy of them
      const body: Record<string, unknown> = { id: p.id };
      for (const k of JOURNAL_KEYS) if (p[k] !== undefined) body[k] = p[k];
      const saved = await api.patchProject(p.id, body, opts);
      savedVersion = Math.max(savedVersion, v);
      serverStamp = saved.updatedAt ?? serverStamp;
      if (editVersion <= savedVersion && !get().extraction.running && !reconciling) clearJournal(p.id);
      set({ saveError: null });
      return true;
    } catch (err) {
      set({ saveError: (err as Error).message || 'Save failed' });
      return false;
    } finally { set({ saving: false }); }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    // while a read runs (or its result is being reconciled) the run's end merges and saves local edits (§6.3)
    saveTimer = setTimeout(() => { saveTimer = null; if (get().extraction.running || reconciling) return; void doSave(); }, 700);
  };
  /** unsaved local changes, or a save still in flight */
  const dirty = () => editVersion > savedVersion || get().saving || reconciling;
  /** Writes the unsaved user fields to the journal; false when they could not be kept (storage full or blocked). */
  const writeJournal = (): boolean => {
    const s = get(); const p = s.project; if (!p) return true;
    const x = s.extraction;
    const fields: Journal['fields'] = {};
    for (const k of JOURNAL_KEYS) (fields as Record<string, unknown>)[k] = p[k];
    if (x.running) {
      // a first read or Append streams into the inventory: those rows are not the user's, and the server keeps the
      // pre-run inventory when a run dies, so only a staged run's inventory (old rows + hand edits) is journaled
      if (!x.staging.active) { delete fields.inventory; }
      // the run's events patch these; the server copy is the pre-run one
      delete fields.priorAward; delete fields.name;
    }
    try { localStorage.setItem(journalKey(p.id), JSON.stringify({ v: 1, at: Date.now(), base: serverStamp, created: p.createdAt, fields } satisfies Journal)); return true; } catch { return false; }
  };
  /** Page is going away or hidden: journal, then start the save at once (keepalive when the body is small enough). */
  const flushOnLeave = (): boolean => {
    if (!dirty()) return true;
    const kept = writeJournal();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (editVersion > savedVersion && !get().saving && !get().extraction.running && !reconciling) void doSave({ keepalive: true });
    return kept;
  };
  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('pagehide', () => { flushOnLeave(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnLeave(); });
      // warn only when the changes could not be kept locally (the journal restores them otherwise)
      window.addEventListener('beforeunload', (ev) => { if (dirty() && !flushOnLeave()) { ev.preventDefault(); ev.returnValue = ''; } });
    } catch { /* no window events */ }
  }
  const mutateProject = (fn: (p: ClientProject) => ClientProject) => {
    const p = get().project; if (!p) return;
    editVersion++;
    set({ project: fn(p) });
    scheduleSave();
  };
  const saveUi = (patch: Record<string, unknown>) => writeJson(UI_KEY, patch);
  const effectiveReduced = (pref: boolean | null) => pref ?? mediaReduced();

  // live-update reduced motion from the OS
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', () => { const s = get(); if (s.reducedMotionPref == null) set({ reducedMotion: mq.matches }); });
  } catch { /* no matchMedia */ }

  return {
    projectId: 'default',
    project: null,
    health: null,
    loading: true,
    loadError: null,
    saving: false,
    saveError: null,
    selection: { kind: null },
    focusMode: 'site',
    buildingTab: 'interior',
    crewFilter: null,
    selectedAgentId: null,
    factorsOpen: false,
    autoOrbit: false,
    topDownRunning: false,
    quality: readQuality(),
    extraction: emptyExtraction(),
    sim: { playing: true, speed: 12, time: 18.25 },
    view: 'map',
    colorBy: viewPrefs.colorBy ?? 'category',
    labelMode: viewPrefs.labelMode ?? 'auto',
    lighting: viewPrefs.lighting ?? 'review',
    planView: false,
    focusFloor: null,
    reducedMotion: effectiveReduced(typeof uiPrefs.reducedMotion === 'boolean' ? uiPrefs.reducedMotion : null),
    hoverId: null,
    filterIds: null,
    camCmd: { kind: 'fit-site', seq: 0 },
    layoutEpoch: 0,
    leftOpen: true,
    leftTab: 'documents',
    leftBeforeTable: null,
    rightOpen: false,
    rightTab: 'inspector',
    rightUserCollapsed: false,
    bottomOpen: innerH() >= 860,
    bottomTab: 'crews',
    bottomTouched: false,
    uiZoom: ZOOMS.includes(uiPrefs.uiZoom as UiZoom) ? uiPrefs.uiZoom as UiZoom : 'auto',
    reducedMotionPref: typeof uiPrefs.reducedMotion === 'boolean' ? uiPrefs.reducedMotion : null,
    uiSections: uiPrefs.sections && typeof uiPrefs.sections === 'object' ? uiPrefs.sections : {},
    query: { text: '', chip: 'all', sort: 'source', desc: false, tableTab: 'facilities' },
    logFilter: 'all',
    estimateFocus: null,
    shortcutsOpen: false,
    toasts: [],
    confirms: [],
    pendingFiles: [],
    pendingSkipped: [],
    reader: { provider: 'auto', ingest: 'auto', mode: 'replace' },

    async init() {
      const params = new URLSearchParams(location.search);
      const projectId = params.get('project') || 'default';
      set({ projectId, loading: true, loadError: null });
      try {
        const [health, loaded] = await Promise.all([api.health().catch(() => null), api.getProject(projectId)]);
        // unsaved changes journaled when the page last went away: re-apply them unless the server copy moved on since
        let project = loaded as ClientProject; let recovered = false;
        const j = readJournal(projectId);
        if (j) {
          const stamp = Date.parse(loaded.updatedAt);
          // the same project (a reset or re-seed makes a new one) whose server copy has not moved on since
          const same = !j.created || j.created === loaded.createdAt;
          const fresh = same && (j.base === loaded.updatedAt || !(stamp > j.at + 15_000));
          const differs = fresh && JOURNAL_KEYS.some((k) => k in j.fields && !sameJson(j.fields[k], (loaded as ClientProject)[k]));
          if (differs) { project = { ...project, ...j.fields }; recovered = true; } else clearJournal(projectId);
        }
        const inv = project.inventory;
        const empty = inv.facilities.length + inv.grounds.length === 0;
        const ranBefore = Boolean(project.extraction) || project.documents.length > 0;
        set({
          health, project, loading: false,
          leftOpen: true, leftTab: empty || !ranBefore ? 'documents' : 'inventory',
          rightOpen: !empty, rightTab: 'inspector',
          query: { ...get().query, tableTab: inv.facilities.length === 0 && inv.grounds.length > 0 ? 'grounds' : 'facilities' },
        });
        editVersion = savedVersion = 0;
        serverStamp = loaded.updatedAt ?? null;
        if (recovered) {
          editVersion = 1;
          void doSave();
          get().pushToast({ text: 'Recovered changes that were not saved before the page closed', tone: 'ok' });
        }
      } catch (err) {
        set({ loading: false, loadError: (err as Error).message });
      }
    },
    setProjectName(name) { mutateProject((p) => ({ ...p, name })); },
    patchInventory(fn) { mutateProject((p) => ({ ...p, inventory: fn(p.inventory) })); },
    updateFacility(id, patch) { get().updateRows(new Map([[id, patch]])); },
    removeFacility(id) { get().removeRows([id]); },
    addFacility() {
      const id = `b-manual-${Date.now().toString(36)}`;
      const f: Facility = { id, name: 'New facility', category: 'admin', grossSqft: 10000, floors: 1, serviceLevel: 'daily_5', scope: ['custodial', 'floor_care'], confidence: 1, notes: 'Added manually' };
      get().patchInventory((inv) => ({ ...inv, facilities: [...inv.facilities, f] }));
      set({ selection: { kind: 'facility', id }, focusMode: 'site' });
    },
    updateGrounds(id, patch) { get().updateRows(new Map(), new Map([[id, patch]])); },
    removeGrounds(id) { get().removeRows([id]); },
    updateRows(fac, grd = new Map()) {
      const p = get().project; if (!p || (!fac.size && !grd.size)) return 0;
      const at = Date.now();
      let review = p.review; let reviewCopied = false; let n = 0;
      const apply = <T extends Facility | GroundsArea>(row: T, patch: Partial<T> | undefined): T => {
        if (!patch || !changes(row, patch)) return row;
        n++;
        if (!isManualRow(row.id)) {
          const prev = review?.[row.id];
          const next = withEditMarkers(prev, changedFields(row, patch), at);
          if (next && next !== prev) { if (!reviewCopied) { review = { ...(review ?? {}) }; reviewCopied = true; } review![row.id] = next; }
        }
        return { ...row, ...patch };
      };
      const facilities = fac.size ? p.inventory.facilities.map((f) => apply(f, fac.get(f.id))) : p.inventory.facilities;
      const grounds = grd.size ? p.inventory.grounds.map((g) => apply(g, grd.get(g.id))) : p.inventory.grounds;
      if (!n) return 0;
      mutateProject((q) => ({ ...q, inventory: { ...q.inventory, facilities, grounds }, review }));
      return n;
    },
    removeRows(ids) {
      const drop = new Set(ids); if (!drop.size) return;
      mutateProject((p) => ({
        ...p,
        inventory: {
          ...p.inventory,
          facilities: p.inventory.facilities.filter((f) => !drop.has(f.id)),
          grounds: p.inventory.grounds.filter((g) => !drop.has(g.id)).map((g) => (g.facilityId && drop.has(g.facilityId) ? { ...g, facilityId: undefined } : g)),
        },
      }));
      const sel = get().selection;
      if (sel.kind !== null && drop.has(sel.id)) set({ selection: { kind: null }, focusMode: 'site', selectedAgentId: null });
    },
    revertEdits(id, paths) {
      const p = get().project; if (!p) return false;
      const entry = p.review?.[id]; const edited = entry?.edited; if (!entry || !edited) return false;
      const list = (paths ?? Object.keys(edited)).filter((k) => k in edited);
      if (!list.length) return false;
      const f = p.inventory.facilities.find((x) => x.id === id);
      const g = f ? undefined : p.inventory.grounds.find((x) => x.id === id);
      const row = f ?? g; if (!row) return false;
      const patch = revertPatch(row, list, edited);
      const left = { ...edited }; for (const k of list) delete left[k];
      const next: ReviewEntry = { ...entry, at: Date.now() }; if (Object.keys(left).length) next.edited = left; else delete next.edited;
      mutateProject((q) => ({
        ...q,
        inventory: f ? { ...q.inventory, facilities: q.inventory.facilities.map((x) => (x.id === id ? { ...x, ...patch } as Facility : x)) }
          : { ...q.inventory, grounds: q.inventory.grounds.map((x) => (x.id === id ? { ...x, ...patch } as GroundsArea : x)) },
        review: { ...(q.review ?? {}), [id]: next },
      }));
      return true;
    },
    restoreDoc(doc) {
      mutateProject((p) => ({ ...p, inventory: doc.inventory, review: doc.review }));
      const sel = get().selection;
      if (sel.kind !== null) {
        const exists = sel.kind === 'facility' ? doc.inventory.facilities.some((f) => f.id === sel.id) : doc.inventory.grounds.some((g) => g.id === sel.id);
        if (!exists) set({ selection: { kind: null }, focusMode: 'site', selectedAgentId: null });
      }
    },
    addGrounds(facilityId) {
      const id = `g-manual-${Date.now().toString(36)}`;
      const g: GroundsArea = { id, name: facilityId ? 'Improved turf (manual)' : 'Improved turf', facilityId, kind: 'improved_turf', quantity: 5, unit: 'acres', confidence: 1, notes: 'Added manually' };
      get().patchInventory((inv) => ({ ...inv, grounds: [...inv.grounds, g] }));
      set({ selection: { kind: 'grounds', id } });
    },
    setFactorOverride(id, value) { get().setFactorOverrides({ [id]: value }); },
    setFactorOverrides(patch) {
      if (!Object.keys(patch).length) return;
      mutateProject((p) => { const o = { ...(p.factorOverrides ?? {}) }; for (const [id, value] of Object.entries(patch)) { if (value == null || !isFinite(value)) delete o[id]; else o[id] = value; } return { ...p, factorOverrides: o }; });
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
      set({ topDownRunning: true });
      try {
        await get().saveNow();
        const topDown = await api.runTopDown(projectId, { provider, priorAward: project.priorAward, overrides: project.topDownOverrides });
        set((s) => ({ project: s.project ? { ...s.project, topDown } : s.project }));
      } catch (err) { get().pushToast({ text: (err as Error).message, tone: 'error' }); }
      finally { set({ topDownRunning: false }); }
    },
    setWage(crew, value) { mutateProject((p) => { const w = { ...(p.wages ?? {}) }; if (value == null || !isFinite(value)) delete w[crew]; else w[crew] = value; return { ...p, wages: w }; }); },
    select(sel) {
      const s = get();
      const same = s.selection.kind === sel.kind && (sel.kind === null || (s.selection as { id: string }).id === sel.id);
      if (same) { if (s.selectedAgentId) set({ selectedAgentId: null }); return; }
      set({ selection: sel, selectedAgentId: null, focusMode: sel.kind === 'facility' ? s.focusMode : 'site' });
    },
    setFocusMode(m) { set({ focusMode: m }); },
    setBuildingTab(t) { set({ buildingTab: t }); },
    setCrewFilter(c) { set({ crewFilter: c }); },
    setSelectedAgent(id) { set({ selectedAgentId: id }); },
    setFactorsOpen(v) { set({ factorsOpen: v }); },
    setAutoOrbit(v) { set({ autoOrbit: v }); },
    setQuality(q) { try { localStorage.setItem('bos.quality', q); } catch { /* ignore */ } set({ quality: q }); },
    setToast(t) { if (t) get().pushToast({ text: t }); },

    // ------------------------------------------------------------------ §7 extraction
    async startExtraction(o) {
      if (!get().project || get().extraction.running) return;
      lastRun = { ...o, files: [...o.files] };
      // 1. flush any pending save so the server's copy (which the run merges into) carries review marks and edits
      await get().saveNow();
      const project = get().project!;
      const { projectId } = get();
      const startCount = project.inventory.facilities.length + project.inventory.grounds.length;
      const populated = startCount > 0;
      // 2. snapshot; 3-4. phase, staging; 6. the inventory is never wiped
      const snapshot = structuredClone(project);
      const abort = new AbortController();
      const startedAt = Date.now();
      const model = o.model ?? project.ai.model; const effort = o.effort ?? project.ai.effort;
      const staging = o.mode === 'replace' && populated;
      set((s) => ({
        extraction: {
          ...emptyExtraction(), running: true, phase: 'uploading', mode: o.mode, startedAt, abort, snapshot, startCount,
          staging: { ...emptyStaging(), active: staging },
          log: [{ kind: 'status', text: `Starting ${o.provider === 'heuristic' ? 'rule-based' : 'AI'} read (${o.mode}${staging ? ', staged' : ''})…`, t: startedAt }],
        },
        // 5. a first read clears the selection
        ...(populated ? {} : { selection: { kind: null } as Selection, focusMode: 'site' as const }),
        leftTab: 'inventory', leftOpen: s.view === 'table' ? s.leftOpen : true,
        bottomTab: 'log', bottomOpen: innerH() >= 860 ? true : s.bottomOpen, bottomTouched: false,
      }));

      // ---- 250 ms coalescing: every SSE event is queued; flush() applies the batch in one set() ----
      const queue: ExtractionEvent[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lastFlush = 0;
      let merged = false; // a 'merging' status was seen (later 'ai' stages are the cross-check)
      const seenF = new Set<string>(); const seenG = new Set<string>();

      const flush = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        lastFlush = performance.now();
        if (!queue.length) return;
        const evs = queue.splice(0);
        set((s) => {
          const p0 = s.project; if (!p0) return {};
          const x0 = s.extraction;
          const now = Date.now();
          let phase = x0.phase;
          const advance = (to: RunPhase) => { if (!terminal(phase) && PHASE_ORDER[to] > PHASE_ORDER[phase]) phase = to; };
          let log = x0.log.slice();
          const pushLog = (e: LogEntry) => {
            const prev = log[log.length - 1];
            if (prev && (e.kind === 'text' || e.kind === 'thinking') && prev.kind === e.kind && e.t - prev.t < 3000) log[log.length - 1] = { ...prev, text: prev.text + e.text, t: e.t };
            else log.push(e);
          };
          let docs = x0.docs, warnings = x0.warnings, progress = x0.progress, error = x0.error;
          let recent = x0.recent, recentIds = x0.recentIds;
          let staged = x0.staging;
          const seen: { ids: Set<string> | null } = { ids: null };
          let incoming = staged.incoming, incomingG = staged.incomingGrounds;
          let inventory = p0.inventory;
          let facilities = inventory.facilities, grounds = inventory.grounds;
          let fIdx: Map<string, number> | null = null, gIdx: Map<string, number> | null = null;
          let inF: Map<string, number> | null = null, inG: Map<string, number> | null = null;
          let projPatch: Partial<ClientProject> = {};
          let result = x0.result;
          let mergeAt = x0.mergeAt, mergeBefore = x0.mergeBefore, found = x0.found;
          const keepHand = <T extends Facility | GroundsArea>(next: T, prev: T): T => {
            const marks = p0.review?.[next.id]?.edited;
            return marks && Object.keys(marks).length ? withHandValues(next, prev, Object.keys(marks)) : next;
          };
          const markFound = (id: string) => {
            if (!seen.ids) seen.ids = new Set(staged.seenIds);
            seen.ids.add(id);
            if (recent === x0.recent) recent = { ...recent };
            recent[id] = now;
            recentIds = [id, ...recentIds.filter((x) => x !== id)].slice(0, 8);
          };
          for (const e of evs) {
            switch (e.type) {
              case 'status':
                if (e.stage === 'reading') advance('reading');
                else if (e.stage === 'merging') { merged = true; advance('merging'); }
                else if (e.stage === 'ai') advance(merged ? 'crosscheck' : 'extracting');
                pushLog({ kind: 'status', text: e.message, t: now });
                break;
              case 'document':
                advance('reading');
                docs = [...docs, { name: e.name, pages: e.pages, chars: e.chars, mode: e.mode, kind: e.kind, role: e.role, amendment: e.amendment, scannedPages: e.scannedPages, warnings: e.warnings }];
                pushLog({ kind: 'status', text: `Read ${e.name}: ${e.pages ? `${e.pages} pages, ` : ''}${e.chars.toLocaleString()} chars (${e.mode === 'native_pdf' ? 'native PDF → model reads tables & drawings' : 'text'})`, t: now });
                break;
              case 'ai_text': pushLog({ kind: e.kind === 'tool' ? 'tool' : e.kind === 'thinking' ? 'thinking' : 'text', text: e.text, t: now }); break;
              case 'facility': {
                advance('extracting');
                const f = e.facility;
                if (staged.active) {
                  if (!inF) { inF = new Map(incoming.map((x, i) => [x.id, i])); incoming = incoming.slice(); }
                  const i = inF.get(f.id); if (i == null) { inF.set(f.id, incoming.length); incoming.push(f); } else incoming[i] = f;
                } else {
                  if (!fIdx) { fIdx = new Map(facilities.map((x, i) => [x.id, i])); facilities = facilities.slice(); }
                  // a re-read row keeps the values the estimator edited by hand (the done merge settles conflicts)
                  const i = fIdx.get(f.id); if (i == null) { fIdx.set(f.id, facilities.length); facilities.push(f); } else facilities[i] = keepHand(f, facilities[i]);
                }
                seenF.add(f.id); markFound(f.id);
                progress = { ...progress, registered: Math.max(progress.registered, seenF.size) };
                pushLog({ kind: 'found', text: fmtFound(f), t: now });
                break;
              }
              case 'grounds': {
                advance('extracting');
                const g = e.area;
                if (staged.active) {
                  if (!inG) { inG = new Map(incomingG.map((x, i) => [x.id, i])); incomingG = incomingG.slice(); }
                  const i = inG.get(g.id); if (i == null) { inG.set(g.id, incomingG.length); incomingG.push(g); } else incomingG[i] = g;
                } else {
                  if (!gIdx) { gIdx = new Map(grounds.map((x, i) => [x.id, i])); grounds = grounds.slice(); }
                  const i = gIdx.get(g.id); if (i == null) { gIdx.set(g.id, grounds.length); grounds.push(g); } else grounds[i] = keepHand(g, grounds[i]);
                }
                seenG.add(g.id); markFound(g.id);
                progress = { ...progress, grounds: Math.max(progress.grounds, seenG.size) };
                pushLog({ kind: 'found', text: `＋ ${g.name} — ${g.quantity.toLocaleString()} ${g.unit}`, t: now });
                break;
              }
              case 'progress':
                advance('extracting');
                progress = { registered: Math.max(progress.registered, e.registered), expected: e.expected ?? progress.expected, grounds: Math.max(progress.grounds, e.grounds ?? 0) };
                break;
              case 'site':
                inventory = { ...inventory, site: { ...inventory.site, ...e.site } };
                pushLog({ kind: 'status', text: `Site: ${[e.site.installationName, e.site.location, e.site.solicitation].filter(Boolean).join(' · ') || 'details found'}`, t: now });
                break;
              case 'prior_award':
                projPatch = { ...projPatch, priorAward: e.award };
                pushLog({ kind: 'found', text: `＄ Previous award: ${[e.award.incumbent, e.award.contractNumber].filter(Boolean).join(' · ') || 'facts'}${e.award.totalValue ? ` · $${e.award.totalValue.toLocaleString()} / ${e.award.periodMonths ?? '?'} mo` : ''}${e.award.spendToDate ? ` · spend $${e.award.spendToDate.toLocaleString()}` : ''}${e.award.annualValue ? ` · $${e.award.annualValue.toLocaleString()}/yr` : ''}`, t: now });
                break;
              case 'topdown':
                advance('crosscheck');
                projPatch = { ...projPatch, topDown: e.topDown };
                pushLog({ kind: 'status', text: e.topDown.impliedFte.base > 0 ? `Top-down: ${e.topDown.impliedFte.base} FTE implied from ${e.topDown.basis} basis ($${e.topDown.annualValue.toLocaleString()}/yr) vs ${e.topDown.bottomUpFte} bottom-up` : 'Top-down: assumptions ready, award value still needed to back into FTEs', t: now });
                break;
              case 'warning':
                warnings = [...warnings, { message: e.message, file: e.file, t: now }];
                pushLog({ kind: 'warning', text: `${e.file ? `${e.file}: ` : ''}${e.message}`, t: now });
                break;
              case 'error':
                phase = 'failed'; error = e.message;
                pushLog({ kind: 'error', text: e.message, t: now });
                break;
              case 'done': {
                // §7.3: the run's inventory replaces the project's, staging clears, the diff is computed
                const snap = x0.snapshot;
                const local: Inventory = { ...inventory, facilities, grounds };
                const review0 = (projPatch.review ?? p0.review) as ReviewMap | undefined;
                // every hand edit (before or during the run) is put back where the re-read left the extracted value
                // alone; where the re-read changed an edited field the hand value stays and the row is flagged
                mergeAt = now;
                const m = mergeHandEdits(local, review0, e.inventory, mergeAt);
                let review = m.review; const before = { ...m.before };
                let r: RunResult;
                if (snap && snap.inventory.facilities.length + snap.inventory.grounds.length > 0) {
                  // diff against what the user saw: the snapshot plus the edits made during the run
                  const was = overlayHandEdits(snap.inventory, local, review0, (_, re) => re.at > startedAt);
                  r = diffInventories(was, m.inventory);
                  // a conflict is a change in the source even though the hand value stays on the row
                  const extra = [...new Set(m.conflicts.map((c) => c.id))].filter((id) => !r.changedIds.includes(id));
                  if (extra.length) r = { ...r, changed: r.changed + extra.length, unchanged: Math.max(0, r.unchanged - extra.length), changedIds: [...r.changedIds, ...extra] };
                } else r = { added: e.inventory.facilities.length + e.inventory.grounds.length, removed: 0, changed: 0, unchanged: 0, changedIds: [] };
                // §6.3 P1: a verified mark no longer vouches for numbers the re-read changed; the row goes back to review (its note stays)
                let unverified = 0; let copied = false;
                for (const id of r.changedIds) {
                  const re = review[id]; if (re?.status !== 'verified') continue;
                  if (!copied) { review = { ...review }; copied = true; }
                  if (!(id in before)) before[id] = re;
                  review[id] = { ...re, status: 'unreviewed', at: mergeAt };
                  unverified++;
                }
                mergeBefore = before;
                result = { ...r, kept: m.kept.length, conflicts: new Set(m.conflicts.map((c) => c.id)).size, unverified };
                if (review !== review0) projPatch = { ...projPatch, review };
                inventory = m.inventory; facilities = inventory.facilities; grounds = inventory.grounds;
                staged = emptyStaging(); incoming = []; incomingG = []; seen.ids = null;
                const name = p0.name === 'Untitled BOS estimate' && e.inventory.site.installationName ? `${e.inventory.site.installationName} BOS` : p0.name;
                projPatch = { ...projPatch, name, extraction: { provider: e.provider, model: e.model, finishedAt: new Date().toISOString(), durationMs: e.durationMs, usage: e.usage } };
                phase = 'done';
                found = seenF.size + seenG.size;
                progress = { ...progress, registered: e.inventory.facilities.length, grounds: e.inventory.grounds.length };
                pushLog({ kind: 'status', text: `Done in ${(e.durationMs / 1000).toFixed(1)}s via ${e.provider === 'claude' ? e.model : 'rule-based parser'}: ${e.inventory.facilities.length} facilities, ${e.inventory.grounds.length} grounds areas${e.usage ? ` · ${e.usage.input.toLocaleString()} in / ${e.usage.output.toLocaleString()} out tokens` : ''}`, t: now });
                break;
              }
            }
          }
          if (log.length > 1200) log = log.slice(-1000);
          const invChanged = facilities !== inventory.facilities || grounds !== inventory.grounds;
          if (invChanged) inventory = { ...inventory, facilities, grounds };
          const nextStaging = staged.active
            ? (seen.ids || incoming !== staged.incoming || incomingG !== staged.incomingGrounds ? { ...staged, seenIds: seen.ids ?? staged.seenIds, incoming, incomingGrounds: incomingG } : staged)
            : staged;
          const project = inventory !== p0.inventory || Object.keys(projPatch).length ? { ...p0, ...projPatch, inventory } : p0;
          return {
            project,
            extraction: { ...x0, phase, log, docs, warnings, progress, error, recent, recentIds, staging: nextStaging, result, mergeAt, mergeBefore, found },
          };
        });
      };
      const onEvent = (e: ExtractionEvent) => {
        queue.push(e);
        if (e.type === 'done' || e.type === 'error') { flush(); return; }
        if (!timer) timer = setTimeout(flush, Math.max(0, 250 - (performance.now() - lastFlush)));
      };

      let thrown: string | null = null;
      try {
        await runExtraction({ ...o, projectId, model, effort, signal: abort.signal, onEvent, onResponse: () => set((s) => (s.extraction.phase === 'uploading' ? { extraction: { ...s.extraction, phase: 'reading' } } : {})) });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') thrown = (err as Error).message || String(err);
      } finally {
        flush();
        const aborted = abort.signal.aborted;
        set((s) => {
          const x = s.extraction;
          let phase: RunPhase = x.phase; let error = x.error; const log = x.log.slice();
          if (phase !== 'done' && phase !== 'failed') {
            if (aborted) phase = 'cancelled';
            else { phase = 'failed'; error = thrown ?? error ?? 'The server closed the stream before the read finished.'; log.push({ kind: 'error', text: error, t: Date.now() }); }
          }
          return { extraction: { ...x, running: false, abort: undefined, endedAt: Date.now(), phase, error, log, staging: emptyStaging() } };
        });
        // no toast for a failed run: the run strip shows the same error until it is dismissed
        // Reconcile with the server (§6.3). On done the merged rows and review marks are the project: save them at once
        // (the PUT merges top-level keys and returns the whole saved project, with the run's documents and cross-check).
        // Otherwise reload the server copy (unchanged by a failed run) and carry over the marks and edits made meanwhile.
        reconciling = true;
        try {
          const x = get().extraction;
          const done = x.phase === 'done';
          const sent = get().project;
          let server: ClientProject;
          if (done && sent) {
            set({ saving: true });
            // one retry: the stream's connection closing can reset a request sent in the same instant
            const put = () => api.patchProject(projectId, { id: projectId, inventory: sent.inventory, review: sent.review ?? {} });
            try { server = await put().catch(async () => { await new Promise((r) => setTimeout(r, 300)); return put(); }) as ClientProject; }
            finally { set({ saving: false }); }
          } else server = await api.getProject(projectId) as ClientProject;
          const local = get().project;
          let merged: ClientProject = server;
          if (local) {
            if (done) merged = { ...server, inventory: local.inventory, review: local.review };
            else {
              const newer: ReviewMap = {};
              for (const [id, r] of Object.entries(local.review ?? {})) if (r.at > startedAt) newer[id] = r;
              if (Object.keys(newer).length) {
                // fields edited by hand during the run keep the local value on the reloaded rows
                merged = { ...server, review: { ...(server.review ?? {}), ...newer }, inventory: overlayHandEdits(server.inventory, local.inventory, newer, () => true) };
              }
            }
            // settings changed by hand while the read ran (saves wait for the run's end) stay
            for (const k of ['wages', 'factorOverrides', 'assumptionOverrides', 'topDownOverrides', 'ai'] as const) {
              if (!sameJson(local[k], snapshot[k])) merged = { ...merged, [k]: local[k] };
            }
          }
          const unsaved = merged !== server && (['inventory', 'review', 'wages', 'factorOverrides', 'assumptionOverrides', 'topDownOverrides', 'ai'] as const)
            .some((k) => (done && sent && (k === 'inventory' || k === 'review') ? merged[k] !== sent[k] : !sameJson(merged[k], server[k])));
          set({ project: merged });
          serverStamp = server.updatedAt ?? serverStamp;
          editVersion = savedVersion = 0;
          reconciling = false;
          if (unsaved) { editVersion = 1; await doSave(); } else clearJournal(projectId);
          const x2 = get().extraction;
          const restorable = x2.snapshot ? (x2.phase === 'done' ? populated : !sameInventory(server.inventory, x2.snapshot.inventory)) : false;
          set((s) => ({ extraction: { ...s.extraction, restorable } }));
        } catch (err) {
          // keep the local copy; it is not saved yet, so let the normal save carry it
          console.warn('[bos] post-run reconcile failed', err);
          reconciling = false;
          editVersion++; scheduleSave();
        } finally { reconciling = false; }
        const end = get().extraction.phase;
        if (end === 'done') {
          // P1 (§7.3.5): a first read is packed by category once it is complete, not in arrival order
          if (!populated) get().relayout();
          if (!get().bottomTouched) set({ bottomTab: 'crews' });
        }
      }
    },
    cancelExtraction() { get().extraction.abort?.abort(); },
    async analyze(opts = {}) {
      const s = get();
      if (!s.project || s.extraction.running) return;
      const files = opts.sample ? [] : s.pendingFiles;
      if (!opts.sample && !files.length) return;
      let mode = s.reader.mode;
      const inv = s.project.inventory;
      if (mode === 'replace' && inv.facilities.length + inv.grounds.length > 0) {
        const ids = new Set([...inv.facilities.map((f) => f.id), ...inv.grounds.map((g) => g.id)]);
        const verified = Object.entries(s.project.review ?? {}).filter(([id, r]) => r.status === 'verified' && ids.has(id)).length;
        const edited = handEditedRows(inv, s.project.review);
        const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
        const choice = await get().confirm({
          title: 'Replace the inventory?',
          body: `Replace ${inv.facilities.length.toLocaleString()} facilities and ${inv.grounds.length.toLocaleString()} grounds areas? The new read goes to a staging list; your current inventory stays until it finishes and can be restored.`
            + (edited ? ` ${plural(edited, 'hand-edited row')} keep${edited === 1 ? 's' : ''} your values; where the new read changes one of those fields, the row is flagged for review.` : '')
            + (verified ? ` ${plural(verified, 'verified row')} keep${verified === 1 ? 's' : ''} the mark unless the new read changes ${verified === 1 ? 'its' : 'their'} quantities, which sends ${verified === 1 ? 'it' : 'them'} back to review.` : ''),
          actions: [{ id: 'append', label: 'Append instead' }, { id: 'cancel', label: 'Cancel' }, { id: 'replace', label: 'Replace', variant: 'primary' }],
        });
        if (!choice) return;
        if (choice === 'append') mode = 'append';
      }
      let text: string | undefined;
      if (opts.sample) { try { text = await api.sample(); } catch (err) { get().pushToast({ text: (err as Error).message, tone: 'error' }); return; } }
      else set({ pendingFiles: [], pendingSkipped: [] });
      await get().startExtraction({ files, text, textName: opts.sample ? 'sample-rfp-pws.txt (built-in sample)' : undefined, provider: s.reader.provider, ingest: s.reader.ingest, mode });
    },
    async retryExtraction() { if (lastRun && !get().extraction.running) await get().startExtraction(lastRun); },
    dismissRun() { set((s) => (s.extraction.running ? {} : { extraction: { ...s.extraction, phase: 'idle', snapshot: undefined, restorable: false } })); },
    async clearProject() {
      try {
        const p = await api.resetProject(get().projectId);
        editVersion = savedVersion = 0;
        serverStamp = p.updatedAt ?? null; clearJournal(p.id);
        set({ project: p, selection: { kind: null }, focusMode: 'site', extraction: emptyExtraction(), leftOpen: true, leftTab: 'documents', rightOpen: false, rightUserCollapsed: false });
      } catch (err) { get().pushToast({ text: (err as Error).message, tone: 'error' }); }
    },
    simSet(patch) { set((s) => ({ sim: { ...s.sim, ...patch } })); },
    setHover(id) { if (get().hoverId !== id) set({ hoverId: id }); },
    setView(v) {
      const s = get(); if (s.view === v) return;
      // the table sheet spans from the rail: the left panel collapses while it shows and is restored on exit (§4.2)
      if (v === 'table') set({ view: v, leftOpen: false, leftBeforeTable: s.leftOpen });
      else set({ view: v, leftOpen: s.leftBeforeTable ?? s.leftOpen, leftBeforeTable: null });
    },
    setColorBy(c) { set({ colorBy: c }); writeJson(VIEW_KEY, { colorBy: c }); },
    setLabelMode(m) { set({ labelMode: m }); writeJson(VIEW_KEY, { labelMode: m }); },
    setLighting(l) { set({ lighting: l }); writeJson(VIEW_KEY, { lighting: l }); },
    setPlanView(v) { set({ planView: v }); },
    setFocusFloor(f) { set({ focusFloor: f }); },
    setFilterIds(ids) { set({ filterIds: ids }); },
    requestCamera(kind) { set((s) => ({ camCmd: { kind, seq: s.camCmd.seq + 1 } })); },
    relayout() { set((s) => ({ layoutEpoch: s.layoutEpoch + 1 })); get().requestCamera('fit-site'); },
    setReview(ids, status, note) {
      if (!ids.length) return;
      const at = Date.now();
      mutateProject((p) => {
        const review: ReviewMap = { ...(p.review ?? {}) };
        for (const id of ids) {
          const prev = review[id];
          const st: ReviewStatus = status ?? 'unreviewed';
          review[id] = { ...(prev ?? {}), status: st, at, ...(note !== undefined ? { note } : {}) };
          if (st === 'unreviewed' && !prev?.edited && !review[id].note) review[id] = { status: 'unreviewed', at };
        }
        return { ...p, review };
      });
    },
    async restorePrevious() {
      const x = get().extraction; const snap = x.snapshot; if (!snap || x.running) return;
      const cur = get().project; if (!cur) return;
      // only what the run wrote goes back: the rows (with hand edits and marks made since the run started carried
      // over), the documents list, the read record and the cross-check; wages, factor overrides, the award facts,
      // assumptions and the project name stay as they are now
      const rows = restoreRows(snap, cur, x.startedAt ?? 0, x.mergeAt, x.mergeBefore);
      const toSave: ClientProject = { ...cur, inventory: rows.inventory, review: rows.review, documents: snap.documents, extraction: snap.extraction, topDown: snap.topDown };
      try {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        const v = ++editVersion;
        const saved = await api.saveProject(toSave);
        serverStamp = saved.updatedAt ?? serverStamp;
        // edits made while the restore was in flight stay local and are saved by the next save
        const now = get().project;
        const project = now === cur ? (saved as ClientProject) : { ...(saved as ClientProject), ...Object.fromEntries((['wages', 'factorOverrides', 'assumptionOverrides', 'priorAward', 'topDownOverrides', 'name', 'ai'] as const).map((k) => [k, now?.[k]])) };
        savedVersion = Math.max(savedVersion, v);
        set((s) => ({ project, extraction: { ...s.extraction, snapshot: undefined, result: undefined, restorable: false, mergeAt: undefined, mergeBefore: undefined }, saveError: null }));
        if (now !== cur) { editVersion++; scheduleSave(); } else if (editVersion <= savedVersion) clearJournal(cur.id);
        const sel = get().selection;
        if (sel.kind !== null && !(sel.kind === 'facility' ? rows.inventory.facilities : rows.inventory.grounds).some((r) => r.id === sel.id)) set({ selection: { kind: null }, focusMode: 'site', selectedAgentId: null });
        get().pushToast({ text: 'Restored the inventory from before this run', tone: 'ok' });
      } catch (err) {
        get().pushToast({ text: `Could not restore: ${(err as Error).message}`, tone: 'error' });
      }
    },
    simTick(dt) {
      const s = get().sim; if (!s.playing) return;
      set({ sim: { ...s, time: (s.time + (dt * s.speed) / 60) % 24 } });
    },

    // ------------------------------------------------------------------ SHELL-only UI
    setLeftOpen(v) { set({ leftOpen: v }); },
    setLeftTab(t) { set({ leftTab: t }); },
    openLeft(t) { set({ leftOpen: true, leftTab: t }); },
    setRightOpen(v, opts) { set({ rightOpen: v, ...(opts?.user ? { rightUserCollapsed: !v } : {}) }); },
    setRightTab(t) { set({ rightTab: t }); },
    openRight(t) { set({ rightOpen: true, rightTab: t }); },
    openEstimate(section) { set((s) => ({ rightOpen: true, rightTab: 'estimate', estimateFocus: section ? { section, seq: (s.estimateFocus?.seq ?? 0) + 1 } : s.estimateFocus })); },
    setBottomOpen(v, opts) { set(opts?.auto ? { bottomOpen: v } : { bottomOpen: v, bottomTouched: true }); },
    setBottomTab(t) { set({ bottomTab: t, bottomTouched: true }); },
    openLog(filter) { set((s) => ({ bottomOpen: true, bottomTab: 'log', bottomTouched: true, logFilter: filter ?? s.logFilter })); },
    setLogFilter(f) { set({ logFilter: f }); },
    setUiZoom(z) { set({ uiZoom: z }); saveUi({ uiZoom: z }); },
    setReducedMotionPref(v) { set({ reducedMotionPref: v, reducedMotion: effectiveReduced(v) }); saveUi({ reducedMotion: v }); },
    setUiSection(id, collapsed) { set((s) => { const sections = { ...s.uiSections, [id]: collapsed }; saveUi({ sections }); return { uiSections: sections }; }); },
    setQuery(patch) { set((s) => ({ query: { ...s.query, ...patch } })); },
    setShortcutsOpen(v) { set({ shortcutsOpen: v }); },
    pushToast(t) {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-3) }));
      const ttl = t.ttl ?? 5000;
      if (ttl > 0) setTimeout(() => get().dismissToast(id), ttl);
      return id;
    },
    dismissToast(id) { set((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {})); },
    confirm(opts) {
      return new Promise<string | null>((resolve) => { const id = ++confirmSeq; set((s) => ({ confirms: [...s.confirms, { ...opts, id, resolve }] })); });
    },
    resolveConfirm(id, value) {
      const c = get().confirms.find((x) => x.id === id); if (!c) return;
      set((s) => ({ confirms: s.confirms.filter((x) => x.id !== id) }));
      c.resolve(value);
    },
    addPendingFiles(list) {
      const all = Array.from(list);
      const rejected = all.filter((f) => !isAccepted(f));
      set((s) => {
        const next = s.pendingFiles.slice();
        for (const f of all) if (isAccepted(f) && !next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
        const skipped = [...s.pendingSkipped, ...rejected.map((f) => ({ name: f.name || 'folder', reason: skipReason(f.name) }))];
        return { pendingFiles: next, pendingSkipped: skipped };
      });
      if (rejected.length) get().pushToast({ text: `Skipped ${rejected.length} file${rejected.length > 1 ? 's' : ''} the reader can't open. Accepted: ${ACCEPT.join(' ')}`, tone: 'warn' });
    },
    removePendingFile(f) { set((s) => ({ pendingFiles: s.pendingFiles.filter((x) => x !== f) })); },
    clearPending() { set({ pendingFiles: [], pendingSkipped: [] }); },
    clearSkipped() { set({ pendingSkipped: [] }); },
    setReader(patch) { set((s) => ({ reader: { ...s.reader, ...patch } })); },
    async saveNow() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (editVersion <= savedVersion) return !get().saveError;
      return doSave();
    },
    async retrySave() { if (await doSave()) get().pushToast({ text: 'Saved', tone: 'ok', ttl: 2000 }); },
  };
});
