import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { claimMyRequest } from '@/features/assistant-pill/replyBubble'
import { jsonResponse } from '@/test/render'
import { STATUS_CHECK_MS, useChat } from './useChat'

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear() })

it('started 의 requestId 를 "내가 보낸 요청"으로 기록한다 — 다른 창·탭의 도우미가 완료를 알릴 대상', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('event: started\ndata: {"requestId":"r-mine","replyMessageId":"m"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('mine-thread'), { wrapper })
  await act(async () => { await result.current.send('hello') })
  expect(claimMyRequest('r-mine')).toBe(true)
  expect(claimMyRequest('r-mine')).toBe(false)
})

it('retries a failed fetch with the same key and POST body', async () => {
  const calls: Array<{ key: string | null; body: string | null }> = []
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: String(init.body) })
    if (calls.length === 1) throw new Error('disconnected')
    return new Response('event: started\ndata: {"requestId":"r1","replyMessageId":"m1"}\n\nevent: completed\ndata: {}\n\n',
      { status: 201, headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('thread-1'), { wrapper })
  await act(async () => { await result.current.send('hello', ['file-1']) })
  expect(calls).toHaveLength(2)
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]?.key).toBeTruthy()
  expect(sessionStorage.length).toBe(0)
})

it('recovers a stored attempt after remount with its original key', async () => {
  const keys: Array<string | null> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key'))
    if (keys.length <= 2) throw new Error('offline')
    return new Response('event: started\ndata: {"requestId":"r2","replyMessageId":"m2"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
  }))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const first = renderHook(() => useChat('thread-2'), { wrapper })
  await act(async () => { await expect(first.result.current.send('remember')).rejects.toThrow('offline') })
  expect(sessionStorage.length).toBe(1)
  first.unmount()
  const second = renderHook(() => useChat('thread-2'), { wrapper })
  await act(async () => { await vi.waitFor(() => expect(keys).toHaveLength(3)) })
  expect(new Set(keys).size).toBe(1)
  expect(sessionStorage.length).toBe(0)
  second.unmount()
})

