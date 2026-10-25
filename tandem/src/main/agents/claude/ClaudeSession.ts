/**
 * Claude Code adapter.
 *
 * Drives `claude -p --input-format stream-json --output-format stream-json` and speaks the
 * SDK control protocol over stdin/stdout:
 *   - user turns:      {"type":"user","message":{...}}
 *   - control:         {"type":"control_request","request_id","request":{subtype:...}}
 *   - permissions:     CLI emits control_request/can_use_tool; we answer with control_response.
 *
 * Verified against Claude Code 2.1.310.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
import { claudePermissionMode } from '@shared/policy'
import type { AdapterEmit, AgentSessionHandle } from '../types'
import { childEnv, firstLine, LineBuffer, now, truncate, uid } from '../../util'

type Json = Record<string, unknown>

interface Pending {
  resolve: (v: Json) => void
  reject: (e: Error) => void
}

export interface ClaudeSessionOptions {
  binary: string
  meta: SessionMeta
  emit: AdapterEmit
  /** Called when the CLI reports init so the manager can persist the native id. */
  onMeta: (patch: Partial<SessionMeta>) => void
  /** Tandem's in-app browser MCP endpoint (always available once the app is up). */
  mcp?: { url: string; token: string }
}

const CLAUDE_TOOL_CATEGORY: Record<string, ToolItem['category']> = {
  Bash: 'command',
  PowerShell: 'command',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent'
}

function categorize(tool: string): ToolItem['category'] {
  if (tool.startsWith('mcp__computer-use__')) return 'computer'
  if (tool.startsWith('mcp__claude-in-chrome__') || tool.startsWith('mcp__tandem-browser__') || /chrome|browser/i.test(tool)) return 'browser'
  if (tool.startsWith('mcp__')) return 'mcp'
  return CLAUDE_TOOL_CATEGORY[tool] ?? 'other'
}

export function summarizeToolInput(tool: string, input: unknown): string {
  const i = (input ?? {}) as Json
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return String(i.description ?? firstLine(String(i.command ?? '')))
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return String(i.file_path ?? i.notebook_path ?? '')
    case 'Glob':
      return String(i.pattern ?? '')
    case 'Grep':
      return `${String(i.pattern ?? '')}${i.path ? ` in ${String(i.path)}` : ''}`
    case 'WebFetch':
      return String(i.url ?? '')
    case 'WebSearch':
      return String(i.query ?? '')
    case 'Agent':
    case 'Task':
      return String(i.description ?? i.prompt ?? '').slice(0, 120)
    default: {
      const keys = Object.keys(i)
      if (keys.length === 0) return ''
      const k = keys.find((x) => typeof i[x] === 'string') ?? keys[0]
      return truncate(String(i[k] ?? ''), 120)
    }
  }
}

/** Build a tiny unified diff for Edit/Write inputs so the UI can render them like Codex patches. */
export function diffFromEditInput(tool: string, input: unknown): string | undefined {
  const i = (input ?? {}) as Json
  if (tool === 'Edit') {
    const oldS = String(i.old_string ?? '')
    const newS = String(i.new_string ?? '')
    const file = String(i.file_path ?? '')
    const a = oldS.split('\n').map((l) => `-${l}`)
    const b = newS.split('\n').map((l) => `+${l}`)
    return [`--- a/${file}`, `+++ b/${file}`, `@@ edit @@`, ...a, ...b].join('\n')
  }
  if (tool === 'Write') {
    const file = String(i.file_path ?? '')
    const content = String(i.content ?? '')
    const lines = content.split('\n')
    const shown = lines.slice(0, 400).map((l) => `+${l}`)
    if (lines.length > 400) shown.push(`+… ${lines.length - 400} more lines`)
    return [`--- /dev/null`, `+++ b/${file}`, `@@ write @@`, ...shown].join('\n')
  }
  if (tool === 'MultiEdit' && Array.isArray(i.edits)) {
    const file = String(i.file_path ?? '')
    const parts: string[] = [`--- a/${file}`, `+++ b/${file}`]
    for (const e of i.edits as Json[]) {
      parts.push('@@ edit @@')
      parts.push(...String(e.old_string ?? '').split('\n').map((l) => `-${l}`))
      parts.push(...String(e.new_string ?? '').split('\n').map((l) => `+${l}`))
    }
    return parts.join('\n')
  }
  return undefined
}

