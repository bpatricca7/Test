import React from 'react'
import type { AccountState, AgentKind } from '@shared/types'
import { Check, Columns2, ExternalLink, LogIn, Monitor, Plus, X, Zap } from 'lucide-react'
import { useStore } from '../store'
import { AgentAvatar } from './ui'

function Tile({ acct }: { acct: AccountState }): React.JSX.Element {
  const openNew = useStore((s) => s.openNewSession)
  const toast = useStore((s) => s.toast)
  const name = acct.agent === 'claude' ? 'Claude Code' : 'Codex'
  const vendor = acct.agent === 'claude' ? 'Anthropic' : 'OpenAI'
  const login = async (): Promise<void> => {
    const r = await window.tandem.accountLogin(acct.agent)
    if (r.termId) useStore.setState({ terminalOpen: true, activeTermId: r.termId, terminals: [...useStore.getState().terminals.filter((t) => t.id !== r.termId), { id: r.termId, title: 'Claude sign-in', cwd: '', agent: 'claude', purpose: 'claude-login' }], view: 'session' })
    if (r.message) toast('info', r.message)
  }
  const Row = ({ ok, text }: { ok: boolean; text: string }): React.JSX.Element => (
    <div className="c">
      {ok ? <Check size={14} style={{ color: 'var(--ok)' }} /> : <X size={14} style={{ color: 'var(--danger)' }} />} {text}
    </div>
  )
  return (
    <div className={`agent-tile ${acct.agent}`}>
      <AgentAvatar agent={acct.agent} size={36} />
      <h3>{name}</h3>
      <div className="d">
        Uses your own {vendor} subscription through the official CLI on this Mac. Tandem never sees your credentials; the CLI keeps them in its own keychain entry.
      </div>
      <div className="checks">
        <Row ok={acct.installed} text={acct.installed ? `CLI installed${acct.version ? ` (v${acct.version})` : ''}` : 'CLI not found on this machine'} />
        <Row ok={acct.loggedIn} text={acct.loggedIn ? `Signed in${acct.email ? ` as ${acct.email}` : ''}${acct.plan ? ` · ${acct.plan}` : ''}` : 'Not signed in'} />
        <div className="c" style={{ color: acct.computerUseAvailable ? 'var(--text-2)' : 'var(--text-3)' }}>
          <Monitor size={14} /> {acct.computerUseAvailable ? 'Computer use available' : acct.computerUseNote ?? 'Computer use unavailable'}
        </div>
      </div>
      <div className="row">
        {!acct.installed && (
          <button type="button" className="btn" onClick={() => void window.tandem.openExternal(acct.agent === 'claude' ? 'https://code.claude.com/docs/en/setup' : 'https://developers.openai.com/codex/cli')}>
            <ExternalLink size={13} /> Install {name}
          </button>
        )}
        {acct.installed && !acct.loggedIn && (
          <button type="button" className={`btn ${acct.agent}`} onClick={() => void login()}>
            <LogIn size={13} /> Sign in to {vendor}
          </button>
        )}
        {acct.installed && acct.loggedIn && (
          <button type="button" className={`btn ${acct.agent}`} onClick={() => openNew(acct.agent)}>
            <Plus size={13} /> New {name} session
          </button>
        )}
      </div>
    </div>
  )
}

export function Home(): React.JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const openNew = useStore((s) => s.openNewSession)
  const both = (['claude', 'codex'] as AgentKind[]).every((a) => accounts[a].installed && accounts[a].loggedIn)
  return (
    <div className="main">
      <div className="topbar titlebar-drag">
        <div className="crumbs">
          <span className="crumb strong">Home</span>
        </div>
      </div>
      <div className="onboard">
        <div className="onboard-card fade-in">
          <div className="hero">
            <img src="./icon.png" alt="" style={{ width: 64, height: 64, borderRadius: 18, boxShadow: 'var(--shadow)' }} />
            <h1>Two agents. One cockpit.</h1>
            <p>Run Claude Code and Codex side by side, approve their actions in one place, and hand work between them without switching apps.</p>
          </div>
          <div className="agent-grid">
            <Tile acct={accounts.claude} />
            <Tile acct={accounts.codex} />
          </div>
          <div className="onboard-foot">
            <button type="button" className="btn primary" disabled={!both} onClick={() => openNew('both')} title={both ? 'Same prompt to both, compared side by side' : 'Sign in to both agents to compare them'}>
              <Columns2 size={14} /> Start a side-by-side session
            </button>
            <button type="button" className="btn" onClick={() => openNew()}>
              <Zap size={14} /> New session
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
