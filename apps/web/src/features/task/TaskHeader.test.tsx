import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
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
    return new Response(url === '/api/tasks' ? '[]' : JSON.stringify({}), { status: 200 })
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
  expect(row).toHaveClass('overflow-x-auto', 'sm:flex-wrap', 'sm:overflow-visible')
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
  expect(screen.queryByText('기본 제목')).not.toBeInTheDocument()
  expect(screen.queryByText(task.code)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '대화 삭제' })).not.toBeInTheDocument()
  expect(screen.getByText('요약 한 줄')).toHaveClass('truncate')
})

it('새 창으로 띄우기 — /c/:id?popout=1 을 작은 창으로 열고, 막히면 같은 탭으로 가지 않고 토스트로 알린다; 팝업 안에서는 숨긴다', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const error = vi.spyOn(toast, 'error').mockReturnValue('toast')
  const { unmount } = render(wrap(task))
  fireEvent.click(screen.getByRole('button', { name: '새 창으로 띄우기' }))
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
  expect(link.querySelector('svg')).not.toBeNull()
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
