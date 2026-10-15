import { createElement } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvent, subscribeEvent, useEvents } from './useEvents'

describe('task list event throttling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
  const setup = () => {
    const query = new QueryClient()
    const invalidate = vi.spyOn(query, 'invalidateQueries').mockResolvedValue()
    const lists = () => invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'tasks').length
    return { query, invalidate, lists }
  }

  it('invalidates on the leading edge and once on the trailing edge across event types', () => {
    const { query, lists } = setup()
    applyEvent(query, 'message.appended', {})
    expect(lists()).toBe(1)
    vi.advanceTimersByTime(100)
    for (const event of ['message.appended', 'task.created', 'task.updated', 'file.updated', 'input.updated']) {
      applyEvent(query, event, {})
    }
    vi.advanceTimersByTime(1_899)
    expect(lists()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(lists()).toBe(2)
    vi.advanceTimersByTime(5_000)
    expect(lists()).toBe(2)
    applyEvent(query, 'message.appended', {})
    expect(lists()).toBe(3)
  })

  it('keeps a two-second cadence under continuous traffic and delivers the last event', () => {
    const { query, lists } = setup()
    applyEvent(query, 'message.appended', {})
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(500)
      applyEvent(query, 'message.appended', {})
    }
    expect(lists()).toBe(3)
    vi.advanceTimersByTime(1_500)
    expect(lists()).toBe(4)
    vi.advanceTimersByTime(4_000)
    expect(lists()).toBe(4)
  })

  it('does not schedule a duplicate trailing invalidation for an isolated event', () => {
    const { query, lists } = setup()
    applyEvent(query, 'task.updated', {})
    vi.advanceTimersByTime(10_000)
    expect(lists()).toBe(1)
  })

  it('only invalidates request status changes while refreshing conversation queries on every phase', () => {
    const { query, invalidate, lists } = setup()
    const data = { requestId: 'r', threadId: 'h', taskId: 't', status: 'pending' }
    applyEvent(query, 'request.updated', data)
    vi.advanceTimersByTime(2_000)
    invalidate.mockClear()
    applyEvent(query, 'request.updated', { ...data, phase: '파일 처리 대기' })
    applyEvent(query, 'request.updated', { ...data, phase: '파일 올리는 중' })
    expect(lists()).toBe(0)
    for (const key of [['messages', 'h'], ['task', 't'], ['activity', 't'], ['request', 'r'], ['estimate']]) {
      expect(invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key))).toHaveLength(2)
    }
    applyEvent(query, 'request.updated', { ...data, status: 'streaming' })
    expect(lists()).toBe(1)
    applyEvent(query, 'request.updated', { ...data, status: 'succeeded' })
    expect(lists()).toBe(1)
    vi.advanceTimersByTime(2_000)
    expect(lists()).toBe(2)
    applyEvent(query, 'request.updated', { ...data, status: 'succeeded' })
    vi.advanceTimersByTime(2_000)
    expect(lists()).toBe(2)
  })

  it('compares requests independently and uses a cached status for the first event', () => {
    const { query, lists } = setup()
    query.setQueryData(['request', 'r'], { status: 'streaming' })
    applyEvent(query, 'request.updated', { requestId: 'r', status: 'streaming', phase: '생각 중' })
    applyEvent(query, 'request.updated', { requestId: 'missing-status' })
    expect(lists()).toBe(0)
    applyEvent(query, 'request.updated', { requestId: 'other', status: 'streaming' })
    expect(lists()).toBe(1)
    vi.advanceTimersByTime(2_000)
    applyEvent(query, 'request.updated', { requestId: 'r', status: 'streaming', phase: '답변 중' })
    expect(lists()).toBe(1)
  })

  it('updates the kanban AI chip phase in cached lists without refetching the list', () => {
    const { query, lists } = setup()
    const task = { id: 't', aiRequest: { status: 'streaming', phase: '생각 중', updatedAt: '2026-10-15' } }
    query.setQueryData(['tasks'], [task, { id: 'other', aiRequest: null }])
    query.setQueryData(['tasks', 'related', ['tag']], [task])
    query.setQueryData(['request', 'r'], { status: 'streaming' })
    applyEvent(query, 'request.updated', { requestId: 'r', taskId: 't', status: 'streaming', phase: '답변 중' })
    expect(lists()).toBe(0)
    expect(query.getQueryData(['tasks'])).toEqual([
      { ...task, aiRequest: { ...task.aiRequest, phase: '답변 중' } }, { id: 'other', aiRequest: null },
    ])
    expect(query.getQueryData(['tasks', 'related', ['tag']])).toEqual([{ ...task, aiRequest: { ...task.aiRequest, phase: '답변 중' } }])
    applyEvent(query, 'request.updated', { requestId: 'r', taskId: 't', status: 'streaming', phase: null })
    expect(query.getQueryData<Array<typeof task>>(['tasks'])?.[0].aiRequest.phase).toBeUndefined()
    expect(lists()).toBe(0)
  })

  it('keeps throttles independent for different query clients', () => {
    const first = setup(), second = setup()
    applyEvent(first.query, 'message.appended', {})
    applyEvent(first.query, 'message.appended', {})
    applyEvent(second.query, 'message.appended', {})
    expect(first.lists()).toBe(1)
    expect(second.lists()).toBe(1)
    vi.advanceTimersByTime(2_000)
    expect(first.lists()).toBe(2)
    expect(second.lists()).toBe(1)
  })

  it('resyncs immediately and drops a queued list invalidation', () => {
    const { query, invalidate, lists } = setup()
    applyEvent(query, 'message.appended', {})
    applyEvent(query, 'message.appended', {})
    applyEvent(query, 'resync', {})
    expect(invalidate).toHaveBeenCalledWith()
    vi.advanceTimersByTime(2_000)
    expect(lists()).toBe(1)
  })

  it('clears pending work on stream cleanup and still emits phase and completion events', () => {
    const handlers = new Map<string, (event: Event) => void>()
    const close = vi.fn()
    class FakeSource {
      addEventListener(name: string, handler: (event: Event) => void) { handlers.set(name, handler) }
      removeEventListener(name: string) { handlers.delete(name) }
      close = close
    }
    vi.stubGlobal('EventSource', FakeSource)
    const { query, lists } = setup()
    const listener = vi.fn()
    const unsubscribe = subscribeEvent(listener)
    const { unmount } = renderHook(() => useEvents(), { wrapper: ({ children }) => createElement(QueryClientProvider, { client: query }, children) })
    const send = (status: string, phase: string | null) => handlers.get('request.updated')!(new MessageEvent('request.updated', {
      data: JSON.stringify({ requestId: 'r', taskId: 't', threadId: 'h', status, phase }),
    }))
    try {
      send('streaming', '생각 중')
      send('streaming', '답변 중')
      send('succeeded', null)
      expect(listener.mock.calls.map(([event]) => [event.data.status, event.data.phase])).toEqual([
        ['streaming', '생각 중'], ['streaming', '답변 중'], ['succeeded', null],
      ])
      expect(lists()).toBe(1)
      unmount()
      expect(close).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(2_000)
      expect(lists()).toBe(1)
    } finally { unsubscribe(); unmount() }
  })
})

