import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { claimMyRequest } from '@/features/assistant-pill/replyBubble'
import { useChat } from './useChat'

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
