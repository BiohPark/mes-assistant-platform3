// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { LlmSettings } from '@mes/domain'
import { OWUI_PROBE_PROMPT, frameKeyPaths, maskProbeError, probeOpenWebUi } from './owuiProbe.js'

type Handler = (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void | Promise<void>
let server: Server | undefined
const seen: { path: string; auth?: string; body: Record<string, unknown> }[] = []

async function serve(handlers: Record<string, Handler>): Promise<LlmSettings> {
  seen.length = 0
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
    const path = new URL(req.url ?? '/', 'http://x').pathname
    seen.push({ path, auth: req.headers.authorization, body })
    const handler = handlers[`${req.method} ${path}`]
    if (!handler) { res.writeHead(404).end('{"detail":"Not Found"}'); return }
    await handler(req, res, body)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { mode: 'live', baseUrl: `http://127.0.0.1:${port}/api`, apiKey: 'probe-secret-key', model: 'm', fileDelivery: 'openwebui' }
}
afterEach(async () => { server?.closeAllConnections(); await new Promise((resolve) => server ? server.close(resolve) : resolve(undefined)); server = undefined })

const json = (status: number, body: unknown): Handler => (_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)) }
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
function sse(frames: unknown[]): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const value of frames) res.write(value === '[DONE]' ? 'data: [DONE]\n\n' : frame(value))
    res.end()
  }
}
const MODELS = { data: [{ id: 'agent-a', name: 'A', info: {
  meta: { toolIds: ['web_tool', 'server:mcp:docs'], defaultFeatureIds: ['web_search'], capabilities: { vision: true, file_upload: false, citations: 'yes' },
    knowledge: [{ id: 'kb1', name: '사내 지식 비밀' }, { id: 'kb2', name: 'x' }] },
  params: { function_calling: 'native', system: '비밀 시스템 프롬프트' } } }, { id: 'plain' }] }
const ANSWER = '이것은 모델의 비밀 답변 본문입니다'
const STREAM = [
  { sources: [{ source: { name: 'kb-file.pdf' } }] },
  { id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
  { id: 'c', choices: [{ index: 0, delta: { reasoning_content: '생각' } }] },
  { id: 'c', choices: [{ index: 0, delta: { reasoning_content: '더 생각' } }] },
  { id: 'c', choices: [{ index: 0, delta: { content: ANSWER.slice(0, 5) } }] },
  { id: 'c', choices: [{ index: 0, delta: { content: ANSWER.slice(5) } }] },
  { id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 3 } },
  '[DONE]',
]

