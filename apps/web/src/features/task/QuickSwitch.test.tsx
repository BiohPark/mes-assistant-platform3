import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { QuickSwitch } from './QuickSwitch'

afterEach(() => vi.unstubAllGlobals())
const task = (id: string, over: Partial<Task> = {}) => ({ id, code: `WK-2026-00${id}`, assistantId: 'a', title: `대화 ${id}`, titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: [], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: `h${id}`, createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: `2026-10-${id.padStart(2, '0')}T00:00:00.000Z`, aiRequest: null, ...over }) as Task
function Probe() { return <output aria-label="경로">{useLocation().pathname}</output> }
function renderSwitch(tasks: Task[], currentTaskId = '11') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url === '/api/tasks' ? JSON.stringify(tasks) : '[]', { status: 200 })))
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><MemoryRouter initialEntries={[`/c/${currentTaskId}`]}><Routes><Route path="/c/:taskId" element={<><QuickSwitch currentTaskId={currentTaskId} /><Probe /></>} /></Routes></MemoryRouter></MeContext></QueryClientProvider>)
}

it('lists my in-progress conversations with responding ones first, marks the current one and navigates on select', async () => {
  const tasks = [
    ...Array.from({ length: 11 }, (_, index) => task(String(index + 1))),
    task('12', { aiRequest: { status: 'pending', updatedAt: '2026-10-13T00:00:00.000Z' } }),
    task('13', { ownerId: 'other' }),
    task('14', { status: 'done' }),
    task('15', { aiRequest: { status: 'failed', updatedAt: '2026-10-13T00:00:00.000Z' } }),
  ]
  renderSwitch(tasks)
  const trigger = screen.getByRole('button', { name: /빠른 전환/ })
  await waitFor(() => expect(trigger).toHaveTextContent('1')) // 응답 중 1건
  await userEvent.click(trigger)
  const items = await screen.findAllByRole('menuitem')
  expect(items).toHaveLength(10)
  expect(items[0]).toHaveTextContent('WK-2026-0012')
  expect(items[0]).toHaveTextContent('AI 응답 중')
  expect(items[1]).toHaveTextContent('WK-2026-0015')
  expect(items[1]).toHaveTextContent('AI 실패')
  expect(items[2]).toHaveTextContent('WK-2026-0011')
  expect(items[2]).toHaveAttribute('aria-current', 'page')
  expect(items[2]).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByText('WK-2026-0013')).not.toBeInTheDocument() // 다른 사람 대화
  expect(screen.queryByText('WK-2026-0014')).not.toBeInTheDocument() // 완료
  expect(screen.queryByText('WK-2026-003')).not.toBeInTheDocument() // 10건 초과
  await userEvent.click(items[0])
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/c/12'))
})

it('tells when there is nothing to switch to and keeps the trigger keyboard operable', async () => {
  renderSwitch([task('11')])
  const trigger = screen.getByRole('button', { name: /빠른 전환/ })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const items = await screen.findAllByRole('menuitem')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveAttribute('aria-current', 'page')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})
