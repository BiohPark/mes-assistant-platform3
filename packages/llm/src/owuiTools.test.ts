import { LimitedFetchError } from './limitedFetch.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest } from './provider.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import { owuiDefaults } from './owuiProbe.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'top-secret', model: 'm' }
const meta = { data: [{ id: 'm', info: { meta: { toolIds: ['lookup', 'server:mcp:search', 'https://private', 'sk-secret', 'top-secret', 3], defaultFeatureIds: ['web_search', 'code_interpreter', '../private'],
  capabilities: { web_search: true, code_interpreter: true } } } }] }
const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hello' }], files: [{ type: 'file' as const, id: 'f1' }] }
const ok = () => new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')
const collect = async (provider: OpenAICompatibleProvider, input: ChatRequest = req) => { const out = []; for await (const chunk of provider.stream(input)) out.push(chunk); return out }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function upstream(reply: (init: RequestInit, count: number) => Response | Promise<Response> = () => ok(), models: unknown = meta) {
  let posts = 0
  const fetcher = vi.fn(async (url: string, init: RequestInit) => url.endsWith('/models') ? new Response(JSON.stringify(models)) : reply(init, ++posts))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const bodies = (fetcher: ReturnType<typeof upstream>) => fetcher.mock.calls.filter(([url]) => url.endsWith('/chat/completions')).map(([, init]) => JSON.parse(String(init.body)))

describe('owuiDefaults — OpenWebUI 화면이 모델을 고를 때 채우는 기본값 (S13-J, Chat.svelte 1117-1206·4097-4170)', () => {
  const full = { toolIds: ['lookup', 'server:mcp:search', 'sk-secret'], skillIds: ['skill_a', 'sk-skill-secret', 'skill_a'], defaultFilterIds: ['filter_a', '../x'],
    defaultFeatureIds: ['web_search', 'image_generation', 'code_interpreter', 'memory', 'custom_x'], capabilities: { web_search: true, image_generation: false, code_interpreter: true, memory: true },
    terminalId: 'term-1', knowledge: [{ id: 'kb' }], suggestion_prompts: [{ content: 'x' }] }
  it('tool_ids·skill_ids·filter_ids는 허용 목록 ID 그대로, features는 기본 기능 ∩ 켜진 capability, terminal_id는 terminal capability가 끔이 아닐 때', () => {
    expect(owuiDefaults(full)).toEqual({ tool_ids: ['lookup', 'server:mcp:search'], skill_ids: ['skill_a'], filter_ids: ['filter_a'],
      features: { web_search: true, code_interpreter: true, memory: true }, terminal_id: 'term-1' })
  })
  it('각 필드는 따로 정해진다 — 빈 배열·빈 features는 생략', () => {
    expect(owuiDefaults({ toolIds: ['lookup'] })).toEqual({ tool_ids: ['lookup'] })
    expect(owuiDefaults({ skillIds: ['skill_a'] })).toEqual({ skill_ids: ['skill_a'] })
    expect(owuiDefaults({ defaultFilterIds: ['filter_a'] })).toEqual({ filter_ids: ['filter_a'] })
    expect(owuiDefaults({ defaultFeatureIds: ['web_search'], capabilities: { web_search: true } })).toEqual({ features: { web_search: true } })
    // capability가 없거나 꺼져 있으면 화면처럼 켜지 않는다
    expect(owuiDefaults({ defaultFeatureIds: ['web_search', 'image_generation'], capabilities: { image_generation: false } })).toEqual({})
    expect(owuiDefaults({ terminalId: 'term-1' })).toEqual({ terminal_id: 'term-1' })
    expect(owuiDefaults({ terminalId: 'term-1', capabilities: { terminal: false } })).toEqual({})
    expect(owuiDefaults({ toolIds: [], skillIds: [], defaultFilterIds: [], defaultFeatureIds: [] })).toEqual({})
    expect(owuiDefaults(undefined)).toEqual({})
  })
})

describe('OpenWebUI automatic tool delivery', () => {
  it.each(['direct', 'session'] as const)('%s: URL in the last user message enables capable web search without a model default, and records the exact body', async owuiMode => {
    const fetcher = upstream(undefined, { data: [{ id: 'm', info: { meta: { defaultFeatureIds: ['memory'], capabilities: { web_search: true, memory: true } } } }] })
    const p = new OpenAICompatibleProvider(settings)
    for (const content of ['https://example.com 요약', '다음 질문', 'HTTP://example.com/page']) {
      const onDispatch = vi.fn()
      await collect(p, { ...req, owuiMode, messages: [{ role: 'user', content }], onDispatch })
      const body = bodies(fetcher).at(-1)!
      const features = { memory: true, ...(/https?:/i.test(content) ? { web_search: true } : {}) }
      expect(body.features).toEqual(features)
      expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ mode: 'tools', features }, body)
    }
  })
  it.each([false, undefined, 'true'])('does not auto-enable web search unless capability is strictly true: %s', async capability => {
    const fetcher = upstream(undefined, { data: [{ id: 'm', info: { meta: { capabilities: { web_search: capability } } } }] })
    await collect(new OpenAICompatibleProvider(settings), { ...req, messages: [{ role: 'user', content: 'https://example.com' }] })
    expect(bodies(fetcher)[0]).not.toHaveProperty('features')
  })
  it.each([
    [{ role: 'system' as const, content: 'https://example.com' }, { role: 'user' as const, content: '질문' }],
    [{ role: 'user' as const, content: 'https://example.com' }, { role: 'assistant' as const, content: '답변' }, { role: 'user' as const, content: '다음' }],
    [{ role: 'user' as const, content: '질문' }, { role: 'tool' as const, content: 'https://example.com' }],
    [{ role: 'user' as const, content: 'ftp://example.com http:// https://' }],
  ])('ignores URLs outside the last user message or without an HTTP host: %j', async (...messages) => {
    const fetcher = upstream(undefined, { data: [{ id: 'm', info: { meta: { capabilities: { web_search: true } } } }] })
    await collect(new OpenAICompatibleProvider(settings), { ...req, messages })
    expect(bodies(fetcher)[0]).not.toHaveProperty('features')
  })
  it('sends every model default the screen would (skills, filters, capability-gated features, terminal) and no user variables (S13-J)', async () => {
    const fetcher = upstream(undefined, { data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], skillIds: ['skill_a'], defaultFilterIds: ['filter_a'], defaultFeatureIds: ['web_search', 'image_generation'],
      capabilities: { web_search: true }, terminalId: 'term-1', knowledge: [{ id: 'kb' }] } } }] })
    const onDispatch = vi.fn()
    await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })
    const body = bodies(fetcher)[0]
    expect(body).toEqual({ ...req, stream: true, tool_ids: ['lookup'], skill_ids: ['skill_a'], filter_ids: ['filter_a'], features: { web_search: true }, terminal_id: 'term-1', params: { function_calling: 'legacy' } })
    expect(onDispatch).toHaveBeenCalledWith({ mode: 'tools', tool_ids: ['lookup'], features: { web_search: true } }, body)
  })
  it('a model with no defaults is sent the basic way', async () => {
    const fetcher = upstream(undefined, { data: [{ id: 'm', info: { meta: { toolIds: [], skillIds: [], defaultFeatureIds: ['web_search'] } } }] })
    const onDispatch = vi.fn()
    await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })
    expect(bodies(fetcher)[0]).toEqual({ ...req, stream: true })
    expect(onDispatch.mock.calls[0]![0]).toEqual({ mode: 'basic' })
  })
  it('meta changes reach the next request once the short model cache (5 min) expires', async () => {
    let current: Record<string, unknown> = { toolIds: ['lookup'] }
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: 'm', info: { meta: current } }] })) : ok())
    vi.stubGlobal('fetch', fetcher)
    const provider = new OpenAICompatibleProvider(settings)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await collect(provider)
    current = { toolIds: ['lookup', 'new_tool'], skillIds: ['skill_b'], terminalId: 'term-2' }
    now.mockReturnValue(1_000_000 + 4 * 60_000)
    await collect(provider)
    now.mockReturnValue(1_000_000 + 5 * 60_000 + 1)
    await collect(provider)
    const sent = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions')).map(([, init]) => JSON.parse(String(init?.body)))
    expect(sent.map((body) => [body.tool_ids, body.skill_ids, body.terminal_id])).toEqual([[['lookup'], undefined, undefined], [['lookup'], undefined, undefined], [['lookup', 'new_tool'], ['skill_b'], 'term-2']])
  })

  it('uses allowlisted model metadata, leaves app tools unset, and records the dispatched body', async () => {
    const fetcher = upstream()
    const onDispatch = vi.fn()
    const provider = new OpenAICompatibleProvider(settings)
    expect(await collect(provider, { ...req, onDispatch })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    const body = bodies(fetcher)[0]
    expect(body).toEqual({ ...req, stream: true, tool_ids: ['lookup', 'server:mcp:search'], features: { web_search: true, code_interpreter: true }, params: { function_calling: 'legacy' } })
    expect(onDispatch).toHaveBeenCalledWith({ mode: 'tools', tool_ids: body.tool_ids, features: body.features }, body)
  })
  it('sends the model default terminal (meta.terminalId) like the OpenWebUI screen unless capabilities.terminal is false (S13-J)', async () => {
    const withTerminal = (extra: Record<string, unknown>) => ({ data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], ...extra } } }] })
    for (const [models, expected] of [
      [withTerminal({ terminalId: 'term-1' }), 'term-1'],
      [withTerminal({ terminalId: 'term-1', capabilities: { terminal: true } }), 'term-1'],
      [withTerminal({ terminalId: 'term-1', capabilities: { terminal: false } }), undefined],
      [withTerminal({ terminalId: '' }), undefined],
      [withTerminal({ terminalId: 3 }), undefined],
      [withTerminal({}), undefined],
    ] as const) {
      const fetcher = upstream(undefined, models)
      const onDispatch = vi.fn()
      await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })
      const body = bodies(fetcher)[0]
      if (expected) expect(body).toMatchObject({ tool_ids: ['lookup'], terminal_id: expected, params: { function_calling: 'legacy' } })
      else expect(body).not.toHaveProperty('terminal_id')
      // 전달 기록(owuiTools)은 도구·기능만 — 터미널은 snapshot이 본문에서 남긴다
      expect(onDispatch.mock.calls[0]![0]).toEqual({ mode: 'tools', tool_ids: ['lookup'] })
      vi.unstubAllGlobals()
    }
    // 터미널만 있어도 도구 전달 방식으로 보낸다
    const fetcher = upstream(undefined, withTerminal({ toolIds: [], terminalId: 'term-1' }))
    await collect(new OpenAICompatibleProvider(settings))
    expect(bodies(fetcher)[0]).toMatchObject({ terminal_id: 'term-1', params: { function_calling: 'legacy' } })
    for (const key of ['tool_ids', 'features']) expect(bodies(fetcher)[0]).not.toHaveProperty(key)
  })
  it('keeps every reasoning delta after legacy sources and preserves both attached files', async () => {
    const thoughts = ['PRIVATE_REASONING: 요청을 검토합니다. ', '자료를 비교합니다. ', '답변을 준비합니다.']
    const frames = [{ sources: [{ source: { id: 'fake-kb' } }] },
      ...thoughts.map(reasoning_content => ({ choices: [{ delta: { reasoning_content } }] })),
      { choices: [{ delta: { content: '첨부 확인 [files: 2]' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] }]
    const fetcher = upstream(() => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'))
    const input = { ...req, messages: [{ role: 'user' as const, content: '[reasoning] 첨부 확인' }], files: [{ type: 'file' as const, id: 'f1' }, { type: 'file' as const, id: 'f2' }] }
    expect(await collect(new OpenAICompatibleProvider(settings), input)).toEqual([
      ...thoughts.map(text => ({ type: 'reasoning', text })), { type: 'delta', text: '첨부 확인 [files: 2]' }, { type: 'done' },
    ])
    expect(bodies(fetcher)).toEqual([{ ...input, stream: true, tool_ids: ['lookup', 'server:mcp:search'], features: { web_search: true, code_interpreter: true }, params: { function_calling: 'legacy' } }])
  })
  it('reads global mode for every call, so off applies immediately despite cached metadata', async () => {
    let mode: 'auto' | 'off' = 'auto'
    const readMode = vi.fn(async () => mode)
    const fetcher = upstream()
    const provider = new OpenAICompatibleProvider(settings, readMode)
    await collect(provider)
    mode = 'off'
    await collect(provider)
    expect(readMode).toHaveBeenCalledTimes(2)
    expect(bodies(fetcher)[1]).not.toHaveProperty('tool_ids')
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/models'))).toHaveLength(1)
  })
  it('preserves explicit application function tools without loading OpenWebUI metadata', async () => {
    const fetcher = upstream()
    const tools = [{ type: 'function' as const, function: { name: 'app_tool', description: 'test', parameters: {} } }]
    await collect(new OpenAICompatibleProvider(settings), { ...req, tools })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodies(fetcher)[0]).toEqual({ ...req, tools, stream: true })
  })
  it.each(['timeout', 'redirect', 'response_too_large', 'aborted'] as const)('never retries a local limit/policy error: %s', async code => {
    const fetcher = upstream(() => { throw new LimitedFetchError(code) })
    expect((await collect(new OpenAICompatibleProvider(settings))).at(-1)).toMatchObject({ type: 'error' })
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it('caches successful metadata for five minutes and refreshes at expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    const fetcher = upstream()
    const provider = new OpenAICompatibleProvider(settings)
    await collect(provider)
    now.mockReturnValue(299_999)
    await collect(provider)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/models'))).toHaveLength(1)
    now.mockReturnValue(300_000)
    await collect(provider)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/models'))).toHaveLength(2)
  })
  it.each([{ preset: 'openai-compatible' as const }, { owuiTools: 'off' as const }])('does not load metadata when disabled: %j', async override => {
    const fetcher = upstream()
    await collect(new OpenAICompatibleProvider({ ...settings, ...override }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodies(fetcher)[0]).not.toHaveProperty('tool_ids')
  })
  it('honors per-request off after an auto request, without leaking cache into it', async () => {
    const fetcher = upstream()
    const provider = new OpenAICompatibleProvider(settings)
    await collect(provider)
    await collect(provider, { ...req, owuiTools: 'off' })
    expect(bodies(fetcher)[1]).not.toHaveProperty('tool_ids')
  })
  it.each([{ data: [] }, { data: [{ id: 'm' }] }, { data: [{ id: 'other', info: meta.data[0]!.info }] }, { data: [{ id: 'm', info: { meta: { toolIds: ['sk-secret'], defaultFeatureIds: [null] } } }] }])('sends the original body if both lists are empty: %j', async models => {
    const fetcher = upstream(() => ok(), models)
    await collect(new OpenAICompatibleProvider(settings))
    expect(bodies(fetcher)).toEqual([{ ...req, stream: true }])
  })
  it('sends feature-only metadata', async () => {
    const fetcher = upstream(() => ok(), { data: [{ id: 'm', info: { meta: { defaultFeatureIds: ['web_search'], capabilities: { web_search: true } } } }] })
    await collect(new OpenAICompatibleProvider(settings))
    expect(bodies(fetcher)[0]).toMatchObject({ features: { web_search: true }, params: { function_calling: 'legacy' } })
    expect(bodies(fetcher)[0]).not.toHaveProperty('tool_ids')
  })
  it('metadata failure is best effort and does not prevent a basic completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/models') ? new Response('', { status: 500 }) : ok()))
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it.each([400, 404, 405, 415, 422])('retries HTTP %i exactly once with the original files and messages', async status => {
    const fetcher = upstream((_, count) => count === 1 ? new Response('private error', { status }) : ok())
    const onDispatch = vi.fn()
    expect(await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toEqual([expect.objectContaining({ tool_ids: ['lookup', 'server:mcp:search'] }), { ...req, stream: true }])
    expect(onDispatch.mock.calls.map(([delivery]) => delivery.mode)).toEqual(['tools', 'fallback'])
    expect(onDispatch.mock.calls[1]![0]).toEqual({ mode: 'fallback' })
  })
  it.each([401, 403, 408, 409, 429, 500, 502, 503, 504])('never retries HTTP %i when execution is not ruled out', async status => {
    const fetcher = upstream(() => new Response('private error', { status }))
    const onDispatch = vi.fn()
    expect(await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })).toEqual([{ type: 'error', message: `LLM 서비스 오류 (HTTP ${status})` }])
    expect(bodies(fetcher)).toHaveLength(1)
    expect(onDispatch.mock.calls.map(([delivery]) => delivery.mode)).toEqual(['tools'])
  })
  it('does not retry the fallback when it fails too', async () => {
    const fetcher = upstream((_, count) => new Response('', { status: count === 1 ? 400 : 500 }))
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'error', message: 'LLM 서비스 오류 (HTTP 500)' }])
    expect(bodies(fetcher)).toHaveLength(2)
  })
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])('retries a proven pre-connection failure (%s) with the original files and messages', async code => {
    const fetcher = upstream((_, count) => {
      if (count === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('private upstream'), { code }) })
      return ok()
    })
    const onDispatch = vi.fn()
    expect(await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toEqual([expect.objectContaining({ tool_ids: ['lookup', 'server:mcp:search'] }), { ...req, stream: true }])
    expect(onDispatch.mock.calls.map(([delivery]) => delivery.mode)).toEqual(['tools', 'fallback'])
  })
  it('does not retry a pre-connection failure again after falling back', async () => {
    const fetcher = upstream(() => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ECONNREFUSED' }) }) })
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'error', message: 'LLM 서비스 연결 오류' }])
    expect(bodies(fetcher)).toHaveLength(2)
  })
  it.each(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])('never retries ambiguous transport errors (%s) before response headers', async code => {
    const fetcher = upstream(() => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code }) }) })
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'error', message: 'LLM 서비스 연결 오류' }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it.each(['headers', 'before-frame', 'partial-frame'])('never retries an unproven failure before the first frame (%s)', async where => {
    const fetcher = upstream((_, count) => {
      if (count > 1) return ok()
      if (where === 'headers') throw new TypeError('secret connection failure')
      let read = false
      return new Response(new ReadableStream({ pull(c) {
        if (where === 'partial-frame' && !read) { read = true; c.enqueue(new TextEncoder().encode('data: {')) }
        else c.error(new TypeError('secret', { cause: Object.assign(new Error('private'), { code: 'ECONNREFUSED' }) }))
      } }))
    })
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'error', message: 'LLM 서비스 연결 오류' }])
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it.each([{ sources: [] }, { choices: [{ delta: { reasoning_content: 'thinking' } }] }, { choices: [{ delta: { content: 'partial' } }] }])('never retries after the first frame: %j', async frame => {
    let read = false
    const fetcher = upstream(() => new Response(new ReadableStream({ pull(c) { if (!read) { read = true; c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)) } else c.error(new TypeError('secret')) } })))
    const chunks = await collect(new OpenAICompatibleProvider(settings))
    expect(chunks.at(-1)).toEqual({ type: 'error', message: 'LLM 서비스 연결 오류' })
    expect(bodies(fetcher)).toHaveLength(1)
  })
  it('never retries cancellation', async () => {
    const controller = new AbortController()
    const fetcher = upstream(() => { controller.abort(); throw new DOMException('cancel', 'AbortError') })
    await collect(new OpenAICompatibleProvider(settings), { ...req, signal: controller.signal })
    expect(bodies(fetcher)).toHaveLength(1)
  })
})
