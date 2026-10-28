/**
 * Live end-to-end for the in-app browser: Claude Code, running inside the built Tandem app, drives
 * the Tandem browser pane through the tandem-browser MCP server, clicks a button on a local page,
 * and reports the text it revealed.
 *   PLAYWRIGHT_PATH=... xvfb-run -a node e2e/live-browser.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(new URL('..', import.meta.url).pathname)
const { _electron: electron } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright')
const electronPath = createRequire(join(root, 'package.json'))('electron')
const shots = join(root, 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const userData = join(tmpdir(), `tandem-live-browser-${Date.now()}`)
const project = mkdtempSync(join(tmpdir(), 'tandem-browser-project-'))
mkdirSync(userData, { recursive: true })
const SECRET = 'TANDEM-OK-4242'
writeFileSync(
  join(project, 'page.html'),
  `<!doctype html><html><head><title>Tandem browser test</title><style>body{font-family:sans-serif;padding:40px}button{font-size:18px;padding:10px 18px}</style></head>
<body><h1>Hidden code demo</h1><p>Press the button to reveal the code.</p><button id="reveal" onclick="document.getElementById('secret').textContent='${SECRET}'">Reveal code</button><p>Code: <strong id="secret">(hidden)</strong></p></body></html>`
)
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', defaultPolicy: 'full-auto', showReasoning: true, soundOnApproval: false, recentFolders: [project], defaultCwd: project, claudeModel: 'haiku', trialStartedAt: Date.now() }))

const app = await electron.launch({ executablePath: electronPath, args: [join(root, 'out', 'main', 'index.js'), '--no-sandbox'], env: { ...process.env, TANDEM_USER_DATA: userData } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)))
await page.setViewportSize({ width: 1600, height: 960 })
await page.waitForSelector('[data-testid=account-claude][data-signed-in="true"]', { timeout: 60000 })
await page.click('.sidebar-top .icon-btn')
await page.waitForSelector('.modal')
await page.click('.modal .btn.primary') // in-app browser toggle defaults to on; policy from settings = full auto
await page.waitForSelector('.composer textarea', { timeout: 10000 })
await page.waitForSelector('.browser-pane', { timeout: 10000 })
const pageUrl = `file://${join(project, 'page.html')}`
await page.fill('.composer textarea', `Using the tandem-browser tools: navigate to ${pageUrl}, take a snapshot, click the "Reveal code" button, take another snapshot, and reply with exactly the code shown after "Code:" and nothing else.`)
await page.keyboard.press('Enter')
console.log('prompt sent')
await page.waitForSelector('.result-line', { timeout: 240000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: join(shots, '08-live-inapp-browser.png') })
const text = await page.textContent('.timeline-inner')
const activity = await page.$$eval('.activity-head .sum', (els) => els.map((e) => e.textContent))
console.log('activity:', activity.join(' | '))
const toolNames = await page.$$eval('.tool-row .name', (els) => els.map((e) => e.textContent))
console.log('tools used:', toolNames.join(', '))
console.log('secret in reply:', text?.includes(SECRET))
const browserUrl = await page.inputValue('.browser-bar .url')
console.log('browser pane url:', browserUrl)
await app.close()
if (!text?.includes(SECRET)) process.exit(1)
