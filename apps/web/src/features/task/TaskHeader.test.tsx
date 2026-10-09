import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TaskHeader } from './TaskHeader'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '기본 제목', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
const assistant = { id: 'a', name: '도우미', color: '#123456' } as Assistant
afterEach(() => vi.unstubAllGlobals())

it('saves edited title as manual and requires a reason when reopening', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    return new Response(JSON.stringify({}), { status: 200 })
  }))
  const wrap = (value: Task) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MemoryRouter><TaskHeader task={value} assistant={assistant} /></MemoryRouter></MeContext></QueryClientProvider>
  const view = render(wrap(task))
  fireEvent.click(screen.getByRole('button', { name: '기본 제목' }))
  fireEvent.change(screen.getByRole('textbox', { name: '대화 제목' }), { target: { value: '내 제목' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '대화 제목' }), { key: 'Enter' })
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t' && JSON.parse(String(init?.body)).title === '내 제목')).toBe(true))
  view.rerender(wrap({ ...task, title: '내 제목', titleSource: 'manual', status: 'done' }))
  fireEvent.click(screen.getByRole('button', { name: '다시 열기' }))
  expect(screen.getByRole('button', { name: '재개 확인' })).toBeDisabled()
  fireEvent.change(screen.getByPlaceholderText('사유를 입력하세요'), { target: { value: '추가 작업' } })
  fireEvent.click(screen.getByRole('button', { name: '재개 확인' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/status' && JSON.parse(String(init?.body)).reason === '추가 작업')).toBe(true))
})

it('keeps the reopen reason available when the server rejects the change', async () => {
  let attempts = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url === '/api/tasks/t/status') { attempts++; return new Response(JSON.stringify({ message: '다시 시도하세요' }), { status: 409 }) } return new Response('[]', { status: 200 }) }))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MemoryRouter><TaskHeader task={{ ...task, status: 'done' }} assistant={assistant} /></MemoryRouter></MeContext></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '다시 열기' }))
  fireEvent.change(screen.getByPlaceholderText('사유를 입력하세요'), { target: { value: '추가 작업' } })
  fireEvent.click(screen.getByRole('button', { name: '재개 확인' }))
  await waitFor(() => expect(attempts).toBe(1))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByPlaceholderText('사유를 입력하세요')).toHaveValue('추가 작업')
})

it('places metadata and actions in separate mobile rows and constrains a long assistant name', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><MemoryRouter><TaskHeader task={task} assistant={{ ...assistant, name: '아주 긴 이름을 가진 도우미' }} /></MemoryRouter></MeContext></QueryClientProvider>)
  const metadata = screen.getByText(task.code).parentElement!
  const actions = screen.getByRole('button', { name: '업무 완료' }).parentElement!
  expect(metadata).not.toBe(actions)
  expect(metadata.parentElement).toBe(actions.parentElement)
  expect(metadata.parentElement).toHaveClass('flex-col', 'sm:flex-row')
  expect(metadata).toHaveClass('min-w-0', 'flex-wrap')
  expect(actions).toHaveClass('self-end', 'sm:ml-auto')
  expect(screen.getByText('아주 긴 이름을 가진 도우미')).toHaveClass('truncate')
  expect(screen.getByRole('button', { name: '대화 삭제' })).toHaveClass('size-8')
})