/**
 * Claude keeps the per-project "computer-use" MCP server toggle in ~/.claude.json under
 * projects[cwd].enabledMcpServers. Flipping it here is what `/mcp` → Enable does.
 */
export function setClaudeComputerUseEnabled(cwd: string, enabled: boolean): void {
  const file = join(homedir(), '.claude.json')
  let cfg: Json = {}
  try {
    if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) as Json
  } catch {
    cfg = {}
  }
  const projects = (cfg.projects ?? {}) as Record<string, Json>
  const proj = (projects[cwd] ?? {}) as Json
  const list = Array.isArray(proj.enabledMcpServers) ? (proj.enabledMcpServers as string[]) : []
  const has = list.includes('computer-use')
  if (enabled && !has) list.push('computer-use')
  if (!enabled && has) list.splice(list.indexOf('computer-use'), 1)
  proj.enabledMcpServers = list
  projects[cwd] = proj
  cfg.projects = projects
  writeFileSync(file, JSON.stringify(cfg, null, 2))
}

export class ClaudeSession implements AgentSessionHandle {
  readonly agent = 'claude' as const
  readonly sessionId: string
  meta: SessionMeta
  private proc?: ChildProcessWithoutNullStreams
  private readonly emit: AdapterEmit
  private readonly onMeta: (patch: Partial<SessionMeta>) => void
  private readonly binary: string
  private readonly mcp?: { url: string; token: string }
  private pending = new Map<string, Pending>()
  private lines = new LineBuffer()
  private ready?: Promise<void>
  private readyResolve?: () => void
  private readyReject?: (e: Error) => void
  private initialized = false
  private closedByUs = false
  private turnActive = false

  /** streaming state */
  private blockItems = new Map<number, string>() // content block index -> item id
  private blockKinds = new Map<number, 'text' | 'thinking' | 'tool_use'>()
  private toolUseJson = new Map<number, string>()
  private toolItems = new Map<string, ToolItem>() // tool_use_id -> item
  private approvals = new Map<string, { item: ApprovalItem; requestId: string; input: Json; suggestions: unknown[] }>()
  private currentAssistantText = new Map<string, string>()

  constructor(opts: ClaudeSessionOptions) {
    this.binary = opts.binary
    this.meta = opts.meta
    this.sessionId = opts.meta.id
    this.emit = opts.emit
    this.onMeta = opts.onMeta
    this.mcp = opts.mcp
  }

  // ---------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------

