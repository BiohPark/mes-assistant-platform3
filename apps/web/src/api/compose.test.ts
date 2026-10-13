import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { applyEvent } from '@/app/useEvents'
import { composeInputs, type ComposeOp } from './compose'

afterEach(() => vi.unstubAllGlobals())

const ops: ComposeOp[] = [
  { kind: 'conversation', sourceTaskId: 'a', label: 'WK-1' },
  { kind: 'file', fileId: 'f', label: 'spec.txt v1' },
  { kind: 'switch', fromFileId: 'g1', toFileId: 'g2', label: 'plan.txt v2' },
]

it('sends ops in order with the existing endpoints and recalculates the estimate once', async () => {
  const calls: Array<[string, string | undefined, unknown]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init?.method, init?.body ? JSON.parse(String(init.body)) : undefined])
    return url.includes('conversation-inputs') ? new Response(JSON.stringify({}), { status: 200 }) : new Response(null, { status: 204 })
  }))
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const results = await composeInputs('t', ops, client)
  expect(results.map((item) => item.status)).toEqual(['done', 'done', 'done'])
  expect(calls).toEqual([
    ['/api/tasks/t/conversation-inputs/a', 'PUT', { mode: 'full' }],
    ['/api/tasks/t/inputs/f', 'PUT', { weight: 'reference' }],
    ['/api/tasks/t/inputs/g1/switch-version', 'POST', { toFileId: 'g2' }],
  ])
  expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'estimate')).toHaveLength(1)
})

it('stops at the first failure, keeps its reason, and leaves the rest unprocessed', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/inputs/f')
    ? new Response(JSON.stringify({ message: '후보에 없는 파일입니다' }), { status: 400 })
    : new Response(JSON.stringify({}), { status: 200 })))
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const results = await composeInputs('t', ops, client)
  expect(results).toEqual([
    { op: ops[0], status: 'done' },
    { op: ops[1], status: 'failed', reason: '후보에 없는 파일입니다' },
    { op: ops[2], status: 'pending' },
  ])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'estimate')).toHaveLength(1)
})

it('does not refresh anything when nothing was added', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '완료된 대화' }), { status: 409 })))
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const results = await composeInputs('t', ops, client)
  expect(results.map((item) => item.status)).toEqual(['failed', 'pending', 'pending'])
  expect(invalidate).not.toHaveBeenCalled()
})

it('collects estimate invalidations from per-item SSE events while adding and recalculates once at the end', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let estimates = 0
  const observer = new QueryObserver(client, { queryKey: ['estimate', 'h'], queryFn: async () => ++estimates })
  const unsubscribe = observer.subscribe(() => {})
  await observer.refetch()
  const before = estimates
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // 서버는 항목마다 SSE를 보낸다 — 그 이벤트가 담는 도중에 도착한 상황
    applyEvent(client, url.includes('conversation-inputs') ? 'context.updated' : 'input.updated', { taskId: 't' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    return new Response(null, { status: 204 })
  }))
  await composeInputs('t', ops.slice(0, 2), client)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(estimates - before).toBe(1)
  // 담기가 끝난 뒤의 이벤트는 그대로 반영된다
  applyEvent(client, 'input.updated', { taskId: 't' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(estimates - before).toBe(2)
  unsubscribe()
})
