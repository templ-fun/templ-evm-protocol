/* eslint-env node */
/* global process */
import { randomBytes } from 'crypto';
import { defineConfig, devices } from '@playwright/test';

const USE_LOCAL = process.env.E2E_XMTP_LOCAL === '1';
// Default to 'dev' for more deterministic tests; allow override via E2E_XMTP_ENV
const XMTP_ENV = USE_LOCAL ? 'local' : (process.env.E2E_XMTP_ENV || 'dev');

// Generate a fresh secp256k1 private key per run to avoid XMTP installation limits
const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
function randomPrivKeyHex() {
  let d;
  do {
    d = BigInt('0x' + randomBytes(32).toString('hex'));
  } while (d === 0n || d >= N);
  return '0x' + d.toString(16).padStart(64, '0');
}
const BOT_PK = randomPrivKeyHex();

export default defineConfig({
  // Increase per-test timeout to accommodate XMTP welcome propagation on local/dev
  timeout: 240 * 1000,
  outputDir: '../test-results/e2e',
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
    // Optional: start XMTP local node via docker-compose if requested
    ...(USE_LOCAL
      ? [{
          command: './up',
          cwd: '../xmtp-local-node',
          port: 5555,
          reuseExistingServer: true,
          timeout: 180 * 1000,
        }]
      : []),
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
        BOT_PRIVATE_KEY: BOT_PK,
        PORT: '3001',
        ALLOWED_ORIGINS: 'http://localhost:5179',
        BACKEND_SERVER_ID: 'templ-dev',
        DB_PATH: 'e2e-groups.db',
        CLEAR_DB: '1',
        ENABLE_DEBUG_ENDPOINTS: '1',
        LOG_LEVEL: 'info',
        XMTP_ENV,
        NODE_ENV: 'test',
      },
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run build && npm run preview -- --port 5179',
      port: 5179,
      env: {
        VITE_E2E_DEBUG: '1',
        VITE_XMTP_ENV: XMTP_ENV,
        VITE_BACKEND_SERVER_ID: 'templ-dev',
        VITE_ENABLE_BACKEND_FALLBACK: '0',
      },
      reuseExistingServer: false,
      timeout: 180 * 1000,
    },
  ],
});
