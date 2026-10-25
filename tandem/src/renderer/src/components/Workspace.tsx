import React, { useMemo } from 'react'
import type { SessionMeta } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { ArrowLeftRight, FolderOpen, Monitor, TerminalSquare, Columns2 } from 'lucide-react'
import { useStore } from '../store'
import { Timeline } from './Timeline'
import { Composer } from './Composer'
import { TerminalPane } from './TerminalPane'
import { BrowserPane } from './BrowserPane'
import { AgentAvatar, fmtTokens, shortPath } from './ui'

const EMPTY: never[] = []

function Pane({ s, split }: { s: SessionMeta; split: boolean }): React.JSX.Element {
  const itemsRaw = useStore((st) => st.items[s.id])
  const items = useMemo(() => itemsRaw ?? EMPTY, [itemsRaw])
  const showReasoning = useStore((st) => st.settings?.showReasoning ?? true)
  const send = useStore((st) => st.send)
  const handoff = useStore((st) => st.handoff)
  const openTerminal = useStore((st) => st.openTerminal)
  const other = s.agent === 'claude' ? 'codex' : 'claude'
  return (
    <section className="pane">
      <div className="pane-head">
        <AgentAvatar agent={s.agent} size={20} />
        <strong style={{ color: 'var(--text)' }}>{s.agent === 'claude' ? 'Claude Code' : 'Codex'}</strong>
        {s.model && <span className="chip">{s.model}</span>}
        <span className={`chip ${s.status === 'waiting-approval' ? 'warn' : s.status === 'running' || s.status === 'starting' ? 'ok' : s.status === 'error' ? 'danger' : ''}`}>
          {s.status === 'waiting-approval' ? 'needs approval' : s.status === 'starting' ? 'starting' : s.status}
        </span>
        {s.capabilities.computerUse && (
          <span className="chip on" title="Computer use enabled">
            <Monitor size={11} /> screen
          </span>
        )}
        <span className="spacer" />
        {s.contextPercent != null && <span title="Context used">{s.contextPercent}% ctx</span>}
        {(s.tokensIn || s.tokensOut) && (
          <span title="Tokens in / out">
            {fmtTokens(s.tokensIn)}/{fmtTokens(s.tokensOut)}
          </span>
        )}
        {s.totalCostUsd ? <span title="Estimated API cost (subscription usage is not billed per token)">${s.totalCostUsd.toFixed(2)}</span> : null}
        {!split && (
          <button type="button" className="btn xs ghost" title={`Hand this task to ${other === 'claude' ? 'Claude Code' : 'Codex'} in a new session`} onClick={() => void handoff(s.id, other)}>
            <ArrowLeftRight size={12} /> Hand off to {other === 'claude' ? 'Claude' : 'Codex'}
          </button>
        )}
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} title="Open interactive CLI for this session" onClick={() => void openTerminal({ title: `${s.agent === 'claude' ? 'Claude' : 'Codex'} · ${s.title}`, cwd: s.cwd, agent: s.agent, purpose: s.agent === 'claude' ? 'claude-interactive' : 'codex-interactive', model: s.model, policy: s.policy, computerUse: s.capabilities.computerUse } as never)}>
          <TerminalSquare size={14} />
        </button>
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
  const dock = terminalOpen || browserOpen
  const primary = pair[0]
  if (!primary) return <div className="empty">Session not found.</div>
  const split = pair.length > 1
  return (
    <div className="main">
      <div className="topbar titlebar-drag">
        <div className="crumbs">
          {split && <Columns2 size={14} style={{ color: 'var(--text-3)' }} />}
          <span className="crumb strong">{primary.title}</span>
          <span className="crumb">·</span>
          <button type="button" className="crumb no-drag" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }} title={primary.cwd} onClick={() => void window.tandem.openPath(primary.cwd)}>
            <FolderOpen size={13} /> {shortPath(primary.cwd)}
          </button>
          <span className="chip">{POLICY_LABEL[primary.policy]}</span>
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
