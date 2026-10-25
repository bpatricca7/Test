import React, { useEffect, useState } from 'react'
import type { PolicyMode } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { Columns2, FolderOpen, Monitor } from 'lucide-react'
import { useStore, type Target } from '../store'
import { Switch, shortPath } from './ui'

export function NewSessionDialog(): React.JSX.Element | null {
  const open = useStore((s) => s.newSessionOpen)
  const initialTarget = useStore((s) => s.newSessionTarget)
  const close = useStore((s) => s.closeNewSession)
  const create = useStore((s) => s.createSessions)
  const settings = useStore((s) => s.settings)
  const accounts = useStore((s) => s.accounts)
  const [target, setTarget] = useState<Target>(initialTarget)
  const [cwd, setCwd] = useState(settings?.defaultCwd ?? '')
  const [policy, setPolicy] = useState<PolicyMode>(settings?.defaultPolicy ?? 'ask')
  const [computer, setComputer] = useState(false)
  const [browser, setBrowser] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTarget(initialTarget)
      setCwd(settings?.defaultCwd ?? '')
      setPolicy(settings?.defaultPolicy ?? 'ask')
      setPrompt('')
      setComputer(false)
      setBrowser(false)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])
  if (!open) return null
  const ready = (a: 'claude' | 'codex'): boolean => accounts[a].installed
  const targetOk = target === 'both' ? ready('claude') && ready('codex') : ready(target)
  const submit = async (): Promise<void> => {
    if (!cwd || !targetOk) return
    setBusy(true)
    try {
      await create({ cwd, policy, capabilities: { computerUse: computer, browserUse: browser, webAccess: true } }, target, prompt)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <h2>New session</h2>
        <div className="sub">Pick who works on it, where, and how much rope they get.</div>
        <div className="field">
          <label>Agent</label>
          <div className="seg">
            <button type="button" className={target === 'claude' ? 'on claude' : ''} onClick={() => setTarget('claude')} disabled={!ready('claude')}>
              <span className="agent-dot claude" /> Claude Code
            </button>
            <button type="button" className={target === 'codex' ? 'on codex' : ''} onClick={() => setTarget('codex')} disabled={!ready('codex')}>
              <span className="agent-dot codex" /> Codex
            </button>
            <button type="button" className={target === 'both' ? 'on both' : ''} onClick={() => setTarget('both')} disabled={!ready('claude') || !ready('codex')} title="Send the same prompt to both and compare side by side">
              <Columns2 size={13} /> Both
            </button>
          </div>
        </div>
        <div className="field">
          <label>Project folder</label>
          <div className="folder-row">
            <input className="input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/you/Projects/my-app" spellCheck={false} />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const p = await window.tandem.pickFolder(cwd || undefined)
                if (p) setCwd(p)
              }}
            >
              <FolderOpen size={14} /> Browse
            </button>
          </div>
          {settings?.recentFolders?.length ? (
            <div className="recent">
              {settings.recentFolders.slice(0, 6).map((f) => (
                <button type="button" key={f} className={`chip ${f === cwd ? 'on' : ''}`} onClick={() => setCwd(f)} title={f}>
                  {shortPath(f)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label>Policy</label>
          <div className="seg">
            {(Object.keys(POLICY_LABEL) as PolicyMode[]).map((p) => (
              <button type="button" key={p} className={policy === p ? 'on' : ''} onClick={() => setPolicy(p)}>
                {POLICY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="toggle-row">
            <div>
              <div className="t">
                <Monitor size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                Computer use
              </div>
              <div className="d">Let the agent see and control your screen (macOS). Claude runs this in an interactive CLI; Codex uses its native computer-use tools.</div>
            </div>
            <Switch on={computer} onChange={setComputer} />
          </div>
          <div className="toggle-row">
            <div>
              <div className="t">Browser use</div>
              <div className="d">Claude in Chrome / Codex browser tools for web apps and sites.</div>
            </div>
            <Switch on={browser} onChange={setBrowser} />
          </div>
        </div>
        <div className="field">
          <label>First message (optional)</label>
          <textarea className="input" style={{ height: 80, padding: 8, resize: 'vertical' }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should they do?" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!cwd || !targetOk || busy} onClick={() => void submit()}>
            {target === 'both' ? 'Start both' : 'Start session'}
          </button>
        </div>
      </div>
    </div>
  )
}
