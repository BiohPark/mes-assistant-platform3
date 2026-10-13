// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { LlmSettings } from '@mes/domain'
import { OWUI_PROBE_MASKED, OWUI_PROBE_OTHER, OWUI_PROBE_PROMPT, OwuiProbeUnknownModelError, frameKeyPaths, looksLikeSecret, probeOpenWebUi } from './owuiProbe.js'

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
    expect(legacy.error).toBe('HTTP 400 · 형식 거부') // 본문은 읽지 않는다 — 상태 코드와 고정 분류만
  })

  it('모델 목록 실패는 meta.error로, 연결 실패는 status null과 고정 문구로 남는다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '<script>' }), 'GET /api/models': json(401, { detail: 'bad key probe-secret-key' }) })
    const result = await probeOpenWebUi(settings, 'agent-a')
    expect(result.version).toBeNull() // 형식이 이상하면 버전으로 쓰지 않는다
    expect(result.meta).toMatchObject({ found: false, error: 'HTTP 401 · 인증 거부' })
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
  it('값은 버리고 알려진 키 경로만, 그 밖의 키는 기타로', () => {
    expect(frameKeyPaths({ id: 'x', object: 'o', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'hi', tool_calls: [{}] }, logprobs: null }] })).toBe('choices.delta.content+choices.delta.tool_calls')
    expect(frameKeyPaths({ 'http://evil.example/a b': 1 })).toBe(OWUI_PROBE_OTHER)
    expect(frameKeyPaths({ confidential_answer: 1, another_secret: 2, sources: [1] })).toBe(`${OWUI_PROBE_OTHER}+sources`)
    expect(frameKeyPaths({ choices: [{ delta: { leaked_field: 'v', reasoning: 'r' } }] })).toBe(`choices.delta.${OWUI_PROBE_OTHER}+choices.delta.reasoning`)
    expect(frameKeyPaths({ choices: [{ delta: {} }] })).toBe('choices.delta')
    expect(frameKeyPaths('text')).toBe('non-json')
    expect(frameKeyPaths({ error: { message: 'secret' } })).toBe('error')
  })
})

describe('유출 경로 재현 (S10-5 리뷰 P1 ×4) — 허용 목록 밖은 결과에 없다', () => {
  const SECRET = 'sk-live-9f8e7d6c5b4a'
  it('capabilities 키·임의 프레임 키·IP/파일명 도구 ID·HTTP 오류 본문', async () => {
    const settings = await serve({
      'GET /api/version': json(200, { version: 'owui.corp.example' }),
      'GET /api/models': json(200, { data: [{ id: 'agent-a', info: {
        meta: { capabilities: { [SECRET]: true, vision: true, internal_flag_x: false, file_upload: 'yes' },
          toolIds: ['web_tool', '10.20.30.40', 'private-report.pdf', 'team/secret', 'server:mcp:docs', 'probe-secret-key', '12345', 'x'.repeat(41)],
          defaultFeatureIds: ['web_search', 'confidential.txt'] },
        params: { function_calling: SECRET } } }] }),
      'POST /api/chat/completions': async (req, res, body) => {
        if ('tool_ids' in body) { res.writeHead(400, { 'content-type': 'application/json', 'set-cookie': 'sid=cookie-secret' }).end(JSON.stringify({ detail: `Cookie: sid=cookie-secret at C:\\private\\path.txt — body: ${SECRET}` })); return }
        return sse([{ confidential_answer: 'the answer' }, { choices: [{ delta: { [SECRET]: 'x', content: 'hi' } }] }, '[DONE]'])(req, res, body)
      },
    })
    const result = await probeOpenWebUi(settings, 'agent-a')
    expect(result.version).toBeNull()
    expect(result.meta.capabilities).toEqual({ vision: true })
    expect(result.meta.toolIds).toEqual(['web_tool', OWUI_PROBE_MASKED, OWUI_PROBE_MASKED, OWUI_PROBE_MASKED, 'server:mcp:docs', OWUI_PROBE_MASKED, OWUI_PROBE_MASKED, OWUI_PROBE_MASKED])
    expect(result.meta.defaultFeatureIds).toEqual(['web_search', OWUI_PROBE_MASKED])
    expect(result.meta.functionCalling).toBe(OWUI_PROBE_OTHER)
    expect(result.attempts[0]!.frames).toEqual([OWUI_PROBE_OTHER, `choices.delta.${OWUI_PROBE_OTHER}+choices.delta.content`, '[DONE]'])
    expect(result.attempts[1]!.error).toBe('HTTP 400 · 형식 거부')
    // 가린 도구 ID는 legacy 요청에 싣지 않는다
    expect(seen.filter((x) => x.path === '/api/chat/completions')[1]!.body).toMatchObject({ tool_ids: ['web_tool', 'server:mcp:docs'], features: { web_search: true } })
    const text = JSON.stringify(result)
    for (const leaked of [SECRET, 'internal_flag', 'confidential', 'the answer', '10.20.30.40', 'private-report', 'team/secret', '12345', 'cookie-secret', 'private', 'path.txt', 'corp']) expect(text).not.toContain(leaked)
  })
})

