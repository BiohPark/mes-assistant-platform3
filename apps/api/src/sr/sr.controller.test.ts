import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { SrService } from './sr.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })

describe('SR HTTP API', () => {
  let app: INestApplication
  const sr = {
    list: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'sr', status: 'draft' })), get: vi.fn(async () => ({ id: 'sr' })),
    draft: vi.fn(async () => ({ title: '제목', body: '본문' })), submit: vi.fn(async () => ({ id: 'sr', code: 'SR-2026-0001' })),
    title: vi.fn(async () => ({ title: '사람 제목', titleSource: 'manual' })), status: vi.fn(async () => ({ status: 'in_progress' })),
    content: vi.fn(async () => ({ title: '사람 제목', body: '본문' })),
    delete: vi.fn(async () => undefined), startTask: vi.fn(async () => ({ id: 'task' })),
    share: vi.fn(async () => ({ id: 'result' })), results: vi.fn(async () => []),
  }
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async () => ({ id: 'u', name: 'User', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false }) })
      .overrideProvider(SrService).useValue(sr).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterAll(async () => { await app?.close() })
  const auth = () => ({ Cookie: 'mes_session=x' })

  it('validates explicit scope and accepts an idempotent draft creation key', async () => {
    await request(app.getHttpServer()).get('/api/service-requests?scope=mine').set(auth()).expect(200)
    expect(sr.list).toHaveBeenLastCalledWith('u', 'mine')
    await request(app.getHttpServer()).get('/api/service-requests?scope=inbox').set(auth()).expect(200)
    expect(sr.list).toHaveBeenLastCalledWith('u', 'inbox')
    await request(app.getHttpServer()).get('/api/service-requests?scope=all').set(auth()).expect(400)
    await request(app.getHttpServer()).post('/api/service-requests').set(auth()).set('Idempotency-Key', 'first-send').expect(201)
    expect(sr.create).toHaveBeenLastCalledWith('u', 'first-send')
  })

  it('maps the actor and validates submit, status, task and result bodies', async () => {
    await request(app.getHttpServer()).post('/api/service-requests').expect(401)
    await request(app.getHttpServer()).get('/api/service-requests').set(auth()).expect(200, [])
    expect(sr.list).toHaveBeenCalledWith('u')
    await request(app.getHttpServer()).post('/api/service-requests').set(auth()).expect(201)
    expect(sr.create).toHaveBeenCalledWith('u')
    await request(app.getHttpServer()).post('/api/service-requests/sr/submit').set(auth()).send({ title: '', body: '', extra: true }).expect(400)
    await request(app.getHttpServer()).post('/api/service-requests/sr/submit').set(auth()).send({ title: '제목', titleSource: 'ai', body: '본문', attachmentIds: [] }).expect(201)
    expect(sr.submit).toHaveBeenCalledWith('u', 'sr', { title: '제목', titleSource: 'ai', body: '본문', attachmentIds: [] })
    await request(app.getHttpServer()).patch('/api/service-requests/sr/content').set(auth()).send({ title: '사람 제목', body: '본문', attachmentIds: [] }).expect(200)
    expect(sr.content).toHaveBeenCalledWith('u', 'sr', { title: '사람 제목', body: '본문', attachmentIds: [] })
    await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status: 'invalid' }).expect(400)
    await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status: 'in_progress' }).expect(200)
    expect(sr.status).toHaveBeenCalledWith('u', 'sr', 'in_progress')
    await request(app.getHttpServer()).post('/api/service-requests/sr/tasks').set(auth()).send({ assistantId: 'a' }).expect(201)
    expect(sr.startTask).toHaveBeenCalledWith('u', 'sr', { assistantId: 'a' })
    await request(app.getHttpServer()).post('/api/service-requests/sr/results').set(auth()).send({ text: '완료', fileIds: [] }).expect(201)
    expect(sr.share).toHaveBeenCalledWith('u', 'sr', { text: '완료', fileIds: [] })
  })
})
