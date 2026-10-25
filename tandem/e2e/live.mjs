/**
 * Live end-to-end: drives the built app with Playwright, starts a real Claude Code session in a temp
 * folder, sends a prompt that needs a Bash approval, approves it in the UI, and waits for the result.
 *   xvfb-run -a node e2e/live.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(new URL('..', import.meta.url).pathname)
const { _electron: electron } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright')
const electronPath = createRequire(join(root, 'package.json'))('electron')
const shots = join(root, 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const userData = join(tmpdir(), `tandem-live-${Date.now()}`)
const project = mkdtempSync(join(tmpdir(), 'tandem-live-project-'))
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', defaultPolicy: 'ask', showReasoning: true, soundOnApproval: false, recentFolders: [project], defaultCwd: project, claudeModel: 'haiku', trialStartedAt: Date.now() }))

const app = await electron.launch({ executablePath: electronPath, args: [join(root, 'out', 'main', 'index.js'), '--no-sandbox'], env: { ...process.env, TANDEM_USER_DATA: userData } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)))
await page.setViewportSize({ width: 1440, height: 920 })
await page.waitForSelector('.sidebar', { timeout: 30000 })
await page.waitForSelector('.account-card.claude .chip.ok', { timeout: 60000 })
console.log('claude detected + signed in')
await page.click('.sidebar-top .icon-btn')
await page.waitForSelector('.modal')
await page.click('.modal .btn.primary')
await page.waitForSelector('.composer textarea', { timeout: 10000 })
await page.fill('.composer textarea', 'Use the Bash tool to run exactly: echo tandem-e2e > e2e-marker.txt   Then reply with exactly the word done.')
await page.keyboard.press('Enter')
console.log('prompt sent; waiting for approval card')
await page.waitForSelector('.approval:not(.resolved)', { timeout: 150000 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '06-live-approval.png') })
await page.click('.approval:not(.resolved) .btn.primary')
console.log('approved; waiting for result')
await page.waitForSelector('.result-line', { timeout: 150000 })
await page.waitForTimeout(800)
await page.screenshot({ path: join(shots, '07-live-done.png') })
const marker = existsSync(join(project, 'e2e-marker.txt'))
const text = await page.textContent('.timeline-inner')
console.log('marker written:', marker)
console.log('timeline has "done":', /done/i.test(text ?? ''))
await app.close()
if (!marker) process.exit(1)
