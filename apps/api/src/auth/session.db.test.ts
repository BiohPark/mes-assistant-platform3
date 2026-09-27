import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { appSession, appUser } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { createTempDb } from '../test/tempDb.js'
import { DbSessionStore } from './session.service.js'
import { DbUserDirectory } from './users.service.js'

describe('세션·사용자 저장소 (PostgreSQL)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  const config = loadConfig({
    DATABASE_URL: 'postgres://unused',
    SESSION_SECRET: 's'.repeat(32),
    APP_ORIGIN: 'http://localhost:5173',
    OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
    OIDC_CLIENT_ID: 'c',
    OIDC_CLIENT_SECRET: 's',
    INITIAL_SYSTEM_OWNERS: 'dev-owner',
  })

  beforeAll(async () => {
    temp = await createTempDb('session')
    await runMigrations(temp.url)
    client = postgres(temp.url, { max: 2, onnotice: () => undefined })
    db = drizzle(client)
  })
  afterAll(async () => {
    await client?.end()
    await temp?.drop()
  })

  it('첫 로그인 때 사용자를 만들고, 다시 로그인하면 같은 사용자 (이름은 갱신)', async () => {
    const users = new DbUserDirectory(db, config)
    const a = await users.upsertFromClaims({ sub: 'kc-100', preferred_username: 'dev-member', name: '이담당' })
    const b = await users.upsertFromClaims({ sub: 'kc-100', preferred_username: 'dev-member', name: '이담당2' })
    expect(b.id).toBe(a.id)
    expect(b.name).toBe('이담당2')
    expect(a.isSystemOwner).toBe(false)
    const [row] = await db.select().from(appUser).where(eq(appUser.id, a.id))
    expect(row?.ssoSubject).toBe('kc-100')
    expect(row?.initials.length).toBeGreaterThan(0)
  })

  it('INITIAL_SYSTEM_OWNERS에 있는 주체는 SO가 된다', async () => {
    const users = new DbUserDirectory(db, config)
    const so = await users.upsertFromClaims({ sub: 'kc-200', preferred_username: 'dev-owner', name: '김운영' })
    expect(so.isSystemOwner).toBe(true)
  })

  it('세션: 토큰 원문은 저장하지 않고, 만료·삭제된 세션은 풀리지 않는다', async () => {
    const users = new DbUserDirectory(db, config)
    const u = await users.upsertFromClaims({ sub: 'kc-300', preferred_username: 'dev-requester', name: '박요청' })
    const store = new DbSessionStore(db, config)
    const { token } = await store.create(u.id)
    expect((await store.resolve(token))?.id).toBe(u.id)
    const rows = await db.select().from(appSession)
    expect(rows.some((r) => r.id === token)).toBe(false)

    await store.destroy(token)
    expect(await store.resolve(token)).toBeNull()

    const expired = await store.create(u.id)
    await db.update(appSession).set({ expiresAt: new Date(Date.now() - 1000) })
    expect(await store.resolve(expired.token)).toBeNull()
  })
})
