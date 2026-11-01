import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/** The phone remote: a small PWA that Tandem serves from the Mac itself. */
export default defineConfig({
  root: resolve('src/remote'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    outDir: resolve('out/remote'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/remote/index.html') }
  }
})
