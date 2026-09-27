import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// DB 통합 테스트 — DATABASE_URL의 PostgreSQL 필요 (docker compose 또는 CI 서비스)
const envFile = resolve(import.meta.dirname, '../../.env')
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: { include: ['src/**/*.db.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
})
