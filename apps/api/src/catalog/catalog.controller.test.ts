import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AssistantSchema } from '@mes/contracts'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApp } from '../app.factory.js'
import { AppModule } from '../app.module.js'
import { OIDC } from '../auth/oidc.service.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { USER_DIRECTORY } from '../auth/users.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { HEALTH_PROBE } from '../health/health.controller.js'
import { CATALOG, type CatalogReader } from './catalog.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://u:p@localhost:1/none', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
const assistant = AssistantSchema.parse({ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0 })

describe('catalog read API', () => {
  let app: INestApplication
  const reader: CatalogReader = {
    assistants: vi.fn(async () => [assistant]), stats: vi.fn(async () => [{ assistantId: 'a', open: 0, inProgress: 0, onHold: 0, done: 0 }]),
    users: vi.fn(async () => [{ id: 'u', name: '사용자', initials: '사', color: '#123456', isSystemOwner: false, isBusinessOwner: false }]),
    codes: vi.fn(async () => [{ id: 'assistant_level1:SDLC', groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 0, active: true }]),
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(CATALOG).useValue(reader)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'member' ? { id: 'u', name: '사용자', role: '', isSystemOwner: false } : null })
      .overrideProvider(OIDC).useValue({})
      .overrideProvider(USER_DIRECTORY).useValue({})
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('requires login for all catalog routes', async () => {
    for (const path of ['/api/assistants', '/api/assistants/stats', '/api/users', '/api/codes?group=assistant_level1']) {
      await request(app.getHttpServer()).get(path).expect(401)
    }
  })

  it('returns mapped assistants, stats, active users and filtered codes', async () => {
    expect((await request(app.getHttpServer()).get('/api/assistants').set('Cookie', 'mes_session=member').expect(200)).body).toEqual([assistant])
    expect((await request(app.getHttpServer()).get('/api/assistants/stats').set('Cookie', 'mes_session=member').expect(200)).body[0].done).toBe(0)
    expect((await request(app.getHttpServer()).get('/api/users').set('Cookie', 'mes_session=member').expect(200)).body).toHaveLength(1)
    await request(app.getHttpServer()).get('/api/codes?group=assistant_level1').set('Cookie', 'mes_session=member').expect(200)
    expect(reader.codes).toHaveBeenCalledWith('assistant_level1')
  })
})
