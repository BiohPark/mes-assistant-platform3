import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { applyEvent } from './useEvents'

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
