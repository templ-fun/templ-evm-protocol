import { defineConfig, configDefaults, coverageConfigDefaults } from 'vitest/config'

export default defineConfig({
  // Use a writable cache directory for Vite transforms
  cacheDir: 'test-results/.vite',
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
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: [
        ...coverageConfigDefaults.exclude,
        'e2e/**',
      ],
    },
  },
})
