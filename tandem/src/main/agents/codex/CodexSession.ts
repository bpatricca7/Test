/**
 * Codex adapter: one app-server thread per Tandem session.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ApprovalItem,
  ApprovalResponse,
  AssistantItem,
  Capabilities,
  PolicyMode,
  ReasoningItem,
  SessionMeta,
  TimelineItem,
  ToolItem
} from '@shared/types'
import { codexPolicy } from '@shared/policy'
import type { AdapterEmit, AgentSessionHandle } from '../types'
import { now, truncate, uid } from '../../util'
import type { CodexServer, RpcServerRequest } from './CodexServer'

type Json = Record<string, unknown>

export interface CodexSessionOptions {
  server: CodexServer
  meta: SessionMeta
  emit: AdapterEmit
  onMeta: (patch: Partial<SessionMeta>) => void
}

function categorizeCodex(item: Json): ToolItem['category'] {
  const t = String(item.type)
  if (t === 'commandExecution') return 'command'
  if (t === 'fileChange') return 'edit'
  if (t === 'webSearch') return 'web'
  if (t === 'collabAgentToolCall' || t === 'subAgentActivity') return 'agent'
  if (t === 'imageView') return 'read'
  const name = `${String(item.server ?? '')}/${String(item.tool ?? '')}/${String(item.namespace ?? '')}`.toLowerCase()
  if (/computer|screen|desktop|click|keyboard|mouse|gui/.test(name)) return 'computer'
  if (/browser|chrome|page|tab|navigate/.test(name)) return 'browser'
  if (t === 'mcpToolCall') return 'mcp'
  return 'other'
}

/** Chrome DevTools MCP (github.com/ChromeDevTools/chrome-devtools-mcp): navigate, click, fill, screenshot, console, network. */
export const CHROME_DEVTOOLS_MCP = { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }

export class CodexSession implements AgentSessionHandle {
  readonly agent = 'codex' as const
  readonly sessionId: string
  meta: SessionMeta
  private readonly server: CodexServer
  private readonly emit: AdapterEmit
  private readonly onMeta: (patch: Partial<SessionMeta>) => void
  private threadId?: string
  private activeTurnId?: string
  private started = false
  private approvals = new Map<string, { item: ApprovalItem; rpcId: number | string; method: string; params: Json }>()
  private items = new Map<string, TimelineItem>() // codex item id -> timeline item
  private reasoningText = new Map<string, string>()
  private readonly onNotification = (n: { method: string; params: Json }): void => this.handleNotification(n.method, n.params)
  private readonly onServerRequest = (r: RpcServerRequest): void => this.handleServerRequest(r)
  private readonly onExit = (): void => {
    this.started = false
    this.threadId = undefined
    if (this.activeTurnId) {
      this.status('warn', 'Codex app-server exited mid-turn. It restarts on your next message.')
      this.activeTurnId = undefined
    }
    this.onMeta({ status: 'idle' })
  }

  constructor(opts: CodexSessionOptions) {
    this.server = opts.server
    this.meta = opts.meta
    this.sessionId = opts.meta.id
    this.emit = opts.emit
    this.onMeta = opts.onMeta
  }

  private threadConfig(): Json {
    const caps = this.meta.capabilities
    const features: Json = {}
    features.computer_use = caps.computerUse
    features.browser_use = caps.browserUse
    const cfg: Json = { features }
    if (caps.browserUse) {
      // Codex's native Browser backend is granted only to the Codex desktop app (code-signed native
      // pipe), so app-server clients get "Browser is not available: extension". Bridge Codex to a
      // real Chrome through Google's Chrome DevTools MCP server instead.
      cfg.mcp_servers = { chrome_devtools: CHROME_DEVTOOLS_MCP }
    }
    if (!caps.webAccess) cfg.web_search = 'disabled'
    return cfg
  }

  private developerInstructions(): string | undefined {
    const caps = this.meta.capabilities
    const bits: string[] = []
    if (caps.computerUse) bits.push('The user has explicitly enabled computer use for this session. When a task needs a GUI (native apps, visual checks, anything without a CLI or API), use the computer-use tools to see and control the screen instead of saying you cannot.')
    if (caps.browserUse)
      bits.push(
        'The user has enabled browser use. Your built-in Browser tool is not available in this host; use the chrome_devtools MCP tools instead (navigate_page, take_snapshot, take_screenshot, click, fill, press_key, evaluate_script, list_console_messages, list_network_requests). They control a real Chrome window on the user\'s machine.'
      )
    return bits.length ? bits.join('\n') : undefined
  }

