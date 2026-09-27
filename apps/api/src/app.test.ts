import 'reflect-metadata'
import { Controller, Get, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MeSchema } from '@mes/contracts'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from './app.module.js'
import { configureApp } from './app.factory.js'
import { Roles } from './auth/roles.decorator.js'
import { OIDC, type OidcPort } from './auth/oidc.service.js'
import { SESSION_STORE, type AuthUser, type SessionStore } from './auth/session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './auth/users.service.js'
import { CONFIG, loadConfig } from './config/config.js'
import { HEALTH_PROBE } from './health/health.controller.js'

@Controller('test')
class SoOnlyController {
  @Get('so')
  @Roles('system_owner')
  so() {
    return { ok: true }
  }
}

const config = loadConfig({
  DATABASE_URL: 'postgres://u:p@localhost:1/none',
  SESSION_SECRET: 's'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
  OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
  OIDC_CLIENT_ID: 'mes-agent-hub',
  OIDC_CLIENT_SECRET: 'secret',
})

const member: AuthUser = { id: 'u-member', name: '이담당', role: '', isSystemOwner: false }
const owner: AuthUser = { id: 'u-owner', name: '김운영', role: '', isSystemOwner: true }

describe('api 골격', () => {
  let app: INestApplication
  let dbUp = true
  const sessions: SessionStore = {
    create: vi.fn(async () => ({ token: 'new-token', expiresAt: new Date(Date.now() + 3600_000) })),
    resolve: vi.fn(async (token: string) => (token === 'member' ? member : token === 'owner' ? owner : null)),
    destroy: vi.fn(async () => undefined),
  }
  const oidc: OidcPort = {
    start: vi.fn(async () => ({ url: 'http://idp.test/auth?state=st', pending: { state: 'st', nonce: 'n', codeVerifier: 'v' } })),
    finish: vi.fn(async () => ({ sub: 'kc-1', preferred_username: 'dev-member', name: '이담당' })),
  }
  const users: UserDirectory = { upsertFromClaims: vi.fn(async () => member) }

  beforeEach(async () => {
    dbUp = true
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [SoOnlyController] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(HEALTH_PROBE).useValue(async () => dbUp)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(OIDC).useValue(oidc)
      .overrideProvider(USER_DIRECTORY).useValue(users)
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  it('GET /api/health — 로그인 없이, DB 상태 포함', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok', db: 'up' })
    dbUp = false
    await request(app.getHttpServer()).get('/api/health').expect(503, { status: 'degraded', db: 'down' })
  })

  it('GET /api/me — 세션 없으면 401', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401)
    await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=unknown').expect(401)
  })

  it('GET /api/me — 세션 사용자와 역할', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=owner').expect(200)
    expect(MeSchema.parse(res.body)).toEqual({ id: 'u-owner', name: '김운영', role: '', roles: ['member', 'system_owner'] })
  })

  it('역할 가드 — SO 전용 경로는 담당자에게 403', async () => {
    await request(app.getHttpServer()).get('/api/test/so').set('Cookie', 'mes_session=member').expect(403)
    await request(app.getHttpServer()).get('/api/test/so').set('Cookie', 'mes_session=owner').expect(200)
  })

  it('GET /api/auth/login — IdP로 보내고 검증값은 서명된 httpOnly 쿠키에', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/login').expect(302)
    expect(res.headers.location).toBe('http://idp.test/auth?state=st')
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/mes_oidc=s%3A/)
    expect(cookie).toMatch(/HttpOnly/)
  })

  it('GET /api/auth/callback — 검증 → 사용자 반영 → 세션 쿠키 → 앱으로', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent.get('/api/auth/login').expect(302)
    const res = await agent.get('/api/auth/callback?code=c&state=st').expect(302)
    expect(res.headers.location).toBe('http://localhost:5173/')
    expect(oidc.finish).toHaveBeenCalledWith(
      new URL('http://localhost:5173/api/auth/callback?code=c&state=st'),
      { state: 'st', nonce: 'n', codeVerifier: 'v' },
    )
    expect(users.upsertFromClaims).toHaveBeenCalledWith({ sub: 'kc-1', preferred_username: 'dev-member', name: '이담당' })
    expect(sessions.create).toHaveBeenCalledWith('u-member')
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/mes_session=new-token/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
  })

  it('GET /api/auth/callback — 로그인 시작 기록이 없으면 400', async () => {
    await request(app.getHttpServer()).get('/api/auth/callback?code=c&state=st').expect(400)
    expect(oidc.finish).not.toHaveBeenCalled()
  })

  it('POST /api/auth/logout — 세션 삭제 후 204', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', 'mes_session=member').expect(204)
    expect(sessions.destroy).toHaveBeenCalledWith('member')
    expect(String(res.headers['set-cookie'])).toMatch(/mes_session=;/)
  })
})
