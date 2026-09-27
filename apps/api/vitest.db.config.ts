import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { sourceConditions } from '../../vitest.shared.js'

// DB 통합 테스트 — DATABASE_URL의 PostgreSQL 필요 (docker compose 또는 CI 서비스)
const envFile = resolve(import.meta.dirname, '../../.env')
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
  ...sourceConditions,
  test: { include: ['src/**/*.db.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
})
