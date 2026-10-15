import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { newId } from '@/lib/ids'
import { renderWithProviders } from '@/test/render'
import { GuideOffer } from './GuideOffer'
import { resetBubbles, useBubbleStore } from './bubbles'
import { useTourStore } from './tour'
import { guideOfferKey } from './tutorial'

let userId = ''
const mount = (route = '/') => renderWithProviders(<GuideOffer userId={userId} pillRef={{ current: null }} pos={null} />, { route })
const offer = () => screen.queryByText('이 화면, 같이 둘러볼까요?')

beforeEach(() => { userId = newId(); localStorage.clear(); resetBubbles(); useUiStore.setState({ assistantOpen: false }) }) // 모듈 메모리도 사용자별이라 ID를 새로 쓴다
afterEach(() => { act(() => useTourStore.getState().close()); document.querySelectorAll('[data-tour]').forEach(element => element.remove()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('stays inside the viewport: no room above → below the pill; clamped horizontally and vertically even in a tiny viewport', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(90) // 말풍선 실제 높이
  const rect = { left: 1230, top: 8, right: 1278, bottom: 56, width: 48, height: 48 }
  const pill = document.createElement('button')
  Object.defineProperty(pill, 'getBoundingClientRect', { value: () => rect })
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 })
  renderWithProviders(<GuideOffer userId={userId} pillRef={{ current: pill }} pos={null} />)
  const region = screen.getByRole('status', { name: 'AI 도우미 가이드 제안' })
  expect(region).toHaveStyle({ left: `${1280 - 260 - 8}px`, bottom: `${844 - (56 + 8) - 90}px` }) // 알약이 오른쪽 위 → 왼쪽으로 당기고, 위가 모자라니 알약 아래(top = pill.bottom + 8)
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 120 })
  fireEvent(window, new Event('resize'))
  expect(region).toHaveStyle({ bottom: '8px' }) // 위·아래 다 모자라면 화면 안으로 clamp(top 22 = 120 − 90 − 8)
  rect.top = 700; rect.bottom = 748
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 })
  fireEvent(window, new Event('resize'))
  expect(region).toHaveStyle({ bottom: `${844 - 700 + 8}px` }) // 다시 자리가 나면 알약 위
})

it('S14 코치: 가볍게 한 줄 + [🧭 사용법 보기]·✕(다시 묻지 않기) — ✕는 skipped로 남아 그 페이지에서 다시 안 나오고, 다른 페이지는 따로 묻는다', () => {
  let view = mount()
  expect(offer()).toBeVisible()
  expect(screen.getByRole('status', { name: 'AI 도우미 가이드 제안' })).toHaveAttribute('aria-live', 'polite')
  expect(localStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('asked')
  const yes = screen.getByRole('button', { name: '사용법 보기' }) // 🧭은 장식(aria-hidden)
  expect(yes).toHaveTextContent('🧭')
  expect(screen.queryByRole('button', { name: '괜찮아요' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 묻지 않기' }))
  expect(offer()).toBeNull()
  expect(localStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('skipped')
  view.unmount()
  view = mount()
  expect(offer()).toBeNull()
  view.unmount()
  mount('/sr') // 다른 페이지는 따로 묻는다
  expect(offer()).toBeVisible()
})

it('yields to a regular bubble while one is showing and comes back afterwards; hidden while the assistant window is open', () => {
  mount()
  expect(offer()).toBeVisible()
  act(() => useBubbleStore.getState().push({ source: 'budget.warn' }))
  expect(offer()).toBeNull()
  act(() => useBubbleStore.getState().dismiss())
  expect(offer()).toBeVisible()
  act(() => useUiStore.getState().setAssistantOpen(true))
  expect(offer()).toBeNull()
  act(() => useUiStore.getState().setAssistantOpen(false))
  expect(offer()).toBeVisible()
})

it('never blocks the page: sits above the pill, only its buttons take pointer events, and any press elsewhere folds it (still asked once)', () => {
  const pill = document.createElement('button')
  Object.defineProperty(pill, 'getBoundingClientRect', { value: () => ({ left: 4, top: 780, right: 52, bottom: 828, width: 48, height: 48 }) })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 })
  renderWithProviders(<GuideOffer userId={userId} pillRef={{ current: pill }} pos={null} />)
  const region = screen.getByRole('status', { name: 'AI 도우미 가이드 제안' })
  expect(region).toHaveStyle({ left: '8px', bottom: `${844 - 780 + 8}px` }) // 알약 위 — 입력창 하단 도구줄(모델·첨부·전송)을 덮지 않는다
  expect(region).toHaveClass('pointer-events-none')
  for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('pointer-events-auto')
  fireEvent.pointerDown(document.body)
  expect(offer()).toBeNull()
  expect(localStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('asked')
})

it('"Yes" starts the page tour, records acceptance and makes no request', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const pill = document.createElement('button')
  pill.dataset.tour = 'pill'
  document.body.append(pill)
  mount('/c/t1')
  fireEvent.click(screen.getByRole('button', { name: '사용법 보기' }))
  expect(useTourStore.getState().route).toBe('conversation')
  expect(localStorage.getItem(guideOfferKey(userId, 'conversation'))).toBe('accepted')
  expect(offer()).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})
