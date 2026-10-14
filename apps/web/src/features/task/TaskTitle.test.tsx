import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { renderWithProviders } from '@/test/render'
import { TaskTitle } from './TaskTitle'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '기본 제목', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => vi.unstubAllGlobals())

it('shows code and title as one button, saves edits as manual and restores the title on Escape', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response(JSON.stringify({}), { status: 200 }) }))
  renderWithProviders(<TaskTitle task={task} />)
  const button = screen.getByRole('button', { name: 'WK-2026-0001 기본 제목' })
  expect(button).toHaveClass('truncate')
  expect(screen.getByText('WK-2026-0001')).toHaveClass('font-mono')
  fireEvent.click(button)
  const input = screen.getByRole('textbox', { name: '대화 제목' })
  expect(input).toHaveValue('기본 제목')
  fireEvent.change(input, { target: { value: '내 제목' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t' && JSON.parse(String(init?.body)).title === '내 제목')).toBe(true))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'WK-2026-0001 기본 제목' }))
  fireEvent.change(screen.getByRole('textbox', { name: '대화 제목' }), { target: { value: '버릴 제목' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '대화 제목' }), { key: 'Escape' })
  expect(screen.getByRole('button', { name: 'WK-2026-0001 기본 제목' })).toBeInTheDocument()
  expect(calls.filter(([url]) => url === '/api/tasks/t')).toHaveLength(1)
})

it('is not editable once the task is done', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  renderWithProviders(<TaskTitle task={{ ...task, status: 'done' }} />)
  expect(screen.getByRole('button', { name: 'WK-2026-0001 기본 제목' })).toBeDisabled()
})
