import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DraftConversationPage } from './DraftConversationPage'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
afterEach(() => { vi.unstubAllGlobals(); toastError.mockClear() })

it('creates a task only on the first discussion send and shows the conversation code', async () => {
  const posts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/users' || url.startsWith('/api/tags/suggest')) return new Response('[]', { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '도우미 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['abc'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }), { status: 201 })
    }
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'm', threadId: 'h', role: 'user', kind: 'discussion', content: '팀 의견', createdAt: '2026-09-28T00:00:00.000Z', authorId: 'u', attachmentIds: [], status: 'done' }), { status: 201 })
    if (url.startsWith('/api/tasks/t')) return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '도우미 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['abc'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }), { status: 200 })
    if (url === '/api/threads/h/messages') return new Response('[]', { status: 200 })
    return new Response('[]', { status: 200 })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><MemoryRouter initialEntries={['/new/a?tag=abc']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={<div>대화로 이동</div>} /></Routes></MemoryRouter></TooltipProvider></MeContext></QueryClientProvider>)
  await screen.findByText('도우미')
  expect(posts).toHaveLength(0)
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '팀 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(JSON.parse(posts[0]!)).toEqual({ assistantId: 'a', tags: ['abc'], firstMessage: '팀 의견' })
  await screen.findByText('대화로 이동')
  expect(posts).toHaveLength(1)
})

it('keeps the draft and shows an error if creation fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') return new Response(JSON.stringify({ message: '생성 실패' }), { status: 500 })
    return new Response('[]', { status: 200 })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><MemoryRouter initialEntries={['/new/a']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={<div>대화로 이동</div>} /></Routes></MemoryRouter></TooltipProvider></MeContext></QueryClientProvider>)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '남길 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue('남길 의견'))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  expect(screen.queryByText('대화로 이동')).not.toBeInTheDocument()
})

it('disables sending while the create request is pending', async () => {
  let posts = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') { posts++; return new Promise<Response>(() => undefined) }
    return new Response('[]', { status: 200 })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><TooltipProvider><MemoryRouter initialEntries={['/new/a']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /></Routes></MemoryRouter></TooltipProvider></MeContext></QueryClientProvider>)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '첫 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(posts).toBe(1)
})
