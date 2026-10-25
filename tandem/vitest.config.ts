import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env.TANDEM_LIVE ? [] : ['tests/live/**'],
    testTimeout: 180_000,
    hookTimeout: 60_000
  }
})
