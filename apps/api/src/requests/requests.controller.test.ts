import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { RequestsService } from './requests.service.js'

describe('requests HTTP', () => {
  let app: INestApplication
  const config = loadConfig({ DATABASE_URL: 'postgres://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  const sessions: SessionStore = { create: vi.fn(async () => ({ token: '', expiresAt: new Date() })), resolve: vi.fn(async () => ({ id: 'u', name: 'User', role: '', isSystemOwner: false })), destroy: vi.fn(async () => undefined) }
  const start = vi.fn(async () => ({ id: 'r', userMessageId: 'u1', replyMessageId: 'a1', done: Promise.resolve() }))
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(RequestsService).useValue({ start, subscribe: (_id: string, listener: (event: unknown) => void) => {
        listener({ event: 'started', data: { requestId: 'r', userMessageId: 'u1', replyMessageId: 'a1' } })
        listener({ event: 'completed', data: { requestInfo: {} } })
        return () => undefined
      } })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterAll(async () => { await app?.close() })

  it('accepts a recorded over-budget JSON request through the scoped parser', async () => {
    const response = await request(app.getHttpServer()).post('/api/threads/t/requests').set('Cookie', 'mes_session=x')
      .set('Idempotency-Key', 'key').send({ content: 'x'.repeat(270_000) }).expect(201)
    expect(response.headers['content-type']).toMatch(/text\/event-stream/)
    expect(response.text).toContain('event: completed')
    expect(start).toHaveBeenCalledWith('u', 't', { content: 'x'.repeat(270_000) }, 'key')
  })
})