it('restores and appends reasoning separately without resetting the wait start on reconnect', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('reasoning-thread'), { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('reasoning') })
  expect(result.current.waitingSince).toEqual(expect.any(Number))
  const encoder = new TextEncoder()
  await act(async () => { stream.enqueue(encoder.encode('event: started\ndata: {"requestId":"r","replyMessageId":"m","resumedText":"","resumedReasoning":"검토","createdAt":"2026-01-01T00:00:00Z","firstTokenMs":600000,"idleMs":120000}\n\nevent: reasoning\ndata: {"text":" 계속"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '', reasoning: '검토 계속', phase: '생각 중', startedAt: Date.parse('2026-01-01T00:00:00Z'), firstTokenMs: 600000, idleMs: 120000 })
  await act(async () => { stream.enqueue(encoder.encode('event: delta\ndata: {"text":"답"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '답', reasoning: '검토 계속', phase: '답변 중' })
  await act(async () => { stream.enqueue(encoder.encode('event: completed\ndata: {}\n\n')); stream.close(); await sending })
  expect(result.current.waitingSince).toBeUndefined()
  expect(result.current.run).toBeNull()
})

it('replaces the streamed answer or reasoning when the server sends replace (OpenWebUI session mode)', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('replace-thread'), { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('replace') })
  const encoder = new TextEncoder()
  await act(async () => { stream.enqueue(encoder.encode('event: started\ndata: {"requestId":"r","replyMessageId":"m"}\n\nevent: reasoning\ndata: {"text":"처음 생각"}\n\nevent: delta\ndata: {"text":"임시 답변"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '임시 답변', reasoning: '처음 생각' })
  await act(async () => { stream.enqueue(encoder.encode('event: replace\ndata: {"field":"content","text":"최종"}\n\nevent: delta\ndata: {"text":" 답변"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '최종 답변', reasoning: '처음 생각', phase: '답변 중' })
  await act(async () => { stream.enqueue(encoder.encode('event: replace\ndata: {"field":"reasoning","text":"다시 생각"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '최종 답변', reasoning: '다시 생각' })
  await act(async () => { stream.enqueue(encoder.encode('event: completed\ndata: {}\n\n')); stream.close(); await sending })
  expect(result.current.run).toBeNull()
})

/** 응답 스트림이 멈추거나(프록시 버퍼링·조용한 끊김) 끝 이벤트 없이 닫혀도 서버가 끝났다고 하면 화면을 정리한다 */
describe('status check fallback', () => {
  const started = 'event: started\ndata: {"requestId":"r-stuck","replyMessageId":"m"}\n\nevent: delta\ndata: {"text":"답"}\n\n'
  function upstream(record: () => Record<string, unknown>, close = false) {
    const posts: string[] = [], gets: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        posts.push(url)
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(started)); if (close) controller.close() } }), { status: 201 })
      }
      gets.push(url)
      return new Response(JSON.stringify(record()), { status: 200 })
    }))
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return { posts, gets, client, wrapper }
  }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('checks the request after a silent stream and clears the run when the server says it succeeded', async () => {
    let status = 'streaming'
    const { gets, wrapper } = upstream(() => ({ id: 'r-stuck', status, phase: status === 'streaming' ? 'OpenWebUI에서 작업 중 · 도구 실행 중: t' : null }))
    const { result } = renderHook(() => useChat('stuck-thread'), { wrapper })
    let sending!: Promise<void>
    await act(async () => { sending = result.current.send('hello') })
    await vi.waitFor(() => expect(result.current.run).toMatchObject({ requestId: 'r-stuck', text: '답' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(gets).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await vi.waitFor(() => expect(result.current.run?.phase).toBe('OpenWebUI에서 작업 중 · 도구 실행 중: t'))
    expect(gets).toEqual(['/api/requests/r-stuck'])
    status = 'succeeded'
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); await sending })
    expect(result.current.run).toBeNull()
    expect(result.current.sending).toBe(false)
    expect(sessionStorage.length).toBe(0)
  })
  it('ends with the server error when the stalled request failed, and checks at once when the window regains focus', async () => {
    const { gets, wrapper } = upstream(() => ({ id: 'r-stuck', status: 'interrupted', error: '응답이 중단되었습니다' }))
    const { result } = renderHook(() => useChat('stuck-thread-2'), { wrapper })
    let sending!: Promise<void>
    await act(async () => { sending = result.current.send('hello') })
    await vi.waitFor(() => expect(result.current.run).not.toBeNull())
    const settled = expect(sending).rejects.toThrow('응답이 중단되었습니다')
    await act(async () => { window.dispatchEvent(new Event('focus')); await settled })
    expect(gets).toEqual(['/api/requests/r-stuck'])
    expect(result.current.run).toBeNull()
  })
  it('asks the server before reconnecting when the stream closes without an end event', async () => {
    const { posts, gets, wrapper } = upstream(() => ({ id: 'r-stuck', status: 'succeeded' }), true)
    const { result } = renderHook(() => useChat('stuck-thread-3'), { wrapper })
    await act(async () => { await result.current.send('hello') })
    expect(posts).toHaveLength(1)
    expect(gets).toEqual(['/api/requests/r-stuck'])
    expect(result.current.run).toBeNull()
  })
})

it('S15: 화면이 내려가면(LRU 퇴거) 진행 중 스트림·확인 타이머를 정리하고, 다시 열면 같은 키로 한 번만 다시 붙는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const signals: Array<{ key: string | null; signal: AbortSignal }> = []
    const status = vi.fn(async () => jsonResponse(200, { id: 'r-live', status: 'running' }))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('/api/requests/')) return status()
      signals.push({ key: new Headers(init.headers).get('Idempotency-Key'), signal: init.signal! })
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: started\ndata: {"requestId":"r-live","replyMessageId":"m","autoStarted":true}\n\n'))
      } }), { status: 201 })
    }))
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const autoStarted = vi.fn()
    const first = renderHook(() => useChat('evicted-thread', autoStarted), { wrapper })
    let sending!: Promise<void>
    act(() => { sending = first.result.current.send('긴 작업') })
    await vi.waitFor(() => expect(first.result.current.run?.requestId).toBe('r-live'))
    first.unmount()
    await act(async () => { await sending })
    expect(signals).toHaveLength(1)
    expect(signals[0]!.signal.aborted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(STATUS_CHECK_MS * 3) })
    expect(status).not.toHaveBeenCalled() // 내려간 화면은 상태 확인도 멈춘다
    expect(signals).toHaveLength(1) // 스스로 다시 붙지 않는다
    expect(sessionStorage.getItem('mes-chat-attempt:evicted-thread')).not.toBeNull() // 시도는 남겨 다시 열 때 이어 붙는다

    const second = renderHook(() => useChat('evicted-thread', autoStarted), { wrapper })
    await vi.waitFor(() => expect(second.result.current.run?.requestId).toBe('r-live'))
    expect(signals).toHaveLength(2)
    expect(signals[1]!.key).toBe(signals[0]!.key)
    expect(signals.filter(item => !item.signal.aborted)).toHaveLength(1)
    expect(autoStarted).toHaveBeenCalledTimes(1) // 다시 붙어도 보류 해제 알림은 한 번
    second.unmount()
  } finally { vi.useRealTimers() }
})

