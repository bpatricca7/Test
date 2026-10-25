#!/usr/bin/env node
/**
 * Generates the Ed25519 keypair used to sign Tandem license keys.
 *   node scripts/license-keygen.mjs
 * Keep the private key out of the repo (it is written to .tandem-license-private.pem, gitignored).
 * Paste the printed public key into src/main/services/license.ts (PUBLIC_KEY_PEM).
 */
import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'

const out = new URL('../.tandem-license-private.pem', import.meta.url)
if (existsSync(out) && !process.argv.includes('--force')) {
  console.error('Private key already exists at', out.pathname, '(pass --force to overwrite)')
  process.exit(1)
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
console.log('Private key written to', out.pathname)
console.log('\nPublic key (paste into PUBLIC_KEY_PEM):\n')
console.log(publicKey.export({ type: 'spki', format: 'pem' }))
