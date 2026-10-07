import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { AdminService } from './admin.service.js'
import { AccountsService } from './accounts.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
const admin = { getSettings: vi.fn(async () => ({})), settings: vi.fn(async () => ({})), createAssistant: vi.fn(async () => ({ id: 'new-agent' })),
  order: vi.fn(async () => undefined), codes: vi.fn(async () => []), updateAssistant: vi.fn(async () => ({})), deleteAssistant: vi.fn(async () => undefined) }
const accounts = { profile: vi.fn(async (_id: string, input: unknown) => input), users: vi.fn(async () => []), role: vi.fn(async () => undefined), active: vi.fn(async () => undefined), name: vi.fn(async (_id: string, name: string) => ({ name })), temporaryPassword: vi.fn(async () => ({ temporaryPassword: 'secret' })), changePassword: vi.fn(async () => undefined) }

describe('관리 API 서버 권한', () => {
  let app: INestApplication
  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'so' ? { id: 'so', name: 'SO', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: true } : token === 'forced' ? { id: 'forced', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false, mustChangePassword: true } : token === 'member' ? { id: 'member', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false } : null })
      .overrideProvider(AdminService).useValue(admin)
      .overrideProvider(DbCatalogReader).useValue({ assistants: async () => [{ id: 'new-agent', order: 1, checklistTemplate: [] }] })
      .overrideProvider(AccountsService).useValue(accounts)
      .compile()
    app = configureApp(module.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('설정 조회는 로그인 사용자, 변경과 사용자 목록은 SO만 허용한다', async () => {
    await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=member').expect(200)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=member').send({ defaultModel: 'm' }).expect(403)
    await request(app.getHttpServer()).get('/api/users').set('Cookie', 'mes_session=member').expect(403)
    await request(app.getHttpServer()).get('/api/users').set('Cookie', 'mes_session=so').expect(200)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModel: 'm' }).expect(200)
    expect(admin.settings).toHaveBeenCalledWith({ defaultModel: 'm' })
  })
  it('SO만 다른 사용자의 이름을 수정하고 본인은 내 정보를 수정한다', async () => {
    await request(app.getHttpServer()).patch('/api/users/u1').set('Cookie', 'mes_session=member').send({ name: '새 이름' }).expect(403)
    await request(app.getHttpServer()).patch('/api/users/u1').set('Cookie', 'mes_session=so').send({ name: '새 이름' }).expect(200)
    expect(accounts.name).toHaveBeenCalledWith('u1', '새 이름')
    await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send({ name: '내 이름' }).expect(200)
    expect(accounts.profile).toHaveBeenCalledWith('member', { name: '내 이름' })
    await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send({ name: ' ' }).expect(400)
  })
  it('프로필은 본인만 저장하고 SO도 타인의 테마·언어를 바꿀 수 없다', async () => {
    await request(app.getHttpServer()).patch('/api/users/me').send({ theme: 'dark' }).expect(401)
    for (const cookie of ['member', 'so']) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', `mes_session=${cookie}`).send({ theme: 'dark', locale: 'en' }).expect(200)
      expect(accounts.profile).toHaveBeenCalledWith(cookie, { theme: 'dark', locale: 'en' })
    }
    await request(app.getHttpServer()).patch('/api/users/member').set('Cookie', 'mes_session=so').send({ theme: 'light' }).expect(400)
    await request(app.getHttpServer()).patch('/api/users/member').set('Cookie', 'mes_session=so').send({ name: '이름', locale: 'en' }).expect(400)
  })
  it('빈 프로필·잘못된 값·알 수 없는 키는 저장하지 않는다', async () => {
    for (const input of [{}, { theme: 'auto' }, { locale: 'ja' }, { theme: null }, { name: ' ' }, { id: 'so', theme: 'dark' }, { name: '정상', isSystemOwner: true }]) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send(input).expect(400)
    }
    expect(accounts.profile).not.toHaveBeenCalled()
    for (const input of [{ theme: 'system' }, { theme: 'light' }, { locale: 'ko' }, { name: ' 새 이름 ', theme: 'dark', locale: 'en' }]) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send(input).expect(200)
    }
    expect(accounts.profile).toHaveBeenLastCalledWith('member', { name: '새 이름', theme: 'dark', locale: 'en' })
  })
  it('에이전트 쓰기·순서는 SO만 허용한다', async () => {
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=member').send({}).expect(403)
    await request(app.getHttpServer()).put('/api/assistants/order').set('Cookie', 'mes_session=member').send({ ids: [], revisions: {} }).expect(403)
    await request(app.getHttpServer()).put('/api/assistants/order').set('Cookie', 'mes_session=so').send({ ids: [], revisions: {} }).expect(204)
  })
  it('빈 체크리스트를 명시한 생성 요청은 빈 상태로 전달하고 카탈로그 응답을 돌려준다', async () => {
    const response = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      id: 'new-agent', name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [],
    }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ checklistTemplate: [] }))
    expect(response.body).toMatchObject({ id: 'new-agent', order: 1, checklistTemplate: [] })
  })
  it('ID를 생략한 생성은 서버가 반환한 ID의 카탈로그 응답을 사용한다', async () => {
    const response = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [],
    }).expect(201)
    expect(response.body).toMatchObject({ id: 'new-agent', order: 1, checklistTemplate: [] })
  })
  it('분류 이름과 전환 기간 ID를 받고 누락·빈 이름은 거부한다', async () => {
    const base = { name: '도우미', summary: '', ownerId: 'so', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [] }
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: '신규', level2: '신규' }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ level1: '신규', level2: '신규' }))
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: ' Cafe\u0301   TOOL ', level2: '  신규\t 분류 ' }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ level1: 'Café TOOL', level2: '신규 분류' }))
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: '신규', level2CodeId: 'legacy' }).expect(201)
    for (const fields of [{ level1: '신규' }, { level1: ' ', level2: '정상' }, { level1: 'x'.repeat(192), level2: '정상' }]) {
      await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, ...fields }).expect(400)
    }
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ level2: '수정' }).expect(200)
    expect(admin.updateAssistant).toHaveBeenCalledWith('new-agent', { level2: '수정' })
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ level2: ' ' }).expect(400)
  })
  it('명시한 빈 ID는 거부하고 기존 ID 수정은 허용하지 않는다', async () => {
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      id: '', name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [],
    }).expect(400)
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ id: 'changed' }).expect(400)
  })
  it('임시 비밀번호 상태에는 me·변경 이외 API를 차단한다', async () => {
    const forbidden = await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=forced').expect(403)
    expect(forbidden.body.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=forced').expect(200)).body.mustChangePassword).toBe(true)
    await request(app.getHttpServer()).post('/api/auth/password').set('Cookie', 'mes_session=forced').send({ currentPassword: 'password-1234', newPassword: 'password-5678' }).expect(204)
  })
})
