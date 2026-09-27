import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { HEALTH_PROBE } from '../health/health.controller.js'
import { OIDC } from './oidc.service.js'
import { SESSION_STORE, type AuthUser, type SessionStore } from './session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './users.service.js'

const config = loadConfig({ DATABASE_URL: 'postgres://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', INITIAL_SYSTEM_OWNERS: 'dev-owner' })
const rows = new Map<string, { user: AuthUser; hash: string; active: boolean }>()
const sessions: SessionStore = {
  create: vi.fn(async () => ({ token: 'local-token', expiresAt: new Date(Date.now() + 3600_000) })),
  resolve: vi.fn(async () => null),
  destroy: vi.fn(async () => undefined),
}
const users: UserDirectory = {
  upsertFromClaims: vi.fn(async () => { throw new Error('OIDC called') }),
  createLocal: vi.fn(async (id, hash) => {
    if (rows.has(id)) return null
    const user = { id: `u-${id}`, name: id, role: '', isSystemOwner: config.initialSystemOwners.includes(id) }
    rows.set(id, { user, hash, active: true })
    return user
  }),
  findByLoginId: vi.fn(async (id) => rows.get(id) ?? null),
  grantSystemOwner: vi.fn(async (id) => {
    const row = rows.get(id)!
    row.user.isSystemOwner = true
    return row.user
  }),
}

describe('local 인증 API', () => {
  let app: INestApplication
  beforeEach(async () => {
    rows.clear()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(USER_DIRECTORY).useValue(users)
      .overrideProvider(OIDC).useValue({ start: vi.fn(), finish: vi.fn() })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('모드 공개, OIDC 진입은 404', async () => {
    await request(app.getHttpServer()).get('/api/auth/mode').expect(200, { mode: 'local' })
    await request(app.getHttpServer()).get('/api/auth/login').expect(404)
    await request(app.getHttpServer()).get('/api/auth/callback').expect(404)
  })

  it('회원가입은 세션 쿠키와 Me를 돌려주고 중복은 409', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    expect(res.body).toEqual({ id: 'u-member-1', name: 'member-1', role: '', roles: ['member'] })
    expect(String(res.headers['set-cookie'])).toMatch(/mes_session=local-token.*HttpOnly/)
    expect(rows.get('member-1')?.hash).toMatch(/^scrypt\$/)
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(409)
  })

  it('입력 규칙 위반은 400', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'UPPER', password: 'password-1234' }).expect(400)
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'abc', password: 'short' }).expect(400)
  })

  it('로그인은 올바른 자격만 허용하며 SO를 부여한다', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(201)
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(200)
    expect(login.body.roles).toEqual(['member', 'system_owner'])
    expect(String(login.headers['set-cookie'])).toContain('mes_session=')
    const missing = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'missing', password: 'password-1234' }).expect(401)
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'wrong-password' }).expect(401)
    expect(wrong.body.message).toBe(missing.body.message)
    rows.get('dev-owner')!.active = false
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(401)
  })
})
