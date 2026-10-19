import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RequestListener } from 'node:http'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { appSetting, chatRequest, message, thread } from '../db/schema.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { toLlmSettings } from '../llm/presets.js'
import { RequestsService } from '../requests/requests.service.js'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { DiagnosticsService } from './diagnostics.service.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let client: Pool
let db: Db
let owui: Server
let base: string
let diagnostics: DiagnosticsService
beforeAll(async () => {
  temp = await createTempDb('response_probe')
  await runMigrations(temp.url)
  client = createPool(temp.url)
  db = drizzle(client)
  vi.stubEnv('FAKE_OWUI_E2E', '1')
  const fixture = new URL('../../../../docker/fake-openwebui/server.mjs', import.meta.url).href
  const { handleRequest } = await import(fixture) as { handleRequest: RequestListener }
  owui = createServer(handleRequest)
  await new Promise<void>(resolve => owui.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(owui.address() as AddressInfo).port}`
  const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
    LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: base, LLM_API_KEY: 'fake-key', LLM_OWUI_MODE: 'direct' })
  const provider = RequestsService.createProvider(toLlmSettings(config.llm))
  const requests = new RequestsService(db, config, provider)
  diagnostics = new DiagnosticsService(config, client, requests, db, new FileStorageService(config.fileStorageRoot))
}, MIGRATION_TEST_TIMEOUT_MS)
afterAll(async () => {
  if (owui) { owui.closeAllConnections(); await new Promise<void>(resolve => owui.close(() => resolve())) }
  await client?.end()
  await temp?.drop()
  vi.unstubAllEnvs()
})
async function counts() {
  return Promise.all([thread, message, chatRequest].map(async table => (await db.select({ count: sql<number>`count(*)` }).from(table))[0]!.count))
}

it('DB session override uses real provider details parsing, deletes the temporary chat and creates no conversation/message/request', async () => {
  await db.insert(appSetting).values({ key: 'owuiMode', value: 'session' }).onDuplicateKeyUpdate({ set: { value: 'session' } })
  await db.insert(appSetting).values({ key: 'owuiCleanup', value: false }).onDuplicateKeyUpdate({ set: { value: false } })
  const initial = await (await fetch(`${base}/__e2e/sessions`)).json() as { deleted: string[] }
  const before = await counts()
  const result = await diagnostics.probeOpenWebUiResponse('owner', 'fake-general')
  expect(result.mode).toBe('session')
  expect(result.steps.map(step => step.type)).toEqual(['reasoning', 'text', 'code', 'tool', 'text'])
  expect(result.steps[0]).toEqual({ type: 'reasoning', text: 'PRIVATE_REASONING: details thought' })
  expect(result.content).toBe('\nBefore tool\n\n\n**details answer**')
  expect(JSON.stringify(result.rawResponse)).toContain('<details')
  const sessions = await (await fetch(`${base}/__e2e/sessions`)).json() as { active: string[]; deleted: string[] }
  expect(sessions.active).toEqual([])
  expect(sessions.deleted).toHaveLength(initial.deleted.length + 1)
  expect(await counts()).toEqual(before)
})

it('DB direct override changes the next dispatch without records or temporary chats', async () => {
  await db.insert(appSetting).values({ key: 'owuiMode', value: 'direct' }).onDuplicateKeyUpdate({ set: { value: 'direct' } })
  const initial = await (await fetch(`${base}/__e2e/sessions`)).json() as { deleted: string[] }
  const before = await counts()
  const result = await diagnostics.probeOpenWebUiResponse('owner', 'fake-general')
  expect(result.mode).toBe('direct')
  expect(result.content).toContain('[가짜 OpenWebUI · fake-general]')
  expect(result.rawResponse).toMatchObject({ mode: 'direct' })
  expect(await counts()).toEqual(before)
  const sessions = await (await fetch(`${base}/__e2e/sessions`)).json() as { active: string[]; deleted: string[] }
  expect(sessions.active).toEqual([])
  expect(sessions.deleted).toEqual(initial.deleted)
})
