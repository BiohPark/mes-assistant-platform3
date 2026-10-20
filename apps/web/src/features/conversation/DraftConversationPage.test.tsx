import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'next-themes'
import { ProfileProvider } from '@/app/profile'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DraftConversationPage } from './DraftConversationPage'
import { clearDrafts } from '@/features/chat/drafts'
import { TaskPage } from '@/features/task/TaskPage'
import { useChat } from '@/features/chat/useChat'
import { useMaterialsDrawer } from '@/features/task/materialsDrawer'

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess, warning: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); clearDrafts(); toastError.mockClear(); toastSuccess.mockClear() })

const assistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }
const createdTask = { id: 't', code: 'WK-2026-0001', assistantId: 'a', threadId: 'h', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: assistant.createdAt, createdBy: 'u', lastActivityAt: assistant.createdAt }
function mountDraft(path = '/new/a', conversation = <div>대화로 이동</div>) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={conversation} /></Routes></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>)
}

function ReconnectingConversation() {
  useChat('h')
  return <div>대화로 이동</div>
}

it('담당자 칸 없이 첫 전송하고 서버 소유자 기본 배정을 사용한다', async () => {
  let body: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/catalog/users') return Response.json([{ id: 'u', name: '사용자', initials: '사', color: '#000', isSystemOwner: false, isBusinessOwner: false }, { id: 'other', name: '담당자', initials: '담', color: '#000', isSystemOwner: false, isBusinessOwner: false }])
    if (url === '/api/tasks' && init?.method === 'POST') { body = JSON.parse(String(init.body)) as Record<string, unknown>; return Response.json({ id: 't', threadId: 'h' }, { status: 201 }) }
    return Response.json([])
  }))
  mountDraft()
  await screen.findByText('도우미')
  expect(screen.queryByLabelText('담당자')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '담당자' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '배정할 업무' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(body).toEqual({ assistantId: 'a', tags: [], firstMessage: '배정할 업무' }))
})

it('reconnects the first AI request with the same body and key after losing the response', async () => {
  const calls: Array<{ url: string; body: string; key: string | null }> = []
  let creations = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') { creations++; return Response.json({ id: 't', threadId: 'h' }, { status: 201 }) }
    if (url === '/api/threads/h/requests' && init?.method === 'POST') {
      calls.push({ url, body: String(init.body), key: new Headers(init.headers).get('Idempotency-Key') })
      return new Response(calls.length === 1 ? 'event: started\ndata: {"requestId":"r","replyMessageId":"m"}\n\n' : 'event: started\ndata: {"requestId":"r","replyMessageId":"m"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    }
    return Response.json([])
  }))
  mountDraft('/new/a', <ReconnectingConversation />)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '첫 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls).toHaveLength(2))
  expect(calls[1]).toEqual(calls[0])
  expect(creations).toBe(1)
  expect(JSON.parse(calls[0]!.body)).toEqual({ content: '첫 질문', attachmentIds: [], oneShotFileIds: [] })
  await waitFor(() => expect(sessionStorage.length).toBe(0))
})

it('reuses the task creation key and reference after a lost creation response', async () => {
  const keys: Array<string | null> = []
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') {
      keys.push(new Headers(init.headers).get('Idempotency-Key'))
      bodies.push(JSON.parse(String(init.body)))
      if (keys.length === 1) throw new Error('연결 끊김')
      return Response.json({ id: 't', threadId: 'h' }, { status: 201 })
    }
    if (url === '/api/threads/h/requests') return new Response('event: completed\ndata: {}\n\n', { status: 201 })
    return Response.json([])
  }))
  mountDraft('/new/a?ref=source')
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '첫 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('대화로 이동')
  expect(keys).toEqual([expect.any(String), keys[0]])
  expect(bodies).toEqual([{ assistantId: 'a', tags: [], referenceTaskId: 'source' }, { assistantId: 'a', tags: [], referenceTaskId: 'source' }])
})

