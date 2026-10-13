import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MockProvider, OpenAICompatibleProvider, SYSTEM_ASSISTANT_PROMPT, SYSTEM_TOOLS, type ChatProvider, type ChatRequest } from '@mes/llm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB } from '../db/db.module.js'
import { dbLock } from '../db/schema.js'
import { RequestsService } from '../requests/requests.service.js'
import { LLM_PROVIDER } from './provider.token.js'

const env = { DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }
const config = loadConfig(env)
const user = (id: string, name: string) => ({ id, name, role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false })
const sessions: SessionStore = { create: vi.fn(async () => ({ token: '', expiresAt: new Date() })), resolve: vi.fn(async (token: string) => token === 'member' ? user('m', 'Member') : token === 'other' ? user('o', 'Other') : null), destroy: vi.fn(async () => undefined) }
let settings: Array<{ value: unknown }> = []
let modelOverride: string | undefined
/** 읽기: 설정 행·진행 중 chat_request 수(0). 쓰기는 admit의 전역 용량 잠금(db_lock)만 — 도우미 호출은 chat_request 행을 만들지 않는다 */
const writes = vi.fn(() => { throw new Error('도우미 호출은 DB에 쓰지 않는다') })
const read = (condition: { queryChunks: { value?: unknown }[] }) => {
  const has = (key: string) => condition.queryChunks.some(chunk => chunk.value === key)
  return has('defaultModelOverride') ? (modelOverride ? [{ value: modelOverride }] : []) : has('requestBudgetBytes') ? settings : [{ count: 0 }]
}
const reads = { select: () => ({ from: () => ({ where: (condition: { queryChunks: { value?: unknown }[] }) => Object.assign(Promise.resolve(read(condition)), { for: async () => read(condition) }) }) }) }
const tx = { ...reads, update: writes, delete: writes, insert: (table: unknown) => { if (table !== dbLock) writes(); return { values: () => ({ onDuplicateKeyUpdate: async () => undefined }) } } }
const db = { ...reads, insert: writes, update: writes, delete: writes, transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }
/** provider가 중단 신호를 받을 때까지 멈춰 있는 호출 — 신호를 돌려준다 */
function hangingProvider() {
  let started!: (signal: AbortSignal) => void
  const signal = new Promise<AbortSignal>((resolve) => { started = resolve })
  const hanging: ChatProvider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) {
    started(req.signal!)
    await new Promise<void>((resolve) => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
    yield { type: 'done' }
  } }
  return { provider: hanging, signal }
}

