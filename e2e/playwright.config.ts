import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// 전제: docker compose up -d (MariaDB·가짜 OpenWebUI) 와 루트 .env
const envFile = resolve(import.meta.dirname, '../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const apiPort = process.env.API_PORT ?? '3000'
const llmMode = process.env.E2E_LLM_MODE ?? process.env.LLM_MODE
const fakePort = process.env.E2E_FAKE_OWUI_PORT ?? '3102'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 }, // 29개 spec 병렬 부하에서 5 s 기본값은 mock 스트리밍·목록 로드에 빠듯하다(S4 ⑤ 검증)
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: appOrigin, trace: 'retain-on-failure', locale: 'ko-KR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // live 모드: 테스트 전용 가짜 OpenWebUI를 compose 서비스(3101)와 다른 포트에 직접 띄운다 — CI·로컬 모두 compose가 떠 있어도 충돌 없음
    ...(llmMode === 'live' ? [{
      command: 'node docker/fake-openwebui/server.mjs',
      cwd: resolve(import.meta.dirname, '..'),
      env: { PORT: fakePort, FAKE_OWUI_E2E: '1' },
      url: `http://localhost:${fakePort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    }] : []),
    {
      // 명령은 셸 무관(cmd·PowerShell·bash) — && 만 사용
      command: 'pnpm --filter "@mes/api..." build && pnpm --filter @mes/api db:migrate && pnpm db:seed && pnpm --filter @mes/api start',
      cwd: resolve(import.meta.dirname, '..'),
      // api는 --env-file보다 프로세스 환경이 우선 — live면 테스트 전용 가짜 서버로 향하게 한다
      // 요청 한도는 64 KiB로 낮춘다 — 한도 초과 시나리오(S6·E4)가 270k자 대신 70k자로 충분해져 느린 CI 러너에서 큰 메시지 렌더 비용이 준다
      env: { REQUEST_BUDGET_BYTES: '65536', DEV_USER_PASSWORD: 'e2e-password-1234', SEED_DEV_ACCOUNTS: 'true', ...(llmMode === 'live' ? { LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: `http://127.0.0.1:${fakePort}`, LLM_API_KEY: 'e2e-fake-key' } : llmMode ? { LLM_MODE: llmMode } : {}) },
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
