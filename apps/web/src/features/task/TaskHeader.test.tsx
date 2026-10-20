import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { toast } from 'sonner'
import { MeContext } from '@/app/auth'
import { resetPopout } from '@/app/popout'
import { I18nProvider } from '@/i18n'
import { TaskHeader } from './TaskHeader'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '기본 제목', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
const assistant = { id: 'a', name: '도우미', color: '#123456' } as Assistant
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetPopout(); window.history.replaceState({}, '', '/') })

const wrap = (value: Task, agent: Assistant = assistant) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MemoryRouter><TaskHeader task={value} assistant={agent} /></MemoryRouter></MeContext></QueryClientProvider>

it('requires a reason when reopening a completed task', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init])
    return new Response(url.endsWith('/status') ? JSON.stringify({}) : '[]', { status: 200 })
  }))
  render(wrap({ ...task, status: 'done' }))
  fireEvent.click(screen.getByRole('button', { name: '다시 열기' }))
  expect(screen.getByRole('button', { name: '재개 확인' })).toBeDisabled()
  fireEvent.change(screen.getByPlaceholderText('사유를 입력하세요'), { target: { value: '추가 작업' } })
  fireEvent.click(screen.getByRole('button', { name: '재개 확인' }))
  await waitFor(() => expect(calls.some(([url, init]) => url === '/api/tasks/t/status' && JSON.parse(String(init?.body)).reason === '추가 작업')).toBe(true))
})

it('keeps the reopen reason available when the server rejects the change', async () => {
  let attempts = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url === '/api/tasks/t/status') { attempts++; return new Response(JSON.stringify({ message: '다시 시도하세요' }), { status: 409 }) } return new Response('[]', { status: 200 }) }))
  render(wrap({ ...task, status: 'done' }))
  fireEvent.click(screen.getByRole('button', { name: '다시 열기' }))
  fireEvent.change(screen.getByPlaceholderText('사유를 입력하세요'), { target: { value: '추가 작업' } })
  fireEvent.click(screen.getByRole('button', { name: '재개 확인' }))
  await waitFor(() => expect(attempts).toBe(1))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByPlaceholderText('사유를 입력하세요')).toHaveValue('추가 작업')
})

it('keeps metadata and actions in one row that scrolls on mobile, without the duplicate title or code', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  render(wrap({ ...task, summary: '요약 한 줄' }, { ...assistant, name: '아주 긴 이름을 가진 도우미' }))
  const name = screen.getByText('아주 긴 이름을 가진 도우미')
  expect(name).toHaveClass('truncate')
  const row = name.closest('a')!.parentElement!
  expect(row).toHaveClass('overflow-x-auto', 'flex-nowrap')
  expect(row).not.toHaveClass('flex-col')
  const actions = screen.getByRole('button', { name: '업무 완료' }).parentElement!
  expect(actions.parentElement).toBe(row)
  expect(actions).toHaveClass('ml-auto', 'shrink-0')
  expect(actions).toContainElement(screen.getByRole('button', { name: /빠른 전환/ }))
  expect(actions).toContainElement(screen.getByRole('button', { name: '더 보기' }))
  // 도구 자리(🔍·☰ 포털)는 좁은 화면에서 대화 탭이 아닐 때(data-chat-hidden) 숨는다
  expect(screen.getByRole('button', { name: /빠른 전환/ }).previousElementSibling).toHaveClass('empty:hidden', 'data-[chat-hidden=true]:max-lg:hidden')
  expect(row).toContainElement(screen.getByRole('button', { name: '태그 추가' }))
  expect(screen.queryByRole('combobox', { name: '태그 입력' })).not.toBeInTheDocument()
  // 제목·코드는 상단 바(TaskTitle) 하나만 — 헤더 둘째 줄에서는 뺀다
  expect(screen.getByRole('button', { name: '기본 제목' })).toBeInTheDocument()
  expect(screen.queryByText(task.code)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '대화 삭제' })).not.toBeInTheDocument()
  expect(screen.queryByText('요약 한 줄')).not.toBeInTheDocument()
})

