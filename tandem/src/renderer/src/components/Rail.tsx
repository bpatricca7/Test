import React from 'react'
import type { AgentKind } from '@shared/types'
import { AppWindow, Home, Layers, Settings as SettingsIcon, TerminalSquare, Command } from 'lucide-react'
import { useStore } from '../store'

function AccountRing({ agent }: { agent: AgentKind }): React.JSX.Element {
  const acct = useStore((s) => s.accounts[agent])
  const pct = acct.usage?.[0]?.usedPercent ?? 0
  const title = `${agent === 'claude' ? 'Claude Code' : 'Codex'} · ${!acct.installed ? 'not installed' : acct.loggedIn ? `signed in${acct.email ? ` as ${acct.email}` : ''}${acct.usage?.[0] ? ` · ${Math.round(pct)}% of ${acct.usage[0].label.toLowerCase()} window used` : ''}` : 'signed out'}`
  return (
    <div className={`acct-ring ${agent} ${acct.loggedIn ? 'in' : 'off'}`} style={{ ['--pct' as string]: acct.loggedIn ? Math.max(4, pct) : 0 }} title={title} data-testid={`account-${agent}`} data-signed-in={acct.loggedIn ? 'true' : 'false'}>
      <span className="ring" />
      <span className="av">{agent === 'claude' ? 'C' : 'X'}</span>
      <span className="dot" />
    </div>
  )
}

export function Rail(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const goHome = useStore((s) => s.goHome)
  const openSettings = useStore((s) => s.openSettings)
  const toggleSessions = useStore((s) => s.toggleSessions)
  const sessionsCollapsed = useStore((s) => s.sessionsCollapsed)
  const browserOpen = useStore((s) => s.browserOpen)
  const terminalOpen = useStore((s) => s.terminalOpen)
  const openBrowser = useStore((s) => s.openBrowser)
  const closeBrowser = useStore((s) => s.closeBrowser)
  const toggleTerminal = useStore((s) => s.toggleTerminalPane)
  const setPalette = useStore((s) => s.setPalette)
  const sessions = useStore((s) => s.sessions)
  const waiting = Object.values(sessions).filter((x) => x.status === 'waiting-approval').length
  return (
    <nav className="rail titlebar-drag">
      <img className="mark no-drag" src="./icon.png" alt="Tandem" onClick={goHome} style={{ cursor: 'pointer' }} />
      <button type="button" className={`rail-btn no-drag ${view === 'home' ? 'on' : ''}`} title="Home" onClick={goHome}>
        <Home size={18} />
      </button>
      <button type="button" className={`rail-btn no-drag ${!sessionsCollapsed && view === 'session' ? 'on' : ''}`} title="Sessions (⌘\\)" onClick={toggleSessions}>
        <Layers size={18} />
        {waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
      <button type="button" className="rail-btn no-drag" title="Command palette (⌘K)" onClick={() => setPalette(true)}>
        <Command size={18} />
      </button>
      <button type="button" className={`rail-btn no-drag ${browserOpen ? 'on' : ''}`} title="Browser (⌘B)" onClick={() => void (browserOpen ? closeBrowser() : openBrowser())}>
        <AppWindow size={18} />
      </button>
      <button type="button" className={`rail-btn no-drag ${terminalOpen ? 'on' : ''}`} title="Terminal (⌘`)" onClick={() => toggleTerminal()}>
        <TerminalSquare size={18} />
      </button>
      <span className="spacer" />
      <div className="rail-accounts no-drag">
        <AccountRing agent="claude" />
        <AccountRing agent="codex" />
      </div>
      <button type="button" className={`rail-btn no-drag ${view === 'settings' ? 'on' : ''}`} title="Settings (⌘,)" onClick={openSettings} data-testid="rail-settings">
        <SettingsIcon size={18} />
      </button>
    </nav>
  )
}
