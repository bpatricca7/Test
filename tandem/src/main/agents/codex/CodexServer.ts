/**
 * One shared `codex app-server --stdio` process for the whole app.
 * JSON-RPC 2.0 over newline-delimited JSON. Verified against Codex CLI 0.164.0.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { childEnv, LineBuffer, truncate } from '../../util'

type Json = Record<string, unknown>

export interface RpcServerRequest {
  id: number | string
  method: string
  params: Json
}

export class CodexServer extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>()
  private lines = new LineBuffer()
  private starting?: Promise<void>
  private stderrTail = ''
  readonly binary: string
  private closedByUs = false

  constructor(binary: string) {
    super()
    this.binary = binary
    this.setMaxListeners(200)
  }

  get running(): boolean {
    return Boolean(this.proc && !this.proc.killed)
  }

  async ensureStarted(): Promise<void> {
    if (this.running) return this.starting
    this.starting = this.startInner()
    return this.starting
  }

  private async startInner(): Promise<void> {
    this.closedByUs = false
    const proc = spawn(this.binary, ['app-server', '--stdio'], {
      env: childEnv({ RUST_LOG: 'error' }),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (c: string) => this.lines.push(c, (l) => this.onLine(l)))
    proc.stderr.on('data', (c: string) => {
      this.stderrTail = (this.stderrTail + c).slice(-4000)
    })
    const exited = new Promise<never>((_, rej) => {
      proc.once('error', (e) => rej(e))
      proc.once('exit', (code) => rej(new Error(`codex app-server exited (${code}) ${truncate(this.stderrTail.trim(), 300)}`)))
    })
    proc.on('exit', (code, signal) => {
      this.proc = undefined
      for (const p of this.pending.values()) p.reject(new Error(`codex app-server exited during ${p.method}`))
      this.pending.clear()
      this.emit('exit', { code, signal, closedByUs: this.closedByUs, stderr: this.stderrTail })
    })
    await Promise.race([
      this.request('initialize', {
        clientInfo: { name: 'tandem', title: 'Tandem', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      }),
      exited
    ])
    this.notify('initialized', {})
  }

  async stop(): Promise<void> {
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
  }

  request<T = unknown>(method: string, params: Json = {}, timeoutMs = 60000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(t)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(t)
          reject(e)
        }
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: Json = {}): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  /** Answer a server-initiated request (approvals, user input). */
  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  respondError(id: number | string, message: string, code = -32000): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private write(obj: unknown): void {
    const p = this.proc
    if (!p || p.stdin.destroyed) throw new Error('codex app-server is not running')
    p.stdin.write(JSON.stringify(obj) + '\n')
  }

  private onLine(line: string): void {
    let msg: Json
    try {
      msg = JSON.parse(line) as Json
    } catch {
      return
    }
    if ('id' in msg && msg.id !== null && msg.id !== undefined && !('method' in msg)) {
      // response
      const id = Number(msg.id)
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (msg.error) {
        const e = msg.error as Json
        p.reject(new Error(`${p.method}: ${String(e.message ?? 'error')}${e.data ? ` ${truncate(JSON.stringify(e.data), 300)}` : ''}`))
      } else p.resolve(msg.result)
      return
    }
    if ('method' in msg && 'id' in msg && msg.id !== null && msg.id !== undefined) {
      const req: RpcServerRequest = { id: msg.id as number | string, method: String(msg.method), params: (msg.params ?? {}) as Json }
      this.emit('server-request', req)
      return
    }
    if ('method' in msg) {
      this.emit('notification', { method: String(msg.method), params: (msg.params ?? {}) as Json })
    }
  }
}
