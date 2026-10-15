import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { emitEvent } from '@/app/useEvents'
import { resetBubbles, useBubbleStore } from './bubbles'
import { EXCERPT_MAX, claimMyRequest, firstSentence, rememberMyRequest, useReplyBubble } from './replyBubble'

beforeEach(() => { resetBubbles(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

const task = { id: 't1', title: '검사 절차 정리', threadId: 'h1' }
const reply = (content: string) => ({ id: 'm2', threadId: 'h1', role: 'assistant', content, status: 'done', requestId: 'r1', attachmentIds: [], createdAt: '2026-10-15T00:00:00Z' })
function stubApi(content = '선택된 입력이 없어 대화 내용만으로 진행합니다. 자료 패널에서 파일을 고르면 반영됩니다.') {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/tasks/t1') return Response.json(task)
    if (url === '/api/threads/h1/messages') return Response.json([{ id: 'm1', threadId: 'h1', role: 'user', content: '질문', status: 'done', requestId: 'r1', attachmentIds: [], createdAt: '2026-10-15T00:00:00Z' }, reply(content)])
    return Response.json({ message: 'not found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function mount(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{children}</MemoryRouter></QueryClientProvider>
  return renderHook(() => useReplyBubble(), { wrapper })
}
const done = (requestId = 'r1', status = 'succeeded') => emitEvent({ event: 'request.updated', data: { requestId, threadId: 'h1', taskId: 't1', status, phase: null } })
const current = () => useBubbleStore.getState().current

it('첫 문장만, 최대 80자 — 마크다운 머리·목록 기호는 걷고 AI를 부르지 않는다', () => {
  expect(firstSentence('선택된 입력이 없어 진행합니다. 자료 패널에서 고르세요.')).toBe('선택된 입력이 없어 진행합니다.')
  expect(firstSentence('\n\n# URS — 제목\n본문')).toBe('URS — 제목')
  expect(firstSentence('1. **트리거** — 대상 범위는?\n2. 다음')).toBe('트리거 — 대상 범위는?')
  expect(firstSentence('2026년 계획입니다. 이어서')).toBe('2026년 계획입니다.')
  expect(firstSentence('Version 1.2 is ready. Next')).toBe('Version 1.2 is ready.')
  const long = '가'.repeat(100)
  expect(firstSentence(long)).toHaveLength(EXCERPT_MAX)
  expect(firstSentence(long).endsWith('…')).toBe(true)
  expect(firstSentence('   \n  ')).toBe('')
})

it('내가 보낸 요청은 한 번만 소비된다 — 같은 저장소를 보는 다른 탭은 두 번째로 읽어 건너뛴다', () => {
  rememberMyRequest('r1')
  rememberMyRequest('r1')
  rememberMyRequest('r2')
  expect(JSON.parse(localStorage.getItem('mes-my-requests')!)).toEqual(['r1', 'r2'])
  expect(claimMyRequest('r1')).toBe(true)
  expect(claimMyRequest('r1')).toBe(false)
  expect(claimMyRequest('other')).toBe(false)
  expect(JSON.parse(localStorage.getItem('mes-my-requests')!)).toEqual(['r2'])
})

it('다른 화면에 있을 때 내 요청이 끝나면 제목·답 첫 문장·바로 가기 대상이 담긴 말풍선 한 번 — 같은 요청의 재수신은 무시', async () => {
  const fetcher = stubApi()
  rememberMyRequest('r1')
  mount('/')
  await act(async () => { done() })
  await vi.waitFor(() => expect(current()).toMatchObject({ source: 'reply.done', taskId: 't1', title: '검사 절차 정리', excerpt: '선택된 입력이 없어 대화 내용만으로 진행합니다.' }))
  expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(['/api/tasks/t1', '/api/threads/h1/messages'])
  await act(async () => { done() }) // SSE 재연결 재생 — 한 번만
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(useBubbleStore.getState().queued).toBeNull()
})

it('보고 있는 대화(/c/:id)는 화면이 직접 보여 주므로 알리지 않고, 내가 보내지 않은 요청·SR 대화·진행 중 상태도 알리지 않는다', async () => {
  const fetcher = stubApi()
  rememberMyRequest('r1')
  const viewing = mount('/c/t1')
  await act(async () => { done() })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(current()).toBeNull()
  expect(claimMyRequest('r1')).toBe(true) // 소비되지 않았다 — 기록은 남는다
  viewing.unmount()

  mount('/')
  await act(async () => { done('not-mine') })
  await act(async () => { emitEvent({ event: 'request.updated', data: { requestId: 'r1', threadId: 'sr-thread', taskId: null, status: 'succeeded' } }) })
  rememberMyRequest('r3')
  await act(async () => { done('r3', 'streaming') })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(current()).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  expect(claimMyRequest('r3')).toBe(true)
})

it('실패·중단은 다른 문구(source)로, 답 발췌 없이 알린다', async () => {
  const fetcher = stubApi()
  rememberMyRequest('r1')
  rememberMyRequest('r2')
  rememberMyRequest('r3')
  mount('/my-work')
  await act(async () => { done('r1', 'failed') })
  await vi.waitFor(() => expect(current()).toMatchObject({ source: 'reply.failed', taskId: 't1', title: '검사 절차 정리' }))
  expect(current()?.excerpt).toBeUndefined()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/tasks/t1']) // 메시지는 읽지 않는다
  await act(async () => { done('r2', 'cancelled') })
  await vi.waitFor(() => expect(useBubbleStore.getState().queued).toMatchObject({ source: 'reply.cancelled' }))
  await act(async () => { useBubbleStore.getState().dismiss(); useBubbleStore.getState().dismiss() })
  await act(async () => { done('r3', 'interrupted') })
  await vi.waitFor(() => expect(current()).toMatchObject({ source: 'reply.failed' }))
})

it('대화를 읽지 못하면(삭제 등) 조용히 넘어간다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'gone' }, { status: 404 })))
  rememberMyRequest('r1')
  mount('/')
  await act(async () => { done() })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(current()).toBeNull()
})
