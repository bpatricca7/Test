import React, { memo, useEffect, useRef, useState } from 'react'
import type { ApprovalItem, AssistantItem, ReasoningItem, ResultItem, StatusItem, TimelineItem, ToolItem, UserItem } from '@shared/types'
import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, FileDiff, Globe, Info, Loader2, Monitor, Search, ShieldAlert, Sparkles, TerminalSquare, XCircle, Wrench, FileText, Compass } from 'lucide-react'
import { AgentAvatar, fmtDuration, fmtTokens } from './ui'
import { DiffView, Markdown } from './Markdown'
import { useStore } from '../store'

export function Timeline({ sessionId, items, showReasoning, onSuggest }: { sessionId: string; items: TimelineItem[]; showReasoning: boolean; onSuggest?: (text: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items])
  const session = useStore((s) => s.sessions[sessionId])
  if (!items.length) {
    const agent = session?.agent ?? 'claude'
    const name = agent === 'claude' ? 'Claude Code' : 'Codex'
    const suggestions =
      agent === 'claude'
        ? ['Explain this codebase and how it is organized', 'Find and fix the failing tests', 'Open the app, click through the main flow and screenshot any visual bugs', 'Review my uncommitted changes like a strict senior engineer']
        : ['Summarize what this repo does and where to start', 'Add tests for the module I touched last', 'Open the app in the GUI and verify the onboarding flow works', 'Refactor the largest file into smaller modules']
    return (
      <div className="timeline" ref={ref}>
        <div className="empty fade-in">
          <AgentAvatar agent={agent} size={44} />
          <h2>Talk to {name}</h2>
          <p>
            Working in <code>{session?.cwd}</code>. Approvals, diffs and tool runs show up here as cards. Switch policy, model and computer use from the bar below.
          </p>
          <div className="suggestions">
            {suggestions.map((s) => (
              <button type="button" key={s} className="suggestion" onClick={() => onSuggest?.(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="timeline" ref={ref}>
      <div className="timeline-inner">
        {items.map((it) => (
          <Item key={it.id} item={it} showReasoning={showReasoning} />
        ))}
      </div>
    </div>
  )
}

const Item = memo(function Item({ item, showReasoning }: { item: TimelineItem; showReasoning: boolean }): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} />
    case 'assistant':
      return <AssistantMsg item={item} />
    case 'reasoning':
      return showReasoning && item.text.trim() ? <Reasoning item={item} /> : null
    case 'tool':
      return <ToolCard item={item} />
    case 'approval':
      return <ApprovalCard item={item} />
    case 'status':
      return <StatusLine item={item} />
    case 'result':
      return <ResultLine item={item} />
    default:
      return null
  }
})

function UserBubble({ item }: { item: UserItem }): React.JSX.Element {
  return (
    <div className="msg user">
      <div className="bubble">
        {item.text}
        {item.images?.map((src, i) => <img key={i} src={src} alt="attachment" />)}
      </div>
    </div>
  )
}

function AssistantMsg({ item }: { item: AssistantItem }): React.JSX.Element | null {
  if (!item.text && !item.streaming) return null
  return (
    <div className="assistant">
      <AgentAvatar agent={item.agent} />
      <Markdown text={item.text} streaming={item.streaming} />
    </div>
  )
}

function Reasoning({ item }: { item: ReasoningItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <details className="reasoning" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Brain size={13} /> {item.streaming ? 'Thinking…' : 'Thought'} {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </summary>
      <div className="body">{item.text}</div>
    </details>
  )
}

function toolIcon(cat: ToolItem['category']): React.JSX.Element {
  const s = 13
  switch (cat) {
    case 'command':
      return <TerminalSquare size={s} />
    case 'edit':
      return <FileDiff size={s} />
    case 'read':
      return <FileText size={s} />
    case 'search':
      return <Search size={s} />
    case 'web':
      return <Globe size={s} />
    case 'computer':
      return <Monitor size={s} />
    case 'browser':
      return <Compass size={s} />
    case 'agent':
      return <Bot size={s} />
    default:
      return <Wrench size={s} />
  }
}

function ToolCard({ item }: { item: ToolItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hasBody = Boolean(item.output || item.diff || (item.input && item.category !== 'command'))
  const statusIcon =
    item.status === 'running' ? <Loader2 size={13} className="spin" /> : item.status === 'done' ? <CheckCircle2 size={13} style={{ color: 'var(--ok)' }} /> : item.status === 'declined' ? <ShieldAlert size={13} style={{ color: 'var(--warn)' }} /> : <XCircle size={13} style={{ color: 'var(--danger)' }} />
  const label = item.tool.replace(/^mcp__/, '').replace(/__/g, ' › ')
  return (
    <div className="tool">
      <button type="button" className="tool-head" onClick={() => hasBody && setOpen((v) => !v)}>
        <span className={`tool-icon ${item.category}`}>{toolIcon(item.category)}</span>
        <span className="name">{label}</span>
        <span className="summary" title={item.summary}>
          {item.summary}
        </span>
        {item.exitCode != null && item.exitCode !== 0 && <span className="chip danger">exit {item.exitCode}</span>}
        <span className="dur">{fmtDuration(item.durationMs)}</span>
        {statusIcon}
        {hasBody && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && hasBody && (
        <div className="tool-body">
          {item.diff ? <DiffView diff={item.diff} /> : null}
          {item.category === 'command' && Boolean((item.input as { command?: string } | undefined)?.command) && <pre style={{ marginBottom: 8, color: 'var(--text)' }}>$ {(item.input as { command: string }).command}</pre>}
          {!item.diff && item.input !== undefined && item.category !== 'command' && item.category !== 'edit' && <pre style={{ marginBottom: 8 }}>{typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2)}</pre>}
          {item.output ? <pre>{item.output}</pre> : null}
        </div>
      )}
    </div>
  )
}

function StatusLine({ item }: { item: StatusItem }): React.JSX.Element {
  const Icon = item.level === 'error' ? XCircle : item.level === 'warn' ? AlertTriangle : Info
  return (
    <div className={`status-line ${item.level}`}>
      <Icon size={13} style={{ marginTop: 3, flex: 'none' }} />
      <span style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>
    </div>
  )
}

function ResultLine({ item }: { item: ResultItem }): React.JSX.Element {
  return (
    <div className={`result-line ${item.ok ? '' : 'bad'}`}>
      <Sparkles size={12} />
      <span>{item.ok ? 'Turn complete' : `Turn ended: ${item.summary ?? 'error'}`}</span>
      {item.durationMs ? <span>· {fmtDuration(item.durationMs)}</span> : null}
      {item.tokensIn || item.tokensOut ? (
        <span>
          · {fmtTokens(item.tokensIn)} in / {fmtTokens(item.tokensOut)} out
        </span>
      ) : null}
      {item.costUsd ? <span>· ${item.costUsd.toFixed(4)}</span> : null}
    </div>
  )
}

function ApprovalCard({ item }: { item: ApprovalItem }): React.JSX.Element {
  const approve = useStore((s) => s.approve)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [denyMsg, setDenyMsg] = useState('')
  const resolved = item.resolved
  const isQuestion = item.approvalKind === 'question'
  const canSend = !isQuestion || (item.questions ?? []).every((q) => {
    const v = answers[q.id]
    return (Array.isArray(v) ? v.length > 0 : Boolean(v)) || Boolean(other[q.id]?.trim())
  })
  const submit = (optionId: string): void => {
    const finalAnswers: Record<string, string | string[]> = { ...answers }
    for (const q of item.questions ?? []) if (other[q.id]?.trim()) finalAnswers[q.id] = other[q.id].trim()
    void approve({ sessionId: item.sessionId, itemId: item.id, optionId, answers: isQuestion ? finalAnswers : undefined, message: denyMsg || undefined })
  }
  const Icon = item.approvalKind === 'question' ? Bot : ShieldAlert
  return (
    <div className={`approval ${resolved ? 'resolved' : ''}`}>
      <div className="approval-title">
        <Icon size={15} style={{ color: resolved ? 'var(--text-3)' : 'var(--warn)' }} />
        <span>{item.title}</span>
        <span className={`chip ${item.agent}`} style={{ marginLeft: 'auto' }}>
          {item.agent === 'claude' ? 'Claude' : 'Codex'}
        </span>
      </div>
      {item.diff ? (
        <div className="approval-detail">
          <DiffView diff={item.diff} />
        </div>
      ) : item.detail ? (
        <div className="approval-detail">{item.detail}</div>
      ) : null}
      {item.reason && <div className="approval-reason">{item.reason}</div>}
      {item.warn && (
        <div className="approval-warn">
          <AlertTriangle size={13} /> {item.warn}
        </div>
      )}
      {isQuestion &&
        (item.questions ?? []).map((q) => {
          const v = answers[q.id]
          const selected = new Set(Array.isArray(v) ? v : v ? [v] : [])
          return (
            <div className="question" key={q.id}>
              <div className="q">
                {q.header ? <span className="chip" style={{ marginRight: 6 }}>{q.header}</span> : null}
                {q.question}
              </div>
              <div className="opts">
                {q.options.map((o) => (
                  <button
                    type="button"
                    key={o.label}
                    disabled={Boolean(resolved)}
                    className={`opt ${selected.has(o.label) ? 'sel' : ''}`}
                    onClick={() => {
                      setOther({ ...other, [q.id]: '' })
                      if (q.multiSelect) {
                        const next = new Set(selected)
                        if (next.has(o.label)) next.delete(o.label)
                        else next.add(o.label)
                        setAnswers({ ...answers, [q.id]: [...next] })
                      } else setAnswers({ ...answers, [q.id]: o.label })
                    }}
                  >
                    <span>
                      <div>{o.label}</div>
                      {o.description && <div className="d">{o.description}</div>}
                    </span>
                  </button>
                ))}
                {!resolved && (
                  <div className="opt">
                    <span className="d">Other:</span>
                    <input type="text" placeholder="type your own answer" value={other[q.id] ?? ''} onChange={(e) => setOther({ ...other, [q.id]: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      {resolved ? (
        <div className="approval-actions" style={{ color: 'var(--text-3)', fontSize: 12 }}>
          {resolved.optionId === 'answered' ? 'Answered' : resolved.optionId === 'deny' || resolved.optionId === 'cancel' || resolved.optionId === 'cancelled' ? `Declined${resolved.message ? ` · ${resolved.message}` : ''}` : resolved.optionId === 'always' ? 'Allowed (remembered)' : 'Allowed'}
        </div>
      ) : (
        <div className="approval-actions">
          {item.options.map((o) => (
            <button type="button" key={o.id} className={`btn sm ${o.tone === 'primary' ? 'primary' : o.tone === 'danger' ? 'danger' : ''}`} disabled={!canSend && o.tone === 'primary'} onClick={() => submit(o.id)} title={o.description}>
              {o.label}
            </button>
          ))}
          {!isQuestion && <input className="deny-msg" placeholder="Tell it why / what to do instead (optional, sent on Deny)" value={denyMsg} onChange={(e) => setDenyMsg(e.target.value)} />}
        </div>
      )}
    </div>
  )
}
