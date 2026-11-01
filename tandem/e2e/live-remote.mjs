/**
 * Live end-to-end for the phone remote: boots Tandem with the remote enabled, opens the phone web
 * app in a separate mobile-sized Chromium, creates a Claude session from the phone, approves the
 * Bash call from the phone, and captures phone screenshots plus the Settings QR card on the Mac side.
 *   PLAYWRIGHT_PATH=... xvfb-run -a node e2e/live-remote.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(new URL('..', import.meta.url).pathname)
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright')
const { _electron: electron, chromium, devices } = pw
const electronPath = createRequire(join(root, 'package.json'))('electron')
const shots = join(root, 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const userData = join(tmpdir(), `tandem-remote-${Date.now()}`)
const project = mkdtempSync(join(tmpdir(), 'tandem-remote-project-'))
mkdirSync(userData, { recursive: true })
const PORT = 47899
const TOKEN = 'e2e-pairing-token-0123456789'
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', defaultPolicy: 'ask', showReasoning: true, soundOnApproval: false, recentFolders: [project], defaultCwd: project, claudeModel: 'haiku', trialStartedAt: Date.now(), remoteEnabled: true, remotePort: PORT, remoteToken: TOKEN, remoteShareScreen: true }))

const app = await electron.launch({ executablePath: electronPath, args: [join(root, 'out', 'main', 'index.js'), '--no-sandbox'], env: { ...process.env, TANDEM_USER_DATA: userData } })
const mac = await app.firstWindow()
await mac.setViewportSize({ width: 1440, height: 900 })
await mac.waitForSelector('[data-testid=account-claude][data-signed-in="true"]', { timeout: 60000 })
await mac.click('[data-testid=rail-settings]')
await mac.waitForSelector('[data-testid=remote-card] img[alt="Pair QR"]', { timeout: 15000 })
await mac.waitForTimeout(400)
await mac.screenshot({ path: join(shots, '09-settings-remote-qr.png') })

// The phone: a separate browser with an iPhone viewport, pairing through the QR link.
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], ignoreHTTPSErrors: true })
const phone = await ctx.newPage()
phone.on('pageerror', (e) => console.log('[phone pageerror]', String(e).slice(0, 400)))
const unpaired = await phone.goto(`http://127.0.0.1:${PORT}/`)
console.log('unpaired status:', unpaired?.status())
await phone.goto(`http://127.0.0.1:${PORT}/?t=${TOKEN}`)
await phone.waitForSelector('.tabs', { timeout: 15000 })
await phone.waitForSelector('.pip.ok', { timeout: 15000 })
await phone.waitForTimeout(500)
await phone.screenshot({ path: join(shots, '10-phone-sessions.png') })

await phone.click('text=New')
await phone.waitForSelector('.sheet')
await phone.fill('.sheet textarea', 'Use the Bash tool to run exactly: echo from-phone > phone-marker.txt   Then reply with exactly the word done.')
await phone.waitForTimeout(300)
await phone.screenshot({ path: join(shots, '11-phone-new-session.png') })
await phone.click('.sheet .btn.primary')
await phone.waitForSelector('.timeline', { timeout: 15000 })
console.log('session created from phone; waiting for approval card')
await phone.waitForSelector('.approval:not(.resolved)', { timeout: 150000 })
await phone.waitForTimeout(400)
await phone.screenshot({ path: join(shots, '12-phone-approval.png') })
await phone.click('.approval:not(.resolved) .btn.primary')
console.log('approved from phone; waiting for result')
await phone.waitForSelector('.result', { timeout: 150000 })
await phone.waitForTimeout(800)
await phone.screenshot({ path: join(shots, '13-phone-done.png') })
await phone.click('.tabs >> text=Screen')
await phone.waitForTimeout(3500)
await phone.screenshot({ path: join(shots, '14-phone-screen.png') })
const screenState = await phone.textContent('.frame')
console.log('screen frame has image:', (await phone.$('.frame img')) !== null, screenState ? `(${screenState.trim().slice(0, 60)})` : '')
const text = await phone.textContent('.timeline').catch(() => '')
console.log('marker written:', existsSync(join(project, 'phone-marker.txt')))
await browser.close()
await app.close()
if (!existsSync(join(project, 'phone-marker.txt'))) process.exit(1)
void text
