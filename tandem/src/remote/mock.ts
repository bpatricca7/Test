/**
 * Demo backend for the phone app: simulates a Mac running Tandem with Claude Code and Codex,
 * so the phone UI can be tried anywhere. Built only with `vite build --mode demo`.
 */
import type { AgentKind, AgentModel, ApprovalItem, ApprovalResponse, NewSessionInput, PolicyMode, SessionMeta, TimelineEvent, TimelineItem, ToolItem } from '@shared/types'
import type { RemoteApi, RemoteState } from './types'
import seed from '../../e2e/demo-session.json'
import screenUrl from '../../docs/02-session-split.png'

export const DEMO = true

type Listener = (ev: TimelineEvent) => void
const listeners = new Set<Listener>()
const emit = (ev: TimelineEvent): void => listeners.forEach((l) => l(ev))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const uid = (): string => Math.random().toString(36).slice(2, 10)

const sessions = new Map<string, SessionMeta>()
const items = new Map<string, TimelineItem[]>()
const pending = new Map<string, (optionId: string, message?: string) => void>()
const generation = new Map<string, number>()

// Seed from the same demo used for the desktop screenshots, shifted so it reads as "just now".
{
  const s = seed as unknown as { sessions: SessionMeta[]; items: Record<string, TimelineItem[]> }
  const anchor = Math.max(...s.sessions.map((x) => x.updatedAt)) + 60_000
  const delta = Date.now() - anchor
  for (const m of s.sessions) sessions.set(m.id, { ...m, createdAt: m.createdAt + delta, updatedAt: m.updatedAt + delta })
  for (const [id, list] of Object.entries(s.items)) items.set(id, list.map((i) => ({ ...i, ts: i.ts + delta })))
  // The seeded Codex approval continues into a finished turn when you answer it.
  const codexApproval = items.get('demo-codex')?.find((i) => i.kind === 'approval') as ApprovalItem | undefined
  if (codexApproval)
    pending.set(codexApproval.id, (optionId) => {
      void (async () => {
        const patch = items.get('demo-codex')?.find((i) => i.kind === 'tool' && i.tool === 'apply_patch') as ToolItem | undefined
        const ok = optionId === 'allow' || optionId === 'always'
        if (patch) upsert('demo-codex', { ...patch, status: ok ? 'done' : 'declined', durationMs: 180 })
        if (!ok) {
          await say('demo-codex', 'Understood, I left both files untouched. Want me to fix only the hook and leave the test as it is?')
          return finish('demo-codex', true)
        }
        setStatus('demo-codex', 'running')
        const run = tool('demo-codex', { tool: 'shell', category: 'command', summary: 'for i in $(seq 20); do npx vitest run tests/checkout.spec.ts; done', input: { command: 'for i in $(seq 20); do npx vitest run tests/checkout.spec.ts; done' } })
        await sleep(1400)
        upsert('demo-codex', { ...run, status: 'done', exitCode: 0, durationMs: 41200, output: '✓ tests/checkout.spec.ts (6 tests) ×20\n\nTest Files  20 passed\n     Tests  120 passed' })
        await say('demo-codex', 'Applied both changes. The hook now awaits the coupon mutation and the refetch, and the test waits for the settled total. **20 runs in a row are green.**')
        finish('demo-codex', true, 0.31)
      })()
    })
}