it('새 창으로 띄우기 — /c/:id?popout=1 을 작은 창으로 열고, 막히면 같은 탭으로 가지 않고 토스트로 알린다; 팝업 안에서는 숨긴다', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const error = vi.spyOn(toast, 'error').mockReturnValue('toast')
  const { unmount } = render(wrap(task))
  const popout = screen.getByRole('button', { name: '새 창으로 띄우기' })
  expect(popout).toHaveAttribute('title', '새 창으로 띄우기')
  expect(popout.querySelector('svg')).toHaveClass('lucide-external-link')
  expect(popout.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.click(popout)
  expect(open).toHaveBeenCalledWith('/c/t?popout=1', 'mes-popout-t', expect.stringMatching(/\bpopup\b/))
  expect(error).toHaveBeenCalledWith('팝업이 차단되어 새 창을 열지 못했어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요')
  open.mockReturnValue({} as Window)
  fireEvent.click(screen.getByRole('button', { name: '새 창으로 띄우기' }))
  expect(open).toHaveBeenCalledTimes(2)
  expect(error).toHaveBeenCalledTimes(1)
  unmount()
  window.history.replaceState({}, '', '/c/t?popout=1')
  resetPopout()
  render(wrap(task))
  expect(screen.queryByRole('button', { name: '새 창으로 띄우기' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '업무 완료' })).toBeInTheDocument()
})

it('moves delete into the more menu and asks for confirmation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  render(wrap(task))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  await user.click(await screen.findByRole('menuitem', { name: '대화 삭제' }))
  expect(await screen.findByText('대화를 삭제할까요?')).toBeInTheDocument()
})

function stubSettings(link1Rule?: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/settings' ? new Response(JSON.stringify(link1Rule ? { link1Rule } : {}), { status: 200 }) : new Response('[]', { status: 200 })))
}
function renderHeader(value: Assistant, locale: 'ko' | 'en' = 'ko') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale }}><I18nProvider locale={locale}><MemoryRouter><TaskHeader task={task} assistant={value} /></MemoryRouter></I18nProvider></MeContext></QueryClientProvider>)
}

it('shows the OpenWebUI shortcut among the header tools after quick switch when a link is stored', async () => {
  stubSettings()
  renderHeader({ ...assistant, link1: 'https://owui.example/?model=stored' })
  const link = screen.getByRole('link', { name: 'OpenWebUI에서 열기' })
  expect(link).toHaveAttribute('href', 'https://owui.example/?model=stored')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noreferrer')
  expect(link).toHaveAttribute('title', 'OpenWebUI에서 열기')
  expect(link.querySelector('svg')).toHaveTextContent('OW')
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  expect(link.querySelector('.lucide-external-link')).toBeNull()
  expect(link).toHaveClass('size-8', 'after:-inset-1.5')
  const quickSwitch = screen.getByRole('button', { name: /빠른 전환/ })
  expect(link.parentElement).toBe(quickSwitch.parentElement)
  expect(quickSwitch.nextElementSibling).toBe(link)
})

it('derives the shortcut from the settings rule when only a model is set, in English too', async () => {
  stubSettings('https://owui.example/?model={modelId}')
  renderHeader({ ...assistant, modelId: 'm 1' }, 'en')
  expect(await screen.findByRole('link', { name: 'Open in OpenWebUI' })).toHaveAttribute('href', 'https://owui.example/?model=m%201')
})

it('hides the shortcut when neither a link nor a model is configured', async () => {
  stubSettings('https://owui.example/?model={modelId}')
  renderHeader(assistant)
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/settings')).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.queryByRole('link', { name: 'OpenWebUI에서 열기' })).toBeNull()
})