it('creates a task only on the first discussion send and shows the conversation code', async () => {
  const posts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/catalog/users' || url.startsWith('/api/tags/suggest')) return new Response('[]', { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') {
      posts.push(String(init.body))
      return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '도우미 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['abc'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }), { status: 201 })
    }
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'm', threadId: 'h', role: 'user', kind: 'discussion', content: '팀 의견', createdAt: '2026-09-28T00:00:00.000Z', authorId: 'u', attachmentIds: [], status: 'done' }), { status: 201 })
    if (url.startsWith('/api/tasks/t')) return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '도우미 대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['abc'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' }), { status: 200 })
    if (url === '/api/threads/h/messages') return new Response('[]', { status: 200 })
    return new Response('[]', { status: 200 })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><MemoryRouter initialEntries={['/new/a?tag=abc']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={<div>대화로 이동</div>} /></Routes></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>)
  await screen.findByText('도우미')
  expect(posts).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '팀 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(JSON.parse(posts[0]!)).toEqual({ assistantId: 'a', tags: ['abc'], firstMessage: '팀 의견' })
  await screen.findByText('대화로 이동')
  expect(posts).toHaveLength(1)
})

it.each([false, true])('starts the first AI request once and pins its attachment (attached in discussion=%s)', async (attachedInDiscussion) => {
  const calls: Array<{ url: string; body?: unknown; key?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ id: 't', threadId: 'h' }), { status: 201 }) }
    if (url === '/api/files' && init?.method === 'POST') { calls.push({ url }); return new Response(JSON.stringify({ id: 'f', name: 'one.txt' }), { status: 201 }) }
    if (url === '/api/tasks/t/inputs/f') { calls.push({ url }); return new Response(null, { status: 204 }) }
    if (url === '/api/threads/h/requests' && init?.method === 'POST') { calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('Idempotency-Key') ?? undefined }); return new Response('event: completed\ndata: {}\n\n', { status: 201 }) }
    return new Response('[]', { status: 200 })
  }))
  const { container } = mountDraft('/new/a', <ReconnectingConversation />)
  await screen.findByText('도우미')
  if (attachedInDiscussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['one'], 'one.txt')] } })
  if (attachedInDiscussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '첫 AI 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls.some((call) => call.url === '/api/threads/h/requests')).toBe(true))
  expect(calls.filter((call) => call.url === '/api/tasks')).toEqual([{ url: '/api/tasks', body: { assistantId: 'a', tags: [] } }])
  expect(calls.filter((call) => call.url === '/api/threads/h/requests')).toMatchObject([{ body: { content: '첫 AI 질문', attachmentIds: ['f'], oneShotFileIds: [] }, key: expect.any(String) }])
  expect(calls.some((call) => call.url === '/api/tasks/t/inputs/f')).toBe(true)
})

it.each([false, true])('stores the first team attachment without AI pinning (attached in discussion=%s)', async (attachedInDiscussion) => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body })
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') return Response.json({ id: 't', threadId: 'h' }, { status: 201 })
    if (url === '/api/files') return Response.json({ id: 'f', name: 'team.txt' }, { status: 201 })
    if (url === '/api/tasks/t/inputs/f') return new Response(null, { status: 204 })
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return Response.json({ id: 'm', attachmentIds: ['f'] }, { status: 201 })
    return Response.json([])
  }))
  const { container } = mountDraft('/new/a', <ReconnectingConversation />)
  await screen.findByText('도우미')
  if (attachedInDiscussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['team'], 'team.txt')] } })
  if (!attachedInDiscussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '첫 팀 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('대화로 이동')
  expect(JSON.parse(String(calls.find((call) => call.url === '/api/threads/h/messages' && call.method === 'POST')?.body))).toMatchObject({ content: '첫 팀 의견', attachmentIds: ['f'], kind: 'discussion' })
  expect(calls.some((call) => call.url === '/api/tasks/t/inputs/f')).toBe(false)
  expect(calls.some((call) => call.url === '/api/threads/h/requests' && call.method === 'POST')).toBe(false)
})

it('keeps the draft and shows an error if creation fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') return new Response(JSON.stringify({ message: '생성 실패' }), { status: 500 })
    return new Response('[]', { status: 200 })
  }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><MemoryRouter initialEntries={['/new/a']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={<div>대화로 이동</div>} /></Routes></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '남길 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('남길 의견'))
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
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><MemoryRouter initialEntries={['/new/a']}><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /></Routes></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '첫 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(posts).toBe(1)
})

