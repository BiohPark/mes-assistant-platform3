// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmSettings } from '@mes/domain'
import { OWUI_PROBE_MASKED, OWUI_PROBE_OTHER, OWUI_PROBE_PROMPT, OwuiProbeUnknownModelError, checkOpenWebUiAccess, frameKeyPaths, looksLikeSecret, probeOpenWebUi, owuiDefaults, owuiTerminal } from './owuiProbe.js'

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
afterEach(async () => { vi.unstubAllGlobals(); server?.closeAllConnections(); await new Promise((resolve) => server ? server.close(resolve) : resolve(undefined)); server = undefined })

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
  meta: { toolIds: ['web_tool', 'server:mcp:docs'], defaultFeatureIds: ['web_search'], capabilities: { vision: true, file_upload: false, citations: 'yes', web_search: true },
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
      capabilities: { vision: true, file_upload: false, web_search: true }, builtinTools: {}, terminal: false, terminalSource: 'none', knowledgeCount: 2, functionCalling: 'native' })
    expect(result.attempts.map((a) => a.mode)).toEqual(['current', 'legacy'])
    for (const attempt of result.attempts) {
      expect(attempt.status).toBe(200)
      expect(attempt.error).toBeUndefined()
      expect(attempt.firstByteMs).toEqual(expect.any(Number))
      expect(attempt.firstContentMs).toBeGreaterThanOrEqual(attempt.firstByteMs!)
      expect(attempt.frames).toEqual(['sources', 'choices.delta.role', 'choices.delta.reasoning_content ×2', 'choices.delta.content ×2', 'choices.finish_reason+usage', '[DONE]'])
    }
    const chats = seen.filter((s) => s.path === '/api/chat/completions')
    expect(chats).toHaveLength(3) // ③ 세션 시험 — 스트리밍으로 답하면 세션 미지원
    expect(result.session).toMatchObject({ status: 200, error: '세션 미지원', cleanup: null, statuses: [] })
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
        if ((body.params as { function_calling?: string } | undefined)?.function_calling === 'legacy') return json(400, { detail: `tool_ids rejected by http://owui.corp.example:8080/api for key probe-secret-key and ${OWUI_PROBE_PROMPT} at 10.1.2.3 ${'x'.repeat(300)}` })(req, res, body)
        return sse(STREAM)(req, res, body)
      },
    })
    const result = await probeOpenWebUi(settings, 'plain')
    expect(result.version).toBeNull()
    expect(result.meta).toEqual({ found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, builtinTools: {}, terminal: false, terminalSource: 'none', knowledgeCount: 0, functionCalling: null })
    expect(result.access).toEqual({ tools: { visible: null, items: [] }, skills: { visible: null, items: [] } })
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
    expect(offline.session).toMatchObject({ status: null, error: 'LLM 서비스 연결 오류', cleanup: null })
  })

  it('전체 시간 상한을 넘으면 남은 시험은 시간 초과로 끝나고, 응답 크기 상한을 지킨다', async () => {
    const settings = await serve({
      'GET /api/version': json(200, { version: '0.12.0' }),
      'GET /api/models': json(200, MODELS),
      'POST /api/chat/completions': (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(frame({ choices: [{ delta: { content: 'x'.repeat(2048) } }] })) /* 끝내지 않음 */ },
    })
    const result = await probeOpenWebUi(settings, 'agent-a', { deadlineMs: 300 })
    expect(result.attempts.every((a) => a.error === '응답 시간 초과')).toBe(true)
    expect(result.session.error).toBe('응답 시간 초과')
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
    expect(result.session.error).toBe('요청이 취소되었습니다.')
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
        meta: { capabilities: { [SECRET]: true, vision: true, internal_flag_x: false, file_upload: 'yes', web_search: true },
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
    expect(result.meta.capabilities).toEqual({ vision: true, web_search: true })
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

describe('도구·스킬 접근 (S13-J) — 서비스 계정이 보는 목록(GET /api/v1/tools/·/api/v1/skills/)으로 판정', () => {
  const SECRET = 'sk-live-9f8e7d6c5b4a'
  const meta = { toolIds: ['web_tool', 'server:mcp:docs', 'private_tool'], skillIds: ['skill_a', 'skill_off', 'skill_hidden', SECRET],
    builtinTools: { skills: true, web_search: false, 'evil.example': true, memory: 'yes' } }
  const models = { data: [{ id: 'agent-a', info: { meta } }] }
  it('항목별 ✅(ok)·❌(denied)·비활성(inactive)과 보이는 개수, 이름·설명은 결과에 없다', async () => {
    const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }), 'GET /api/models': json(200, models), 'POST /api/chat/completions': sse(['[DONE]']),
      'GET /api/v1/tools/': json(200, [{ id: 'web_tool', name: '사내 도구 비밀', meta: { description: 'http://tool.corp.example' } }, { id: 'server:mcp:docs', name: 'MCP' }, { id: 'other_tool', name: 'x' }]),
      'GET /api/v1/skills/': json(200, [{ id: 'skill_a', name: '스킬 비밀', description: '비밀 설명', is_active: true }, { id: 'skill_off', is_active: false }, { id: 'skill_x', is_active: true }]) })
    const result = await probeOpenWebUi(settings, 'agent-a', { sessionPollMs: 5 })
    expect(result.meta.builtinTools).toEqual({ skills: true, web_search: false })
    expect(result.access.tools).toEqual({ visible: 3, items: [{ id: 'web_tool', state: 'ok' }, { id: 'server:mcp:docs', state: 'ok' }, { id: 'private_tool', state: 'denied' }] })
    expect(result.access.skills).toEqual({ visible: 2, items: [{ id: 'skill_a', state: 'ok' }, { id: 'skill_off', state: 'inactive' }, { id: 'skill_hidden', state: 'denied' }, { id: OWUI_PROBE_MASKED, state: 'denied' }] })
    for (const path of ['/api/v1/tools/', '/api/v1/skills/']) expect(seen.find((x) => x.path === path)?.auth).toBe('Bearer probe-secret-key')
    const text = JSON.stringify(result)
    for (const leaked of [SECRET, '사내 도구', '스킬 비밀', '비밀 설명', 'corp', 'evil', 'other_tool', 'skill_x']) expect(text).not.toContain(leaked)
  })

  it('목록 엔드포인트가 없거나(404) 막히거나(403) 형식이 다르면 확인 불가(unknown)와 고정 분류', async () => {
    for (const [tools, skills, toolError, skillError] of [
      [json(404, { detail: 'Not Found' }), json(403, { detail: `API key ${SECRET} not allowed` }), 'HTTP 404 · 찾을 수 없음', 'HTTP 403 · 인증 거부'],
      [json(200, { data: [] }), json(200, '<html>'), '응답 형식 오류', '응답 형식 오류'],
    ] as const) {
      const settings = await serve({ 'GET /api/version': json(200, { version: '0.12.0' }), 'GET /api/models': json(200, models), 'POST /api/chat/completions': sse(['[DONE]']),
        'GET /api/v1/tools/': tools, 'GET /api/v1/skills/': skills })
      const result = await probeOpenWebUi(settings, 'agent-a', { sessionPollMs: 5 })
      expect(result.access.tools).toEqual({ visible: null, error: toolError, items: meta.toolIds.map((id) => ({ id, state: 'unknown' })) })
      expect(result.access.skills).toMatchObject({ visible: null, error: skillError })
      expect(result.access.skills.items.every((item) => item.state === 'unknown')).toBe(true)
      expect(JSON.stringify(result)).not.toContain(SECRET)
      server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined
    }
  })
})

