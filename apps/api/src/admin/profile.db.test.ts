import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appUser } from '../db/schema.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { AccountsService } from './accounts.service.js'
import { DbSessionStore } from '../auth/session.service.js'

describe('사용자 프로필 저장·세션 조회', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let pool: ReturnType<typeof createPool>
  let db: Db
  let app: INestApplication
  let cookie: string
  beforeAll(async () => {
    temp = await createTempDb('profile')
    await runMigrations(temp.url)
    pool = createPool(temp.url)
    db = drizzle(pool)
    await db.insert(appUser).values(['self', 'other'].map((id) => ({ id, loginId: id, name: id, initials: id[0]!, color: '#000' })))
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local', DEFAULT_EMAIL_DOMAIN: 'example.com' })
    cookie = `mes_session=${(await new DbSessionStore(db, config).create('self')).token}`
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CONFIG).useValue(config).overrideProvider(DB).useValue(db).compile()
    app = configureApp(module.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
  }, MIGRATION_TEST_TIMEOUT_MS)
  afterAll(async () => { await app?.close(); await pool?.end(); await temp?.drop() })

  it('기본값은 system·ko, PATCH는 DB에 저장되고 다음 /me에서 읽힌다', async () => {
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', cookie).expect(200)).body).toMatchObject({ theme: 'system', locale: 'ko' })
    const updated = await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', cookie).send({ name: '김 사용자', theme: 'dark', locale: 'en' }).expect(200)
    expect(updated.body).toMatchObject({ name: '김 사용자', theme: 'dark', locale: 'en' })
    expect((await db.select().from(appUser).where(eq(appUser.id, 'self')))[0]).toMatchObject({ name: '김 사용자', initials: '김', theme: 'dark', locale: 'en' })
    expect((await db.select().from(appUser).where(eq(appUser.id, 'other')))[0]).toMatchObject({ name: 'other', theme: 'system', locale: 'ko' })
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', cookie).expect(200)).body).toMatchObject({ name: '김 사용자', theme: 'dark', locale: 'en' })
    await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', cookie).send({ locale: 'ko' }).expect(200)
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', cookie).expect(200)).body).toMatchObject({ name: '김 사용자', theme: 'dark', locale: 'ko' })
  })
  it('기본 이메일은 DB에 쓰지 않고 본인 저장·해제만 반영한다', async () => {
    const view = () => request(app.getHttpServer()).get('/api/me').set('Cookie', cookie).expect(200)
    expect((await view()).body).toMatchObject({ email: 'self@example.com', emailIsDefault: true })
    expect((await db.select().from(appUser).where(eq(appUser.id, 'self')))[0]?.email).toBeNull()
    const saved = await request(app.getHttpServer()).patch('/api/me').set('Cookie', cookie).send({ email: 'Mixed.Case@example.net' }).expect(200)
    expect(saved.body).toMatchObject({ email: 'Mixed.Case@example.net', emailIsDefault: false })
    expect((await view()).body).toMatchObject({ email: 'Mixed.Case@example.net', emailIsDefault: false })
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', DEFAULT_EMAIL_DOMAIN: 'example.com' })
    expect(await new AccountsService(db, config).users()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'self', email: 'Mixed.Case@example.net', emailIsDefault: false }),
      expect.objectContaining({ id: 'other', email: 'other@example.com', emailIsDefault: true }),
    ]))
    const noDomain = new AccountsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }))
    expect(await noDomain.users()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'other', email: null, emailIsDefault: false })]))
    const boundary = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(58)}.com`
    await request(app.getHttpServer()).patch('/api/me').set('Cookie', cookie).send({ email: boundary }).expect(200)
    expect((await db.select().from(appUser).where(eq(appUser.id, 'self')))[0]?.email).toBe(boundary)
    for (const email of ['', null]) {
      await request(app.getHttpServer()).patch('/api/me').set('Cookie', cookie).send({ email }).expect(200)
      expect((await view()).body).toMatchObject({ email: 'self@example.com', emailIsDefault: true })
      expect((await db.select().from(appUser).where(eq(appUser.id, 'self')))[0]?.email).toBeNull()
    }
    for (const email of ['invalid', 'a'.repeat(192)]) await request(app.getHttpServer()).patch('/api/me').set('Cookie', cookie).send({ email }).expect(400)
    expect((await db.select().from(appUser).where(eq(appUser.id, 'other')))[0]?.email).toBeNull()
  })
  it('잘못된 요청은 DB를 변경하지 않고 DB CHECK도 값을 제한한다', async () => {
    for (const input of [{ theme: 'invalid' }, { locale: 'ja' }, { id: 'other', theme: 'light' }, {}]) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', cookie).send(input).expect(400)
    }
    expect((await db.select().from(appUser).where(eq(appUser.id, 'self')))[0]).toMatchObject({ theme: 'dark', locale: 'ko' })
    for (const value of [sql`update app_user set theme = 'invalid' where id = 'self'`, sql`update app_user set locale = 'ja' where id = 'self'`]) {
      await expect(db.execute(value)).rejects.toMatchObject({ cause: { errno: 4025 } })
    }
  })
})
