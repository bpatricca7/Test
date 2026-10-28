import React from 'react'
import type { AccountState, AgentKind } from '@shared/types'
import { Check, Columns2, ExternalLink, LogIn, Monitor, Plus, X, Zap, Command } from 'lucide-react'
import { useStore } from '../store'
import { AgentAvatar } from './ui'
import { groupSessions, SessionRow } from './SessionsPanel'

function AgentCard({ acct }: { acct: AccountState }): React.JSX.Element {
  const openNew = useStore((s) => s.openNewSession)
  const toast = useStore((s) => s.toast)
  const name = acct.agent === 'claude' ? 'Claude Code' : 'Codex'
  const vendor = acct.agent === 'claude' ? 'Anthropic' : 'OpenAI'
  const login = async (): Promise<void> => {
    const r = await window.tandem.accountLogin(acct.agent)
    if (r.termId) useStore.setState({ terminalOpen: true, activeTermId: r.termId, terminals: [...useStore.getState().terminals.filter((t) => t.id !== r.termId), { id: r.termId, title: 'Claude sign-in', cwd: '', agent: 'claude', purpose: 'claude-login' }], view: 'session' })
    if (r.message) toast('info', r.message)
    if (r.url) toast('info', 'Finish signing in to ChatGPT in your browser; Tandem updates automatically.')
  }
  const Row = ({ ok, text }: { ok: boolean; text: string }): React.JSX.Element => (
    <div className="c">
      {ok ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <X size={14} style={{ color: 'var(--danger)' }} />} {text}
    </div>
  )
  return (
    <div className={`card agent ${acct.agent}`}>
      <div className="top">
        <AgentAvatar agent={acct.agent} size={30} />
        <h3>{name}</h3>
        {acct.installed ? <span className={`chip ${acct.loggedIn ? 'ok' : 'warn'}`}>{acct.loggedIn ? 'signed in' : 'signed out'}</span> : <span className="chip danger">not installed</span>}
      </div>
      <div className="checks">
        <Row ok={acct.installed} text={acct.installed ? `CLI ${acct.version ? `v${acct.version}` : 'installed'}` : 'CLI not found on this machine'} />
        <Row ok={acct.loggedIn} text={acct.loggedIn ? `${acct.email ?? 'Signed in'}${acct.plan ? ` · ${acct.plan}` : ''}` : `Not signed in to ${vendor}`} />
        <div className="c" style={{ color: acct.computerUseAvailable ? 'var(--text-2)' : 'var(--text-4)' }}>
          <Monitor size={14} /> {acct.computerUseAvailable ? 'Computer use available' : acct.computerUseNote ?? 'Computer use unavailable'}
        </div>
      </div>
      <div className="row">
        {!acct.installed && (
          <button type="button" className="btn sm" onClick={() => void window.tandem.openExternal(acct.agent === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli')}>
            <ExternalLink size={13} /> Install {name}
          </button>
        )}
        {acct.installed && !acct.loggedIn && (
          <button type="button" className={`btn sm ${acct.agent}`} onClick={() => void login()}>
            <LogIn size={13} /> Sign in to {vendor}
          </button>
        )}
        {acct.installed && acct.loggedIn && (
          <button type="button" className={`btn sm ${acct.agent}`} onClick={() => openNew(acct.agent)}>
            <Plus size={13} /> New session
          </button>
        )}
      </div>
    </div>
  )
}

export function Home(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const sessions = useStore((s) => s.sessions)
  const openNew = useStore((s) => s.openNewSession)
  const setPalette = useStore((s) => s.setPalette)
  const both = (['claude', 'codex'] as AgentKind[]).every((a) => accounts[a].installed && accounts[a].loggedIn)
  const recent = groupSessions(Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)).slice(0, 5)
  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="titlebar titlebar-drag">
        <div className="crumbs">
          <span className="crumb strong">Home</span>
        </div>
        <button type="button" className="btn sm ghost no-drag" onClick={() => setPalette(true)}>
          <Command size={13} /> Jump <span className="kbd">⌘K</span>
        </button>
      </div>
      <div className="home">
        <div className="bento fade-in">
          <div className="card hero">
            <div className="orb" />
            <h1 className="wordmark">
              Two agents.
              <br />
              <span>One cockpit.</span>
            </h1>
            <p>Claude Code and Codex, side by side. One approval queue, one browser they can both drive, and a hand-off between them when one gets stuck.</p>
            <div className="actions">
              <button type="button" className="btn primary" disabled={!both} onClick={() => openNew('both')} title={both ? 'Same brief to both, compared side by side' : 'Sign in to both agents to compare them'}>
                <Columns2 size={14} /> Side-by-side session
              </button>
              <button type="button" className="btn" onClick={() => openNew()}>
                <Zap size={14} /> New session <span className="kbd">⌘N</span>
              </button>
            </div>
          </div>
          <AgentCard acct={accounts.claude} />
          <AgentCard acct={accounts.codex} />
          <div className="card recent">
            <h3>Recent</h3>
            <div className="sub">Pick up where an agent left off. Sessions resume with their full history.</div>
            {recent.length ? (
              <div className="recent-list">
                {recent.map((r) => (
                  <SessionRow key={r.s.id} s={r.s} pair={r.pair} compact />
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-4)', fontSize: 12.5 }}>Nothing yet. Start a session and it shows up here.</div>
            )}
          </div>
          <div className="card keys">
            <h3>Keys</h3>
            <div className="sub">Everything is reachable without the mouse.</div>
            <div className="keys-grid">
              <span>Command palette</span>
              <span className="k">
                <span className="kbd">⌘</span>
                <span className="kbd">K</span>
              </span>
              <span>New session</span>
              <span className="k">
                <span className="kbd">⌘</span>
                <span className="kbd">N</span>
              </span>
              <span>Tandem browser</span>
              <span className="k">
                <span className="kbd">⌘</span>
                <span className="kbd">B</span>
              </span>
              <span>Terminal</span>
              <span className="k">
                <span className="kbd">⌘</span>
                <span className="kbd">`</span>
              </span>
              <span>Sessions panel</span>
              <span className="k">
                <span className="kbd">⌘</span>
                <span className="kbd">\</span>
              </span>
              <span>Send · newline</span>
              <span className="k">
                <span className="kbd">↵</span>
                <span className="kbd">⇧↵</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
