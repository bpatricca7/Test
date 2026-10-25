import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserMcpServer, TOOLS } from '../src/main/services/browserMcp'
import type { BrowserBackend } from '../src/main/services/browserTypes'
import type { BrowserState } from '../src/shared/types'

function fakeBackend(): BrowserBackend & { log: string[] } {
  const log: string[] = []
  let url = 'about:blank'
  const state = (): BrowserState => ({ open: true, url, title: 'Fake', loading: false, canGoBack: false, canGoForward: false })
  return {
    log,
    state,
    async navigate(u) {
      url = u
      log.push(`navigate ${u}`)
      return state()
    },
    async back() {
      return state()
    },
    async forward() {
      return state()
    },
    async reload() {
      return state()
    },
    async snapshot() {
      return { url, title: 'Fake', elements: ['[e1] button "Go"'], text: 'hello' }
    },
    async screenshot() {
      return { base64: 'aGk=', width: 10, height: 10 }
    },
    async click(t) {
      log.push(`click ${JSON.stringify(t)}`)
      return 'clicked'
    },
    async type(t, text) {
      log.push(`type ${text} ${JSON.stringify(t)}`)
      return 'typed'
    },
    async pressKey(k) {
      return `pressed ${k}`
    },
    async scroll() {
      return 'scrolled'
    },
    async selectOption() {
      return 'selected'
    },
    async getText() {
      return 'hello'
    },
    async evaluate() {
      return { ok: 1 }
    },
    consoleMessages() {
      return []
    },
    networkRequests() {
      return []
    },
    async waitFor() {
      return 'found'
    },
    setBusy() {}
  }
}

describe('BrowserMcpServer', () => {
  const backend = fakeBackend()
  const server = new BrowserMcpServer(async () => backend)
  beforeAll(() => server.start())
  afterAll(() => server.stop())
  const post = (body: unknown, token = server.token): Promise<Response> =>
    fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (body: unknown): Promise<any> => (await post(body)).json()

  it('rejects a bad token', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'nope')
    expect(r.status).toBe(401)
  })
  it('initializes and lists tools', async () => {
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    expect(init.result.protocolVersion).toBe('2025-03-26')
    expect(init.result.serverInfo.name).toBe('tandem-browser')
    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(note.status).toBe(202)
    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name))
  })
  it('calls tools and reports errors in-band', async () => {
    const nav = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'navigate', arguments: { url: 'https://example.com' } } })
    expect(nav.result.content[0].text).toContain('https://example.com')
    const snap = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'snapshot', arguments: {} } })
    expect(snap.result.content[0].text).toContain('[e1] button "Go"')
    const typed = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'type', arguments: { ref: 'e1', text: 'hi', submit: true } } })
    expect(typed.result.content[0].text).toBe('typed')
    expect(backend.log.at(-1)).toBe('type hi {"ref":"e1"}')
    const shot = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'screenshot', arguments: {} } })
    expect(shot.result.content[0].type).toBe('image')
    const bad = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'click', arguments: {} } })
    expect(bad.result.isError).toBe(true)
    const unknown = await call({ jsonrpc: '2.0', id: 8, method: 'nope' })
    expect(unknown.error.code).toBe(-32601)
  })
  it('handles batches', async () => {
    const r = await call([{ jsonrpc: '2.0', id: 9, method: 'ping' }, { jsonrpc: '2.0', id: 10, method: 'tools/list' }])
    expect(Array.isArray(r)).toBe(true)
    expect(r).toHaveLength(2)
  })
})
