/**
 * Phone remote. Tandem serves a small web app plus a JSON/SSE API on the Mac itself, so a phone on
 * the same network (or a Tailscale/WireGuard network) can watch sessions, answer approvals, send
 * briefs, and see the screen. Every request needs the pairing token from the QR code.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AccountState, AgentKind, AgentModel, ApprovalResponse, NewSessionInput, PolicyMode, SessionMeta, Settings, TimelineEvent, TimelineItem } from '@shared/types'

type Json = Record<string, unknown>

export interface RemoteDeps {
  token: () => string
  settings: () => Settings
  accounts: () => Record<AgentKind, AccountState>
  sessions: {
    list(): SessionMeta[]
    items(id: string): TimelineItem[]
    create(input: NewSessionInput): SessionMeta
    send(id: string, text: string, images?: string[]): Promise<void>
    interrupt(id: string): Promise<void>
    approve(resp: ApprovalResponse): Promise<void>
    setPolicy(id: string, policy: PolicyMode): Promise<SessionMeta>
  }
  models: (agent: AgentKind) => Promise<AgentModel[]>
  /** JPEG of the Mac screen, or undefined when sharing is off / unavailable. */
  screen: () => Promise<Buffer | undefined>
  /** PNG of the in-app browser, or undefined when it is closed. */
  browser: () => Promise<Buffer | undefined>
  /** Directory holding the built remote app (index.html, assets/). */
  appDir: string
  version: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
}

export function newRemoteToken(): string {
  return randomBytes(18).toString('base64url')
}

export function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      // Prefer real LAN/VPN interfaces; skip docker/virtual bridges.
      if (/^(docker|br-|veth|vmnet|utun\d+$)/.test(name) && !/tailscale/i.test(name)) continue
      out.push(i.address)
    }
  }
  return out
}

export class RemoteServer {
  private server?: Server
  private clients = new Set<ServerResponse>()
  private heartbeat?: NodeJS.Timeout
  port = 0
  lastError?: string

  constructor(private readonly deps: RemoteDeps) {}

