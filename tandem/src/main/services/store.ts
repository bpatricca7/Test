/** Session metadata + timeline persistence in the app's userData folder. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionMeta, TimelineItem } from '@shared/types'

export class SessionStore {
  private readonly dir: string
  private items = new Map<string, TimelineItem[]>()
  private dirty = new Set<string>()
  private timer?: NodeJS.Timeout

  constructor(userData: string) {
    this.dir = join(userData, 'sessions')
    mkdirSync(this.dir, { recursive: true })
  }

  listMeta(): SessionMeta[] {
    const out: SessionMeta[] = []
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.meta.json')) continue
      try {
        const m = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SessionMeta
        if (m.status === 'running' || m.status === 'waiting-approval' || m.status === 'starting') m.status = 'idle'
        out.push(m)
      } catch {
        /* skip corrupt */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveMeta(meta: SessionMeta): void {
    writeFileSync(join(this.dir, `${meta.id}.meta.json`), JSON.stringify(meta, null, 2))
  }

  loadItems(sessionId: string): TimelineItem[] {
    const cached = this.items.get(sessionId)
    if (cached) return cached
    const f = join(this.dir, `${sessionId}.items.jsonl`)
    const list: TimelineItem[] = []
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          list.push(JSON.parse(line) as TimelineItem)
        } catch {
          /* skip */
        }
      }
    }
    // collapse duplicates (we append upserts); last write wins, order by first appearance
    const byId = new Map<string, TimelineItem>()
    for (const it of list) {
      if (it.kind === 'assistant' || it.kind === 'reasoning') it.streaming = false
      byId.set(it.id, it)
    }
    const dedup = [...byId.values()]
    this.items.set(sessionId, dedup)
    return dedup
  }

  upsertItem(sessionId: string, item: TimelineItem): void {
    const list = this.loadItems(sessionId)
    const idx = list.findIndex((x) => x.id === item.id)
    if (idx === -1) list.push(item)
    else list[idx] = item
    this.dirty.add(sessionId)
    this.schedule()
  }

  appendDelta(sessionId: string, itemId: string, delta: string, field: 'text' | 'output'): void {
    const list = this.loadItems(sessionId)
    const it = list.find((x) => x.id === itemId)
    if (!it) return
    if (field === 'text' && (it.kind === 'assistant' || it.kind === 'reasoning')) it.text += delta
    else if (field === 'output' && it.kind === 'tool') it.output = (it.output ?? '') + delta
    this.dirty.add(sessionId)
    this.schedule()
  }

  remove(sessionId: string): void {
    this.items.delete(sessionId)
    this.dirty.delete(sessionId)
    for (const suffix of ['.meta.json', '.items.jsonl']) {
      const f = join(this.dir, `${sessionId}${suffix}`)
      if (existsSync(f)) rmSync(f)
    }
  }

  flush(): void {
    for (const id of this.dirty) {
      const list = this.items.get(id)
      if (!list) continue
      writeFileSync(join(this.dir, `${id}.items.jsonl`), list.map((x) => JSON.stringify(x)).join('\n') + '\n')
    }
    this.dirty.clear()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, 800)
  }
}