  async start(): Promise<void> {
    if (this.started && this.threadId) return
    await this.server.ensureStarted()
    this.server.on('notification', this.onNotification)
    this.server.on('server-request', this.onServerRequest)
    this.server.on('exit', this.onExit)
    const { approvalPolicy, sandbox } = codexPolicy(this.meta.policy)
    const base: Json = {
      cwd: this.meta.cwd,
      approvalPolicy,
      sandbox,
      config: this.threadConfig()
    }
    if (this.meta.model) base.model = this.meta.model
    const dev = this.developerInstructions()
    if (dev) base.developerInstructions = dev
    let res: Json
    if (this.meta.nativeId) {
      try {
        res = await this.server.request<Json>('thread/resume', { threadId: this.meta.nativeId, excludeTurns: true, ...base })
      } catch (e) {
        this.status('warn', `Could not resume Codex thread (${(e as Error).message}); starting a fresh one.`)
        res = await this.server.request<Json>('thread/start', base)
      }
    } else {
      res = await this.server.request<Json>('thread/start', base)
    }
    const thread = (res.thread ?? {}) as Json
    this.threadId = String(thread.id)
    this.started = true
    const patch: Partial<SessionMeta> = { nativeId: this.threadId, status: 'idle' }
    if (res.model) patch.model = String(res.model)
    if (res.reasoningEffort) patch.effort = String(res.reasoningEffort)
    this.onMeta(patch)
  }

  async close(): Promise<void> {
    this.server.off('notification', this.onNotification)
    this.server.off('server-request', this.onServerRequest)
    this.server.off('exit', this.onExit)
    if (this.threadId && this.server.running) {
      try {
        await this.server.request('thread/unsubscribe', { threadId: this.threadId }, 5000)
      } catch {
        /* ignore */
      }
    }
    this.started = false
  }

