import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { applyEvent } from './useEvents'

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