  private buildArgs(): string[] {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      claudePermissionMode(this.meta.policy),
      '--allow-dangerously-skip-permissions'
    ]
    if (this.meta.nativeId) args.push('--resume', this.meta.nativeId)
    else args.push('--session-id', this.sessionId)
    if (this.meta.model) args.push('--model', this.meta.model)
    if (this.meta.effort) args.push('--effort', this.meta.effort)
    if (this.meta.capabilities.browserUse) args.push('--chrome')
    if (!this.meta.capabilities.webAccess) args.push('--disallowedTools', 'WebFetch', 'WebSearch')
    if (this.meta.capabilities.inAppBrowser && this.mcp) {
      args.push('--mcp-config', JSON.stringify({ mcpServers: { 'tandem-browser': { type: 'http', url: this.mcp.url, headers: { Authorization: `Bearer ${this.mcp.token}` } } } }))
      args.push('--append-system-prompt', 'The user has opened Tandem\'s built-in browser pane next to this chat. For anything that needs a browser (web apps, sites, visual checks, forms), use the tandem-browser MCP tools: navigate, snapshot, click, type, screenshot. The user watches it live.')
    }
    return args
  }

  async start(): Promise<void> {
    if (this.proc && !this.proc.killed) return this.ready
    this.closedByUs = false
    this.initialized = false
    this.ready = new Promise<void>((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
    if (this.meta.capabilities.computerUse) {
      try {
        setClaudeComputerUseEnabled(this.meta.cwd, true)
      } catch (e) {
        this.status('warn', `Could not enable computer-use in ~/.claude.json: ${(e as Error).message}`)
      }
    }
    const args = this.buildArgs()
    const proc = spawn(this.binary, args, {
      cwd: this.meta.cwd,
      env: childEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', FORCE_COLOR: '0' }),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.lines.push(chunk, (l) => this.handleLine(l)))
    let stderrBuf = ''
    proc.stderr.on('data', (chunk: string) => {
      stderrBuf = (stderrBuf + chunk).slice(-4000)
    })
    proc.on('error', (err) => {
      this.status('error', `Failed to start Claude Code: ${err.message}`)
      this.readyReject?.(err)
      this.onMeta({ status: 'error', lastError: err.message })
    })
    proc.on('exit', (code, signal) => {
      const wasInit = this.initialized
      this.proc = undefined
      for (const p of this.pending.values()) p.reject(new Error('Claude Code exited'))
      this.pending.clear()
      if (!this.closedByUs) {
        const detail = stderrBuf.trim() ? `\n${truncate(stderrBuf.trim(), 600)}` : ''
        if (!wasInit) {
          this.status('error', `Claude Code exited before it was ready (code ${code ?? signal}).${detail}`)
          this.readyReject?.(new Error(`Claude Code exited (code ${code ?? signal}) ${stderrBuf.trim()}`))
          this.onMeta({ status: 'error', lastError: truncate(stderrBuf.trim() || `exit ${code}`, 300) })
        } else if (this.turnActive) {
          this.status('warn', `Claude Code exited mid-turn (code ${code ?? signal}). It will restart on your next message.${detail}`)
          this.onMeta({ status: 'idle' })
        } else {
          this.onMeta({ status: 'idle' })
        }
      }
      this.turnActive = false
    })

    // Handshake: initialize gives us models + account + commands.
    try {
      const res = await this.control({ subtype: 'initialize' }, 60000)
      const r = (res.response ?? {}) as Json
      const account = (r.account ?? {}) as Json
      const models = (r.models ?? []) as Json[]
      this.initialized = true
      const patch: Partial<SessionMeta> = { status: 'idle' }
      if (!this.meta.model && models.length) {
        // model is reported by system/init later; nothing to do here
      }
      if (account.email) {
        // surface account in the first status line of a fresh session
      }
      this.onMeta(patch)
      this.readyResolve?.()
    } catch (e) {
      this.readyReject?.(e as Error)
      throw e
    }
    return this.ready
  }

  async close(): Promise<void> {
    this.closedByUs = true
    const p = this.proc
    if (!p) return
    try {
      p.stdin.end()
    } catch {
      /* ignore */
    }
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        try {
          p.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        res()
      }, 1500)
      p.once('exit', () => {
        clearTimeout(t)
        res()
      })
    })
    this.proc = undefined
  }

  // ---------------------------------------------------------------------
  // public actions
  // ---------------------------------------------------------------------

  async send(text: string, images?: string[]): Promise<void> {
    if (!this.proc) await this.start()
    else await this.ready
    const content: unknown[] = []
    if (images?.length) {
      for (const img of images) {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(img)
        if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })
      }
    }
    content.push({ type: 'text', text })
    this.turnActive = true
    this.onMeta({ status: 'running' })
    this.write({
      type: 'user',
      message: { role: 'user', content: content.length === 1 ? text : content },
      parent_tool_use_id: null
    })
  }

  async interrupt(): Promise<void> {
    if (!this.proc) return
    try {
      await this.control({ subtype: 'interrupt', cancel_queued: true }, 10000)
    } catch {
      /* ignore */
    }
    // Any approvals left dangling are moot now.
    for (const [itemId, a] of this.approvals) {
      a.item.resolved = { optionId: 'deny', message: 'Interrupted' }
      this.emit({ type: 'upsert', sessionId: this.sessionId, item: a.item })
      this.approvals.delete(itemId)
    }
    this.turnActive = false
    this.onMeta({ status: 'idle' })
  }

  async respondApproval(resp: ApprovalResponse): Promise<void> {
    const a = this.approvals.get(resp.itemId)
    if (!a) throw new Error('Approval request no longer pending')
    this.approvals.delete(resp.itemId)
    let response: Json
    const tool = String((a.item.input as Json | undefined)?.__tool ?? '')
    if (a.item.approvalKind === 'question') {
      // AskUserQuestion: answers keyed by question text, values = selected label(s) or free text.
      const questions = (a.input.questions ?? []) as Json[]
      const answers: Record<string, string | string[]> = {}
      for (const q of questions) {
        const key = String(q.question)
        const v = resp.answers?.[key]
        if (v !== undefined) answers[key] = Array.isArray(v) ? v.join(', ') : v
      }
      response = { behavior: 'allow', updatedInput: { questions, answers, ...(resp.message ? { response: resp.message } : {}) } }
      a.item.resolved = { optionId: 'answered', answers }
    } else if (resp.optionId === 'allow' || resp.optionId === 'always') {
      response = { behavior: 'allow', updatedInput: a.input }
      if (resp.optionId === 'always') {
        const persist = (a.suggestions as Json[]).filter((s) => s && (s.destination === 'localSettings' || s.destination === 'session'))
        if (persist.length) response.updatedPermissions = persist
      }
      a.item.resolved = { optionId: resp.optionId }
    } else {
      response = { behavior: 'deny', message: resp.message || 'The user declined this action.', interrupt: false }
      a.item.resolved = { optionId: 'deny', message: resp.message }
    }
    void tool
    this.emit({ type: 'upsert', sessionId: this.sessionId, item: a.item })
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: a.requestId, response } })
    if (this.approvals.size === 0) this.onMeta({ status: 'running' })
  }

  async setPolicy(policy: PolicyMode): Promise<void> {
    this.meta = { ...this.meta, policy }
    if (!this.proc) return
    await this.control({ subtype: 'set_permission_mode', mode: claudePermissionMode(policy) }, 10000)
  }

  async setModel(model: string, effort?: string): Promise<void> {
    this.meta = { ...this.meta, model, effort: effort ?? this.meta.effort }
    if (!this.proc) return
    await this.control({ subtype: 'set_model', model }, 10000)
    if (effort) {
      // /effort is a slash command the CLI accepts as a user message in print mode.
      this.write({ type: 'user', message: { role: 'user', content: `/effort ${effort}` }, parent_tool_use_id: null })
    }
  }

  async setCapabilities(caps: Capabilities): Promise<void> {
    const before = this.meta.capabilities
    this.meta = { ...this.meta, capabilities: caps }
    if (caps.computerUse !== before.computerUse) {
      try {
        setClaudeComputerUseEnabled(this.meta.cwd, caps.computerUse)
      } catch {
        /* ignore */
      }
    }
    // --chrome and the web-tool allowlist are spawn-time flags. Recycle the process when idle;
    // the next message relaunches with --resume so the conversation continues.
    const spawnTimeChange = caps.browserUse !== before.browserUse || caps.webAccess !== before.webAccess || caps.computerUse !== before.computerUse || caps.inAppBrowser !== before.inAppBrowser
    if (this.proc && spawnTimeChange) {
      if (this.turnActive || this.approvals.size) {
        this.status('info', 'Capability change applies after the current turn finishes.')
        this.pendingRecycle = true
        return
      }
      await this.close()
      this.closedByUs = false
      this.status('info', caps.inAppBrowser && !before.inAppBrowser ? 'Tandem browser on: its tools load on your next message.' : caps.browserUse && !before.browserUse ? 'Browser use on: Claude in Chrome tools load on your next message.' : 'Session relaunches with the new capabilities on your next message.')
    }
  }
  private pendingRecycle = false

  // ---------------------------------------------------------------------
  // protocol plumbing
  // ---------------------------------------------------------------------

  private write(obj: unknown): void {
    const p = this.proc
    if (!p || p.stdin.destroyed) throw new Error('Claude Code is not running')
    p.stdin.write(JSON.stringify(obj) + '\n')
  }

  private control(request: Json, timeoutMs = 30000): Promise<Json> {
    const request_id = uid()
    return new Promise<Json>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(request_id)
        reject(new Error(`Claude control request '${String(request.subtype)}' timed out`))
      }, timeoutMs)
      this.pending.set(request_id, {
        resolve: (v) => {
          clearTimeout(t)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(t)
          reject(e)
        }
      })
      this.write({ type: 'control_request', request_id, request })
    })
  }

  private status(level: 'info' | 'warn' | 'error', text: string): void {
    this.emit({
      type: 'upsert',
      sessionId: this.sessionId,
      item: { id: uid(), sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'status', level, text }
    })
  }

  private upsert(item: TimelineItem): void {
    this.emit({ type: 'upsert', sessionId: this.sessionId, item })
  }

  private handleLine(line: string): void {
    let msg: Json
    try {
      msg = JSON.parse(line) as Json
    } catch {
      return
    }
    const type = String(msg.type ?? '')
    switch (type) {
      case 'control_response': {
        const r = (msg.response ?? {}) as Json
        const id = String(r.request_id ?? '')
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        if (r.subtype === 'error') p.reject(new Error(String(r.error ?? 'control error')))
        else p.resolve(r)
        return
      }
      case 'control_request':
        this.handleControlRequest(msg)
        return
      case 'control_cancel_request': {
        const id = String(msg.request_id ?? '')
        for (const [itemId, a] of this.approvals) {
          if (a.requestId === id) {
            a.item.resolved = { optionId: 'cancelled', message: 'Withdrawn by Claude' }
            this.upsert(a.item)
            this.approvals.delete(itemId)
          }
        }
        return
      }
      case 'system':
        this.handleSystem(msg)
        return
      case 'stream_event':
        if (msg.parent_tool_use_id == null) this.handleStreamEvent((msg.event ?? {}) as Json)
        return
      case 'assistant':
        this.handleAssistant(msg)
        return
      case 'user':
        this.handleUser(msg)
        return
      case 'result':
        this.handleResult(msg)
        return
      case 'rate_limit_event':
        this.emit({ type: 'toast', level: 'info', text: '' }) // no-op marker; accounts refresh picks this up
        return
      default:
        return
    }
  }

  private handleSystem(msg: Json): void {
    const sub = String(msg.subtype ?? '')
    if (sub === 'init') {
      const patch: Partial<SessionMeta> = { nativeId: String(msg.session_id ?? this.sessionId), status: this.turnActive ? 'running' : 'idle' }
      if (msg.model) patch.model = String(msg.model)
      const servers = (msg.mcp_servers ?? []) as Json[]
      const cu = servers.find((s) => s.name === 'computer-use')
      if (this.meta.capabilities.computerUse) {
        if (cu) this.status('info', `Computer use server: ${String(cu.status)}`)
        else
          this.status(
            'warn',
            'Computer use is on for this session, but Claude Code did not load the computer-use server here. In -p mode Claude Code only exposes computer use on macOS with a Pro/Max login; use the Terminal tab (interactive Claude) for screen control.'
          )
      }
      this.onMeta(patch)
    } else if (sub === 'permission_denied') {
      this.status('warn', `Permission denied: ${String(msg.tool_name)} — ${String(msg.message ?? '')}`)
    } else if (sub === 'compact_boundary') {
      this.status('info', 'Context compacted')
    } else if (sub === 'api_retry') {
      this.status('warn', `API retry ${String(msg.attempt)}/${String(msg.max_retries)} (${String(msg.error)})`)
    } else if (sub === 'status' && msg.permissionMode) {
      // mode confirmations; ignore
    }
  }

  private handleStreamEvent(ev: Json): void {
    const t = String(ev.type ?? '')
    if (t === 'message_start') {
      this.blockItems.clear()
      this.blockKinds.clear()
      this.toolUseJson.clear()
      return
    }
    const index = Number(ev.index ?? -1)
    if (t === 'content_block_start') {
      const cb = (ev.content_block ?? {}) as Json
      const kind = String(cb.type ?? '')
      if (kind === 'text') {
        const id = uid()
        this.blockItems.set(index, id)
        this.blockKinds.set(index, 'text')
        this.currentAssistantText.set(id, String(cb.text ?? ''))
        const item: AssistantItem = { id, sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'assistant', text: String(cb.text ?? ''), streaming: true, model: this.meta.model }
        this.upsert(item)
      } else if (kind === 'thinking') {
        const id = uid()
        this.blockItems.set(index, id)
        this.blockKinds.set(index, 'thinking')
        const item: ReasoningItem = { id, sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'reasoning', text: '', streaming: true }
        this.upsert(item)
      } else if (kind === 'tool_use') {
        const id = String(cb.id ?? uid())
        this.blockItems.set(index, id)
        this.blockKinds.set(index, 'tool_use')
        this.toolUseJson.set(index, '')
        const tool = String(cb.name ?? 'tool')
        const item: ToolItem = {
          id,
          sessionId: this.sessionId,
          agent: 'claude',
          ts: now(),
          kind: 'tool',
          tool,
          summary: '',
          status: 'running',
          category: categorize(tool)
        }
        this.toolItems.set(id, item)
        this.upsert(item)
      }
      return
    }
    if (t === 'content_block_delta') {
      const d = (ev.delta ?? {}) as Json
      const id = this.blockItems.get(index)
      if (!id) return
      if (d.type === 'text_delta') {
        const text = String(d.text ?? '')
        this.currentAssistantText.set(id, (this.currentAssistantText.get(id) ?? '') + text)
        this.emit({ type: 'append', sessionId: this.sessionId, itemId: id, delta: text, field: 'text' })
      } else if (d.type === 'thinking_delta') {
        this.emit({ type: 'append', sessionId: this.sessionId, itemId: id, delta: String(d.thinking ?? ''), field: 'text' })
      } else if (d.type === 'input_json_delta') {
        this.toolUseJson.set(index, (this.toolUseJson.get(index) ?? '') + String(d.partial_json ?? ''))
      }
      return
    }
    if (t === 'content_block_stop') {
      const id = this.blockItems.get(index)
      const kind = this.blockKinds.get(index)
      if (!id) return
      if (kind === 'text') {
        const item: AssistantItem = { id, sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'assistant', text: this.currentAssistantText.get(id) ?? '', streaming: false, model: this.meta.model }
        this.upsert(item)
      } else if (kind === 'tool_use') {
        const item = this.toolItems.get(id)
        if (item) {
          try {
            item.input = JSON.parse(this.toolUseJson.get(index) || '{}')
          } catch {
            /* partial */
          }
          item.summary = summarizeToolInput(item.tool, item.input)
          item.diff = diffFromEditInput(item.tool, item.input)
          this.upsert(item)
        }
      }
      return
    }
  }

  private handleAssistant(msg: Json): void {
    const m = (msg.message ?? {}) as Json
    const content = (m.content ?? []) as Json[]
    const parent = msg.parent_tool_use_id as string | null
    if (parent) {
      // Subagent chatter: fold a short trace into the parent Agent tool card.
      const parentItem = this.toolItems.get(parent)
      if (parentItem) {
        for (const c of content) {
          if (c.type === 'text' && c.text) this.emit({ type: 'append', sessionId: this.sessionId, itemId: parent, delta: `${String(c.text).trim()}\n`, field: 'output' })
          if (c.type === 'tool_use') this.emit({ type: 'append', sessionId: this.sessionId, itemId: parent, delta: `↳ ${String(c.name)} ${summarizeToolInput(String(c.name), c.input)}\n`, field: 'output' })
        }
      }
      return
    }
    // Authoritative pass over the finished message: make sure tool items carry full input.
    for (const c of content) {
      if (c.type === 'tool_use') {
        const id = String(c.id)
        const tool = String(c.name ?? 'tool')
        const existing = this.toolItems.get(id)
        const item: ToolItem = existing ?? {
          id,
          sessionId: this.sessionId,
          agent: 'claude',
          ts: now(),
          kind: 'tool',
          tool,
          summary: '',
          status: 'running',
          category: categorize(tool)
        }
        item.input = c.input
        item.summary = summarizeToolInput(tool, c.input)
        item.diff = diffFromEditInput(tool, c.input)
        this.toolItems.set(id, item)
        this.upsert(item)
      } else if (c.type === 'text') {
        // If streaming was off for some reason (no partial events), still show text.
        const already = [...this.currentAssistantText.values()].includes(String(c.text))
        if (!already && !this.blockItems.size) {
          const id = uid()
          this.upsert({ id, sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'assistant', text: String(c.text), streaming: false, model: this.meta.model })
        }
      }
    }
    if (m.model) this.meta = { ...this.meta, model: String(m.model) }
    const usage = (m.usage ?? {}) as Json
    if (usage.input_tokens !== undefined) {
      const inTok = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0)
      this.onMeta({ tokensIn: inTok, tokensOut: Number(usage.output_tokens ?? 0) })
    }
  }

  private handleUser(msg: Json): void {
    if (msg.parent_tool_use_id) return
    const m = (msg.message ?? {}) as Json
    const content = m.content
    if (!Array.isArray(content)) return
    const metaList = (msg.tool_result_meta ?? []) as Json[]
    for (const c of content as Json[]) {
      if (c.type !== 'tool_result') continue
      const id = String(c.tool_use_id)
      const item = this.toolItems.get(id)
      if (!item) continue
      let out = ''
      if (typeof c.content === 'string') out = c.content
      else if (Array.isArray(c.content)) out = (c.content as Json[]).map((b) => (b.type === 'text' ? String(b.text ?? '') : b.type === 'image' ? '[image]' : '')).join('\n')
      const structured = (msg.tool_use_result ?? {}) as Json
      if (item.tool === 'Bash' && (structured.stdout !== undefined || structured.stderr !== undefined)) {
        out = [String(structured.stdout ?? ''), String(structured.stderr ?? '')].filter(Boolean).join('\n') || out
      }
      const decision = metaList.find((x) => x.id === id)?.permission_decision as Json | undefined
      item.output = truncate(out, 20000)
      item.status = c.is_error ? (decision && decision.decision === 'reject' ? 'declined' : 'error') : 'done'
      item.durationMs = now() - item.ts
      this.upsert(item)
    }
  }

  private handleResult(msg: Json): void {
    this.turnActive = false
    const ok = !msg.is_error
    const usage = (msg.usage ?? {}) as Json
    const item: TimelineItem = {
      id: uid(),
      sessionId: this.sessionId,
      agent: 'claude',
      ts: now(),
      kind: 'result',
      ok,
      summary: ok ? undefined : String((msg.errors as string[] | undefined)?.join('; ') ?? msg.result ?? msg.subtype ?? 'error'),
      costUsd: Number(msg.total_cost_usd ?? 0),
      durationMs: Number(msg.duration_ms ?? 0),
      tokensIn: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0),
      tokensOut: Number(usage.output_tokens ?? 0)
    }
    this.upsert(item)
    // close any streaming items
    for (const [, id] of this.blockItems) {
      const text = this.currentAssistantText.get(id)
      if (text !== undefined) this.upsert({ id, sessionId: this.sessionId, agent: 'claude', ts: now(), kind: 'assistant', text, streaming: false, model: this.meta.model })
    }
    this.onMeta({
      status: ok ? 'idle' : 'error',
      lastError: ok ? undefined : item.summary,
      totalCostUsd: Number(msg.total_cost_usd ?? this.meta.totalCostUsd ?? 0)
    })
    if (this.pendingRecycle) {
      this.pendingRecycle = false
      void this.close().then(() => {
        this.closedByUs = false
      })
    }
  }

  private handleControlRequest(msg: Json): void {
    const requestId = String(msg.request_id ?? '')
    const req = (msg.request ?? {}) as Json
    const sub = String(req.subtype ?? '')
    if (sub === 'can_use_tool') {
      const tool = String(req.tool_name ?? 'tool')
      const input = (req.input ?? {}) as Json
      const suggestions = (req.permission_suggestions ?? []) as unknown[]
      const id = uid()
      if (tool === 'AskUserQuestion') {
        const qs = (input.questions ?? []) as Json[]
        const item: ApprovalItem = {
          id,
          sessionId: this.sessionId,
          agent: 'claude',
          ts: now(),
          kind: 'approval',
          approvalKind: 'question',
          title: 'Claude has a question',
          options: [{ id: 'answered', label: 'Send answers', tone: 'primary' }],
          questions: qs.map((q, i) => ({
            id: String(q.question ?? i),
            header: q.header ? String(q.header) : undefined,
            question: String(q.question ?? ''),
            multiSelect: Boolean(q.multiSelect),
            options: ((q.options ?? []) as Json[]).map((o) => ({ label: String(o.label ?? ''), description: o.description ? String(o.description) : undefined }))
          })),
          requestRef: requestId
        }
        this.approvals.set(id, { item, requestId, input, suggestions })
        this.upsert(item)
        this.onMeta({ status: 'waiting-approval' })
        return
      }
      if (tool === 'ExitPlanMode') {
        const item: ApprovalItem = {
          id,
          sessionId: this.sessionId,
          agent: 'claude',
          ts: now(),
          kind: 'approval',
          approvalKind: 'plan',
          title: 'Approve plan and start implementing?',
          detail: String(input.plan ?? ''),
          options: [
            { id: 'allow', label: 'Approve plan', tone: 'primary' },
            { id: 'deny', label: 'Keep planning', tone: 'neutral' }
          ],
          requestRef: requestId
        }
        this.approvals.set(id, { item, requestId, input, suggestions })
        this.upsert(item)
        this.onMeta({ status: 'waiting-approval' })
        return
      }
      const cat = categorize(tool)
      const kind: ApprovalItem['approvalKind'] = cat === 'command' ? 'command' : cat === 'edit' ? 'file-change' : 'tool'
      const summary = summarizeToolInput(tool, input)
      const options: ApprovalItem['options'] = [{ id: 'allow', label: 'Allow once', tone: 'primary' }]
      if (!req.suppress_always_allow_rule && suggestions.length) options.push({ id: 'always', label: 'Always allow', description: 'Remember for this project' })
      options.push({ id: 'deny', label: 'Deny', tone: 'danger' })
      const item: ApprovalItem = {
        id,
        sessionId: this.sessionId,
        agent: 'claude',
        ts: now(),
        kind: 'approval',
        approvalKind: kind,
        title: req.title ? String(req.title) : `${String(req.display_name ?? tool)} wants to run`,
        detail: kind === 'command' ? String(input.command ?? summary) : summary,
        input: { ...input, __tool: tool },
        diff: diffFromEditInput(tool, input),
        options,
        reason: req.decision_reason ? String(req.decision_reason).replace(/\u001b\[[0-9;]*m/g, '') : req.description ? String(req.description) : undefined,
        warn: req.decision_reason_type === 'safetyCheck' ? 'Safety check flagged this action' : req.blocked_path ? `Outside working directory: ${String(req.blocked_path)}` : undefined,
        requestRef: requestId
      }
      this.approvals.set(id, { item, requestId, input, suggestions })
      this.upsert(item)
      this.onMeta({ status: 'waiting-approval' })
      return
    }
    if (sub === 'request_user_dialog') {
      // We cannot render arbitrary dialogs; decline so the CLI falls back.
      this.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'dialog not supported by host' } })
      return
    }
    if (sub === 'hook_callback' || sub === 'mcp_message') {
      this.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: `${sub} not supported by host` } })
    }
  }
}

