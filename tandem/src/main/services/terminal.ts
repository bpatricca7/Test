/**
 * Embedded terminals. Uses node-pty when its native module matches the running Electron;
 * falls back to a plain child process (no TTY) so the app still works when the module is missing.
 * Interactive Claude Code (the only way to get computer use on the CLI) runs here.
 */
import { spawn as spawnChild, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import type { TerminalSpec } from '@shared/types'
import { childEnv, uid } from '../util'

type PtyModule = typeof import('node-pty')

interface Term {
  spec: TerminalSpec
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface TerminalEvents {
  onData(termId: string, data: string): void
  onExit(termId: string, code: number): void
}

let ptyModule: PtyModule | null | undefined

export function loadPty(): PtyModule | null {
  if (ptyModule !== undefined) return ptyModule
  try {
    const req = createRequire(import.meta.url)
    ptyModule = req('node-pty') as PtyModule
  } catch (e) {
    console.warn('[tandem] node-pty unavailable, terminals fall back to pipes:', (e as Error).message)
    ptyModule = null
  }
  return ptyModule
}

export class TerminalManager {
  private terms = new Map<string, Term>()
  constructor(private readonly events: TerminalEvents) {}

  get hasPty(): boolean {
    return loadPty() !== null
  }

  list(): TerminalSpec[] {
    return [...this.terms.values()].map((t) => t.spec)
  }

  open(spec: Omit<TerminalSpec, 'id'> & { id?: string }, command: string, args: string[], opts: { cols?: number; rows?: number; env?: Record<string, string>; initialInput?: string } = {}): TerminalSpec {
    const id = spec.id ?? uid()
    const full: TerminalSpec = { ...spec, id }
    const env = childEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG ?? 'en_US.UTF-8', ...opts.env })
    const pty = loadPty()
    let term: Term
    if (pty) {
      const p = pty.spawn(command, args, { name: 'xterm-256color', cols: opts.cols ?? 100, rows: opts.rows ?? 30, cwd: spec.cwd, env: env as Record<string, string> })
      p.onData((d) => this.events.onData(id, d))
      p.onExit(({ exitCode }) => {
        this.terms.delete(id)
        this.events.onExit(id, exitCode)
      })
      term = {
        spec: full,
        write: (d) => p.write(d),
        resize: (c, r) => {
          try {
            p.resize(Math.max(2, c), Math.max(2, r))
          } catch {
            /* ignore */
          }
        },
        kill: () => p.kill()
      }
    } else {
      const cp: ChildProcess = spawnChild(command, args, { cwd: spec.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      cp.stdout?.on('data', (d: Buffer) => this.events.onData(id, d.toString('utf8').replace(/\n/g, '\r\n')))
      cp.stderr?.on('data', (d: Buffer) => this.events.onData(id, d.toString('utf8').replace(/\n/g, '\r\n')))
      cp.on('exit', (code) => {
        this.terms.delete(id)
        this.events.onExit(id, code ?? 0)
      })
      cp.on('error', (e) => this.events.onData(id, `\r\n[tandem] ${e.message}\r\n`))
      this.events.onData(id, '\x1b[2m[tandem] node-pty is not built for this Electron build; running without a TTY. Interactive UIs will not render here.\x1b[0m\r\n')
      term = {
        spec: full,
        write: (d) => cp.stdin?.write(d.replace(/\r/g, '\n')),
        resize: () => {},
        kill: () => cp.kill('SIGTERM')
      }
    }
    this.terms.set(id, term)
    if (opts.initialInput) setTimeout(() => term.write(opts.initialInput as string), 1200)
    return full
  }

  write(id: string, data: string): void {
    this.terms.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.terms.get(id)?.resize(cols, rows)
  }

  close(id: string): void {
    const t = this.terms.get(id)
    if (!t) return
    t.kill()
    this.terms.delete(id)
  }

  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.close(id)
  }
}
