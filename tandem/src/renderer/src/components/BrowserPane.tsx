import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw, X, Sparkles } from 'lucide-react'
import { useStore } from '../store'

/**
 * The visible part of the in-app browser. The page itself is a native WebContentsView owned by the
 * main process; this component reports where it should be drawn and renders the chrome around it.
 */
export function BrowserPane(): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const state = useStore((s) => s.browser)
  const closeBrowser = useStore((s) => s.closeBrowser)
  const modalOpen = useStore((s) => s.newSessionOpen)
  const [url, setUrl] = useState(state?.url ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setUrl(state?.url && state.url !== 'about:blank' ? state.url : '')
  }, [state?.url, editing])

  useEffect(() => {
    const el = host.current
    if (!el) return
    void window.tandem.browserOpen()
    const report = (): void => {
      const r = el.getBoundingClientRect()
      void window.tandem.browserSetBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    const iv = setInterval(report, 1000)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
      clearInterval(iv)
      void window.tandem.browserSetVisible(false)
    }
  }, [])

  useEffect(() => {
    void window.tandem.browserSetVisible(!modalOpen)
  }, [modalOpen])

  const go = (): void => {
    const u = url.trim()
    if (!u) return
    setEditing(false)
    void window.tandem.browserNavigate(u)
  }

  return (
    <div className="browser-pane">
      <div className="browser-bar">
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} disabled={!state?.canGoBack} onClick={() => void window.tandem.browserBack()} title="Back">
          <ArrowLeft size={15} />
        </button>
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} disabled={!state?.canGoForward} onClick={() => void window.tandem.browserForward()} title="Forward">
          <ArrowRight size={15} />
        </button>
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => void window.tandem.browserReload()} title="Reload">
          {state?.loading ? <Loader2 size={15} className="spin" /> : <RotateCw size={14} />}
        </button>
        <input
          className="url"
          value={url}
          placeholder="Search or enter a URL"
          spellCheck={false}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') {
              setEditing(false)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        {state?.busy && (
          <span className="driving" title="An agent is controlling this page">
            <Sparkles size={12} /> {state.busy}
          </span>
        )}
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => void closeBrowser()} title="Hide browser">
          <X size={15} />
        </button>
      </div>
      <div className="browser-host" ref={host}>
        {(!state?.url || state.url === 'about:blank') && !state?.loading && (
          <div className="placeholder">Ask an agent to open a page, or type a URL above.</div>
        )}
      </div>
    </div>
  )
}
