import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatView } from './ChatView'
import { queueFirstRequest } from './useChat'
import { queryClient } from '@/api/queryClient'
import { clearDrafts, getDraft } from './drafts'

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess, warning: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); toastError.mockClear(); toastSuccess.mockClear(); queryClient.clear(); clearDrafts() })

it('reloads messages after the first AI request when the initial message fetch returns empty late', async () => {
  let finishInitialFetch!: (response: Response) => void
  const initialFetch = new Promise<Response>((resolve) => { finishInitialFetch = resolve })
  let messageFetches = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/messages') {
      messageFetches++
      if (messageFetches === 1) return initialFetch
      return Response.json([
        { id: 'u', threadId: 'h', seq: 1, role: 'user', content: '첫 AI 질문', status: 'done', createdAt: '2026-09-28T00:00:00.000Z', attachmentIds: [] },
        { id: 'a', threadId: 'h', seq: 2, role: 'assistant', content: '첫 답변', status: 'done', createdAt: '2026-09-28T00:00:01.000Z', attachmentIds: [] },
      ])
    }
    if (url === '/api/threads/h/requests') {
      return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    }
    return Response.json([])
  }))
  queueFirstRequest('h', { content: '첫 AI 질문', attachmentIds: [], oneShotFileIds: [] })
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><ChatView task={task} /></TooltipProvider></MeContext></QueryClientProvider>)
  await waitFor(() => expect(messageFetches).toBe(1))
  await waitFor(() => expect(sessionStorage.length).toBe(0))
  finishInitialFetch(Response.json([]))
  expect(await screen.findByText('첫 AI 질문')).toBeVisible()
  expect(screen.getByText('첫 답변')).toBeVisible()
  expect(messageFetches).toBe(2)
})

it('keeps a discussion draft and shows an error when the message API fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ message: '저장 실패' }), { status: 500 })
    : new Response('[]', { status: 200 })))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(input, { target: { value: '남길 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  expect(input).toHaveValue('남길 의견')
})

it('uploads a pinned attachment and stores it on the discussion message', async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body })
    if (url === '/api/files') return new Response(JSON.stringify({ id: 'f', name: 'note.txt' }), { status: 201 })
    if (url === '/api/tasks/t/inputs/f') return new Response(null, { status: 204 })
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'm', attachmentIds: ['f'] }), { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByText('이번 메시지만')) // 팀 의견 첨부 기본값은 '이번 메시지만'(B-2) → 고정으로 바꿔 보낸다
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls.some((call) => call.url === '/api/threads/h/messages' && call.method === 'POST')).toBe(true))
  expect(calls.some((call) => call.url === '/api/tasks/t/inputs/f' && call.method === 'PUT')).toBe(true)
  expect(JSON.parse(String(calls.find((call) => call.url === '/api/threads/h/messages' && call.method === 'POST')?.body))).toMatchObject({ attachmentIds: ['f'] })
})

it('sends an AI request through SSE and leaves pinning to the server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === '/api/files') return new Response(JSON.stringify({ id: 'f', name: 'note.txt' }), { status: 201 })
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {"requestInfo":{}}\n\n', { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls.some((call) => call.url === '/api/threads/h/requests')).toBe(true))
  expect(calls.some((call) => call.url === '/api/tasks/t/inputs/f')).toBe(false)
  const sent = calls.find((call) => call.url === '/api/threads/h/requests')!
  expect(JSON.parse(String(sent.init?.body))).toMatchObject({ content: '질문', attachmentIds: ['f'], oneShotFileIds: [] })
  expect((sent.init?.headers as Record<string, string> | undefined)?.['Idempotency-Key']).toBeTruthy()
})

it.each(['over-limit', 'estimate failure'] as const)('reuses the uploaded draft attachment after %s', async (firstResult) => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let estimates = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === '/api/files') return new Response(JSON.stringify({ id: 'f', name: 'note.txt' }), { status: 201 })
    if (url === '/api/threads/h/requests/estimate') {
      const hasAttachment = (JSON.parse(String(init?.body)) as { attachmentIds?: string[] }).attachmentIds?.includes('f')
      if (hasAttachment) estimates++
      if (hasAttachment && estimates === 1 && firstResult === 'estimate failure') return new Response(JSON.stringify({ message: '추정 실패' }), { status: 500 })
      return new Response(JSON.stringify({ bytes: 300, limitBytes: 256, inputs: [], srCodes: [], srs: [], overLimit: hasAttachment && estimates === 1,
        attachmentLimit: 10 }), { status: 201 })
    }
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {"requestInfo":{}}\n\n', { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls.some((call) => call.url === '/api/threads/h/requests')).toBe(true))
  expect(calls.filter((call) => call.url === '/api/files')).toHaveLength(1)
  expect(JSON.parse(String(calls.find((call) => call.url === '/api/threads/h/requests')?.init?.body))).toMatchObject({ attachmentIds: ['f'] })
})

