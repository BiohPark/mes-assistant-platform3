import 'reflect-metadata'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OwuiProbeResultSchema } from '@mes/contracts'
import { MockProvider, OWUI_PROBE_PROMPT } from '@mes/llm'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB } from '../db/db.module.js'
import { dbLock } from '../db/schema.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'

const user = (id: string, isSystemOwner: boolean) => ({ id, name: id, role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner })
const sessions: SessionStore = {
  create: vi.fn(async () => ({ token: '', expiresAt: new Date() })),
  resolve: vi.fn(async (token: string) => token === 'owner' ? user('o1', true) : token === 'member' ? user('m', false) : null),
  destroy: vi.fn(async () => undefined),
}
/** 진단은 DB에 쓰지 않는다 — admit의 전역 용량 잠금(db_lock)만 허용 */
let activeRows = 0
const writes = vi.fn(() => { throw new Error('진단은 DB에 쓰지 않는다') })
const rows = async () => [{ count: activeRows }]
const reads = { select: () => ({ from: () => ({ where: () => Object.assign(rows(), { for: () => rows() }) }) }) }
const tx = { ...reads, update: writes, delete: writes, insert: (table: unknown) => { if (table !== dbLock) writes(); return { values: () => ({ onDuplicateKeyUpdate: async () => undefined }) } } }
const db = { ...reads, insert: writes, update: writes, delete: writes, transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }

/** 가짜 OpenWebUI — 버전·모델 메타·스트림, tool_ids는 400으로 거부 */
let owui: Server
let owuiPort = 0
let hang = false
const ANSWER = '비밀 답변 본문'
beforeAll(async () => {
  owui = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (req.url === '/api/version') return send(200, { version: '0.12.0' })
    if (req.url === '/api/models') return send(200, { data: [{ id: 'agent-a', info: { meta: { toolIds: ['t1'], defaultFeatureIds: ['web_search'], capabilities: { vision: true }, knowledge: [{ name: 'kb' }] }, params: { function_calling: 'native' } } }] })
    if (req.url === '/api/chat/completions') {
      if (hang) return
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      if ('tool_ids' in body) return send(400, { detail: `tool_ids not allowed — see http://127.0.0.1:${owuiPort}/docs key top-secret` })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ANSWER } }] })}\n\n`)
      return res.end('data: [DONE]\n\n')
    }
    send(404, {})
  })
  await new Promise<void>((resolve) => owui.listen(0, '127.0.0.1', resolve))
  owuiPort = (owui.address() as AddressInfo).port
})
afterAll(async () => { owui.closeAllConnections(); await new Promise((resolve) => owui.close(resolve)) })

const PROBE = '/api/admin/diagnostics/openwebui'
const env = () => ({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', REQUEST_MAX_ACTIVE: '2',
  LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: `http://127.0.0.1:${owuiPort}`, LLM_API_KEY: 'top-secret', LLM_DEFAULT_MODEL: 'agent-a' })

describe('OpenWebUI 진단 API', () => {
  let app: INestApplication | undefined
  async function boot(overrides: Record<string, string> = {}) {
    const config = loadConfig({ ...env(), ...overrides })
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(DB).useValue(db)
      .overrideProvider(LLM_PROVIDER).useValue(new MockProvider())
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
    return app
  }
  afterEach(async () => { await app?.close(); app = undefined; activeRows = 0; hang = false; vi.clearAllMocks() })

  it('SO만 실행한다 (401·403), 입력은 모델 하나', async () => {
    const server = (await boot()).getHttpServer()
    await request(server).post(PROBE).send({ model: 'agent-a' }).expect(401)
    await request(server).post(PROBE).set('Cookie', 'mes_session=member').send({ model: 'agent-a' }).expect(403)
    for (const body of [{}, { model: '' }, { model: 'agent-a', prompt: 'x' }]) await request(server).post(PROBE).set('Cookie', 'mes_session=owner').send(body).expect(400)
  })

  it('버전·메타·두 방식 결과를 돌려주고 프롬프트·답변·키·주소는 없다, DB에 쓰지 않는다', async () => {
    const res = await request((await boot()).getHttpServer()).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(200)
    const result = OwuiProbeResultSchema.strict().parse(res.body)
    expect(result).toMatchObject({ model: 'agent-a', version: '0.12.0',
      meta: { found: true, toolIds: ['t1'], defaultFeatureIds: ['web_search'], capabilities: { vision: true }, knowledgeCount: 1, functionCalling: 'native' } })
    expect(result.attempts[0]).toMatchObject({ mode: 'current', status: 200, frames: ['choices.delta.content', '[DONE]'] })
    expect(result.attempts[1]).toMatchObject({ mode: 'legacy', status: 400 })
    expect(result.attempts[1]!.error).toMatch(/^HTTP 400 · tool_ids not allowed/)
    const text = JSON.stringify(res.body)
    for (const leaked of [ANSWER, OWUI_PROBE_PROMPT, 'top-secret', '127.0.0.1', String(owuiPort), 'http']) expect(text).not.toContain(leaked)
    expect(writes).not.toHaveBeenCalled()
  })

  it('Mock 모드는 400, 전역 상한이 차면 429', async () => {
    await request((await boot({ LLM_MODE: 'mock' })).getHttpServer()).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(400)
    await app!.close()
    activeRows = 2
    await request((await boot()).getHttpServer()).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(429)
  })

  it('진행 중이면 같은 SO의 두 번째 진단은 429, 연결을 끊으면 슬롯을 돌려준다', async () => {
    hang = true
    const server = (await boot()).getHttpServer()
    const first = request(server).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).timeout(300).then(() => 'done', () => 'aborted')
    await new Promise((resolve) => setTimeout(resolve, 100))
    await request(server).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(429)
    expect(await first).toBe('aborted')
    hang = false
    await vi.waitFor(async () => { await request(server).post(PROBE).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(200) }, { timeout: 3_000, interval: 100 })
  })
})
