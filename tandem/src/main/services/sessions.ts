/**
 * SessionManager: owns every live agent session, routes IPC actions to the right adapter,
 * persists the timeline, and fans events out to the renderer.
 */
import type {
  AgentKind,
  ApprovalResponse,
  Capabilities,
  NewSessionInput,
  PolicyMode,
  SessionMeta,
  TimelineEvent,
  TimelineItem,
  UserItem
} from '@shared/types'
import { DEFAULT_CAPABILITIES } from '@shared/types'
import type { AgentSessionHandle } from '../agents/types'
import { ClaudeSession } from '../agents/claude/ClaudeSession'
import { CodexSession } from '../agents/codex/CodexSession'
import type { CodexServer } from '../agents/codex/CodexServer'
import { now, titleFromPrompt, uid } from '../util'
import type { SessionStore } from './store'

export interface SessionManagerDeps {
  store: SessionStore
  emit: (ev: TimelineEvent) => void
  claudeBinary: () => string | undefined
  codexServer: () => CodexServer | undefined
  defaultPolicy: () => PolicyMode
  defaultModel: (agent: AgentKind) => string | undefined
  defaultEffort: (agent: AgentKind) => string | undefined
}

export class SessionManager {
  private metas = new Map<string, SessionMeta>()
  private live = new Map<string, AgentSessionHandle>()

  constructor(private readonly deps: SessionManagerDeps) {
    for (const m of deps.store.listMeta()) this.metas.set(m.id, m)
  }

  list(): SessionMeta[] {
    return [...this.metas.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  items(sessionId: string): TimelineItem[] {
    return this.deps.store.loadItems(sessionId)
  }

  get(sessionId: string): SessionMeta {
    const m = this.metas.get(sessionId)
    if (!m) throw new Error(`Unknown session ${sessionId}`)
    return m
  }

  create(input: NewSessionInput): SessionMeta {
    const id = uid()
    const meta: SessionMeta = {
      id,
      agent: input.agent,
      title: input.title ?? `New ${input.agent === 'claude' ? 'Claude' : 'Codex'} session`,
      cwd: input.cwd,
      createdAt: now(),
      updatedAt: now(),
      status: 'idle',
      model: input.model ?? this.deps.defaultModel(input.agent),
      effort: input.effort ?? this.deps.defaultEffort(input.agent),
      policy: input.policy ?? this.deps.defaultPolicy(),
      capabilities: { ...DEFAULT_CAPABILITIES, ...(input.capabilities ?? {}) },
      pairId: input.pairId,
      nativeId: input.resumeNativeId
    }
    this.metas.set(id, meta)
    this.deps.store.saveMeta(meta)
    this.deps.emit({ type: 'session', session: meta })
    return meta
  }

  private patchMeta(sessionId: string, patch: Partial<SessionMeta>): SessionMeta {
    const cur = this.metas.get(sessionId)
    if (!cur) throw new Error(`Unknown session ${sessionId}`)
    const next: SessionMeta = { ...cur, ...patch, updatedAt: now() }
    this.metas.set(sessionId, next)
    this.deps.store.saveMeta(next)
    this.deps.emit({ type: 'session', session: next })
    return next
  }

  private emitItem = (ev: TimelineEvent): void => {
    if (ev.type === 'upsert') this.deps.store.upsertItem(ev.sessionId, ev.item)
    else if (ev.type === 'append') this.deps.store.appendDelta(ev.sessionId, ev.itemId, ev.delta, ev.field ?? 'text')
    if (ev.type === 'toast' && !ev.text) return // adapters use empty toasts as internal markers
    this.deps.emit(ev)
  }

  private handle(sessionId: string): AgentSessionHandle {
    const existing = this.live.get(sessionId)
    if (existing) {
      existing.meta.model = this.get(sessionId).model
      return existing
    }
    const meta = this.get(sessionId)
    const onMeta = (patch: Partial<SessionMeta>): void => {
      const next = this.patchMeta(sessionId, patch)
      const h = this.live.get(sessionId)
      if (h) h.meta = next
    }
    let h: AgentSessionHandle
    if (meta.agent === 'claude') {
      const binary = this.deps.claudeBinary()
      if (!binary) throw new Error('Claude Code CLI not found')
      h = new ClaudeSession({ binary, meta, emit: this.emitItem, onMeta })
    } else {
      const server = this.deps.codexServer()
      if (!server) throw new Error('Codex CLI not found')
      h = new CodexSession({ server, meta, emit: this.emitItem, onMeta })
    }
    this.live.set(sessionId, h)
    return h
  }

  async send(sessionId: string, text: string, images?: string[]): Promise<void> {
    const meta = this.get(sessionId)
    const user: UserItem = { id: uid(), sessionId, agent: meta.agent, ts: now(), kind: 'user', text, images }
    this.emitItem({ type: 'upsert', sessionId, item: user })
    const patch: Partial<SessionMeta> = { status: 'starting', lastError: undefined }
    if (meta.title.startsWith('New ')) patch.title = titleFromPrompt(text)
    this.patchMeta(sessionId, patch)
    try {
      const h = this.handle(sessionId)
      await h.start()
      await h.send(text, images)
    } catch (e) {
      const msg = (e as Error).message
      this.emitItem({ type: 'upsert', sessionId, item: { id: uid(), sessionId, agent: meta.agent, ts: now(), kind: 'status', level: 'error', text: msg } })
      this.patchMeta(sessionId, { status: 'error', lastError: msg })
      throw e
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.live.get(sessionId)?.interrupt()
  }

  async approve(resp: ApprovalResponse): Promise<void> {
    const h = this.live.get(resp.sessionId)
    if (!h) throw new Error('Session is not running')
    await h.respondApproval(resp)
  }

  async setPolicy(sessionId: string, policy: PolicyMode): Promise<SessionMeta> {
    const next = this.patchMeta(sessionId, { policy })
    const h = this.live.get(sessionId)
    if (h) {
      h.meta = next
      await h.setPolicy(policy)
    }
    return next
  }

  async setModel(sessionId: string, model: string, effort?: string): Promise<SessionMeta> {
    const next = this.patchMeta(sessionId, { model, effort: effort ?? this.get(sessionId).effort })
    const h = this.live.get(sessionId)
    if (h) {
      h.meta = next
      await h.setModel(model, effort)
    }
    return next
  }

  async setCapabilities(sessionId: string, caps: Partial<Capabilities>): Promise<SessionMeta> {
    const merged: Capabilities = { ...this.get(sessionId).capabilities, ...caps }
    const next = this.patchMeta(sessionId, { capabilities: merged })
    const h = this.live.get(sessionId)
    if (h) {
      h.meta = next
      await h.setCapabilities(merged)
    }
    return next
  }

  rename(sessionId: string, title: string): SessionMeta {
    return this.patchMeta(sessionId, { title })
  }

  async close(sessionId: string): Promise<void> {
    const h = this.live.get(sessionId)
    if (h) {
      await h.close()
      this.live.delete(sessionId)
    }
    if (this.metas.has(sessionId)) this.patchMeta(sessionId, { status: 'idle' })
  }

  async remove(sessionId: string): Promise<void> {
    await this.close(sessionId)
    this.metas.delete(sessionId)
    this.deps.store.remove(sessionId)
    this.deps.emit({ type: 'session-removed', sessionId })
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.live.values()].map((h) => h.close()))
    this.live.clear()
    this.deps.store.flush()
  }
}
