import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { RemoteInfo } from '@shared/types'
import type { PolicyMode } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { BadgeCheck, KeyRound, RefreshCw, Smartphone } from 'lucide-react'
import { useStore } from '../store'
import { Switch } from './ui'

function RemoteCard(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const [info, setInfo] = useState<RemoteInfo>()
  const [qr, setQr] = useState<string>()
  const refresh = async (): Promise<void> => {
    const i = await window.tandem.remoteInfo()
    setInfo(i)
    if (i.urls[0]) setQr(await QRCode.toDataURL(i.urls[0], { margin: 1, width: 220, color: { dark: '#eef0f5', light: '#00000000' } }))
    else setQr(undefined)
  }
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 4000)
    return () => clearInterval(t)
  }, [settings?.remoteEnabled, settings?.remoteToken])
  if (!settings) return <></>
  return (
    <div className="card" data-testid="remote-card">
      <h3>
        <Smartphone size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Phone remote
      </h3>
      <div className="sub">Watch sessions, answer approvals, send briefs and see your screen from your phone. Tandem serves the page itself; nothing leaves your network.</div>
      <div className="toggle-row">
        <div>
          <div className="t">Allow control from my phone</div>
          <div className="d">Starts a local server on port {info?.port ?? settings.remotePort ?? 47831}. Anyone with the QR code can drive your agents, so treat it like a password.</div>
        </div>
        <Switch on={Boolean(settings.remoteEnabled)} onChange={(v) => void update({ remoteEnabled: v })} />
      </div>
      <div className="toggle-row">
        <div>
          <div className="t">Share my Mac screen</div>
          <div className="d">Live view on the Screen tab. macOS asks for Screen Recording permission the first time.</div>
        </div>
        <Switch on={Boolean(settings.remoteShareScreen)} onChange={(v) => void update({ remoteShareScreen: v })} disabled={!settings.remoteEnabled} />
      </div>
      {settings.remoteEnabled && info && (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 220, height: 220, borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center' }}>
            {qr ? <img src={qr} alt="Pair QR" width={200} height={200} /> : <span style={{ color: 'var(--text-3)', fontSize: 12, padding: 16, textAlign: 'center' }}>No network address found. Join Wi-Fi or Tailscale.</span>}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="sub" style={{ marginBottom: 6 }}>
              {info.running ? 'Scan with your phone’s camera. Same Wi-Fi, or any VPN that reaches this Mac (Tailscale works well).' : info.error ? `Not running: ${info.error}` : 'Starting…'}
            </div>
            {info.urls.map((u) => (
              <div key={u} className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)', userSelect: 'text', wordBreak: 'break-all', marginBottom: 4 }}>
                {u.replace(/\?t=.*$/, '')} <span style={{ color: 'var(--text-4)' }}>+ token</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn xs" onClick={() => void navigator.clipboard.writeText(info.urls[0] ?? '')} disabled={!info.urls[0]}>
                Copy link
              </button>
              <button
                type="button"
                className="btn xs"
                onClick={async () => {
                  setInfo(await window.tandem.remoteRotateToken())
                }}
                title="Invalidates every paired phone"
              >
                <RefreshCw size={12} /> New code
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const license = useStore((s) => s.license)
  const activate = useStore((s) => s.activateLicense)
  const accounts = useStore((s) => s.accounts)
  const appInfo = useStore((s) => s.appInfo)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | undefined>()
  if (!settings) return <div className="main" style={{ flex: 1 }} />
  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="titlebar titlebar-drag">
        <div className="crumbs">
          <span className="crumb strong">Settings</span>
        </div>
      </div>
      <div className="settings">
        <div className="settings-inner fade-in">
          <h1>Settings</h1>

          <div className="card">
            <h3>License</h3>
            <div className="sub">
              Tandem is a one-time purchase. Your Claude and ChatGPT subscriptions are billed by Anthropic and OpenAI as usual; Tandem only drives the CLIs you already pay for.
            </div>
            <div className="kv" style={{ marginBottom: 10 }}>
              <span className="k">Status</span>
              <span>
                {license?.status === 'licensed' ? (
                  <span className="chip ok">
                    <BadgeCheck size={12} /> Licensed to {license.licensee} · {license.edition}
                  </span>
                ) : license?.status === 'trial' ? (
                  <span className="chip warn">Trial · {license.trialDaysLeft} days left</span>
                ) : (
                  <span className="chip danger">{license?.status === 'expired' ? 'Trial expired' : 'Invalid key'}</span>
                )}
              </span>
            </div>
            {license?.status !== 'licensed' && (
              <div className="folder-row">
                <input className="input" placeholder="TANDEM-…" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} />
                <button
                  type="button"
                  className="btn primary"
                  disabled={!key.trim()}
                  onClick={async () => {
                    const r = await activate(key)
                    setMsg(r.status === 'licensed' ? `Activated for ${r.licensee}` : r.message ?? 'That key is not valid.')
                  }}
                >
                  <KeyRound size={13} /> Activate
                </button>
              </div>
            )}
            {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
          </div>

          <RemoteCard />

          <div className="card">
            <h3>Defaults</h3>
            <div className="sub">Applied to new sessions. You can still change everything per session.</div>
            <div className="field">
              <label>Default policy</label>
              <div className="seg">
                {(Object.keys(POLICY_LABEL) as PolicyMode[]).map((p) => (
                  <button type="button" key={p} className={settings.defaultPolicy === p ? 'on' : ''} onClick={() => void update({ defaultPolicy: p })}>
                    {POLICY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Theme</label>
              <div className="seg">
                {(['dark', 'light', 'system'] as const).map((t) => (
                  <button type="button" key={t} className={settings.theme === t ? 'on' : ''} onClick={() => void update({ theme: t })}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="toggle-row">
              <div>
                <div className="t">Show reasoning</div>
                <div className="d">Display the agents' thinking summaries in the timeline.</div>
              </div>
              <Switch on={settings.showReasoning} onChange={(v) => void update({ showReasoning: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div className="t">Sound on approval request</div>
                <div className="d">A soft ping when an agent is waiting on you.</div>
              </div>
              <Switch on={settings.soundOnApproval} onChange={(v) => void update({ soundOnApproval: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Command-line tools</h3>
            <div className="sub">Tandem finds `claude` and `codex` on your PATH and in the usual install locations. Override here if yours live somewhere unusual.</div>
            <div className="field">
              <label>Claude Code binary</label>
              <input className="input" placeholder={accounts.claude.binaryPath ?? 'auto-detect'} value={settings.claudeBinary ?? ''} onChange={(e) => void update({ claudeBinary: e.target.value || undefined })} spellCheck={false} />
            </div>
            <div className="field">
              <label>Codex binary</label>
              <input className="input" placeholder={accounts.codex.binaryPath ?? 'auto-detect'} value={settings.codexBinary ?? ''} onChange={(e) => void update({ codexBinary: e.target.value || undefined })} spellCheck={false} />
            </div>
            <div className="kv">
              <span className="k">Claude Code</span>
              <span>
                {accounts.claude.installed ? `${accounts.claude.binaryPath} · v${accounts.claude.version ?? '?'}` : 'not found'}
              </span>
              <span className="k">Codex</span>
              <span>{accounts.codex.installed ? `${accounts.codex.binaryPath} · v${accounts.codex.version ?? '?'}` : 'not found'}</span>
            </div>
          </div>

          <div className="card">
            <h3>About</h3>
            <div className="kv">
              <span className="k">Version</span>
              <span>Tandem {appInfo?.version}</span>
              <span className="k">Platform</span>
              <span>
                {appInfo?.platform} {appInfo?.arch}
              </span>
              <span className="k">Data</span>
              <span>
                <button type="button" className="btn xs" onClick={() => appInfo && void window.tandem.openPath(appInfo.userDataPath)}>
                  Open data folder
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
