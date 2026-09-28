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
