/**
 * Finds the two CLIs on this machine and reports who is signed in.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountState, AgentKind, AgentModel, UsageWindow } from '@shared/types'
import { run, whichSync } from '../util'
import { probeClaude } from '../agents/claude/ClaudeSession'
import type { CodexServer } from '../agents/codex/CodexServer'

type Json = Record<string, unknown>

export function findClaudeBinary(override?: string): string | undefined {
  const home = homedir()
  return whichSync('claude', [
    override ?? '',
    join(home, '.claude', 'local', 'claude'),
    join(home, '.claude', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ])
}

export function findCodexBinary(override?: string): string | undefined {
  const home = homedir()
  return whichSync('codex', [override ?? '', join(home, '.codex', 'bin', 'codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'])
}

function readClaudeOauth(): { email?: string; org?: string } {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as Json
    const acc = (cfg.oauthAccount ?? {}) as Json
    return { email: acc.emailAddress ? String(acc.emailAddress) : undefined, org: acc.organizationName ? String(acc.organizationName) : undefined }
  } catch {
    return {}
  }
}

export interface ClaudeProbeCache {
  models: AgentModel[]
  subscription?: string
  email?: string
  version?: string
  at: number
}

export async function detectClaude(binary: string | undefined, cwd: string, cache: { value?: ClaudeProbeCache }, deep: boolean): Promise<AccountState> {
  const base: AccountState = { agent: 'claude', installed: Boolean(binary), binaryPath: binary, loggedIn: false, computerUseAvailable: false }
  if (!binary) return { ...base, problem: 'Claude Code CLI not found. Install it from claude.ai/code or `npm i -g @anthropic-ai/claude-code`.' }
  const [ver, auth] = await Promise.all([run(binary, ['--version']), run(binary, ['auth', 'status'])])
  base.version = ver.stdout.trim().split(/\s+/)[0] || undefined
  let status: Json = {}
  try {
    status = JSON.parse(auth.stdout.trim()) as Json
  } catch {
    /* older CLIs print text */
  }
  base.loggedIn = Boolean(status.loggedIn)
  base.authMethod = status.authMethod ? String(status.authMethod) : undefined
  const oauth = readClaudeOauth()
  base.email = oauth.email
  if (!base.loggedIn) base.problem = 'Not signed in. Click “Sign in” to run `claude auth login`.'
  if (deep && base.loggedIn) {
    try {
      if (!cache.value || Date.now() - cache.value.at > 10 * 60_000) {
        const probe = await probeClaude(binary, cwd)
        const models: AgentModel[] = probe.models.map((m) => ({
          id: String(m.value),
          label: String(m.displayName ?? m.value),
          description: m.description ? String(m.description) : undefined,
          efforts: (m.supportedEffortLevels as string[] | undefined) ?? undefined
        }))
        const acc = probe.account
        cache.value = { models, subscription: acc.subscriptionType ? String(acc.subscriptionType) : undefined, email: acc.email ? String(acc.email) : undefined, version: probe.version, at: Date.now() }
      }
      base.plan = cache.value.subscription
      base.email = cache.value.email ?? base.email
      if (cache.value.version) base.version = cache.value.version
    } catch (e) {
      base.problem = `Signed in, but Claude Code did not respond: ${(e as Error).message}`
    }
  }
  const isMac = process.platform === 'darwin'
  const planOk = !base.plan || /pro|max/i.test(base.plan)
  base.computerUseAvailable = isMac && base.loggedIn && planOk
  base.computerUseNote = !isMac
    ? 'Claude computer use is macOS only.'
    : !planOk
      ? 'Claude computer use needs a Pro or Max plan.'
      : 'Computer use runs in an interactive Claude session (Terminal tab). Tandem enables the computer-use server for the project automatically.'
  base.browserUseNote =
    base.authMethod && base.authMethod !== 'oauth_token'
      ? 'Claude in Chrome needs a claude.ai login (Pro, Max, Team or Enterprise); it is off with API-key auth.'
      : 'Uses the Claude in Chrome extension (Chrome, Edge, Brave, Arc…) signed in to the same claude.ai account. Needs Pro, Max, Team or Enterprise.'
  return base
}

