import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { APP_GUARD } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { AssistantSchema, SystemAssistantToolArgs } from '@mes/contracts'
import { SYSTEM_TOOLS, mockSystemAssistant } from '@mes/llm'
import { createTempDb } from '../test/tempDb.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { DB } from '../db/db.module.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { appUser, code } from '../db/schema.js'
import { SessionGuard, RolesGuard } from '../auth/guards.js'
import { SESSION_STORE, DbSessionStore } from '../auth/session.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'
import { AdminService } from './admin.service.js'
import { AdminAssistantsController } from './admin.controller.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let pool: Pool
let app: INestApplication
let ownerCookie: string
let memberCookie: string
beforeAll(async () => {
  temp = await createTempDb('paths_http'); await runMigrations(temp.url)
  pool = createPool(temp.url); const db = drizzle(pool); await seedCatalog(db)
  await db.insert(appUser).values([{ id: 'owner', name: 'Owner', initials: 'O', color: '#123456', isSystemOwner: true }, { id: 'member', name: 'Member', initials: 'M', color: '#123456' }])
  const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
  const sessions = new DbSessionStore(db, config)
  ownerCookie = `mes_session=${(await sessions.create('owner')).token}`
  memberCookie = `mes_session=${(await sessions.create('member')).token}`
  const module = await Test.createTestingModule({ controllers: [AdminAssistantsController], providers: [AdminService, DbCatalogReader,
    { provide: DB, useValue: db }, { provide: CONFIG, useValue: config }, { provide: SESSION_STORE, useValue: sessions },
    { provide: APP_GUARD, useClass: SessionGuard }, { provide: APP_GUARD, useClass: RolesGuard },
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser()); await app.init()
})
afterAll(async () => { await app?.close(); await pool?.end(); await temp?.drop() })
const fields = { name: 'HTTP paths', summary: '', ownerId: 'owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [] }
const paths = [{ level1: 'HTTP One', level2: 'HTTP Two' }, { level1: 'HTTP Three', level2: 'HTTP Four' }]
it('returns ordered paths and enforces authentication and SO writes at the server', async () => {
  await request(app.getHttpServer()).post('/api/assistants').send({ ...fields, classifications: paths }).expect(401)
  await request(app.getHttpServer()).post('/api/assistants').set('Cookie', memberCookie).send({ ...fields, classifications: paths }).expect(403)
  const response = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie).send({ id: 'http-paths', ...fields, classifications: paths }).expect(201)
  const agent = AssistantSchema.parse(response.body)
  expect(agent.classifications.map(path => [path.level1, path.level2])).toEqual([['HTTP One', 'HTTP Two'], ['HTTP Three', 'HTTP Four']])
  await request(app.getHttpServer()).patch('/api/assistants/http-paths').set('Cookie', memberCookie).send({ classifications: paths.toReversed() }).expect(403)
})
it('rejects empty, duplicate, mixed, ambiguous and extra-key path writes without changing stored paths', async () => {
  for (const classifications of [[], [paths[0], paths[0]], [{ level1: 'One' }], [{ level1: 'One', level2CodeId: 'id' }], [{ ...paths[0], unknown: true }]]) {
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie).send({ ...fields, classifications }).expect(400)
    await request(app.getHttpServer()).patch('/api/assistants/http-paths').set('Cookie', ownerCookie).send({ classifications }).expect(400)
  }
  await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie).send({ ...fields, classifications: paths, level1: 'Conflicting' }).expect(400)
  await request(app.getHttpServer()).patch('/api/assistants/http-paths').set('Cookie', ownerCookie).send({ classifications: paths, level1: 'Conflicting' }).expect(400)
  const changed = await request(app.getHttpServer()).patch('/api/assistants/http-paths').set('Cookie', ownerCookie).send({ summary: 'Unchanged paths' }).expect(200)
  expect(changed.body.classifications.map((path: { level1: string }) => path.level1)).toEqual(['HTTP One', 'HTTP Three'])
})

it('legacy PATCH renames only Lv1 while retaining an unchanged inactive Lv2 ID', async () => {
  const created = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie)
    .send({ id: 'http-legacy-inactive', ...fields, level1: 'Legacy parent', level2: 'Legacy inactive child' }).expect(201)
  const level2CodeId = created.body.level2CodeId as string
  const db = drizzle(pool)
  await db.update(code).set({ active: false }).where(eq(code.id, level2CodeId))

  const changed = await request(app.getHttpServer()).patch('/api/assistants/http-legacy-inactive').set('Cookie', ownerCookie)
    .send({ level1: 'Legacy renamed parent', level2CodeId }).expect(200)
  expect(changed.body).toMatchObject({ level1: 'Legacy renamed parent', level2CodeId,
    classifications: [{ level1: 'Legacy renamed parent', level2: 'Legacy inactive child', level2CodeId }] })
  expect(changed.body.level1CodeId).not.toBe(created.body.level1CodeId)
  expect((await db.select().from(code).where(eq(code.id, level2CodeId)))[0]?.active).toBe(false)
})

