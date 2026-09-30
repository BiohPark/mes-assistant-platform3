import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from '../db/db.module.js'
import type { Pool } from 'mysql2/promise'
import { createPool } from '../db/connection.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { CONFIG } from '../config/config.js'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { DB, DB_CLIENT } from '../db/db.module.js'
import { appSession, appUser } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { createTempDb } from '../test/tempDb.js'
import { DbSessionStore } from './session.service.js'
import { DbUserDirectory } from './users.service.js'

describe('세션·사용자 저장소 (MariaDB)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  const config = loadConfig({
    AUTH_MODE: 'oidc',
    DATABASE_URL: 'mysql://unused',
    SESSION_SECRET: 's'.repeat(32),
    APP_ORIGIN: 'http://localhost:5173',
    OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
    OIDC_CLIENT_ID: 'c',
    OIDC_CLIENT_SECRET: 's',
    INITIAL_SYSTEM_OWNERS: 'dev-owner',
  })
  const expectStatus = (status: number) => (response: { status: number; body: unknown }) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status)
  }

  it('local 회원가입 → 비밀번호 조회 → 로그인 세션 resolve', async () => {
    const local = { ...config, authMode: 'local' as const, oidc: undefined }
    const users = new DbUserDirectory(db, local)
    const created = await users.createLocal('local-member', 'hash-for-test')
    expect(created?.name).toBe('local-member')
    expect(await users.createLocal('local-member', 'another-hash')).toBeNull()
    expect((await users.findByLoginId('local-member'))?.hash).toBe('hash-for-test')
    const store = new DbSessionStore(db, local)
    const session = await store.create(created!.id)
    expect((await store.resolve(session.token))?.id).toBe(created!.id)
  })

  it('실제 DB에서 signup → login → 세션 resolve', async () => {
    const local = { ...config, authMode: 'local' as const, oidc: undefined }
    const apiClient = createPool(temp.url, 2)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(local)
      .overrideProvider(DB_CLIENT).useValue(apiClient)
      .overrideProvider(DB).useValue(drizzle(apiClient))
      .compile()
    const app = configureApp(moduleRef.createNestApplication(), local)
    try {
      await app.init()
      await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok', db: 'up' })
      const signup = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'api-local-member', password: 'password-1234' }).expect(expectStatus(201))
      expect(signup.body.roles).toEqual(['member'])
      const login = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'api-local-member', password: 'password-1234' }).expect(expectStatus(200))
      const cookie = String(login.headers['set-cookie']).split(';')[0]!
      const me = await request(app.getHttpServer()).get('/api/me').set('Cookie', cookie).expect(200)
      expect(me.body.id).toBe(signup.body.id)
    } finally {
      await app.close()
    }
  })

  beforeAll(async () => {
    temp = await createTempDb('session')
    await runMigrations(temp.url)
    client = createPool(temp.url, 2)
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
    expect(row?.ssoSubject).toBe('http://localhost:8180/realms/mes-dev#kc-100')
    expect(row?.initials.length).toBeGreaterThan(0)
  })

  it('SSO 식별자는 512자까지 저장하고 초과하면 명확히 거부한다', async () => {
    const users = new DbUserDirectory(db, config)
    const issuerLength = config.oidc!.issuer.length
    const acceptedSub = 's'.repeat(512 - issuerLength - 1)
    const accepted = await users.upsertFromClaims({ sub: acceptedSub })
    expect((await db.select({ subject: appUser.ssoSubject }).from(appUser).where(eq(appUser.id, accepted.id)))[0]?.subject?.length).toBe(512)
    const tooLong = users.upsertFromClaims({ sub: `${acceptedSub}s` })
    await expect(tooLong).rejects.toThrow(/SSO.*512/)
    await expect(tooLong).rejects.toMatchObject({ status: 400 })
  })

  it('주체는 (issuer, sub)로 식별 — IdP를 바꾸면 같은 sub라도 다른 사용자 (권한을 이어받지 않음)', async () => {
    await db.update(appUser).set({ isSystemOwner: false })
    const other = { ...config, oidc: { ...config.oidc!, issuer: 'https://idp.example.com/realms/other' } }
    const a = await new DbUserDirectory(db, config).upsertFromClaims({ sub: 'kc-dup', preferred_username: 'dev-owner', name: '김운영' })
    const b = await new DbUserDirectory(db, { ...other, initialSystemOwners: [] }).upsertFromClaims({ sub: 'kc-dup', name: '다른 사람' })
    expect(b.id).not.toBe(a.id)
    expect(a.isSystemOwner).toBe(true)
    expect(b.isSystemOwner).toBe(false)
  })

  it('INITIAL_SYSTEM_OWNERS에 있는 주체는 SO가 된다', async () => {
    await db.update(appUser).set({ isSystemOwner: false })
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

  it('DB SO 부트스트랩은 한 번만 되고 dev-owner 중복 가입은 409', async () => {
    await db.update(appUser).set({ isSystemOwner: false })
    const local = { ...config, authMode: 'local' as const, oidc: undefined, initialSystemOwners: ['dev-owner', 'second-owner'] }
    const apiClient = createPool(temp.url, 2)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(local)
      .overrideProvider(DB_CLIENT).useValue(apiClient)
      .overrideProvider(DB).useValue(drizzle(apiClient))
      .compile()
    const app = configureApp(moduleRef.createNestApplication(), local)
    try {
      await app.init()
      const first = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(expectStatus(201))
      expect(first.body.roles).toEqual(['member', 'system_owner'])
      await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(expectStatus(409))
      const second = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'second-owner', password: 'password-1234' }).expect(expectStatus(201))
      expect(second.body.roles).toEqual(['member'])
      const oidc = new DbUserDirectory(db, { ...config, initialSystemOwners: ['late-oidc-owner'] })
      const late = await oidc.upsertFromClaims({ sub: 'late-oidc-owner' })
      expect(late.isSystemOwner).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('동시 가입에서도 SO는 한 명만 생성된다', async () => {
    await db.update(appUser).set({ isSystemOwner: false })
    const local = { ...config, authMode: 'local' as const, oidc: undefined, initialSystemOwners: ['parallel-a', 'parallel-b'] }
    const users = new DbUserDirectory(db, local)
    const created = await Promise.all([
      users.createLocal('parallel-a', 'hash-for-test'),
      users.createLocal('parallel-b', 'hash-for-test'),
    ])
    expect(created.filter((user) => user?.isSystemOwner)).toHaveLength(1)
  })
})
