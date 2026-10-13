import { StrictMode } from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { renderWithProviders } from '@/test/render'
import { AssistantMenu } from './AssistantMenu'
import { PAGE_ACTIONS, pageRoute } from './pageActions'
import { requestTutorial, tutorialKey } from './tutorial'
import { newId } from '@/lib/ids'

let userId = ''
const prefill = vi.fn()
const perform = vi.fn((action: () => void) => action())
function mount(route = '/', owner = false, strict = false) {
  const menu = <MeContext value={{ id: userId, name: '사용자', email: null, emailIsDefault: false, role: '', roles: owner ? ['system_owner'] : ['member'], theme: 'system', locale: 'ko' }}><AssistantMenu userId={userId} prefill={prefill} perform={perform} /></MeContext>
  return renderWithProviders(strict ? <StrictMode>{menu}</StrictMode> : menu, { route })
}
beforeEach(() => { userId = newId(); localStorage.clear(); vi.clearAllMocks() })

it('asks once across remounts and StrictMode, records acceptance and shows just the current page', () => {
  const view = mount('/c/task', false, true)
  expect(screen.getByText('둘러볼까요?')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '둘러보기' }))
  expect(localStorage.getItem(tutorialKey(userId))).toBe('accepted')
  expect(screen.getByText('현재 페이지 · 1/1')).toBeInTheDocument()
  expect(screen.getByText(/같은 태그 대화 패널과 자료 탭/)).toBeInTheDocument()
  expect(screen.queryByText(/허브에서 에이전트를 검색/)).not.toBeInTheDocument()
  view.unmount()
  mount()
  expect(screen.queryByText('둘러볼까요?')).not.toBeInTheDocument()
})

it('storage failure shows once per session across remounts', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const view = mount()
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  view.unmount()
  mount()
  expect(screen.queryByText('둘러볼까요?')).not.toBeInTheDocument()
  vi.restoreAllMocks()
})

it('menu contains no AI call: examples prefill, actions only navigate or focus', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  mount()
  const menu = screen.getByRole('region', { name: '할 수 있는 것' })
  fireEvent.click(within(menu).getByRole('button', { name: /FDS 작성 도우미로/ }))
  expect(prefill).toHaveBeenCalledOnce()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(Object.values(PAGE_ACTIONS).flat().every(action => ['navigate', 'focus', 'prefill', 'tutorial'].includes(action.kind))).toBe(true)
  vi.unstubAllGlobals()
})

it('management suggestions are shown only to SO and routes match exactly', () => {
  const view = mount('/settings')
  expect(screen.queryByRole('button', { name: '에이전트 관리' })).not.toBeInTheDocument()
  view.unmount()
  mount('/settings', true)
  expect(screen.getByRole('button', { name: '에이전트 관리' })).toBeInTheDocument()
  expect(pageRoute('/c/task')).toBe('conversation')
  expect(pageRoute('/sr/manage')).toBe('sr')
  expect(pageRoute('/settings-unrelated')).toBe('other')
})

it('conversation replay and My info replay work after skipping', () => {
  mount('/c/task')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  expect(localStorage.getItem(tutorialKey(userId))).toBe('skipped')
  fireEvent.click(screen.getByRole('button', { name: '튜토리얼 다시 보기' }))
  expect(screen.getByText('현재 페이지 · 1/1')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '마치기' }))
  act(() => requestTutorial(userId))
  expect(screen.getByText('현재 페이지 · 1/1')).toBeInTheDocument()
})
