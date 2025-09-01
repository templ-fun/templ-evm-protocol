import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis'
  },
  // Use a writable cache directory to avoid EACCES in CI/sandboxed envs
  cacheDir: 'test-results/.vite',
  optimizeDeps: {
    // Some XMTP browser SDK worker code may not be compatible with optimizer
    exclude: ['workers'],
  },
  test: {
    exclude: ['node_modules', 'e2e/**']
  }
})
