/**
 * Tandem's in-app browser as an MCP server (Streamable HTTP transport, JSON responses) on
 * 127.0.0.1 with a per-launch bearer token. Claude Code connects through --mcp-config and Codex
 * through mcp_servers in its thread config, so both agents drive the same pane the user sees.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { BrowserBackend, Target } from './browserTypes'

type Json = Record<string, unknown>
interface RpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Json
}

export const SERVER_NAME = 'tandem-browser'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `Tandem's built-in browser. It is a real Chromium pane inside the Tandem window; the user watches every action live.
Workflow: navigate → snapshot → act. snapshot lists interactive elements with refs like [e12]; pass ref to click/type/select_option. Use screenshot only when layout or images matter. Logins persist between sessions. The user can also browse the pane themselves, so re-snapshot before acting if some time passed.`

const targetProps = {
  ref: { type: 'string', description: 'Element ref from snapshot, e.g. "e12"' },
  selector: { type: 'string', description: 'CSS selector (used when ref is absent)' },
  text: { type: 'string', description: 'Visible text of a link/button to match (case-insensitive)' },
  x: { type: 'number', description: 'Viewport x in CSS px (with y, used when nothing else matches)' },
  y: { type: 'number' }
}

export const TOOLS = [
  { name: 'navigate', description: 'Load a URL in the Tandem browser pane and wait for it to finish loading.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'go_back', description: 'Go back one page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'go_forward', description: 'Go forward one page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'reload', description: 'Reload the current page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'snapshot', description: 'Current URL, title, the interactive elements with refs ([e12] button "Sign in"), and the visible text. Call this before clicking or typing.', inputSchema: { type: 'object', properties: {} } },
  { name: 'screenshot', description: 'PNG screenshot of the pane (downscaled). Use when you need to see layout, images or canvas content.', inputSchema: { type: 'object', properties: {} } },
  { name: 'click', description: 'Click an element by ref, selector, visible text, or coordinates.', inputSchema: { type: 'object', properties: { ...targetProps, button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' } } } },
  { name: 'type', description: 'Type text into an input/textarea/contenteditable (focuses the target first; omit the target to type into the focused element).', inputSchema: { type: 'object', properties: { ...targetProps, text: { type: 'string', description: 'Text to type' }, submit: { type: 'boolean', description: 'Press Enter afterwards' }, clear: { type: 'boolean', description: 'Clear the field first (default true)' } }, required: ['text'] } },
  { name: 'press_key', description: 'Press a key: Enter, Tab, Escape, ArrowDown, Backspace, a letter, etc. Optional modifiers: shift, control, alt, meta.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, modifiers: { type: 'array', items: { type: 'string' } } }, required: ['key'] } },
  { name: 'scroll', description: 'Scroll the page (or scroll an element into view when a target is given).', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number', description: 'Pixels, default 600' }, ...targetProps } } },
  { name: 'select_option', description: 'Choose an option in a <select> by value or visible label.', inputSchema: { type: 'object', properties: { ...targetProps, value: { type: 'string' } }, required: ['value'] } },
  { name: 'get_text', description: 'Visible text of the whole page (truncated).', inputSchema: { type: 'object', properties: {} } },
  { name: 'evaluate', description: 'Run JavaScript in the page and return the JSON result.', inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
  { name: 'console_messages', description: 'Recent console output (errors, warnings, logs).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'network_requests', description: 'Recent network requests with status codes; optional substring filter on the URL.', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, filter: { type: 'string' } } } },
  { name: 'wait_for', description: 'Wait for a selector or text to appear, or just wait some milliseconds.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, ms: { type: 'number' }, timeoutMs: { type: 'number' } } } }
] as const

function targetFrom(a: Json): Target | undefined {
  const t: Target = {}
  if (typeof a.ref === 'string') t.ref = a.ref
  if (typeof a.selector === 'string') t.selector = a.selector
  if (typeof a.text === 'string' && !('__textIsInput' in a)) t.text = a.text
  if (typeof a.x === 'number' && typeof a.y === 'number') {
    t.x = a.x
    t.y = a.y
  }
  return Object.keys(t).length ? t : undefined
}

export async function callTool(backend: BrowserBackend, name: string, args: Json): Promise<{ content: Json[]; isError?: boolean }> {
  const text = (s: string): { content: Json[] } => ({ content: [{ type: 'text', text: s }] })
  const stateText = (s: { url: string; title: string; loading: boolean }): string => `${s.title ? `${s.title} — ` : ''}${s.url}${s.loading ? ' (still loading)' : ''}`
  backend.setBusy(`${name}${args.ref ? ` ${String(args.ref)}` : args.url ? ` ${String(args.url).slice(0, 60)}` : ''}`)
  try {
    switch (name) {
      case 'navigate':
        return text(stateText(await backend.navigate(String(args.url ?? ''))))
      case 'go_back':
        return text(stateText(await backend.back()))
      case 'go_forward':
        return text(stateText(await backend.forward()))
      case 'reload':
        return text(stateText(await backend.reload()))
      case 'snapshot': {
        const s = await backend.snapshot()
        return text([`URL: ${s.url}`, `Title: ${s.title}`, '', `Interactive elements (${s.elements.length}):`, ...s.elements, '', 'Page text:', s.text].join('\n'))
      }
      case 'screenshot': {
        const shot = await backend.screenshot()
        const st = backend.state()
        return { content: [{ type: 'image', data: shot.base64, mimeType: 'image/png' }, { type: 'text', text: `${shot.width}x${shot.height} · ${stateText(st)}` }] }
      }
      case 'click': {
        const t = targetFrom(args)
        if (!t) throw new Error('click needs a ref, selector, text, or x/y')
        return text(await backend.click(t, { button: args.button as 'left' | undefined, double: Boolean(args.double) }))
      }
      case 'type': {
        const { text: typed, ...rest } = args
        const t = targetFrom({ ...rest })
        return text(await backend.type(t, String(typed ?? ''), { submit: Boolean(args.submit), clear: args.clear === undefined ? true : Boolean(args.clear) }))
      }
      case 'press_key':
        return text(await backend.pressKey(String(args.key ?? ''), Array.isArray(args.modifiers) ? (args.modifiers as string[]) : undefined))
      case 'scroll':
        return text(await backend.scroll({ direction: args.direction as 'down' | undefined, amount: typeof args.amount === 'number' ? args.amount : undefined, target: targetFrom(args) }))
      case 'select_option': {
        const { value, ...rest } = args
        const t = targetFrom(rest)
        if (!t) throw new Error('select_option needs a ref or selector')
        return text(await backend.selectOption(t, String(value ?? '')))
      }
      case 'get_text':
        return text(await backend.getText())
      case 'evaluate': {
        const r = await backend.evaluate(String(args.script ?? ''))
        return text(typeof r === 'string' ? r : JSON.stringify(r, null, 2) ?? 'undefined')
      }
      case 'console_messages': {
        const list = backend.consoleMessages(typeof args.limit === 'number' ? args.limit : 50)
        return text(list.length ? list.map((c) => `[${c.level}] ${c.message}${c.source ? ` (${c.source}:${c.line ?? ''})` : ''}`).join('\n') : 'No console messages.')
      }
      case 'network_requests': {
        const list = backend.networkRequests(typeof args.limit === 'number' ? args.limit : 50, typeof args.filter === 'string' ? args.filter : undefined)
        return text(list.length ? list.map((n) => `${n.method} ${n.status ?? n.error ?? '…'} ${n.url}${n.durationMs ? ` ${n.durationMs}ms` : ''}`).join('\n') : 'No requests recorded.')
      }
      case 'wait_for':
        return text(await backend.waitFor({ selector: args.selector as string | undefined, text: args.text as string | undefined, ms: args.ms as number | undefined, timeoutMs: args.timeoutMs as number | undefined }))
      default:
        throw new Error(`Unknown tool ${name}`)
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true }
  } finally {
    backend.setBusy(undefined)
  }
}

export class BrowserMcpServer {
  readonly token = randomBytes(24).toString('hex')
  private server?: Server
  port = 0

  constructor(
    private readonly backend: () => Promise<BrowserBackend>,
    private readonly version = '0.1.0'
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  get endpoint(): { url: string; token: string } {
    return { url: this.url, token: this.token }
  }

  start(port = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        this.server = server
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
      this.server.closeAllConnections?.()
      this.server = undefined
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${this.token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    if (req.method === 'GET') {
      // No server-initiated stream in this implementation.
      res.writeHead(405, { Allow: 'POST, DELETE' }).end()
      return
    }
    if (req.method === 'DELETE') {
      res.writeHead(200).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    let parsed: RpcRequest | RpcRequest[]
    try {
      parsed = JSON.parse(body) as RpcRequest | RpcRequest[]
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
      return
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed]
    const responses: Json[] = []
    for (const msg of batch) {
      const r = await this.dispatch(msg)
      if (r) responses.push(r)
    }
    if (!responses.length) {
      res.writeHead(202).end()
      return
    }
    const payload = Array.isArray(parsed) ? responses : responses[0]
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
  }

  private async dispatch(msg: RpcRequest): Promise<Json | undefined> {
    const id = msg.id
    const isNotification = id === undefined || id === null
    const method = msg.method ?? ''
    const params = msg.params ?? {}
    const reply = (result: unknown): Json => ({ jsonrpc: '2.0', id, result })
    const fail = (code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } })
    if (isNotification) return undefined
    switch (method) {
      case 'initialize': {
        const requested = String(params.protocolVersion ?? '')
        return reply({
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: 'Tandem browser', version: this.version },
          instructions: INSTRUCTIONS
        })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = String(params.name ?? '')
        const args = (params.arguments ?? {}) as Json
        if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool ${name}`)
        try {
          const backend = await this.backend()
          return reply(await callTool(backend, name, args))
        } catch (e) {
          return reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true })
        }
      }
      case 'resources/list':
      case 'prompts/list':
        return reply(method === 'resources/list' ? { resources: [] } : { prompts: [] })
      default:
        return fail(-32601, `Method not found: ${method}`)
    }
  }
}