it.each(['reassigned', 'deleted'] as const)('task.updated refetches SR list and detail after a linked conversation is %s', async (change) => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const previous = { id: 's', taskCount: 1, conversations: [{ id: 't', ownerId: 'u', assigneeIds: ['u'] }] }
  const current = { ...previous, taskCount: change === 'deleted' ? 0 : 1,
    conversations: change === 'deleted' ? [] : [{ id: 't', ownerId: 'other', assigneeIds: ['other'] }] }
  const getList = vi.fn(async () => [current]), getDetail = vi.fn(async () => current)
  query.setQueryData(['sr', 'inbox'], [previous])
  query.setQueryData(['sr', 's'], previous)
  const observers = [
    new QueryObserver(query, { queryKey: ['sr', 'inbox'], queryFn: getList, staleTime: Infinity }),
    new QueryObserver(query, { queryKey: ['sr', 's'], queryFn: getDetail, staleTime: Infinity }),
  ]
  const unsubscribes = observers.map(observer => observer.subscribe(() => undefined))
  try {
    applyEvent(query, 'task.updated', { taskId: 't' })
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(1)
      expect(getDetail).toHaveBeenCalledTimes(1)
      expect(query.getQueryData(['sr', 'inbox'])).toEqual([current])
      expect(query.getQueryData(['sr', 's'])).toEqual(current)
    })
  } finally { unsubscribes.forEach(unsubscribe => unsubscribe()); query.clear() }
})

it('maps live events to affected queries and resyncs all queries', () => {
  const query = new QueryClient()
  const invalidate = vi.spyOn(query, 'invalidateQueries')
  applyEvent(query, 'message.appended', { taskId: 't', threadId: 'h', messageId: 'm' })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'h'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity', 't'] })
  invalidate.mockClear()
  applyEvent(query, 'request.updated', { taskId: 't', threadId: 'h', requestId: 'r', status: 'streaming' })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['request', 'r'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'h'] })
  invalidate.mockClear()
  applyEvent(query, 'resync', {})
  expect(invalidate).toHaveBeenCalledWith()
})

it.each(['message.appended', 'request.updated'])('refetches an initially empty message query after %s', async (event) => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let finishInitialFetch!: (messages: string[]) => void
  const initialFetch = new Promise<string[]>((resolve) => { finishInitialFetch = resolve })
  let fetches = 0
  const observer = new QueryObserver(query, { queryKey: ['messages', 'h'], queryFn: () => ++fetches === 1 ? initialFetch : Promise.resolve(['첫 메시지']) })
  const unsubscribe = observer.subscribe(() => undefined)
  expect(fetches).toBe(1)
  applyEvent(query, event, { threadId: 'h', taskId: 't' })
  finishInitialFetch([])
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['첫 메시지']))
  expect(fetches).toBe(2)
  unsubscribe()
})