it('keeps the created conversation and retries only the failed attachment upload', async () => {
  const calls: string[] = []
  let uploads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return new Response(JSON.stringify([{ id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }]), { status: 200 })
    if (url === '/api/tasks' && init?.method === 'POST') return new Response(JSON.stringify({ id: 't', code: 'WK-2026-0001', assistantId: 'a', threadId: 'h' }), { status: 201 })
    if (url === '/api/files' && init?.method === 'POST') { uploads++; return uploads === 1 ? new Response(JSON.stringify({ message: '업로드 실패' }), { status: 500 }) : new Response(JSON.stringify({ id: 'f' }), { status: 201 }) }
    if (url === '/api/threads/h/requests' && init?.method === 'POST') { calls.push('REQUEST'); return new Response('event: completed\ndata: {}\n\n', { status: 201 }) }
    if (url === '/api/tasks/t' && init?.method === 'DELETE') { calls.push('DELETE'); return new Response(null, { status: 204 }) }
    return new Response('[]', { status: 200 })
  }))
  const { container } = mountDraft('/new/a', <ReconnectingConversation />)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '남길 의견' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'test.txt')] } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  expect(calls).toEqual([])
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('남길 의견')
  expect(screen.getByText('test.txt')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('대화로 이동')
  expect(uploads).toBe(2)
  expect(calls).toEqual(['REQUEST'])
})

it('retries failed input pinning without uploading the file again', async () => {
  let creations = 0
  let uploads = 0
  let pins = 0
  let requests = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') { creations++; return Response.json({ id: 't', code: 'WK-2026-0001', threadId: 'h' }, { status: 201 }) }
    if (url === '/api/files' && init?.method === 'POST') { uploads++; return Response.json({ id: 'f' }, { status: 201 }) }
    if (url === '/api/tasks/t/inputs/f') { pins++; return pins === 1 ? Response.json({ message: '고정 실패' }, { status: 500 }) : new Response(null, { status: 204 }) }
    if (url === '/api/threads/h/requests') { requests++; return new Response('event: completed\ndata: {}\n\n', { status: 201 }) }
    if (url === '/api/tasks/t' && init?.method === 'DELETE') throw new Error('대화를 삭제하면 안 됩니다')
    return Response.json([])
  }))
  const { container } = mountDraft('/new/a', <ReconnectingConversation />)
  await screen.findByText('도우미')
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'test.txt')] } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(requests).toBe(1))
  expect({ creations, uploads, pins }).toEqual({ creations: 1, uploads: 1, pins: 2 })
})


it.each([
  { modelId: 'model A', link1: undefined, docUrl: 'https://docs.test', rule: 'https://owui.test/?model={modelId}&agent={assistantId}', expected: 'https://owui.test/?model=model%20A&agent=a' },
  { modelId: undefined, link1: 'https://direct.test', docUrl: undefined, rule: undefined, expected: 'https://direct.test' },
  { modelId: undefined, link1: undefined, docUrl: undefined, rule: 'https://owui.test/?agent={assistantId}', expected: undefined },
  { modelId: 'model A', link1: undefined, docUrl: undefined, rule: undefined, expected: undefined },
])('사용법 대신 설정된 링크 칩만 표시한다: $expected', async ({ modelId, link1, docUrl, rule, expected }) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return Response.json([{ ...assistant, modelId, link1, docUrl, usageExample: '- "첫 질문 예시"' }])
    if (url === '/api/settings') return Response.json({ link1Rule: rule })
    return Response.json([])
  }))
  const { container } = mountDraft('/new/a?ref=internal-reference-uuid')
  await screen.findByText('도우미')
  if (expected) {
    const link = await screen.findByRole('link', { name: 'OpenWebUI에서 열기' })
    expect(link).toHaveAttribute('href', expected)
    expect(link).toHaveAttribute('title', 'OpenWebUI에서 열기')
    expect(link.querySelector('svg')).toHaveTextContent('OW')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link.querySelector('.lucide-external-link')).toBeNull()
  }
  else expect(screen.queryByRole('link', { name: 'OpenWebUI에서 열기' })).not.toBeInTheDocument()
  if (modelId) expect(screen.getByText(modelId).closest('[data-slot="chip"]')).not.toBeNull()
  if (docUrl) expect(screen.getByRole('link', { name: '설명 문서' })).toHaveAttribute('href', docUrl)
  else expect(screen.queryByRole('link', { name: '설명 문서' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '사용법 보기' })).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('internal-reference-uuid')
  expect(screen.getByRole('button', { name: '첫 질문 예시' })).toBeInTheDocument()
})

