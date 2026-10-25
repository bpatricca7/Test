import React, { useEffect, useRef, useState } from 'react'
import type { AgentKind } from '@shared/types'
import { Check, ChevronDown } from 'lucide-react'

export function AgentAvatar({ agent, size = 26 }: { agent: AgentKind; size?: number }): React.JSX.Element {
  return (
    <div className={`avatar ${agent}`} style={{ width: size, height: size, fontSize: size * 0.42 }} title={agent === 'claude' ? 'Claude Code' : 'Codex'}>
      {agent === 'claude' ? 'C' : 'X'}
    </div>
  )
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }): React.JSX.Element {
  return <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} style={disabled ? { opacity: 0.4 } : undefined} />
}

export interface MenuOption<T extends string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className,
  renderLabel,
  align = 'left',
  size = 'sm'
}: {
  value: T | undefined
  options: MenuOption<T>[]
  onChange: (v: T) => void
  className?: string
  renderLabel?: (o: MenuOption<T> | undefined) => React.ReactNode
  align?: 'left' | 'right'
  size?: 'sm' | 'xs'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div className={`rel ${className ?? ''}`} ref={ref}>
      <button type="button" className={`btn ${size} ghost`} onClick={() => setOpen((v) => !v)}>
        {renderLabel ? renderLabel(current) : current?.label ?? value ?? '—'}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="popover" style={align === 'right' ? { left: 'auto', right: 0 } : undefined}>
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`item ${o.value === value ? 'sel' : ''}`}
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span style={{ width: 14, display: 'inline-flex', marginTop: 3 }}>{o.value === value ? <Check size={13} /> : null}</span>
              <span>
                <div className="t">{o.label}</div>
                {o.description && <div className="d">{o.description}</div>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function fmtDuration(ms?: number): string {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function fmtTokens(n?: number): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`
  return `${Math.floor(d / 86_400_000)}d`
}

export function shortPath(p: string): string {
  const home = /^\/Users\/[^/]+|^\/home\/[^/]+/.exec(p)?.[0]
  const s = home ? '~' + p.slice(home.length) : p
  const parts = s.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : s
}
