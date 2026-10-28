import React, { useMemo } from 'react'
import type { PolicyMode, SessionMeta } from '@shared/types'
import { AppWindow, ArrowLeftRight, Columns2, FolderOpen, Monitor, TerminalSquare, Shield, ShieldCheck, ShieldOff, Compass, SquareArrowOutUpRight } from 'lucide-react'
import { useStore } from '../store'
import { Timeline } from './Timeline'
import { Composer } from './Composer'
import { TerminalPane } from './TerminalPane'
import { BrowserPane } from './BrowserPane'
import { AgentAvatar, fmtTokens, shortPath } from './ui'

const EMPTY: never[] = []

const AUTONOMY: { value: PolicyMode; label: string; icon: React.ReactNode; title: string }[] = [
  { value: 'plan', label: 'Plan', icon: <Compass size={12} />, title: 'Read-only exploration and planning' },
  { value: 'ask', label: 'Ask', icon: <Shield size={12} />, title: 'Prompt before commands and risky actions' },
  { value: 'auto-edit', label: 'Auto-edit', icon: <ShieldCheck size={12} />, title: 'Edits apply without asking; commands still prompt' },
  { value: 'full-auto', label: 'Full auto', icon: <ShieldOff size={12} />, title: 'No prompts, no sandbox. Only for work you trust completely' }
]

function Pane({ s, split }: { s: SessionMeta; split: boolean }): React.JSX.Element {
  const itemsRaw = useStore((st) => st.items[s.id])
  const items = useMemo(() => itemsRaw ?? EMPTY, [itemsRaw])
  const showReasoning = useStore((st) => st.settings?.showReasoning ?? true)
  const send = useStore((st) => st.send)
  const handoff = useStore((st) => st.handoff)
  const other = s.agent === 'claude' ? 'codex' : 'claude'
  const live = s.status === 'running' || s.status === 'starting'
  return (
    <section className="pane">
      <div className="pane-head">
        <AgentAvatar agent={s.agent} size={20} live={live} />
        <span className="agent-name">{s.agent === 'claude' ? 'Claude Code' : 'Codex'}</span>
        {s.model && <span className="chip mono">{s.model}</span>}
        <span className={`chip ${s.status === 'waiting-approval' ? 'warn' : live ? 'info' : s.status === 'error' ? 'danger' : ''}`}>{s.status === 'waiting-approval' ? 'needs you' : s.status === 'starting' ? 'starting' : s.status === 'running' ? 'working' : s.status}</span>
        {s.capabilities.computerUse && (
          <span className="chip on" title="Computer use enabled">
            <Monitor size={11} /> screen
          </span>
        )}
        <span className="spacer" />
        {s.contextPercent != null && (
          <span className="meter" title="Context window used">
            <span className="meter-bar">
              <div style={{ width: `${s.contextPercent}%` }} />
            </span>
            {s.contextPercent}%
          </span>
        )}
        {(s.tokensIn || s.tokensOut) && (
          <span className="meter" title="Tokens in / out">
            {fmtTokens(s.tokensIn)}/{fmtTokens(s.tokensOut)}
          </span>
        )}
        {s.totalCostUsd ? (
          <span className="meter" title="Estimated API cost (subscription usage is not billed per token)">
            ${s.totalCostUsd.toFixed(2)}
          </span>
        ) : null}
        {!split && (
          <button type="button" className="btn xs ghost" title={`Hand this task to ${other === 'claude' ? 'Claude Code' : 'Codex'} in a new session`} onClick={() => void handoff(s.id, other)}>
            <ArrowLeftRight size={12} /> Hand off
          </button>
        )}
      </div>
      <Timeline sessionId={s.id} items={items} showReasoning={showReasoning} onSuggest={(t) => void send(s.id, t)} />
    </section>
  )
}

export function Workspace({ sessionId }: { sessionId: string }): React.JSX.Element {
  const sessions = useStore((st) => st.sessions)
  const pair = useMemo(() => {
    const s = sessions[sessionId]
    if (!s) return []
    if (!s.pairId) return [s]
    return Object.values(sessions)
      .filter((x) => x.pairId === s.pairId)
      .sort((a, b) => (a.agent === 'claude' ? -1 : 1) - (b.agent === 'claude' ? -1 : 1))
  }, [sessions, sessionId])
  const terminalOpen = useStore((st) => st.terminalOpen)
  const browserOpen = useStore((st) => st.browserOpen)
  const toggleTerminal = useStore((st) => st.toggleTerminalPane)
  const openBrowser = useStore((st) => st.openBrowser)
  const closeBrowser = useStore((st) => st.closeBrowser)
  const setPolicy = useStore((st) => st.setPolicy)
  const openTerminal = useStore((st) => st.openTerminal)
  const dock = terminalOpen || browserOpen
  const primary = pair[0]
  if (!primary) return <div className="empty">Session not found.</div>
  const split = pair.length > 1
  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="titlebar titlebar-drag">
        <div className="crumbs">
          {split && <Columns2 size={14} style={{ color: 'var(--text-3)' }} />}
          <span className="crumb strong">{primary.title}</span>
          <button type="button" className="crumb path no-drag" title={primary.cwd} onClick={() => void window.tandem.openPath(primary.cwd)}>
            <FolderOpen size={12} /> {shortPath(primary.cwd)}
          </button>
        </div>
        <div className="autonomy no-drag" title="Autonomy: how much the agents may do without asking">
          {AUTONOMY.map((a) => (
            <button type="button" key={a.value} className={`${primary.policy === a.value ? 'on' : ''} ${a.value === 'full-auto' ? 'full' : ''}`} title={a.title} onClick={() => void setPolicy(primary.id, a.value, true)}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        <div className="pane-buttons no-drag">
          <button type="button" className={`icon-btn ${browserOpen ? 'on' : ''}`} title="Browser (⌘B)" onClick={() => void (browserOpen ? closeBrowser() : openBrowser())}>
            <AppWindow size={15} />
          </button>
          <button type="button" className={`icon-btn ${terminalOpen ? 'on' : ''}`} title="Terminal (⌘`)" onClick={() => toggleTerminal()}>
            <TerminalSquare size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Open this session's agent as an interactive CLI in the terminal"
            onClick={() => void openTerminal({ title: `${primary.agent === 'claude' ? 'Claude' : 'Codex'} · ${primary.title}`, cwd: primary.cwd, agent: primary.agent, purpose: primary.agent === 'claude' ? 'claude-interactive' : 'codex-interactive', model: primary.model, policy: primary.policy, computerUse: primary.capabilities.computerUse } as never)}
          >
            <SquareArrowOutUpRight size={15} />
          </button>
        </div>
      </div>
      <div className={`workspace ${split ? 'split' : ''} ${dock ? 'with-dock' : ''}`}>
        {pair.map((s) => (
          <Pane key={s.id} s={s} split={split} />
        ))}
        {dock && (
          <div className="dock">
            {browserOpen && <BrowserPane />}
            {terminalOpen && <TerminalPane />}
          </div>
        )}
      </div>
      <Composer sessions={pair} primary={primary} />
    </div>
  )
}
