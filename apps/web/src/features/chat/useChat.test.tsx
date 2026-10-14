import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useChat } from './useChat'

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

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
  await act(async () => { stream.enqueue(encoder.encode('event: started\ndata: {"requestId":"r","replyMessageId":"m","resumedText":"","resumedReasoning":"검토","createdAt":"2026-01-01T00:00:00Z"}\n\nevent: reasoning\ndata: {"text":" 계속"}\n\n')) })
  expect(result.current.run).toMatchObject({ text: '', reasoning: '검토 계속', phase: '생각 중', startedAt: Date.parse('2026-01-01T00:00:00Z') })
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
