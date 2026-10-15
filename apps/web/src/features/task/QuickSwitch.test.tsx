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
  await waitFor(() => expect(trigger).toHaveAccessibleName(/^빠른 전환\s*응답 중 1$/)) // 카운트는 sr-only 텍스트(인라인 사이 공백은 엔진마다 다름)
  expect(trigger).toHaveClass('size-8', 'after:-inset-1.5') // 32px 아이콘 버튼에 사방 6px을 더해 44px 터치 영역
  expect(trigger).toHaveAttribute('title', '빠른 전환')
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

it('S14: Ctrl+K 검색어로 대화와 SR(번호·제목, 서버 열람 범위)을 찾고 SR은 처리 상세로 연다', async () => {
  const srs = [
    { id: 'sr-1', code: 'SR-2026-0001', title: '설비 알람 개선', status: 'submitted' },
    { id: 'sr-2', code: 'SR-2026-0002', title: '리포트', status: 'in_progress' },
  ]
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/tasks' ? [task('11'), task('12', { title: '알람 정리', ownerId: 'other' })] : url === '/api/service-requests?scope=inbox' ? srs : []), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><MemoryRouter initialEntries={['/c/11']}><Routes><Route path="*" element={<><QuickSwitch currentTaskId="11" /><ProbeSearch /></>} /></Routes></MemoryRouter></MeContext></QueryClientProvider>)
  await userEvent.keyboard('{Control>}k{/Control}')
  const search = await screen.findByRole('textbox', { name: '대화·SR 검색' })
  await waitFor(() => expect(search).toHaveFocus())
  expect(fetch).not.toHaveBeenCalledWith('/api/service-requests?scope=inbox', expect.anything()) // 검색 전에는 SR 목록을 부르지 않는다
  await userEvent.type(search, '알람')
  const items = await screen.findAllByRole('menuitem')
  expect(items.map(item => item.textContent)).toEqual([expect.stringContaining('WK-2026-0012'), expect.stringContaining('SR-2026-0001')])
  await userEvent.clear(search)
  await userEvent.type(search, 'sr-2026-0002')
  await userEvent.click(await screen.findByRole('menuitem', { name: /SR-2026-0002/ }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr/manage?id=sr-2'))
})

it('S14: 검색 결과가 없으면 알린다', async () => {
  renderSwitch([task('11')])
  await userEvent.click(screen.getByRole('button', { name: /빠른 전환/ }))
  await userEvent.type(await screen.findByRole('textbox', { name: '대화·SR 검색' }), 'zzz')
  expect(await screen.findByText('찾는 대화·SR이 없습니다')).toBeInTheDocument()
})

function ProbeSearch() { const location = useLocation(); return <output aria-label="경로">{location.pathname + location.search}</output> }