it('names the assistant in the request placeholder', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  const assistant = { id: 'a', name: '분석 도우미' } as Assistant
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} assistant={assistant} /></MeContext></QueryClientProvider>)
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveAttribute('placeholder', '분석 도우미에게 요청하세요. Enter 전송, Shift+Enter 줄바꿈')
})

it('shows the phase of a request running in another tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/messages') return new Response(JSON.stringify([{ id: 'a', requestId: 'remote', threadId: 'h', seq: 1,
      role: 'assistant', content: '', status: 'streaming', createdAt: new Date().toISOString(), attachmentIds: [] }]), { status: 200 })
    if (url === '/api/requests/remote') return new Response(JSON.stringify({ id: 'remote', status: 'pending', phase: '파일 올리는 중 1/1' }), { status: 200 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  await waitFor(() => expect(screen.getByText('파일 올리는 중 1/1')).toBeVisible())
})

it('disables AI send when the estimate exceeds the request budget', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/requests/estimate') return new Response(JSON.stringify({ provider: 'mock', transport: 'inline', model: 'mock',
      bytes: 300, limitBytes: 256, inputs: [], srCodes: [], srs: [], overLimit: true, attachmentLimit: 10 }), { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '길어진 초안' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeDisabled())
  expect(screen.getByRole('alert')).toHaveTextContent('요청 크기 한도')
})

it.each([false, true])('allows send after a smaller draft estimate fails and retains the pre-send guard (overLimit=%s)', async (preSendOverLimit) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['messages', 'h'], [])
  const sent: unknown[] = []
  const previews: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/threads/h/requests/estimate') {
      const body = JSON.parse(String(init?.body)) as { draft: string; attachmentIds?: string[] }
      if (body.attachmentIds) previews.push(body)
      else if (body.draft === '짧음') return Response.json({ message: '추정 실패' }, { status: 500 })
      const overLimit = body.attachmentIds ? preSendOverLimit : true
      return Response.json({ at: '2026-09-28T00:00:00.000Z', provider: 'mock', transport: 'inline', model: 'mock',
        bytes: overLimit ? 1200 : 100, limitBytes: 1000, inputs: [], srCodes: [], srs: [], overLimit, attachmentLimit: 10 })
    }
    if (url === '/api/threads/h/requests') {
      sent.push(JSON.parse(String(init?.body)))
      return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    }
    return Response.json([])
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={client}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '한도를 초과한 긴 초안' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeDisabled())
  fireEvent.change(input, { target: { value: '짧음' } })
  expect(screen.getByRole('button', { name: '전송' })).toBeEnabled()
  expect(screen.getByText('계산 중')).toBeVisible()
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['estimate'] }).some((query) => query.state.status === 'error')).toBe(true))
  expect(screen.queryByText('계산 중')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('요청 크기 한도')
  expect(screen.getByRole('button', { name: '전송' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  if (preSendOverLimit) {
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(sent).toHaveLength(0)
    expect(input).toHaveValue('짧음')
  } else {
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ content: '짧음' })
  }
  expect(previews).toEqual([{ draft: '짧음', attachmentIds: [], oneShotFileIds: [] }])
})

