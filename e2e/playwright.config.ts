import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// 전제: docker compose up -d (PostgreSQL·Keycloak·가짜 OpenWebUI) 와 루트 .env
const envFile = resolve(import.meta.dirname, '../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const apiPort = process.env.API_PORT ?? '3000'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: appOrigin, trace: 'retain-on-failure', locale: 'ko-KR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // 명령은 셸 무관(cmd·PowerShell·bash) — && 만 사용
      command: 'pnpm --filter "@mes/api..." build && pnpm --filter @mes/api db:migrate && pnpm --filter @mes/api start',
      cwd: resolve(import.meta.dirname, '..'),
      url: `http://localhost:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @mes/web dev',
      cwd: resolve(import.meta.dirname, '..'),
      url: appOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
