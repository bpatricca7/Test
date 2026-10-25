import React, { useEffect, useRef, useState } from 'react'
import type { AgentKind, PolicyMode, SessionMeta } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { ArrowUp, Compass, Globe, ImagePlus, Monitor, Square, TerminalSquare, Shield, Cpu, Gauge } from 'lucide-react'
import { useStore } from '../store'
import { Dropdown } from './ui'

const POLICIES: { value: PolicyMode; label: string; description: string }[] = [
  { value: 'ask', label: POLICY_LABEL.ask, description: 'Prompt before commands, edits outside scope and risky actions' },
  { value: 'auto-edit', label: POLICY_LABEL['auto-edit'], description: 'Edits apply without asking; commands still prompt' },
  { value: 'full-auto', label: POLICY_LABEL['full-auto'], description: 'No prompts, no sandbox. Only for work you trust completely' },
  { value: 'plan', label: POLICY_LABEL.plan, description: 'Read-only exploration and planning' }
]

export function Composer({ sessions, primary }: { sessions: SessionMeta[]; primary: SessionMeta }): React.JSX.Element {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const sendToPair = useStore((s) => s.sendToPair)
  const interrupt = useStore((s) => s.interrupt)
  const setPolicy = useStore((s) => s.setPolicy)
  const setModel = useStore((s) => s.setModel)
  const setCapabilities = useStore((s) => s.setCapabilities)
  const models = useStore((s) => s.models)
  const loadModels = useStore((s) => s.loadModels)
  const accounts = useStore((s) => s.accounts)
  const openTerminal = useStore((s) => s.openTerminal)
  const toast = useStore((s) => s.toast)
  const isPair = sessions.length > 1
  const running = sessions.some((s) => s.status === 'running' || s.status === 'starting')
  const waiting = sessions.some((s) => s.status === 'waiting-approval')

  useEffect(() => {
    for (const s of sessions) if (!models[s.agent].length) void loadModels(s.agent)
  }, [sessions.map((s) => s.agent).join()])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(220, el.scrollHeight) + 'px'
  }, [text])

  const send = (): void => {
    const t = text.trim()
    if (!t && !images.length) return
    void sendToPair(primary.id, t || '(see attached image)', images.length ? images : undefined)
    setText('')
    setImages([])
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    for (const f of files) {
      const r = new FileReader()
      r.onload = () => setImages((prev) => [...prev, String(r.result)])
      r.readAsDataURL(f)
    }
  }

  const pickImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => {
      for (const f of [...(input.files ?? [])]) {
        const r = new FileReader()
        r.onload = () => setImages((prev) => [...prev, String(r.result)])
        r.readAsDataURL(f)
      }
    }
    input.click()
  }

  const toggleCap = (s: SessionMeta, key: 'computerUse' | 'browserUse' | 'webAccess'): void => {
    const next = !s.capabilities[key]
    if (key === 'computerUse' && next) {
      const acct = accounts[s.agent]
      if (!acct.computerUseAvailable) {
        toast('warn', acct.computerUseNote ?? 'Computer use is not available for this agent here.')
      }
      if (s.agent === 'claude') {
        toast('info', 'Claude computer use runs in an interactive session. Opening a Claude terminal for this project with computer-use enabled; type your task there.')
        void openTerminal({ title: `Claude · ${s.title}`, cwd: s.cwd, agent: 'claude', purpose: 'claude-interactive', model: s.model, policy: s.policy, computerUse: true } as never)
      }
    }
    void setCapabilities(s.id, { [key]: next })
  }

  const openCli = (agent: AgentKind): void => {
    const s = sessions.find((x) => x.agent === agent) ?? primary
    void openTerminal({ title: `${agent === 'claude' ? 'Claude' : 'Codex'} · ${s.title}`, cwd: s.cwd, agent, purpose: agent === 'claude' ? 'claude-interactive' : 'codex-interactive', model: s.model, policy: s.policy, computerUse: s.capabilities.computerUse } as never)
  }

  return (
    <div className="composer">
      <div className={`composer-box ${isPair ? '' : primary.agent}`}>
        {images.length > 0 && (
          <div className="attach-strip">
            {images.map((src, i) => (
              <img key={i} src={src} alt="" onClick={() => setImages(images.filter((_, j) => j !== i))} title="Remove" style={{ cursor: 'pointer' }} />
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          value={text}
          placeholder={isPair ? 'Message both Claude Code and Codex…' : primary.agent === 'claude' ? 'Message Claude Code…' : 'Message Codex…'}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
        />
        <div className="composer-row">
          <Dropdown
            value={primary.policy}
            options={POLICIES}
            onChange={(p) => void setPolicy(primary.id, p, true)}
            renderLabel={(o) => (
              <>
                <Shield size={13} /> {o?.label}
              </>
            )}
          />
          {sessions.map((s) => {
            const list = models[s.agent]
            const opts = list.map((m) => ({ value: m.id, label: m.label, description: m.description }))
            if (s.model && !opts.find((o) => o.value === s.model)) opts.unshift({ value: s.model, label: s.model, description: undefined })
            const current = list.find((m) => m.id === s.model)
            return (
              <React.Fragment key={s.id}>
                <Dropdown
                  value={s.model}
                  options={opts.length ? opts : [{ value: s.model ?? 'default', label: s.model ?? 'Default model', description: 'Model list loads once the agent responds' }]}
                  onChange={(m) => void setModel(s.id, m)}
                  renderLabel={(o) => (
                    <>
                      <Cpu size={13} style={{ color: s.agent === 'claude' ? 'var(--claude-2)' : 'var(--codex-2)' }} /> {o?.label ?? 'Model'}
                    </>
                  )}
                />
                {current?.efforts?.length ? (
                  <Dropdown
                    value={s.effort ?? ''}
                    options={[{ value: '', label: 'Default effort' }, ...current.efforts.map((e) => ({ value: e, label: e }))]}
                    onChange={(e) => void setModel(s.id, s.model ?? current.id, e || undefined)}
                    renderLabel={(o) => (
                      <>
                        <Gauge size={13} /> {o?.label || 'effort'}
                      </>
                    )}
                  />
                ) : null}
              </React.Fragment>
            )
          })}
          <span className="grow" />
          {sessions.map((s) => (
            <React.Fragment key={s.id}>
              <button type="button" className={`chip ${s.capabilities.computerUse ? 'on' : ''}`} title={`${s.agent === 'claude' ? 'Claude' : 'Codex'} computer use: let it see and control your screen (macOS)`} onClick={() => toggleCap(s, 'computerUse')}>
                <Monitor size={12} /> {isPair ? (s.agent === 'claude' ? 'C' : 'X') + ' ' : ''}Computer
              </button>
              <button type="button" className={`chip ${s.capabilities.browserUse ? 'on' : ''}`} title="Browser use" onClick={() => toggleCap(s, 'browserUse')}>
                <Compass size={12} /> {isPair ? (s.agent === 'claude' ? 'C' : 'X') + ' ' : ''}Browser
              </button>
              <button type="button" className={`chip ${s.capabilities.webAccess ? 'on' : ''}`} title="Web access / network" onClick={() => toggleCap(s, 'webAccess')}>
                <Globe size={12} />
              </button>
            </React.Fragment>
          ))}
          <button type="button" className="icon-btn" title="Open interactive CLI in terminal" onClick={() => openCli(primary.agent)}>
            <TerminalSquare size={16} />
          </button>
          <button type="button" className="icon-btn" title="Attach image" onClick={pickImage}>
            <ImagePlus size={16} />
          </button>
          {running || waiting ? (
            <button type="button" className="btn sm danger" onClick={() => sessions.forEach((s) => void interrupt(s.id))} title="Stop">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button type="button" className="btn sm primary" onClick={send} disabled={!text.trim() && !images.length} title="Send (Enter)">
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="hint" style={{ textAlign: 'center', marginTop: 6 }}>
        <span className="kbd">Enter</span> send · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> newline · paste images · {isPair ? 'messages go to both agents' : `policy & model apply to this ${primary.agent === 'claude' ? 'Claude' : 'Codex'} session`}
      </div>
    </div>
  )
}
