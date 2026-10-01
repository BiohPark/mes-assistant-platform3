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
const admin = { getSettings: vi.fn(async () => ({})), settings: vi.fn(async () => ({})), createAssistant: vi.fn(async () => ({})),
  order: vi.fn(async () => undefined), codes: vi.fn(async () => []), updateAssistant: vi.fn(async () => ({})), deleteAssistant: vi.fn(async () => undefined) }
const accounts = { users: vi.fn(async () => []), role: vi.fn(async () => undefined), active: vi.fn(async () => undefined), temporaryPassword: vi.fn(async () => ({ temporaryPassword: 'secret' })), changePassword: vi.fn(async () => undefined) }

describe('관리 API 서버 권한', () => {
  let app: INestApplication
  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'so' ? { id: 'so', name: 'SO', role: '', isSystemOwner: true } : token === 'forced' ? { id: 'forced', name: '사용자', role: '', isSystemOwner: false, mustChangePassword: true } : token === 'member' ? { id: 'member', name: '사용자', role: '', isSystemOwner: false } : null })
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
  it('임시 비밀번호 상태에는 me·변경 이외 API를 차단한다', async () => {
    const forbidden = await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=forced').expect(403)
    expect(forbidden.body.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=forced').expect(200)).body.mustChangePassword).toBe(true)
    await request(app.getHttpServer()).post('/api/auth/password').set('Cookie', 'mes_session=forced').send({ currentPassword: 'password-1234', newPassword: 'password-5678' }).expect(204)
  })
})
