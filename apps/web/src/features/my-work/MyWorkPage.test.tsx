import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Routes, Route, useLocation, useNavigate } from 'react-router'
import type { Task } from '@mes/domain'
import { AuthGate } from '@/app/AuthGate'
import { MeContext } from '@/app/auth'
import { StaffOnly } from '@/app/router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MyWorkPage } from './MyWorkPage'

const assistant = { id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, expectedInputs: [], expectedOutputs: [], ownerId: 'u', status: 'open', usageExample: '', color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', revision: 0 }
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, code: `WK-2026-${id}`, assistantId: 'a', title: `대화 ${id}`, titleSource: 'manual', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: [], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z', ...extra })

function setup(tasks: Task[], locale: 'ko' | 'en' = 'ko') {
  localStorage.setItem('mes-locale', locale)
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/tasks') return jsonResponse(200, tasks)
    if (url === '/api/assistants') return jsonResponse(200, [assistant])
    return jsonResponse(200, [])
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => void navigate(-1)}>뒤로</button><button onClick={() => void navigate(1)}>앞으로</button></>
}
function renderPage(route = '/my-work') {
  return renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false }}><TooltipProvider><Navigation /><Routes>
    <Route path="/my-work" element={<MyWorkPage />} />
    <Route path="/c/:taskId" element={<div>대화 상세</div>} />
    <Route path="/" element={<div>허브 화면</div>} />
  </Routes></TooltipProvider></MeContext>, { route })
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('mes-locale') })

it('shows owner and participant conversations in recent activity order, excluding unrelated and completed work', async () => {
  const fetcher = setup([
    task('0001', { status: 'todo', tags: ['SR-2026-0001', '공유'] }),
    task('0002', { status: 'on_hold', ownerId: 'other', assigneeIds: ['u'], lastActivityAt: '2026-10-01T00:00:00.000Z' }),
    task('0003', { status: 'done' }),
    task('0004', { ownerId: 'other', assigneeIds: ['other'] }),
    task('0005', { ownerId: 'other', createdBy: 'u' }),
    task('0006', { lastActivityAt: '2026-09-29T00:00:00.000Z' }),
  ])
  renderPage()
  const list = await screen.findByRole('list', { name: '내 작업 대화' })
  expect(within(list).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/c/0002', '/c/0006', '/c/0001'])
  for (const title of ['대화 0003', '대화 0004', '대화 0005']) expect(screen.queryByText(title)).not.toBeInTheDocument()
  expect(within(list).getAllByText('도우미')).toHaveLength(3)
  for (const text of ['대기', '진행 중', '보류', 'SR-2026-0001', '공유']) expect(within(list).getByText(text)).toBeInTheDocument()
  expect(list.querySelectorAll('time')).toHaveLength(3)
  expect(fetcher.mock.calls.filter(([url]) => url.startsWith('/api/tasks')).map(([url]) => url)).toEqual(['/api/tasks'])
})

it('toggles completed work with the keyboard and opens a conversation with Enter', async () => {
  setup([task('0001'), task('0002', { status: 'done', lastActivityAt: '2026-10-01T00:00:00.000Z' })])
  renderPage()
  await screen.findByText('대화 0001')
  const user = userEvent.setup()
  const toggle = screen.getByRole('switch', { name: '완료 포함' })
  toggle.focus()
  await user.keyboard(' ')
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  const link = await screen.findByRole('link', { name: /WK-2026-0002/ })
  expect(within(screen.getByRole('list')).getAllByRole('link')[0]).toBe(link)
  await user.keyboard(' ')
  expect(screen.queryByText('대화 0002')).not.toBeInTheDocument()
  screen.getByRole('link', { name: /WK-2026-0001/ }).focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('대화 상세')).toBeInTheDocument()
})

it('restores completed work from the URL after remounting and returning from a conversation', async () => {
  setup([task('0001', { status: 'done' })])
  const user = userEvent.setup()
  const page = renderPage('/my-work?tag=keep')
  await screen.findByText('내 작업이 없습니다')
  await user.click(screen.getByRole('switch', { name: '완료 포함' }))
  expect(screen.getByTestId('url')).toHaveTextContent('/my-work?tag=keep&done=1')
  const route = screen.getByTestId('url').textContent!
  page.unmount()
  renderPage(route)
  expect(screen.getByRole('switch', { name: '완료 포함' })).toHaveAttribute('aria-checked', 'true')
  await user.click(await screen.findByRole('link', { name: /WK-2026-0001/ }))
  await screen.findByText('대화 상세')
  await user.click(screen.getByRole('button', { name: '뒤로' }))
  expect(await screen.findByText('대화 0001')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '완료 포함' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByTestId('url')).toHaveTextContent(route)
})

it('removes the default query and follows back and forward navigation', async () => {
  setup([task('0001', { status: 'done' })])
  renderPage('/my-work?done=1&tag=keep')
  await screen.findByText('대화 0001')
  const user = userEvent.setup()
  await user.click(screen.getByRole('switch', { name: '완료 포함' }))
  expect(screen.getByTestId('url')).toHaveTextContent('/my-work?tag=keep')
  expect(screen.queryByText('대화 0001')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '뒤로' }))
  expect(await screen.findByText('대화 0001')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '앞으로' }))
  expect(await screen.findByText('내 작업이 없습니다')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '완료 포함' })).toHaveAttribute('aria-checked', 'false')
})

