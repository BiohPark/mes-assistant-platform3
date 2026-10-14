import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest } from './provider.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'top-secret', model: 'm' }
const models = { data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], defaultFeatureIds: ['web_search'] } } }] }
const req: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hello' }], files: [{ type: 'file', id: 'f1' }], owuiMode: 'auto' }
const sse = () => new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
const created = (chatId = 'chat-1') => new Response(JSON.stringify({ status: true, task_ids: ['t1'], chat_id: chatId }), { headers: { 'content-type': 'application/json' } })
const provider = () => new OpenAICompatibleProvider(settings, undefined, { sessionPollMs: 1 })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

interface State { content?: string; reasoning?: string; statuses?: string[]; done?: boolean; error?: boolean; raw?: unknown; message?: Record<string, unknown> }
/** OpenWebUI v0.12 채팅 메시지 모양 — 본문은 output의 message 항목, 생각은 reasoning 항목 */
function message(id: string, state: State) {
  return { id, role: 'assistant', content: state.content ?? '', done: state.done ?? false,
    output: [...(state.reasoning ? [{ type: 'reasoning', content: [{ type: 'output_text', text: state.reasoning }] }] : []),
      ...(state.content ? [{ type: 'message', content: [{ type: 'output_text', text: state.content }] }] : [])],
    ...(state.statuses ? { statusHistory: state.statuses.map(description => ({ description, done: false })) } : {}),
    ...(state.error ? { error: { content: 'private upstream detail https://internal.example' } } : {}) }
}

/** completions(생성)·채팅 GET(상태 순서대로, 끝 상태 유지)·stop·DELETE를 흉내 낸다 */
function upstream(states: State[], create: (body: Record<string, unknown>, count: number) => Response | Promise<Response> = () => created()) {
  let posts = 0, polls = 0
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    if (path === '/api/models') return new Response(JSON.stringify(models))
    if (path === '/api/chat/completions') return create(JSON.parse(String(init.body)), ++posts)
    const chat = /^\/api\/v1\/chats\/([^/]+)$/.exec(path)
    if (chat && (init.method ?? 'GET') === 'GET') {
      const body = JSON.parse(String(fetcher.mock.calls.find(([u]) => String(u).endsWith('/chat/completions'))![1]!.body))
      const state = states[Math.min(polls++, states.length - 1)]!
      if (state.raw !== undefined) return new Response(JSON.stringify(state.raw))
      return new Response(JSON.stringify({ id: chat[1], chat: { history: { messages: { [body.id]: state.message ?? message(body.id, state) } } } }))
    }
    if (chat && init.method === 'DELETE') return new Response('true')
    if (/^\/api\/tasks\/chat\/[^/]+\/stop$/.test(path) && init.method === 'POST') return new Response('{"status":true}')
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const calls = (fetcher: ReturnType<typeof upstream>, method: string, pattern: RegExp) =>
  fetcher.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && pattern.test(new URL(String(url)).pathname))
const bodies = (fetcher: ReturnType<typeof upstream>) => calls(fetcher, 'POST', /\/chat\/completions$/).map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
const collect = async (input: ChatRequest = req, p = provider()) => { const out = []; for await (const chunk of p.stream(input)) out.push(chunk); return out }