it.each(['star', 'remove'] as const)('shows calculating and dims references during a %s refetch without a revision change', async (action) => {
  queryClient.setQueryData(['messages', 'h'], [])
  const info = { at: '2026-09-28T00:00:00.000Z', provider: 'mock', transport: 'inline', model: 'mock',
    bytes: 400, limitBytes: 1000, srCodes: [], srs: [], overLimit: false, attachmentLimit: 10,
    inputs: [{ kind: 'conversation', sourceTaskId: 'source', code: 'C-1', title: '참조 대화', assistantName: '도우미',
      weight: 'reference', mode: 'full', snapshotId: 'snapshot', messageCount: 2, bytes: 300 }] }
  let finishRefetch!: (response: Response) => void
  let estimates = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/requests/estimate') {
      if (++estimates === 1) return Response.json(info)
      return new Promise<Response>((resolve) => { finishRefetch = resolve })
    }
    if (url === '/api/tasks/t/conversation-inputs/source') return new Response(null, { status: 204 })
    return Response.json([])
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={queryClient}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '질문' } })
  await screen.findByText('예상 400 B / 1000 B')
  const root = screen.getByLabelText('이번 요청에 사용할 자료')
  const meter = screen.getByRole('meter')
  fireEvent.click(screen.getByRole('button', { name: action === 'star' ? 'C-1 주 입력 전환' : 'C-1 입력 선택 해제' }))
  await screen.findByText('계산 중')
  expect(root).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('list')).toHaveClass('opacity-60')
  expect(screen.getByText('C-1')).toBeVisible()
  expect(screen.getByRole('button', { name: 'C-1 주 입력 전환' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'C-1 입력 선택 해제' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '전송' })).toBeEnabled()
  expect(screen.getByRole('meter')).toBe(meter)
  expect(meter.firstElementChild).toHaveStyle({ width: '40%' })
  await act(async () => finishRefetch(Response.json({ ...info, bytes: 100,
    inputs: action === 'star' ? [{ ...info.inputs[0], weight: 'main' }] : [] })))
  await screen.findByText('예상 100 B / 1000 B')
  expect(screen.getByLabelText('이번 요청에 사용할 자료')).toBe(root)
  expect(root).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByRole('list')).not.toHaveClass('opacity-60')
})

const emptyHint = '같은 태그 대화의 파일·대화를 자료 탭에서 골라 AI 입력으로 쓸 수 있습니다.'

it('offers materials only after messages load empty and opening adds no requests or selections', async () => {
  let finish!: (response: Response) => void
  const calls: Array<{ url: string; method?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method })
    if (url === '/api/threads/h/messages') return new Promise<Response>((resolve) => { finish = resolve })
    return Response.json([])
  }))
  const open = vi.fn()
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><ChatView task={task} onOpenMaterials={open} /></MeContext></QueryClientProvider>)
  expect(screen.queryByText(emptyHint)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '자료 열기' })).not.toBeInTheDocument()
  await act(async () => finish(Response.json([])))
  expect(await screen.findByText(emptyHint)).toBeVisible()
  const before = [...calls]
  fireEvent.click(screen.getByRole('button', { name: '자료 열기' }))
  expect(open).toHaveBeenCalledOnce()
  expect(calls).toEqual(before)
  expect(calls.some(({ url }) => /candidates|inputs/.test(url))).toBe(false)
})

it.each(['error', 'nonempty'] as const)('does not offer empty-conversation materials for %s messages', async (result) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/threads/h/messages'
    ? result === 'error' ? Response.json({ message: '실패' }, { status: 500 }) : Response.json([{ id: 'm', threadId: 'h', seq: 1, role: 'user', content: '기존 대화', status: 'done', createdAt: '2026-01-01', attachmentIds: [] }])
    : Response.json([])))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={client}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ChatView task={task} onOpenMaterials={() => undefined} /></TooltipProvider></MeContext></QueryClientProvider>)
  await waitFor(() => expect(client.getQueryState(['messages', 'h'])?.status).toBe(result === 'error' ? 'error' : 'success'))
  expect(screen.queryByText(emptyHint)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '자료 열기' })).not.toBeInTheDocument()
})

it('turns a file dropped on the conversation area into a pending attachment chip', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const, email: null, emailIsDefault: false }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  const zone = screen.getByTestId('chat-dropzone')
  const drag = { dataTransfer: { types: ['Files'], files: [new File(['a'], 'dropped.txt', { type: 'text/plain' })], items: [] } }
  fireEvent.dragEnter(zone, drag)
  expect(screen.getByText('놓으면 첨부 대기에 추가')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.drop(zone, drag)
  expect(screen.queryByText('놓으면 첨부 대기에 추가')).not.toBeInTheDocument()
  expect(screen.getByText('dropped.txt')).toBeInTheDocument()
  expect(screen.getByText('입력으로 고정')).toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 첨부 대기에 추가했습니다.')
})

it('stages drops on a completed conversation before asking to reopen', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const task = { id: 't', threadId: 'h', status: 'done', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const, email: null, emailIsDefault: false }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.dragEnter(screen.getByTestId('chat-dropzone'), { dataTransfer: { types: ['Files'], files: [], items: [] } })
  expect(screen.getByText('놓으면 첨부 대기에 추가')).toBeInTheDocument()
})

