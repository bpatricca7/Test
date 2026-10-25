import type {
  AccountState,
  AgentKind,
  AgentModel,
  AppInfo,
  ApprovalResponse,
  LicenseState,
  NewSessionInput,
  PolicyMode,
  SendInput,
  SessionMeta,
  Settings,
  TerminalSpec,
  TimelineEvent,
  TimelineItem,
  Capabilities
} from './types'

export const IPC = {
  // app
  appInfo: 'app:info',
  pickFolder: 'app:pick-folder',
  openExternal: 'app:open-external',
  openPath: 'app:open-path',
  // accounts
  accountsGet: 'accounts:get',
  accountsRefresh: 'accounts:refresh',
  accountLogin: 'accounts:login',
  accountLogout: 'accounts:logout',
  modelsList: 'accounts:models',
  // sessions
  sessionsList: 'sessions:list',
  sessionCreate: 'sessions:create',
  sessionItems: 'sessions:items',
  sessionSend: 'sessions:send',
  sessionInterrupt: 'sessions:interrupt',
  sessionApprove: 'sessions:approve',
  sessionSetPolicy: 'sessions:set-policy',
  sessionSetModel: 'sessions:set-model',
  sessionSetCapabilities: 'sessions:set-capabilities',
  sessionRename: 'sessions:rename',
  sessionDelete: 'sessions:delete',
  sessionClose: 'sessions:close',
  // terminals
  terminalOpen: 'terminal:open',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalClose: 'terminal:close',
  terminalList: 'terminal:list',
  // settings / license
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  licenseGet: 'license:get',
  licenseActivate: 'license:activate',
  // events main -> renderer
  event: 'tandem:event'
} as const

export interface TandemApi {
  appInfo(): Promise<AppInfo>
  pickFolder(defaultPath?: string): Promise<string | null>
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>

  accountsGet(): Promise<Record<AgentKind, AccountState>>
  accountsRefresh(): Promise<Record<AgentKind, AccountState>>
  /** Starts a sign-in flow. Returns a url to open (Codex) or a terminal id (Claude). */
  accountLogin(agent: AgentKind): Promise<{ url?: string; termId?: string; message?: string }>
  accountLogout(agent: AgentKind): Promise<void>
  modelsList(agent: AgentKind): Promise<AgentModel[]>

  sessionsList(): Promise<SessionMeta[]>
  sessionCreate(input: NewSessionInput): Promise<SessionMeta>
  sessionItems(sessionId: string): Promise<TimelineItem[]>
  sessionSend(input: SendInput): Promise<void>
  sessionInterrupt(sessionId: string): Promise<void>
  sessionApprove(resp: ApprovalResponse): Promise<void>
  sessionSetPolicy(sessionId: string, policy: PolicyMode): Promise<SessionMeta>
  sessionSetModel(sessionId: string, model: string, effort?: string): Promise<SessionMeta>
  sessionSetCapabilities(sessionId: string, caps: Partial<Capabilities>): Promise<SessionMeta>
  sessionRename(sessionId: string, title: string): Promise<SessionMeta>
  sessionDelete(sessionId: string): Promise<void>
  sessionClose(sessionId: string): Promise<void>

  terminalOpen(spec: Omit<TerminalSpec, 'id'> & { id?: string; cols?: number; rows?: number; initialInput?: string }): Promise<TerminalSpec>
  terminalWrite(termId: string, data: string): Promise<void>
  terminalResize(termId: string, cols: number, rows: number): Promise<void>
  terminalClose(termId: string): Promise<void>
  terminalList(): Promise<TerminalSpec[]>

  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>
  licenseGet(): Promise<LicenseState>
  licenseActivate(key: string): Promise<LicenseState>

  onEvent(handler: (ev: TimelineEvent) => void): () => void
}