  async send(text: string, images?: string[]): Promise<void> {
    if (!this.started || !this.threadId) await this.start()
    const input: Json[] = []
    if (images?.length) {
      const dir = join(tmpdir(), 'tandem-images')
      mkdirSync(dir, { recursive: true })
      for (const img of images) {
        const m = /^data:(image\/([a-zA-Z0-9.+-]+));base64,(.*)$/s.exec(img)
        if (!m) continue
        const ext = m[2] === 'jpeg' ? 'jpg' : m[2]
        const p = join(dir, `${uid()}.${ext}`)
        writeFileSync(p, Buffer.from(m[3], 'base64'))
        input.push({ type: 'localImage', path: p })
      }
    }
    input.push({ type: 'text', text, text_elements: [] })
    const { approvalPolicy } = codexPolicy(this.meta.policy)
    const params: Json = { threadId: this.threadId, input, approvalPolicy, sandboxPolicy: this.sandboxPolicy() }
    if (this.meta.effort) params.effort = this.meta.effort
    if (this.meta.model) params.model = this.meta.model
    this.onMeta({ status: 'running' })
    if (this.activeTurnId) {
      // A turn is in flight: steer it instead of queueing a brand new one.
      try {
        await this.server.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.activeTurnId })
        return
      } catch {
        /* fall through to a new turn */
      }
    }
    const res = await this.server.request<Json>('turn/start', params)
    const turn = (res.turn ?? {}) as Json
    this.activeTurnId = String(turn.id)
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.activeTurnId) return
    try {
      await this.server.request('turn/interrupt', { threadId: this.threadId, turnId: this.activeTurnId }, 10000)
    } catch {
      /* ignore */
    }
    for (const [itemId, a] of this.approvals) {
      a.item.resolved = { optionId: 'cancel', message: 'Interrupted' }
      this.upsert(a.item)
      try {
        this.server.respond(a.rpcId, { decision: 'cancel' })
      } catch {
        /* ignore */
      }
      this.approvals.delete(itemId)
    }
  }

  async respondApproval(resp: ApprovalResponse): Promise<void> {
    const a = this.approvals.get(resp.itemId)
    if (!a) throw new Error('Approval request no longer pending')
    this.approvals.delete(resp.itemId)
    const { item, rpcId, method, params } = a
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const map: Record<string, string> = { allow: 'accept', always: 'acceptForSession', deny: 'decline', cancel: 'cancel' }
      const decision = map[resp.optionId] ?? 'decline'
      this.server.respond(rpcId, { decision })
      item.resolved = { optionId: resp.optionId, message: resp.message }
    } else if (method === 'item/permissions/requestApproval') {
      if (resp.optionId === 'allow' || resp.optionId === 'always') {
        const requested = (params.permissions ?? {}) as Json
        const granted: Json = {}
        if (requested.network) granted.network = requested.network
        if (requested.fileSystem) granted.fileSystem = requested.fileSystem
        this.server.respond(rpcId, { permissions: granted, scope: resp.optionId === 'always' ? 'session' : 'turn' })
      } else {
        this.server.respond(rpcId, { permissions: {}, scope: 'turn' })
      }
      item.resolved = { optionId: resp.optionId }
    } else if (method === 'item/tool/requestUserInput') {
      const answers: Record<string, { answers: string[] }> = {}
      for (const q of item.questions ?? []) {
        const v = resp.answers?.[q.id]
        if (v === undefined) continue
        answers[q.id] = { answers: Array.isArray(v) ? v : [v] }
      }
      this.server.respond(rpcId, { answers })
      item.resolved = { optionId: 'answered', answers: resp.answers }
    } else if (method === 'mcpServer/elicitation/request') {
      if (resp.optionId === 'allow') this.server.respond(rpcId, { action: 'accept', content: resp.answers ?? {}, _meta: null })
      else this.server.respond(rpcId, { action: resp.optionId === 'cancel' ? 'cancel' : 'decline', content: null, _meta: null })
      item.resolved = { optionId: resp.optionId }
    } else {
      this.server.respondError(rpcId, 'unsupported by Tandem')
      item.resolved = { optionId: 'deny' }
    }
    this.upsert(item)
    if (this.approvals.size === 0) this.onMeta({ status: this.activeTurnId ? 'running' : 'idle' })
  }

  async setPolicy(policy: PolicyMode): Promise<void> {
    // There is no thread-level settings RPC; turn/start carries approvalPolicy/sandboxPolicy
    // overrides that persist "for this turn and subsequent turns", so the next send applies it.
    this.meta = { ...this.meta, policy }
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.meta = { ...this.meta, model, effort: effort ?? this.meta.effort }
  }

  /** Full SandboxPolicy object for turn/start (thread/start takes the short SandboxMode form). */
  private sandboxPolicy(): Json {
    const { sandbox } = codexPolicy(this.meta.policy)
    const net = this.meta.capabilities.webAccess
    if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
    if (sandbox === 'read-only') return { type: 'readOnly', networkAccess: net }
    return { type: 'workspaceWrite', writableRoots: [], networkAccess: net, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  }

  async setCapabilities(caps: Capabilities): Promise<void> {
    const changed = JSON.stringify(caps) !== JSON.stringify(this.meta.capabilities)
    this.meta = { ...this.meta, capabilities: caps }
    if (changed && this.threadId) {
      // Feature flags are read when the thread is created; re-create the thread (same history via resume).
      const nativeId = this.threadId
      await this.close()
      this.meta = { ...this.meta, nativeId }
      this.started = false
      this.threadId = undefined
      await this.start()
    }
  }

  // -----------------------------------------------------------------------
  // inbound
  // -----------------------------------------------------------------------

  private status(level: 'info' | 'warn' | 'error', text: string): void {
    this.upsert({ id: uid(), sessionId: this.sessionId, agent: 'codex', ts: now(), kind: 'status', level, text })
  }

  private upsert(item: TimelineItem): void {
    this.emit({ type: 'upsert', sessionId: this.sessionId, item })
  }

  private mine(params: Json): boolean {
    return Boolean(this.threadId) && String(params.threadId ?? (params.thread as Json | undefined)?.id ?? '') === this.threadId
  }

  private handleNotification(method: string, params: Json): void {
    if (!this.mine(params)) return
    switch (method) {
      case 'turn/started': {
        const turn = (params.turn ?? {}) as Json
        this.activeTurnId = String(turn.id)
        this.onMeta({ status: 'running' })
        return
      }
      case 'turn/completed': {
        const turn = (params.turn ?? {}) as Json
        const status = String(turn.status ?? 'completed')
        const err = turn.error as Json | null
        this.activeTurnId = undefined
        this.upsert({
          id: uid(),
          sessionId: this.sessionId,
          agent: 'codex',
          ts: now(),
          kind: 'result',
          ok: status === 'completed',
          summary: status === 'completed' ? undefined : err?.message ? String(err.message) : status,
          durationMs: turn.durationMs ? Number(turn.durationMs) : undefined
        })
        this.onMeta({ status: status === 'failed' ? 'error' : 'idle', lastError: err?.message ? String(err.message) : undefined })
        return
      }
      case 'item/started':
      case 'item/completed': {
        this.handleItem((params.item ?? {}) as Json, method === 'item/completed')
        return
      }
      case 'item/agentMessage/delta': {
        const id = String(params.itemId)
        const existing = this.items.get(id)
        if (!existing) {
          const item: AssistantItem = { id: this.tid(id), sessionId: this.sessionId, agent: 'codex', ts: now(), kind: 'assistant', text: String(params.delta ?? ''), streaming: true, model: this.meta.model }
          this.items.set(id, item)
          this.upsert(item)
        } else if (existing.kind === 'assistant') {
          existing.text += String(params.delta ?? '')
          this.emit({ type: 'append', sessionId: this.sessionId, itemId: existing.id, delta: String(params.delta ?? ''), field: 'text' })
        }
        return
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const id = String(params.itemId)
        const delta = String(params.delta ?? '')
        const existing = this.items.get(id)
        if (!existing) {
          const item: ReasoningItem = { id: this.tid(id), sessionId: this.sessionId, agent: 'codex', ts: now(), kind: 'reasoning', text: delta, streaming: true }
          this.items.set(id, item)
          this.upsert(item)
        } else if (existing.kind === 'reasoning') {
          existing.text += delta
          this.emit({ type: 'append', sessionId: this.sessionId, itemId: existing.id, delta, field: 'text' })
        }
        return
      }
      case 'item/reasoning/summaryPartAdded': {
        const id = String(params.itemId)
        const existing = this.items.get(id)
        if (existing?.kind === 'reasoning' && existing.text && !existing.text.endsWith('\n\n')) {
          existing.text += '\n\n'
          this.emit({ type: 'append', sessionId: this.sessionId, itemId: existing.id, delta: '\n\n', field: 'text' })
        }
        return
      }
      case 'item/commandExecution/outputDelta':
      case 'item/fileChange/outputDelta': {
        const id = String(params.itemId)
        const existing = this.items.get(id)
        if (existing?.kind === 'tool') {
          existing.output = truncate((existing.output ?? '') + String(params.delta ?? ''), 20000)
          this.emit({ type: 'append', sessionId: this.sessionId, itemId: existing.id, delta: String(params.delta ?? ''), field: 'output' })
        }
        return
      }
      case 'item/plan/delta': {
        const id = String(params.itemId)
        const existing = this.items.get(id)
        if (existing?.kind === 'assistant') {
          existing.text += String(params.delta ?? '')
          this.emit({ type: 'append', sessionId: this.sessionId, itemId: existing.id, delta: String(params.delta ?? ''), field: 'text' })
        }
        return
      }
      case 'thread/tokenUsage/updated': {
        const u = (params.tokenUsage ?? {}) as Json
        const total = (u.total ?? {}) as Json
        const ctx = u.modelContextWindow ? Number(u.modelContextWindow) : undefined
        const last = (u.last ?? {}) as Json
        const used = Number(last.totalTokens ?? total.totalTokens ?? 0)
        this.onMeta({
          tokensIn: Number(total.inputTokens ?? 0) + Number(total.cachedInputTokens ?? 0),
          tokensOut: Number(total.outputTokens ?? 0),
          contextPercent: ctx ? Math.min(100, Math.round((used / ctx) * 100)) : undefined
        })
        return
      }
      case 'error': {
        const err = (params.error ?? {}) as Json
        this.status(params.willRetry ? 'warn' : 'error', `${String(err.message ?? 'Codex error')}${params.willRetry ? ' (retrying)' : ''}`)
        return
      }
      case 'warning':
      case 'guardianWarning': {
        this.status('warn', String(params.message ?? params.summary ?? JSON.stringify(params)))
        return
      }
      case 'thread/status/changed':
      case 'turn/diff/updated':
      case 'thread/name/updated': {
        if (method === 'thread/name/updated' && params.name && this.meta.title.startsWith('New ')) this.onMeta({ title: String(params.name) })
        return
      }
      default:
        return
    }
  }

  /** Stable Tandem item id for a Codex item id. */
  private tid(codexId: string): string {
    return `cx-${codexId}`
  }

  private handleItem(ci: Json, completed: boolean): void {
    const codexId = String(ci.id ?? uid())
    const t = String(ci.type ?? '')
    const existing = this.items.get(codexId)
    const base = { id: this.tid(codexId), sessionId: this.sessionId, agent: 'codex' as const, ts: existing?.ts ?? now() }
    switch (t) {
      case 'userMessage':
        return // we already rendered the user's own message
      case 'agentMessage':
      case 'plan': {
        const item: AssistantItem = { ...base, kind: 'assistant', text: String(ci.text ?? (existing?.kind === 'assistant' ? existing.text : '')), streaming: !completed, model: this.meta.model }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'reasoning': {
        const summary = (ci.summary ?? []) as string[]
        const content = (ci.content ?? []) as string[]
        const text = completed ? [summary.join('\n\n'), content.join('\n\n')].filter(Boolean).join('\n\n') || (existing?.kind === 'reasoning' ? existing.text : '') : existing?.kind === 'reasoning' ? existing.text : ''
        const item: ReasoningItem = { ...base, kind: 'reasoning', text, streaming: !completed }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'commandExecution': {
        const status = String(ci.status ?? 'inProgress')
        const item: ToolItem = {
          ...base,
          kind: 'tool',
          tool: 'shell',
          category: 'command',
          summary: String(ci.command ?? ''),
          input: { command: ci.command, cwd: ci.cwd },
          output: ci.aggregatedOutput ? truncate(String(ci.aggregatedOutput), 20000) : existing?.kind === 'tool' ? existing.output : undefined,
          status: status === 'completed' ? 'done' : status === 'failed' ? 'error' : status === 'declined' ? 'declined' : 'running',
          exitCode: ci.exitCode as number | null,
          durationMs: ci.durationMs ? Number(ci.durationMs) : undefined
        }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'fileChange': {
        const changes = (ci.changes ?? []) as Json[]
        const status = String(ci.status ?? 'inProgress')
        const files = changes.map((c) => String(c.path))
        const diff = changes.map((c) => `--- ${String(c.kind ?? 'update')} ${String(c.path)}\n${String(c.diff ?? '')}`).join('\n')
        const item: ToolItem = {
          ...base,
          kind: 'tool',
          tool: 'apply_patch',
          category: 'edit',
          summary: files.length === 1 ? files[0] : `${files.length} files`,
          input: { files },
          diff,
          status: status === 'completed' ? 'done' : status === 'failed' ? 'error' : status === 'declined' ? 'declined' : 'running'
        }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'mcpToolCall':
      case 'dynamicToolCall': {
        const status = String(ci.status ?? 'inProgress')
        const result = ci.result as Json | null
        const err = ci.error as Json | null
        let output: string | undefined
        if (result?.content) output = truncate((result.content as Json[]).map((c) => (c.type === 'text' ? String(c.text ?? '') : `[${String(c.type)}]`)).join('\n'), 20000)
        if (ci.contentItems) output = truncate((ci.contentItems as Json[]).map((c) => (c.type === 'inputText' ? String(c.text ?? '') : `[${String(c.type)}]`)).join('\n'), 20000)
        if (err?.message) output = String(err.message)
        const toolName = t === 'mcpToolCall' ? `${String(ci.server)}/${String(ci.tool)}` : String(ci.tool ?? 'tool')
        const item: ToolItem = {
          ...base,
          kind: 'tool',
          tool: toolName,
          category: categorizeCodex(ci),
          summary: truncate(JSON.stringify(ci.arguments ?? {}), 140),
          input: ci.arguments,
          output,
          status: status === 'completed' || ci.success === true ? 'done' : status === 'failed' || ci.success === false ? 'error' : 'running',
          durationMs: ci.durationMs ? Number(ci.durationMs) : undefined
        }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'webSearch': {
        const item: ToolItem = { ...base, kind: 'tool', tool: 'web_search', category: 'web', summary: String(ci.query ?? ''), status: completed ? 'done' : 'running' }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'imageView': {
        const item: ToolItem = { ...base, kind: 'tool', tool: 'view_image', category: 'read', summary: String(ci.path ?? ''), status: 'done' }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'collabAgentToolCall':
      case 'subAgentActivity': {
        const item: ToolItem = {
          ...base,
          kind: 'tool',
          tool: t === 'collabAgentToolCall' ? `agent/${String(ci.tool ?? '')}` : 'subagent',
          category: 'agent',
          summary: String(ci.prompt ?? ci.kind ?? '').slice(0, 140),
          status: completed ? 'done' : 'running'
        }
        this.items.set(codexId, item)
        this.upsert(item)
        return
      }
      case 'contextCompaction':
        if (completed) this.status('info', 'Context compacted')
        return
      case 'enteredReviewMode':
        this.status('info', 'Entered review mode')
        return
      case 'exitedReviewMode':
        this.status('info', 'Exited review mode')
        return
      default:
        return
    }
  }

  private handleServerRequest(r: RpcServerRequest): void {
    const p = r.params
    if (!this.mine(p)) return
    const id = uid()
    const base = { id, sessionId: this.sessionId, agent: 'codex' as const, ts: now(), kind: 'approval' as const, requestRef: String(r.id) }
    let item: ApprovalItem | undefined
    switch (r.method) {
      case 'item/commandExecution/requestApproval': {
        const cmd = String(p.command ?? '')
        const reason = p.reason ? String(p.reason) : undefined
        const kind = String(p.kind ?? 'command')
        item = {
          ...base,
          approvalKind: 'command',
          title: kind === 'command' ? 'Codex wants to run a command' : `Codex requests ${kind}`,
          detail: cmd || reason || '',
          input: { command: cmd, cwd: p.cwd },
          reason,
          options: [
            { id: 'allow', label: 'Allow once', tone: 'primary' },
            { id: 'always', label: 'Allow for session' },
            { id: 'deny', label: 'Deny', tone: 'danger' }
          ]
        }
        break
      }
      case 'item/fileChange/requestApproval': {
        const existing = this.items.get(String(p.itemId))
        item = {
          ...base,
          approvalKind: 'file-change',
          title: 'Codex wants to edit files',
          detail: p.reason ? String(p.reason) : existing?.kind === 'tool' ? existing.summary : undefined,
          diff: existing?.kind === 'tool' ? existing.diff : undefined,
          options: [
            { id: 'allow', label: 'Apply', tone: 'primary' },
            { id: 'always', label: 'Apply for session' },
            { id: 'deny', label: 'Decline', tone: 'danger' }
          ]
        }
        break
      }
      case 'item/permissions/requestApproval': {
        const perms = (p.permissions ?? {}) as Json
        const parts: string[] = []
        if (perms.network) parts.push(`network: ${truncate(JSON.stringify(perms.network), 200)}`)
        if (perms.fileSystem) parts.push(`files: ${truncate(JSON.stringify(perms.fileSystem), 200)}`)
        item = {
          ...base,
          approvalKind: 'permission',
          title: 'Codex requests extra permissions',
          detail: [p.reason ? String(p.reason) : '', ...parts].filter(Boolean).join('\n'),
          input: perms,
          options: [
            { id: 'allow', label: 'Grant for this turn', tone: 'primary' },
            { id: 'always', label: 'Grant for session' },
            { id: 'deny', label: 'Deny', tone: 'danger' }
          ]
        }
        break
      }
      case 'item/tool/requestUserInput': {
        const qs = (p.questions ?? []) as Json[]
        item = {
          ...base,
          approvalKind: 'question',
          title: 'Codex has a question',
          options: [{ id: 'answered', label: 'Send answers', tone: 'primary' }],
          questions: qs.map((q) => ({
            id: String(q.id),
            header: q.header ? String(q.header) : undefined,
            question: String(q.question ?? ''),
            multiSelect: false,
            options: ((q.options ?? []) as Json[] | null)?.map((o) => ({ label: String(o.label ?? o.value ?? ''), description: o.description ? String(o.description) : undefined })) ?? []
          }))
        }
        break
      }
      case 'mcpServer/elicitation/request': {
        item = {
          ...base,
          approvalKind: 'other',
          title: `${String(p.serverName ?? 'An MCP server')} needs input`,
          detail: String(p.message ?? ''),
          input: p,
          options: [
            { id: 'allow', label: 'Accept', tone: 'primary' },
            { id: 'deny', label: 'Decline', tone: 'danger' }
          ]
        }
        if (p.mode === 'url' && p.url) item.detail += `\n${String(p.url)}`
        break
      }
      case 'item/tool/call':
      case 'attestation/generate':
      case 'account/chatgptAuthTokens/refresh':
        this.server.respondError(r.id, 'not supported by Tandem')
        return
      default:
        this.server.respondError(r.id, `unknown server request ${r.method}`)
        return
    }
    this.approvals.set(id, { item, rpcId: r.id, method: r.method, params: p })
    this.upsert(item)
    this.onMeta({ status: 'waiting-approval' })
  }
}
