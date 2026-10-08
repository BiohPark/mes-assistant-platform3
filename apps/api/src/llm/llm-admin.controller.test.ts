import 'reflect-metadata'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { LimitedFetchError, MockProvider, OpenAICompatibleProvider, type ChatProvider, type ChatRequest } from '@mes/llm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB } from '../db/db.module.js'
import { LLM_PROVIDER } from './provider.token.js'
import { toLlmSettings } from './presets.js'

const env = { DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', REQUEST_BUDGET_BYTES: '4096', REQUEST_MAX_ACTIVE: '2',
  LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101', LLM_API_KEY: 'top-secret', LLM_DEFAULT_MODEL: 'fake-general' }
const config = loadConfig(env)
const user = (id: string, isSystemOwner: boolean) => ({ id, name: id, role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner })
const sessions: SessionStore = {
  create: vi.fn(async () => ({ token: '', expiresAt: new Date() })),
  resolve: vi.fn(async (token: string) => token === 'owner' ? user('o1', true) : token === 'owner2' ? user('o2', true) : token === 'member' ? user('m', false) : null),
  destroy: vi.fn(async () => undefined),
}
/** 읽기는 진행 중 chat_request 수만 돌려주고, 쓰기는 전부 실패시킨다 — 시험 API는 DB에 행을 쓰지 않는다 */
let activeRows = 0
const writes = vi.fn(() => { throw new Error('시험 API는 DB에 쓰지 않는다') })
const db = { select: () => ({ from: () => ({ where: async () => [{ count: activeRows }] }) }), insert: writes, update: writes, delete: writes, transaction: writes }

const TEST = '/api/admin/llm/test'
const CONNECTION = '/api/admin/llm/test-connection'
const userMessage = (content = '안녕') => ({ messages: [{ role: 'user', content }] })

describe('LLM admin test API', () => {
  let app: INestApplication
  let provider: ChatProvider
  async function boot(custom: ChatProvider) {
    provider = custom
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(DB).useValue(db)
      .overrideProvider(LLM_PROVIDER).useValue({ kind: 'live', ping: () => provider.ping(), listModels: () => provider.listModels(), stream: (req: ChatRequest) => provider.stream(req) })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  }
  beforeEach(async () => { activeRows = 0; await boot(new MockProvider()) })
  afterEach(async () => { await app.close(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('SO만 호출할 수 있다 (401·403)', async () => {
    await request(app.getHttpServer()).post(TEST).send(userMessage()).expect(401)
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=member').send(userMessage()).expect(403)
    await request(app.getHttpServer()).post(CONNECTION).set('Cookie', 'mes_session=member').send({}).expect(403)
    expect(writes).not.toHaveBeenCalled()
  })

  it.each([
    ['빈 목록', { messages: [] }],
    ['마지막이 assistant', { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }],
    ['system 역할', { messages: [{ role: 'system', content: 'a' }] }],
    ['알 수 없는 필드', { messages: [{ role: 'user', content: 'a' }], tools: [] }],
    ['21개', { messages: Array.from({ length: 21 }, (_, i) => ({ role: i === 20 ? 'user' : 'assistant', content: 'x' })) }],
    ['빈 모델', { model: '  ', messages: [{ role: 'user', content: 'a' }] }],
    ['제어 문자 모델', { model: 'm\u0000', messages: [{ role: 'user', content: 'a' }] }],
  ])('형식 오류는 400 — %s', async (_name, body) => {
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(body).expect(400)
  })

  it('요청 바이트가 한도를 넘으면 413', async () => {
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage('x'.repeat(config.request.budgetBytes))).expect(413)
  })

  it('mock은 결정적이고 응답은 text·model·ms만 담는다', async () => {
    const first = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(200)
    const second = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(200)
    expect(Object.keys(first.body).sort()).toEqual(['model', 'ms', 'text'])
    expect(first.body.text).toBeTruthy()
    expect(first.body.text).toBe(second.body.text)
    expect(first.body.model).toBe('fake-general')
    const custom = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send({ model: 'fake-writer', ...userMessage() }).expect(200)
    expect(custom.body.model).toBe('fake-writer')
    expect(writes).not.toHaveBeenCalled()
  })

  it('test-connection은 목록·응답 두 결과를 돌려주고 키를 노출하지 않는다', async () => {
    const res = await request(app.getHttpServer()).post(CONNECTION).set('Cookie', 'mes_session=owner').send({}).expect(200)
    expect(res.body).toEqual({ models: { ok: true, count: expect.any(Number), ms: expect.any(Number) }, completion: { ok: true, ms: expect.any(Number), model: 'fake-general' } })
    await app.close()
    await boot({ kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => { throw new Error('Authorization: Bearer top-secret') },
      async *stream() { yield { type: 'error', message: 'LLM 서비스 오류 (HTTP 500) top-secret' } } })
    const failed = await request(app.getHttpServer()).post(CONNECTION).set('Cookie', 'mes_session=owner').send({}).expect(200)
    expect(failed.body.models).toEqual({ ok: false, count: 0, ms: expect.any(Number), error: expect.any(String) })
    expect(failed.body.completion).toEqual({ ok: false, ms: expect.any(Number), model: 'fake-general', error: expect.any(String) })
    expect(JSON.stringify(failed.body)).not.toMatch(/top-secret|Authorization|Bearer/)
    expect(writes).not.toHaveBeenCalled()
  })

  it('전역 상한은 DB 진행 중 요청과 메모리 슬롯을 합산한다 — 포화 시 429, 다른 SO는 여유가 있으면 동시에 통과', async () => {
    activeRows = 2
    const saturated = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(429)
    expect(saturated.body.message).toMatch(/잠시 후/)
    await request(app.getHttpServer()).post(CONNECTION).set('Cookie', 'mes_session=owner').send({}).expect(429)
    activeRows = 0
    await app.close()
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let running = 0
    await boot({ kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream() { running++; await held; yield { type: 'delta', text: '응답' }; yield { type: 'done' } } })
    const first = request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).then((r) => r)
    const second = request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner2').send(userMessage()).then((r) => r)
    await vi.waitFor(() => expect(running).toBe(2))
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(429)
    release()
    const [a, b] = await Promise.all([first, second])
    expect([a.status, b.status]).toEqual([200, 200])
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(200)
  })

  it('같은 SO의 동시 시험은 보조 요청 단일 진행 규칙으로 429', async () => {
    await app.close()
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let running = 0
    await boot({ kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream() { running++; await held; yield { type: 'done' } } })
    const first = request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).then((r) => r)
    await vi.waitFor(() => expect(running).toBe(1))
    await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(429)
    release()
    expect((await first).status).toBe(200)
  })

  it('클라이언트가 연결을 끊으면 모델 호출을 중단하고 슬롯을 돌려준다', async () => {
    await app.close()
    let seen: AbortSignal | undefined
    let started!: () => void
    const begun = new Promise<void>((resolve) => { started = resolve })
    await boot({ kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) {
      if (seen) { yield { type: 'delta', text: '응답' }; yield { type: 'done' }; return }
      seen = req.signal; started()
      await new Promise<void>((resolve) => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
      yield { type: 'error', message: '요청이 취소되었습니다.' }
    } })
    const server = app.getHttpServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo
    const body = JSON.stringify(userMessage())
    const req = httpRequest({ port, path: TEST, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), cookie: 'mes_session=owner' } })
    req.on('error', () => undefined)
    req.end(body)
    await begun
    req.destroy()
    await vi.waitFor(() => expect(seen?.aborted).toBe(true))
    activeRows = 1 // 슬롯이 돌아오지 않았다면 1 + 1 ≥ maxActive(2)로 429가 난다
    await request(server).post(TEST).set('Cookie', 'mes_session=owner2').send(userMessage()).expect(200)
    expect(writes).not.toHaveBeenCalled()
  })

  describe('실제 provider + 가짜 fetch', () => {
    beforeEach(async () => { await app.close(); await boot(new OpenAICompatibleProvider(toLlmSettings(config.llm))) })
    const sse = (text: string) => new Response(`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\ndata: [DONE]\n\n`, { status: 200 })

    it('시간 초과는 504 TIMEOUT', async () => {
      // limitedFetch의 타이머는 자체 단위 테스트가 검증한다 — 여기서는 본문 읽기가 timeout으로 끝났을 때의 HTTP 매핑만 본다
      const timeoutBody = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new LimitedFetchError('timeout')) } })
      vi.stubGlobal('fetch', vi.fn(async () => new Response(timeoutBody, { status: 200 })))
      const res = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(504)
      expect(res.body.code).toBe('TIMEOUT')
      expect(JSON.stringify(res.body)).not.toMatch(/top-secret|localhost:3101/)
    })
    it('응답 상한 초과는 절단 없이 502 RESPONSE_TOO_LARGE', async () => {
      const huge = `data: {"choices":[{"delta":{"content":"${'x'.repeat(70 * 1024)}"}}]}\n\n`
      vi.stubGlobal('fetch', vi.fn(async () => new Response(huge, { status: 200 })))
      const res = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(502)
      expect(res.body.code).toBe('RESPONSE_TOO_LARGE')
      expect(JSON.stringify(res.body)).not.toContain('xxxx')
    })
    it('리다이렉트는 차단하고 location·키를 노출하지 않는다', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/top-secret' } })))
      const res = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(502)
      expect(res.body.code).toBe('PROVIDER_ERROR')
      expect(JSON.stringify(res.body)).not.toMatch(/evil|top-secret|302/)
      const connection = await request(app.getHttpServer()).post(CONNECTION).set('Cookie', 'mes_session=owner').send({}).expect(200)
      expect(connection.body.models.ok).toBe(false)
      expect(connection.body.completion.ok).toBe(false)
      expect(JSON.stringify(connection.body)).not.toMatch(/evil|top-secret|302/)
    })
    it('상위 404는 MODEL_NOT_FOUND, 500은 PROVIDER_ERROR — 본문·키 비노출', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Model not found top-secret"}', { status: 404 })))
      const missing = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send({ model: 'nope', ...userMessage() }).expect(502)
      expect(missing.body.code).toBe('MODEL_NOT_FOUND')
      vi.stubGlobal('fetch', vi.fn(async () => new Response('top-secret', { status: 500 })))
      const failed = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send(userMessage()).expect(502)
      expect(failed.body.code).toBe('PROVIDER_ERROR')
      expect(JSON.stringify([missing.body, failed.body])).not.toMatch(/top-secret|Authorization|Bearer/)
    })
    it('정상 응답은 키 없이 text·model·ms를 돌려주고 요청에 stream·model이 실린다', async () => {
      const fetchMock = vi.fn(async () => sse('가짜 응답'))
      vi.stubGlobal('fetch', fetchMock)
      const res = await request(app.getHttpServer()).post(TEST).set('Cookie', 'mes_session=owner').send({ model: 'fake-writer', ...userMessage('테스트') }).expect(200)
      expect(res.body).toEqual({ text: '가짜 응답', model: 'fake-writer', ms: expect.any(Number) })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toEqual({ model: 'fake-writer', messages: [{ role: 'user', content: '테스트' }], stream: true })
      expect(init.redirect).toBe('manual')
      expect(JSON.stringify(res.body)).not.toContain('top-secret')
    })
  })
})
