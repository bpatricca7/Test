import React, { useEffect } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { useStore } from './store'
import { Rail } from './components/Rail'
import { SessionsPanel } from './components/SessionsPanel'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { Home } from './components/Home'
import { Workspace } from './components/Workspace'
import { SettingsView } from './components/Settings'
import { NewSessionDialog } from './components/NewSessionDialog'

function Toasts(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} onClick={() => dismiss(t.id)}>
          {t.level === 'error' ? <XCircle size={15} style={{ color: 'var(--danger)', flex: 'none' }} /> : t.level === 'warn' ? <AlertTriangle size={15} style={{ color: 'var(--warn)', flex: 'none' }} /> : <Info size={15} style={{ color: 'var(--info)', flex: 'none' }} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

function LicenseBanner(): React.JSX.Element | null {
  const license = useStore((s) => s.license)
  const openSettings = useStore((s) => s.openSettings)
  if (!license || license.status === 'licensed') return null
  return (
    <div className="banner">
      <span className="grow">{license.status === 'trial' ? `Trial · ${license.trialDaysLeft} day${license.trialDaysLeft === 1 ? '' : 's'} left. Buy once, own it forever.` : license.message}</span>
      <button type="button" className="btn xs" onClick={openSettings}>
        Enter license key
      </button>
    </div>
  )
}

function ExpiredGate(): React.JSX.Element | null {
  const license = useStore((s) => s.license)
  const view = useStore((s) => s.view)
  const openSettings = useStore((s) => s.openSettings)
  if (!license || license.status === 'licensed' || license.status === 'trial' || view === 'settings') return null
  return (
    <div className="modal-bg">
      <div className="modal" style={{ textAlign: 'center' }}>
        <h2>Your trial has ended</h2>
        <div className="sub">Enter a license key to keep using Tandem. Your sessions and settings are untouched.</div>
        <button type="button" className="btn primary" onClick={openSettings}>
          Enter license key
        </button>
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const booted = useStore((s) => s.booted)
  const init = useStore((s) => s.init)
  const view = useStore((s) => s.view)
  const activeId = useStore((s) => s.activeId)
  const sessionsCollapsed = useStore((s) => s.sessionsCollapsed)
  useEffect(() => {
    void init()
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const st = useStore.getState()
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        st.openNewSession()
      } else if (k === 'k') {
        e.preventDefault()
        st.setPalette(!st.paletteOpen)
      } else if (e.key === '`') {
        e.preventDefault()
        st.toggleTerminalPane()
      } else if (k === 'b' && !e.shiftKey) {
        e.preventDefault()
        void (st.browserOpen ? st.closeBrowser() : st.openBrowser())
      } else if (e.key === '\\') {
        e.preventDefault()
        st.toggleSessions()
      } else if (e.key === ',') {
        e.preventDefault()
        st.openSettings()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  if (!booted)
    return (
      <div className="ambient">
        <div className="grain" />
      </div>
    )
  return (
    <>
      <div className="ambient">
        <div className="grain" />
      </div>
      <div className={`app ${sessionsCollapsed ? 'sessions-collapsed' : ''}`}>
        <Rail />
        <SessionsPanel />
        <div className="main-col">
          <LicenseBanner />
          {view === 'settings' ? <SettingsView /> : view === 'session' && activeId ? <Workspace sessionId={activeId} /> : <Home />}
        </div>
        <StatusBar />
      </div>
      <NewSessionDialog />
      <CommandPalette />
      <ExpiredGate />
      <Toasts />
    </>
  )
}
