import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis'
  },
  // Use a project-local cache directory to avoid EACCES in sandboxed envs
  cacheDir: '.vite-cache',
  optimizeDeps: {
    // Some XMTP browser SDK worker code may not be compatible with optimizer
    exclude: ['workers'],
  },
  test: {
    exclude: ['node_modules', 'e2e/**']
  }
})
