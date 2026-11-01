import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * The phone remote: a small PWA that Tandem serves from the Mac itself.
 * `--mode demo` swaps the live backend for a simulated one and inlines every asset,
 * producing a self-contained demo (see scripts/build-phone-demo.mjs).
 */
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    root: resolve('src/remote'),
    base: './',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@backend': resolve(demo ? 'src/remote/mock.ts' : 'src/remote/live.ts')
      }
    },
    build: {
      outDir: resolve(demo ? 'out/remote-demo' : 'out/remote'),
      emptyOutDir: true,
      assetsInlineLimit: demo ? 50_000_000 : 4096,
      cssCodeSplit: false,
      rollupOptions: { input: resolve('src/remote/index.html') }
    }
  }
})