describe('probeOpenWebUi', () => {
  it('버전·모델 메타·두 방식 시험을 모으고 본문·키·주소는 결과에 없다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }), 'GET /api/models': json(200, MODELS), 'POST /api/chat/completions': sse(STREAM) })
    const result = await probeOpenWebUi(settings, 'agent-a')
    expect(result.version).toBe('0.12.0')
    expect(result.model).toBe('agent-a')
    expect(result.meta).toEqual({ found: true, toolIds: ['web_tool', 'server:mcp:docs'], defaultFeatureIds: ['web_search'],
      capabilities: { vision: true, file_upload: false }, knowledgeCount: 2, functionCalling: 'native' })
    expect(result.attempts.map((a) => a.mode)).toEqual(['current', 'legacy'])
    for (const attempt of result.attempts) {
      expect(attempt.status).toBe(200)
      expect(attempt.error).toBeUndefined()
      expect(attempt.firstByteMs).toEqual(expect.any(Number))
      expect(attempt.firstContentMs).toBeGreaterThanOrEqual(attempt.firstByteMs!)
      expect(attempt.frames).toEqual(['sources', 'choices.delta.role', 'choices.delta.reasoning_content ×2', 'choices.delta.content ×2', 'choices.finish_reason+usage', '[DONE]'])
    }
    const chats = seen.filter((s) => s.path === '/api/chat/completions')
    expect(chats).toHaveLength(2)
    expect(chats[0]!.body).toEqual({ model: 'agent-a', messages: [{ role: 'user', content: OWUI_PROBE_PROMPT }], stream: true })
    expect(chats[1]!.body).toEqual({ model: 'agent-a', messages: [{ role: 'user', content: OWUI_PROBE_PROMPT }], stream: true,
      tool_ids: ['web_tool', 'server:mcp:docs'], features: { web_search: true }, params: { function_calling: 'legacy' } })
    expect(seen.every((s) => s.auth === 'Bearer probe-secret-key')).toBe(true)
    const text = JSON.stringify(result)
    for (const leaked of [ANSWER.slice(0, 5), '생각', OWUI_PROBE_PROMPT, 'probe-secret-key', '127.0.0.1', 'kb-file', '사내 지식', '비밀 시스템', 'http']) expect(text).not.toContain(leaked)
  })

  it('버전·메타 실패는 확인 불가로 두고 시험은 그대로 하며, tool_ids 거부(400)는 상태와 가린 오류만 남긴다', async () => {
    const settings = await serve({
      'GET /api/version': json(500, { detail: 'boom' }),
      'GET /api/models': json(200, { data: [{ id: 'plain' }] }),
      'POST /api/chat/completions': async (req, res, body) => {
        if ('tool_ids' in body) return json(400, { detail: `tool_ids rejected by http://owui.corp.example:8080/api for key probe-secret-key and ${OWUI_PROBE_PROMPT} at 10.1.2.3 ${'x'.repeat(300)}` })(req, res, body)
        return sse(STREAM)(req, res, body)
      },
    })
    const result = await probeOpenWebUi(settings, 'plain')
    expect(result.version).toBeNull()
    expect(result.meta).toEqual({ found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, knowledgeCount: 0, functionCalling: null })
    expect(result.attempts[0]).toMatchObject({ mode: 'current', status: 200 })
    const legacy = result.attempts[1]!
    expect(legacy).toMatchObject({ mode: 'legacy', status: 400, firstContentMs: null, frames: [] })
    expect(legacy.error).toMatch(/^HTTP 400 · tool_ids rejected by \[url\]/)
    expect(legacy.error!.length).toBeLessThanOrEqual(120)
    expect(legacy.error).not.toMatch(/owui|corp|probe-secret-key|10\.1\.2\.3/)
    expect(legacy.error).not.toContain(OWUI_PROBE_PROMPT)
  })

  it('모델 목록 실패는 meta.error로, 연결 실패는 status null과 고정 문구로 남는다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '<script>' }), 'GET /api/models': json(401, { detail: 'bad key probe-secret-key' }) })
    const result = await probeOpenWebUi(settings, 'agent-a')
    expect(result.version).toBeNull() // 형식이 이상하면 버전으로 쓰지 않는다
    expect(result.meta).toMatchObject({ found: false, error: 'HTTP 401 · bad key [redacted]' })
    expect(result.attempts.map((a) => a.status)).toEqual([404, 404])
    await new Promise((resolve) => server!.close(resolve)); server = undefined
    const offline = await probeOpenWebUi(settings, 'agent-a')
    expect(offline.attempts.map((a) => [a.status, a.error])).toEqual([[null, 'LLM 서비스 연결 오류'], [null, 'LLM 서비스 연결 오류']])
  })

  it('전체 시간 상한을 넘으면 남은 시험은 시간 초과로 끝나고, 응답 크기 상한을 지킨다', async () => {
    const settings = await serve({
      'GET /api/version': json(200, { version: '0.12.0' }),
      'GET /api/models': json(200, MODELS),
      'POST /api/chat/completions': (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(frame({ choices: [{ delta: { content: 'x'.repeat(2048) } }] })) /* 끝내지 않음 */ },
    })
    const result = await probeOpenWebUi(settings, 'agent-a', { deadlineMs: 300 })
    expect(result.attempts.every((a) => a.error === '응답 시간 초과')).toBe(true)
    const small = await probeOpenWebUi(settings, 'agent-a', { maxResponseBytes: 1024, deadlineMs: 5_000 })
    expect(small.attempts.map((a) => a.error)).toEqual(['응답 크기 한도 초과', '응답 크기 한도 초과'])
  })

  it('밖에서 취소하면 즉시 멈춘다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '1' }), 'GET /api/models': json(200, MODELS), 'POST /api/chat/completions': () => { /* 응답 없음 */ } })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const started = performance.now()
    const result = await probeOpenWebUi(settings, 'agent-a', { signal: controller.signal })
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(result.attempts.every((a) => a.error === '요청이 취소되었습니다.')).toBe(true)
  })
})

describe('frameKeyPaths', () => {
  it('값은 버리고 키 경로만, 이상한 키는 ?로', () => {
    expect(frameKeyPaths({ id: 'x', object: 'o', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'hi', tool_calls: [{}] }, logprobs: null }] })).toBe('choices.delta.content+choices.delta.tool_calls')
    expect(frameKeyPaths({ 'http://evil.example/a b': 1 })).toBe('?')
    expect(frameKeyPaths({ choices: [{ delta: {} }] })).toBe('choices.delta')
    expect(frameKeyPaths('text')).toBe('non-json')
    expect(frameKeyPaths({ error: { message: 'secret' } })).toBe('error')
  })
})

describe('maskProbeError', () => {
  it('주소·IP·호스트·비밀값을 가리고 120자로 자른다', () => {
    expect(maskProbeError('see https://a.b/c?d=1 and api.corp.example:443 or 192.168.0.1:80 Bearer abc.def', ['zzz'])).toBe('see [url] and [host] or [host] Bearer [redacted]')
    expect(maskProbeError('key zzz here', ['zzz'])).toBe('key [redacted] here')
    expect(maskProbeError('y'.repeat(500), [])).toHaveLength(120)
  })
})
