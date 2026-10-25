/**
 * Live protocol test against the real `claude` CLI. Needs a signed-in Claude Code.
 *   TANDEM_LIVE=1 npx vitest run tests/live
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSession } from '../../src/main/agents/claude/ClaudeSession'
import { findClaudeBinary } from '../../src/main/services/detect'
import type { SessionMeta, TimelineEvent, TimelineItem } from '../../src/shared/types'
import { DEFAULT_CAPABILITIES } from '../../src/shared/types'

describe('ClaudeSession (live)', () => {
  it('runs a tool with an approval round-trip and streams text', async () => {
    const binary = findClaudeBinary()
    expect(binary).toBeTruthy()
    const cwd = mkdtempSync(join(tmpdir(), 'tandem-live-'))
    const meta: SessionMeta = { id: crypto.randomUUID(), agent: 'claude', title: 't', cwd, createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', policy: 'ask', capabilities: DEFAULT_CAPABILITIES, model: 'haiku' }
    const events: TimelineEvent[] = []
    const items = new Map<string, TimelineItem>()
    let session!: ClaudeSession
    const done = new Promise<void>((resolve) => {
      session = new ClaudeSession({
        binary: binary!,
        meta,
        emit: (ev) => {
          events.push(ev)
          if (ev.type === 'upsert') {
            items.set(ev.item.id, ev.item)
            if (ev.item.kind === 'approval' && !ev.item.resolved) void session.respondApproval({ sessionId: meta.id, itemId: ev.item.id, optionId: 'allow' })
            if (ev.item.kind === 'result') resolve()
          }
        },
        onMeta: (p) => Object.assign(meta, p)
      })
    })
    await session.start()
    await session.send('Run the shell command `echo tandem-live > marker.txt` with Bash, then reply with exactly the word done.')
    await done
    await session.close()
    const kinds = [...items.values()].map((i) => i.kind)
    expect(kinds).toContain('tool')
    expect(kinds).toContain('approval')
    expect(kinds).toContain('result')
    expect(existsSync(join(cwd, 'marker.txt'))).toBe(true)
    const assistant = [...items.values()].filter((i) => i.kind === 'assistant')
    expect(assistant.some((a) => a.kind === 'assistant' && /done/i.test(a.text))).toBe(true)
    expect(events.some((e) => e.type === 'append')).toBe(true)
    expect(meta.nativeId).toBeTruthy()
  })
})
