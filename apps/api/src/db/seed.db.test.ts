import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTempDb } from '../test/tempDb.js'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { appSetting, appUser } from './schema.js'
import { assertDevelopmentSeed, seedCatalog } from './seed.js'
import { verifyPassword } from '../auth/password.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let client: ReturnType<typeof createPool>
beforeAll(async () => { temp = await createTempDb('seed'); await runMigrations(temp.url); client = createPool(temp.url) })
afterAll(async () => { await client?.end(); await temp?.drop() })

it('SEED_DEV_ACCOUNTS=true일 때 개발 시드는 접수 기본값과 역할별 계정을 멱등으로 만든다', async () => {
  const db = drizzle(client)
  process.env.SEED_DEV_ACCOUNTS = 'true'
  await seedCatalog(db, { devUserPassword: 'dev-password-1234' })
  const initial = await db.select().from(appUser).where(eq(appUser.loginId, 'dev-requester'))
  expect(initial).toHaveLength(1)
  expect(initial[0]).toMatchObject({ name: '개발 요청자', isBusinessOwner: true, isSystemOwner: false })
  expect(await verifyPassword('dev-password-1234', initial[0]!.passwordHash!)).toBe(true)
  expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-owner')))[0]).toMatchObject({ isSystemOwner: true })
  expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-member')))[0]).toMatchObject({ isBusinessOwner: false, isSystemOwner: false })
  expect((await db.select().from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId')))[0]?.value).toBe('urs-analyst')
  await db.update(appSetting).set({ value: 'urs-analyst-basic' }).where(eq(appSetting.key, 'srIntakeAssistantId'))
  await seedCatalog(db, { devUserPassword: 'different-password-1234' })
  expect((await db.select().from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId')))[0]?.value).toBe('urs-analyst-basic')
  const rerun = await db.select().from(appUser).where(eq(appUser.loginId, 'dev-requester'))
  expect(rerun).toHaveLength(1)
  expect(rerun[0]?.id).toBe(initial[0]?.id)
  expect(await verifyPassword('dev-password-1234', rerun[0]!.passwordHash!)).toBe(true)
  delete process.env.SEED_DEV_ACCOUNTS
})

it('값 없음·false·production에서는 개발 계정을 만들지 않는다', async () => {
  const db = drizzle(client)
  await db.delete(appUser).where(eq(appUser.loginId, 'dev-requester'))
  await db.delete(appUser).where(eq(appUser.loginId, 'dev-owner'))
  await db.delete(appUser).where(eq(appUser.loginId, 'dev-member'))
  for (const flag of [undefined, 'false']) {
    if (flag === undefined) delete process.env.SEED_DEV_ACCOUNTS
    else process.env.SEED_DEV_ACCOUNTS = flag
    await seedCatalog(db, { devUserPassword: 'dev-password-1234' })
    expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-requester')))).toHaveLength(0)
    expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-owner')))).toHaveLength(0)
    expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-member')))).toHaveLength(0)
  }
  process.env.SEED_DEV_ACCOUNTS = 'true'
  expect(() => assertDevelopmentSeed('production')).toThrow(/운영 환경/)
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try { await expect(seedCatalog(db, { devUserPassword: 'dev-password-1234' })).rejects.toThrow(/운영 환경/) }
  finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
    delete process.env.SEED_DEV_ACCOUNTS
  }
  expect((await db.select().from(appUser).where(eq(appUser.loginId, 'dev-requester')))).toHaveLength(0)
})