it('S15: 화면이 내려간 뒤에 시작된 전송은 스트림을 열지 않고 시도만 남겨, 다시 열면 한 번 붙는다', async () => {
  const keys: Array<string | null> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key'))
    return new Response('event: started\ndata: {"requestId":"r-late","replyMessageId":"m"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
  }))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const first = renderHook(() => useChat('late-thread'), { wrapper })
  const send = first.result.current.send
  first.unmount()
  await act(async () => { await send('늦은 전송') })
  expect(keys).toHaveLength(0)
  expect(sessionStorage.getItem('mes-chat-attempt:late-thread')).not.toBeNull()
  const second = renderHook(() => useChat('late-thread'), { wrapper })
  await act(async () => { await vi.waitFor(() => expect(sessionStorage.getItem('mes-chat-attempt:late-thread')).toBeNull()) })
  expect(keys).toHaveLength(1)
  second.unmount()
})

it('restores indexed steps, adds only emitted indices and replaces a shortened output without stale blocks', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('steps-thread'), { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('steps') })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  await act(async () => {
    stream.enqueue(event('started', { requestId: 'r', replyMessageId: 'm', resumedSteps: [{ type: 'reasoning', text: '검토' }], resumedReasoning: '검토' }))
    stream.enqueue(event('delta', { text: '', stepIndex: 1, stepCount: 4, step: { type: 'text', text: '먼저' } }))
  })
  expect(result.current.run).toMatchObject({ text: '먼저', reasoning: '검토', steps: [{ type: 'reasoning', text: '검토' }, { type: 'text', text: '먼저' }] })
  await act(async () => {
    stream.enqueue(event('delta', { text: '', stepIndex: 2, stepCount: 4, step: { type: 'tool', name: 'lookup', input: '{}', output: '결과', status: 'done' } }))
    stream.enqueue(event('delta', { text: '', stepIndex: 3, stepCount: 4, step: { type: 'text', text: '나중' } }))
  })
  expect(result.current.run?.text).toBe('먼저\n나중')
  expect(result.current.run?.steps?.map(s => s.type)).toEqual(['reasoning', 'text', 'tool', 'text'])
  await act(async () => { stream.enqueue(event('delta', { text: '', stepIndex: 1, stepCount: 2, step: { type: 'text', text: '최종' } })) })
  expect(result.current.run).toMatchObject({ text: '최종', steps: [{ type: 'reasoning', text: '검토' }, { type: 'text', text: '최종' }] })
  await act(async () => { stream.enqueue(event('completed', {})); stream.close(); await sending })
})