describe('OpenWebUI session mode', () => {
  it('creates a background chat with our messages only, polls it and turns growth into deltas', async () => {
    const fetcher = upstream([{ statuses: ['URL 읽는 중'] }, { statuses: ['URL 읽는 중'], reasoning: '검토' }, { statuses: ['URL 읽는 중'], reasoning: '검토 끝', content: '안녕' },
      { statuses: ['URL 읽는 중'], reasoning: '검토 끝', content: '안녕하세요', done: true }])
    const onDispatch = vi.fn(), onSession = vi.fn()
    expect(await collect({ ...req, onDispatch, onSession })).toEqual([{ type: 'status', text: 'URL 읽는 중' }, { type: 'reasoning', text: '검토' },
      { type: 'reasoning', text: ' 끝' }, { type: 'delta', text: '안녕' }, { type: 'delta', text: '하세요' }, { type: 'done' }])
    const [body] = bodies(fetcher)
    expect(body).toEqual({ model: 'm', messages: req.messages, files: req.files, stream: true, tool_ids: ['lookup'], features: { web_search: true },
      session_id: expect.stringMatching(/^mes-/), id: expect.any(String), parent_id: null, params: { tool_approval_mode: 'full' } })
    expect(body).not.toHaveProperty('user_message')
    expect(body).not.toHaveProperty('chat_id')
    expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ mode: 'tools', tool_ids: ['lookup'], features: { web_search: true } }, body)
    expect(onSession).toHaveBeenCalledExactlyOnceWith('chat-1')
    expect(calls(fetcher, 'GET', /\/v1\/chats\/chat-1$/).length).toBeGreaterThanOrEqual(4)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\/chat-1$/)).toHaveLength(1)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(0)
  })
  it('emits replace when the accumulated text is not an extension of what was sent', async () => {
    upstream([{ content: '임시 답변', reasoning: '처음' }, { content: '최종 답변', reasoning: '다시', done: true }])
    expect(await collect()).toEqual([{ type: 'reasoning', text: '처음' }, { type: 'delta', text: '임시 답변' },
      { type: 'replace', field: 'reasoning', text: '다시' }, { type: 'replace', field: 'content', text: '최종 답변' }, { type: 'done' }])
  })
  it('emits a status chunk for every new status entry (liveness) even when the text repeats', async () => {
    upstream([{ statuses: ['검색 중'] }, { statuses: ['검색 중'] }, { statuses: ['검색 중', '검색 중'] }, { statuses: ['검색 중', '검색 중'], content: 'OK', done: true }])
    expect(await collect()).toEqual([{ type: 'status', text: '검색 중' }, { type: 'status', text: '검색 중' }, { type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it('reports every status added between two polls, so a short step is not lost (URL 읽는 중 → URL 읽음)', async () => {
    upstream([{}, { statuses: ['URL 읽는 중', 'URL 읽음'], content: 'OK', done: true }])
    expect(await collect()).toEqual([{ type: 'status', text: 'URL 읽는 중' }, { type: 'status', text: 'URL 읽음' }, { type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it('keeps hidden-only status growth as a liveness signal with the last visible status', async () => {
    upstream([{ statuses: ['검색 중'] }, { raw: undefined, message: { done: false, output: [], statusHistory: [{ description: '검색 중' }, { description: 'internal', hidden: true }] } },
      { content: 'OK', done: true, statuses: ['검색 중', '검색 중'] }])
    expect(await collect()).toEqual([{ type: 'status', text: '검색 중' }, { type: 'status', text: '검색 중' }, { type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it('falls back to message.content when output carries no message item', async () => {
    upstream([{ raw: { chat: { history: { messages: {} } } } }, { message: { content: '본문만', output: [], done: true } }])
    expect(await collect()).toEqual([{ type: 'delta', text: '본문만' }, { type: 'done' }])
  })
  it('turns a message error into a fixed error without exposing upstream detail, then deletes the chat', async () => {
    const fetcher = upstream([{ content: '부분' }, { content: '부분', error: true, done: true }])
    const chunks = await collect()
    expect(chunks).toEqual([{ type: 'delta', text: '부분' }, { type: 'error', message: 'LLM 서비스 오류 (OpenWebUI 작업 실패)' }])
    expect(JSON.stringify(chunks)).not.toMatch(/private|internal/)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(0)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\/chat-1$/)).toHaveLength(1)
  })
  it('keeps the chat when cleanup is off', async () => {
    const fetcher = upstream([{ content: 'OK', done: true }])
    await collect({ ...req, owuiCleanup: false })
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\//)).toHaveLength(0)
  })
  it('stops the background task and deletes the chat on abort, without waiting for the consumer', async () => {
    const controller = new AbortController()
    const fetcher = upstream([{ content: '진행 중' }])
    const p = new OpenAICompatibleProvider(settings, undefined, { sessionPollMs: 5 })
    const iterator = p.stream({ ...req, signal: controller.signal })[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual({ type: 'delta', text: '진행 중' })
    const pending = iterator.next()
    controller.abort('cancelled')
    expect((await pending).value).toEqual({ type: 'error', message: '요청이 취소되었습니다.' })
    expect(calls(fetcher, 'POST', /\/api\/tasks\/chat\/chat-1\/stop$/)).toHaveLength(1)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\/chat-1$/)).toHaveLength(1)
    await iterator.return?.(undefined)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(1)
  })
  it('stops the task when the consumer returns early', async () => {
    const fetcher = upstream([{ content: '진행 중' }])
    const iterator = provider().stream(req)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.(undefined)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(1)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\//)).toHaveLength(1)
  })
  it('fails after repeated poll failures and stops the task', async () => {
    const fetcher = upstream([{ raw: 'not a chat' }])
    expect(await collect()).toEqual([{ type: 'error', message: 'LLM 서비스 응답 확인 실패 (OpenWebUI 채팅 조회)' }])
    expect(calls(fetcher, 'GET', /\/v1\/chats\//)).toHaveLength(5)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(1)
  })
  it.each([400, 401, 403, 404, 422])('auto falls back to the direct request when creation is rejected with HTTP %i', async status => {
    const fetcher = upstream([], (_, count) => count === 1 ? new Response('private', { status }) : sse())
    const onDispatch = vi.fn(), onSession = vi.fn()
    expect(await collect({ ...req, onDispatch, onSession })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    const sent = bodies(fetcher)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toHaveProperty('session_id')
    expect(sent[1]).toEqual({ model: 'm', messages: req.messages, files: req.files, stream: true, tool_ids: ['lookup'], features: { web_search: true }, params: { function_calling: 'legacy' } })
    expect(onDispatch).toHaveBeenCalledTimes(2)
    expect(onSession).not.toHaveBeenCalled()
  })
  it.each([{}, { chat_id: '' }, { chat_id: 3 }, []])('auto falls back when the creation response has another shape: %j', async shape => {
    const fetcher = upstream([], (_, count) => count === 1 ? new Response(JSON.stringify(shape)) : sse())
    expect(await collect()).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toHaveLength(2)
  })
  it('consumes a streamed answer to the session request instead of sending it again', async () => {
    const fetcher = upstream([], () => sse())
    expect(await collect()).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it.each([500, 502, 503])('never falls back after HTTP %i (execution not ruled out)', async status => {
    const fetcher = upstream([], () => new Response('private', { status }))
    expect(await collect()).toEqual([{ type: 'error', message: `LLM 서비스 오류 (HTTP ${status})` }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it('never falls back after a transport error', async () => {
    const fetcher = upstream([], () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ECONNREFUSED' }) }) })
    expect(await collect()).toEqual([{ type: 'error', message: 'LLM 서비스 연결 오류' }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it('forced session mode reports rejection and shape errors instead of falling back', async () => {
    let fetcher = upstream([], () => new Response('private', { status: 400 }))
    expect(await collect({ ...req, owuiMode: 'session' })).toEqual([{ type: 'error', message: 'LLM 서비스 오류 (HTTP 400)' }])
    expect(bodies(fetcher)).toHaveLength(1)
    fetcher = upstream([], () => new Response('{}'))
    expect(await collect({ ...req, owuiMode: 'session' })).toEqual([{ type: 'error', message: 'LLM 서비스 응답 형식 오류' }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it('sends no tool metadata in session mode when tool delivery is off', async () => {
    const fetcher = upstream([{ content: 'OK', done: true }])
    const onDispatch = vi.fn()
    await collect({ ...req, owuiTools: 'off', onDispatch })
    expect(bodies(fetcher)[0]).not.toHaveProperty('tool_ids')
    expect(bodies(fetcher)[0]).toMatchObject({ session_id: expect.any(String), parent_id: null })
    expect(onDispatch.mock.calls[0]![0]).toEqual({ mode: 'basic' })
  })
  it.each<[string, Partial<ChatRequest>]>([['direct mode', { owuiMode: 'direct' }], ['unset mode', { owuiMode: undefined }], ['app tools', { tools: [{ type: 'function', function: { name: 'f', description: '', parameters: {} } }] }],
    ['probe limits', { limits: { timeoutMs: 5_000 } }]])('keeps the direct request for %s', async (_, override) => {
    const fetcher = upstream([], () => sse())
    await collect({ ...req, ...override })
    expect(bodies(fetcher)).toHaveLength(1)
    expect(bodies(fetcher)[0]).not.toHaveProperty('session_id')
  })
  it('keeps the direct request for the OpenAI-compatible preset', async () => {
    const fetcher = upstream([], () => sse())
    await collect(req, new OpenAICompatibleProvider({ ...settings, preset: 'openai-compatible' }, undefined, { sessionPollMs: 1 }))
    expect(bodies(fetcher)[0]).not.toHaveProperty('session_id')
  })
})