it('attaches a file dropped on the draft screen like the attach button and uploads it on the first send', async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body })
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') return Response.json({ id: 't', threadId: 'h' }, { status: 201 })
    if (url === '/api/files') return Response.json({ id: 'f', name: 'dropped.txt' }, { status: 201 })
    if (url === '/api/tasks/t/inputs/f') return new Response(null, { status: 204 })
    return Response.json([])
  }))
  mountDraft()
  await screen.findByText('도우미')
  const zone = screen.getByTestId('draft-dropzone')
  const drag = { dataTransfer: { types: ['Files'], files: [new File(['a'], 'dropped.txt', { type: 'text/plain' })], items: [] } }
  fireEvent.dragEnter(zone, drag)
  expect(screen.getByText('놓으면 첨부 대기에 추가')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.drop(zone, drag)
  expect(screen.getByText('dropped.txt')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 첨부 대기에 추가했습니다.')
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('대화로 이동')
  expect((calls.find((call) => call.url === '/api/files')!.body as FormData).get('originTaskId')).toBe('t')
  expect(calls.some((call) => call.url === '/api/tasks/t/inputs/f' && call.method === 'PUT')).toBe(true)
})


it('clears Enter and shows thinking during creation and upload, carrying the start time into the first request', async () => {
  let finishCreation!: (response: Response) => void
  let finishUpload!: (response: Response) => void
  const creation = new Promise<Response>(resolve => { finishCreation = resolve })
  const upload = new Promise<Response>(resolve => { finishUpload = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') return creation
    if (url === '/api/files') return upload
    return Response.json([])
  }))
  const { container } = mountDraft()
  await screen.findByText('도우미')
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '첫 질문' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'first.txt')] } })
  const before = Date.now()
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  expect(input).toHaveValue('')
  expect(screen.getByRole('status')).toHaveTextContent('대기 중')
  expect(screen.getByRole('timer')).toBeVisible()
  finishCreation(Response.json({ id: 't', threadId: 'h' }, { status: 201 }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/files', expect.anything()))
  expect(screen.getByRole('timer')).toBeVisible()
  finishUpload(Response.json({ id: 'f' }))
  await screen.findByText('대화로 이동')
  const attempt = JSON.parse(sessionStorage.getItem('mes-chat-attempt:h')!) as { startedAt: number }
  expect(attempt.startedAt).toBeGreaterThanOrEqual(before)
  expect(attempt.startedAt).toBeLessThanOrEqual(Date.now())
})


it('keeps thinking visible while the destination task fetch is slow', async () => {

  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url.endsWith('/estimate')) return Response.json({ bytes: 0, limitBytes: 1000, overLimit: false, inputs: [], srs: [], srCodes: [] })
    if (url === '/api/tasks' && init?.method === 'POST') return Response.json(createdTask)
    if (url === '/api/tasks/t') return new Promise<Response>(() => undefined)
    if (url === '/api/tasks/t/candidates') return Response.json({ files: [], conversations: [] }) // 자료 패널이 기본으로 열린다(S14)
    if (url === '/api/threads/h/requests') return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))
    return Response.json([])
  }))
  mountDraft('/new/a', <TaskPage />)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '이동 중 질문' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { key: 'Enter', code: 'Enter' })
  await screen.findByTestId('chat-message-scroll')
  expect(screen.getByRole('status')).toHaveTextContent('대기 중')
  expect(screen.getByRole('timer')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toBeDisabled()
  await waitFor(() => expect(stream).toBeDefined())
  stream.enqueue(new TextEncoder().encode('event: completed\ndata: {}\n\n'))
  stream.close()
  await waitFor(() => expect(screen.queryByRole('timer')).not.toBeInTheDocument())
})