it('sends the mode captured with an estimate even when the user toggles during upload or estimation', async () => {
  const { useUiStore } = await import('@/app/uiStore')
  useUiStore.setState({ answerDetails: {} })
  const sent: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"m"}\n\nevent: completed\ndata: {}\n\n')
  }))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('detail-race'), { wrapper })
  // ChatView retains this callback across its upload and estimate awaits.
  const capturedBriefSend = result.current.send
  act(() => useUiStore.getState().setAnswerDetail('anonymous', 'full'))
  try {
    await act(async () => { await capturedBriefSend('estimated in brief mode') })
    expect(sent[0]?.detail ?? 'brief').toBe('brief')
  } finally { act(() => useUiStore.setState({ answerDetails: {} })) }
})

it('appends indexed text and reasoning pieces to their own step without a whole-step snapshot', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('append-thread'), { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('append') })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  await act(async () => {
    stream.enqueue(event('started', { requestId: 'r', replyMessageId: 'm' }))
    stream.enqueue(event('reasoning', { text: '검', stepIndex: 0 }))
    stream.enqueue(event('reasoning', { text: '토', stepIndex: 0 }))
    stream.enqueue(event('delta', { text: '먼', stepIndex: 1 }))
    stream.enqueue(event('delta', { text: '저', stepIndex: 1 }))
    stream.enqueue(event('delta', { text: '', stepIndex: 2, stepCount: 4, step: { type: 'tool', name: 'lookup', input: '{}', output: '', status: 'running' } }))
    stream.enqueue(event('delta', { text: '나중', stepIndex: 3 }))
  })
  expect(result.current.run).toMatchObject({ text: '먼저\n나중', reasoning: '검토', steps: [
    { type: 'reasoning', text: '검토' }, { type: 'text', text: '먼저' }, { type: 'tool', name: 'lookup' }, { type: 'text', text: '나중' },
  ] })
  await act(async () => { stream.enqueue(event('completed', {})); stream.close(); await sending })
})


it('S16: mixed piece deltas, indexed snapshots and replace events keep every earlier step intact while new steps open below', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useChat('progressive-thread'), { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('progressive') })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  const code = { type: 'code', code: 'print(1 + 1)', output: '', status: 'running' }
  const tool = { type: 'tool', name: 'fake_tool', input: '{"query":"q"}', output: '', status: 'running' }
  // 서버가 세션 폴링(content 재직렬화)·직접 조각을 옮길 때 내는 순서 그대로: 조각 → 앞 단계 스냅숏(줄바꿈) + 새 단계 → 조각 → replace(호환 필드)
  const sequence: Array<[string, unknown]> = [
    ['started', { requestId: 'r', replyMessageId: 'm' }],
    ['delta', { text: '안녕', stepIndex: 0 }], ['delta', { text: '하세요.', stepIndex: 0 }],
    ['delta', { text: '', stepIndex: 0, stepCount: 1, step: { type: 'text', text: '안녕하세요.\n' } }],
    ['delta', { text: '', stepIndex: 1, stepCount: 2, step: { type: 'reasoning', text: '' } }],
    ['reasoning', { text: '검토', stepIndex: 1 }], ['replace', { field: 'reasoning', text: '검토' }], ['reasoning', { text: '합니다', stepIndex: 1 }],
    ['delta', { text: '', stepIndex: 2, stepCount: 3, step: { type: 'text', text: '\n정리' } }], ['delta', { text: '했습니다.', stepIndex: 2 }],
    ['delta', { text: '', stepIndex: 2, stepCount: 4, step: { type: 'text', text: '\n정리했습니다.\n' } }], ['delta', { text: '', stepIndex: 3, stepCount: 4, step: code }],
    ['replace', { field: 'content', text: '안녕하세요.\n\n\n정리했습니다.\n' }],
    ['delta', { text: '', stepIndex: 3, stepCount: 4, step: { ...code, output: '2', status: 'done' } }],
    ['delta', { text: '', stepIndex: 4, stepCount: 5, step: { type: 'text', text: '\n결과는 2' } }], ['delta', { text: '입니다.', stepIndex: 4 }],
    ['delta', { text: '', stepIndex: 5, stepCount: 6, step: tool }], ['delta', { text: '', stepIndex: 5, stepCount: 6, step: { ...tool, output: '결과', status: 'done' } }],
    ['delta', { text: '', stepIndex: 6, stepCount: 7, step: { type: 'text', text: '\n**끝**' } }],
  ]
  const final = [{ type: 'text', text: '안녕하세요.\n' }, { type: 'reasoning', text: '검토합니다' }, { type: 'text', text: '\n정리했습니다.\n' },
    { ...code, output: '2', status: 'done' }, { type: 'text', text: '\n결과는 2입니다.' }, { ...tool, output: '결과', status: 'done' }, { type: 'text', text: '\n**끝**' }]
  for (const [name, data] of sequence) {
    await act(async () => { stream.enqueue(event(name, data)) })
    const steps = result.current.run?.steps ?? []
    steps.forEach((step, i) => {
      expect(step.type, `${name} ${JSON.stringify(data)} · step ${i}`).toBe(final[i]!.type)
      if (step.type === 'text' || step.type === 'reasoning') expect((final[i] as { text: string }).text.startsWith(step.text), `${name} · step ${i}: ${step.text}`).toBe(true)
    })
  }
  expect(result.current.run?.steps).toEqual(final)
  expect(result.current.run?.text).toBe('안녕하세요.\n\n\n정리했습니다.\n\n\n결과는 2입니다.\n\n**끝**')
  await act(async () => { stream.enqueue(event('completed', {})); stream.close(); await sending })
})

