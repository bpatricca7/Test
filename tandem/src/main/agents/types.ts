import type {
  AgentKind,
  AgentModel,
  ApprovalResponse,
  Capabilities,
  PolicyMode,
  SessionMeta,
  TimelineEvent
} from '@shared/types'

/** Emitted by adapters; the SessionManager fans these out to the renderer and persists items. */
export type AdapterEmit = (ev: TimelineEvent) => void

export interface AgentSessionHandle {
  readonly agent: AgentKind
  readonly sessionId: string
  /** Start the underlying process / thread. Resolves when ready to accept input. */
  start(): Promise<void>
  send(text: string, images?: string[]): Promise<void>
  interrupt(): Promise<void>
  respondApproval(resp: ApprovalResponse): Promise<void>
  setPolicy(policy: PolicyMode): Promise<void>
  setModel(model: string, effort?: string): Promise<void>
  setCapabilities(caps: Capabilities): Promise<void>
  close(): Promise<void>
  meta: SessionMeta
}

export interface AgentAdapter {
  readonly kind: AgentKind
  listModels(): Promise<AgentModel[]>
}