it.each([409, 500])('restores the first question and uploaded attachment on the destination after HTTP %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url.endsWith('/estimate')) return Response.json({ bytes: 0, limitBytes: 1000, overLimit: false, inputs: [], srs: [], srCodes: [] })
    if (url === '/api/tasks' && init?.method === 'POST' || url === '/api/tasks/t') return Response.json(createdTask)
    if (url === '/api/files') return Response.json({ id: 'f' })
    if (url === '/api/tasks/t/inputs/f') return new Response(null, { status: 204 })
    if (url === '/api/tasks/t/candidates') return Response.json({ files: [], conversations: [] }) // 자료 패널이 기본으로 열린다(S14)
    if (url === '/api/threads/h/requests') return Response.json({ message: '시작 실패' }, { status })
    return Response.json([])
  }))
  const { container } = mountDraft('/new/a', <TaskPage />)
  await screen.findByText('도우미')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '첫 실패 질문' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'first-restore.txt')] } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { key: 'Enter', code: 'Enter' })
  await screen.findByTestId('chat-message-scroll')
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('첫 실패 질문'))
  expect(screen.getByText('first-restore.txt')).toBeVisible()
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
})

it('S15: 이미 열린 초안(같은 에이전트)에 태그 프리셋 이동(state.tagPreset)이 오면 그 태그로 바꾸고, 탭 전환처럼 같은 주소로 돌아오면 손대지 않는다', async () => {
  let body: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') { body = JSON.parse(String(init.body)) as Record<string, unknown>; return Response.json({ id: 't', threadId: 'h' }, { status: 201 }) }
    return Response.json([])
  }))
  function Go() {
    const navigate = useNavigate()
    return <>
      <button type="button" onClick={() => navigate('/new/a?tag=B', { state: { tagPreset: true } })}>프리셋 B</button>
      <button type="button" onClick={() => navigate('/new/a?tag=B')}>탭으로 복귀</button>
    </>
  }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><MemoryRouter initialEntries={['/new/a?tag=A']}><Go /><Routes><Route path="/new/:assistantId" element={<DraftConversationPage />} /><Route path="/c/:taskId" element={<div>대화로 이동</div>} /></Routes></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>)
  await screen.findByRole('button', { name: 'A 태그 제거' })
  const addTag = (value: string) => { const input = screen.getByRole('combobox', { name: '태그 입력' }); fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' }) }
  addTag('수동')
  await screen.findByRole('button', { name: '수동 태그 제거' })
  fireEvent.click(screen.getByRole('button', { name: '프리셋 B' }))
  await screen.findByRole('button', { name: 'B 태그 제거' })
  expect(screen.queryByRole('button', { name: 'A 태그 제거' })).toBeNull()
  expect(screen.queryByRole('button', { name: '수동 태그 제거' })).toBeNull()
  // 탭 칩으로 돌아오는 이동(state 없음, 같은 주소)은 사람이 고친 태그를 지우지 않는다
  addTag('직접')
  await screen.findByRole('button', { name: '직접 태그 제거' })
  fireEvent.click(screen.getByRole('button', { name: '탭으로 복귀' }))
  expect(screen.getByRole('button', { name: '직접 태그 제거' })).toBeInTheDocument()
  // 주소가 같아도 프리셋 이동이면 다시 그 태그만
  fireEvent.click(screen.getByRole('button', { name: '프리셋 B' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '직접 태그 제거' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '메모' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(body).toEqual({ assistantId: 'a', tags: ['B'], firstMessage: '메모' }))
})

it('S16: 첫 전송으로 만든 대화는 "첫 질문 전" 자동 열림 없이 시작한다(자료 패널이 잠깐 열렸다 닫히지 않게)', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/assistants') return Response.json([assistant])
    if (url === '/api/tasks' && init?.method === 'POST') return Response.json({ ...createdTask, id: 't-started', tags: ['A'] }, { status: 201 })
    return Response.json([])
  }))
  mountDraft('/new/a?tag=A')
  await screen.findByRole('button', { name: 'A 태그 제거' })
  expect(useMaterialsDrawer.getState().byTask['t-started']?.choice).not.toBe('open')
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '메모' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByText('대화로 이동')
  expect(useMaterialsDrawer.getState().byTask['t-started']?.choice).not.toBe('open')
})
