import 'reflect-metadata'
import { ConflictException, ForbiddenException, type INestApplication } from '@nestjs/common'
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
import { TaskExtrasService } from './task-extras.service.js'
import { TaskBriefService } from './task-brief.service.js'
import { SrInputsService } from './sr-inputs.service.js'
import { DbTasksService } from './tasks.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://u:p@localhost:1/none', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })

describe('tasks HTTP API', () => {
  let app: INestApplication
  const service = {
    create: vi.fn(async () => ({ task: { id: 't', code: 'WK-2026-0001', threadId: 'h' }, thread: { id: 'h', taskId: 't' } })),
    listPage: vi.fn(async () => ({ items: [{ id: 'summary' }], nextCursor: 'next' })), board: vi.fn(async () => ({ columns: [] })),
    get: vi.fn(async () => ({ id: 't' })), list: vi.fn(async () => []), update: vi.fn(async () => ({ id: 't' })),
    setStatus: vi.fn(async () => ({ id: 't' })), addTag: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined), suggestions: vi.fn(async () => []), activity: vi.fn(async () => []),
    messages: vi.fn(async () => []), appendMessage: vi.fn(async () => ({ id: 'm', kind: 'discussion' })),
  }
  const srInputs = { list: vi.fn(async () => [{ srId: 'sr', selected: true, used: false }]), select: vi.fn(), remove: vi.fn() }
  const extras = { review: vi.fn() }
  const brief = { get: vi.fn(async () => ({ stats: { questions: 0, participants: [], startedAt: '2026-10-15T00:00:00.000Z' }, generating: false, failed: false, stale: false })) }
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(DbTasksService).useValue(service)
      .overrideProvider(TaskExtrasService).useValue(extras)
      .overrideProvider(SrInputsService).useValue(srInputs)
      .overrideProvider(TaskBriefService).useValue(brief)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'member' ? { id: 'u', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false } : null })
      .overrideProvider(OIDC).useValue({}).overrideProvider(USER_DIRECTORY).useValue({}).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })
  const auth = () => ({ Cookie: 'mes_session=member' })

  it('keeps legacy arrays and exposes paging via a header with strict query validation', async () => {
    const legacy = await request(app.getHttpServer()).get('/api/tasks').set(auth()).expect(200)
    expect(legacy.body).toEqual([])
    const page = await request(app.getHttpServer()).get('/api/tasks?limit=2&view=summary&q=hello&ai=failed&activeWithinDays=30&mine=true').set(auth()).expect(200)
    expect(page.body).toEqual([{ id: 'summary' }])
    expect(page.headers['x-next-cursor']).toBe('next')
    expect(service.listPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, view: 'summary', q: 'hello', ai: ['failed'], activeWithinDays: 30, mine: 'u' }), 'u')
    for (const query of ['limit=0', 'limit=201', 'limit=1.5', 'cursor=broken', 'activeWithinDays=-1', 'view=detail', 'ai=wat', 'status=wat', 'mine=wat', 'limit[]=2']) {
      await request(app.getHttpServer()).get(`/api/tasks?${query}`).set(auth()).expect(400)
    }
    await request(app.getHttpServer()).get('/api/tasks/board').expect(401)
    expect((await request(app.getHttpServer()).get('/api/tasks/board?limit=2&status=in_progress').set(auth()).expect(200)).body).toEqual({ columns: [] })
    expect(service.board).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, status: ['in_progress'] }), 'u')
  })

  it('authenticates SR input routes and maps list/select/remove to the task and SR IDs', async () => {
    await request(app.getHttpServer()).get('/api/tasks/t/sr-inputs').expect(401)
    await request(app.getHttpServer()).put('/api/tasks/t/sr-inputs/sr').expect(401)
    await request(app.getHttpServer()).delete('/api/tasks/t/sr-inputs/sr').expect(401)
    const listed = await request(app.getHttpServer()).get('/api/tasks/t/sr-inputs').set(auth()).expect(200)
    expect(listed.body).toEqual([{ srId: 'sr', selected: true, used: false }])
    expect(srInputs.list).toHaveBeenCalledWith('u', 't')
    await request(app.getHttpServer()).put('/api/tasks/t/sr-inputs/sr').set(auth()).expect(204)
    expect(srInputs.select).toHaveBeenCalledWith('u', 't', 'sr')
    await request(app.getHttpServer()).delete('/api/tasks/t/sr-inputs/sr').set(auth()).expect(204)
    expect(srInputs.remove).toHaveBeenCalledWith('u', 't', 'sr')
    srInputs.select.mockRejectedValueOnce(new ConflictException({ code: 'TASK_DONE' }))
    await request(app.getHttpServer()).put('/api/tasks/t/sr-inputs/sr').set(auth()).expect(409)
  })

  it('serves the display-only brief for the signed-in reader', async () => {
    const response = await request(app.getHttpServer()).get('/api/tasks/t/brief').set(auth()).expect(200)
    expect(response.body).toMatchObject({ stats: { questions: 0 }, generating: false })
    expect(brief.get).toHaveBeenCalledWith('u', 't')
    await request(app.getHttpServer()).get('/api/tasks/t/brief').expect(401)
  })

  it('streams review items and sends completed only after the saved result returns', async () => {
    const item = { itemId: 'c1', met: true, note: '확인됨' }
    const result = { by: 'u', at: '2026-01-01T00:00:00Z', met: 1, total: 1, source: 'ai', items: [item] }
    extras.review.mockImplementationOnce(async (_actor, _id, options) => {
      options.onStart()
      options.onItem(item)
      return result
    })
    const response = await request(app.getHttpServer()).post('/api/tasks/t/checklist/review').set(auth()).set('Accept', 'text/event-stream').expect(201)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.text).toContain('event: item')
    expect(response.text).toContain(JSON.stringify(item))
    expect(response.text).toContain(`event: completed\ndata: ${JSON.stringify(result)}`)
    expect(extras.review.mock.calls[0]?.slice(0, 2)).toEqual(['u', 't'])
  })

  it('keeps JSON review compatibility and access failures before stream headers', async () => {
    await request(app.getHttpServer()).post('/api/tasks/t/checklist/review').set('Accept', 'text/event-stream').expect(401)
    extras.review.mockRejectedValueOnce(new ForbiddenException('접근 불가'))
    await request(app.getHttpServer()).post('/api/tasks/t/checklist/review').set(auth()).set('Accept', 'text/event-stream').expect(403)
    extras.review.mockResolvedValueOnce({ source: 'rule' })
    const response = await request(app.getHttpServer()).post('/api/tasks/t/checklist/review').set(auth()).expect(201)
    expect(response.body).toEqual({ source: 'rule' })
  })

  it('reports save conflicts after streamed items without a completed event', async () => {
    extras.review.mockImplementationOnce(async (_actor, _id, options) => {
      options.onStart()
      options.onItem({ itemId: 'c1', met: true, note: '임시 판단' })
      throw new ConflictException('체크리스트가 변경되었습니다. 다시 점검하세요')
    })
    const response = await request(app.getHttpServer()).post('/api/tasks/t/checklist/review').set(auth()).set('Accept', 'text/event-stream').expect(201)
    expect(response.text).toContain('event: failed')
    expect(response.text).toContain('체크리스트가 변경되었습니다')
    expect(response.text).not.toContain('event: completed')
  })

  it('requires login, maps actor and filters, and rejects AI message kinds', async () => {
    await request(app.getHttpServer()).post('/api/tasks').send({ assistantId: 'a' }).expect(401)
    await request(app.getHttpServer()).post('/api/tasks').set(auth()).send({ assistantId: 'a', referenceTaskId: 'ref', inputFileIds: ['f'] }).expect(201)
    expect(service.create).toHaveBeenCalledWith('u', { assistantId: 'a', referenceTaskId: 'ref', inputFileIds: ['f'] })
    await request(app.getHttpServer()).post('/api/tasks').set(auth()).send({ assistantId: 'a', firstMessage: '첫 의견' }).expect(201)
    expect(service.create).toHaveBeenCalledWith('u', { assistantId: 'a', firstMessage: '첫 의견' })
    await request(app.getHttpServer()).get('/api/tasks?assistantId=a&status[]=done&tag[]=x&mine=true').set(auth()).expect(200)
    expect(service.list).toHaveBeenCalledWith({ assistantId: 'a', status: ['done'], tags: ['x'], mine: 'u' }, 'u')
    await request(app.getHttpServer()).post('/api/threads/h/messages').set(auth()).send({ content: 'AI', kind: 'prompt' }).expect(400)
    await request(app.getHttpServer()).post('/api/threads/h/messages').set(auth()).send({ content: '팀 의견', kind: 'discussion' }).expect(201)
    expect(service.appendMessage).toHaveBeenCalledWith('u', 'h', { content: '팀 의견', kind: 'discussion' })
    await request(app.getHttpServer()).post('/api/threads/h/messages').set(auth()).send({ content: '', kind: 'discussion', attachmentIds: Array.from({ length: 21 }, (_, i) => `file-${i}`) }).expect(400)
  })
})