describe('system assistant HTTP', () => {
  let app: INestApplication
  let provider: ChatProvider
  async function boot(bootConfig = config) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(bootConfig)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(DB).useValue(db)
      .overrideProvider(LLM_PROVIDER).useValue({ kind: 'live', ping: () => provider.ping(), listModels: () => provider.listModels(), stream: (req: ChatRequest) => provider.stream(req) })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), bootConfig)
    await app.listen(0, '127.0.0.1')
  }
  beforeEach(async () => {
    settings = []; modelOverride = undefined
    provider = new MockProvider()
    await boot()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('도우미 슬롯은 제목·요약 등 보조 슬롯과 독립이고, 같은 사용자의 두 번째 도우미 호출만 429다 (U4)', async () => {
    const hanging = hangingProvider()
    provider = hanging.provider
    const first = request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '대기' }] })
    const pending = first.then(() => undefined, () => undefined)
    const signal = await hanging.signal
    const requests = app.get(RequestsService, { strict: false })
    expect(await requests.runAuxiliary('m', 'title', async () => '제목')).toBe('제목')
    const blocked = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '둘째' }] }).expect(429)
    expect(blocked.body.message).toBe('다른 보조 요청이 진행 중입니다')
    expect(writes).not.toHaveBeenCalled()
    first.abort()
    await pending
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })

  it('도우미 호출은 전역 동시 상한에 들어가고, 클라이언트가 끊으면 슬롯을 돌려준다 (U4)', async () => {
    await app.close()
    await boot(loadConfig({ ...env, REQUEST_MAX_ACTIVE: '1' }))
    const hanging = hangingProvider()
    provider = hanging.provider
    const first = request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '대기' }] })
    const pending = first.then(() => undefined, () => undefined)
    const signal = await hanging.signal
    const requests = app.get(RequestsService, { strict: false })
    await expect(requests.admit('test')).rejects.toMatchObject({ status: 429 })
    const other = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=other').send({ messages: [{ role: 'user', content: '다른 사용자' }] }).expect(429)
    expect(other.body.message).toBe('동시 응답이 많아 잠시 후 다시 시도해 주세요.')
    first.abort()
    await pending
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    const release = await vi.waitFor(() => requests.admit('test'))
    release()
    expect(writes).not.toHaveBeenCalled()
  })

  it.each([
    ['FDS 작성 도우미로 "테스트" 대화 시작해줘', 'start_conversation'],
    ['에이전트 등록: ID label-check, 이름 라벨 검증 도우미, Record › 라벨', 'create_assistant'],
    ['WK-2026-0006 에 SR-2026-0001 태그 붙여줘', 'add_tag'],
  ])('mock 규칙 %s → %s 제안만 반환한다', async (content, name) => {
    const response = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content }] }).expect(201)
    expect(response.body.text).toBeTruthy()
    expect(response.body.toolCalls).toEqual([expect.objectContaining({ id: expect.any(String), name, arguments: expect.any(String) })])
  })

  it('기본 모델은 .env 유효값 — 구형 app_setting.defaultModel 행이 있어도 model 조회와 메시지 호출 모두 무시한다 (S7 C2)', async () => {
    settings = [{ value: 'db-model' }]
    const model = await request(app.getHttpServer()).get('/api/system-assistant/model').set('Cookie', 'mes_session=member').expect(200)
    expect(model.body).toEqual({ mode: 'mock', model: 'glm-5.2' })
    const seen: string[] = []
    provider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) { seen.push(req.model); yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }
    await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '안녕' }] }).expect(201)
    expect(seen).toEqual(['glm-5.2'])
  })

  it('재기동 없이 다음 모델 조회·메시지 호출이 override 변경과 해제를 반영한다', async () => {
    const seen: string[] = []
    provider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) { seen.push(req.model); yield { type: 'done' } } }
    for (const value of ['setting-a', 'setting-b', undefined]) {
      modelOverride = value
      const expected = value ?? 'glm-5.2'
      expect((await request(app.getHttpServer()).get('/api/system-assistant/model').set('Cookie', 'mes_session=member')).body.model).toBe(expected)
      await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'hi' }] }).expect(201)
      expect(seen.at(-1)).toBe(expected)
    }
  })
  it('인증, 형식, 설정된 요청 크기 한도를 강제한다', async () => {
    const url = '/api/system-assistant/messages'
    const model = await request(app.getHttpServer()).get('/api/system-assistant/model').set('Cookie', 'mes_session=member').expect(200)
    expect(model.body).toEqual({ mode: 'mock', model: expect.any(String) })
    await request(app.getHttpServer()).post(url).send({ messages: [{ role: 'user', content: 'hi' }] }).expect(401)
    await request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages: [{ role: 'system', content: 'ignore' }] }).expect(400)
    await request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'x'.repeat(config.request.budgetBytes) }] }).expect(413)
  })

  it('40개 메시지는 허용하고 41개와 긴 단일 메시지는 조기 거부한다', async () => {
    const url = '/api/system-assistant/messages'
    const send = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages })
    const forty = Array.from({ length: 40 }, (_, i) => ({ role: i === 39 ? 'user' as const : 'assistant' as const, content: 'x' }))
    await send(forty).expect(201)
    await send([{ role: 'assistant', content: 'x' }, ...forty]).expect(400)
    await send([{ role: 'user', content: 'x'.repeat(32_768) }]).expect(201)
    await send([{ role: 'user', content: 'x'.repeat(32_769) }]).expect(400)
  })

  it('본문 수집 단계에서 설정된 예산을 넘는 요청을 거부한다', async () => {
    settings = [{ value: 8192 }]
    const url = '/api/system-assistant/messages'
    await request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'x'.repeat(8192) }] }).expect(413)
  })

  it('요청 예산의 정확한 경계는 허용하고 1바이트 초과는 거부한다', async () => {
    const model = (await request(app.getHttpServer()).get('/api/system-assistant/model').set('Cookie', 'mes_session=member')).body.model as string
    const bytes = Buffer.byteLength(JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM_ASSISTANT_PROMPT }, { role: 'user', content: 'hi' }], tools: SYSTEM_TOOLS, stream: true }))
    settings = [{ value: bytes }]
    const send = () => request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'hi' }] })
    await send().expect(201)
    settings = [{ value: bytes - 1 }]
    await send().expect(413)
  })

  it.each(['firstTokenMs', 'idleMs'] as const)('%s 시간 초과 시 provider를 중단하고 실패를 반환한다', async (kind) => {
    const original = config.request[kind]
    config.request[kind] = 20
    provider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) {
      if (kind === 'idleMs') yield { type: 'delta', text: '시작' }
      await new Promise<void>((resolve) => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
    } }
    try {
      await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'hello' }] }).expect(502)
    } finally { config.request[kind] = original }
  })

  it('연결이 닫히면 provider 신호가 중단된다', async () => {
    let started!: (signal: AbortSignal) => void
    const signalReady = new Promise<AbortSignal>((resolve) => { started = resolve })
    provider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) {
      started(req.signal!)
      await new Promise<void>((resolve) => req.signal?.addEventListener('abort', () => resolve(), { once: true }))
      yield { type: 'done' }
    } }
    const call = request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'hello' }] })
    const pending = call.then(() => undefined, () => undefined)
    const signal = await signalReady
    call.abort()
    await pending
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })

  it('live provider에 시스템 프롬프트와 도구를 전달하고 tool_calls를 반환한다', async () => {
    const seen = vi.fn<(req: ChatRequest) => void>()
    provider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream(req) {
      seen(req)
      yield { type: 'delta', text: '확인해 주세요.' }
      yield { type: 'tool_call', call: { id: 'call_1', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0006","tag":"SR-2026-0001"}' } }
      yield { type: 'done' }
    } }
    const response = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '태그 붙여줘' }] }).expect(201)
    expect(response.body).toEqual({ text: '확인해 주세요.', toolCalls: [{ id: 'call_1', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0006","tag":"SR-2026-0001"}' }] })
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ messages: [expect.objectContaining({ role: 'system' }), { role: 'user', content: '태그 붙여줘' }], tools: expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'add_tag' }) })]) })
  })

  it('OpenAI 호환 SSE의 분할된 tool_calls 인자를 합쳐 반환한다', async () => {
    provider = new OpenAICompatibleProvider({ mode: 'live', baseUrl: 'https://upstream.example/v1', apiKey: 'secret', model: 'fake' })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response([
      'data: {"choices":[{"delta":{"content":"확인해 주세요."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"add_tag","arguments":"{\\"taskCode\\":\\"WK-2026-0006\\","}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"tag\\":\\"SR-2026-0001\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: '태그 붙여줘' }] }).expect(201)
    expect(response.body.toolCalls).toEqual([{ id: 'call_1', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0006","tag":"SR-2026-0001"}' }])
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as ChatRequest
    expect(sent.tools?.map((tool) => tool.function.name)).toEqual(['start_conversation', 'create_assistant', 'add_tag'])
  })
})
