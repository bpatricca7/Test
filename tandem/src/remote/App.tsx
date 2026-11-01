import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentKind, ApprovalItem, PolicyMode, SessionMeta, TimelineEvent, TimelineItem, ToolItem } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { api, DEMO } from '@backend'
import type { RemoteState } from './types'
import iconUrl from '../renderer/public/icon.png'

type Tab = 'sessions' | 'chat' | 'screen'

interface Toast {
  id: number
  text: string
  error?: boolean
}

function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}
function shortPath(p: string): string {
  const s = p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')
  const parts = s.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : s
}
function upsert(list: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

let audio: AudioContext | undefined
function alertUser(): void {
  try {
    navigator.vibrate?.([80, 40, 80])
  } catch {
    /* ignore */
  }
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = 880
    g.gain.value = 0.0001
    o.connect(g)
    g.connect(audio.destination)
    const t = audio.currentTime
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    o.start(t)
    o.stop(t + 0.45)
  } catch {
    /* ignore */
  }
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<RemoteState>()
  const [sessions, setSessions] = useState<Record<string, SessionMeta>>({})
  const [items, setItems] = useState<Record<string, TimelineItem[]>>({})
  const [activeId, setActiveId] = useState<string>()
  const [tab, setTab] = useState<Tab>('sessions')
  const [connected, setConnected] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sheet, setSheet] = useState(false)
  const toast = (text: string, error = false): void => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500)
  }

  const load = async (): Promise<void> => {
    try {
      const st = await api.state()
      setState(st)
      const map: Record<string, SessionMeta> = {}
      for (const s of st.sessions) map[s.id] = s
      setSessions(map)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }
  useEffect(() => {
    void load()
    return api.events(
      (ev: TimelineEvent) => {
        if (ev.type === 'upsert') {
          setItems((m) => ({ ...m, [ev.sessionId]: upsert(m[ev.sessionId] ?? [], ev.item) }))
          if (ev.item.kind === 'approval' && !ev.item.resolved) alertUser()
        } else if (ev.type === 'append') {
          setItems((m) => {
            const list = m[ev.sessionId]
            if (!list) return m
            const i = list.findIndex((x) => x.id === ev.itemId)
            if (i === -1) return m
            const it = list[i]
            const next = list.slice()
            if ((ev.field ?? 'text') === 'text' && (it.kind === 'assistant' || it.kind === 'reasoning')) next[i] = { ...it, text: it.text + ev.delta }
            else if (ev.field === 'output' && it.kind === 'tool') next[i] = { ...it, output: (it.output ?? '') + ev.delta }
            return { ...m, [ev.sessionId]: next }
          })
        } else if (ev.type === 'session') setSessions((s) => ({ ...s, [ev.session.id]: ev.session }))
        else if (ev.type === 'session-removed')
          setSessions((s) => {
            const n = { ...s }
            delete n[ev.sessionId]
            return n
          })
        else if (ev.type === 'accounts') setState((st) => (st ? { ...st, accounts: ev.accounts } : st))
        else if (ev.type === 'toast') if (ev.text) toast(ev.text, ev.level === 'error')
      },
      (ok) => {
        setConnected(ok)
        if (ok) void load()
      }
    )
  }, [])

  const pairOf = (id: string): SessionMeta[] => {
    const s = sessions[id]
    if (!s) return []
    if (!s.pairId) return [s]
    return Object.values(sessions)
      .filter((x) => x.pairId === s.pairId)
      .sort((a) => (a.agent === 'claude' ? -1 : 1))
  }
  const open = async (id: string): Promise<void> => {
    setActiveId(id)
    setTab('chat')
    for (const s of pairOf(id)) {
      if (!items[s.id]) {
        try {
          const list = await api.items(s.id)
          setItems((m) => ({ ...m, [s.id]: list }))
        } catch (e) {
          toast((e as Error).message, true)
        }
      }
    }
  }
  const waiting = Object.values(sessions).filter((s) => s.status === 'waiting-approval').length
  const active = activeId ? sessions[activeId] : undefined
  const pair = activeId ? pairOf(activeId) : []
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Tandem` : 'Tandem'
  }, [waiting])

  return (
    <div className="app">
      <div className="top">
        <img src={iconUrl} alt="" />
        <h1>{tab === 'chat' && active ? active.title : tab === 'screen' ? 'Screen' : 'Tandem'}</h1>
        <span className={`pip ${connected ? 'ok' : 'bad'}`} title={connected ? 'Connected to your Mac' : 'Reconnecting…'} />
      </div>
      {DEMO && (
        <div className="demo-banner">
          <b>Demo</b> · simulated Mac and agents. Approve, deny, stop and send briefs to see how it feels. The real thing runs from Tandem on your Mac.
        </div>
      )}
      <div className="scroll">
        {tab === 'sessions' && <Sessions state={state} sessions={sessions} onOpen={(id) => void open(id)} onNew={() => setSheet(true)} />}
        {tab === 'chat' && (active ? <Chat pair={pair} items={items} toast={toast} /> : <div className="empty">Pick a session first.</div>)}
        {tab === 'screen' && <Screen shareScreen={Boolean(state?.shareScreen)} />}
      </div>
      <div className="tabs">
        <button type="button" className={tab === 'sessions' ? 'on' : ''} onClick={() => setTab('sessions')}>
          <Icon name="layers" />
          Sessions
          {waiting > 0 && <span className="badge">{waiting}</span>}
        </button>
        <button type="button" className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')} disabled={!active}>
          <Icon name="chat" />
          Chat
        </button>
        <button type="button" className={tab === 'screen' ? 'on' : ''} onClick={() => setTab('screen')}>
          <Icon name="screen" />
          Screen
        </button>
      </div>
      {sheet && state && (
        <NewSessionSheet
          state={state}
          onClose={() => setSheet(false)}
          onCreated={(s) => {
            setSessions((m) => ({ ...m, [s.id]: s }))
            setSheet(false)
            void open(s.id)
          }}
          toast={toast}
        />
      )}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.error ? 'error' : ''}`} style={{ bottom: `calc(var(--sab) + ${64 + toasts.indexOf(t) * 52}px)` }}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

