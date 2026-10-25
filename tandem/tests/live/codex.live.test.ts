/**
 * Live handshake test against the real `codex` CLI app-server (no login needed for these calls).
 *   TANDEM_LIVE=1 CODEX_BIN=/path/to/codex npx vitest run tests/live
 */
import { describe, expect, it } from 'vitest'
import { CodexServer } from '../../src/main/agents/codex/CodexServer'
import { CodexSession } from '../../src/main/agents/codex/CodexSession'
import { findCodexBinary, listCodexModels } from '../../src/main/services/detect'
import type { SessionMeta, TimelineEvent } from '../../src/shared/types'
import { DEFAULT_CAPABILITIES } from '../../src/shared/types'

describe('Codex app-server (live)', () => {
  it('initializes, lists models, starts a thread and reports account state', async () => {
    const binary = process.env.CODEX_BIN ?? findCodexBinary()
    expect(binary).toBeTruthy()
    const server = new CodexServer(binary!)
    await server.ensureStarted()
    const models = await listCodexModels(server)
    expect(models.length).toBeGreaterThan(0)
    const acc = await server.request<{ account: unknown }>('account/read', { refreshToken: false })
    expect(acc).toHaveProperty('account')
    const meta: SessionMeta = { id: crypto.randomUUID(), agent: 'codex', title: 't', cwd: process.cwd(), createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', policy: 'ask', capabilities: { ...DEFAULT_CAPABILITIES, computerUse: true } }
    const events: TimelineEvent[] = []
    const s = new CodexSession({ server, meta, emit: (e) => events.push(e), onMeta: (p) => Object.assign(meta, p) })
    await s.start()
    expect(meta.nativeId).toBeTruthy()
    expect(meta.model).toBeTruthy()
    await s.close()
    await server.stop()
  })
})
