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
import { SrService } from './sr/sr.service.js'

@Controller('test')
class SoOnlyController {
  @Get('so')
  @Roles('system_owner')
  so() {
    return { ok: true }
  }
}

const config = loadConfig({
  DATABASE_URL: 'mysql://u:p@localhost:1/none',
  SESSION_SECRET: 's'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
  AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
  OIDC_CLIENT_ID: 'mes-agent-hub',
  OIDC_CLIENT_SECRET: 'secret',
})

const member: AuthUser = { id: 'u-member', name: '이담당', role: '', isSystemOwner: false }
const owner: AuthUser = { id: 'u-owner', name: '김운영', role: '', isSystemOwner: true }
const businessOwner: AuthUser = { id: 'u-bo', name: '요청자', role: '', isSystemOwner: false, isBusinessOwner: true }
const dualOwner: AuthUser = { ...businessOwner, id: 'u-dual', isSystemOwner: true }

describe('api 골격', () => {
  let app: INestApplication
  let dbUp = true
  const sessions: SessionStore = {
    create: vi.fn(async () => ({ token: 'new-token', expiresAt: new Date(Date.now() + 3600_000) })),
    resolve: vi.fn(async (token: string) => (token === 'member' ? member : token === 'owner' ? owner : token === 'bo' ? businessOwner : token === 'dual' ? dualOwner : null)),
    destroy: vi.fn(async () => undefined),
  }
  const oidc: OidcPort = {
    start: vi.fn(async () => ({ url: 'http://idp.test/auth?state=st', pending: { state: 'st', nonce: 'n', codeVerifier: 'v' } })),
    finish: vi.fn(async () => ({ sub: 'kc-1', preferred_username: 'dev-member', name: '이담당' })),
  }
  const users: UserDirectory = {
    upsertFromClaims: vi.fn(async () => member),
    createLocal: vi.fn(async () => null),
    findByLoginId: vi.fn(async () => null),
  }

  beforeEach(async () => {
    dbUp = true
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [SoOnlyController] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(HEALTH_PROBE).useValue(async () => dbUp)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(OIDC).useValue(oidc)
      .overrideProvider(USER_DIRECTORY).useValue(users)
      .overrideProvider(SrService).useValue({
        intakeAssistant: async () => ({ srIntakeAssistantId: 'intake-1' }),
        list: async () => [], create: async () => ({ id: 'sr-1', threadId: 'thread-1' }),
      })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  it('GET /api/health — 로그인 없이, DB 상태 포함', async () => {
    const healthy = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(healthy.body).toEqual({ status: 'ok', db: 'up', version: expect.any(String), commit: expect.any(String) })
    dbUp = false
    const degraded = await request(app.getHttpServer()).get('/api/health').expect(503)
    expect(degraded.body).toEqual({ status: 'degraded', db: 'down', version: expect.any(String), commit: expect.any(String) })
  })

  it('GET /api/me — 세션 없으면 401', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401)
    await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=unknown').expect(401)
  })

  it('GET /api/me — 세션 사용자와 역할', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=owner').expect(200)
    expect(MeSchema.parse(res.body)).toEqual({ id: 'u-owner', name: '김운영', role: '', roles: ['member', 'system_owner'] })
  })

  it('mock 모드 모델 목록은 예시 모델을 서버에서 반환한다', async () => {
    const res = await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=member').expect(200)
    expect(res.body.models).toContain('glm-5.2')
  })

  it('역할 가드 — SO 전용 경로는 담당자에게 403', async () => {
    await request(app.getHttpServer()).get('/api/test/so').set('Cookie', 'mes_session=member').expect(403)
    await request(app.getHttpServer()).get('/api/test/so').set('Cookie', 'mes_session=owner').expect(200)
  })

  it('진단 API는 SO에게만 제공하고 세션 비밀을 노출하지 않는다', async () => {
    await request(app.getHttpServer()).get('/api/admin/diagnostics').expect(401)
    await request(app.getHttpServer()).get('/api/admin/diagnostics').set('Cookie', 'mes_session=member').expect(403)
    const res = await request(app.getHttpServer()).get('/api/admin/diagnostics').set('Cookie', 'mes_session=owner').expect(200)
    expect(res.body.app).toMatchObject({ version: expect.any(String), commit: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toContain(config.sessionSecret)
  })

  it('BO는 허브·업무·리포트 등 SR 밖 API를 403으로 거부하고 SO 겸임은 허용한다', async () => {
    for (const [method, path] of [
      ['get', '/api/assistants'], ['get', '/api/assistants/stats'], ['get', '/api/catalog/users'],
      ['get', '/api/codes'], ['get', '/api/settings'], ['get', '/api/tasks'],
      ['post', '/api/tasks'], ['get', '/api/tasks/task-id'], ['get', '/api/reports'],
      ['get', '/api/tags/suggest'], ['get', '/api/notifications'], ['get', '/api/llm/models'],
      ['get', '/api/events'], ['get', '/api/test/so'],
    ] as const) {
      await request(app.getHttpServer())[method](path).set('Cookie', 'mes_session=bo').expect(403)
    }
    await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=dual').expect(200)
    await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=bo').expect(200)
    await request(app.getHttpServer()).get('/api/service-requests/intake-assistant').set('Cookie', 'mes_session=bo').expect(200, { srIntakeAssistantId: 'intake-1' })
    await request(app.getHttpServer()).get('/api/service-requests').set('Cookie', 'mes_session=bo').expect(200, [])
    await request(app.getHttpServer()).post('/api/service-requests').set('Cookie', 'mes_session=bo').expect(201, { id: 'sr-1', threadId: 'thread-1' })
    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', 'mes_session=bo').expect(204)
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
