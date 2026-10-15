import 'reflect-metadata'
import { ForbiddenException, HttpException, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { SrService } from './sr.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
type Hooks = { onStart: () => void; onDelta: (text: string) => void }

describe('SR HTTP API', () => {
  let app: INestApplication
  const sr = {
    list: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'sr', status: 'draft' })), get: vi.fn(async () => ({ id: 'sr' })),
    draft: vi.fn(async () => ({ title: '제목', body: '본문' })), submit: vi.fn(async () => ({ id: 'sr', code: 'SR-2026-0001' })),
    title: vi.fn(async () => ({ title: '사람 제목', titleSource: 'manual' })), status: vi.fn(async () => ({ status: 'in_progress' })),
    content: vi.fn(async () => ({ title: '사람 제목', body: '본문' })), refine: vi.fn<(actor: string, id: string, input: unknown, options: Hooks) => Promise<unknown>>(async () => ({ title: '다듬은 제목', body: '다듬은 본문' })),
    compose: vi.fn<(actor: string, id: string, options: Hooks) => Promise<unknown>>(async () => ({ title: '자동작성 제목', body: '자동작성 본문', suggestions: [], source: 'ai' })),
    delete: vi.fn(async () => undefined), startTask: vi.fn(async () => ({ id: 'task' })),
    share: vi.fn(async () => ({ id: 'result' })), results: vi.fn(async () => []),
  }
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async () => ({ id: 'u', name: 'User', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false }) })
      .overrideProvider(SrService).useValue(sr).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
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
    for (const status of ['submitted', 'reviewing', 'responded']) await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status }).expect(400)
    await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status: 'in_progress' }).expect(200)
    expect(sr.status).toHaveBeenCalledWith('u', 'sr', 'in_progress', undefined)
    await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status: 'rejected', reason: 'x'.repeat(501) }).expect(400)
    await request(app.getHttpServer()).patch('/api/service-requests/sr/status').set(auth()).send({ status: 'rejected', reason: '범위 밖 요청' }).expect(200)
    expect(sr.status).toHaveBeenCalledWith('u', 'sr', 'rejected', '범위 밖 요청')
    await request(app.getHttpServer()).post('/api/service-requests/sr/refine').set(auth()).send({ title: '제목' }).expect(400)
    await request(app.getHttpServer()).post('/api/service-requests/sr/refine').set(auth()).send({ title: '제목', body: '본문' }).expect(201, { title: '다듬은 제목', body: '다듬은 본문' })
    expect(sr.refine).toHaveBeenCalledWith('u', 'sr', { title: '제목', body: '본문' }, {})
    await request(app.getHttpServer()).post('/api/service-requests/sr/compose').set(auth()).expect(201, { title: '자동작성 제목', body: '자동작성 본문', suggestions: [], source: 'ai' })
    expect(sr.compose).toHaveBeenCalledWith('u', 'sr', {})
    await request(app.getHttpServer()).post('/api/service-requests/sr/tasks').set(auth()).send({ assistantId: 'a' }).expect(201)
    expect(sr.startTask).toHaveBeenCalledWith('u', 'sr', { assistantId: 'a' })
    await request(app.getHttpServer()).post('/api/service-requests/sr/results').set(auth()).send({ text: '완료', fileIds: [] }).expect(201)
    expect(sr.share).toHaveBeenCalledWith('u', 'sr', { text: '완료', fileIds: [] })
  })

  it('streams compose and refine progress as SSE and keeps access failures as JSON errors before headers', async () => {
    const proposal = { title: '자동작성 제목', body: '자동작성 본문', suggestions: ['희망 기한'], source: 'ai' }
    sr.compose.mockImplementationOnce(async (_actor, _id, options) => { options.onStart(); options.onDelta('제목: 자동'); options.onDelta('작성 제목'); return proposal })
    const streamed = await request(app.getHttpServer()).post('/api/service-requests/sr/compose').set(auth()).set('Accept', 'text/event-stream').expect(201)
    expect(streamed.headers['content-type']).toContain('text/event-stream')
    expect(streamed.text).toContain('event: started')
    expect(streamed.text).toContain(`event: delta\ndata: ${JSON.stringify({ text: '제목: 자동' })}`)
    expect(streamed.text).toContain(`event: completed\ndata: ${JSON.stringify(proposal)}`)
    sr.refine.mockImplementationOnce(async (_actor, _id, _input, options) => { options.onStart(); throw new HttpException('접수 대화가 요청 크기 한도를 넘습니다', 413) })
    const failed = await request(app.getHttpServer()).post('/api/service-requests/sr/refine').set(auth()).set('Accept', 'text/event-stream').send({ title: '제목', body: '본문' }).expect(201)
    expect(failed.text).toContain('event: failed')
    expect(failed.text).toContain('한도를 넘습니다')
    expect(failed.text).not.toContain('event: completed')
    sr.compose.mockRejectedValueOnce(new ForbiddenException('요청자 또는 SO만 AI 제안을 받을 수 있습니다'))
    await request(app.getHttpServer()).post('/api/service-requests/sr/compose').set(auth()).set('Accept', 'text/event-stream').expect(403)
    sr.compose.mockRejectedValueOnce(new HttpException('보조 요청이 이미 진행 중입니다', 429))
    await request(app.getHttpServer()).post('/api/service-requests/sr/compose').set(auth()).set('Accept', 'text/event-stream').expect(429)
    await request(app.getHttpServer()).post('/api/service-requests/sr/compose').set('Accept', 'text/event-stream').expect(401)
  })
})
