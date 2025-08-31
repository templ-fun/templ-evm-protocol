/* eslint-env node */
/* global process */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'tech-demo',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        video: {
          mode: 'on',
          size: { width: 1920, height: 1080 }
        }
      },
    },
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
        BOT_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        PORT: '3001',
      },
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});