function Icon({ name }: { name: 'layers' | 'chat' | 'screen' | 'send' | 'stop' | 'plus' }): React.JSX.Element {
  const p: Record<string, string> = {
    layers: 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
    chat: 'M4 5h16v11H8l-4 4V5z',
    screen: 'M3 5h18v12H3zM8 21h8',
    send: 'M12 19V5m0 0l-6 6m6-6l6 6',
    stop: 'M7 7h10v10H7z',
    plus: 'M12 5v14M5 12h14'
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={p[name]} />
    </svg>
  )
}

function Sessions({ state, sessions, onOpen, onNew }: { state?: RemoteState; sessions: Record<string, SessionMeta>; onOpen: (id: string) => void; onNew: () => void }): React.JSX.Element {
  const list = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  const seen = new Set<string>()
  const rows: { s: SessionMeta; pair: SessionMeta[] }[] = []
  for (const s of list) {
    if (s.pairId) {
      if (seen.has(s.pairId)) continue
      seen.add(s.pairId)
      rows.push({ s, pair: list.filter((x) => x.pairId === s.pairId) })
    } else rows.push({ s, pair: [s] })
  }
  const acct = state?.accounts
  return (
    <div className="list">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px 6px' }}>
        {acct && (
          <>
            <span className={`chip ${acct.claude.loggedIn ? 'claude' : ''}`}>Claude {acct.claude.loggedIn ? 'ready' : 'signed out'}</span>
            <span className={`chip ${acct.codex.loggedIn ? 'codex' : ''}`}>Codex {acct.codex.loggedIn ? 'ready' : acct.codex.installed ? 'signed out' : 'missing'}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm primary" onClick={onNew}>
          <Icon name="plus" /> New
        </button>
      </div>
      {rows.length === 0 && (
        <div className="empty">
          <h2>No sessions yet</h2>
          Start one here or on your Mac.
        </div>
      )}
      {rows.map(({ s, pair }) => {
        const status = pair.find((p) => p.status === 'waiting-approval')?.status ?? pair.find((p) => p.status === 'running' || p.status === 'starting')?.status ?? pair.find((p) => p.status === 'error')?.status ?? 'idle'
        return (
          <button type="button" key={s.id} className="row" onClick={() => onOpen(s.id)}>
            <span className={`ribbon ${pair.length > 1 ? 'both' : s.agent}`} />
            <span style={{ minWidth: 0 }}>
              <div className="t">{s.title}</div>
              <div className="s">
                {pair.length > 1 ? 'claude + codex' : s.agent} · {shortPath(s.cwd)}
              </div>
            </span>
            <span className="r">
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className={`pip ${status === 'waiting-approval' ? 'warn' : status === 'running' || status === 'starting' ? 'busy' : status === 'error' ? 'bad' : ''}`} />
                {relTime(s.updatedAt)}
              </span>
              {status === 'waiting-approval' && <span style={{ color: 'var(--warn)' }}>needs you</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Chat({ pair, items, toast }: { pair: SessionMeta[]; items: Record<string, TimelineItem[]>; toast: (t: string, e?: boolean) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const primary = pair[0]
  const list = useMemo(() => pair.flatMap((s) => items[s.id] ?? []).sort((a, b) => a.ts - b.ts), [pair, items])
  useEffect(() => {
    const el = scroller.current?.parentElement
    if (el) el.scrollTop = el.scrollHeight
  }, [list.length, list[list.length - 1]?.kind === 'assistant' ? (list[list.length - 1] as { text: string }).text.length : 0])
  const running = pair.some((s) => s.status === 'running' || s.status === 'starting')
  const waiting = pair.some((s) => s.status === 'waiting-approval')
  const send = async (): Promise<void> => {
    const t = text.trim()
    if (!t) return
    setText('')
    try {
      await Promise.all(pair.map((s) => api.send(s.id, t)))
    } catch (e) {
      toast((e as Error).message, true)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="chat-head">
        {pair.map((s) => (
          <span key={s.id} className={`chip ${s.agent}`}>
            {s.agent === 'claude' ? 'Claude' : 'Codex'} · {s.status === 'waiting-approval' ? 'needs you' : s.status === 'running' ? 'working' : s.status}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <select value={primary.policy} onChange={(e) => pair.forEach((s) => void api.policy(s.id, e.target.value as PolicyMode).catch((err) => toast((err as Error).message, true)))}>
          {(Object.keys(POLICY_LABEL) as PolicyMode[]).map((p) => (
            <option key={p} value={p}>
              {POLICY_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="timeline" ref={scroller}>
        {list.length === 0 && <div className="empty">Nothing yet. Send a brief below.</div>}
        {groupBlocks(list).map((b) => (b.kind === 'activity' ? <Activity key={b.id} tools={b.tools} /> : <Item key={b.item.id} item={b.item} toast={toast} />))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="composer" style={{ position: 'sticky', bottom: 0 }}>
        <textarea
          value={text}
          placeholder={pair.length > 1 ? 'Brief both agents…' : `Brief ${primary.agent === 'claude' ? 'Claude' : 'Codex'}…`}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        {running || waiting ? (
          <button type="button" className="send stop" title="Stop" onClick={() => pair.forEach((s) => void api.interrupt(s.id))}>
            <Icon name="stop" />
          </button>
        ) : (
          <button type="button" className="send" disabled={!text.trim()} onClick={() => void send()} title="Send">
            <Icon name="send" />
          </button>
        )}
      </div>
    </div>
  )
}

type Block = { kind: 'item'; item: TimelineItem } | { kind: 'activity'; id: string; tools: ToolItem[] }
function groupBlocks(items: TimelineItem[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    if (it.kind === 'tool') {
      const last = out[out.length - 1]
      if (last && last.kind === 'activity') last.tools.push(it)
      else out.push({ kind: 'activity', id: it.id, tools: [it] })
    } else if (it.kind !== 'reasoning') out.push({ kind: 'item', item: it })
  }
  return out
}

function Activity({ tools }: { tools: ToolItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const running = tools.some((t) => t.status === 'running')
  const failed = tools.filter((t) => t.status === 'error').length
  return (
    <div className="activity">
      <button type="button" className="activity-head" onClick={() => setOpen((v) => !v)}>
        <span className={`pip ${running ? 'busy' : failed ? 'bad' : 'ok'}`} />
        <span className="grow">
          <b>{running ? 'Working' : 'Worked'}</b> · {tools.length} step{tools.length === 1 ? '' : 's'}
          {failed ? ` · ${failed} failed` : ''}
        </span>
        <span style={{ color: 'var(--text-4)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open &&
        tools.map((t) => (
          <div key={t.id} className="tool-row">
            <span className="n">{t.tool.replace(/^mcp__/, '').replace(/__/g, ' › ')}</span>
            <span className="s">{t.summary}</span>
            <span className={`pip ${t.status === 'running' ? 'busy' : t.status === 'done' ? 'ok' : t.status === 'declined' ? 'warn' : 'bad'}`} />
          </div>
        ))}
    </div>
  )
}

function Item({ item, toast }: { item: TimelineItem; toast: (t: string, e?: boolean) => void }): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <div className="bubble">{item.text}</div>
    case 'assistant':
      if (!item.text) return null
      return (
        <div className="assistant">
          <span className={`avatar ${item.agent}`}>{item.agent === 'claude' ? 'C' : 'X'}</span>
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          </div>
        </div>
      )
    case 'approval':
      return <Approval item={item} toast={toast} />
    case 'status':
      return <div className={`status ${item.level}`}>{item.text}</div>
    case 'result':
      return (
        <div className="result">
          {item.ok ? 'done' : `ended: ${item.summary ?? 'error'}`}
          {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}
          {item.costUsd ? ` · $${item.costUsd.toFixed(3)}` : ''}
        </div>
      )
    default:
      return null
  }
}

function Approval({ item, toast }: { item: ApprovalItem; toast: (t: string, e?: boolean) => void }): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [busy, setBusy] = useState(false)
  const resolved = item.resolved
  const isQ = item.approvalKind === 'question'
  const submit = async (optionId: string): Promise<void> => {
    setBusy(true)
    try {
      await api.approve({ sessionId: item.sessionId, itemId: item.id, optionId, answers: isQ ? answers : undefined })
    } catch (e) {
      toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  const canSend = !isQ || (item.questions ?? []).every((q) => Boolean(answers[q.id]))
  return (
    <div className={`approval ${resolved ? 'resolved' : ''}`}>
      <div className="title">
        <span>{item.title}</span>
        {!resolved && <span className="needs">Needs you</span>}
      </div>
      {item.diff ? (
        <pre className="diff">
          {item.diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
              {l || ' '}
            </div>
          ))}
        </pre>
      ) : item.detail ? (
        <pre>{item.detail}</pre>
      ) : null}
      {item.reason && <div className="reason">{item.reason}</div>}
      {item.warn && <div className="reason" style={{ color: 'var(--warn)' }}>{item.warn}</div>}
      {isQ &&
        (item.questions ?? []).map((q) => (
          <div className="question" key={q.id}>
            <div className="q">{q.question}</div>
            {q.options.map((o) => (
              <button type="button" key={o.label} className={`opt ${answers[q.id] === o.label ? 'sel' : ''}`} disabled={Boolean(resolved)} onClick={() => setAnswers({ ...answers, [q.id]: o.label })}>
                <div>{o.label}</div>
                {o.description && <div className="d">{o.description}</div>}
              </button>
            ))}
          </div>
        ))}
      {resolved ? (
        <div className="reason">{resolved.optionId === 'answered' ? 'Answered' : /deny|cancel/.test(resolved.optionId) ? 'Declined' : resolved.optionId === 'always' ? 'Allowed · remembered' : 'Allowed'}</div>
      ) : (
        <div className="actions">
          {item.options.map((o) => (
            <button type="button" key={o.id} className={`btn ${o.tone === 'primary' ? 'primary' : o.tone === 'danger' ? 'danger' : ''}`} disabled={busy || (o.tone === 'primary' && !canSend)} onClick={() => void submit(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Screen({ shareScreen }: { shareScreen: boolean }): React.JSX.Element {
  const [src, setSrc] = useState<'screen' | 'browser'>(shareScreen ? 'screen' : 'browser')
  const [url, setUrl] = useState<string>()
  const [err, setErr] = useState<string>()
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const tick = async (): Promise<void> => {
      if (!alive || document.hidden) {
        timer = window.setTimeout(tick, 1500)
        return
      }
      try {
        const f = await api.frame(src)
        if (!f.url) {
          setErr(f.error ?? 'No image')
          setUrl(undefined)
        } else {
          setUrl((old) => {
            if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
            return f.url
          })
          setErr(undefined)
        }
      } catch (e) {
        setErr((e as Error).message)
      }
      timer = window.setTimeout(tick, src === 'screen' ? 1200 : 2000)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [src])
  return (
    <div className="screen">
      <div className="seg">
        <button type="button" className={src === 'screen' ? 'on' : ''} onClick={() => setSrc('screen')}>
          Mac screen
        </button>
        <button type="button" className={src === 'browser' ? 'on' : ''} onClick={() => setSrc('browser')}>
          Tandem browser
        </button>
      </div>
      <div className="frame">{url ? <img src={url} alt="" /> : <div className="msg">{err ?? 'Loading…'}</div>}</div>
      <div style={{ color: 'var(--text-4)', fontSize: 12, textAlign: 'center' }}>Live view refreshes about once a second while this tab is open. To act, send a brief in Chat.</div>
    </div>
  )
}

function NewSessionSheet({ state, onClose, onCreated, toast }: { state: RemoteState; onClose: () => void; onCreated: (s: SessionMeta) => void; toast: (t: string, e?: boolean) => void }): React.JSX.Element {
  const [agent, setAgent] = useState<AgentKind>(state.accounts.claude.loggedIn ? 'claude' : 'codex')
  const folders = [...new Set([state.defaultCwd, ...state.recentFolders].filter(Boolean) as string[])]
  const [cwd, setCwd] = useState(folders[0] ?? '')
  const [policy, setPolicy] = useState<PolicyMode>(state.defaultPolicy)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async (): Promise<void> => {
    if (!cwd) return
    setBusy(true)
    try {
      onCreated(await api.create({ agent, cwd, policy, capabilities: { inAppBrowser: true }, text }))
    } catch (e) {
      toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <h2>New session</h2>
        <div className="field">
          <label>Agent</label>
          <div className="seg">
            <button type="button" className={agent === 'claude' ? 'on claude' : ''} disabled={!state.accounts.claude.installed} onClick={() => setAgent('claude')}>
              Claude Code
            </button>
            <button type="button" className={agent === 'codex' ? 'on codex' : ''} disabled={!state.accounts.codex.installed} onClick={() => setAgent('codex')}>
              Codex
            </button>
          </div>
        </div>
        <div className="field">
          <label>Project folder</label>
          <div className="folders">
            {folders.map((f) => (
              <button type="button" key={f} className={f === cwd ? 'on' : ''} onClick={() => setCwd(f)}>
                {f}
              </button>
            ))}
            <input className="input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/you/Projects/app" />
          </div>
        </div>
        <div className="field">
          <label>Autonomy</label>
          <div className="seg">
            {(Object.keys(POLICY_LABEL) as PolicyMode[]).map((p) => (
              <button type="button" key={p} className={policy === p ? 'on' : ''} onClick={() => setPolicy(p)} style={{ fontSize: 12 }}>
                {POLICY_LABEL[p].replace(' / read-only', '')}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>First brief</label>
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should it do?" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!cwd || busy} onClick={() => void start()}>
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
