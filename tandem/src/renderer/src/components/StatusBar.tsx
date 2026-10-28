import React from 'react'
import { useStore } from '../store'
import { fmtTokens } from './ui'

export function StatusBar(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeId)
  const browser = useStore((s) => s.browser)
  const license = useStore((s) => s.license)
  const list = Object.values(sessions)
  const running = list.filter((x) => x.status === 'running' || x.status === 'starting').length
  const waiting = list.filter((x) => x.status === 'waiting-approval').length
  const active = activeId ? sessions[activeId] : undefined
  const pair = active?.pairId ? list.filter((x) => x.pairId === active.pairId) : active ? [active] : []
  const tokens = pair.reduce((a, p) => a + (p.tokensIn ?? 0) + (p.tokensOut ?? 0), 0)
  const cost = pair.reduce((a, p) => a + (p.totalCostUsd ?? 0), 0)
  return (
    <footer className="statusbar">
      <span className="item live">
        <span className={`pip ${accounts.claude.loggedIn ? 'ok' : ''}`} /> claude {accounts.claude.loggedIn ? 'ready' : accounts.claude.installed ? 'signed out' : 'missing'}
      </span>
      <span className="item live">
        <span className={`pip ${accounts.codex.loggedIn ? 'ok' : ''}`} /> codex {accounts.codex.loggedIn ? 'ready' : accounts.codex.installed ? 'signed out' : 'missing'}
      </span>
      {running > 0 && (
        <span className="item">
          <span className="pip busy" /> {running} running
        </span>
      )}
      {waiting > 0 && (
        <span className="item" style={{ color: 'var(--warn)' }}>
          <span className="pip warn" /> {waiting} need{waiting === 1 ? 's' : ''} you
        </span>
      )}
      <span className="grow" />
      {active && (
        <>
          {active.contextPercent != null && <span className="item">ctx {active.contextPercent}%</span>}
          {tokens > 0 && <span className="item">{fmtTokens(tokens)} tok</span>}
          {cost > 0 && <span className="item">${cost.toFixed(3)}</span>}
        </>
      )}
      {browser?.open && browser.url && browser.url !== 'about:blank' && <span className="item">browser · {new URL(browser.url).host || browser.url.slice(0, 40)}</span>}
      <span className="item">{license?.status === 'licensed' ? 'licensed' : license?.status === 'trial' ? `trial ${license.trialDaysLeft}d` : 'unlicensed'}</span>
    </footer>
  )
}