it('S16: when the live run is dropped before the final refetch lands, the cached mid-stream copy shows the finished steps, not old ones', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))))
  // 스트리밍 중에 읽어 둔 저장본은 앞 두 단계·진행 중 사본이고, 끝난 뒤의 다시 읽기는 늦게 온다(실시간 이벤트가 취소·재요청하는 사이)
  let finished = false, release: (() => void) | undefined
  const stale = [{ id: 'm', threadId: 'stale-thread', role: 'assistant', status: 'streaming', content: '앞', createdAt: '2026-10-20', attachmentIds: [],
    steps: [{ type: 'text', text: '앞' }, { type: 'reasoning', text: '옛 생' }] }]
  const steps = [{ type: 'text', text: '앞' }, { type: 'reasoning', text: '옛 생각 끝' }, { type: 'text', text: '뒤' }]
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const seen: Array<{ run: boolean; reply?: { status: string; steps?: unknown[] } }> = []
  const { result } = renderHook(() => {
    const chat = useChat('stale-thread')
    const messages = useQuery({ queryKey: ['messages', 'stale-thread'], queryFn: () => finished
      ? new Promise<Array<{ status: string; steps?: unknown[] }>>(resolve => { release = () => resolve([{ ...stale[0]!, status: 'done', steps }]) })
      : structuredClone(stale) as unknown as Array<{ status: string; steps?: unknown[] }> })
    seen.push({ run: !!chat.run, reply: messages.data?.[0] })
    return chat
  }, { wrapper })
  let sending!: Promise<void>
  await act(async () => { sending = result.current.send('stale') })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  await act(async () => {
    stream.enqueue(event('started', { requestId: 'r', replyMessageId: 'm' }))
    steps.forEach((step, index) => stream.enqueue(event('delta', { text: '', stepIndex: index, stepCount: index + 1, step })))
  })
  await act(async () => { finished = true; stream.enqueue(event('completed', {})); stream.close(); await vi.waitFor(() => expect(release).toBeTypeOf('function')) })
  await act(async () => { release!(); await sending })
  const dropped = seen.findIndex((item, i) => i > 0 && seen[i - 1]!.run && !item.run)
  expect(dropped).toBeGreaterThan(0)
  // run이 내려간 뒤 그려진 사본은 끝난 상태·마지막 단계다(진행 중 옛 사본이 '다른 곳의 요청'으로 다시 그려지지 않는다)
  for (const item of seen.slice(dropped)) expect(item.reply).toMatchObject({ status: 'done', steps })
})