it.each(['done=0', 'done=invalid', 'done='])('normalizes %s to the default without discarding other parameters', async query => {
  setup([task('0001', { status: 'done' })])
  renderPage(`/my-work?${query}&tag=keep`)
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/my-work?tag=keep'))
  expect(screen.getByRole('switch', { name: '완료 포함' })).toHaveAttribute('aria-checked', 'false')
  expect(await screen.findByText('내 작업이 없습니다')).toBeInTheDocument()
})

it.each([403, 500])('refreshes roles and lets the guard redirect only when task access returns %s', async status => {
  let forbidden = false
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/me') return jsonResponse(200, { id: 'u', name: '사용자', role: '', roles: forbidden ? ['requester'] : ['member'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false })
    if (url === '/api/tasks') return forbidden ? jsonResponse(status, { message: '작업 조회 거부' }) : jsonResponse(200, [task('0001')])
    if (url === '/api/assistants') return jsonResponse(200, [assistant])
    return jsonResponse(200, [])
  })
  vi.stubGlobal('fetch', fetcher)
  renderWithProviders(<AuthGate><TooltipProvider><Navigation /><Routes>
    <Route path="/my-work" element={<StaffOnly><MyWorkPage /></StaffOnly>} />
    <Route path="/c/:taskId" element={<div>대화 상세</div>} />
    <Route path="/sr" element={<div>SR 접수 화면</div>} />
  </Routes></TooltipProvider></AuthGate>, { route: '/my-work' })
  await screen.findByText('대화 0001')
  // /me is still fresh; a failed task refetch must explicitly invalidate it.
  forbidden = true
  await userEvent.click(screen.getByRole('link', { name: /WK-2026-0001/ }))
  await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
  if (status === 403) {
    expect(await screen.findByText('SR 접수 화면')).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('/sr')
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/me')).toHaveLength(2)
  } else {
    expect(await screen.findByRole('alert')).toHaveTextContent('내 작업을 불러오지 못했습니다.')
    expect(screen.getByTestId('url')).toHaveTextContent('/my-work')
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/me')).toHaveLength(1)
  }
})

it('offers the hub when no active conversations remain, including when only completed work exists', async () => {
  setup([task('0001', { status: 'done' })])
  renderPage()
  expect(await screen.findByText('내 작업이 없습니다')).toBeInTheDocument()
  const hub = screen.getByRole('link', { name: '에이전트 허브로 이동' })
  expect(hub).toHaveAttribute('href', '/')
  await userEvent.click(hub)
  expect(await screen.findByText('허브 화면')).toBeInTheDocument()
})

it('keeps conversations with unavailable assistants visible', async () => {
  setup([task('0001', { assistantId: 'missing' })])
  renderPage()
  expect(await screen.findByRole('link', { name: /WK-2026-0001/ })).toBeInTheDocument()
  expect(screen.getByText('알 수 없는 에이전트')).toBeInTheDocument()
})

it('renders English labels, statuses and activity dates', async () => {
  setup([task('0001')], 'en')
  renderPage()
  expect(await screen.findByRole('heading', { name: 'My work' })).toBeInTheDocument()
  await screen.findByRole('list', { name: 'My work conversations' })
  expect(screen.getByRole('switch', { name: 'Include completed' })).toBeInTheDocument()
  expect(screen.getByText('In progress')).toBeInTheDocument()
  expect(screen.getByText(/ago/)).toBeInTheDocument()
})

it('shows loading instead of an empty state while fetching', async () => {
  setup([])
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  renderPage()
  expect(screen.getByRole('status', { name: '불러오는 중…' })).toBeInTheDocument()
  expect(screen.queryByText('내 작업이 없습니다')).not.toBeInTheDocument()
})

it.each(['/api/tasks', '/api/assistants'])('shows a retryable error for %s instead of an empty list', async failedUrl => {
  setup([task('0001')])
  let failed = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => failed && url === failedUrl ? jsonResponse(500) : jsonResponse(200, url === '/api/tasks' ? [task('0001')] : url === '/api/assistants' ? [assistant] : [])))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('내 작업을 불러오지 못했습니다.')
  expect(screen.queryByText('내 작업이 없습니다')).not.toBeInTheDocument()
  failed = false
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(await screen.findByText('대화 0001')).toBeInTheDocument()
})

it.each([['ko', '정체'], ['en', 'Stalled']] as const)('shows stalled work in %s without changing statuses', async (locale, label) => {
  const old = '2020-01-01T00:00:00Z'
  setup([task('old', { lastActivityAt: old }), task('recent', { lastActivityAt: new Date().toISOString() }),
    task('held', { status: 'on_hold', lastActivityAt: old }), task('waiting', { status: 'todo', lastActivityAt: old }), task('done', { status: 'done', lastActivityAt: old })], locale)
  renderPage('/my-work?done=1')
  await screen.findByRole('link', { name: /WK-2026-old/ })
  expect(screen.getAllByText(label)).toHaveLength(1)
  expect(within(screen.getByRole('link', { name: /WK-2026-old/ })).getByText(label)).toBeInTheDocument()
})
