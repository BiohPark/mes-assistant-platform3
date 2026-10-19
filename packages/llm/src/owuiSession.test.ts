import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest } from './provider.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'top-secret', model: 'm' }
const models = { data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], defaultFeatureIds: ['web_search'], capabilities: { web_search: true } } } }] }
const req: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hello' }], files: [{ type: 'file', id: 'f1' }], owuiMode: 'auto' }
const sse = () => new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
const created = (chatId = 'chat-1') => new Response(JSON.stringify({ status: true, task_ids: ['t1'], chat_id: chatId }), { headers: { 'content-type': 'application/json' } })
const provider = () => new OpenAICompatibleProvider(settings, undefined, { sessionPollMs: 1 })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** tasks: 그 폴링 차례의 /api/tasks/chat/{id} 진행 작업(없으면 404 — 엔드포인트 없는 OpenWebUI) */
interface State { content?: string; reasoning?: string; statuses?: string[]; done?: boolean; error?: boolean; raw?: unknown; message?: Record<string, unknown>; tasks?: string[]; output?: Record<string, unknown>[] }
/** OpenWebUI v0.12 채팅 메시지 모양 — 본문은 output의 message 항목, 생각은 reasoning 항목 */
function message(id: string, state: State) {
  return { id, role: 'assistant', content: state.content ?? '', done: state.done ?? false,
    output: [...(state.reasoning ? [{ type: 'reasoning', content: [{ type: 'output_text', text: state.reasoning }] }] : []),
      ...(state.content ? [{ type: 'message', content: [{ type: 'output_text', text: state.content }] }] : []), ...(state.output ?? [])],
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
    if (/^\/api\/tasks\/chat\/[^/]+$/.test(path) && (init.method ?? 'GET') === 'GET') {
      const tasks = states[Math.min(polls, states.length - 1)]!.tasks
      return tasks ? new Response(JSON.stringify({ task_ids: tasks })) : new Response('', { status: 404 })
    }
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
    expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ mode: 'tools', tool_ids: ['lookup'], features: { web_search: true }, terminalSource: 'none' }, body)
    expect(onSession).toHaveBeenCalledExactlyOnceWith('chat-1')
    expect(calls(fetcher, 'GET', /\/v1\/chats\/chat-1$/).length).toBeGreaterThanOrEqual(4)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\/chat-1$/)).toHaveLength(1)
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(0)
  })
  it('includes the model default terminal (terminal_id) in the session body (S13-J)', async () => {
    const fetcher = upstream([{ content: 'OK', done: true }])
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], skillIds: ['skill_a'], defaultFilterIds: ['filter_a'], terminalId: 'term-1' } } }] })))
    await collect()
    expect(bodies(fetcher)[0]).toMatchObject({ tool_ids: ['lookup'], skill_ids: ['skill_a'], filter_ids: ['filter_a'], terminal_id: 'term-1', session_id: expect.stringMatching(/^mes-/), params: { tool_approval_mode: 'full' } })
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
    expect(onDispatch.mock.calls[0]![0]).toEqual({ mode: 'basic', terminalSource: 'none' })
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

