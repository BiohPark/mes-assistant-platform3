import 'reflect-metadata'
import { Readable } from 'node:stream'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { ChatProvider, ChatRequest } from '@mes/llm'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { DB } from '../db/db.module.js'
import { appSetting, dbLock } from '../db/schema.js'
import { RequestsService } from '../requests/requests.service.js'
import { DiagnosticsService } from './diagnostics.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'

const endpoint = '/api/admin/diagnostics/openwebui/response-probe'
let app: INestApplication | undefined
let active = 0
let settings: { key: string; value: unknown }[] = []
let captured: ChatRequest[] = []
let fail = false
let large = false
const writes = vi.fn(() => { throw new Error('no diagnostic records') })
const db = {
  select: () => ({ from: (table: unknown) => table === appSetting ? Promise.resolve(settings) : { where: () => Object.assign(Promise.resolve([{ count: active }]), { for: async () => [{ count: active }] }) } }),
  insert: writes, update: writes, delete: writes,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ count: active }]), { for: async () => [{ count: active }] }) }) }),
    insert: (table: unknown) => { if (table !== dbLock) writes(); return { values: () => ({ onDuplicateKeyUpdate: async () => undefined }) } },
    update: writes, delete: writes,
  }),
}
const provider: ChatProvider = {
  kind: 'live', listModels: async () => ['agent-a'], ping: async () => ({ ok: true, detail: '' }),
  async *stream(req) {
    captured.push(req)
    if (fail) { yield { type: 'error', message: 'secret upstream detail' }; return }
    await req.onDispatch?.({ mode: 'basic' }, req.owuiMode === 'direct' ? {} : { session_id: 'temporary' })
    if (req.owuiMode !== 'direct') await req.onSession?.('temporary')
    req.onRawResponse?.(large ? { body: '한'.repeat(100_000) } : { mode: req.owuiMode === 'direct' ? 'direct' : 'session', message: { content: '<details>thought</details>answer' } })
    req.onStep?.(0, { type: 'reasoning', text: 'thought' }, 1)
    req.onStep?.(1, { type: 'text', text: 'stale' }, 2)
    req.onStep?.(1, { type: 'text', text: 'answer', originalText: 'private original' }, 2)
    req.onStep?.(2, { type: 'text', text: 'discarded' }, 3)
    req.onStep?.(1, { type: 'text', text: 'answer', originalText: 'private original' }, 2)
    yield { type: 'delta', text: 'duplicate delta' }
    yield { type: 'done' }
  },
}
async function boot(env: Record<string, string> = {}) {
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
    LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: 'http://owui.example', LLM_API_KEY: 'test-key', LLM_OWUI_MODE: 'auto', ...env })
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG).useValue(config).overrideProvider(DB).useValue(db)
    .overrideProvider(LLM_PROVIDER).useValue(provider)
    .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'owner' || token === 'member' ? { id: token, isSystemOwner: token === 'owner' } : null }).compile()
  app = configureApp(module.createNestApplication(), config)
  await app.listen(0, '127.0.0.1')
  return app.getHttpServer()
}
afterEach(async () => { await app?.close(); app = undefined; active = 0; settings = []; captured = []; fail = false; large = false; vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('response probe', () => {
  it('requires SO and a single listed model, rejecting mock/non-OWUI without calls', async () => {
    const server = await boot()
    await request(server).post(endpoint).send({ model: 'agent-a' }).expect(401)
    await request(server).post(endpoint).set('Cookie', 'mes_session=member').send({ model: 'agent-a' }).expect(403)
    for (const body of [{}, { model: '' }, { model: 'agent-a', prompt: 'custom' }, { model: 'unknown' }]) {
      await request(server).post(endpoint).set('Cookie', 'mes_session=owner').send(body).expect(400)
    }
    expect(captured).toEqual([])
    for (const env of [{ LLM_MODE: 'mock' }, { LLM_PRESET: 'openai-compatible' }] as Record<string, string>[]) {
      await app!.close()
      await request(await boot(env)).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(400)
    }
  })
  it('uses the injected request provider with current settings, returns public steps and no duplicate deltas or DB writes', async () => {
    settings = [{ key: 'owuiMode', value: 'direct' }, { key: 'owuiTools', value: 'off' }, { key: 'owuiCleanup', value: false }]
    const res = await request(await boot()).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(200)
    expect(res.body).toMatchObject({ model: 'agent-a', mode: 'direct', content: 'answer', steps: [{ type: 'reasoning', text: 'thought' }, { type: 'text', text: 'answer' }], rawResponse: { message: { content: '<details>thought</details>answer' } } })
    expect(Object.keys(res.body).sort()).toEqual(['content', 'elapsedMs', 'mode', 'model', 'rawResponse', 'steps'])
    expect(res.body.elapsedMs).toEqual(expect.any(Number))
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ model: 'agent-a', owuiMode: 'direct', owuiTools: 'off', owuiCleanup: true, messages: [{ role: 'user', content: expect.any(String) }] })
    expect(captured[0]!.limits).toBeUndefined() // limits would silently disable sessions
    expect(writes).not.toHaveBeenCalled()
  })
  it('reports the actual session dispatch and uses the domain UTF-8 raw ceiling without slicing', async () => {
    large = true
    const res = await request(await boot()).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(200)
    expect(res.body.mode).toBe('session')
    expect(res.body.rawResponse).toEqual({ bytes: 300011 })
  })
  it('returns safe provider failures and releases capacity for the next run', async () => {
    const server = await boot({ REQUEST_MAX_ACTIVE: '1' })
    fail = true
    const res = await request(server).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(504)
    expect(JSON.stringify(res.body)).not.toContain('secret upstream detail')
    fail = false
    await request(server).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(200)
    active = 1
    await request(server).post(endpoint).set('Cookie', 'mes_session=owner').send({ model: 'agent-a' }).expect(429)
  })
})