describe('③ 세션 방식 시험 (S13-J) — 결과 코드·시간·상태 이름·정리 여부만', () => {
  const SECRET = 'sk-live-9f8e7d6c5b4a'
  type Status = Record<string, unknown>
  /** 생성(session_id 있는 POST)은 chat_id JSON, 그 밖은 SSE. 채팅 GET은 states를 차례로 돌려준다 */
  function sessionServer(states: { statuses?: Status[]; done?: boolean; error?: boolean }[], extra: Record<string, Handler> = {}) {
    let polls = 0
    const calls = { stop: 0, delete: 0 }
    const handlers: Record<string, Handler> = {
      'GET /api/version': json(200, { version: '0.12.0' }), 'GET /api/models': json(200, MODELS),
      'GET /api/v1/tools/': json(200, [{ id: 'web_tool' }]), 'GET /api/v1/skills/': json(200, []),
      'POST /api/chat/completions': (req, res, body) => 'session_id' in body ? json(200, { status: true, task_ids: ['t'], chat_id: 'chat-1' })(req, res, body) : sse(['[DONE]'])(req, res, body),
      'GET /api/v1/chats/chat-1': (req, res, body) => {
        const created = seen.find((x) => 'session_id' in x.body)!.body
        const state = states[Math.min(polls++, states.length - 1)]!
        const message = { id: created.id, role: 'assistant', content: ANSWER, done: state.done ?? false, statusHistory: state.statuses ?? [],
          output: [{ type: 'message', content: [{ type: 'output_text', text: ANSWER }] }], ...(state.error ? { error: { content: `upstream ${SECRET}` } } : {}) }
        return json(200, { id: 'chat-1', chat: { history: { messages: { [String(created.id)]: message } } } })(req, res, body)
      },
      'POST /api/tasks/chat/chat-1/stop': (req, res, body) => { calls.stop++; return json(200, { status: true })(req, res, body) },
      'DELETE /api/v1/chats/chat-1': (req, res, body) => { calls.delete++; return json(200, true)(req, res, body) },
      ...extra,
    }
    return { handlers, calls }
  }

  it('세션으로 보내 첫 상태·완료 시간과 상태 action 이름(설명 없음=기타, 오류=!)을 모으고 채팅을 지운다 — 본문·상태 설명은 없다', async () => {
    const searching = { action: 'web_search', description: `Searching http://search.corp.example?q=${SECRET}`, done: false }
    const { handlers, calls } = sessionServer([{}, { statuses: [searching, searching] },
      { statuses: [searching, searching, { description: '사내 비밀 상태' }, { action: 'tool_connection', description: "Failed to connect to MCP server 'x'", error: true, done: true }, { action: 'sk_live_abc' }] },
      { statuses: [searching, searching], done: true }])
    const settings = await serve(handlers)
    const result = await probeOpenWebUi(settings, 'agent-a', { sessionPollMs: 5 })
    expect(result.session).toEqual({ status: 200, firstStatusMs: expect.any(Number), doneMs: expect.any(Number), totalMs: expect.any(Number),
      statuses: ['web_search ×2', OWUI_PROBE_OTHER, 'tool_connection!', OWUI_PROBE_OTHER], cleanup: true })
    expect(result.session.doneMs!).toBeGreaterThanOrEqual(result.session.firstStatusMs!)
    expect(calls).toEqual({ stop: 0, delete: 1 })
    const body = seen.find((x) => 'session_id' in x.body)!.body
    expect(body).toEqual({ model: 'agent-a', messages: [{ role: 'user', content: OWUI_PROBE_PROMPT }], stream: true, tool_ids: ['web_tool', 'server:mcp:docs'], features: { web_search: true },
      session_id: expect.stringMatching(/^mes-probe-/), id: expect.any(String), parent_id: null, params: { tool_approval_mode: 'full' } })
    expect(body).not.toHaveProperty('user_message')
    const text = JSON.stringify(result)
    for (const leaked of [ANSWER, SECRET, 'Searching', 'corp', '사내 비밀', 'Failed to connect', 'chat-1', 'sk_live']) expect(text).not.toContain(leaked)
  })

  it('모델 기본 터미널(meta.terminalId)은 설정됨으로만 보이고, legacy·세션 본문에 terminal_id로 싣는다 — capabilities.terminal 끔이면 안 싣는다', async () => {
    for (const [capabilities, sent] of [[{}, true], [{ terminal: false }, false]] as const) {
      const { handlers } = sessionServer([{ done: true }], { 'GET /api/models': json(200, { data: [{ id: 'agent-a', info: { meta: { toolIds: ['web_tool'], terminalId: 'term-corp-1', capabilities } } }] }) })
      const result = await probeOpenWebUi(await serve(handlers), 'agent-a', { sessionPollMs: 5 })
      expect(result.meta.terminal).toBe(true)
      expect(result.meta.capabilities).toEqual(capabilities)
      const posted = seen.filter((x) => x.path === '/api/chat/completions').map((x) => x.body)
      expect(posted[0]).not.toHaveProperty('terminal_id')
      for (const body of posted.slice(1)) expect(body.terminal_id).toBe(sent ? 'term-corp-1' : undefined)
      expect(JSON.stringify(result)).not.toContain('term-corp')
      server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined
    }
  })

  it('작업 실패는 고정 문구, 끝나지 않으면 시간 초과 뒤 중지·삭제하고 삭제 실패는 cleanup false', async () => {
    const failed = sessionServer([{ statuses: [{ action: 'web_search' }] }, { error: true, done: true }])
    let result = await probeOpenWebUi(await serve(failed.handlers), 'agent-a', { sessionPollMs: 5 })
    expect(result.session).toMatchObject({ status: 200, doneMs: null, error: '작업 실패', cleanup: true, statuses: ['web_search'] })
    expect(failed.calls).toEqual({ stop: 0, delete: 1 })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined

    const stuck = sessionServer([{}], { 'DELETE /api/v1/chats/chat-1': json(500, { detail: 'boom' }) })
    result = await probeOpenWebUi(await serve(stuck.handlers), 'agent-a', { sessionPollMs: 5, deadlineMs: 1_500 })
    expect(result.session).toMatchObject({ status: 200, firstStatusMs: null, doneMs: null, error: '응답 시간 초과', cleanup: false })
    expect(stuck.calls.stop).toBe(1)
  })

  describe('서비스 계정 역할·기능 권한과 fetch_url 주입 조건 (S13-J 추가) — 역할·불린만', () => {
    const IDENTITY = ['owui-user-7f3a', 'svc@corp.example', '서비스 계정 실명']
    const agent = (meta: Record<string, unknown>, params: Record<string, unknown> = {}) => ({ 'GET /api/models': json(200, { data: [{ id: 'agent-a', info: { meta, params } }] }) })
    const perms = (features: Record<string, unknown>) => json(200, { id: IDENTITY[0], email: IDENTITY[1], name: IDENTITY[2], workspace: { tools: true }, features })

    it('일반 계정(관리자 확인 401): 기능 권한 그대로, web_search 권한이 없으면 fetch_url 조건 ❌', async () => {
      const { handlers } = sessionServer([{ done: true }], { ...agent({ toolIds: [], defaultFeatureIds: ['web_search'], capabilities: { web_search: true }, builtinTools: { web_search: true } }, { function_calling: 'native' }),
        'GET /api/v1/users/permissions': perms({ web_search: false, image_generation: true, code_interpreter: 'yes', api_keys: true }),
        'GET /api/v1/users/default/permissions': json(401, { detail: `Access prohibited for ${IDENTITY[1]}` }) })
      const result = await probeOpenWebUi(await serve(handlers), 'agent-a', { sessionPollMs: 5 })
      expect(result.account).toEqual({ role: 'user', features: { web_search: false, image_generation: true, code_interpreter: null } })
      expect(result.fetchUrl).toEqual([
        { name: 'session_id', ok: true }, { name: 'function_calling', ok: true }, { name: 'builtin_tools', ok: true }, { name: 'builtinTools.web_search', ok: true },
        { name: 'web.search.enable', ok: null }, { name: 'capabilities.web_search', ok: true }, { name: 'features.web_search', ok: true }, { name: 'permission.web_search', ok: false }])
      // 토큰·이름·이메일을 되돌려 주는 /api/v1/auths/는 부르지 않는다
      expect(seen.some((x) => x.path.startsWith('/api/v1/auths'))).toBe(false)
      const text = JSON.stringify(result)
      for (const leaked of IDENTITY) expect(text).not.toContain(leaked)
    })

    it('관리자(200)는 권한 검사를 항상 통과, 모델 설정이 막으면 해당 조건 ❌', async () => {
      const { handlers } = sessionServer([{ done: true }], { ...agent({ capabilities: { web_search: false, builtin_tools: false }, builtinTools: { web_search: false } }, { function_calling: 'legacy' }),
        'GET /api/v1/users/permissions': perms({ web_search: false }),
        'GET /api/v1/users/default/permissions': json(200, { features: { web_search: true } }) })
      const result = await probeOpenWebUi(await serve(handlers), 'agent-a', { sessionPollMs: 5 })
      expect(result.account).toEqual({ role: 'admin', features: { web_search: false, image_generation: null, code_interpreter: null } })
      expect(Object.fromEntries(result.fetchUrl.map((c) => [c.name, c.ok]))).toEqual({ session_id: true, function_calling: false, builtin_tools: false, 'builtinTools.web_search': false,
        'web.search.enable': null, 'capabilities.web_search': false, 'features.web_search': false, 'permission.web_search': true })
    })

    it('권한 조회가 막히고(403) 메타가 없으면 확인 불가, 세션이 거부되면 session_id ❌', async () => {
      const { handlers } = sessionServer([{}], { 'GET /api/models': json(200, { data: [{ id: 'agent-a' }] }),
        'GET /api/v1/users/permissions': json(403, { detail: IDENTITY[1] }), 'GET /api/v1/users/default/permissions': json(403, {}),
        'POST /api/chat/completions': (req, res, body) => 'session_id' in body ? json(400, {})(req, res, body) : sse(['[DONE]'])(req, res, body) })
      const result = await probeOpenWebUi(await serve(handlers), 'agent-a', { sessionPollMs: 5 })
      expect(result.account).toEqual({ role: null, features: { web_search: null, image_generation: null, code_interpreter: null }, error: 'HTTP 403 · 인증 거부' })
      expect(Object.fromEntries(result.fetchUrl.map((c) => [c.name, c.ok]))).toEqual({ session_id: false, function_calling: null, builtin_tools: null, 'builtinTools.web_search': null,
        'web.search.enable': null, 'capabilities.web_search': null, 'features.web_search': false, 'permission.web_search': null })
    })
  })

  it('생성 거부(400)·chat_id 없음·채팅 조회 실패는 각각 상태 코드와 고정 분류만', async () => {
    const cases: [Handler, Record<string, unknown>][] = [
      [json(400, { detail: `session rejected ${SECRET}` }), { status: 400, error: 'HTTP 400 · 형식 거부', cleanup: null }],
      [json(200, { status: true, detail: SECRET }), { status: 200, error: '응답 형식 오류', cleanup: null }],
    ]
    for (const [create, expected] of cases) {
      const { handlers } = sessionServer([{}], { 'POST /api/chat/completions': (req, res, body) => 'session_id' in body ? create(req, res, body) : sse(['[DONE]'])(req, res, body) })
      const result = await probeOpenWebUi(await serve(handlers), 'agent-a', { sessionPollMs: 5 })
      expect(result.session).toMatchObject(expected)
      expect(JSON.stringify(result)).not.toContain(SECRET)
      server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined
    }
    const missing = sessionServer([{}], { 'GET /api/v1/chats/chat-1': json(404, { detail: SECRET }) })
    const result = await probeOpenWebUi(await serve(missing.handlers), 'agent-a', { sessionPollMs: 5 })
    expect(result.session).toMatchObject({ status: 200, error: 'HTTP 404 · 찾을 수 없음', cleanup: true })
    expect(missing.calls).toEqual({ stop: 1, delete: 1 })
  })
})

