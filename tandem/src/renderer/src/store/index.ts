import { create } from 'zustand'
import type {
  AccountState,
  AgentKind,
  AgentModel,
  AppInfo,
  ApprovalResponse,
  BrowserState,
  Capabilities,
  LicenseState,
  NewSessionInput,
  PolicyMode,
  SessionMeta,
  Settings,
  TerminalSpec,
  TimelineEvent,
  TimelineItem
} from '@shared/types'

export type Target = AgentKind | 'both'

export interface Toast {
  id: string
  level: 'info' | 'warn' | 'error'
  text: string
}

export type View = 'home' | 'session' | 'settings'

interface State {
  booted: boolean
  appInfo?: AppInfo
  settings?: Settings
  license?: LicenseState
  accounts: Record<AgentKind, AccountState>
  models: Record<AgentKind, AgentModel[]>
  sessions: Record<string, SessionMeta>
  items: Record<string, TimelineItem[]>
  loaded: Record<string, boolean>
  activeId?: string
  view: View
  terminals: TerminalSpec[]
  activeTermId?: string
  terminalOpen: boolean
  browserOpen: boolean
  browser?: BrowserState
  toasts: Toast[]
  newSessionOpen: boolean
  newSessionTarget: Target
  busy: Record<string, boolean>

  init(): Promise<void>
  applyEvent(ev: TimelineEvent): void
  refreshAccounts(): Promise<void>
  loadModels(agent: AgentKind): Promise<void>
  openSession(id: string): Promise<void>
  goHome(): void
  openSettings(): void
  openNewSession(target?: Target): void
  closeNewSession(): void
  createSessions(input: Omit<NewSessionInput, 'agent'>, target: Target, firstPrompt?: string): Promise<string | undefined>
  send(sessionId: string, text: string, images?: string[]): Promise<void>
  sendToPair(sessionId: string, text: string, images?: string[]): Promise<void>
  interrupt(sessionId: string): Promise<void>
  approve(resp: ApprovalResponse): Promise<void>
  setPolicy(sessionId: string, policy: PolicyMode, applyToPair?: boolean): Promise<void>
  setModel(sessionId: string, model: string, effort?: string): Promise<void>
  setCapabilities(sessionId: string, caps: Partial<Capabilities>): Promise<void>
  rename(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  handoff(sessionId: string, to: AgentKind): Promise<void>
  openTerminal(spec: Parameters<Window['tandem']['terminalOpen']>[0]): Promise<string>
  closeTerminal(id: string): Promise<void>
  setActiveTerm(id?: string): void
  toggleTerminalPane(open?: boolean): void
  openBrowser(url?: string): Promise<void>
  closeBrowser(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  activateLicense(key: string): Promise<LicenseState>
  toast(level: Toast['level'], text: string): void
  dismissToast(id: string): void
  pairOf(sessionId: string): SessionMeta[]
}

const api = (): Window['tandem'] => window.tandem

function upsertItem(list: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx === -1) return [...list, item]
  const next = list.slice()
  next[idx] = item
  return next
}

export const useStore = create<State>((set, get) => ({
  booted: false,
  accounts: {
    claude: { agent: 'claude', installed: false, loggedIn: false, computerUseAvailable: false },
    codex: { agent: 'codex', installed: false, loggedIn: false, computerUseAvailable: false }
  },
  models: { claude: [], codex: [] },
  sessions: {},
  items: {},
  loaded: {},
  view: 'home',
  terminals: [],
  terminalOpen: false,
  browserOpen: false,
  toasts: [],
  newSessionOpen: false,
  newSessionTarget: 'claude',
  busy: {},

  async init() {
    const [appInfo, settings, license, accounts, sessions, terminals] = await Promise.all([
      api().appInfo(),
      api().settingsGet(),
      api().licenseGet(),
      api().accountsGet(),
      api().sessionsList(),
      api().terminalList()
    ])
    document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme
    const map: Record<string, SessionMeta> = {}
    for (const s of sessions) map[s.id] = s
    set({ appInfo, settings, license, accounts, sessions: map, terminals, booted: true, view: sessions.length ? 'home' : 'home' })
    api().onEvent((ev) => get().applyEvent(ev))
  },

  applyEvent(ev) {
    switch (ev.type) {
      case 'upsert': {
        const list = get().items[ev.sessionId] ?? []
        set({ items: { ...get().items, [ev.sessionId]: upsertItem(list, ev.item) } })
        if (ev.item.kind === 'approval' && !ev.item.resolved && get().settings?.soundOnApproval) ping()
        return
      }
      case 'append': {
        const list = get().items[ev.sessionId]
        if (!list) return
        const idx = list.findIndex((x) => x.id === ev.itemId)
        if (idx === -1) return
        const it = list[idx]
        let next: TimelineItem = it
        if ((ev.field ?? 'text') === 'text' && (it.kind === 'assistant' || it.kind === 'reasoning')) next = { ...it, text: it.text + ev.delta }
        else if (ev.field === 'output' && it.kind === 'tool') next = { ...it, output: (it.output ?? '') + ev.delta }
        const copy = list.slice()
        copy[idx] = next
        set({ items: { ...get().items, [ev.sessionId]: copy } })
        return
      }
      case 'session':
        set({ sessions: { ...get().sessions, [ev.session.id]: ev.session } })
        return
      case 'session-removed': {
        const s = { ...get().sessions }
        delete s[ev.sessionId]
        const items = { ...get().items }
        delete items[ev.sessionId]
        set({ sessions: s, items, activeId: get().activeId === ev.sessionId ? undefined : get().activeId, view: get().activeId === ev.sessionId ? 'home' : get().view })
        return
      }
      case 'accounts':
        set({ accounts: ev.accounts })
        return
      case 'terminal-exit':
        set({ terminals: get().terminals.filter((t) => t.id !== ev.termId) })
        return
      case 'browser-state':
        set({ browser: ev.state, browserOpen: ev.state.open ? true : get().browserOpen && ev.state.open })
        return
      case 'toast':
        if (ev.text) get().toast(ev.level, ev.text)
        return
      default:
        return
    }
  },

  async refreshAccounts() {
    const accounts = await api().accountsRefresh()
    set({ accounts })
  },

  async loadModels(agent) {
    try {
      const models = await api().modelsList(agent)
      set({ models: { ...get().models, [agent]: models } })
    } catch (e) {
      get().toast('warn', `Could not list ${agent} models: ${(e as Error).message}`)
    }
  },

  async openSession(id) {
    set({ activeId: id, view: 'session' })
    const pair = get().pairOf(id)
    if (pair.some((s) => s.capabilities.inAppBrowser) && !get().browserOpen) void get().openBrowser()
    for (const s of pair) {
      if (!get().loaded[s.id]) {
        const items = await api().sessionItems(s.id)
        set({ items: { ...get().items, [s.id]: items }, loaded: { ...get().loaded, [s.id]: true } })
      }
    }
  },

  goHome() {
    set({ view: 'home', activeId: undefined })
  },
  openSettings() {
    set({ view: 'settings' })
  },
  openNewSession(target) {
    set({ newSessionOpen: true, newSessionTarget: target ?? get().newSessionTarget })
  },
  closeNewSession() {
    set({ newSessionOpen: false })
  },

  async createSessions(input, target, firstPrompt) {
    const agents: AgentKind[] = target === 'both' ? ['claude', 'codex'] : [target]
    const pairId = agents.length > 1 ? crypto.randomUUID() : undefined
    const created: SessionMeta[] = []
    for (const agent of agents) {
      const s = await api().sessionCreate({ ...input, agent, pairId, model: agent === 'claude' ? get().settings?.claudeModel : get().settings?.codexModel })
      created.push(s)
      set({ sessions: { ...get().sessions, [s.id]: s }, items: { ...get().items, [s.id]: [] }, loaded: { ...get().loaded, [s.id]: true } })
    }
    set({ newSessionOpen: false })
    const first = created[0]
    if (!first) return undefined
    await get().openSession(first.id)
    if (firstPrompt?.trim()) {
      await Promise.all(created.map((s) => get().send(s.id, firstPrompt)))
    }
    return first.id
  },

  async send(sessionId, text, images) {
    try {
      await api().sessionSend({ sessionId, text, images })
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  async sendToPair(sessionId, text, images) {
    const pair = get().pairOf(sessionId)
    await Promise.all(pair.map((s) => get().send(s.id, text, images)))
  },

  async interrupt(sessionId) {
    await api().sessionInterrupt(sessionId)
  },

  async approve(resp) {
    try {
      await api().sessionApprove(resp)
    } catch (e) {
      get().toast('error', (e as Error).message)
    }
  },

  async setPolicy(sessionId, policy, applyToPair) {
    const targets = applyToPair ? get().pairOf(sessionId) : [get().sessions[sessionId]]
    for (const s of targets) {
      if (!s) continue
      const next = await api().sessionSetPolicy(s.id, policy)
      set({ sessions: { ...get().sessions, [next.id]: next } })
    }
  },

  async setModel(sessionId, model, effort) {
    const next = await api().sessionSetModel(sessionId, model, effort)
    set({ sessions: { ...get().sessions, [next.id]: next } })
  },

  async setCapabilities(sessionId, caps) {
    const next = await api().sessionSetCapabilities(sessionId, caps)
    set({ sessions: { ...get().sessions, [next.id]: next } })
  },

  async rename(sessionId, title) {
    const next = await api().sessionRename(sessionId, title)
    set({ sessions: { ...get().sessions, [next.id]: next } })
  },

  async deleteSession(sessionId) {
    await api().sessionDelete(sessionId)
  },

  async handoff(sessionId, to) {
    const from = get().sessions[sessionId]
    if (!from) return
    const items = get().items[sessionId] ?? []
    const lastUser = [...items].reverse().find((i) => i.kind === 'user')
    const lastAssistant = [...items].reverse().find((i) => i.kind === 'assistant' && i.text.trim())
    const fromName = from.agent === 'claude' ? 'Claude Code' : 'Codex'
    const prompt = [
      `You are taking over a task from ${fromName} in this same project. Review the current state of the files before acting.`,
      lastUser ? `\nOriginal request:\n${(lastUser as { text: string }).text}` : '',
      lastAssistant ? `\n${fromName}'s last update:\n${(lastAssistant as { text: string }).text.slice(0, 6000)}` : '',
      '\nContinue from here. Verify what was done, finish anything left, and report what you changed.'
    ].join('\n')
    const id = await get().createSessions({ cwd: from.cwd, policy: from.policy, capabilities: from.capabilities, title: `${from.title} → ${to === 'claude' ? 'Claude' : 'Codex'}` }, to, prompt)
    if (id) await get().openSession(id)
  },

  async openTerminal(spec) {
    const t = await api().terminalOpen(spec)
    set({ terminals: [...get().terminals.filter((x) => x.id !== t.id), t], activeTermId: t.id, terminalOpen: true })
    return t.id
  },

  async closeTerminal(id) {
    await api().terminalClose(id)
    const rest = get().terminals.filter((t) => t.id !== id)
    set({ terminals: rest, activeTermId: get().activeTermId === id ? rest[0]?.id : get().activeTermId, terminalOpen: rest.length > 0 && get().terminalOpen })
  },

  setActiveTerm(id) {
    set({ activeTermId: id })
  },

  toggleTerminalPane(open) {
    set({ terminalOpen: open ?? !get().terminalOpen })
  },

  async openBrowser(url) {
    const state = await api().browserOpen(url)
    set({ browser: state, browserOpen: true })
  },

  async closeBrowser() {
    await api().browserClose()
    set({ browserOpen: false })
  },

  async updateSettings(patch) {
    const settings = await api().settingsSet(patch)
    if (patch.theme) document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme
    set({ settings })
    if (patch.licenseKey !== undefined) set({ license: await api().licenseGet() })
  },

  async activateLicense(key) {
    const license = await api().licenseActivate(key)
    set({ license })
    return license
  },

  toast(level, text) {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, level, text }] })
    setTimeout(() => get().dismissToast(id), level === 'error' ? 9000 : 5000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  pairOf(sessionId) {
    const s = get().sessions[sessionId]
    if (!s) return []
    if (!s.pairId) return [s]
    return Object.values(get().sessions)
      .filter((x) => x.pairId === s.pairId)
      .sort((a, b) => (a.agent === 'claude' ? -1 : 1) - (b.agent === 'claude' ? -1 : 1))
  }
}))

let audioCtx: AudioContext | undefined
function ping(): void {
  try {
    audioCtx ??= new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.0001
    o.connect(g)
    g.connect(audioCtx.destination)
    const t = audioCtx.currentTime
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    o.start(t)
    o.stop(t + 0.4)
  } catch {
    /* ignore */
  }
}
