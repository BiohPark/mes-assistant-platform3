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
