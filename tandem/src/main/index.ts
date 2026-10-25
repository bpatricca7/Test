import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { IPC } from '@shared/ipc'
import type { AccountState, AgentKind, ApprovalResponse, NewSessionInput, PolicyMode, SendInput, Settings, TerminalSpec, TimelineEvent, Capabilities } from '@shared/types'
import { CodexServer } from './agents/codex/CodexServer'
import { AGENTS, defaultCwd, detectClaude, detectCodex, findClaudeBinary, findCodexBinary, listCodexModels, type ClaudeProbeCache } from './services/detect'
import { evaluateLicense } from './services/license'
import { SessionManager } from './services/sessions'
import { SettingsStore } from './services/settings'
import { SessionStore } from './services/store'
import { TerminalManager } from './services/terminal'
import { InAppBrowser } from './services/inAppBrowser'
import { BrowserMcpServer } from './services/browserMcp'
import { claudePermissionMode } from '@shared/policy'
import { setClaudeComputerUseEnabled } from './agents/claude/ClaudeSession'

const isDev = !app.isPackaged
if (process.env.TANDEM_USER_DATA) app.setPath('userData', process.env.TANDEM_USER_DATA)
let win: BrowserWindow | undefined

const userData = app.getPath('userData')
const settings = new SettingsStore(join(userData, 'settings.json'))
const store = new SessionStore(userData)

let codexServer: CodexServer | undefined
const claudeProbe: { value?: ClaudeProbeCache } = {}
let accounts: Record<AgentKind, AccountState> = {
  claude: { agent: 'claude', installed: false, loggedIn: false, computerUseAvailable: false },
  codex: { agent: 'codex', installed: false, loggedIn: false, computerUseAvailable: false }
}

function emit(ev: TimelineEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.event, ev)
}

function claudeBinary(): string | undefined {
  return findClaudeBinary(settings.get().claudeBinary)
}

function codexBinary(): string | undefined {
  return findCodexBinary(settings.get().codexBinary)
}

function getCodexServer(): CodexServer | undefined {
  const bin = codexBinary()
  if (!bin) return undefined
  if (!codexServer || codexServer.binary !== bin) {
    codexServer = new CodexServer(bin)
    codexServer.on('notification', (n: { method: string; params: Record<string, unknown> }) => {
      if (n.method === 'account/login/completed') {
        void refreshAccounts(true)
        emit({ type: 'toast', level: n.params.success ? 'info' : 'error', text: n.params.success ? 'Codex signed in' : `Codex sign-in failed: ${String(n.params.error ?? '')}` })
      }
      if (n.method === 'account/updated') void refreshAccounts(false)
      if (n.method === 'account/rateLimits/updated') void refreshAccounts(false)
    })
    codexServer.on('exit', (info: { closedByUs: boolean; stderr: string }) => {
      if (!info.closedByUs) emit({ type: 'toast', level: 'warn', text: 'Codex app-server stopped; it restarts on the next message.' })
    })
  }
  return codexServer
}

let browser: InAppBrowser | undefined
function ensureBrowser(): InAppBrowser {
  if (!browser) {
    browser = new InAppBrowser((state) => emit({ type: 'browser-state', state }))
    if (win && !win.isDestroyed()) browser.attach(win)
  }
  return browser
}
const browserMcp = new BrowserMcpServer(async () => {
  const b = ensureBrowser()
  if (!b.isOpen) b.openPane()
  return b
}, app.getVersion())

const terminals = new TerminalManager({
  onData: (termId, data) => emit({ type: 'terminal-data', termId, data }),
  onExit: (termId, code) => emit({ type: 'terminal-exit', termId, code })
})

const sessions = new SessionManager({
  store,
  emit,
  claudeBinary,
  codexServer: getCodexServer,
  defaultPolicy: () => settings.get().defaultPolicy,
  defaultModel: (agent) => (agent === 'claude' ? settings.get().claudeModel : settings.get().codexModel),
  defaultEffort: (agent) => (agent === 'codex' ? settings.get().codexEffort : undefined),
  browserMcp: () => (browserMcp.port ? browserMcp.endpoint : undefined)
})