/** 본문이 멈춘 뒤 OpenWebUI가 하는 일(도구·코드·후처리)을 단계로 알리고, done이 끝내 오지 않아도 작업이 끝나면 정리한다 */
describe('OpenWebUI session mode — work after the text stops', () => {
  const settled = () => new OpenAICompatibleProvider(settings, undefined, { sessionPollMs: 1, sessionSettleMs: 0 })
  const tool = (name: string, callId = 'c1') => ({ type: 'function_call', call_id: callId, name, arguments: '{}', status: 'in_progress' })
  const toolOutput = (callId = 'c1') => ({ type: 'function_call_output', call_id: callId, output: [], status: 'completed' })

  it('says the answer is being finished when the text stops but the chat is not done (once per stall)', async () => {
    upstream([{ content: '답변' }, { content: '답변' }, { content: '답변' }, { content: '답변 끝', done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '답변' }, { type: 'status', text: '답변 마무리 중' },
      { type: 'delta', text: ' 끝' }, { type: 'done' }])
  })
  it('names the running tool (function_call without output — middleware.py 5997-6005, 6158-6168), then resumes the answer', async () => {
    upstream([{ content: '앞부분' }, { content: '앞부분', output: [tool('search_docs')] }, { content: '앞부분', output: [tool('search_docs')] },
      { content: '앞부분', output: [{ ...tool('search_docs'), status: 'completed' }, toolOutput()] },
      { message: { done: true, output: [{ type: 'message', content: [{ type: 'output_text', text: '앞부분' }] }, { ...tool('search_docs'), status: 'completed' }, toolOutput(),
        { type: 'message', content: [{ type: 'output_text', text: '뒷부분' }] }] } }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '앞부분' }, { type: 'status', text: '도구 실행 중: search_docs' },
      { type: 'status', text: '답변 마무리 중' }, { type: 'delta', text: '\n뒷부분' }, { type: 'done' }])
  })
  it('reports a running tool even before any text, without the finishing label', async () => {
    upstream([{ output: [tool('lookup')] }, { output: [tool('lookup')] }, { content: 'OK', done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'status', text: '도구 실행 중: lookup' }, { type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it('reports code execution (open_webui:code_interpreter in progress — middleware.py 4645-4658)', async () => {
    const running = { type: 'open_webui:code_interpreter', status: 'in_progress', code: 'print(1)', output: null }
    upstream([{ content: '계산합니다', output: [running] }, { content: '계산합니다 결과 1', output: [{ ...running, status: 'completed', output: {} }], done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '계산합니다' }, { type: 'status', text: '코드 실행 중' },
      { type: 'delta', text: ' 결과 1' }, { type: 'done' }])
  })
  it('an OpenWebUI status shown in the same poll wins over a derived label', async () => {
    upstream([{ content: '답' }, { content: '답', statuses: ['웹 검색 중'] }, { content: '답', statuses: ['웹 검색 중'] }, { content: '답', done: true, statuses: ['웹 검색 중'] }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '답' }, { type: 'status', text: '웹 검색 중' }, { type: 'done' }])
  })
  it('finishes when the OpenWebUI task has ended even though done never came (main.py 1755-1759, middleware.py 4309-4312)', async () => {
    const fetcher = upstream([{ content: '완성된 답', tasks: ['t1'] }, { content: '완성된 답', tasks: ['t1'] }, { content: '완성된 답', tasks: [] }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '완성된 답' }, { type: 'status', text: '답변 마무리 중' }, { type: 'done' }])
    expect(calls(fetcher, 'POST', /\/stop$/)).toHaveLength(0)
    expect(calls(fetcher, 'DELETE', /\/v1\/chats\/chat-1$/)).toHaveLength(1)
  })
  it('turns an ended task with no answer and no done into an error', async () => {
    upstream([{ tasks: ['t1'] }, { tasks: [] }])
    expect(await collect(req, settled())).toEqual([{ type: 'error', message: 'LLM 서비스 응답 없음 (OpenWebUI 작업이 답 없이 끝남)' }])
  })
  it('does not finish early while the task list still shows the task, and ignores an OpenWebUI without the task endpoint', async () => {
    const fetcher = upstream([{ content: 'A', tasks: ['t1'] }, { content: 'A', tasks: ['t1'] }, { content: 'A', tasks: ['t1'] }, { content: 'AB', done: true, tasks: ['t1'] }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: 'A' }, { type: 'status', text: '답변 마무리 중' },
      { type: 'status', text: 'OpenWebUI에서 작업 중 · 답변 마무리 중' }, { type: 'delta', text: 'B' }, { type: 'done' }])
    expect(calls(fetcher, 'GET', /\/api\/tasks\/chat\/chat-1$/).length).toBeGreaterThan(0)
    const missing = upstream([{ content: 'A' }, { content: 'A' }, { content: 'A' }, { content: 'AB', done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: 'A' }, { type: 'status', text: '답변 마무리 중' }, { type: 'delta', text: 'B' }, { type: 'done' }])
    expect(calls(missing, 'GET', /\/api\/tasks\/chat\/chat-1$/)).toHaveLength(1)
  })
  it('waits for the settle window before calling the text finished', async () => {
    upstream([{ content: '답변' }, { content: '답변' }, { content: '답변', done: true }])
    expect(await collect(req, provider())).toEqual([{ type: 'delta', text: '답변' }, { type: 'done' }])
  })
  it('while the task stays active and nothing changes, repeats the working phase on every check (liveness) — tool before any text', async () => {
    const running = { output: [tool('slow_tool')], tasks: ['t1'] }
    upstream([running, running, running, running, running, running, { content: '도구 결과로 답', done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'status', text: '도구 실행 중: slow_tool' },
      ...Array.from({ length: 4 }, () => ({ type: 'status', text: 'OpenWebUI에서 작업 중 · 도구 실행 중: slow_tool' })),
      { type: 'delta', text: '도구 결과로 답' }, { type: 'done' }])
  })
  it('treats an output change (tool result) without new text as progress and re-sends the phase', async () => {
    upstream([{ content: '앞' }, { content: '앞', output: [tool('t')] }, { content: '앞', output: [{ ...tool('t'), arguments: '{"q":1}' }] }, { content: '앞뒤', done: true }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '앞' }, { type: 'status', text: '도구 실행 중: t' }, { type: 'status', text: '도구 실행 중: t' },
      { type: 'delta', text: '뒤' }, { type: 'done' }])
  })
  it('keeps the shown answer when the ended task leaves an empty stored message (stream text lived only in response_streams)', async () => {
    upstream([{ content: '보인 답', tasks: ['t1'] }, { content: '보인 답', tasks: ['t1'] }, { content: '', tasks: [] }])
    expect(await collect(req, settled())).toEqual([{ type: 'delta', text: '보인 답' }, { type: 'status', text: '답변 마무리 중' }, { type: 'done' }])
  })
})

