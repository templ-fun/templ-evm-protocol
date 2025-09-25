/* eslint-env node */
/* global process */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 240 * 1000,
  outputDir: './pw-results',
  testDir: './e2e',
  testMatch: /.*\.pw\.spec\.js/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  
  use: {
    baseURL: 'http://localhost:5179',
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'basic-flows',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        video: {
          mode: 'on',
          size: { width: 1920, height: 1080 }
        }
      },
    },
    // TODO: This should be enabled when real UI design begins, right now our UI exists only to prove the idea works and has no design
    // {
    //   name: 'tech-demo-mobile',
    //   use: {
    //     ...devices['iPhone 13'],
    //     viewport: { width: 390, height: 844 },
    //     isMobile: true,
    //     hasTouch: true,
    //     video: {
    //       mode: 'on',
    //       size: { width: 390, height: 844 }
    //     }
    //   }
    // }
  ],

  webServer: [
    {
      command: 'npx hardhat node',
      port: 8545,
      cwd: '..',
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: 'npm start',
      port: 3001,
      cwd: '../backend',
      env: {
        RPC_URL: 'http://127.0.0.1:8545',
        PORT: '3001',
        ALLOWED_ORIGINS: 'http://localhost:5179',
        BACKEND_SERVER_ID: 'templ-dev',
        DB_PATH: 'e2e-groups.db',
        CLEAR_DB: '1',
        LOG_LEVEL: 'info',
        NODE_ENV: 'test',
        BACKEND_USE_MEMORY_DB: '1',
      },
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run build -- --outDir pw-dist && npm run preview -- --port 5179 --outDir pw-dist',
      port: 5179,
      env: {
        VITE_E2E_DEBUG: '1',
        VITE_BACKEND_SERVER_ID: 'templ-dev',
        VITE_ENABLE_BACKEND_FALLBACK: '0',
        VITE_BACKEND_URL: 'http://localhost:3001',
        VITE_RPC_URL: 'http://127.0.0.1:8545'
      },
      reuseExistingServer: false,
      timeout: 180 * 1000,
    },
  ],
});
