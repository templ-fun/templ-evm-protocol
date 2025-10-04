/* eslint-env node */
/* global process */
import { randomBytes } from 'crypto';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

const USE_LOCAL_XMTP = process.env.E2E_XMTP_LOCAL === '1';
const XMTP_ENV = (() => {
  if (USE_LOCAL_XMTP) return 'local';
  const forced = process.env.E2E_XMTP_ENV;
  if (forced && ['local', 'dev', 'production'].includes(forced)) return forced;
  return 'dev';
})();

const sqlitePath = path.join(process.cwd(), 'pw-xmtp.db');

const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
function randomPrivKeyHex() {
  let d = 0n;
  do {
    d = BigInt('0x' + randomBytes(32).toString('hex'));
  } while (d === 0n || d >= N);
  return `0x${d.toString(16).padStart(64, '0')}`;
}

const BOT_PRIVATE_KEY = process.env.E2E_BOT_PRIVATE_KEY || randomPrivKeyHex();

export default defineConfig({
  timeout: 180 * 1000,
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
    // TODO: enable when real UI design work begins; the current UI exists only to prove the idea works and has no design
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
    ...(USE_LOCAL_XMTP
      ? [{
          command: './scripts/run-xmtp-local.sh',
          cwd: '..',
          port: 5555,
          reuseExistingServer: true,
          timeout: 120 * 1000,
        }]
      : []),
    {
      command: 'npx hardhat node',
      port: 8545,
      cwd: '..',
      reuseExistingServer: false,
      timeout: 60 * 1000,
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
        XMTP_ENV,
        LOG_LEVEL: 'info',
        NODE_ENV: 'development',
        BOT_PRIVATE_KEY,
        SQLITE_DB_PATH: sqlitePath,
        CLEAR_DB: '1',
        ENABLE_DEBUG_ENDPOINTS: '1',
      },
      reuseExistingServer: false,
      timeout: 60 * 1000,
    },
    {
      command: 'npm run build -- --outDir pw-dist && npm run preview -- --port 5179 --outDir pw-dist',
      port: 5179,
      env: {
        VITE_E2E_DEBUG: '1',
        VITE_BACKEND_SERVER_ID: 'templ-dev',
        VITE_ENABLE_BACKEND_FALLBACK: '0',
        VITE_BACKEND_URL: 'http://localhost:3001',
        VITE_RPC_URL: 'http://127.0.0.1:8545',
        VITE_XMTP_ENV: XMTP_ENV
      },
      reuseExistingServer: false,
      timeout: 90 * 1000,
    },
  ],
});