it('legacy PATCH promotes an existing secondary pair without duplicating it or reordering other paths', async () => {
  const created = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie)
    .send({ id: 'http-legacy-promote', ...fields, classifications: [
      { level1: 'Promote old', level2: 'Old child' },
      { level1: 'Promote retained', level2: 'Retained child' },
      { level1: 'Promote target', level2: 'Target child' },
      { level1: 'Promote also retained', level2: 'Also retained child' },
    ] }).expect(201)
  const target = created.body.classifications[2]
  const changed = await request(app.getHttpServer()).patch('/api/assistants/http-legacy-promote').set('Cookie', ownerCookie)
    .send({ level1CodeId: target.level1CodeId, level2CodeId: target.level2CodeId }).expect(200)
  expect(changed.body).toMatchObject({ level1CodeId: target.level1CodeId, level2CodeId: target.level2CodeId })
  expect(changed.body.classifications).toEqual([target, created.body.classifications[1], created.body.classifications[3]])
})

it('keeps inactive exemptions scoped to unchanged legacy representative IDs', async () => {
  const created = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', ownerCookie)
    .send({ id: 'http-legacy-guard', ...fields, classifications: [
      { level1: 'Guard parent', level2: 'Guard child' },
      { level1: 'Guard secondary', level2: 'Guard inactive child' },
    ] }).expect(201)
  const primary = created.body.classifications[0]
  const secondary = created.body.classifications[1]
  const db = drizzle(pool)
  await db.update(code).set({ active: false }).where(eq(code.id, secondary.level2CodeId))
  // A different pair using an inactive secondary ID is a new selection.
  await request(app.getHttpServer()).patch('/api/assistants/http-legacy-guard').set('Cookie', ownerCookie)
    .send({ level2CodeId: secondary.level2CodeId }).expect(400)
  await db.update(code).set({ active: false }).where(eq(code.id, primary.level2CodeId))
  // The classifications-array branch must continue requiring a complete existing pair.
  await request(app.getHttpServer()).patch('/api/assistants/http-legacy-guard').set('Cookie', ownerCookie)
    .send({ classifications: [{ level1CodeId: secondary.level1CodeId, level2CodeId: primary.level2CodeId }] }).expect(400)
  const unchanged = await request(app.getHttpServer()).patch('/api/assistants/http-legacy-guard').set('Cookie', ownerCookie)
    .send({ summary: 'Guarded paths' }).expect(200)
  expect(unchanged.body.classifications).toEqual(created.body.classifications)
  expect((await db.select().from(code).where(eq(code.id, primary.level2CodeId)))[0]?.active).toBe(false)
  expect((await db.select().from(code).where(eq(code.id, secondary.level2CodeId)))[0]?.active).toBe(false)
})

// Exercise the JSON schema delivered to a live provider and the Zod contract
// with the same inputs; this intentionally covers only the schema keywords used here.
function accepts(schema: Record<string, any>, value: any): boolean {
  if (schema.oneOf) return schema.oneOf.filter((part: Record<string, any>) => accepts(part, value)).length === 1
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity)
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.every(item => accepts(schema.items, item))
  if (schema.type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value) && (schema.required ?? []).every((key: string) => key in value) &&
    Object.entries(value).every(([key, item]) => schema.properties[key] ? accepts(schema.properties[key], item) : schema.additionalProperties !== false)
  return true
}
it('mock registration and live function schema share the strict nonempty ordered path contract', () => {
  const schema = SYSTEM_TOOLS.find(tool => tool.function.name === 'create_assistant')!.function.parameters
  const mock = JSON.parse(mockSystemAssistant('에이전트 등록: 이름 여러 경로, SDLC > 분석, Record > CCA').toolCalls[0]!.arguments)
  expect(SystemAssistantToolArgs.create_assistant.parse(mock).classifications).toEqual([{ level1: 'SDLC', level2: '분석' }, { level1: 'Record', level2: 'CCA' }])
  for (const [input, expected] of [[mock, true], [{ name: 'A', classifications: [{ level1CodeId: 'l1', level2CodeId: 'l2' }] }, true],
    [{ name: 'A', classifications: [] }, false], [{ name: 'A', level1: 'A', level2: 'B' }, false],
    [{ name: 'A', classifications: [{ level1: 'A', level2CodeId: 'b' }] }, false], [{ name: 'A', classifications: [{ level1: 'A', level2: 'B', extra: true }] }, false],
  ] as const) {
    expect(accepts(schema, input)).toBe(expected)
    expect(SystemAssistantToolArgs.create_assistant.safeParse(input).success).toBe(expected)
  }
})