it('S14: SR 태그 칩과 태그가 없는 시작 SR 칩은 SR 처리 상세로, 일반 태그는 칸반 필터로 간다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/service-requests?code=SR-2026-0001' ? [{ id: 'sr-1' }] : url === '/api/service-requests?code=SR-2026-0009' ? [{ id: 'sr-9' }]
      : url.startsWith('/api/tags/suggest') ? { items: [{ tag: 'SR-2026-0001', count: 1, isSr: true, srStatus: 'accepted' }], srScope: 'all' } : []), { status: 200 })))
  function Probe() { const location = useLocation(); return <output aria-label="경로">{location.pathname + location.search}</output> }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MemoryRouter initialEntries={['/c/t']}>
    <TaskHeader task={{ ...task, tags: ['SR-2026-0001', '일반'], linkedSrCodes: ['SR-2026-0009', 'SR-2026-0001'] }} assistant={assistant} /><Probe /></MemoryRouter></MeContext></QueryClientProvider>)
  // 시작 SR(태그 없음)만 따로 칩으로 — 태그로 이미 보이는 SR은 한 번만
  expect(screen.getAllByRole('button', { name: 'SR-2026-0001' })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'SR-2026-0009' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr/manage?id=sr-9'))
  await userEvent.click(screen.getByRole('button', { name: 'SR-2026-0001' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr/manage?id=sr-1'))
  await userEvent.click(screen.getByRole('button', { name: '일반' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '이 태그 대화 보기' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/?view=kanban&tag=%EC%9D%BC%EB%B0%98'))
})

function renderWithPath(value: Task) {
  function Probe() { const location = useLocation(); return <><output aria-label="경로">{location.pathname + location.search}</output><output aria-label="이동 상태">{JSON.stringify(location.state)}</output></> }
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><MemoryRouter initialEntries={['/c/t']}>
    <TaskHeader task={value} assistant={assistant} /><Probe /></MemoryRouter></MeContext></QueryClientProvider>)
}

it('S15: #태그 칩 메뉴 [이 태그로 새 대화]는 같은 에이전트의 새 대화 초안에 그 태그만 프리셋한다(자동 첨부 없음)', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  renderWithPath({ ...task, tags: ['설비 점검', '다른'] })
  const user = userEvent.setup()
  const chip = screen.getByRole('button', { name: '설비 점검' })
  await user.click(chip)
  const menu = await screen.findByRole('menu', { name: '#설비 점검 태그 메뉴' })
  expect(chip).toHaveAttribute('aria-haspopup', 'menu')
  expect(chip).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['이 태그로 새 대화', '이 태그 대화 보기', '태그 해제'])
  expect(menu).toContainElement(document.activeElement as HTMLElement)
  await user.click(screen.getByRole('menuitem', { name: '이 태그로 새 대화' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/new/a?tag=%EC%84%A4%EB%B9%84%20%EC%A0%90%EA%B2%80'))
  // 이미 열린 같은 에이전트 초안 탭에도 태그가 적용되도록 프리셋 이동임을 알린다
  expect(screen.getByLabelText('이동 상태')).toHaveTextContent('{"tagPreset":true}')
  expect(screen.getByLabelText('경로').textContent).not.toMatch(/ref=|file|다른/)
  expect(fetchMock.mock.calls.some(([, init]) => !!init?.method && init.method !== 'GET')).toBe(false)
})

it('S15: 태그 메뉴는 ↑↓로 이동하고 Esc로 닫으면 칩으로 포커스가 돌아오며, [태그 해제]는 그 태그만 뗀다', async () => {
  const calls: Array<[string, RequestInit | undefined]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response(url.includes('/tags') && init?.method ? JSON.stringify({ ...task, tags: [] }) : '[]', { status: 200 }) }))
  renderWithPath({ ...task, tags: ['설비 점검'] })
  const user = userEvent.setup()
  const chip = screen.getByRole('button', { name: '설비 점검' })
  chip.focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('menu')
  expect(screen.getByRole('menuitem', { name: '이 태그로 새 대화' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: '이 태그 대화 보기' })).toHaveFocus()
  await user.keyboard('{ArrowUp}{ArrowUp}')
  expect(screen.getByRole('menuitem', { name: '태그 해제' })).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(chip).toHaveFocus()
  await user.click(chip)
  await user.click(await screen.findByRole('menuitem', { name: '태그 해제' }))
  await waitFor(() => expect(calls.some(([url, init]) => init?.method === 'DELETE' && decodeURIComponent(url).includes('설비 점검'))).toBe(true))
  expect(screen.getByLabelText('경로')).toHaveTextContent('/c/t')
})

it('S15: 완료된 대화의 태그 메뉴에는 [태그 해제]가 없다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  renderWithPath({ ...task, status: 'done', tags: ['설비 점검'] })
  await userEvent.click(screen.getByRole('button', { name: '설비 점검' }))
  await screen.findByRole('menu')
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['이 태그로 새 대화', '이 태그 대화 보기'])
})

it('코드·우선순위·보류·전송 기록·파일 재시도를 더 보기 안에 수납하고 Esc로 돌아온다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  render(wrap(task))
  expect(screen.queryByRole('button', { name: '보류' })).not.toBeInTheDocument()
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: '더 보기' })
  await user.click(trigger)
  for (const name of ['체크리스트 열기', '메모 열기', '활동 이력 열기']) expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
  for (const name of ['전송 기록', '파일 빼고 다시', '텍스트로 보내기']) expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
  expect(screen.getByText(task.code)).toBeInTheDocument()
  expect(screen.getByRole('menuitemradio', { name: '보통' })).toHaveAttribute('aria-checked', 'true')
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
})

it('메뉴의 우선순위 변경은 기존 PATCH 경로에 고른 값만 보낸다', async () => {
  const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(wrap(task))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  await user.click(screen.getByRole('menuitemradio', { name: '긴급' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tasks/t', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ priority: 'urgent' }) })))
})

it('헤더는 자료 입구·후보 조회를 제공하지 않는다', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return Response.json([]) }))
  render(wrap({ ...task, tags: ['A'] }))
  await waitFor(() => expect(calls).toContain('/api/settings'))
  expect(screen.queryByRole('button', { name: /^연결 자료/ })).not.toBeInTheDocument()
  expect(calls.some(url => /candidate/.test(url))).toBe(false)
})
