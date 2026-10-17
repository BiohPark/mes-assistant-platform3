import { afterEach, expect, it, vi } from 'vitest'
import { createProvider } from './index.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import { LimitedFetchError } from './limitedFetch.js'
import type { ChatRequest } from './provider.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.example/api', apiKey: 'service-key', model: 'm' }
const cases = [
  { meta: { terminalId: 'model' }, global: 'global', terminals: ['model', 'global'], id: 'model', source: 'model' },
  { meta: {}, global: 'global', terminals: ['model', 'global'], id: 'global', source: 'global' },
  { meta: {}, global: null, terminals: ['only'], id: 'only', source: 'single' },
  { meta: {}, global: null, terminals: ['one', 'two'], id: undefined, source: 'none' },
  { meta: { terminalId: 'model', capabilities: { terminal: false } }, global: 'global', terminals: ['model', 'global'], id: undefined, source: 'none' },
] as const

it.each(['empty', 'forbidden', 'timeout', 'delayed timeout', 'settings failure'] as const)('preserves a completion body timeout after terminal discovery: %s', async outcome => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/models')) return Response.json({ data: [] })
    if (url.endsWith('/terminals/')) {
      if (outcome === 'forbidden') return new Response(null, { status: 403 })
      if (outcome === 'delayed timeout') await new Promise(resolve => setTimeout(resolve, 5))
      if (outcome === 'timeout' || outcome === 'delayed timeout') throw new LimitedFetchError('timeout')
      return Response.json([])
    }
    if (url.endsWith('/chat/completions')) {
      const timeoutBody = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new LimitedFetchError('timeout')) } })
      return new Response(timeoutBody, { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const provider = new OpenAICompatibleProvider({ ...settings, readOwuiDefaultTerminalId: async () => {
    if (outcome === 'settings failure') throw new Error('settings unavailable')
    return null
  } })
  const chunks = []
  for await (const chunk of provider.stream({ model: 'm', messages: [], limits: { timeoutMs: 60_000 } })) chunks.push(chunk)
  expect(chunks).toEqual([{ type: 'error', message: '응답 시간 초과' }])
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))).toHaveLength(1)
})

for (const owuiMode of ['direct', 'session'] as const) {
  it.each(cases)(`${owuiMode}: sends the resolved terminal and records its $source source without changing the answer`, async row => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      if (path === '/api/models') return Response.json({ data: [{ id: 'm', info: { meta: row.meta } }] })
      if (path === '/api/v1/terminals/') return Response.json(row.terminals.map(id => ({ id })))
      if (path === '/api/chat/completions') {
        body = JSON.parse(String(init?.body))
        return owuiMode === 'session' ? Response.json({ chat_id: 'chat', status: true })
          : new Response('data: {"choices":[{"delta":{"content":"raw terminal output"}}]}\n\ndata: [DONE]\n\n')
      }
      if (path === '/api/v1/chats/chat' && init?.method !== 'DELETE') return Response.json({ chat: { history: { messages: {
        [String(body.id)]: { role: 'assistant', content: 'raw terminal output', done: true },
      } } } })
      return new Response('', { status: 404 })
    }))
    const onDispatch = vi.fn()
    const provider = new OpenAICompatibleProvider({ ...settings, readOwuiDefaultTerminalId: async () => row.global })
    const chunks = []
    for await (const chunk of provider.stream({ model: 'm', messages: [{ role: 'user', content: 'run code' }], owuiMode, onDispatch })) chunks.push(chunk)
    expect(chunks).toEqual([{ type: 'delta', text: 'raw terminal output' }, { type: 'done' }])
    expect(body.terminal_id).toBe(row.id)
    expect(body).not.toHaveProperty('terminalSource')
    expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ mode: row.id ? 'tools' : 'basic', terminalSource: row.source,
      ...(row.id ? { terminal_id: row.id } : {}) }, body)
  })
}

it('the provider factory reads a changed global setting on the next request while caching the terminal catalog', async () => {
  let global = 'first'
  const sent: unknown[] = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] })
    if (url.endsWith('/terminals/')) return Response.json([{ id: 'first' }, { id: 'second' }])
    sent.push(JSON.parse(String(init?.body)).terminal_id)
    return new Response('data: [DONE]\n\n')
  })
  vi.stubGlobal('fetch', fetcher)
  const provider = createProvider({ ...settings, readOwuiDefaultTerminalId: async () => global })
  const request: ChatRequest = { model: 'm', messages: [] }
  for await (const _ of provider.stream(request)) { /* consume */ }
  global = 'second'
  for await (const _ of provider.stream(request)) { /* consume */ }
  expect(sent).toEqual(['first', 'second'])
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/terminals/'))).toHaveLength(1)
})

