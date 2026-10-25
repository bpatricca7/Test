/**
 * Launches the built app with Playwright's Electron driver and captures screenshots.
 * Works headless on Linux under `xvfb-run -a node e2e/screenshot.mjs`.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(new URL('..', import.meta.url).pathname)
// Playwright is resolved from the global install (or node_modules) so the app does not ship it.
const { _electron: electron } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright')
const shots = join(root, 'e2e', 'shots')
mkdirSync(shots, { recursive: true })
const userData = join(tmpdir(), `tandem-e2e-${Date.now()}`)
mkdirSync(userData, { recursive: true })
const seedDemo = process.argv.includes('--demo')
if (seedDemo) {
  // Seed a realistic session so the timeline UI can be captured without live API calls.
  const sessions = join(userData, 'sessions')
  mkdirSync(sessions, { recursive: true })
  const demo = JSON.parse(readFileSync(join(root, 'e2e', 'demo-session.json'), 'utf8'))
  for (const s of demo.sessions) writeFileSync(join(sessions, `${s.id}.meta.json`), JSON.stringify(s))
  for (const [id, items] of Object.entries(demo.items)) writeFileSync(join(sessions, `${id}.items.jsonl`), items.map((i) => JSON.stringify(i)).join('\n') + '\n')
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', defaultPolicy: 'ask', showReasoning: true, soundOnApproval: false, recentFolders: ['/Users/you/Projects/acme-app'], defaultCwd: '/Users/you/Projects/acme-app', trialStartedAt: Date.now() }))
}

const electronPath = createRequire(join(root, 'package.json'))('electron')
const app = await electron.launch({
  executablePath: electronPath,
  args: [join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', TANDEM_USER_DATA: userData }
})
const page = await app.firstWindow()
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[renderer]', m.type(), m.text().slice(0, 400)) })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)))
process.on('unhandledRejection', async (e) => { console.log('FAILED:', String(e).slice(0, 300)); try { await page.screenshot({ path: join(shots, '99-failure.png') }) } catch {} ; await app.close(); process.exit(1) })
await page.setViewportSize({ width: 1440, height: 920 })
await page.waitForSelector('.sidebar', { timeout: 30000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: join(shots, '01-home.png') })

if (seedDemo) {
  await page.click('.session-row')
  await page.waitForSelector('.timeline-inner', { timeout: 10000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, '02-session-split.png') })
  const rows = await page.$$('.session-row')
  if (rows[1]) {
    await rows[1].click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(shots, '03-session-approval.png') })
  }
}
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
await page.waitForSelector('.modal', { timeout: 5000 })
await page.waitForTimeout(300)
await page.screenshot({ path: join(shots, '04-new-session.png') })
await page.keyboard.press('Escape')
await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 })
await page.click('.sidebar-bottom >> text=Settings')
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '05-settings.png') })
console.log('screenshots in', shots)
await app.close()
