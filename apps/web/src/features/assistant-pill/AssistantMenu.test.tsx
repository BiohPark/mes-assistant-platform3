import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { renderWithProviders } from '@/test/render'
import { AssistantMenu, GUIDE_DELAY_MS } from './AssistantMenu'
import { PAGE_ACTIONS, pageRoute } from './pageActions'
import { useTourStore } from './tour'
import { guideOfferKey } from './tutorial'
import { newId } from '@/lib/ids'
import { useSearchAgents } from './useSearchAgents'
import { resetHistory, useAssistantHistory } from './history'

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
beforeEach(() => { userId = newId(); localStorage.clear(); vi.clearAllMocks(); resetHistory() })
afterEach(() => { vi.useRealTimers(); act(() => useTourStore.getState().close()); document.querySelectorAll('[data-tour]').forEach(element => element.remove()) })

it('S14-HH: 첫 항목 🧭 이 화면 사용법을 누르면 대화 기록에 요청·대답을 남긴 뒤 잠깐 있다가 창을 닫고(perform) 투어를 시작한다', () => {
  vi.useFakeTimers()
  pillTarget()
  mount('/c/task')
  expect(screen.queryByText('둘러볼까요?')).not.toBeInTheDocument() // 옛 창 안 질문은 사라졌다 — 묻는 건 페이지 진입 말풍선뿐
  const buttons = within(menu()).getAllByRole('button')
  expect(buttons[0]).toHaveAccessibleName('이 화면 사용법')
  expect(within(buttons[0]!).getByText('🧭')).toHaveAttribute('aria-hidden', 'true')
  fireEvent.click(buttons[0]!)
  const lines = () => useAssistantHistory.getState().log.map(entry => entry.kind === 'line' && `${entry.who}:${entry.text}`)
  expect(lines()).toEqual(['user:pill.log.askGuide', 'helper:pill.log.guideStart'])
  expect(localStorage.getItem(guideOfferKey(userId, 'conversation'))).toBe('accepted')
  fireEvent.click(buttons[0]!) // 기다리는 동안 다시 눌러도 한 번만
  act(() => vi.advanceTimersByTime(GUIDE_DELAY_MS - 1))
  expect(perform).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(perform).toHaveBeenCalledOnce()
  expect(useTourStore.getState().route).toBe('conversation')
  expect(lines()).toHaveLength(2)
})

it('S14-HH: 기다리는 동안 창이 닫히면(언마운트) 투어를 시작하지 않는다', () => {
  vi.useFakeTimers()
  pillTarget()
  const view = mount('/')
  fireEvent.click(within(menu()).getAllByRole('button')[0]!)
  view.unmount()
  act(() => vi.advanceTimersByTime(GUIDE_DELAY_MS))
  expect(perform).not.toHaveBeenCalled()
  expect(useTourStore.getState().route).toBeNull()
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
  expect(screen.getByRole('button', { name: '이 화면 사용법' })).toBeInTheDocument()
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
  expect(within(menu()).getByRole('button', { name: '이 화면 사용법' })).toBeInTheDocument()
  fireEvent.click(within(menu()).getByRole('button', { name: '에이전트 허브' }))
  expect(perform).toHaveBeenCalledOnce()
  view.unmount()
  mount('/my-work')
  expect(within(menu()).getByRole('button', { name: '에이전트 허브' })).toBeInTheDocument()
})

it('대화 도우미 메뉴는 패널 입구를 중복 제공하지 않는다', () => {
  mount('/c/t')
  expect(within(menu()).getAllByRole('button')).toHaveLength(2)
  expect(within(menu()).getByRole('button', { name: '이 화면 사용법' })).toBeVisible()
  expect(within(menu()).getByRole('button', { name: '내 작업' })).toBeVisible()
})
