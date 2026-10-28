import React, { useState } from 'react'
import type { SessionMeta } from '@shared/types'
import { MoreHorizontal, Plus, Search, Trash2, Pencil } from 'lucide-react'
import { useStore } from '../store'
import { relTime, shortPath } from './ui'

export function SessionRow({ s, pair, compact }: { s: SessionMeta; pair: SessionMeta[]; compact?: boolean }): React.JSX.Element {
  const activeId = useStore((st) => st.activeId)
  const openSession = useStore((st) => st.openSession)
  const rename = useStore((st) => st.rename)
  const del = useStore((st) => st.deleteSession)
  const [menu, setMenu] = useState(false)
  const active = pair.some((p) => p.id === activeId)
  const status = pair.find((p) => p.status === 'waiting-approval')?.status ?? pair.find((p) => p.status === 'running' || p.status === 'starting')?.status ?? pair.find((p) => p.status === 'error')?.status ?? 'idle'
  const ribbon = pair.length > 1 ? 'both' : s.agent
  const cost = pair.reduce((a, p) => a + (p.totalCostUsd ?? 0), 0)
  return (
    <div className={`session-row ${active ? 'active' : ''}`} onClick={() => void openSession(s.id)} role="button" tabIndex={0}>
      <span className={`ribbon ${ribbon}`} />
      <div style={{ minWidth: 0 }}>
        <div className="title">{s.title}</div>
        <div className="sub">
          {pair.length > 1 ? 'claude + codex' : s.agent} · {shortPath(s.cwd)}
        </div>
      </div>
      <div className="right">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={`status-pip ${status === 'starting' ? 'running' : status}`} />
          {relTime(s.updatedAt)}
        </span>
        {!compact && cost > 0 && <span>${cost.toFixed(2)}</span>}
      </div>
      {!compact && (
        <div className="rel" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="kebab" onClick={() => setMenu((m) => !m)} title="More">
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <div className="popover" style={{ bottom: 'auto', top: 'calc(100% + 4px)', right: 0, left: 'auto', minWidth: 160 }} onMouseLeave={() => setMenu(false)}>
              <button
                type="button"
                className="item"
                onClick={() => {
                  const t = window.prompt('Rename session', s.title)
                  if (t) for (const p of pair) void rename(p.id, t)
                  setMenu(false)
                }}
              >
                <Pencil size={13} /> Rename
              </button>
              <button
                type="button"
                className="item"
                onClick={() => {
                  if (window.confirm('Delete this session and its history in Tandem?')) for (const p of pair) void del(p.id)
                  setMenu(false)
                }}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function groupSessions(list: SessionMeta[]): { s: SessionMeta; pair: SessionMeta[] }[] {
  const seen = new Set<string>()
  const rows: { s: SessionMeta; pair: SessionMeta[] }[] = []
  for (const s of list) {
    if (s.pairId) {
      if (seen.has(s.pairId)) continue
      seen.add(s.pairId)
      rows.push({ s, pair: list.filter((x) => x.pairId === s.pairId) })
    } else rows.push({ s, pair: [s] })
  }
  return rows
}

export function SessionsPanel(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const openNewSession = useStore((s) => s.openNewSession)
  const setPalette = useStore((s) => s.setPalette)
  const list = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  const rows = groupSessions(list)
  const dayAgo = Date.now() - 86_400_000
  const today = rows.filter((r) => r.s.updatedAt >= dayAgo)
  const earlier = rows.filter((r) => r.s.updatedAt < dayAgo)
  return (
    <aside className="sessions sidebar">
      <div className="sessions-top titlebar-drag sidebar-top">
        <h2>Sessions</h2>
        <button type="button" className="icon-btn no-drag" title="New session (⌘N)" onClick={() => openNewSession()}>
          <Plus size={17} />
        </button>
      </div>
      <button type="button" className="jump no-drag" onClick={() => setPalette(true)}>
        <Search size={14} />
        <span className="grow">Search or jump to…</span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="sessions-scroll">
        {rows.length === 0 && <div style={{ color: 'var(--text-4)', fontSize: 12.5, padding: '8px 10px' }}>No sessions yet. Press ⌘N to start one.</div>}
        {today.length > 0 && <div className="group-label">Today</div>}
        {today.map((r) => (
          <SessionRow key={r.s.id} s={r.s} pair={r.pair} />
        ))}
        {earlier.length > 0 && <div className="group-label">Earlier</div>}
        {earlier.map((r) => (
          <SessionRow key={r.s.id} s={r.s} pair={r.pair} />
        ))}
      </div>
    </aside>
  )
}
