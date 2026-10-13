import { LimitedFetchError } from './limitedFetch.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRequest } from './provider.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'top-secret', model: 'm' }
const meta = { data: [{ id: 'm', info: { meta: { toolIds: ['lookup', 'server:mcp:search', 'https://private', 'sk-secret', 'top-secret', 3], defaultFeatureIds: ['web_search', 'code_interpreter', '../private'] } } }] }
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

describe('OpenWebUI automatic tool delivery', () => {
  it('uses allowlisted model metadata, leaves app tools unset, and records the dispatched body', async () => {
    const fetcher = upstream()
    const onDispatch = vi.fn()
    const provider = new OpenAICompatibleProvider(settings)
    expect(await collect(provider, { ...req, onDispatch })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    const body = bodies(fetcher)[0]
    expect(body).toEqual({ ...req, stream: true, tool_ids: ['lookup', 'server:mcp:search'], features: { web_search: true, code_interpreter: true }, params: { function_calling: 'legacy' } })
    expect(onDispatch).toHaveBeenCalledWith({ mode: 'tools', tool_ids: body.tool_ids, features: body.features }, body)
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
  it.each(['timeout', 'redirect', 'response_too_large'] as const)('never retries a local limit/policy error: %s', async code => {
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
    const fetcher = upstream(() => ok(), { data: [{ id: 'm', info: { meta: { defaultFeatureIds: ['web_search'] } } }] })
    await collect(new OpenAICompatibleProvider(settings))
    expect(bodies(fetcher)[0]).toMatchObject({ tool_ids: [], features: { web_search: true }, params: { function_calling: 'legacy' } })
  })
  it('metadata failure is best effort and does not prevent a basic completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/models') ? new Response('', { status: 500 }) : ok()))
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
  })
  it.each([400, 401, 422, 500, 503])('retries HTTP %i exactly once with the original files and messages', async status => {
    const fetcher = upstream((_, count) => count === 1 ? new Response('private error', { status }) : ok())
    const onDispatch = vi.fn()
    expect(await collect(new OpenAICompatibleProvider(settings), { ...req, onDispatch })).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toEqual([expect.objectContaining({ tool_ids: ['lookup', 'server:mcp:search'] }), { ...req, stream: true }])
    expect(onDispatch.mock.calls.map(([delivery]) => delivery.mode)).toEqual(['tools', 'fallback'])
    expect(onDispatch.mock.calls[1]![0]).toEqual({ mode: 'fallback' })
  })
  it('does not retry the fallback when it fails too', async () => {
    const fetcher = upstream(() => new Response('', { status: 500 }))
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'error', message: 'LLM 서비스 오류 (HTTP 500)' }])
    expect(bodies(fetcher)).toHaveLength(2)
  })
  it.each(['headers', 'partial-frame'])('retries a network failure before the first frame (%s)', async where => {
    const fetcher = upstream((_, count) => {
      if (count > 1) return ok()
      if (where === 'headers') throw new TypeError('secret connection failure')
      let read = false
      return new Response(new ReadableStream({ pull(c) { if (!read) { read = true; c.enqueue(new TextEncoder().encode('data: {')); } else c.error(new TypeError('secret')) } }))
    })
    expect(await collect(new OpenAICompatibleProvider(settings))).toEqual([{ type: 'delta', text: 'OK' }, { type: 'done' }])
    expect(bodies(fetcher)).toHaveLength(2)
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
