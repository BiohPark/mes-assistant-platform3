import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Route, Routes, useLocation } from 'react-router'
import type { TaskSummary } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { taskApiFixture } from '@/features/home/taskApiFixture'
import { MyWorkPage } from './MyWorkPage'

const assistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }
const task = (id: string, extra: Partial<TaskSummary> = {}): TaskSummary => ({ id, code: `WK-2026-${id}`, assistantId: 'a', title: `대화 ${id}`, titleSource: 'manual', status: 'in_progress', ownerId: 'u', assigneeIds: [], priority: 'normal', tags: [], checklist: { checked: 0, total: 0 }, inputCount: 0, outputCount: 0, createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z', ...extra })
function setup(tasks: TaskSummary[], locale = 'ko') {
  localStorage.setItem('mes-locale', locale)
  const fetcher = vi.fn(async (url: string) => url.startsWith('/api/tasks?') ? taskApiFixture(url, tasks) : Response.json(url === '/api/assistants' ? [assistant] : []))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function Probe() { const location = useLocation(); return <output data-testid="url">{location.search}</output> }
function renderPage(route = '/my-work') {
  return renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false }}><TooltipProvider><Probe /><Routes><Route path="/my-work" element={<MyWorkPage />} /><Route path="/c/:id" element={<div>대화 상세</div>} /></Routes></TooltipProvider></MeContext>, { route })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.removeItem('mes-locale') })

it('requests only mine and active summaries, defaults to deadline groups and opens a row by keyboard', async () => {
  const fetcher = setup([task('mine'), task('participant', { ownerId: 'other', assigneeIds: ['u'] }), task('unrelated', { ownerId: 'other' }), task('done', { status: 'done' })])
  renderPage()
  const list = await screen.findByRole('list', { name: '내 작업 대화' })
  expect(within(list).getAllByRole('link')).toHaveLength(2)
  expect(screen.getByRole('heading', { name: '기한 없음' })).toBeInTheDocument()
  const urls = fetcher.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/tasks'))
  expect(urls).toHaveLength(1)
  const p = new URL(urls[0]!, 'https://test').searchParams
  expect(p.get('mine')).toBe('true'); expect(p.get('view')).toBe('summary'); expect(p.get('limit')).toBe('30')
  expect(p.getAll('status[]')).toEqual(['todo', 'in_progress', 'on_hold'])
  const link = within(list).getAllByRole('link')[0]!
  link.focus(); await userEvent.keyboard('{Enter}')
  expect(await screen.findByText('대화 상세')).toBeInTheDocument()
})

it('separates completed work, keeps URL parameters and restores the selected tab after remount', async () => {
  setup([task('active'), task('done', { status: 'done' })])
  const view = renderPage('/my-work?tag=keep')
  await screen.findByText('대화 active')
  await userEvent.click(screen.getByRole('tab', { name: '완료' }))
  expect(await screen.findByText('대화 done')).toBeInTheDocument()
  expect(screen.queryByText('대화 active')).not.toBeInTheDocument()
  expect(screen.getByTestId('url')).toHaveTextContent('tag=keep&done=1')
  view.unmount(); renderPage('/my-work?tag=keep&done=1')
  expect(screen.getByRole('tab', { name: '완료' })).toHaveAttribute('aria-selected', 'true')
  await screen.findByText('대화 done')
})

it('searches on the server, resets the cursor, and groups by status, agent or each linked SR', async () => {
  Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => undefined, scrollIntoView: () => undefined })
  const fetcher = setup([task('one', { linkedSrCodes: ['SR-1', 'SR-2'] }), task('two')])
  renderPage()
  await screen.findByText('대화 one')
  await userEvent.click(screen.getByRole('combobox', { name: '묶음' })); await userEvent.click(screen.getByRole('option', { name: 'SR' }))
  expect(screen.getAllByRole('link', { name: /WK-2026-one/ })).toHaveLength(2)
  expect(screen.getAllByText('SR 2')).toHaveLength(2)
  await userEvent.click(screen.getByRole('combobox', { name: '묶음' })); await userEvent.click(screen.getByRole('option', { name: '상태' }))
  expect(screen.getByRole('heading', { name: '진행 중' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('combobox', { name: '묶음' })); await userEvent.click(screen.getByRole('option', { name: '에이전트' }))
  expect(screen.getByRole('heading', { name: '도우미' })).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: '내 작업 검색' }), 'two')
  await waitFor(() => expect(screen.queryByText('대화 one')).not.toBeInTheDocument())
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => new URL(url, 'https://test').searchParams.get('q') === 'two')).toBe(true))
  await screen.findByText('대화 two')
})

it('loads another explicit page and caps each group to 30 rows until More is selected', async () => {
  const fetcher = setup(Array.from({ length: 65 }, (_, i) => task(String(i).padStart(3, '0'))))
  renderPage()
  const list = await screen.findByRole('list')
  expect(within(list).getAllByRole('link')).toHaveLength(30)
  await userEvent.click(screen.getAllByRole('button', { name: '더 보기' })[0]!)
  await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(60))
  const urls = fetcher.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/tasks'))
  expect(urls).toHaveLength(2)
  expect(new URL(urls[1]!, 'https://test').searchParams.get('cursor')).toBe('30')
})

it('keeps loaded rows and retries a failed continuation', async () => {
  const rows = Array.from({ length: 31 }, (_, i) => task(String(i)))
  let failed = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/tasks?') ? url.includes('cursor=') && failed ? Response.json({}, { status: 500 }) : taskApiFixture(url, rows) : Response.json(url === '/api/assistants' ? [assistant] : [])))
  renderPage()
  await screen.findByRole('list')
  await userEvent.click(screen.getAllByRole('button', { name: '더 보기' })[0]!)
  expect(await screen.findByRole('alert')).toHaveTextContent('내 작업을 불러오지 못했습니다.')
  expect(screen.getAllByRole('link', { name: /WK-2026-/ })).toHaveLength(30)
  failed = false; await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.getAllByRole('link', { name: /WK-2026-/ })).toHaveLength(31))
})

it('offers the hub when empty, renders English, and reports retryable initial failures', async () => {
  setup([], 'en'); const view = renderPage()
  expect(await screen.findByText('No work assigned to you')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Completed' })).toBeInTheDocument()
  view.unmount(); localStorage.setItem('mes-locale', 'ko')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 500 })))
  renderPage(); expect(await screen.findByRole('alert')).toHaveTextContent('내 작업을 불러오지 못했습니다.')
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
})

it.each([403, 500])('refreshes viewer roles only for forbidden task access (%s)', async status => {
  const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/tasks?') ? Response.json({ message: 'denied' }, { status }) : Response.json(url === '/api/assistants' ? [assistant] : [])))
  renderPage()
  await screen.findByRole('alert')
  await waitFor(() => expect(invalidate.mock.calls.some(([filter]) => filter?.queryKey?.[0] === 'me')).toBe(status === 403))
})