function service(selectedProvider: ChatProvider = provider) {
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
    LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: 'http://owui.example', LLM_API_KEY: 'test-key', REQUEST_MAX_ACTIVE: '1' })
  const requests = new RequestsService(db as never, config, selectedProvider)
  return new DiagnosticsService(config, {} as never, requests, db as never, new FileStorageService(config.fileStorageRoot))
}
describe('response probe service', () => {
  it('projects final public steps through the request provider with DB settings and no records', async () => {
    settings = [{ key: 'owuiMode', value: 'direct' }, { key: 'owuiTools', value: 'off' }, { key: 'owuiCleanup', value: false }]
    const result = await service().probeOpenWebUiResponse('owner', 'agent-a')
    expect(result).toMatchObject({ mode: 'direct', content: 'answer', steps: [{ type: 'reasoning', text: 'thought' }, { type: 'text', text: 'answer' }] })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ owuiMode: 'direct', owuiTools: 'off', owuiCleanup: true })
    expect(captured[0]!.limits).toBeUndefined()
    expect(writes).not.toHaveBeenCalled()
  })
  it('bounds raw UTF-8 bytes and reports actual session dispatch', async () => {
    large = true
    expect(await service().probeOpenWebUiResponse('owner', 'agent-a')).toMatchObject({ mode: 'session', rawResponse: { bytes: 300011 } })
  })
  it('rejects an unknown model before streaming and releases slots after provider errors', async () => {
    const diagnostics = service()
    await expect(diagnostics.probeOpenWebUiResponse('owner', 'unknown')).rejects.toMatchObject({ status: 400 })
    expect(captured).toEqual([])
    fail = true
    await expect(diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).rejects.toMatchObject({ status: 504, message: 'OpenWebUI 응답 원문 진단을 마치지 못했습니다' })
    fail = false
    expect((await diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).content).toBe('answer')
  })
})

describe('response probe service with the real provider', () => {
  it('runs the fake OWUI details scenario through session parsing and cleanup, then honors a direct override', async () => {
    vi.stubEnv('FAKE_OWUI_E2E', '1')
    const fixture = new URL('../../../../docker/fake-openwebui/server.mjs', import.meta.url).href
    const { handleRequest } = await import(fixture) as { handleRequest: (req: unknown, res: unknown) => Promise<void> }
    const calls: { path: string; method: string }[] = []
    // In-memory HTTP transport: the real fake OWUI handler, without opening sockets.
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname
      calls.push({ path, method: init.method ?? 'GET' })
      const req = Readable.from(init.body ? [Buffer.from(String(init.body))] : [])
      Object.assign(req, { url: path, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)) })
      let status = 200, headers: Record<string, string> = {}
      const chunks: string[] = []
      await handleRequest(req, {
        writeHead(code: number, values: Record<string, string>) { status = code; headers = values },
        write(value: string) { chunks.push(value) }, end(value?: string) { if (value) chunks.push(value) },
      })
      return new Response(chunks.join(''), { status, headers })
    })
    const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
      LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: 'http://owui.example', LLM_API_KEY: 'test-key' })
    const { toLlmSettings } = await import('../llm/presets.js')
    const diagnostics = service(RequestsService.createProvider(toLlmSettings(config.llm)))
    settings = [{ key: 'owuiMode', value: 'session' }, { key: 'owuiCleanup', value: false }]
    const result = await diagnostics.probeOpenWebUiResponse('owner', 'fake-general')
    expect(result.mode).toBe('session')
    expect(result.steps.map(step => step.type)).toEqual(['reasoning', 'text', 'code', 'tool', 'text'])
    expect(result.steps[0]).toEqual({ type: 'reasoning', text: 'PRIVATE_REASONING: details thought' })
    expect(result.content).toBe('\nBefore tool\n\n\n**details answer**')
    expect(JSON.stringify(result.rawResponse)).toContain('<details')
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    const sessions = await (await fetch('http://owui.example/__e2e/sessions')).json() as { active: string[] }
    expect(sessions.active).toEqual([])
    settings = [{ key: 'owuiMode', value: 'direct' }]
    const direct = await diagnostics.probeOpenWebUiResponse('owner', 'fake-general')
    expect(direct.mode).toBe('direct')
    expect(direct.rawResponse).toMatchObject({ mode: 'direct' })
    expect(direct.content).toContain('[가짜 OpenWebUI · fake-general]')
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    expect(writes).not.toHaveBeenCalled()
  })
})

