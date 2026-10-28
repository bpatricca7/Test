import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Columns2, Home, Layers, Moon, Plus, Search, Settings as SettingsIcon, Sun, TerminalSquare, ArrowLeftRight } from 'lucide-react'
import { useStore } from '../store'
import { groupSessions } from './SessionsPanel'
import { shortPath } from './ui'

interface Cmd {
  id: string
  group: string
  title: string
  detail?: string
  icon: React.ReactNode
  keys?: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const setPalette = useStore((s) => s.setPalette)
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const settings = useStore((s) => s.settings)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const st = useStore.getState

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: 'new', group: 'Actions', title: 'New session', icon: <Plus size={14} />, keys: '⌘N', run: () => st().openNewSession() },
      { id: 'new-both', group: 'Actions', title: 'New side-by-side session (Claude + Codex)', icon: <Columns2 size={14} />, run: () => st().openNewSession('both') },
      { id: 'browser', group: 'Actions', title: st().browserOpen ? 'Hide Tandem browser' : 'Show Tandem browser', icon: <AppWindow size={14} />, keys: '⌘B', run: () => void (st().browserOpen ? st().closeBrowser() : st().openBrowser()) },
      { id: 'terminal', group: 'Actions', title: st().terminalOpen ? 'Hide terminal' : 'Show terminal', icon: <TerminalSquare size={14} />, keys: '⌘`', run: () => st().toggleTerminalPane() },
      { id: 'sessions', group: 'Actions', title: st().sessionsCollapsed ? 'Show sessions panel' : 'Hide sessions panel', icon: <Layers size={14} />, keys: '⌘\\', run: () => st().toggleSessions() },
      { id: 'theme', group: 'Actions', title: settings?.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', icon: settings?.theme === 'light' ? <Moon size={14} /> : <Sun size={14} />, run: () => void st().updateSettings({ theme: settings?.theme === 'light' ? 'dark' : 'light' }) },
      { id: 'home', group: 'Navigate', title: 'Home', icon: <Home size={14} />, run: () => st().goHome() },
      { id: 'settings', group: 'Navigate', title: 'Settings', icon: <SettingsIcon size={14} />, keys: '⌘,', run: () => st().openSettings() }
    ]
    const active = activeId ? sessions[activeId] : undefined
    if (active && !active.pairId) {
      const other = active.agent === 'claude' ? 'codex' : 'claude'
      list.push({ id: 'handoff', group: 'Actions', title: `Hand off to ${other === 'claude' ? 'Claude Code' : 'Codex'}`, icon: <ArrowLeftRight size={14} />, run: () => void st().handoff(active.id, other) })
    }
    for (const r of groupSessions(Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt))) {
      list.push({ id: `s-${r.s.id}`, group: 'Sessions', title: r.s.title, detail: `${r.pair.length > 1 ? 'claude + codex' : r.s.agent} · ${shortPath(r.s.cwd)}`, icon: <span className={`agent-dot ${r.pair.length > 1 ? 'claude' : r.s.agent}`} />, run: () => void st().openSession(r.s.id) })
    }
    return list
  }, [sessions, activeId, settings?.theme, open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return cmds
    return cmds.filter((c) => `${c.title} ${c.detail ?? ''} ${c.group}`.toLowerCase().includes(needle))
  }, [cmds, q])

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => input.current?.focus(), 10)
    }
  }, [open])
  useEffect(() => setIdx(0), [q])
  if (!open) return null
  const run = (c: Cmd): void => {
    setPalette(false)
    c.run()
  }
  let lastGroup = ''
  return (
    <div className="palette-bg" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette">
        <div className="palette-input">
          <Search size={16} style={{ color: 'var(--text-3)' }} />
          <input
            ref={input}
            value={q}
            placeholder="Jump to a session or run a command…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(filtered.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                const c = filtered[idx]
                if (c) run(c)
              } else if (e.key === 'Escape') setPalette(false)
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div style={{ padding: 14, color: 'var(--text-3)' }}>Nothing matches.</div>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="palette-group">{c.group}</div> : null
            lastGroup = c.group
            return (
              <React.Fragment key={c.id}>
                {header}
                <button type="button" className={`palette-item ${i === idx ? 'sel' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}>
                  <span className="ic">{c.icon}</span>
                  <span className="t">{c.title}</span>
                  {c.detail && <span className="d">{c.detail}</span>}
                  {c.keys && <span className="kbd">{c.keys}</span>}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