const originalQuestion = { id: 'original', threadId: 'h', role: 'user', content: '**기존 질문**', status: 'done', createdAt: '2026-01-01T00:00:00Z', attachmentIds: ['old-file'], requestId: 'old-request' }
function actionView(status = 'in_progress') {
  const task = { id: 't', threadId: 'h', status, inputs: [], tags: [] } as unknown as Task
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ChatView task={task} /></TooltipProvider></MeContext></QueryClientProvider>)
}

it('keeps the question index above the message scroller when messages arrive and while scrolling', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/messages')
    ? new Promise<Response>(resolve => { finish = resolve }) : Response.json([])))
  actionView()
  expect(screen.queryByRole('button', { name: '질문 목차' })).not.toBeInTheDocument()
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => finish(Response.json([originalQuestion])))
  const trigger = await screen.findByRole('button', { name: '질문 목차' })
  const toolbar = screen.getByTestId('chat-question-toolbar')
  const scroller = screen.getByTestId('chat-message-scroll')
  expect(toolbar).toContainElement(trigger)
  expect(scroller).not.toContainElement(trigger)
  expect(toolbar.nextElementSibling).toBe(scroller)
  expect(scroller.querySelector('[data-message-id="original"]')).toBeInTheDocument()
  fireEvent.scroll(scroller, { target: { scrollTop: 200 } })
  expect(toolbar).toContainElement(trigger)
  const user = userEvent.setup()
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('dialog', { name: '질문 목차' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  await user.keyboard('{Enter}')
  await screen.findByRole('dialog', { name: '질문 목차' })
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '질문 목차' })).not.toBeInTheDocument())
  expect(scroller.querySelector('[data-message-id="original"]')).toHaveFocus()
})

it('confirms draft replacement, preserves current attachments and sends prefill through estimate and SSE', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/threads/h/messages') return Response.json([originalQuestion])
    if (url === '/api/files') return Response.json({ id: 'current-file', name: 'current.txt' })
    if (init?.method === 'POST' && typeof init.body === 'string') requests.push({ url, body: JSON.parse(init.body) })
    if (url.endsWith('/estimate')) return Response.json({ bytes: 100, limitBytes: 1000, inputs: [], srCodes: [], srs: [], overLimit: false })
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"new","replyMessageId":"new-answer"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    return Response.json([])
  }))
  const { container } = actionView()
  const ask = await screen.findByRole('button', { name: '다시 묻기' })
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '지킬 초안' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['current'], 'current.txt')] } })
  fireEvent.click(ask)
  expect(await screen.findByRole('dialog')).toHaveTextContent('작성 중인 텍스트를 바꿀까요?')
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(input).toHaveValue('지킬 초안')
  fireEvent.click(ask)
  fireEvent.click(screen.getByRole('button', { name: '텍스트 바꾸기' }))
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveValue(originalQuestion.content)
  expect(screen.getByText('current.txt')).toBeVisible()
  expect(screen.getByText('현재 자료·모델로 새 요청, 이전 문답 포함')).toBeVisible()
  await waitFor(() => expect(requests.some(r => r.url.endsWith('/estimate') && r.body.draft === originalQuestion.content)).toBe(true))
  expect(requests.some(r => r.url === '/api/threads/h/requests')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(requests.some(r => r.url === '/api/threads/h/requests')).toBe(true))
  expect(requests.find(r => r.url === '/api/threads/h/requests')?.body).toEqual({ content: originalQuestion.content, attachmentIds: ['current-file'], oneShotFileIds: [] })
  expect(requests.find(r => r.url.endsWith('/estimate') && r.body.attachmentIds)?.body).toEqual({ draft: originalQuestion.content, attachmentIds: ['current-file'], oneShotFileIds: [] })
  expect(originalQuestion.attachmentIds).toEqual(['old-file'])
  expect(requests.some(r => r.url.includes('/retry'))).toBe(false)
})