describe('response probe service lifecycle', () => {
  it('rejects a concurrent run, cancels the provider, and lets the same SO run again', async () => {
    let started: () => void = () => undefined
    const ready = new Promise<void>(resolve => { started = resolve })
    let hold = true
    const waitingProvider: ChatProvider = { ...provider, async *stream(req) {
      if (hold) {
        started()
        await new Promise<void>(resolve => req.signal!.addEventListener('abort', () => resolve(), { once: true }))
        yield { type: 'error', message: 'cancelled' }
      } else { yield { type: 'delta', text: 'recovered' }; yield { type: 'done' } }
    } }
    const diagnostics = service(waitingProvider)
    const controller = new AbortController()
    const first = diagnostics.probeOpenWebUiResponse('owner', 'agent-a', controller.signal)
    const stopped = expect(first).rejects.toMatchObject({ status: 504 })
    await ready
    await expect(diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).rejects.toMatchObject({ status: 429 })
    controller.abort()
    await stopped
    hold = false
    expect(await diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).toMatchObject({ content: 'recovered', mode: 'direct' })
  })
  it('times out with fake timers and returns capacity after the provider has stopped', async () => {
    vi.useFakeTimers()
    let started: () => void = () => undefined
    const ready = new Promise<void>(resolve => { started = resolve })
    let hold = true
    const waitingProvider: ChatProvider = { ...provider, async *stream(req) {
      if (hold) {
        started()
        await new Promise<void>(resolve => req.signal!.addEventListener('abort', () => resolve(), { once: true }))
        yield { type: 'error', message: 'timeout' }
      } else { yield { type: 'delta', text: 'recovered' }; yield { type: 'done' } }
    } }
    const diagnostics = service(waitingProvider)
    const first = expect(diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).rejects.toMatchObject({ status: 504 })
    await ready
    await vi.runOnlyPendingTimersAsync()
    await first
    hold = false
    expect((await diagnostics.probeOpenWebUiResponse('owner', 'agent-a')).content).toBe('recovered')
  })
})

describe('response probe service actual transport', () => {
  it.each([{ mode: 'direct', firstFrames: [] }, { bytes: 300000 }])('reports direct when a server handles a session-shaped dispatch as SSE: %j', async raw => {
    const sseProvider: ChatProvider = { ...provider, async *stream(req) {
      await req.onDispatch?.({ mode: 'basic' }, { session_id: 'ignored' })
      req.onRawResponse?.(raw)
      yield { type: 'delta', text: 'SSE answer' }
      yield { type: 'done' }
    } }
    expect(await service(sseProvider).probeOpenWebUiResponse('owner', 'agent-a')).toMatchObject({ mode: 'direct', content: 'SSE answer' })
  })
})

it('response probe service keeps session mode when an oversized session raw response contains only its byte count', async () => {
  const sessionProvider: ChatProvider = { ...provider, async *stream(req) {
    await req.onSession?.('temporary-chat')
    req.onRawResponse?.({ bytes: 300000 })
    yield { type: 'delta', text: 'session answer' }
    yield { type: 'done' }
  } }
  expect(await service(sessionProvider).probeOpenWebUiResponse('owner', 'agent-a')).toMatchObject({ mode: 'session', content: 'session answer', rawResponse: { bytes: 300000 } })
})