describe('checkOpenWebUiAccess (연결 진단) — 모델 호출 없이 메타·접근·권한만', () => {
  const SECRET = 'sk-live-9f8e7d6c5b4a'
  it('도구·스킬 접근, 기본 터미널, 계정 역할, fetch_url 조건(session_id 제외)을 읽고 시험 호출·버전 조회는 하지 않는다', async () => {
    const settings = await serve({
      'GET /api/models': json(200, { data: [{ id: 'agent-a', info: { meta: { toolIds: ['web_tool', 'private_tool'], skillIds: ['skill_a'], defaultFeatureIds: [], terminalId: 'term-corp-1',
        capabilities: { web_search: true }, builtinTools: { skills: true } }, params: { function_calling: 'native', system: SECRET } } }] }),
      'GET /api/v1/tools/': json(200, [{ id: 'web_tool', name: '사내 도구' }]), 'GET /api/v1/skills/': json(200, [{ id: 'skill_a', is_active: true, description: SECRET }]),
      'GET /api/v1/users/permissions': json(200, { email: 'svc@corp.example', features: { web_search: true, image_generation: false } }),
      'GET /api/v1/users/default/permissions': json(401, {}),
    })
    const result = await checkOpenWebUiAccess(settings, 'agent-a')
    expect(result).toEqual({ model: 'agent-a', ms: expect.any(Number),
      meta: { found: true, toolIds: ['web_tool', 'private_tool'], defaultFeatureIds: [], capabilities: { web_search: true }, builtinTools: { skills: true }, terminal: true, terminalSource: 'model', knowledgeCount: 0, functionCalling: 'native' },
      access: { tools: { visible: 1, items: [{ id: 'web_tool', state: 'ok' }, { id: 'private_tool', state: 'denied' }] }, skills: { visible: 1, items: [{ id: 'skill_a', state: 'ok' }] } },
      account: { role: 'user', features: { web_search: true, image_generation: false, code_interpreter: null } },
      fetchUrl: [{ name: 'function_calling', ok: true }, { name: 'builtin_tools', ok: true }, { name: 'builtinTools.web_search', ok: true }, { name: 'web.search.enable', ok: null },
        { name: 'capabilities.web_search', ok: true }, { name: 'features.web_search', ok: true }, { name: 'permission.web_search', ok: true }] })
    expect(seen.map((x) => x.path).filter((path) => path === '/api/chat/completions' || path === '/api/version')).toEqual([])
    expect(JSON.stringify(result)).not.toMatch(/sk-live|corp|사내/)
  })

  it('모델 목록에 없는 모델은 거부하고, 목록을 못 읽으면 메타 오류와 확인 불가로 돌려준다', async () => {
    let settings = await serve({ 'GET /api/models': json(200, { data: [{ id: 'agent-a' }] }) })
    await expect(checkOpenWebUiAccess(settings, 'no-such')).rejects.toBeInstanceOf(OwuiProbeUnknownModelError)
    server!.closeAllConnections(); await new Promise((resolve) => server!.close(resolve)); server = undefined
    settings = await serve({ 'GET /api/models': json(500, {}) })
    const result = await checkOpenWebUiAccess(settings, 'agent-a')
    expect(result.meta).toMatchObject({ found: false, error: 'HTTP 500 · 서버 오류' })
    expect(result.account).toMatchObject({ role: null, error: 'HTTP 404 · 찾을 수 없음' })
    expect(result.fetchUrl.every((c) => c.name === 'features.web_search' ? c.ok === false : c.ok === null)).toBe(true)
  })
})


