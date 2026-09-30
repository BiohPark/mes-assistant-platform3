import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApp } from '../app.factory.js'
import { AppModule } from '../app.module.js'
import { OIDC } from '../auth/oidc.service.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { USER_DIRECTORY } from '../auth/users.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { HEALTH_PROBE } from '../health/health.controller.js'
import { RequestsService } from '../requests/requests.service.js'
import { DbConversationInputsService } from './conversation-inputs.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://u:p@localhost:1/none', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })

describe('conversation inputs HTTP API', () => {
  let app: INestApplication
  const context = {
    list: vi.fn(async () => []), candidates: vi.fn(async () => [{ taskId: 's' }]), preview: vi.fn(async () => [{ id: 'm', content: '질문', role: 'user', status: 'done' }]),
    select: vi.fn(async () => ({ input: { mode: 'messages' } })), setWeight: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), refresh: vi.fn(async () => ({ input: { mode: 'full' } })),
  }
  const requests = { draftConversationSummary: vi.fn(async () => ({ text: '요약', source: 'rule' })) }
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(DbConversationInputsService).useValue(context)
      .overrideProvider(RequestsService).useValue(requests)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'member' ? { id: 'u', name: '사용자', role: '' } : null })
      .overrideProvider(OIDC).useValue({}).overrideProvider(USER_DIRECTORY).useValue({}).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })
  const auth = () => ({ Cookie: 'mes_session=member' })

  it('requires login and validates the three selection modes at the HTTP boundary', async () => {
    await request(app.getHttpServer()).get('/api/tasks/t/conversation-inputs').expect(401)
    await request(app.getHttpServer()).get('/api/tasks/t/conversation-inputs').set(auth()).expect(200, [])
    await request(app.getHttpServer()).put('/api/tasks/t/conversation-inputs/s').set(auth()).send({ mode: 'messages', messageIds: ['m'], weight: 'main' }).expect(200)
    expect(context.select).toHaveBeenCalledWith('u', 't', 's', { mode: 'messages', messageIds: ['m'], weight: 'main' })
    await request(app.getHttpServer()).put('/api/tasks/t/conversation-inputs/s').set(auth()).send({ mode: 'invalid' }).expect(400)
    await request(app.getHttpServer()).patch('/api/tasks/t/conversation-inputs/s').set(auth()).send({ weight: 'reference' }).expect(204)
    await request(app.getHttpServer()).delete('/api/tasks/t/conversation-inputs/s').set(auth()).expect(204)
    await request(app.getHttpServer()).post('/api/tasks/t/conversation-inputs/s/refresh').set(auth()).expect(201)
  })

  it('validates summary IDs before calling the sole auxiliary provider entry point', async () => {
    await request(app.getHttpServer()).post('/api/tasks/t/conversation-inputs/s/summary-draft').set(auth()).send({ messageIds: ['missing'] }).expect(400)
    expect(requests.draftConversationSummary).not.toHaveBeenCalled()
    await request(app.getHttpServer()).post('/api/tasks/t/conversation-inputs/s/summary-draft').set(auth()).send({ messageIds: ['m'] }).expect(201, { text: '요약', source: 'rule' })
    expect(requests.draftConversationSummary).toHaveBeenCalledWith('u', 't', [expect.objectContaining({ id: 'm' })])
  })
})
