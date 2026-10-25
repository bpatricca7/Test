import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { LineBuffer, titleFromPrompt } from '../src/main/util'
import { diffFromEditInput, summarizeToolInput } from '../src/main/agents/claude/ClaudeSession'
import { evaluateLicense, parseLicenseKey } from '../src/main/services/license'
import { claudePermissionMode, codexPolicy } from '../src/shared/policy'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('LineBuffer', () => {
  it('splits NDJSON across chunk boundaries', () => {
    const lb = new LineBuffer()
    const got: string[] = []
    lb.push('{"a":1}\n{"b":', (l) => got.push(l))
    lb.push('2}\n\n{"c":3}', (l) => got.push(l))
    lb.flush((l) => got.push(l))
    expect(got).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })
})

describe('Claude tool helpers', () => {
  it('summarizes common tools', () => {
    expect(summarizeToolInput('Bash', { command: 'ls -la\necho hi' })).toBe('ls -la')
    expect(summarizeToolInput('Bash', { command: 'ls', description: 'List files' })).toBe('List files')
    expect(summarizeToolInput('Edit', { file_path: '/a/b.ts' })).toBe('/a/b.ts')
    expect(summarizeToolInput('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src')
  })
  it('renders Edit as a diff', () => {
    const d = diffFromEditInput('Edit', { file_path: 'x.ts', old_string: 'a\nb', new_string: 'a\nc' })
    expect(d).toContain('--- a/x.ts')
    expect(d).toContain('-b')
    expect(d).toContain('+c')
  })
  it('titles from prompt', () => {
    expect(titleFromPrompt('Fix the   login bug\nmore')).toBe('Fix the login bug')
  })
})

describe('policy mapping', () => {
  it('maps to native knobs', () => {
    expect(claudePermissionMode('full-auto')).toBe('bypassPermissions')
    expect(claudePermissionMode('plan')).toBe('plan')
    expect(codexPolicy('full-auto')).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' })
    expect(codexPolicy('plan').sandbox).toBe('read-only')
  })
})

describe('license', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const mint = (payload: object): string => {
    const body = Buffer.from(JSON.stringify(payload))
    return `TANDEM-${b64url(body)}.${b64url(sign(null, body, privateKey))}`
  }
  it('accepts a valid key and rejects tampering', () => {
    const key = mint({ licensee: 'Ada', edition: 'personal', issuedAt: 1 })
    expect(parseLicenseKey(key, pem)?.licensee).toBe('Ada')
    const tampered = key.replace(/^TANDEM-([A-Za-z0-9_-]{4})/, (_m, g) => `TANDEM-${g === 'eyJs' ? 'eyJM' : 'eyJs'}`)
    expect(parseLicenseKey(tampered, pem)).toBeNull()
    expect(parseLicenseKey('nope', pem)).toBeNull()
  })
  it('evaluates trial windows', () => {
    const start = Date.now() - 3 * 86_400_000
    expect(evaluateLicense({ ...DEFAULT_SETTINGS, trialStartedAt: start }).status).toBe('trial')
    expect(evaluateLicense({ ...DEFAULT_SETTINGS, trialStartedAt: Date.now() - 40 * 86_400_000 }).status).toBe('expired')
    expect(evaluateLicense({ ...DEFAULT_SETTINGS, licenseKey: 'TANDEM-bad.bad' }).status).toBe('invalid')
  })
})
