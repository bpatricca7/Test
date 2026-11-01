import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteServer, newRemoteToken } from '../src/main/services/remote'
import { DEFAULT_SETTINGS, type SessionMeta, type TimelineEvent } from '../src/shared/types'

describe('RemoteServer', () => {
  const token = newRemoteToken()
  const appDir = mkdtempSync(join(tmpdir(), 'tandem-remote-'))
  writeFileSync(join(appDir, 'index.html'), '<!doctype html><title>remote</title>ok')
  const calls: string[] = []
  const meta: SessionMeta = { id: 's1', agent: 'claude', title: 'T', cwd: '/x', createdAt: 1, updatedAt: 1, status: 'idle', policy: 'ask', capabilities: { computerUse: false, browserUse: false, webAccess: true, inAppBrowser: false } }
  const server = new RemoteServer({
    token: () => token,
    settings: () => ({ ...DEFAULT_SETTINGS, remoteShareScreen: false }),
    accounts: () => ({ claude: { agent: 'claude', installed: true, loggedIn: true, computerUseAvailable: false }, codex: { agent: 'codex', installed: false, loggedIn: false, computerUseAvailable: false } }),
    sessions: {
      list: () => [meta],
      items: () => [],
      create: (i) => ({ ...meta, id: 's2', agent: i.agent, cwd: i.cwd }),
      send: async (id, text) => {
        calls.push(`send ${id} ${text}`)
      },
      interrupt: async (id) => {
        calls.push(`interrupt ${id}`)
      },
      approve: async (r) => {
        calls.push(`approve ${r.itemId} ${r.optionId}`)
      },
      setPolicy: async (id, p) => ({ ...meta, id, policy: p })
    },
    models: async () => [],
    screen: async () => undefined,
    browser: async () => undefined,
    appDir,
    version: '0.0.0-test'
  })
  beforeAll(() => server.start(0))
  afterAll(() => server.stop())
  const base = (): string => `http://127.0.0.1:${server.port}`

  it('refuses unpaired visitors', async () => {
    expect((await fetch(`${base()}/api/state`)).status).toBe(401)
    const page = await fetch(`${base()}/`)
    expect(page.status).toBe(401)
    expect(await page.text()).toContain('Pair with Tandem')
    expect((await fetch(`${base()}/api/state?t=wrong`)).status).toBe(401)
  })
  it('pairs via the QR link and serves the app + API', async () => {
    const r = await fetch(`${base()}/?t=${token}`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    const cookie = r.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('tandem_remote=')
    const h = { Cookie: cookie.split(';')[0] }
    const page = await fetch(`${base()}/`, { headers: h })
    expect(await page.text()).toContain('remote')
    const st = (await (await fetch(`${base()}/api/state`, { headers: h })).json()) as { sessions: SessionMeta[]; version: string }
    expect(st.sessions[0].id).toBe('s1')
    expect(st.version).toBe('0.0.0-test')
    const bearer = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    expect((await fetch(`${base()}/api/sessions/s1/send`, { method: 'POST', headers: bearer, body: JSON.stringify({ text: 'hi' }) })).status).toBe(200)
    expect((await fetch(`${base()}/api/approve`, { method: 'POST', headers: bearer, body: JSON.stringify({ sessionId: 's1', itemId: 'a1', optionId: 'allow' }) })).status).toBe(200)
    const created = (await (await fetch(`${base()}/api/sessions`, { method: 'POST', headers: bearer, body: JSON.stringify({ agent: 'codex', cwd: '/y', text: 'go' }) })).json()) as SessionMeta
    expect(created.agent).toBe('codex')
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toEqual(['send s1 hi', 'approve a1 allow', 'send s2 go'])
    expect((await fetch(`${base()}/api/screen.jpg`, { headers: h })).status).toBe(404)
  })
  it('streams events over SSE', async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base()}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = dec.decode((await reader.read()).value)
    expect(buf).toContain('event: hello')
    const ev: TimelineEvent = { type: 'toast', level: 'info', text: 'ping' }
    server.broadcast(ev)
    buf += dec.decode((await reader.read()).value)
    expect(buf).toContain('"text":"ping"')
    ctrl.abort()
  })
})