it.each([
  ['task.created', { taskId: 't', assistantId: 'a' }, ['tasks']],
  ['task.updated', { taskId: 't' }, ['task', 't']],
  ['file.updated', { taskId: 't' }, ['files', 't']],
  ['input.updated', { taskId: 't' }, ['estimate']],
  ['context.updated', { taskId: 't' }, ['conversation-inputs', 't']],
  ['notification.created', {}, ['notifications']],
] as const)('invalidates %s queries', (event, data, key) => {
  const query = new QueryClient()
  const invalidate = vi.spyOn(query, 'invalidateQueries')
  applyEvent(query, event, data)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: [...key] })
})

it('refreshes other conversations that may reference a newly appended source message', () => {
  const query = new QueryClient()
  query.setQueryData(['candidates', 'target'], { conversations: [{ taskId: 'source', messageCount: 1 }] })
  query.setQueryData(['conversation-inputs', 'target'], [{ input: { sourceTaskId: 'source' }, newMessages: 0 }])
  const invalidate = vi.spyOn(query, 'invalidateQueries')
  applyEvent(query, 'message.appended', { taskId: 'source', threadId: 'source-thread', messageId: 'new' })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['candidates'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversation-inputs'] })
})

it('sr.updated refetches the SR through GET without trusting event content', async () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const get = vi.fn(async () => ({ id: 's', title: '서버에서 다시 읽은 제목' }))
  query.setQueryData(['sr', 's'], { id: 's', title: '이전 제목' })
  const observer = new QueryObserver(query, { queryKey: ['sr', 's'], queryFn: get, staleTime: Infinity })
  const unsubscribe = observer.subscribe(() => undefined)
  applyEvent(query, 'sr.updated', { srId: 's', title: '이벤트에 들어온 제목' })
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(query.getQueryData(['sr', 's'])).toEqual({ id: 's', title: '서버에서 다시 읽은 제목' }))
  unsubscribe(); query.clear()
})

it('brief.updated refetches only that conversation brief — new messages alone do not regenerate it', () => {
  const query = new QueryClient()
  const invalidate = vi.spyOn(query, 'invalidateQueries')
  applyEvent(query, 'brief.updated', { taskId: 't' })
  expect(invalidate.mock.calls).toEqual([[{ queryKey: ['chat-brief', 't'] }]])
  invalidate.mockClear()
  applyEvent(query, 'message.appended', { taskId: 't', threadId: 'h', messageId: 'm' })
  expect(invalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === 'chat-brief')).toBe(false)
})

it('listens for brief.updated on the live event stream', () => {
  const added: string[] = []
  class FakeSource { addEventListener(name: string) { added.push(name) } removeEventListener() {} close() {} }
  vi.stubGlobal('EventSource', FakeSource)
  const query = new QueryClient()
  try {
    const { unmount } = renderHook(() => useEvents(), { wrapper: ({ children }) => createElement(QueryClientProvider, { client: query }, children) })
    expect(added).toContain('brief.updated')
    unmount()
  } finally { vi.unstubAllGlobals() }
})

it('updates AI phases in summary, board and infinite caches without treating them as arrays', () => {
  const query = new QueryClient()
  const task = { id: 't', aiRequest: { status: 'streaming', phase: 'old', updatedAt: 'same' } }
  const page = { items: [task], nextCursor: 'next' }
  query.setQueryData(['tasks', 'u', 'summary'], page)
  query.setQueryData(['tasks', 'u', 'board'], { columns: [{ ...page, assistantId: 'a', total: 50 }] })
  query.setQueryData(['tasks', 'u', 'infinite'], { pages: [page, { items: [task], nextCursor: null }], pageParams: [undefined, 'next'] })
  expect(() => applyEvent(query, 'request.updated', { taskId: 't', requestId: 'r', status: 'streaming', phase: 'new' })).not.toThrow()
  expect(query.getQueryData(['tasks', 'u', 'summary'])).toMatchObject({ items: [{ aiRequest: { phase: 'new' } }], nextCursor: 'next' })
  expect(query.getQueryData(['tasks', 'u', 'board'])).toMatchObject({ columns: [{ total: 50, items: [{ aiRequest: { phase: 'new' } }] }] })
  expect(query.getQueryData(['tasks', 'u', 'infinite'])).toMatchObject({ pages: [{ items: [{ aiRequest: { phase: 'new' } }] }], pageParams: [undefined] })
  query.clear()
})

it('refreshes only the first infinite page on an event and retains its continuation cursor', () => {
  const query = new QueryClient()
  const first = { items: [], nextCursor: 'next' }
  query.setQueryData(['tasks', 'u', 'summary', 'infinite'], { pages: [first, { items: [], nextCursor: null }], pageParams: [undefined, 'next'] })
  applyEvent(query, 'task.updated', { taskId: 't' })
  expect(query.getQueryData(['tasks', 'u', 'summary', 'infinite'])).toEqual({ pages: [first], pageParams: [undefined] })
  query.clear()
})
