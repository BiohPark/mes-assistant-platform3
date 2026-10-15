import { afterEach, expect, it, vi } from 'vitest'
import { addTag, appendMessage, getMessages, listTasks, setTaskStatus, setTaskTitle, startConversation } from './tasks'

afterEach(() => vi.unstubAllGlobals())

it('uses the task API for demo-shaped mutations and keeps manual titles', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    if (url === '/api/tasks') return new Response(JSON.stringify({ id: 't', threadId: 'h', code: 'WK-2026-0001', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u' }), { status: 201 })
    return new Response(JSON.stringify({}), { status: 200 })
  }))
  const created = await startConversation({ userId: 'u' }, { assistantId: 'a', tags: ['x'] })
  expect(created.thread.id).toBe('h')
  expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({ assistantId: 'a', tags: ['x'] })
  await setTaskTitle('t', '내 제목', 'manual')
  expect(JSON.parse(String(calls[1]![1]?.body))).toEqual({ title: '내 제목' })
  await addTag({ userId: 'u' }, 't', '#SR-2026-0001')
  expect(calls[2]![0]).toBe('/api/tasks/t/tags/%23SR-2026-0001')
  await setTaskStatus({ userId: 'u' }, 't', 'in_progress', { reason: '재개' })
  expect(JSON.parse(String(calls[3]![1]?.body))).toEqual({ status: 'in_progress', reason: '재개' })
  await appendMessage({ userId: 'u' }, 'h', 'user', '팀 의견', [], 'done', 'discussion')
  expect(JSON.parse(String(calls[4]![1]?.body))).toEqual({ content: '팀 의견', kind: 'discussion' })
})

it('encodes shared list filters in the URL', async () => {
  let seen = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { seen = url; return new Response('[]', { status: 200 }) }))
  await listTasks({ assistantId: 'a', status: ['done'], tags: ['a b'], mine: true })
  expect(seen).toBe('/api/tasks?assistantId=a&status%5B%5D=done&tag%5B%5D=a+b&mine=true')
})

it('preserves the HTTP status and server message when task access is forbidden', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '작업 조회 거부' }), { status: 403 })))
  await expect(listTasks()).rejects.toMatchObject({ status: 403, message: '작업 조회 거부' })
})

it('passes the message query cancellation signal to fetch', async () => {
  const signal = new AbortController().signal
  const fetch = vi.fn(async () => new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  await getMessages('thread', signal)
  expect(fetch).toHaveBeenCalledWith('/api/threads/thread/messages', expect.objectContaining({ signal }))
})

it('requests lightweight pages, reads the cursor header and forwards cancellation', async () => {
  const { listTaskPage } = await import('./tasks')
  const signal = new AbortController().signal
  const fetcher = vi.fn(async () => new Response('[]', { headers: { 'X-Next-Cursor': 'next-page' } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await listTaskPage({ mine: true, status: ['in_progress'], q: 'SR 2', ai: ['responding'], limit: 6, cursor: 'first' }, signal)).toEqual({ items: [], nextCursor: 'next-page' })
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  const params = new URL(url, 'https://test').searchParams
  expect(Object.fromEntries(params)).toMatchObject({ view: 'summary', limit: '6', cursor: 'first', mine: 'true', q: 'SR 2', 'ai[]': 'responding', 'status[]': 'in_progress' })
  expect(init.signal).toBe(signal)
})

it('requests board counts and per-column continuation without task detail calls', async () => {
  const { getTaskBoard } = await import('./tasks')
  const board = { columns: [{ assistantId: 'a', total: 31, items: [], nextCursor: 'next' }] }
  const fetcher = vi.fn(async () => Response.json(board))
  vi.stubGlobal('fetch', fetcher)
  expect(await getTaskBoard({ assistantId: 'a', cursor: 'next', status: ['todo', 'in_progress', 'on_hold'] })).toEqual(board)
  expect(fetcher.mock.calls).toHaveLength(1)
  expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain('/api/tasks/board?')
})

it('treats a malformed summary payload as a query error', async () => {
  const { listTaskPage } = await import('./tasks')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
  await expect(listTaskPage()).rejects.toThrow('Invalid task summary response')
})
