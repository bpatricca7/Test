import React, { useEffect, useRef, useState } from 'react'
import type { AgentKind, SessionMeta } from '@shared/types'
import { ArrowUp, AppWindow, Compass, Globe, ImagePlus, Monitor, Square, TerminalSquare, Cpu, Gauge } from 'lucide-react'
import { useStore } from '../store'
import { Dropdown } from './ui'

export function Composer({ sessions, primary }: { sessions: SessionMeta[]; primary: SessionMeta }): React.JSX.Element {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const sendToPair = useStore((s) => s.sendToPair)
  const interrupt = useStore((s) => s.interrupt)
  const setModel = useStore((s) => s.setModel)
  const setCapabilities = useStore((s) => s.setCapabilities)
  const models = useStore((s) => s.models)
  const loadModels = useStore((s) => s.loadModels)
  const accounts = useStore((s) => s.accounts)
  const openTerminal = useStore((s) => s.openTerminal)
  const openBrowser = useStore((s) => s.openBrowser)
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

  const addFiles = (files: File[]): void => {
    for (const f of files) {
      const r = new FileReader()
      r.onload = () => setImages((prev) => [...prev, String(r.result)])
      r.readAsDataURL(f)
    }
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    addFiles(files)
  }
  const pickImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => addFiles([...(input.files ?? [])])
    input.click()
  }

  const toggleCap = (s: SessionMeta, key: 'computerUse' | 'browserUse' | 'webAccess' | 'inAppBrowser'): void => {
    const next = !s.capabilities[key]
    const acct = accounts[s.agent]
    if (key === 'computerUse' && next) {
      if (!acct.computerUseAvailable) toast('warn', acct.computerUseNote ?? 'Computer use is not available for this agent here.')
      if (s.agent === 'claude') {
        toast('info', 'Claude computer use runs in an interactive session. Opening a Claude terminal with computer-use enabled; type your task there.')
        void openTerminal({ title: `Claude · ${s.title}`, cwd: s.cwd, agent: 'claude', purpose: 'claude-interactive', model: s.model, policy: s.policy, computerUse: true } as never)
      }
    }
    if (key === 'inAppBrowser' && next) {
      void openBrowser()
      toast('info', `${s.agent === 'claude' ? 'Claude' : 'Codex'} gets the Tandem browser tools on the next message.`)
    }
    if (key === 'browserUse' && next) toast('info', acct.browserUseNote ?? 'Browser tools load on the next message.')
    void setCapabilities(s.id, { [key]: next })
  }

  const openCli = (agent: AgentKind): void => {
    const s = sessions.find((x) => x.agent === agent) ?? primary
    void openTerminal({ title: `${agent === 'claude' ? 'Claude' : 'Codex'} · ${s.title}`, cwd: s.cwd, agent, purpose: agent === 'claude' ? 'claude-interactive' : 'codex-interactive', model: s.model, policy: s.policy, computerUse: s.capabilities.computerUse } as never)
  }

  return (
    <div className="composer">
      <div className={`composer-card ${isPair ? '' : primary.agent} ${running ? 'running' : ''}`}>
        {images.length > 0 && (
          <div className="attach-strip">
            {images.map((src, i) => (
              <img key={i} src={src} alt="" onClick={() => setImages(images.filter((_, j) => j !== i))} title="Remove" />
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          value={text}
          placeholder={isPair ? 'Brief both agents…' : primary.agent === 'claude' ? 'Brief Claude Code…' : 'Brief Codex…'}
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
            <span className="caps" key={s.id} title={isPair ? (s.agent === 'claude' ? 'Claude capabilities' : 'Codex capabilities') : undefined}>
              {isPair && <span className={`agent-dot ${s.agent}`} style={{ alignSelf: 'center', margin: '0 4px 0 6px' }} />}
              <button type="button" className={`icon-btn ${s.capabilities.inAppBrowser ? 'on' : ''}`} title="Tandem browser: a browser pane inside this window that the agent can drive" onClick={() => toggleCap(s, 'inAppBrowser')}>
                <AppWindow size={15} />
              </button>
              <button type="button" className={`icon-btn ${s.capabilities.browserUse ? 'on' : ''}`} title={s.agent === 'claude' ? 'Your Chrome, via the Claude in Chrome extension' : 'External Chrome via a Chrome DevTools bridge'} onClick={() => toggleCap(s, 'browserUse')}>
                <Compass size={15} />
              </button>
              <button type="button" className={`icon-btn ${s.capabilities.computerUse ? 'on warm' : ''}`} title="Computer use: see and control the screen (macOS)" onClick={() => toggleCap(s, 'computerUse')}>
                <Monitor size={15} />
              </button>
              <button type="button" className={`icon-btn ${s.capabilities.webAccess ? 'on' : ''}`} title="Web access / network" onClick={() => toggleCap(s, 'webAccess')}>
                <Globe size={15} />
              </button>
            </span>
          ))}
          <button type="button" className="icon-btn" title="Open the interactive CLI in a terminal" onClick={() => openCli(primary.agent)}>
            <TerminalSquare size={16} />
          </button>
          <button type="button" className="icon-btn" title="Attach image" onClick={pickImage}>
            <ImagePlus size={16} />
          </button>
          {running || waiting ? (
            <button type="button" className="send stop" onClick={() => sessions.forEach((s) => void interrupt(s.id))} title="Stop">
              <Square size={13} />
            </button>
          ) : (
            <button type="button" className="send" onClick={send} disabled={!text.trim() && !images.length} title="Send (Enter)">
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="hint">
        <span>
          <span className="kbd">↵</span> send
        </span>
        <span>
          <span className="kbd">⇧</span>
          <span className="kbd">↵</span> newline
        </span>
        <span>paste images</span>
        <span>{isPair ? 'goes to both agents' : `${primary.agent === 'claude' ? 'Claude' : 'Codex'} · ${primary.model ?? 'default model'}`}</span>
      </div>
    </div>
  )
}
