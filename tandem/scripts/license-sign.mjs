#!/usr/bin/env node
/**
 * Mints a Tandem license key.
 *   node scripts/license-sign.mjs --licensee "Ada Lovelace" --email ada@example.com [--edition personal] [--seats 1]
 * Uses .tandem-license-private.pem from license-keygen.mjs (or TANDEM_LICENSE_PRIVATE_KEY env).
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : null))
    .filter(Boolean)
)
if (!args.licensee) {
  console.error('usage: license-sign.mjs --licensee NAME [--email EMAIL] [--edition personal] [--seats N]')
  process.exit(1)
}
const pem = process.env.TANDEM_LICENSE_PRIVATE_KEY ?? readFileSync(new URL('../.tandem-license-private.pem', import.meta.url), 'utf8')
const key = createPrivateKey(pem)
const payload = {
  licensee: args.licensee,
  email: args.email,
  edition: args.edition ?? 'personal',
  seats: args.seats ? Number(args.seats) : 1,
  issuedAt: Date.now()
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const body = Buffer.from(JSON.stringify(payload))
const sig = sign(null, body, key)
console.log(`TANDEM-${b64url(body)}.${b64url(sig)}`)