function now(): number {
  return Date.now()
}
function list(id: string): TimelineItem[] {
  let l = items.get(id)
  if (!l) items.set(id, (l = []))
  return l
}
function upsert(id: string, item: TimelineItem): void {
  const l = list(id)
  const i = l.findIndex((x) => x.id === item.id)
  if (i === -1) l.push(item)
  else l[i] = item
  emit({ type: 'upsert', sessionId: id, item })
}
function setStatus(id: string, status: SessionMeta['status'], patch: Partial<SessionMeta> = {}): void {
  const s = sessions.get(id)
  if (!s) return
  const next = { ...s, ...patch, status, updatedAt: now() }
  sessions.set(id, next)
  emit({ type: 'session', session: next })
}
function tool(id: string, t: Pick<ToolItem, 'tool' | 'category' | 'summary'> & Partial<ToolItem>): ToolItem {
  const s = sessions.get(id)!
  const item: ToolItem = { id: uid(), sessionId: id, agent: s.agent, ts: now(), kind: 'tool', status: 'running', ...t }
  upsert(id, item)
  return item
}
async function say(id: string, text: string): Promise<void> {
  const s = sessions.get(id)!
  const itemId = uid()
  upsert(id, { id: itemId, sessionId: id, agent: s.agent, ts: now(), kind: 'assistant', text: '', streaming: true, model: s.model })
  const words = text.split(/(\s+)/)
  for (let i = 0; i < words.length; i += 3) {
    emit({ type: 'append', sessionId: id, itemId, delta: words.slice(i, i + 3).join(''), field: 'text' })
    await sleep(35)
  }
  upsert(id, { id: itemId, sessionId: id, agent: s.agent, ts: now(), kind: 'assistant', text, streaming: false, model: s.model })
}
function finish(id: string, ok: boolean, cost = 0.04): void {
  const s = sessions.get(id)!
  upsert(id, { id: uid(), sessionId: id, agent: s.agent, ts: now(), kind: 'result', ok, durationMs: 6000 + Math.round(Math.random() * 9000), costUsd: s.agent === 'claude' ? cost : undefined })
  setStatus(id, 'idle', { totalCostUsd: (s.totalCostUsd ?? 0) + (s.agent === 'claude' ? cost : 0) })
}

/** A short, believable turn: read, explain, then a command that needs approval under "Ask first". */
async function runTurn(id: string, text: string): Promise<void> {
  const s = sessions.get(id)
  if (!s) return
  const gen = (generation.get(id) ?? 0) + 1
  generation.set(id, gen)
  const alive = (): boolean => generation.get(id) === gen
  const claude = s.agent === 'claude'
  setStatus(id, 'running')
  await sleep(700)
  if (!alive()) return
  const read = tool(id, { tool: claude ? 'Read' : 'shell', category: claude ? 'read' : 'command', summary: claude ? 'package.json' : 'rg --files | head -50', input: claude ? undefined : { command: 'rg --files | head -50' } })
  await sleep(600)
  upsert(id, { ...read, status: 'done', durationMs: claude ? 40 : 210 })
  if (!alive()) return
  await say(id, claude ? `Looking into “${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”. I'll run the test suite first so we know where we stand.` : `On it. Checking the current state before changing anything.`)
  if (!alive()) return
  const cmd = claude ? 'npm test -- --run' : 'npx vitest run --reporter=dot'
  const run = tool(id, { tool: claude ? 'Bash' : 'shell', category: 'command', summary: claude ? 'Run the test suite' : cmd, input: { command: cmd } })
  const proceed = async (optionId: string, message?: string): Promise<void> => {
    if (!alive()) return
    if (optionId === 'allow' || optionId === 'always' || optionId === 'auto') {
      setStatus(id, 'running')
      await sleep(1300)
      upsert(id, { ...run, status: 'done', exitCode: 0, durationMs: 8400, output: '✓ 42 tests passed (8.4s)' })
      await say(id, `All **42 tests pass**. This is the demo, so the agent stops here. On your Mac, ${claude ? 'Claude Code' : 'Codex'} would keep going and report exactly what it changed.`)
      finish(id, true)
    } else {
      upsert(id, { ...run, status: 'declined' })
      await say(id, message ? `Okay, not running it. You said: “${message}”. What should I do instead?` : `Okay, I won't run that. Tell me what you'd prefer instead.`)
      finish(id, true, 0.01)
    }
  }
  const policy = sessions.get(id)?.policy
  if (policy === 'full-auto' || policy === 'auto-edit') return proceed('auto')
  await sleep(300)
  const approvalId = uid()
  const approval: ApprovalItem = {
    id: approvalId,
    sessionId: id,
    agent: s.agent,
    ts: now(),
    kind: 'approval',
    approvalKind: 'command',
    title: claude ? 'Bash wants to run' : 'Codex wants to run a command',
    detail: cmd,
    reason: claude ? 'Run the test suite' : undefined,
    options: claude
      ? [
          { id: 'allow', label: 'Allow once', tone: 'primary' },
          { id: 'always', label: 'Always allow' },
          { id: 'deny', label: 'Deny', tone: 'danger' }
        ]
      : [
          { id: 'allow', label: 'Allow once', tone: 'primary' },
          { id: 'always', label: 'Allow for session' },
          { id: 'deny', label: 'Deny', tone: 'danger' }
        ],
    requestRef: approvalId
  }
  upsert(id, approval)
  setStatus(id, 'waiting-approval')
  pending.set(approvalId, (opt, msg) => void proceed(opt, msg))
}