it('blocks reasking while a failed attempt is stored and resends that attempt unchanged', async () => {
  const requests: Array<{ key?: string; body: Record<string, unknown> }> = []
  let status = 409
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/threads/h/messages') return Response.json([originalQuestion])
    if (url === '/api/files') return Response.json({ id: 'file-a', name: 'a.txt' })
    if (url.endsWith('/estimate')) return Response.json({ bytes: 100, limitBytes: 1000, inputs: [], srCodes: [], srs: [], overLimit: false })
    if (url === '/api/threads/h/requests') {
      requests.push({ key: (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'], body: JSON.parse(String(init?.body)) })
      if (status === 409) return Response.json({ message: '이미 응답 중입니다' }, { status })
      return new Response('event: started\ndata: {"requestId":"new","replyMessageId":"new-answer"}\n\nevent: completed\ndata: {}\n\n', { status })
    }
    return Response.json([])
  }))
  const { container } = actionView()
  await screen.findByRole('button', { name: '다시 묻기' })
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '실패할 새 질문' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.txt')] } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  expect(requests).toHaveLength(2)
  expect(input).toHaveValue('실패할 새 질문')
  const ask = screen.getByRole('button', { name: '다시 묻기' })
  expect(ask).toBeDisabled()
  expect(screen.getByText('전송하지 못한 요청이 있습니다. 전송을 누르면 같은 내용을 다시 보냅니다. 그 전에는 다시 묻기를 쓸 수 없습니다.')).toBeVisible()
  fireEvent.click(ask)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(input).toHaveValue('실패할 새 질문')
  status = 201
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[2]).toEqual(requests[0])
  expect(requests[2]!.body).toEqual({ content: '실패할 새 질문', attachmentIds: ['file-a'], oneShotFileIds: [] })
  await waitFor(() => expect(screen.getByRole('button', { name: '다시 묻기' })).toBeEnabled())
  expect(screen.queryByText('전송하지 못한 요청이 있습니다.', { exact: false })).not.toBeInTheDocument()
})

it.each(['done', 'streaming'])('disables reasking for %s conversations', async (state) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/messages') ? Response.json([originalQuestion, ...(state === 'streaming' ? [{ ...originalQuestion, id: 'remote', role: 'assistant', status: 'streaming' }] : [])]) : Response.json([])))
  actionView(state === 'done' ? 'done' : 'in_progress')
  expect(await screen.findByRole('button', { name: '다시 묻기' })).toBeDisabled()
})

it('moves keyboard focus from the mobile reask menu into the composer after it closes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/messages') ? Response.json([originalQuestion]) : Response.json([])))
  actionView()
  const trigger = await screen.findByRole('button', { name: '메시지 메뉴' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: '다시 묻기' }))
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  await waitFor(() => expect(input).toHaveValue(originalQuestion.content))
  expect(input).toHaveFocus()
})

it('keeps the staged attachment and draft across a task refetch and a chat remount, then prefills on top of them', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/messages') return Response.json([originalQuestion])
    if (url.endsWith('/estimate')) return Response.json({ bytes: 100, limitBytes: 1000, inputs: [], srCodes: [], srs: [], overLimit: false })
    return Response.json([])
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = (key: string, task: Task) => <QueryClientProvider client={client}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ChatView key={key} task={task} /></TooltipProvider></MeContext></QueryClientProvider>
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  const { container, rerender } = render(view('1', task))
  await screen.findByRole('button', { name: '다시 묻기' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['current'], 'current.txt')] } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '지킬 초안' } })
  rerender(view('1', { ...task, lastActivityAt: '2026-10-13T00:00:01.000Z' } as Task)) // 재조회: 같은 대화의 새 객체
  expect(screen.getByText('current.txt')).toBeVisible()
  rerender(view('2', { ...task })) // 재마운트: TaskBody의 key 격리와 같은 경로
  expect(screen.getByText('current.txt')).toBeVisible()
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  expect(input).toHaveValue('지킬 초안')
  fireEvent.click(await screen.findByRole('button', { name: '다시 묻기' }))
  fireEvent.click(await screen.findByRole('button', { name: '텍스트 바꾸기' }))
  await waitFor(() => expect(input).toHaveValue(originalQuestion.content))
  expect(screen.getByText('current.txt')).toBeVisible()
  expect(screen.getByRole('button', { name: '첨부 제거' })).toBeInTheDocument()
})

function progressView(status: Task['status']) {
  const task = { id: 't', threadId: 'h', status, inputs: [], tags: [] } as unknown as Task
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><ChatView task={task} /></TooltipProvider></MeContext></QueryClientProvider>)
}