it('streams indexed steps in output order even when a complete tool call passes between polls', async () => {
  upstream([{}, { done: true, output: [
    { type: 'reasoning', content: [{ text: '검토' }] }, { type: 'message', content: [{ text: '먼저' }] },
    { type: 'function_call', call_id: 'a', name: 'lookup', arguments: '{"q":1}' },
    { type: 'function_call_output', call_id: 'a', output: '원문 결과' }, { type: 'message', content: [{ text: '나중' }] },
  ] }])
  const onStep = vi.fn()
  await collect({ ...req, onStep })
  expect(onStep.mock.calls.map(([index, step]) => [index, step.type])).toEqual([[0, 'reasoning'], [1, 'text'], [2, 'tool'], [3, 'text']])
  expect(onStep.mock.calls[2]?.[1]).toMatchObject({ name: 'lookup', output: '원문 결과', status: 'done' })
})

it('removes stale trailing steps when the upstream revises a shorter nonempty output', async () => {
  upstream([{ output: [{ type: 'message', content: [{ text: '앞' }] }, { type: 'reasoning', content: [{ text: '옛 생각' }] }] },
    { done: true, output: [{ type: 'message', content: [{ text: '앞' }] }] }])
  const onStep = vi.fn()
  await collect({ ...req, onStep })
  expect(onStep.mock.calls.at(-1)).toEqual([0, { type: 'text', text: '앞' }, 1])
})

it('projects content details into ordered steps and retains the final polling JSON before cleanup', async () => {
  const final = { done: true, content: '<details type="reasoning" done="true"><summary>Think</summary>private thought</details>**answer**', statusHistory: [{ description: 'done' }], files: [], output: [] }
  upstream([{ message: { ...final, done: false } }, { message: final }])
  const onRawResponse = vi.fn(), onStep = vi.fn()
  const chunks = await collect({ ...req, onRawResponse, onStep })
  expect(chunks).toContainEqual({ type: 'reasoning', text: 'private thought' })
  expect(chunks).toContainEqual({ type: 'delta', text: '**answer**' })
  expect(onStep).toHaveBeenCalledWith(0, { type: 'reasoning', text: 'private thought' }, 2)
  expect(onRawResponse).toHaveBeenLastCalledWith({ mode: 'session', message: final })
})
