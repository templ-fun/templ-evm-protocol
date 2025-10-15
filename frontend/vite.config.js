import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis'
  },
  // Use a project-local cache directory to avoid EACCES in sandboxed envs
  cacheDir: '.vite-cache',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url))
    }
  },
  optimizeDeps: {
    // Some XMTP browser SDK worker code may not be compatible with optimizer
    exclude: ['workers'],
  },
  test: {
    exclude: ['node_modules', 'e2e/**']
  }
})