describe('terminal defaults', () => {
  const terminals = [{ id: 'model' }, { id: 'global' }]
  it('does not start terminal discovery after the diagnostic deadline expires', async () => {
    const fetcher = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetcher)
    await checkOpenWebUiAccess({ mode: 'live', baseUrl: 'https://expired.example/api', apiKey: '', model: 'm' }, 'm', { deadlineMs: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('disables the mutually exclusive code interpreter when a terminal is selected, like MessageInput.svelte', () => {
    const meta = { defaultFeatureIds: ['code_interpreter', 'web_search'], capabilities: { code_interpreter: true, web_search: true } }
    expect(owuiDefaults(meta, '', [], { terminals: [{ id: 'only' }] })).toEqual({ terminal_id: 'only', features: { web_search: true } })
    expect(owuiDefaults(meta)).toEqual({ features: { code_interpreter: true, web_search: true } })
  })
  it.each([
    [{ terminalId: 'model' }, 'global', terminals, 'model', 'model'],
    [{}, 'global', terminals, 'global', 'global'],
    [undefined, null, [{ id: 'only' }], 'only', 'single'],
    [{}, null, terminals, undefined, 'none'],
    [{}, null, [], undefined, 'none'],
    [{ terminalId: 'model', capabilities: { terminal: false } }, 'global', terminals, undefined, 'none'],
    [{ terminalId: 'missing' }, 'global', terminals, 'global', 'global'],
    [{}, 'missing', [{ id: 'only' }], undefined, 'none'],
  ])('resolves model/global/single/none: %j', (meta, defaultTerminalId, terminals, id, source) => {
    const fallback = { defaultTerminalId, terminals }
    expect(owuiDefaults(meta, '', [], fallback).terminal_id).toBe(id)
    expect(owuiTerminal(meta, fallback)).toEqual({ id, source })
  })
  it('does not infer a single terminal from invalid or duplicate entries', () => {
    expect(owuiTerminal(undefined, { terminals: [{ id: '' }] }).source).toBe('none')
    expect(owuiTerminal(undefined, { terminals: [{ id: 'one' }, { id: 'one' }] }).source).toBe('none')
  })
  it('uses the same global selection in diagnostics and legacy/session trial bodies', async () => {
    const settings: LlmSettings = { mode: 'live', baseUrl: 'https://probe.example/api', apiKey: 'probe-key', model: 'm' }
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] })
      if (url.endsWith('/terminals/')) return Response.json([{ id: 'global', name: 'Terminal', url: 'https://private' }])
      if (url.endsWith('/chat/completions')) { bodies.push(JSON.parse(String(init?.body))); return new Response('data: [DONE]\n\n') }
      return new Response('', { status: 404 })
    }))
    const result = await probeOpenWebUi(settings, 'm', { defaultTerminalId: 'global' })
    expect(result.meta).toMatchObject({ terminalSource: 'global' })
    const enhanced = bodies.slice(1)
    expect(enhanced).toHaveLength(2)
    for (const row of enhanced) expect(row.terminal_id).toBe('global')
    expect(JSON.stringify(result)).not.toContain('https://private')
  })
})
