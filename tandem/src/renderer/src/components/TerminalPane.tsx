import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Plus, X } from 'lucide-react'
import { useStore } from '../store'

const THEME = {
  background: '#07090d',
  foreground: '#e6e9ef',
  cursor: '#ff9a6c',
  selectionBackground: 'rgba(110,231,200,0.25)',
  black: '#0b0d12',
  brightBlack: '#5c6370',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#7dd3fc',
  magenta: '#f0abfc',
  cyan: '#6ee7c8',
  white: '#e6e9ef'
}

function XTerm({ termId }: { termId: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const term = new Terminal({ theme: THEME, fontFamily: 'SF Mono, JetBrains Mono, Menlo, monospace', fontSize: 12.5, cursorBlink: true, allowProposedApi: true, scrollback: 5000, macOptionIsMeta: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    const doFit = (): void => {
      try {
        fit.fit()
        void window.tandem.terminalResize(termId, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }
    doFit()
    const ro = new ResizeObserver(doFit)
    ro.observe(el)
    const offData = term.onData((d) => void window.tandem.terminalWrite(termId, d))
    const off = window.tandem.onEvent((ev) => {
      if (ev.type === 'terminal-data' && ev.termId === termId) term.write(ev.data)
      if (ev.type === 'terminal-exit' && ev.termId === termId) term.write(`\r\n\x1b[2m[process exited with code ${ev.code}]\x1b[0m\r\n`)
    })
    term.focus()
    return () => {
      off()
      offData.dispose()
      ro.disconnect()
      term.dispose()
    }
  }, [termId])
  return <div className="terminal-host" ref={host} />
}

export function TerminalPane(): React.JSX.Element {
  const terminals = useStore((s) => s.terminals)
  const active = useStore((s) => s.activeTermId)
  const setActive = useStore((s) => s.setActiveTerm)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const openTerminal = useStore((s) => s.openTerminal)
  const toggle = useStore((s) => s.toggleTerminalPane)
  const activeId = useStore((s) => s.activeId)
  const sessions = useStore((s) => s.sessions)
  const settings = useStore((s) => s.settings)
  const cwd = (activeId && sessions[activeId]?.cwd) || settings?.defaultCwd || '/'
  const current = terminals.find((t) => t.id === active) ?? terminals[0]
  return (
    <div className="terminal-pane">
      <div className="terminal-tabs">
        {terminals.map((t) => (
          <button type="button" key={t.id} className={`terminal-tab ${current?.id === t.id ? 'on' : ''}`} onClick={() => setActive(t.id)}>
            {t.agent && <span className={`agent-dot ${t.agent}`} />}
            {t.title}
            <X
              size={12}
              onClick={(e) => {
                e.stopPropagation()
                void closeTerminal(t.id)
              }}
            />
          </button>
        ))}
        <button type="button" className="icon-btn" title="New shell here" onClick={() => void openTerminal({ title: 'Shell', cwd, purpose: 'shell' })}>
          <Plus size={15} />
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon-btn" title="Hide terminal" onClick={() => toggle(false)}>
          <X size={15} />
        </button>
      </div>
      {current ? (
        <XTerm key={current.id} termId={current.id} />
      ) : (
        <div className="empty">
          <p>No terminals. Open an interactive Claude or Codex CLI from the composer, or start a shell.</p>
        </div>
      )}
    </div>
  )
}
