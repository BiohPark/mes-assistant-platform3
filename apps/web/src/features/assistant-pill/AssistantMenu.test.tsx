import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { renderWithProviders } from '@/test/render'
import { AssistantMenu } from './AssistantMenu'
import { PAGE_ACTIONS, pageRoute } from './pageActions'
import { useTourStore } from './tour'
import { guideOfferKey } from './tutorial'
import { newId } from '@/lib/ids'
import { useSearchAgents } from './useSearchAgents'

let userId = ''
const prefill = vi.fn()
const perform = vi.fn((action: () => void) => action())
function Menu() {
  const searchAgents = useSearchAgents()
  return <AssistantMenu userId={userId} prefill={prefill} perform={perform} searchAgents={searchAgents} />
}
function mount(route = '/', owner = false) {
  return renderWithProviders(<MeContext value={{ id: userId, name: '사용자', email: null, emailIsDefault: false, role: '', roles: owner ? ['system_owner'] : ['member'], theme: 'system', locale: 'ko' }}><Menu /></MeContext>, { route })
}
/** 투어는 보이는 대상이 하나는 있어야 시작한다 — 알약은 모든 페이지에 있다 */
function pillTarget() {
  const pill = document.createElement('button')
  pill.dataset.tour = 'pill'
  document.body.append(pill)
  return pill
}
const menu = () => screen.getByRole('region', { name: '할 수 있는 것' })
beforeEach(() => { userId = newId(); localStorage.clear(); vi.clearAllMocks() })
afterEach(() => { act(() => useTourStore.getState().close()); document.querySelectorAll('[data-tour]').forEach(element => element.remove()) })

it('every page lists the guide first; it marks this page as accepted and starts the tour after the window closes (perform)', () => {
  pillTarget()
  mount('/c/task')
  expect(screen.queryByText('둘러볼까요?')).not.toBeInTheDocument() // 옛 창 안 질문은 사라졌다 — 묻는 건 페이지 진입 말풍선뿐
  const buttons = within(menu()).getAllByRole('button')
  expect(buttons[0]).toHaveTextContent('가이드해 주세요')
  fireEvent.click(buttons[0]!)
  expect(perform).toHaveBeenCalledOnce()
  expect(useTourStore.getState().route).toBe('conversation')
  expect(localStorage.getItem(guideOfferKey(userId, 'conversation'))).toBe('accepted')
})

it('menu contains no AI call: examples prefill, actions only navigate, focus or guide', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  mount()
  fireEvent.click(within(menu()).getByRole('button', { name: /FDS 작성 도우미로/ }))
  expect(prefill).toHaveBeenCalledOnce()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(Object.values(PAGE_ACTIONS).flat().every(action => ['navigate', 'focus', 'prefill', 'tutorial'].includes(action.kind))).toBe(true)
  vi.unstubAllGlobals()
})

it('management suggestions are shown only to SO (the guide stays), and routes match exactly', () => {
  const view = mount('/settings')
  expect(screen.queryByRole('button', { name: '에이전트 관리' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '가이드해 주세요' })).toBeInTheDocument()
  view.unmount()
  mount('/settings', true)
  expect(screen.getByRole('button', { name: '에이전트 관리' })).toBeInTheDocument()
  expect(pageRoute('/c/task')).toBe('conversation')
  expect(pageRoute('/sr/manage')).toBe('sr')
  expect(pageRoute('/my-work')).toBe('myWork')
  expect(pageRoute('/settings-unrelated')).toBe('other')
})

it('other pages (My info) and My work offer the guide plus a hub shortcut', () => {
  const view = mount('/my-info')
  expect(within(menu()).getByRole('button', { name: '가이드해 주세요' })).toBeInTheDocument()
  fireEvent.click(within(menu()).getByRole('button', { name: '에이전트 허브' }))
  expect(perform).toHaveBeenCalledOnce()
  view.unmount()
  mount('/my-work')
  expect(within(menu()).getByRole('button', { name: '에이전트 허브' })).toBeInTheDocument()
})
