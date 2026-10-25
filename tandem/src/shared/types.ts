/**
 * Tandem shared types.
 * Everything that crosses the IPC boundary (main <-> renderer) is defined here so both
 * sides compile against one contract.
 */

export type AgentKind = 'claude' | 'codex'

export const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

/** Unified permission posture. Each adapter maps this to its native knobs. */
export type PolicyMode =
  | 'ask' // Claude: default (prompt for anything risky). Codex: on-request + workspace-write sandbox
  | 'auto-edit' // Claude: acceptEdits. Codex: on-request + workspace-write (edits never prompt)
  | 'full-auto' // Claude: bypassPermissions. Codex: approval never + danger-full-access
  | 'plan' // Claude: plan mode (read-only). Codex: read-only sandbox, on-request approvals

export const POLICY_LABEL: Record<PolicyMode, string> = {
  ask: 'Ask first',
  'auto-edit': 'Auto-edit',
  'full-auto': 'Full auto',
  plan: 'Plan / read-only'
}

export interface Capabilities {
  /** Let the agent see and control the screen (macOS). */
  computerUse: boolean
  /** Let the agent drive a browser (Codex browser_use / Claude in Chrome). */
  browserUse: boolean
  /** Let the agent reach the network from its sandbox (Codex) / web tools (Claude). */
  webAccess: boolean
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  computerUse: false,
  browserUse: false,
  webAccess: true
}

export interface AgentModel {
  id: string
  label: string
  description?: string
  efforts?: string[]
  isDefault?: boolean
}

export interface UsageWindow {
  label: string
  usedPercent: number
  resetsAt?: number | null
}

export interface AccountState {
  agent: AgentKind
  installed: boolean
  binaryPath?: string
  version?: string
  loggedIn: boolean
  email?: string
  plan?: string
  authMethod?: string
  usage?: UsageWindow[]
  /** Human readable problem (binary missing, not logged in, etc.) */
  problem?: string
  computerUseAvailable: boolean
  computerUseNote?: string
}

export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting-approval' | 'error' | 'closed'

export interface SessionMeta {
  id: string
  agent: AgentKind
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  model?: string
  effort?: string
  policy: PolicyMode
  capabilities: Capabilities
  /** The agent's own id for this conversation (Claude session_id / Codex thread id). */
  nativeId?: string
  /** When a prompt was fanned out to both agents this links the twin session. */
  pairId?: string
  lastError?: string
  totalCostUsd?: number
  tokensIn?: number
  tokensOut?: number
  contextPercent?: number
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

interface BaseItem {
  id: string
  sessionId: string
  agent: AgentKind
  ts: number
}

export interface UserItem extends BaseItem {
  kind: 'user'
  text: string
  images?: string[]
}

export interface AssistantItem extends BaseItem {
  kind: 'assistant'
  text: string
  streaming: boolean
  model?: string
}

export interface ReasoningItem extends BaseItem {
  kind: 'reasoning'
  text: string
  streaming: boolean
}

export type ToolStatus = 'running' | 'done' | 'error' | 'declined'

export interface ToolItem extends BaseItem {
  kind: 'tool'
  tool: string
  /** short human description e.g. the command or file path */
  summary: string
  input?: unknown
  output?: string
  status: ToolStatus
  durationMs?: number
  category: 'command' | 'edit' | 'read' | 'search' | 'web' | 'computer' | 'browser' | 'mcp' | 'agent' | 'other'
  /** For edits: unified diff text */
  diff?: string
  exitCode?: number | null
}

export type ApprovalKind = 'command' | 'file-change' | 'permission' | 'tool' | 'question' | 'plan' | 'other'

export interface ApprovalOption {
  id: string
  label: string
  description?: string
  tone?: 'primary' | 'neutral' | 'danger'
}

export interface QuestionSpec {
  id: string
  header?: string
  question: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

export interface ApprovalItem extends BaseItem {
  kind: 'approval'
  approvalKind: ApprovalKind
  title: string
  detail?: string
  input?: unknown
  diff?: string
  options: ApprovalOption[]
  /** For AskUserQuestion / request_user_input */
  questions?: QuestionSpec[]
  resolved?: { optionId: string; answers?: Record<string, string | string[]>; message?: string }
  /** Opaque adapter handle used to answer the request */
  requestRef: string
  /** Why the agent needs this (classifier reason etc) */
  reason?: string
  warn?: string
}

export interface StatusItem extends BaseItem {
  kind: 'status'
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface ResultItem extends BaseItem {
  kind: 'result'
  ok: boolean
  summary?: string
  costUsd?: number
  durationMs?: number
  tokensIn?: number
  tokensOut?: number
}

export type TimelineItem =
  | UserItem
  | AssistantItem
  | ReasoningItem
  | ToolItem
  | ApprovalItem
  | StatusItem
  | ResultItem

export type TimelineEvent =
  | { type: 'upsert'; sessionId: string; item: TimelineItem }
  | { type: 'append'; sessionId: string; itemId: string; delta: string; field?: 'text' | 'output' }
  | { type: 'session'; session: SessionMeta }
  | { type: 'session-removed'; sessionId: string }
  | { type: 'accounts'; accounts: Record<AgentKind, AccountState> }
  | { type: 'terminal-data'; termId: string; data: string }
  | { type: 'terminal-exit'; termId: string; code: number }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; text: string }

export interface ApprovalResponse {
  sessionId: string
  itemId: string
  optionId: string
  answers?: Record<string, string | string[]>
  message?: string
}

export interface NewSessionInput {
  agent: AgentKind
  cwd: string
  title?: string
  model?: string
  effort?: string
  policy?: PolicyMode
  capabilities?: Partial<Capabilities>
  pairId?: string
  resumeNativeId?: string
}

export interface SendInput {
  sessionId: string
  text: string
  images?: string[]
}

export interface TerminalSpec {
  id: string
  title: string
  cwd: string
  agent?: AgentKind
  purpose: 'shell' | 'claude-interactive' | 'codex-interactive' | 'claude-login' | 'codex-login'
}

export interface LicenseState {
  status: 'licensed' | 'trial' | 'expired' | 'invalid'
  licensee?: string
  edition?: string
  issuedAt?: number
  trialDaysLeft?: number
  message?: string
}

export interface Settings {
  theme: 'system' | 'dark' | 'light'
  defaultPolicy: PolicyMode
  defaultCwd?: string
  claudeBinary?: string
  codexBinary?: string
  claudeModel?: string
  codexModel?: string
  codexEffort?: string
  showReasoning: boolean
  soundOnApproval: boolean
  trialStartedAt?: number
  licenseKey?: string
  recentFolders: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultPolicy: 'ask',
  showReasoning: true,
  soundOnApproval: true,
  recentFolders: []
}

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  arch: string
  userDataPath: string
  isMac: boolean
}