let refreshing: Promise<Record<AgentKind, AccountState>> | undefined
async function refreshAccounts(deep: boolean): Promise<Record<AgentKind, AccountState>> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const cwd = settings.get().defaultCwd ?? defaultCwd()
    const [claude, codex] = await Promise.all([
      detectClaude(claudeBinary(), cwd, claudeProbe, deep).catch((e) => ({ ...accounts.claude, problem: String((e as Error).message) })),
      detectCodex(codexBinary(), getCodexServer()).catch((e) => ({ ...accounts.codex, problem: String((e as Error).message) }))
    ])
    accounts = { claude, codex }
    emit({ type: 'accounts', accounts })
    return accounts
  })()
  try {
    return await refreshing
  } finally {
    refreshing = undefined
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Tandem',
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  if (browser) browser.attach(win)
  win.on('closed', () => (win = undefined))
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, userDataPath: userData, isMac: process.platform === 'darwin' }))
  ipcMain.handle(IPC.pickFolder, async (_e, defaultPath?: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultPath ?? settings.get().defaultCwd ?? defaultCwd() })
    if (r.canceled || !r.filePaths[0]) return null
    settings.rememberFolder(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p))

  ipcMain.handle(IPC.accountsGet, () => accounts)
  ipcMain.handle(IPC.accountsRefresh, () => refreshAccounts(true))
  ipcMain.handle(IPC.accountLogin, async (_e, agent: AgentKind) => {
    if (agent === 'codex') {
      const server = getCodexServer()
      if (!server) return { message: 'Codex CLI not found' }
      await server.ensureStarted()
      const res = await server.request<Record<string, unknown>>('account/login/start', { type: 'chatgpt' }, 30000)
      const url = String(res.authUrl ?? '')
      if (url) void shell.openExternal(url)
      return { url }
    }
    const bin = claudeBinary()
    if (!bin) return { message: 'Claude Code CLI not found' }
    const spec = terminals.open({ title: 'Claude sign-in', cwd: settings.get().defaultCwd ?? defaultCwd(), agent: 'claude', purpose: 'claude-login' }, bin, ['auth', 'login'])
    return { termId: spec.id, message: 'Follow the prompts in the terminal, then come back.' }
  })
  ipcMain.handle(IPC.accountLogout, async (_e, agent: AgentKind) => {
    if (agent === 'codex') {
      const server = getCodexServer()
      if (server) {
        await server.ensureStarted()
        await server.request('account/logout', {}, 15000)
      }
    } else {
      const bin = claudeBinary()
      if (bin) terminals.open({ title: 'Claude sign-out', cwd: defaultCwd(), agent: 'claude', purpose: 'claude-login' }, bin, ['auth', 'logout'])
    }
    await refreshAccounts(true)
  })
  ipcMain.handle(IPC.modelsList, async (_e, agent: AgentKind) => {
    if (agent === 'codex') {
      const server = getCodexServer()
      return server ? listCodexModels(server) : []
    }
    if (!claudeProbe.value) await refreshAccounts(true)
    return claudeProbe.value?.models ?? []
  })

  ipcMain.handle(IPC.sessionsList, () => sessions.list())
  ipcMain.handle(IPC.sessionCreate, (_e, input: NewSessionInput) => {
    settings.rememberFolder(input.cwd)
    return sessions.create(input)
  })
  ipcMain.handle(IPC.sessionItems, (_e, id: string) => sessions.items(id))
  ipcMain.handle(IPC.sessionSend, (_e, input: SendInput) => sessions.send(input.sessionId, input.text, input.images))
  ipcMain.handle(IPC.sessionInterrupt, (_e, id: string) => sessions.interrupt(id))
  ipcMain.handle(IPC.sessionApprove, (_e, resp: ApprovalResponse) => sessions.approve(resp))
  ipcMain.handle(IPC.sessionSetPolicy, (_e, id: string, policy: PolicyMode) => sessions.setPolicy(id, policy))
  ipcMain.handle(IPC.sessionSetModel, (_e, id: string, model: string, effort?: string) => sessions.setModel(id, model, effort))
  ipcMain.handle(IPC.sessionSetCapabilities, (_e, id: string, caps: Partial<Capabilities>) => sessions.setCapabilities(id, caps))
  ipcMain.handle(IPC.sessionRename, (_e, id: string, title: string) => sessions.rename(id, title))
  ipcMain.handle(IPC.sessionDelete, (_e, id: string) => sessions.remove(id))
  ipcMain.handle(IPC.sessionClose, (_e, id: string) => sessions.close(id))

  ipcMain.handle(IPC.terminalOpen, (_e, spec: Omit<TerminalSpec, 'id'> & { id?: string; cols?: number; rows?: number; initialInput?: string; model?: string; policy?: PolicyMode; computerUse?: boolean }) => {
    const cwd = existsSync(spec.cwd) ? spec.cwd : defaultCwd()
    const shellBin = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
    let cmd = shellBin
    let args: string[] = ['-l']
    if (spec.purpose === 'claude-interactive') {
      const bin = claudeBinary()
      if (!bin) throw new Error('Claude Code CLI not found')
      cmd = bin
      args = []
      if (spec.model) args.push('--model', spec.model)
      if (spec.policy) args.push('--permission-mode', claudePermissionMode(spec.policy))
      if (spec.computerUse) {
        try {
          setClaudeComputerUseEnabled(cwd, true)
        } catch {
          /* ignore */
        }
      }
    } else if (spec.purpose === 'codex-interactive') {
      const bin = codexBinary()
      if (!bin) throw new Error('Codex CLI not found')
      cmd = bin
      args = []
      if (spec.model) args.push('-m', spec.model)
      if (spec.computerUse) args.push('--enable', 'computer_use')
    } else if (spec.purpose === 'claude-login') {
      const bin = claudeBinary()
      if (!bin) throw new Error('Claude Code CLI not found')
      cmd = bin
      args = ['auth', 'login']
    } else if (spec.purpose === 'codex-login') {
      const bin = codexBinary()
      if (!bin) throw new Error('Codex CLI not found')
      cmd = bin
      args = ['login']
    }
    return terminals.open({ ...spec, cwd }, cmd, args, { cols: spec.cols, rows: spec.rows, initialInput: spec.initialInput })
  })
  ipcMain.handle(IPC.terminalWrite, (_e, id: string, data: string) => terminals.write(id, data))
  ipcMain.handle(IPC.terminalResize, (_e, id: string, cols: number, rows: number) => terminals.resize(id, cols, rows))
  ipcMain.handle(IPC.terminalClose, (_e, id: string) => terminals.close(id))
  ipcMain.handle(IPC.terminalList, () => terminals.list())

  ipcMain.handle(IPC.browserOpen, (_e, url?: string) => ensureBrowser().openPane(url))
  ipcMain.handle(IPC.browserClose, () => browser?.closePane())
  ipcMain.handle(IPC.browserSetBounds, (_e, rect: { x: number; y: number; width: number; height: number }) => ensureBrowser().setBounds(rect))
  ipcMain.handle(IPC.browserSetVisible, (_e, v: boolean) => ensureBrowser().setVisible(v))
  ipcMain.handle(IPC.browserNavigate, (_e, url: string) => ensureBrowser().navigate(url))
  ipcMain.handle(IPC.browserBack, () => ensureBrowser().back())
  ipcMain.handle(IPC.browserForward, () => ensureBrowser().forward())
  ipcMain.handle(IPC.browserReload, () => ensureBrowser().reload())
  ipcMain.handle(IPC.browserState, () => (browser ? browser.state() : { open: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }))

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const next = settings.set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.claudeBinary !== undefined || patch.codexBinary !== undefined) void refreshAccounts(true)
    return next
  })
  ipcMain.handle(IPC.licenseGet, () => evaluateLicense(settings.get()))
  ipcMain.handle(IPC.licenseActivate, (_e, key: string) => {
    const probe = evaluateLicense({ ...settings.get(), licenseKey: key })
    if (probe.status === 'licensed') settings.set({ licenseKey: key.trim() })
    return probe
  })
}

app.setName('Tandem')
if (process.platform === 'darwin') app.setAboutPanelOptions({ applicationName: 'Tandem', applicationVersion: app.getVersion(), copyright: '© 2026 Tandem' })

void app.whenReady().then(async () => {
  nativeTheme.themeSource = settings.get().theme
  try {
    await browserMcp.start()
  } catch (e) {
    console.error('[tandem] browser MCP server failed to start:', (e as Error).message)
  }
  registerIpc()
  createWindow()
  void refreshAccounts(true)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    try {
      terminals.closeAll()
      await sessions.shutdown()
      await codexServer?.stop()
      await browserMcp.stop()
    } finally {
      app.exit(0)
    }
  })()
})