  get running(): boolean {
    return Boolean(this.server)
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve()
      const server = createServer((req, res) => {
        this.handle(req, res).catch((e) => {
          try {
            res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }))
          } catch {
            /* ignore */
          }
        })
      })
      server.on('error', (e) => {
        this.lastError = (e as Error).message
        this.server = undefined
        reject(e)
      })
      server.listen(port, '0.0.0.0', () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        this.server = server
        this.lastError = undefined
        this.heartbeat = setInterval(() => {
          for (const c of this.clients) c.write(': ping\n\n')
        }, 20000)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeat) clearInterval(this.heartbeat)
      for (const c of this.clients) c.end()
      this.clients.clear()
      const s = this.server
      this.server = undefined
      if (!s) return resolve()
      s.close(() => resolve())
      s.closeAllConnections?.()
    })
  }

  broadcast(ev: TimelineEvent): void {
    if (!this.clients.size) return
    if (ev.type === 'terminal-data' || ev.type === 'terminal-exit') return
    const line = `event: tandem\ndata: ${JSON.stringify(ev)}\n\n`
    for (const c of this.clients) c.write(line)
  }

  // ---------------------------------------------------------------------------------------

  private authorized(req: IncomingMessage, url: URL): boolean {
    const token = this.deps.token()
    const given = url.searchParams.get('t') ?? req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? parseCookie(req.headers.cookie ?? '').tandem_remote
    if (!given || given.length !== token.length) return false
    return timingSafeEqual(Buffer.from(given), Buffer.from(token))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const authed = this.authorized(req, url)
    // First visit from the QR code: move the token into a cookie and drop it from the URL.
    if (authed && url.searchParams.has('t')) {
      res.writeHead(302, { 'Set-Cookie': `tandem_remote=${url.searchParams.get('t')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, Location: url.pathname === '/' ? '/' : url.pathname }).end()
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (!authed) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not paired. Scan the QR code in Tandem → Settings → Phone remote.' }))
        return
      }
      return this.api(req, res, url)
    }
    if (!authed) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAIR_PAGE)
      return
    }
    return this.static(url.pathname, res)
  }

  private static(pathname: string, res: ServerResponse): void {
    const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
    const file = join(this.deps.appDir, rel)
    if (!file.startsWith(this.deps.appDir) || !existsSync(file) || !statSync(file).isFile()) {
      // SPA fallback
      const index = join(this.deps.appDir, 'index.html')
      if (existsSync(index)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        createReadStream(index).pipe(res)
      } else res.writeHead(404).end('Remote app not built. Run `npm run build`.')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }

  private async api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    }
    const path = url.pathname.slice('/api'.length)
    const m = req.method ?? 'GET'

    if (path === '/events' && m === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.write(`event: hello\ndata: ${JSON.stringify({ version: this.deps.version })}\n\n`)
      this.clients.add(res)
      req.on('close', () => this.clients.delete(res))
      return
    }
    if (path === '/state' && m === 'GET') {
      const st = this.deps.settings()
      return json(200, {
        version: this.deps.version,
        accounts: this.deps.accounts(),
        sessions: this.deps.sessions.list(),
        recentFolders: st.recentFolders,
        defaultCwd: st.defaultCwd,
        defaultPolicy: st.defaultPolicy,
        shareScreen: Boolean(st.remoteShareScreen)
      })
    }
    if (path === '/models' && m === 'GET') {
      const agent = (url.searchParams.get('agent') ?? 'claude') as AgentKind
      return json(200, await this.deps.models(agent))
    }
    if (path === '/screen.jpg' && m === 'GET') {
      const buf = await this.deps.screen()
      if (!buf) return json(404, { error: 'Screen sharing is off in Tandem → Settings → Phone remote, or macOS Screen Recording permission is missing.' })
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(buf)
      return
    }
    if (path === '/browser.png' && m === 'GET') {
      const buf = await this.deps.browser()
      if (!buf) return json(404, { error: 'The Tandem browser is not open.' })
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(buf)
      return
    }
    const sess = /^\/sessions\/([^/]+)(?:\/([a-z]+))?$/.exec(path)
    if (sess && m === 'GET' && sess[2] === 'items') return json(200, this.deps.sessions.items(sess[1]))
    if (m === 'POST') {
      const body = (await readBody(req)) as Json
      if (path === '/sessions') {
        const input = body as unknown as NewSessionInput
        if (!input.agent || !input.cwd) return json(400, { error: 'agent and cwd are required' })
        const meta = this.deps.sessions.create(input)
        if (typeof body.text === 'string' && body.text.trim()) void this.deps.sessions.send(meta.id, String(body.text))
        return json(200, meta)
      }
      if (path === '/approve') {
        await this.deps.sessions.approve(body as unknown as ApprovalResponse)
        return json(200, { ok: true })
      }
      if (sess) {
        const id = sess[1]
        if (sess[2] === 'send') {
          const text = String(body.text ?? '').trim()
          if (!text) return json(400, { error: 'text is required' })
          void this.deps.sessions.send(id, text, Array.isArray(body.images) ? (body.images as string[]) : undefined)
          return json(200, { ok: true })
        }
        if (sess[2] === 'interrupt') {
          await this.deps.sessions.interrupt(id)
          return json(200, { ok: true })
        }
        if (sess[2] === 'policy') {
          return json(200, await this.deps.sessions.setPolicy(id, body.policy as PolicyMode))
        }
      }
    }
    json(404, { error: `No route ${m} ${path}` })
  }
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 4 * 1024 * 1024) throw new Error('Body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

const PAIR_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tandem · pair</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0f;color:#eef0f5;font:16px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#a8afbe;margin:0;max-width:34ch}</style>
<h1>Pair with Tandem</h1><p>Open Tandem on your Mac, go to Settings → Phone remote, and scan the QR code with this phone.</p>`
