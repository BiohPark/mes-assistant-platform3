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
import { DbTasksService } from './tasks.service.js'

const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:1/none', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })

describe('tasks HTTP API', () => {
  let app: INestApplication
  const service = {
    create: vi.fn(async () => ({ task: { id: 't', code: 'WK-2026-0001', threadId: 'h' }, thread: { id: 'h', taskId: 't' } })),
    get: vi.fn(async () => ({ id: 't' })), list: vi.fn(async () => []), update: vi.fn(async () => ({ id: 't' })),
    setStatus: vi.fn(async () => ({ id: 't' })), addTag: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined), suggestions: vi.fn(async () => []), activity: vi.fn(async () => []),
    messages: vi.fn(async () => []), appendMessage: vi.fn(async () => ({ id: 'm', kind: 'discussion' })),
  }
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(DbTasksService).useValue(service)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'member' ? { id: 'u', name: '사용자', role: '', isSystemOwner: false } : null })
      .overrideProvider(OIDC).useValue({}).overrideProvider(USER_DIRECTORY).useValue({}).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })
  const auth = () => ({ Cookie: 'mes_session=member' })

  it('requires login, maps actor and filters, and rejects AI message kinds', async () => {
    await request(app.getHttpServer()).post('/api/tasks').send({ assistantId: 'a' }).expect(401)
    await request(app.getHttpServer()).post('/api/tasks').set(auth()).send({ assistantId: 'a', referenceTaskId: 'ref', inputFileIds: ['f'] }).expect(201)
    expect(service.create).toHaveBeenCalledWith('u', { assistantId: 'a', referenceTaskId: 'ref', inputFileIds: ['f'] })
    await request(app.getHttpServer()).get('/api/tasks?assistantId=a&status[]=done&tag[]=x&mine=true').set(auth()).expect(200)
    expect(service.list).toHaveBeenCalledWith({ assistantId: 'a', status: ['done'], tags: ['x'], mine: 'u' })
    await request(app.getHttpServer()).post('/api/threads/h/messages').set(auth()).send({ content: 'AI', kind: 'prompt' }).expect(400)
    await request(app.getHttpServer()).post('/api/threads/h/messages').set(auth()).send({ content: '팀 의견', kind: 'discussion' }).expect(201)
    expect(service.appendMessage).toHaveBeenCalledWith('u', 'h', { content: '팀 의견', kind: 'discussion' })
  })
})
