import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { useDrawerOpen, useMaterialsDrawer } from './materialsDrawer'

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); useMaterialsDrawer.setState({ byTask: {} }) })
it('2B opens only before the first message and preserves manual choices after new tags', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const task = { id: 'policy', threadId: 'thread', tags: ['A'], linkedSrCodes: [] } as unknown as Task
  const { result, rerender } = renderHook(({ task }) => useDrawerOpen(task), { wrapper, initialProps: { task } })
  await waitFor(() => expect(result.current).toBe(true))
  act(() => client.setQueryData(['messages', 'thread'], [{ id: 'first' }]))
  await waitFor(() => expect(result.current).toBe(false))
  act(() => { useMaterialsDrawer.getState().choose(task.id, 'open') })
  expect(result.current).toBe(true)
  act(() => { useMaterialsDrawer.getState().choose(task.id, 'closed'); useMaterialsDrawer.getState().syncContext(task); useMaterialsDrawer.getState().syncContext({ ...task, tags: ['A', 'B'] }) })
  rerender({ task: { ...task, tags: ['A', 'B'] } })
  expect(result.current).toBe(false)
})
it('keeps the first-question panel visible while initial messages are loading without reopening a started conversation', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const task = { id: 'loading', threadId: 'loading-thread', tags: ['A'] } as unknown as Task
  const { result } = renderHook(() => useDrawerOpen(task), { wrapper })
  expect(result.current).toBe(true)
  await act(async () => finish(Response.json([])))
  expect(result.current).toBe(true)
  act(() => client.setQueryData(['messages', task.threadId], [{ id: 'm' }]))
  await waitFor(() => expect(result.current).toBe(false))
  act(() => client.removeQueries({ queryKey: ['messages', task.threadId] }))
  expect(result.current).toBe(false)
})
it('uses task message presence before the slow message list arrives, avoiding a transient panel and detail fetch', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const task = { id: 'existing', threadId: 'existing-thread', tags: ['A'], hasMessages: true } as unknown as Task
  const { result } = renderHook(() => useDrawerOpen(task), { wrapper })
  expect(result.current).toBe(false)
})
