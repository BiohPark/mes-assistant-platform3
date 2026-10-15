import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { appSetting, fileObject } from '../db/schema.js'
import { DiagnosticsService, recordServerError } from './diagnostics.service.js'

const settingsDb = { select: () => ({ from: () => ({ where: async () => [], leftJoin: () => ({ where: async () => [] }) }) }) }
let root: string
let storage: FileStorageService
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mes-diag-')); storage = new FileStorageService(root) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('진단 응답은 비밀값을 포함하지 않고 연결·DB·저장소를 설명한다', async () => {
  const secrets = ['database-secret', 'session-secret-32-characters-long', 'llm-secret', 'oidc-secret']
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: `mysql://mes:${secrets[0]}@localhost:3306/mes`,
    SESSION_SECRET: secrets[1], LLM_MODE: 'live', LLM_BASE_URL: 'https://user:password@llm.example.com/v1/key', LLM_API_KEY: secrets[2],
    LLM_PRESET: 'openai-compatible', LLM_DEFAULT_MODEL: secrets[2], OIDC_CLIENT_SECRET: secrets[3], FILE_STORAGE_ROOT: root })
  const db = { query: async (sql: string) => [sql.includes('__drizzle_migrations') ? [{ count: 4 }] : [{ version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin' }]] }
  const llm = { ping: async () => ({ ok: false, detail: `Bearer ${secrets[2]} failed` }) }
  recordServerError('/api/test', 500)
  const result = await new DiagnosticsService(config, db as never, llm as never, settingsDb as never, storage).get()
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
    { ping: async () => ({ ok: true, detail: '연결 성공' }) } as never, settingsDb as never, storage).get()
  expect(result.llm.baseUrlHost).toBe('')
  expect(result.llm.defaultModel).toBe('glm-5.2') // .env 미설정이면 유효값(도메인 기본) — 진단도 같은 함수 (S7 C2)
})

it('같은 진단 서비스는 전역 모델 변경·해제 직후 적용 모델을 보여 준다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), LLM_DEFAULT_MODEL: 'env-model' })
  let override: string | undefined
  const db = { select: () => ({ from: () => ({ where: async () => override ? [{ value: override }] : [] }) }) }
  const service = new DiagnosticsService(config, { query: async () => [[]] } as never,
    { ping: async () => ({ ok: true, detail: '' }) } as never, db as never, storage)
  for (const value of ['setting-a', 'setting-b', undefined]) {
    override = value
    expect((await service.get()).llm.defaultModel).toBe(value ?? 'env-model')
  }
})

it('DB 설정 조회가 실패해도 진단은 오류와 환경 폴백 모델을 반환한다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), LLM_DEFAULT_MODEL: 'env-model' })
  const db = { select: () => ({ from: () => ({ where: async () => { throw new Error('DB unavailable') } }) }) }
  const service = new DiagnosticsService(config, { query: async () => { throw new Error('DB unavailable') } } as never,
    { ping: async () => ({ ok: true, detail: '' }) } as never, db as never, storage)
  expect(await service.get()).toMatchObject({ db: { error: 'DB 조회 실패' }, llm: { defaultModel: 'env-model' } })
})

it('이미지 설정이 남고 디스크 파일이 없거나 삭제된 메타데이터면 누락을 센다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), FILE_STORAGE_ROOT: root })
  await storage.write('2026/10/present.png', new Uint8Array([1]))
  const images = [
    { storageKey: '2026/10/present.png', deletedAt: null },
    { storageKey: '2026/10/missing.png', deletedAt: null },
    { storageKey: null, deletedAt: null },
    { storageKey: '2026/10/present.png', deletedAt: new Date() },
    { storageKey: '../escape.png', deletedAt: null },
  ]
  const db = { select: () => ({ from: () => ({ where: async () => [], leftJoin: () => ({ where: async () => images }) }) }) }
  const service = new DiagnosticsService(config, { query: async () => [[]] } as never,
    { ping: async () => ({ ok: true, detail: '' }) } as never, db as never, storage)
  const result = await service.get()
  expect(result.storage.assistantImages).toEqual({ configured: 5, missing: 3, unreadable: 1 })
  expect(result.storage.resolution).toEqual(config.fileStorageResolution)
  expect(JSON.stringify(result)).not.toContain('escape.png')
})

it('이미지 조회 실패는 누락 0으로 숨기지 않는다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), FILE_STORAGE_ROOT: root })
  const db = { select: () => { throw new Error('DB unavailable') } }
  const result = await new DiagnosticsService(config, { query: async () => [[]] } as never,
    { ping: async () => ({ ok: true, detail: '' }) } as never, db as never, storage).get()
  expect(result.storage.assistantImages).toBeNull()
})

it('전역 AI 도우미 캐릭터 설정도 디스크 파일이 없으면 누락으로 경고한다', async () => {
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), FILE_STORAGE_ROOT: root })
  const db = { select: () => ({ from: (table: unknown) => ({
    where: () => table === appSetting ? Promise.resolve([{ fileId: 'character-id' }]) : { limit: async () => table === fileObject ? [{ storageKey: '2026/10/character.png', deletedAt: null }] : [] },
    leftJoin: () => ({ where: async () => [] }),
  }) }) }
  const service = new DiagnosticsService(config, { query: async () => [[]] } as never,
    { ping: async () => ({ ok: true, detail: '' }) } as never, db as never, storage)
  expect((await service.get()).storage.assistantImages).toEqual({ configured: 1, missing: 1, unreadable: 0 })
  await storage.write('2026/10/character.png', new Uint8Array([1]))
  expect((await service.get()).storage.assistantImages).toEqual({ configured: 1, missing: 0, unreadable: 0 })
})
