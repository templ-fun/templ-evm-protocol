import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  // Use a writable cache directory for Vite transforms
  cacheDir: 'test-results/.vite',
  cache: {
    // Avoid writing into node_modules which can be read-only
    dir: 'test-results/.vitest',
  },
  test: {
    // Avoid worker teardown issues in constrained sandboxes by using forks pool
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    setupFiles: ['./vitest.setup.js'],
    // Give integration hooks more time; individual tests can override
    hookTimeout: 180_000,
    testTimeout: 180_000,
    // Do not collect Playwright E2E specs with Vitest
    exclude: [
      ...configDefaults.exclude, // keep node_modules and common defaults excluded
      'e2e/**',
      '**/*.pw.spec.*',
      'playwright*.config.*',
      'playwright-*.config.*',
    ],
  },
})
