import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis'
  },
  test: {
    exclude: ['node_modules', 'e2e/**']
  }
})
