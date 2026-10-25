import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const uid = (): string => randomUUID()
export const now = (): number => Date.now()

/** Extra PATH entries so a GUI-launched mac app sees the same binaries as the user's shell. */
export function augmentedPath(): string {
  const home = homedir()
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.claude', 'bin'),
    join(home, '.codex', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.nvm', 'current', 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, '.yarn', 'bin')
  ]
  const current = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const merged = [...current]
  for (const e of extras) if (!merged.includes(e)) merged.push(e)
  return merged.join(delimiter)
}

export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentedPath(), ...extra }
  // Electron sets these; they confuse CLI tools that embed Node.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

export function whichSync(bin: string, extraCandidates: string[] = []): string | undefined {
  for (const c of extraCandidates) if (c && existsSync(c)) return c
  for (const dir of augmentedPath().split(delimiter)) {
    const p = join(dir, bin)
    try {
      if (existsSync(p) && statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return undefined
}

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: opts.env ?? childEnv(), timeout: opts.timeoutMs ?? 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as NodeJS.ErrnoException).code as unknown as number) : err ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    )
  })
}

export function truncate(s: string, n = 200): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

export function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

/** Newline-delimited JSON splitter that tolerates partial chunks. */
export class LineBuffer {
  private buf = ''
  push(chunk: string, onLine: (line: string) => void): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '')
      this.buf = this.buf.slice(idx + 1)
      if (line.trim()) onLine(line)
    }
  }
  flush(onLine: (line: string) => void): void {
    if (this.buf.trim()) onLine(this.buf)
    this.buf = ''
  }
}

export function titleFromPrompt(text: string): string {
  const t = firstLine(text.trim()).replace(/\s+/g, ' ')
  return truncate(t || 'New session', 48)
}