it.each([false, true])('asks before reopening and sends the preserved draft after the reason (discussion=%s)', async discussion => {
  const calls: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method === 'POST' || init?.method === 'PUT') && !url.endsWith('/typing')) calls.push({ url, body: init.body instanceof FormData ? 'upload' : JSON.parse(String(init.body)) })
    if (url === '/api/files') return Response.json({ id: 'f', name: 'resume.txt' })
    if (url === '/api/tasks/t/status') return Response.json({ id: 't', status: 'in_progress' })
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return Response.json({ id: 'm' })
    if (url.endsWith('/estimate')) return Response.json({ inputs: [], srs: [], srCodes: [], bytes: 0, limitBytes: 100000, overLimit: false, attachmentLimit: 10 })
    return Response.json([])
  }))
  const { container } = progressView('done')
  if (discussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  const input = screen.getByRole('textbox', { name: discussion ? '팀 의견 입력' : 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '재개 후 보낼 내용' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'resume.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(await screen.findByRole('dialog', { name: '재개할까요?' })).toBeVisible()
  expect(calls.filter(call => !call.url.endsWith('/estimate'))).toHaveLength(0)
  expect(screen.getByRole('button', { name: '재개 확인' })).toBeDisabled()
  fireEvent.change(screen.getByPlaceholderText('사유를 입력하세요'), { target: { value: '추가 검토' } })
  fireEvent.click(screen.getByRole('button', { name: '재개 확인' }))
  const path = discussion ? '/api/threads/h/messages' : '/api/threads/h/requests'
  await waitFor(() => expect(calls.some(call => call.url === path)).toBe(true))
  expect(calls.find(call => call.url === '/api/tasks/t/status')?.body).toEqual({ status: 'in_progress', reason: '추가 검토' })
  expect(calls.find(call => call.url === path)?.body).toMatchObject({ content: '재개 후 보낼 내용', attachmentIds: ['f'] })
  expect(calls.findIndex(call => call.url === '/api/tasks/t/status')).toBeLessThan(calls.findIndex(call => call.url === path))
  expect(calls.findIndex(call => call.url === '/api/tasks/t/status')).toBeLessThan(calls.findIndex(call => call.url === '/api/files'))
  await waitFor(() => expect(input).toHaveValue(''))
})

it('keeps text and attachments when reopening is cancelled, and sends nothing', async () => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET' && !url.endsWith('/estimate') && !url.endsWith('/typing')) writes.push(url)
    if (url.endsWith('/estimate')) return Response.json({ inputs: [], srs: [], srCodes: [], bytes: 0, limitBytes: 100000, overLimit: false, attachmentLimit: 10 })
    return Response.json([])
  }))
  const { container } = progressView('done')
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '보존할 내용' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'preserved.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByRole('dialog', { name: '재개할까요?' })
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(input).toHaveValue('보존할 내용')
  expect(screen.getByText('preserved.txt')).toBeInTheDocument()
  expect(writes).toHaveLength(0)
  expect(toastError).not.toHaveBeenCalled()
})

it.each([false, true])('announces an automatic hold release with a one-click hold action (discussion=%s)', async discussion => {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') writes.push(url)
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","autoStarted":true}\n\nevent: completed\ndata: {}\n\n', { status: 201 })
    if (url === '/api/threads/h/messages' && init?.method === 'POST') return Response.json({ id: 'm', autoStarted: true })
    if (url.endsWith('/estimate')) return Response.json({ inputs: [], srs: [], srCodes: [], bytes: 0, limitBytes: 100000, overLimit: false, attachmentLimit: 10 })
    return Response.json([])
  }))
  progressView('on_hold')
  if (discussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: discussion ? '팀 의견 입력' : 'AI 요청 입력' }), { target: { value: '보류 해제' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('보류를 해제했습니다', expect.objectContaining({ action: expect.objectContaining({ label: '보류' }) })))
  const options = toastSuccess.mock.calls.find(call => call[0] === '보류를 해제했습니다')![1] as { action: { onClick: () => void } }
  options.action.onClick()
  await waitFor(() => expect(writes).toContain('/api/tasks/t/status'))
})

it('keeps the draft when navigating away during the reopen confirmation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/estimate')
    ? Response.json({ inputs: [], srs: [], srCodes: [], bytes: 0, limitBytes: 100000, overLimit: false, attachmentLimit: 10 }) : Response.json([])))
  const { container, unmount } = progressView('done')
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '다시 방문할 초안' } })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'saved.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await screen.findByRole('dialog', { name: '재개할까요?' })
  expect(getDraft('t')).toMatchObject({ text: '다시 방문할 초안', pending: [{ file: expect.any(File) }] })
  unmount()
  expect(getDraft('t')?.text).toBe('다시 방문할 초안')
})