const MODELS: Record<AgentKind, AgentModel[]> = {
  claude: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }
  ],
  codex: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'] }]
}

export const api: RemoteApi = {
  async state(): Promise<RemoteState> {
    return {
      version: 'demo',
      accounts: {
        claude: { agent: 'claude', installed: true, loggedIn: true, version: '2.1.310', plan: 'max', computerUseAvailable: true },
        codex: { agent: 'codex', installed: true, loggedIn: true, version: '0.164.0', plan: 'pro', computerUseAvailable: true }
      },
      sessions: [...sessions.values()],
      recentFolders: ['/Users/you/Projects/acme-app', '/Users/you/Projects/marketing-site'],
      defaultCwd: '/Users/you/Projects/acme-app',
      defaultPolicy: 'ask',
      shareScreen: true
    }
  },
  async items(id) {
    return [...list(id)]
  },
  async send(id, text) {
    const s = sessions.get(id)
    if (!s) throw new Error('Session not found')
    upsert(id, { id: uid(), sessionId: id, agent: s.agent, ts: now(), kind: 'user', text })
    if (s.title.startsWith('New ')) setStatus(id, s.status, { title: text.split('\n')[0].slice(0, 48) })
    void runTurn(id, text)
    return { ok: true }
  },
  async interrupt(id) {
    generation.set(id, (generation.get(id) ?? 0) + 1)
    for (const it of list(id)) {
      if (it.kind === 'approval' && !it.resolved) {
        upsert(id, { ...it, resolved: { optionId: 'cancel', message: 'Interrupted' } })
        pending.delete(it.id)
      }
      if (it.kind === 'tool' && it.status === 'running') upsert(id, { ...it, status: 'declined' })
    }
    const s = sessions.get(id)
    if (s) upsert(id, { id: uid(), sessionId: id, agent: s.agent, ts: now(), kind: 'status', level: 'info', text: 'Stopped from your phone.' })
    setStatus(id, 'idle')
    return { ok: true }
  },
  async policy(id, policy: PolicyMode) {
    setStatus(id, sessions.get(id)?.status ?? 'idle', { policy })
    return sessions.get(id)!
  },
  async approve(resp: ApprovalResponse) {
    const it = list(resp.sessionId).find((x) => x.id === resp.itemId)
    if (!it || it.kind !== 'approval' || it.resolved) throw new Error('That request is no longer waiting.')
    upsert(resp.sessionId, { ...it, resolved: { optionId: resp.optionId, answers: resp.answers, message: resp.message } })
    const cont = pending.get(resp.itemId)
    pending.delete(resp.itemId)
    setStatus(resp.sessionId, 'running')
    cont?.(resp.optionId, resp.message)
    return { ok: true }
  },
  async create(input: NewSessionInput & { text?: string }) {
    const id = uid()
    const meta: SessionMeta = {
      id,
      agent: input.agent,
      title: input.text?.trim() ? input.text.trim().split('\n')[0].slice(0, 48) : `New ${input.agent === 'claude' ? 'Claude' : 'Codex'} session`,
      cwd: input.cwd,
      createdAt: now(),
      updatedAt: now(),
      status: 'idle',
      model: input.agent === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol',
      policy: input.policy ?? 'ask',
      capabilities: { computerUse: false, browserUse: false, webAccess: true, inAppBrowser: true }
    }
    sessions.set(id, meta)
    items.set(id, [])
    emit({ type: 'session', session: meta })
    if (input.text?.trim()) setTimeout(() => void api.send(id, input.text as string), 50)
    return meta
  },
  async models(agent) {
    return MODELS[agent]
  },
  async frame(src) {
    if (src === 'screen') return { url: screenUrl }
    return { error: 'The Tandem browser is closed on the demo Mac. When an agent opens a page, it shows up here.' }
  },
  events(onEvent, onStatus) {
    listeners.add(onEvent)
    const t = setTimeout(() => onStatus(true), 120)
    return () => {
      clearTimeout(t)
      listeners.delete(onEvent)
    }
  }
}
