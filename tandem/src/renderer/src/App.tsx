import React, { useEffect } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
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
      <span className="grow">
        {license.status === 'trial' ? `Trial · ${license.trialDaysLeft} day${license.trialDaysLeft === 1 ? '' : 's'} left. Buy once, own it forever.` : license.message}
      </span>
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
  const openNewSession = useStore((s) => s.openNewSession)
  const toggleTerminal = useStore((s) => s.toggleTerminalPane)
  useEffect(() => {
    void init()
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openNewSession()
      }
      if (mod && e.key === '`') {
        e.preventDefault()
        toggleTerminal()
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const st = useStore.getState()
        void (st.browserOpen ? st.closeBrowser() : st.openBrowser())
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        useStore.getState().openSettings()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  if (!booted) return <div className="ambient" />
  return (
    <>
      <div className="ambient" />
      <div className="app">
        <Sidebar />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <LicenseBanner />
          {view === 'settings' ? <SettingsView /> : view === 'session' && activeId ? <Workspace sessionId={activeId} /> : <Home />}
        </div>
      </div>
      <NewSessionDialog />
      <ExpiredGate />
      <Toasts />
    </>
  )
}