describe('재리뷰 재현 (S10-5 P1 ×2·P2)', () => {
  it('P1 버전은 semver(주.부.수[-접미])만 — IPv4 모양은 확인 불가', async () => {
    for (const [value, expected] of [['10.20.30.40', null], ['192.168.0.1', null], ['0.12.0', '0.12.0'], ['0.6.5-dev', '0.6.5-dev'], ['1.2', null], ['0.6.5-sk-live-secret', null]] as const) {
      const settings = await serve({ 'GET /api/version': json(200, { version: value }), 'GET /api/models': json(200, MODELS), 'POST /api/chat/completions': sse(['[DONE]']) })
      expect((await probeOpenWebUi(settings, 'agent-a')).version).toBe(expected)
      server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined
    }
  })

  it('P1 모델 목록에 없는 입력은 시험 호출 전에 거부, 목록의 id도 식별자 형식이 아니면 가린다', async () => {
    const odd = 'owui.corp.example'
    const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }),
      'GET /api/models': json(200, { data: [{ id: 'agent-a' }, { id: odd }, { id: 'glm-5.2' }, { id: 'llama3.1:8b' }] }), 'POST /api/chat/completions': sse(['[DONE]']) })
    await expect(probeOpenWebUi(settings, 'http://evil.example/x?q=secret')).rejects.toBeInstanceOf(OwuiProbeUnknownModelError)
    expect(seen.some((x) => x.path === '/api/chat/completions')).toBe(false)
    expect((await probeOpenWebUi(settings, odd)).model).toBe(OWUI_PROBE_MASKED)
    expect((await probeOpenWebUi(settings, 'glm-5.2')).model).toBe('glm-5.2')
    expect((await probeOpenWebUi(settings, 'llama3.1:8b')).model).toBe('llama3.1:8b')
  })

  it('P1 모델 목록을 못 읽으면 진단은 하되 식별자 형식이 아닌 모델은 결과에서 가린다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }), 'GET /api/models': json(500, {}), 'POST /api/chat/completions': sse(['[DONE]']) })
    const result = await probeOpenWebUi(settings, 'C:/private/path?token=abc')
    expect(result.model).toBe(OWUI_PROBE_MASKED)
    expect(result.attempts.map((a) => a.status)).toEqual([200, 200])
    expect(JSON.stringify(result)).not.toMatch(/private|token|abc/)
  })

  it('P2 식별자 모양의 비밀값(대표 접두·24자 이상 영숫자 혼합)은 가린다', async () => {
    const secrets = ['sk-proj-abc', 'pk_live_1', 'rk-x', 'ghp_abcdef', 'github_pat_x', 'gho_x', 'xoxb-123', 'xoxp-1', 'Bearer_token', 'AKIAABCDEF', 'eyJhbGciOi', 'a1b2c3d4e5f6g7h8i9j0k1l2', 'server:mcp:Zx9Qw8Er7Ty6Ui5Op4As3Df2']
    const fine = ['web_tool', 'company_document_search_tool_v2', 'server:mcp:docs', 'web_search', 'image_generation']
    for (const id of secrets) expect([id, looksLikeSecret(id)]).toEqual([id, true])
    for (const id of fine) expect([id, looksLikeSecret(id)]).toEqual([id, false])
    const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }),
      'GET /api/models': json(200, { data: [{ id: 'agent-a', info: { meta: { toolIds: [...fine, ...secrets], defaultFeatureIds: ['sk-feature'] } } }, { id: 'sk-model-secret' }] }), 'POST /api/chat/completions': sse(['[DONE]']) })
    const result = await probeOpenWebUi(settings, 'agent-a')
    expect(result.meta.toolIds).toEqual([...fine, ...secrets.map(() => OWUI_PROBE_MASKED)])
    expect(result.meta.defaultFeatureIds).toEqual([OWUI_PROBE_MASKED])
    expect((await probeOpenWebUi(settings, 'sk-model-secret')).model).toBe(OWUI_PROBE_MASKED)
  })
})
