import React, { useState } from 'react'
import type { PolicyMode } from '@shared/types'
import { POLICY_LABEL } from '@shared/types'
import { BadgeCheck, KeyRound } from 'lucide-react'
import { useStore } from '../store'
import { Switch } from './ui'

export function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const license = useStore((s) => s.license)
  const activate = useStore((s) => s.activateLicense)
  const accounts = useStore((s) => s.accounts)
  const appInfo = useStore((s) => s.appInfo)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | undefined>()
  if (!settings) return <div className="main" />
  return (
    <div className="main">
      <div className="topbar titlebar-drag">
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
