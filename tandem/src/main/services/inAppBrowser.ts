/**
 * The in-app browser: a WebContentsView docked inside the Tandem window, positioned where the
 * renderer's BrowserPane says it is. Implements BrowserBackend so the MCP bridge can drive it.
 */
import { BrowserWindow, WebContentsView, session as electronSession, type WebContents } from 'electron'
import type { BrowserState } from '@shared/types'
import type { BrowserBackend, ConsoleEntry, NetworkEntry, Snapshot, Target } from './browserTypes'

const PARTITION = 'persist:tandem-browser'
const HOME = 'about:blank'

const SNAPSHOT_JS = `(() => {
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=option],[role=checkbox],[role=radio],[role=switch],[role=textbox],[role=combobox],[role=searchbox],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const seen = new Set(); const out = []; let n = 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false; return r.bottom > -200 && r.top < innerHeight + 2000; };
  const label = (el) => (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.placeholder || el.alt || el.title || el.name || el.id || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el) || !vis(el)) continue; seen.add(el); n++;
    const ref = 'e' + n; el.setAttribute('data-tandem-ref', ref);
    const tag = el.tagName.toLowerCase(); const role = el.getAttribute('role'); const type = el.getAttribute('type');
    let line = '[' + ref + '] ' + (role || tag) + (type && tag === 'input' ? '(' + type + ')' : '') + ' "' + label(el) + '"';
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) line += ' → ' + h.slice(0, 100); }
    if (el.checked) line += ' [checked]'; if (el.disabled) line += ' [disabled]'; if (el === document.activeElement) line += ' [focused]';
    if (tag === 'select') { const opts = [...el.options].slice(0, 12).map(o => o.label || o.value); line += ' options: ' + opts.join(' | '); }
    out.push(line); if (out.length >= 400) break;
  }
  const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000);
  return { url: location.href, title: document.title, elements: out, text };
})()`

function findJs(t: Target): string {
  const target = JSON.stringify(t)
  return `(() => {
    const t = ${target}; let el = null;
    if (t.ref) el = document.querySelector('[data-tandem-ref="' + t.ref + '"]');
    if (!el && t.selector) { try { el = document.querySelector(t.selector); } catch (e) { return { error: 'bad selector: ' + e.message }; } }
    if (!el && t.text) { const q = t.text.toLowerCase(); const cands = [...document.querySelectorAll('a,button,input,[role=button],[role=link],[role=tab],[role=menuitem],label,summary,li,span,div')]; el = cands.find(e => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase() === q) || cands.find(e => (e.innerText || e.value || e.getAttribute('aria-label') || '').toLowerCase().includes(q)); }
    if (!el && typeof t.x === 'number') return { x: t.x, y: t.y, tag: 'point' };
    if (!el) return { error: 'no element matched ' + JSON.stringify(t) };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const d = { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), label: (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').trim().slice(0, 60) };
    if (!el.hasAttribute('data-tandem-ref')) { el.setAttribute('data-tandem-ref', 'target'); d.ref = 'target'; } else d.ref = el.getAttribute('data-tandem-ref');
    return d;
  })()`
}

const KEY_MAP: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', space: 'Space', arrowdown: 'Down', arrowup: 'Up', arrowleft: 'Left', arrowright: 'Right', down: 'Down', up: 'Up', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' }

export class InAppBrowser implements BrowserBackend {
  private view?: WebContentsView
  private win?: BrowserWindow
  private bounds = { x: 0, y: 0, width: 0, height: 0 }
  private visible = false
  private busy?: string
  private consoleBuf: ConsoleEntry[] = []
  private netBuf: NetworkEntry[] = []
  private onState: (s: BrowserState) => void
  private listenersInstalled = false
  private open = false

  constructor(onState: (s: BrowserState) => void) {
    this.onState = onState
  }

  get isOpen(): boolean {
    return this.open
  }

  private get wc(): WebContents {
    const v = this.ensureView()
    return v.webContents
  }

