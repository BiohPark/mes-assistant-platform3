import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rolesOf } from '../auth/roles.js'
import { appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, code, codeGroup } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { SEED_ASSISTANTS } from '../db/seedData.js'
import { createTempDb } from '../test/tempDb.js'
import { DbCatalogReader } from './catalog.service.js'

describe('catalog DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  beforeAll(async () => {
    temp = await createTempDb('catalog')
    await runMigrations(temp.url)
    client = postgres(temp.url, { onnotice: () => undefined })
    db = drizzle(client)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('seeds codes, system user, assistants and nested rows twice without duplicates', async () => {
    await seedCatalog(db)
    const first = [
      await db.select().from(codeGroup), await db.select().from(code), await db.select().from(appUser),
      await db.select().from(assistant), await db.select().from(assistantExpectedIo), await db.select().from(assistantChecklistTemplate),
    ]
    await seedCatalog(db)
    const second = [
      await db.select().from(codeGroup), await db.select().from(code), await db.select().from(appUser),
      await db.select().from(assistant), await db.select().from(assistantExpectedIo), await db.select().from(assistantChecklistTemplate),
    ]
    expect(second).toEqual(first)
    expect(second[3]).toHaveLength(SEED_ASSISTANTS.length)
    expect(first[2]).toMatchObject([{ id: 'seed-system', active: false, loginId: null, ssoSubject: null }])
  })

  it('maps code names, sorts cards and gives zero stats before tasks exist', async () => {
    await db.update(code).set({ name: '일탈' }).where(eq(code.id, 'assistant_level2:Deviation'))
    const reader = new DbCatalogReader(db)
    const items = await reader.assistants()
    expect(items.map((item) => item.id)).toEqual(SEED_ASSISTANTS.map((item) => item.id))
    expect(items[0]).toMatchObject({ level1: 'Record', level2: '일탈', level2CodeId: 'assistant_level2:Deviation', level1CodeId: 'assistant_level1:Record' })
    expect(items[0]?.checklistTemplate.length).toBeGreaterThan(0)
    expect(await reader.stats()).toHaveLength(items.length)
    expect((await reader.stats())[0]).toMatchObject({ open: 0, inProgress: 0, onHold: 0, done: 0 })
    expect(await reader.users()).toEqual([])
    expect((await reader.codes('assistant_level1')).every((item) => item.groupKey === 'assistant_level1')).toBe(true)
    await db.update(code).set({ active: false }).where(eq(code.id, 'assistant_level1:Record'))
    expect((await reader.codes('assistant_level1')).some((item) => item.id === 'assistant_level1:Record')).toBe(false)
  })

  it('rejects unknown code FK and exposes BO as requester', async () => {
    await expect(db.insert(assistant).values({ id: 'bad', name: 'bad', level1CodeId: 'missing', level2CodeId: 'missing', sortOrder: 99, ownerId: 'seed-system', status: 'open', color: '#000', createdBy: 'seed-system' })).rejects.toThrow()
    await db.insert(appUser).values({ id: 'bo', name: '가상 요청자', initials: '가', color: '#123456', isBusinessOwner: true })
    const [bo] = await db.select().from(appUser).where(eq(appUser.id, 'bo'))
    expect(rolesOf(bo!)).toEqual(['member', 'requester'])
    expect((await new DbCatalogReader(db).users()).map((user) => user.id)).toContain('bo')
    await db.execute(sql`delete from app_user where id = 'bo'`)
  })
})
