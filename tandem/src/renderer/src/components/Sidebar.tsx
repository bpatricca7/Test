import React, { useState } from 'react'
import type { AccountState, AgentKind, SessionMeta } from '@shared/types'
import { ExternalLink, LogIn, MoreHorizontal, Plus, RefreshCw, Settings as SettingsIcon, TerminalSquare, Trash2, Pencil, LogOut, Columns2 } from 'lucide-react'
import { useStore } from '../store'
import { relTime, shortPath } from './ui'

function AccountCard({ acct }: { acct: AccountState }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const refresh = useStore((s) => s.refreshAccounts)
  const toast = useStore((s) => s.toast)
  const openTerminal = useStore((s) => s.openTerminal)
  const name = acct.agent === 'claude' ? 'Claude Code' : 'Codex'
  const login = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.tandem.accountLogin(acct.agent)
      if (r.termId) {
        useStore.setState({ terminalOpen: true, activeTermId: r.termId, terminals: [...useStore.getState().terminals.filter((t) => t.id !== r.termId), { id: r.termId, title: 'Claude sign-in', cwd: '', agent: 'claude', purpose: 'claude-login' }] })
      }
      if (r.message) toast('info', r.message)
      if (r.url) toast('info', 'Finish signing in to ChatGPT in your browser; Tandem updates automatically.')
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const logout = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.tandem.accountLogout(acct.agent)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`account-card ${acct.agent}`}>
      <div className="account-head">
        <span className={`agent-dot ${acct.agent}`} />
        <span className="account-name">{name}</span>
        {acct.installed ? <span className={`chip ${acct.loggedIn ? 'ok' : 'warn'}`}>{acct.loggedIn ? 'Signed in' : 'Signed out'}</span> : <span className="chip danger">Not installed</span>}
      </div>
      <div className="account-meta">
        {acct.email && <span>{acct.email}</span>}
        {(acct.plan || acct.version) && (
          <span className="mono">
            {acct.plan ? `${acct.plan} · ` : ''}v{acct.version ?? '?'}
          </span>
        )}
        {!acct.installed && <span>{acct.problem}</span>}
      </div>
      {acct.usage?.map((u) => (
        <div className="meter" key={u.label}>
          <div className="meter-row">
            <span>{u.label}</span>
            <span>{Math.round(u.usedPercent)}% used</span>
          </div>
          <div className="meter-bar">
            <div style={{ width: `${Math.min(100, u.usedPercent)}%` }} />
          </div>
        </div>
      ))}
      <div className="account-actions">
        {acct.installed && !acct.loggedIn && (
          <button type="button" className={`btn xs ${acct.agent}`} onClick={() => void login()} disabled={busy}>
            <LogIn size={12} /> Sign in
          </button>
        )}
        {acct.installed && acct.loggedIn && (
          <button type="button" className="btn xs ghost" onClick={() => void logout()} disabled={busy} title="Sign out">
            <LogOut size={12} /> Sign out
          </button>
        )}
        {!acct.installed && (
          <button type="button" className="btn xs" onClick={() => void window.tandem.openExternal(acct.agent === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli')}>
            <ExternalLink size={12} /> Install guide
          </button>
        )}
        {acct.installed && (
          <button type="button" className="btn xs ghost" title="Open the raw CLI" onClick={() => void openTerminal({ title: name, cwd: useStore.getState().settings?.defaultCwd ?? '/', agent: acct.agent, purpose: acct.agent === 'claude' ? 'claude-interactive' : 'codex-interactive' })}>
            <TerminalSquare size={12} />
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} title="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  )
}

function SessionRow({ s, pair }: { s: SessionMeta; pair: SessionMeta[] }): React.JSX.Element {
  const activeId = useStore((st) => st.activeId)
  const openSession = useStore((st) => st.openSession)
  const rename = useStore((st) => st.rename)
  const del = useStore((st) => st.deleteSession)
  const [menu, setMenu] = useState(false)
  const active = pair.some((p) => p.id === activeId)
  const status = pair.find((p) => p.status === 'waiting-approval')?.status ?? pair.find((p) => p.status === 'running' || p.status === 'starting')?.status ?? pair.find((p) => p.status === 'error')?.status ?? 'idle'
  return (
    <div className={`session-row ${active ? 'active' : ''}`} onClick={() => void openSession(s.id)} role="button" tabIndex={0}>
      <span className={`status-pip ${status === 'starting' ? 'running' : status}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="title">{s.title}</div>
        <div className="sub">
          {pair.length > 1 ? (
            <>
              <Columns2 size={10} style={{ verticalAlign: -1 }} /> Claude + Codex ·{' '}
            </>
          ) : (
            <span style={{ color: s.agent === 'claude' ? 'var(--claude-2)' : 'var(--codex-2)' }}>{s.agent === 'claude' ? 'Claude' : 'Codex'} · </span>
          )}
          {shortPath(s.cwd)} · {relTime(s.updatedAt)}
        </div>
      </div>
      <div className="rel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="kebab" onClick={() => setMenu((m) => !m)}>
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
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const sessions = useStore((s) => s.sessions)
  const openNewSession = useStore((s) => s.openNewSession)
  const openSettings = useStore((s) => s.openSettings)
  const goHome = useStore((s) => s.goHome)
  const toggleTerminal = useStore((s) => s.toggleTerminalPane)
  const list = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  const seenPairs = new Set<string>()
  const rows: { s: SessionMeta; pair: SessionMeta[] }[] = []
  for (const s of list) {
    if (s.pairId) {
      if (seenPairs.has(s.pairId)) continue
      seenPairs.add(s.pairId)
      rows.push({ s, pair: list.filter((x) => x.pairId === s.pairId) })
    } else rows.push({ s, pair: [s] })
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-top titlebar-drag">
        <button type="button" className="brand no-drag" onClick={goHome} style={{ color: 'inherit' }}>
          <img src="./icon.png" alt="" /> Tandem
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn no-drag" title="New session (⌘N)" onClick={() => openNewSession()}>
          <Plus size={17} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <div className="section-label">Accounts</div>
        {(['claude', 'codex'] as AgentKind[]).map((a) => (
          <AccountCard key={a} acct={accounts[a]} />
        ))}
        <div className="section-label">
          Sessions <span style={{ fontWeight: 500 }}>{rows.length}</span>
        </div>
        {rows.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 12.5, padding: '4px 6px' }}>No sessions yet. Start one with the + button.</div>}
        {rows.map((r) => (
          <SessionRow key={r.s.id} s={r.s} pair={r.pair} />
        ))}
      </div>
      <div className="sidebar-bottom">
        <button type="button" className="btn sm ghost" onClick={() => toggleTerminal()} title="Toggle terminal pane">
          <TerminalSquare size={14} /> Terminal
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm ghost" onClick={openSettings}>
          <SettingsIcon size={14} /> Settings
        </button>
      </div>
    </aside>
  )
}