  attach(win: BrowserWindow): void {
    if (this.win === win) return
    this.win = win
    if (this.view) {
      win.contentView.addChildView(this.view)
      this.applyBounds()
    }
    win.on('closed', () => {
      if (this.win === win) this.win = undefined
    })
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const ses = electronSession.fromPartition(PARTITION)
    if (!this.listenersInstalled) {
      this.listenersInstalled = true
      ses.setUserAgent(ses.getUserAgent().replace(/ ?Electron\/[\d.]+/i, '').replace(/ ?tandem\/[\d.]+/i, ''))
      ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission)))
      const starts = new Map<number, number>()
      ses.webRequest.onBeforeRequest((d, cb) => {
        starts.set(d.id, Date.now())
        cb({})
      })
      ses.webRequest.onCompleted((d) => {
        this.pushNet({ ts: Date.now(), method: d.method, url: d.url, status: d.statusCode, resourceType: d.resourceType, durationMs: starts.has(d.id) ? Date.now() - (starts.get(d.id) as number) : undefined })
        starts.delete(d.id)
      })
      ses.webRequest.onErrorOccurred((d) => {
        this.pushNet({ ts: Date.now(), method: d.method, url: d.url, error: d.error, resourceType: d.resourceType })
        starts.delete(d.id)
      })
    }
    const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
    const wc = view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      void this.navigate(url)
      return { action: 'deny' }
    })
    const push = (): void => this.emit()
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading', 'did-fail-load'] as const) wc.on(ev as 'did-navigate', push)
    wc.on('console-message', (details) => {
      const d = details as unknown as { message?: string; level?: string | number; lineNumber?: number; sourceId?: string }
      const lvl = typeof d.level === 'number' ? ['verbose', 'info', 'warning', 'error'][d.level] ?? 'info' : (d.level ?? 'info')
      this.consoleBuf.push({ ts: Date.now(), level: lvl, message: String(d.message ?? ''), source: d.sourceId, line: d.lineNumber })
      if (this.consoleBuf.length > 300) this.consoleBuf.splice(0, this.consoleBuf.length - 300)
    })
    wc.on('did-navigate', () => {
      this.consoleBuf = []
      this.netBuf = []
    })
    this.view = view
    if (this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(view)
    void wc.loadURL(HOME)
    return view
  }

  private pushNet(n: NetworkEntry): void {
    this.netBuf.push(n)
    if (this.netBuf.length > 400) this.netBuf.splice(0, this.netBuf.length - 400)
  }

  private applyBounds(): void {
    if (!this.view) return
    const b = this.visible && this.open ? this.bounds : { x: 0, y: 0, width: 0, height: 0 }
    this.view.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) })
    this.view.setVisible(this.visible && this.open && b.width > 0)
  }

  setBounds(rect: { x: number; y: number; width: number; height: number }): void {
    this.bounds = rect
    this.applyBounds()
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.applyBounds()
  }

  openPane(url?: string): BrowserState {
    this.open = true
    this.ensureView()
    this.applyBounds()
    if (url) void this.navigate(url)
    this.emit()
    return this.state()
  }

  closePane(): void {
    this.open = false
    this.applyBounds()
    this.emit()
  }

  destroy(): void {
    if (this.view) {
      try {
        this.win?.contentView.removeChildView(this.view)
        this.view.webContents.close()
      } catch {
        /* ignore */
      }
    }
    this.view = undefined
    this.open = false
  }

  private emit(): void {
    this.onState(this.state())
  }

  state(): BrowserState {
    const wc = this.view?.webContents
    return {
      open: this.open,
      url: wc?.getURL() ?? '',
      title: wc?.getTitle() ?? '',
      loading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
      busy: this.busy
    }
  }

  setBusy(action?: string): void {
    this.busy = action
    if (action && !this.open) this.openPane()
    this.emit()
  }

  // ---- navigation ------------------------------------------------------------------------

  private waitLoad(timeoutMs = 20000): Promise<void> {
    const wc = this.wc
    return new Promise((resolve) => {
      if (!wc.isLoading()) return resolve()
      const t = setTimeout(done, timeoutMs)
      function done(): void {
        clearTimeout(t)
        wc.off('did-stop-loading', done)
        wc.off('did-fail-load', done)
        resolve()
      }
      wc.once('did-stop-loading', done)
      wc.once('did-fail-load', done)
    })
  }

  async navigate(url: string): Promise<BrowserState> {
    let target = url.trim()
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(target) && !target.includes(' ') ? `https://${target}` : `https://www.google.com/search?q=${encodeURIComponent(target)}`
    if (!this.open) this.openPane()
    const wc = this.wc
    try {
      await wc.loadURL(target)
    } catch (e) {
      const msg = (e as Error).message
      if (!/ERR_ABORTED/.test(msg)) throw new Error(`Navigation failed: ${msg}`)
    }
    await this.waitLoad()
    await new Promise((r) => setTimeout(r, 150))
    return this.state()
  }

  async back(): Promise<BrowserState> {
    const wc = this.wc
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack()
      await this.waitLoad()
    }
    return this.state()
  }

  async forward(): Promise<BrowserState> {
    const wc = this.wc
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward()
      await this.waitLoad()
    }
    return this.state()
  }

  async reload(): Promise<BrowserState> {
    this.wc.reload()
    await this.waitLoad()
    return this.state()
  }

  // ---- reading ---------------------------------------------------------------------------

  async snapshot(): Promise<Snapshot> {
    return (await this.wc.executeJavaScript(SNAPSHOT_JS, true)) as Snapshot
  }

  async screenshot(): Promise<{ base64: string; width: number; height: number }> {
    let img = await this.wc.capturePage()
    const size = img.getSize()
    if (size.width > 1280) img = img.resize({ width: 1280 })
    const out = img.getSize()
    return { base64: img.toPNG().toString('base64'), width: out.width, height: out.height }
  }

  async getText(): Promise<string> {
    return (await this.wc.executeJavaScript('(document.body ? document.body.innerText : "").slice(0, 20000)', true)) as string
  }

  async evaluate(script: string): Promise<unknown> {
    return this.wc.executeJavaScript(`(async () => { const __r = (${script}); return await __r; })().catch(e => ({ error: String(e && e.message || e) }))`, true).catch(async () => this.wc.executeJavaScript(script, true))
  }

  consoleMessages(limit = 50): ConsoleEntry[] {
    return this.consoleBuf.slice(-limit)
  }

  networkRequests(limit = 50, filter?: string): NetworkEntry[] {
    const list = filter ? this.netBuf.filter((n) => n.url.includes(filter)) : this.netBuf
    return list.slice(-limit)
  }

  // ---- acting ----------------------------------------------------------------------------

  private async locate(t: Target): Promise<{ x: number; y: number; tag: string; type?: string | null; label?: string; ref?: string }> {
    const r = (await this.wc.executeJavaScript(findJs(t), true)) as { error?: string; x: number; y: number; tag: string; type?: string | null; label?: string; ref?: string }
    if (r.error) throw new Error(r.error)
    return r
  }

  async click(target: Target, opts: { button?: 'left' | 'right' | 'middle'; double?: boolean } = {}): Promise<string> {
    const wc = this.wc
    const loc = await this.locate(target)
    const button = opts.button ?? 'left'
    const clicks = opts.double ? 2 : 1
    wc.sendInputEvent({ type: 'mouseMove', x: loc.x, y: loc.y })
    for (let i = 1; i <= clicks; i++) {
      wc.sendInputEvent({ type: 'mouseDown', x: loc.x, y: loc.y, button, clickCount: i })
      wc.sendInputEvent({ type: 'mouseUp', x: loc.x, y: loc.y, button, clickCount: i })
    }
    await new Promise((r) => setTimeout(r, 250))
    await this.waitLoad(5000)
    return `Clicked ${loc.tag}${loc.label ? ` "${loc.label}"` : ''} at (${Math.round(loc.x)}, ${Math.round(loc.y)}). Now at ${wc.getURL()}`
  }

  async type(target: Target | undefined, text: string, opts: { submit?: boolean; clear?: boolean } = {}): Promise<string> {
    const wc = this.wc
    let where = 'the focused element'
    if (target) {
      const loc = await this.locate(target)
      wc.sendInputEvent({ type: 'mouseMove', x: loc.x, y: loc.y })
      wc.sendInputEvent({ type: 'mouseDown', x: loc.x, y: loc.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: loc.x, y: loc.y, button: 'left', clickCount: 1 })
      await new Promise((r) => setTimeout(r, 120))
      where = `${loc.tag}${loc.label ? ` "${loc.label}"` : ''}`
    }
    if (opts.clear !== false) {
      await wc.executeJavaScript(
        `(() => { const el = document.activeElement; if (!el) return; if (el.isContentEditable) { document.execCommand('selectAll'); document.execCommand('delete'); return; } if ('value' in el) { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, 'value'); if (d && d.set) d.set.call(el, ''); else el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
        true
      )
    }
    await wc.insertText(text)
    await new Promise((r) => setTimeout(r, 80))
    if (opts.submit) await this.pressKey('Enter')
    return `Typed ${JSON.stringify(text.length > 80 ? text.slice(0, 77) + '…' : text)} into ${where}${opts.submit ? ' and pressed Enter' : ''}`
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<string> {
    const wc = this.wc
    const k = key.trim()
    const code = KEY_MAP[k.toLowerCase()] ?? (k.length === 1 ? k : k)
    const mods = modifiers.map((m) => m.toLowerCase()).map((m) => (m === 'ctrl' ? 'control' : m === 'cmd' || m === 'command' ? 'meta' : m)) as ('shift' | 'control' | 'alt' | 'meta')[]
    wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods })
    if (k.length === 1 && !mods.some((m) => m === 'control' || m === 'meta' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods })
    wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods })
    await new Promise((r) => setTimeout(r, 120))
    await this.waitLoad(5000)
    return `Pressed ${mods.length ? mods.join('+') + '+' : ''}${k}`
  }

  async scroll(opts: { direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; target?: Target }): Promise<string> {
    if (opts.target) {
      const loc = await this.locate(opts.target)
      return `Scrolled ${loc.tag}${loc.label ? ` "${loc.label}"` : ''} into view`
    }
    const amount = opts.amount ?? 600
    const dir = opts.direction ?? 'down'
    const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0
    const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0
    const pos = (await this.wc.executeJavaScript(`(() => { window.scrollBy(${dx}, ${dy}); return { x: scrollX, y: scrollY, max: Math.max(0, document.documentElement.scrollHeight - innerHeight) }; })()`, true)) as { x: number; y: number; max: number }
    return `Scrolled ${dir} ${amount}px. Position ${Math.round(pos.y)}/${Math.round(pos.max)}`
  }

  async selectOption(target: Target, value: string): Promise<string> {
    const loc = await this.locate(target)
    const r = (await this.wc.executeJavaScript(
      `(() => { const el = document.querySelector('[data-tandem-ref="${loc.ref ?? 'target'}"]'); if (!el || el.tagName !== 'SELECT') return { error: 'not a <select>' }; const v = ${JSON.stringify(value)}; const opt = [...el.options].find(o => o.value === v) || [...el.options].find(o => (o.label || o.text).trim().toLowerCase() === v.toLowerCase()); if (!opt) return { error: 'no option ' + v + '; have: ' + [...el.options].map(o => o.label || o.value).join(' | ') }; el.value = opt.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: opt.label || opt.value }; })()`,
      true
    )) as { error?: string; ok?: string }
    if (r.error) throw new Error(r.error)
    return `Selected "${r.ok}"`
  }

  async waitFor(opts: { selector?: string; text?: string; ms?: number; timeoutMs?: number }): Promise<string> {
    const ms = opts.ms
    if (ms && !opts.selector && !opts.text) {
      await new Promise((r) => setTimeout(r, Math.min(ms, 30000)))
      return `Waited ${ms}ms`
    }
    const deadline = Date.now() + Math.min(opts.timeoutMs ?? 10000, 60000)
    const probe = `(() => { ${opts.selector ? `if (document.querySelector(${JSON.stringify(opts.selector)})) return true;` : ''} ${opts.text ? `if ((document.body ? document.body.innerText : '').toLowerCase().includes(${JSON.stringify(opts.text.toLowerCase())})) return true;` : ''} return false; })()`
    while (Date.now() < deadline) {
      if ((await this.wc.executeJavaScript(probe, true)) === true) return `Found ${opts.selector ?? JSON.stringify(opts.text)}`
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`Timed out waiting for ${opts.selector ?? JSON.stringify(opts.text)}`)
  }
}
