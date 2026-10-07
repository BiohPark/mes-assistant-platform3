import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { DiagnosticsService, recordServerError } from './diagnostics.service.js'

const root = mkdtempSync(join(tmpdir(), 'mes-diag-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('진단 응답은 비밀값을 포함하지 않고 연결·DB·저장소를 설명한다', async () => {
  const secrets = ['database-secret', 'session-secret-32-characters-long', 'llm-secret', 'oidc-secret']
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: `mysql://mes:${secrets[0]}@localhost:3306/mes`,
    SESSION_SECRET: secrets[1], LLM_MODE: 'live', LLM_BASE_URL: 'https://user:password@llm.example.com/v1/key', LLM_API_KEY: secrets[2],
    LLM_PRESET: 'openai-compatible', LLM_DEFAULT_MODEL: secrets[2], OIDC_CLIENT_SECRET: secrets[3], FILE_STORAGE_ROOT: root })
  const db = { query: async (sql: string) => [sql.includes('__drizzle_migrations') ? [{ count: 4 }] : [{ version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin' }]] }
  const llm = { ping: async () => ({ ok: false, detail: `Bearer ${secrets[2]} failed` }) }
  recordServerError('/api/test', 500)
  const result = await new DiagnosticsService(config, db as never, llm as never).get()
  const serialized = JSON.stringify(result)
  for (const secret of [...secrets, 'password', '/v1/key']) expect(serialized).not.toContain(secret)
  expect(result.db).toMatchObject({ version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin', migrations: 4 })
  expect(result.llm).toMatchObject({ mode: 'live', baseUrlHost: 'llm.example.com', ok: false })
  expect(result.storage.writable).toBe(true)
  expect(result.recentErrors.at(-1)).toMatchObject({ path: '/api/test', status: 500 })
  expect(result.secrets).toMatchObject({ databasePassword: true, sessionSecret: true, llmApiKey: true })
})

it('mock 모드의 잘못된 LLM URL도 진단 화면을 깨뜨리지 않는다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://mes:pw@localhost/mes',
    SESSION_SECRET: 'x'.repeat(32), LLM_MODE: 'mock', LLM_BASE_URL: 'invalid', FILE_STORAGE_ROOT: root })
  const result = await new DiagnosticsService(config, { query: async () => [[{ version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin', count: 1 }]] } as never,
    { ping: async () => ({ ok: true, detail: '연결 성공' }) } as never).get()
  expect(result.llm.baseUrlHost).toBe('')
})
