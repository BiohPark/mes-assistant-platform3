import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { HEALTH_PROBE } from '../health/health.controller.js'
import { AuthController } from './auth.controller.js'
import { OIDC } from './oidc.service.js'
import * as passwordService from './password.js'
import { SESSION_STORE, type AuthUser, type SessionStore } from './session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './users.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', INITIAL_SYSTEM_OWNERS: 'dev-owner' })
const rows = new Map<string, { user: AuthUser; hash: string; active: boolean }>()
const sessions: SessionStore = {
  create: vi.fn(async () => ({ token: 'local-token', expiresAt: new Date(Date.now() + 3600_000) })),
  resolve: vi.fn(async () => null),
  destroy: vi.fn(async () => undefined),
}
const users: UserDirectory = {
  upsertFromClaims: vi.fn(async () => { throw new Error('OIDC called') }),
  createLocal: vi.fn(async (id, hash, name) => {
    if (rows.has(id)) return null
    const user = { id: `u-${id}`, name: name ?? id, role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: config.initialSystemOwners.includes(id) && ![...rows.values()].some((row) => row.user.isSystemOwner) }
    rows.set(id, { user, hash, active: true })
    return user
  }),
  findByLoginId: vi.fn(async (id) => rows.get(id) ?? null),
}

describe('local 인증 API', () => {
  let app: INestApplication
  beforeEach(async () => {
    rows.clear()
    app = await createTestApp(config)
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  async function createTestApp(appConfig: typeof config) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(appConfig)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(USER_DIRECTORY).useValue(users)
      .overrideProvider(OIDC).useValue({ start: vi.fn(), finish: vi.fn() })
      .compile()
    const testApp = configureApp(moduleRef.createNestApplication(), appConfig)
    await testApp.init()
    return testApp
  }

  it('모드 공개, OIDC 진입은 404', async () => {
    await request(app.getHttpServer()).get('/api/auth/mode').expect(200, { mode: 'local' })
    await request(app.getHttpServer()).get('/api/auth/login').expect(404)
    await request(app.getHttpServer()).get('/api/auth/callback').expect(404)
  })

  it('회원가입은 세션 쿠키와 Me를 돌려주고 중복은 409', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    expect(res.body).toEqual({ id: 'u-member-1', name: 'member-1', role: '', roles: ['member'], theme: 'system', locale: 'ko' })
    expect(String(res.headers['set-cookie'])).toMatch(/mes_session=local-token.*HttpOnly/)
    expect(rows.get('member-1')?.hash).toMatch(/^scrypt\$/)
    const hash = vi.spyOn(passwordService, 'hashPassword')
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(409)
    expect(hash).not.toHaveBeenCalled()
    hash.mockRestore()
  })

  it('회원가입 이름을 저장하고 공백·길이 오류는 거부한다', async () => {
    const body = { loginId: 'named-member', password: 'password-1234', name: '홍 길동' }
    const result = await request(app.getHttpServer()).post('/api/auth/signup').send(body).expect(201)
    expect(result.body.name).toBe('홍 길동')
    expect(users.createLocal).toHaveBeenCalledWith('named-member', expect.any(String), '홍 길동')
    await request(app.getHttpServer()).post('/api/auth/signup').send({ ...body, loginId: 'blank-name', name: ' ' }).expect(400)
    await request(app.getHttpServer()).post('/api/auth/signup').send({ ...body, loginId: 'long-name', name: '가'.repeat(41) }).expect(400)
  })

  it('SO 부트스트랩은 첫 가입에만 적용한다', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    expect(rows.get('member-1')?.user.isSystemOwner).toBe(false)
    const first = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(201)
    expect(first.body.roles).toEqual(['member', 'system_owner'])
    rows.get('dev-owner')!.user.isSystemOwner = false
    rows.set('existing-so', { user: { id: 'u-existing-so', name: 'existing-so', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: true }, hash: '', active: true })
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(200)
    expect(login.body.roles).toEqual(['member'])
    expect(rows.get('dev-owner')?.user.isSystemOwner).toBe(false)
  })

  it('이미 SO가 있으면 목록의 다른 ID도 member로 가입한다', async () => {
    rows.set('existing-so', { user: { id: 'u-existing-so', name: 'existing-so', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: true }, hash: '', active: true })
    const response = await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(201)
    expect(response.body.roles).toEqual(['member'])
  })

  it.each(['signup', 'login'])('%s POST는 다른 Origin과 cross-site 요청을 거부한다', async (route) => {
    const body = { loginId: 'member-1', password: 'password-1234' }
    const post = () => request(app.getHttpServer()).post(`/api/auth/${route}`)
    if (route === 'login') await post().send(body).expect(401)
    const denied = await post().set('Origin', 'https://foreign.example').send(body).expect(403)
    expect(denied.body.message).toBe('허용되지 않은 출처입니다')
    await post().set('Origin', config.appOrigin).set('Sec-Fetch-Site', 'cross-site').send(body).expect(403)
    if (route === 'login') {
      await request(app.getHttpServer()).post('/api/auth/signup').send(body).expect(201)
      await post().set('Origin', config.appOrigin).send(body).expect(200)
      await post().send(body).expect(200)
    } else {
      await post().set('Origin', config.appOrigin).send(body).expect(201)
      await post().send({ ...body, loginId: 'member-2' }).expect(201)
    }
  })

  it('입력 규칙 위반은 400', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'UPPER', password: 'password-1234' }).expect(400)
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'abc', password: 'short' }).expect(400)
  })

  it('로그인은 올바른 자격만 허용하며 기존 SO를 유지한다', async () => {
    await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(201)
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(200)
    expect(login.body.roles).toEqual(['member', 'system_owner'])
    expect(String(login.headers['set-cookie'])).toContain('mes_session=')
    const missing = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'missing', password: 'password-1234' }).expect(401)
    const verify = vi.spyOn(passwordService, 'verifyPassword')
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'missing', password: 'password-1234' }).expect(401)
    expect(verify).toHaveBeenCalledTimes(1)
    verify.mockRestore()
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'wrong-password' }).expect(401)
    expect(wrong.body.message).toBe(missing.body.message)
    rows.get('dev-owner')!.active = false
    const inactiveVerify = vi.spyOn(passwordService, 'verifyPassword')
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'dev-owner', password: 'password-1234' }).expect(401)
    expect(inactiveVerify).toHaveBeenCalledTimes(1)
    inactiveVerify.mockRestore()
  })

  it.each(['login', 'signup'])('%s은 IP와 ID의 열 번째 실패 다음 시도를 제한한다', async (route) => {
    const body = { loginId: route === 'login' ? 'missing' : 'member-1', password: 'password-1234' }
    if (route === 'signup') await request(app.getHttpServer()).post('/api/auth/signup').send(body).expect(201)
    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).post(`/api/auth/${route}`).send(body).expect(route === 'login' ? 401 : 409)
    await request(app.getHttpServer()).post(`/api/auth/${route}`).send(body).expect(429)
    await request(app.getHttpServer()).post(`/api/auth/${route}`).send({ ...body, loginId: 'other-id' }).expect(429)
  })

  it('서로 다른 ID로 시도해도 IP 상한을 넘지 못한다', async () => {
    for (let i = 0; i < config.authAttempts.max; i++) {
      await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: `missing-${i}`, password: 'password-1234' }).expect(401)
    }
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'another-id', password: 'password-1234' }).expect(429)
  })

  it.each(['login', 'signup'])('같은 IP의 동시 %s 성공 20건은 429가 아니다', async (route) => {
    if (route === 'login') await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    await app.listen(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    const find = vi.spyOn(users, 'findByLoginId').mockImplementation(async (id) => {
      entered++
      if (entered === 20) release()
      await gate
      return rows.get(id) ?? null
    })
    const timer = setTimeout(release, 1_000)
    try {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => request(app.getHttpServer())
        .post(`/api/auth/${route}`)
        .send({ loginId: route === 'login' ? 'member-1' : `member-${i}`, password: 'password-1234' })))
      expect(entered).toBe(20)
      expect(results.map((result) => result.status)).toEqual(Array(20).fill(route === 'login' ? 200 : 201))
    } finally { clearTimeout(timer); release(); find.mockRestore() }
  })

  it.each(['login', 'signup'])('같은 ID의 동시 %s 실패 20건은 최대 10건만 검증한다', async (route) => {
    if (route === 'signup') await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    await app.listen(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    const find = vi.spyOn(users, 'findByLoginId').mockImplementation(async (id) => {
      entered++
      if (entered === config.authAttempts.max) release()
      await gate
      return rows.get(id) ?? null
    })
    const timer = setTimeout(release, 1_000)
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => request(app.getHttpServer())
        .post(`/api/auth/${route}`).send({ loginId: 'member-1', password: 'wrong-password' })))
      expect(entered).toBe(config.authAttempts.max)
      expect(results.filter((result) => result.status === (route === 'login' ? 401 : 409))).toHaveLength(config.authAttempts.max)
      expect(results.filter((result) => result.status === 429)).toHaveLength(10)
    } finally { clearTimeout(timer); release(); find.mockRestore() }
  })

  it('서로 다른 ID의 동시 실패 20건은 기본 IP 진행 중 상한 아래에서 통과한다', async () => {
    await app.listen(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    const find = vi.spyOn(users, 'findByLoginId').mockImplementation(async () => {
      entered++
      if (entered === 20) release()
      await gate
      return null
    })
    const timer = setTimeout(release, 1_000)
    try {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => request(app.getHttpServer())
        .post('/api/auth/login').send({ loginId: `missing-${i}`, password: 'wrong-password' })))
      expect(entered).toBe(20)
      expect(results.filter((result) => result.status === 401)).toHaveLength(config.authAttempts.max)
      expect(results.filter((result) => result.status === 429)).toHaveLength(10)
    } finally { clearTimeout(timer); release(); find.mockRestore() }
  })

  it('설정한 IP 진행 중 상한은 서로 다른 ID에도 적용한다', async () => {
    await app.close()
    app = await createTestApp(loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_IP_PENDING_MAX: '3' }))
    await app.listen(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    const find = vi.spyOn(users, 'findByLoginId').mockImplementation(async () => { entered++; await gate; return null })
    const timer = setTimeout(release, 1_000)
    try {
      const active = Array.from({ length: 3 }, (_, i) => request(app.getHttpServer()).post('/api/auth/login')
        .send({ loginId: `missing-${i}`, password: 'wrong-password' }).then((result) => result))
      await vi.waitFor(() => expect(entered).toBe(3))
      await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'missing-fourth', password: 'wrong-password' }).expect(429)
      release()
      expect((await Promise.all(active)).map((result) => result.status)).toEqual([401, 401, 401])
    } finally { clearTimeout(timer); release(); find.mockRestore() }
  })

  it.each(['login', 'signup'])('%s 성공은 다른 ID의 IP 실패 기록을 지우지 않는다', async (route) => {
    if (route === 'login') await request(app.getHttpServer()).post('/api/auth/signup').send({ loginId: 'member-1', password: 'password-1234' }).expect(201)
    for (let i = 0; i < 8; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: `missing-${i}`, password: 'password-1234' }).expect(401)
    await request(app.getHttpServer()).post(`/api/auth/${route}`).send({ loginId: route === 'login' ? 'member-1' : 'new-member', password: 'password-1234' }).expect(route === 'login' ? 200 : 201)
    for (let i = 8; i < 10; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: `missing-${i}`, password: 'password-1234' }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'another-id', password: 'password-1234' }).expect(429)
  })

  it('한 프록시 홉만 신뢰하고 더 앞의 위조 X-Forwarded-For는 무시한다', async () => {
    await app.close()
    app = await createTestApp(loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', TRUST_PROXY: '1' }))
    const post = (ip: string) => request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', `${ip}, 10.0.0.1`).send({ loginId: 'missing', password: 'password-1234' })
    for (let i = 0; i < 10; i++) await post('192.0.2.1').expect(401)
    await post('192.0.2.2').expect(429)
  })

  it('기본 설정은 X-Forwarded-For를 신뢰하지 않는다', async () => {
    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', `192.0.2.${i + 1}`).send({ loginId: 'missing', password: 'password-1234' }).expect(401)
    await request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', '192.0.2.20').send({ loginId: 'missing', password: 'password-1234' }).expect(429)
  })

  it('시도 기록에 상한이 있고 요청마다 전체 기록을 순회하지 않는다', async () => {
    const controller = app.get(AuthController) as unknown as {
      attempt: (req: { ip: string }, loginId: string) => Promise<{ failed: () => void }>
      attempts: Map<string, { count: number; until: number }>
    }
    const iterator = vi.spyOn(controller.attempts, 'entries')
    for (let i = 0; i < 5_000; i++) {
      (await controller.attempt({ ip: `192.0.${Math.floor(i / 256)}.${i % 256}` }, `user-${i}`)).failed()
    }
    expect(iterator).not.toHaveBeenCalled()
    for (let i = 5_000; i < 5_100; i++) {
      (await controller.attempt({ ip: `192.0.${Math.floor(i / 256)}.${i % 256}` }, `user-${i}`)).failed()
    }
    expect(controller.attempts.size).toBeLessThanOrEqual(10_000)
    await request(app.getHttpServer()).post('/api/auth/login').send({ loginId: 'new-client', password: 'wrong-password' }).expect(401)
  })

  it('저장 상한에서 제한 중인 IP와 진행 중 예약을 보존하고 가장 오래된 일반 항목을 축출한다', async () => {
    const controller = app.get(AuthController) as unknown as {
      attempt: (req: { ip: string }, loginId: string) => Promise<{ release: () => void }>
      attempts: Map<string, { count: number; pending: number; until: number; waiters: Set<() => void> }>
    }
    const entry = (count = 0, pending = 0) => ({ count, pending, until: Date.now() + config.authAttempts.windowMs, waiters: new Set<() => void>() })
    controller.attempts.set('ip:limited', entry(config.authAttempts.max))
    const reserved = entry(0, config.authAttempts.ipPendingMax)
    controller.attempts.set('ip:reserved', reserved)
    controller.attempts.set('ip:ordinary-old', entry())
    controller.attempts.set('ip:ordinary-next', entry())
    for (let i = 0; i < 9_996; i++) controller.attempts.set(`ip:filler-${i}`, entry())

    const fresh = await controller.attempt({ ip: 'fresh' }, 'member')
    fresh.release()

    expect(controller.attempts.size).toBe(10_000)
    expect(controller.attempts.has('ip:ordinary-old')).toBe(false)
    expect(controller.attempts.has('ip:ordinary-next')).toBe(false)
    expect(controller.attempts.get('ip:reserved')).toBe(reserved)
    await expect(controller.attempt({ ip: 'limited' }, 'other')).rejects.toMatchObject({ status: 429 })
    await expect(controller.attempt({ ip: 'reserved' }, 'other')).rejects.toMatchObject({ status: 429 })
  })

  it('축출 가능한 기록이 없으면 새 키만 429로 거부하고 기존 키는 처리한다', async () => {
    const controller = app.get(AuthController) as unknown as {
      attempt: (req: { ip: string }, loginId: string) => Promise<{ release: () => void }>
      attempts: Map<string, { count: number; pending: number; until: number; waiters: Set<() => void> }>
    }
    const entry = (count: number, pending: number) => ({ count, pending, until: Date.now() + config.authAttempts.windowMs, waiters: new Set<() => void>() })
    controller.attempts.set('ip:existing', entry(0, 1))
    controller.attempts.set('id:existing:member', entry(0, 1))
    for (let i = 0; i < 9_998; i++) controller.attempts.set(`ip:limited-${i}`, entry(config.authAttempts.max, 0))

    await expect(controller.attempt({ ip: 'new-client' }, 'member')).rejects.toMatchObject({ status: 429 })
    const existing = await controller.attempt({ ip: 'existing' }, 'member')
    existing.release()
    expect(controller.attempts.size).toBe(10_000)
  })
})