it('a rejected terminal request records the final basic retry with no terminal and a none source', async () => {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] })
    if (url.endsWith('/terminals/')) return Response.json([{ id: 'only' }])
    bodies.push(JSON.parse(String(init?.body)))
    return bodies.length === 1 ? new Response('', { status: 400 }) : new Response('data: [DONE]\n\n')
  }))
  const onDispatch = vi.fn()
  for await (const _ of new OpenAICompatibleProvider(settings).stream({ model: 'm', messages: [], onDispatch })) { /* consume */ }
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toHaveProperty('terminal_id', 'only')
  expect(bodies[1]).not.toHaveProperty('terminal_id')
  expect(onDispatch.mock.calls.map(([delivery]) => delivery)).toEqual([
    { mode: 'tools', terminal_id: 'only', terminalSource: 'single' }, { mode: 'fallback', terminalSource: 'none' },
  ])
})

it('after a terminal 400 fallback, switching tools off records a basic body despite cached defaults', async () => {
  let mode: 'auto' | 'off' = 'auto'
  let reject = true
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm', info: { meta: { toolIds: ['lookup'], terminalId: 'only' } } }] })
    if (url.endsWith('/terminals/')) return Response.json([{ id: 'only' }])
    const body = JSON.parse(String(init?.body))
    bodies.push(body)
    return reject && body.tool_ids ? new Response('', { status: 400 }) : new Response('data: [DONE]\n\n')
  }))
  const provider = createProvider({ ...settings, readOwuiDefaultTerminalId: async () => 'only' }, async () => mode)
  const deliveries: unknown[] = []
  const dispatched: Record<string, unknown>[] = []
  const onDispatch: ChatRequest['onDispatch'] = (delivery, body) => { deliveries.push({ ...delivery }); dispatched.push(body) }
  for await (const _ of provider.stream({ model: 'm', messages: [], owuiMode: 'direct', onDispatch })) { /* consume */ }
  mode = 'off'
  reject = false
  for await (const _ of provider.stream({ model: 'm', messages: [], owuiMode: 'direct', onDispatch })) { /* consume */ }
  mode = 'auto'
  for await (const _ of provider.stream({ model: 'm', messages: [], owuiTools: 'off', owuiMode: 'direct', onDispatch })) { /* consume */ }
  expect(dispatched).toEqual(bodies)
  expect(deliveries).toEqual([
    { mode: 'tools', tool_ids: ['lookup'], terminal_id: 'only', terminalSource: 'model' },
    { mode: 'fallback', terminalSource: 'none' },
    { mode: 'basic', terminalSource: 'none' },
    { mode: 'basic', terminalSource: 'none' },
  ])
  expect(bodies).toEqual([
    { model: 'm', messages: [], stream: true, tool_ids: ['lookup'], terminal_id: 'only', params: { function_calling: 'legacy' } },
    { model: 'm', messages: [], stream: true },
    { model: 'm', messages: [], stream: true },
    { model: 'm', messages: [], stream: true },
  ])
})

it.each(['auto', 'session'] as const)('%s: switching global tools off removes cached terminal defaults from session dispatches', async owuiMode => {
  let mode: 'auto' | 'off' = 'auto'
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] })
    if (url.endsWith('/terminals/')) return Response.json([{ id: 'only' }])
    bodies.push(JSON.parse(String(init?.body)))
    return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  }))
  const provider = createProvider(settings, async () => mode)
  for await (const _ of provider.stream({ model: 'm', messages: [], owuiMode })) { /* warm cache */ }
  expect(bodies[0]).toHaveProperty('terminal_id', 'only')
  mode = 'off'
  const onDispatch = vi.fn()
  for await (const _ of provider.stream({ model: 'm', messages: [], owuiMode, onDispatch })) { /* consume */ }
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).not.toHaveProperty('terminal_id')
  expect(bodies[1]).toMatchObject({ session_id: expect.any(String), params: { tool_approval_mode: 'full' } })
  expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ mode: 'basic', terminalSource: 'none' }, bodies[1])
})
