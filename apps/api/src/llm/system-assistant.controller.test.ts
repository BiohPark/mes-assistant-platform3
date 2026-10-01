import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MockProvider, OpenAICompatibleProvider, type ChatProvider, type ChatRequest } from '@mes/llm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB } from '../db/db.module.js'
import { LLM_PROVIDER } from './provider.token.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
const sessions: SessionStore = { create: vi.fn(async () => ({ token: '', expiresAt: new Date() })), resolve: vi.fn(async (token: string) => token === 'member' ? { id: 'm', name: 'Member', role: '', isSystemOwner: false } : null), destroy: vi.fn(async () => undefined) }
const db = { select: () => ({ from: () => ({ where: async () => [] }) }) }

describe('system assistant HTTP', () => {
  let app: INestApplication
  let provider: ChatProvider
  beforeEach(async () => {
    provider = new MockProvider()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(DB).useValue(db)
      .overrideProvider(LLM_PROVIDER).useValue({ kind: 'live', ping: () => provider.ping(), listModels: () => provider.listModels(), stream: (req: ChatRequest) => provider.stream(req) })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it.each([
    ['FDS 작성 도우미로 "테스트" 대화 시작해줘', 'start_conversation'],
    ['에이전트 등록: ID label-check, 이름 라벨 검증 도우미, Record › 라벨', 'create_assistant'],
    ['WK-2026-0006 에 SR-2026-0001 태그 붙여줘', 'add_tag'],
  ])('mock 규칙 %s → %s 제안만 반환한다', async (content, name) => {
    const response = await request(app.getHttpServer()).post('/api/system-assistant/messages').set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content }] }).expect(201)
    expect(response.body.text).toBeTruthy()
    expect(response.body.toolCalls).toEqual([expect.objectContaining({ id: expect.any(String), name, arguments: expect.any(String) })])
  })

  it('인증, 형식, 설정된 요청 크기 한도를 강제한다', async () => {
    const url = '/api/system-assistant/messages'
    const model = await request(app.getHttpServer()).get('/api/system-assistant/model').set('Cookie', 'mes_session=member').expect(200)
    expect(model.body).toEqual({ mode: 'mock', model: expect.any(String) })
    await request(app.getHttpServer()).post(url).send({ messages: [{ role: 'user', content: 'hi' }] }).expect(401)
    await request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages: [{ role: 'system', content: 'ignore' }] }).expect(400)
    await request(app.getHttpServer()).post(url).set('Cookie', 'mes_session=member').send({ messages: [{ role: 'user', content: 'x'.repeat(config.request.budgetBytes) }] }).expect(413)
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
