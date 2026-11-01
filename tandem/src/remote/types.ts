import type { AccountState, AgentKind, AgentModel, ApprovalResponse, NewSessionInput, PolicyMode, SessionMeta, TimelineEvent, TimelineItem } from '@shared/types'

export interface RemoteState {
  version: string
  accounts: Record<AgentKind, AccountState>
  sessions: SessionMeta[]
  recentFolders: string[]
  defaultCwd?: string
  defaultPolicy: PolicyMode
  shareScreen: boolean
}

/** What the phone app needs from "the Mac". live.ts talks to Tandem; mock.ts simulates it for the demo. */
export interface RemoteApi {
  state(): Promise<RemoteState>
  items(id: string): Promise<TimelineItem[]>
  send(id: string, text: string): Promise<{ ok: true }>
  interrupt(id: string): Promise<{ ok: true }>
  policy(id: string, policy: PolicyMode): Promise<SessionMeta>
  approve(resp: ApprovalResponse): Promise<{ ok: true }>
  create(input: NewSessionInput & { text?: string }): Promise<SessionMeta>
  models(agent: AgentKind): Promise<AgentModel[]>
  /** A frame of the Mac screen or the Tandem browser: an image URL, or why there is none. */
  frame(src: 'screen' | 'browser'): Promise<{ url?: string; error?: string }>
  events(onEvent: (ev: TimelineEvent) => void, onStatus: (ok: boolean) => void): () => void
}
