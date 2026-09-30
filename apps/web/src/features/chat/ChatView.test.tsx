import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Task } from '@mes/domain'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { ChatView } from './ChatView'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
afterEach(() => { vi.unstubAllGlobals(); toastError.mockClear() })

it('keeps a discussion draft and shows an error when the message API fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ message: '저장 실패' }), { status: 500 })
    : new Response('[]', { status: 200 })))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  const input = screen.getByRole('textbox', { name: '팀 의견 입력' })
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
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
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
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '질문' } })
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
      return new Response(JSON.stringify({ bytes: 300, limitBytes: 256, inputs: [], srCodes: [], overLimit: hasAttachment && estimates === 1,
        attachmentLimit: 10 }), { status: 201 })
    }
    if (url === '/api/threads/h/requests') return new Response('event: started\ndata: {"requestId":"r","replyMessageId":"a","userMessageId":"u"}\n\nevent: completed\ndata: {"requestInfo":{}}\n\n', { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'note.txt', { type: 'text/plain' })] } })
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(toastError).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(calls.some((call) => call.url === '/api/threads/h/requests')).toBe(true))
  expect(calls.filter((call) => call.url === '/api/files')).toHaveLength(1)
  expect(JSON.parse(String(calls.find((call) => call.url === '/api/threads/h/requests')?.init?.body))).toMatchObject({ attachmentIds: ['f'] })
})

it('shows the phase of a request running in another tab', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/messages') return new Response(JSON.stringify([{ id: 'a', requestId: 'remote', threadId: 'h', seq: 1,
      role: 'assistant', content: '', status: 'streaming', createdAt: new Date().toISOString(), attachmentIds: [] }]), { status: 200 })
    if (url === '/api/requests/remote') return new Response(JSON.stringify({ id: 'remote', status: 'pending', phase: '파일 올리는 중 1/1' }), { status: 200 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress' } as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  await waitFor(() => expect(screen.getByText('파일 올리는 중 1/1')).toBeVisible())
})

it('disables AI send when the estimate exceeds the request budget', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/threads/h/requests/estimate') return new Response(JSON.stringify({ provider: 'mock', transport: 'inline', model: 'mock',
      bytes: 300, limitBytes: 256, inputs: [], srCodes: [], overLimit: true, attachmentLimit: 10 }), { status: 201 })
    return new Response('[]', { status: 200 })
  }))
  const task = { id: 't', threadId: 'h', status: 'in_progress', inputs: [], tags: [] } as unknown as Task
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'] }}><ChatView task={task} /></MeContext></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '길어진 초안' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeDisabled())
  expect(screen.getByRole('alert')).toHaveTextContent('요청 크기 한도')
})
