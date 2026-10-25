import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

export class SettingsStore {
  private data: Settings
  constructor(private readonly file: string) {
    this.data = { ...DEFAULT_SETTINGS }
    try {
      if (existsSync(file)) this.data = { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>) }
    } catch {
      this.data = { ...DEFAULT_SETTINGS }
    }
    if (!this.data.trialStartedAt) {
      this.data.trialStartedAt = Date.now()
      this.flush()
    }
  }
  get(): Settings {
    return { ...this.data }
  }
  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    this.flush()
    return this.get()
  }
  rememberFolder(path: string): void {
    const list = [path, ...this.data.recentFolders.filter((p) => p !== path)].slice(0, 12)
    this.set({ recentFolders: list, defaultCwd: path })
  }
  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
}

export function jsonStorePath(userData: string, name: string): string {
  return join(userData, name)
}