/**
 * Spawns a throwaway `claude -p` just long enough to answer `initialize`, which carries the
 * model list and the signed-in account. Used for the sidebar before any session exists.
 */
export async function probeClaude(binary: string, cwd: string): Promise<{ models: Json[]; account: Json; version?: string; commands: Json[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'none', '--no-session-persistence', '--max-turns', '1'], {
      cwd,
      env: childEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const lines = new LineBuffer()
    let done = false
    let stderr = ''
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        proc.kill('SIGTERM')
        reject(new Error('Claude Code did not answer initialize in time' + (stderr ? `: ${truncate(stderr, 300)}` : '')))
      }
    }, 45000)
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (c: string) => (stderr = (stderr + c).slice(-2000)))
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) =>
      lines.push(chunk, (line) => {
        try {
          const m = JSON.parse(line) as Json
          if (m.type === 'control_response') {
            const r = (m.response ?? {}) as Json
            const inner = (r.response ?? {}) as Json
            done = true
            clearTimeout(timer)
            resolve({ models: (inner.models ?? []) as Json[], account: (inner.account ?? {}) as Json, version: inner.claude_code_version ? String(inner.claude_code_version) : undefined, commands: (inner.commands ?? []) as Json[] })
            try {
              proc.stdin.end()
            } catch {
              /* ignore */
            }
            setTimeout(() => proc.kill('SIGTERM'), 500)
          }
        } catch {
          /* ignore */
        }
      })
    )
    proc.on('error', (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(e)
      }
    })
    proc.on('exit', (code) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(new Error(`Claude Code exited (${code}) ${truncate(stderr, 300)}`))
      }
    })
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'probe', request: { subtype: 'initialize' } }) + '\n')
  })
}