export async function detectCodex(binary: string | undefined, server: CodexServer | undefined): Promise<AccountState> {
  const base: AccountState = { agent: 'codex', installed: Boolean(binary), binaryPath: binary, loggedIn: false, computerUseAvailable: false }
  if (!binary) return { ...base, problem: 'Codex CLI not found. Install it with `npm i -g @openai/codex` or `brew install codex`.' }
  const ver = await run(binary, ['--version'])
  base.version = ver.stdout.trim().replace(/^codex-cli\s*/i, '') || undefined
  if (server) {
    try {
      await server.ensureStarted()
      const acc = await server.request<Json>('account/read', { refreshToken: false }, 20000)
      const account = acc.account as Json | null
      if (account) {
        base.loggedIn = true
        base.authMethod = String(account.type)
        if (account.type === 'chatgpt') {
          base.email = account.email ? String(account.email) : undefined
          base.plan = account.planType ? String(account.planType) : undefined
        } else if (account.type === 'apiKey') base.plan = 'API key'
      } else {
        base.problem = 'Not signed in. Click “Sign in” to connect your ChatGPT account.'
      }
      if (base.loggedIn) {
        try {
          const rl = await server.request<Json>('account/rateLimits/read', {}, 15000)
          base.usage = usageFromRateLimits(rl)
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      const status = await run(binary, ['login', 'status'])
      base.loggedIn = /logged in/i.test(status.stdout) && !/not logged in/i.test(status.stdout)
      base.problem = `Codex app-server did not respond: ${(e as Error).message}`
    }
  }
  const isMac = process.platform === 'darwin'
  base.computerUseAvailable = isMac && base.loggedIn
  base.computerUseNote = isMac ? 'Codex computer use controls allowed macOS apps. Allow or deny apps under computer_use.macos.bundle_ids in ~/.codex/config.toml.' : 'Codex computer use is macOS only (Windows in the Codex desktop app).'
  base.browserUseNote = 'Codex’s native Browser only works inside the Codex desktop app, so Tandem gives Codex a Chrome DevTools MCP bridge (needs Node/npx; opens its own Chrome window).'
  return base
}

export function usageFromRateLimits(rl: Json): UsageWindow[] {
  const out: UsageWindow[] = []
  const snap = (rl.rateLimits ?? {}) as Json
  const p = snap.primary as Json | null
  const s = snap.secondary as Json | null
  const label = (w: Json): string => {
    const mins = Number(w.windowDurationMins ?? 0)
    if (mins >= 7 * 24 * 60 - 1) return 'Weekly'
    if (mins >= 24 * 60) return `${Math.round(mins / 60 / 24)}-day`
    if (mins > 0) return `${Math.round(mins / 60)}-hour`
    return 'Usage'
  }
  if (p) out.push({ label: label(p), usedPercent: Number(p.usedPercent ?? 0), resetsAt: p.resetsAt as number | null })
  if (s) out.push({ label: label(s), usedPercent: Number(s.usedPercent ?? 0), resetsAt: s.resetsAt as number | null })
  return out
}

export async function listCodexModels(server: CodexServer): Promise<AgentModel[]> {
  await server.ensureStarted()
  const res = await server.request<Json>('model/list', {}, 30000)
  const data = (res.data ?? []) as Json[]
  return data
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: String(m.id ?? m.model),
      label: String(m.displayName ?? m.id),
      description: m.description ? String(m.description) : undefined,
      efforts: ((m.supportedReasoningEfforts ?? []) as Json[]).map((e) => String(e.reasoningEffort)),
      isDefault: Boolean(m.isDefault)
    }))
}

export function defaultCwd(): string {
  const home = homedir()
  for (const c of [join(home, 'Developer'), join(home, 'Projects'), join(home, 'code'), home]) if (existsSync(c)) return c
  return home
}

export const AGENTS: AgentKind[] = ['claude', 'codex']
