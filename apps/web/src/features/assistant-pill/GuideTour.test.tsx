import { act, fireEvent, screen, within } from '@testing-library/react'
import { Link } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { GuideTour } from './GuideTour'
import { useTourStore } from './tour'
import { guideOfferKey, markSectionDone, readTourProgress, requestTutorial } from './tutorial'

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return {} } })
function target(id: string, rect = box(100, 200, 50, 20), tag = 'div') {
  const element = document.createElement(tag)
  element.dataset.tour = id
  element.textContent = id
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => rect })
  document.body.append(element)
  return element
}
/** min-width 질의를 폭 기준으로, reduced motion은 인자로 판정 */
function stubViewport(width: number, reducedMotion = false) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') ? reducedMotion : width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
}
const scrollIntoView = vi.fn()
let pill: HTMLButtonElement
const dialog = () => screen.getByRole('dialog', { name: '페이지 가이드' })
const spotlight = () => screen.getByTestId('tour-spotlight')
const start = (route: Parameters<ReturnType<typeof useTourStore.getState>['start']>[0]) => act(() => { useTourStore.getState().start(route, 'u'); vi.advanceTimersByTime(1500) })
const sectionList = () => within(dialog()).getByRole('list', { name: '가이드 섹션' })

beforeEach(() => {
  vi.useFakeTimers()
  stubViewport(1280)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  localStorage.clear()
  pill = target('pill', box(16, 700, 48, 48), 'button') as HTMLButtonElement
})
afterEach(() => { act(() => useTourStore.getState().close()); document.querySelectorAll('[data-tour]').forEach(element => element.remove()); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('renders no card or spotlight while waiting; Escape cancels and returns focus without a delayed tour', () => {
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  act(() => useTourStore.getState().start('conversation', 'u'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(pill).toHaveFocus()
  target('composer')
  target('task-tabs')
  act(() => vi.advanceTimersByTime(1500))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useTourStore.getState().route).toBeNull()
})

it('navigating away during the wait cancels the pending tour', () => {
  renderWithProviders(<><GuideTour userId="u" pillRef={{ current: pill }} /><Link to="/sr">go</Link></>)
  act(() => useTourStore.getState().start('conversation', 'u'))
  fireEvent.click(screen.getByRole('link', { name: 'go' }))
  act(() => vi.advanceTimersByTime(1500))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useTourStore.getState().route).toBeNull()
})

it('spotlights the current target with a primary border, names the section, moves with Enter·Space·buttons, finishes on the last step, records progress and returns focus to the pill', () => {
  const search = target('hub-search')
  target('hub-cards').style.display = 'none' // 보이지 않는 대상은 단계에서 빠진다
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  start('hub')
  expect(dialog()).toHaveFocus()
  expect(screen.getByText('1/2')).toBeInTheDocument()
  expect(within(dialog()).getByRole('heading', { name: '에이전트 허브' })).toBeInTheDocument()
  expect(screen.getByText(/이름·요약·업무 분류로 에이전트를 찾습니다/)).toBeInTheDocument()
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  expect(scrollIntoView.mock.contexts[0]).toBe(search)
  expect(spotlight()).toHaveClass('border-primary', 'pointer-events-none', 'motion-reduce:transition-none')
  expect(spotlight()).toHaveStyle({ left: '96px', top: '196px', width: '58px', height: '28px' }) // 대상 rect + 4px 여백
  expect(spotlight()).toHaveAttribute('aria-hidden', 'true')
  expect(dialog()).toHaveStyle({ left: '100px', top: `${220 + 12}px` }) // 데스크톱: 대상 아래
  expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(screen.getByText('2/2')).toBeInTheDocument()
  expect(within(dialog()).getByRole('heading', { name: 'AI 도우미' })).toBeInTheDocument()
  expect(spotlight()).toHaveStyle({ left: '12px', top: '696px' })
  expect(Number.parseFloat(dialog().style.top)).toBeLessThan(700 - 12) // 아래 자리가 없으면 대상 위에 놓인다
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  expect(screen.getByText('1/2')).toBeInTheDocument()
  fireEvent.keyDown(dialog(), { key: ' ' })
  expect(screen.getByText('2/2')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '마치기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useTourStore.getState().route).toBeNull()
  expect(readTourProgress('u', 'hub')).toEqual(['hub', 'assistant'])
  expect(pill).toHaveFocus()
})

it('section list: shows every section with the current one marked, skips the current section, jumps to any section, and marks passed sections done with a replay label', () => {
  target('composer'); target('model'); target('discussion'); target('tags')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('conversation')
  expect(screen.getByText('1/5')).toBeInTheDocument()
  const toggle = within(dialog()).getByRole('button', { name: '섹션 목록' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('list', { name: '가이드 섹션' })).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const items = within(sectionList()).getAllByRole('listitem')
  expect(items.map(item => item.textContent)).toEqual(['대화 기본', '팀 의견', '태그·같은 태그', 'AI 도우미'])
  expect(within(items[0]!).getByRole('button')).toHaveAttribute('aria-current', 'step')
  expect(within(items[1]!).getByRole('button')).not.toHaveAttribute('aria-current')
  fireEvent.click(within(dialog()).getByRole('button', { name: '이 섹션 건너뛰기' }))
  expect(within(dialog()).getByRole('heading', { name: '팀 의견' })).toBeInTheDocument()
  expect(screen.getByText('3/5')).toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'true') // 목록은 열어 둔 채 유지
  expect(within(sectionList()).queryByText('완료')).not.toBeInTheDocument() // 건너뛴 섹션은 완료가 아니다
  fireEvent.click(within(sectionList()).getByRole('button', { name: '대화 기본' }))
  expect(screen.getByText('1/5')).toBeInTheDocument()
  fireEvent.click(within(dialog()).getByRole('button', { name: '다음' }))
  fireEvent.click(within(dialog()).getByRole('button', { name: '다음' })) // 대화 기본 끝 → 완료
  expect(screen.getByText('3/5')).toBeInTheDocument()
  const done = within(sectionList()).getByRole('button', { name: '대화 기본 완료 — 다시 보기' })
  expect(done).toBeInTheDocument()
  expect(readTourProgress('u', 'conversation')).toEqual(['basics'])
  fireEvent.click(done) // 다시 보기
  expect(screen.getByText('1/5')).toBeInTheDocument()
  expect(within(dialog()).getByRole('heading', { name: '대화 기본' })).toBeInTheDocument()
  fireEvent.keyDown(dialog(), { key: 'Escape' })
  expect(pill).toHaveFocus()
})

it('opens the materials tab when a materials step comes up, then spotlights the panel target', () => {
  const tabs = target('task-tabs')
  tabs.setAttribute('role', 'tablist')
  const tab = document.createElement('button')
  tab.setAttribute('role', 'tab'); tab.textContent = '자료'
  // 탭을 누르면 패널이 렌더된다 — React처럼 클릭한 그 순간이 아니라 뒤이은 커밋에서
  tab.addEventListener('click', () => { requestAnimationFrame(() => { target('materials-library', box(700, 100, 300, 400)) }) })
  tabs.append(tab)
  target('composer')
  renderWithProviders(<GuideTour userId="materials-user" pillRef={{ current: pill }} />)
  act(() => { useTourStore.getState().start('conversation', 'materials-user'); vi.advanceTimersByTime(1500) }) // 앞 테스트가 'u'의 진행을 남겨도 영향받지 않게
  expect(screen.getByText('1/6')).toBeInTheDocument() // composer · task-tabs · materials-library · materials-conversations · materials-staged · pill
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(within(dialog()).getByRole('heading', { name: '자료함' })).toBeInTheDocument()
  expect(document.querySelector('[data-tour="materials-library"]')).toBeNull()
  act(() => { vi.advanceTimersByTime(32) })
  expect(document.querySelector('[data-tour="materials-library"]')).not.toBeNull()
  expect(spotlight()).toHaveStyle({ left: '696px', top: '96px', width: '308px', height: '408px' })
  expect(dialog()).toHaveFocus()
})

it('resumes at the first section not done yet; the replay event starts the tour for the current page and records acceptance', () => {
  target('composer'); target('discussion')
  markSectionDone('u', 'conversation', 'basics')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />, { route: '/c/t1' })
  act(() => requestTutorial())
  act(() => vi.advanceTimersByTime(1500))
  expect(useTourStore.getState().route).toBe('conversation')
  expect(localStorage.getItem(guideOfferKey('u', 'conversation'))).toBe('accepted')
  expect(within(dialog()).getByRole('heading', { name: '팀 의견' })).toBeInTheDocument()
  expect(screen.getByText('2/3')).toBeInTheDocument()
  fireEvent.click(within(dialog()).getByRole('button', { name: '섹션 목록' }))
  expect(within(sectionList()).getByRole('button', { name: '대화 기본 완료 — 다시 보기' })).toBeInTheDocument()
})

it('desktop card stays inside the viewport: below a top target, at the top margin over a full-screen target, clamped above the bottom for a target still below the fold', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(150) // 카드 실제 높이(추정값 140보다 크다)
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  const cases: [ReturnType<typeof box>, number][] = [
    [box(100, 0, 50, 20), 20 + 12], // 아래에 자리 → 대상 아래
    [box(0, 0, 1280, 800), 8], // 아래·위 다 없음 → 상단 여백
    [box(100, 900, 50, 20), 800 - 8 - 150], // 아직 화면 아래(스크롤 전) → 하단 안으로 clamp
  ]
  for (const [rect, top] of cases) {
    const element = target('hub-search', rect)
    start('hub')
    expect(dialog()).toHaveStyle({ top: `${top}px` })
    expect(Number.parseFloat(dialog().style.top) + 150).toBeLessThanOrEqual(800 - 8)
    act(() => useTourStore.getState().close())
    element.remove()
  }
})

it('Enter on a button inside the card activates that button, not "next"', () => {
  target('hub-search')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  const prev = screen.getByRole('button', { name: '이전' })
  prev.focus()
  fireEvent.keyDown(prev, { key: 'Enter' })
  expect(screen.getByText('2/2')).toBeInTheDocument() // 카드 자체가 아닌 버튼 위의 Enter는 가로채지 않는다
})

it('Escape closes (focus back to the pill); the replay event starts the tour for the current page and records acceptance', () => {
  target('nav')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />, { route: '/my-info' })
  act(() => requestTutorial())
  expect(useTourStore.getState().route).toBe('other')
  expect(screen.getByText('1/2')).toBeInTheDocument()
  expect(localStorage.getItem(guideOfferKey('u', 'other'))).toBe('accepted')
  fireEvent.keyDown(dialog(), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(pill).toHaveFocus()
})

it('navigating away closes the tour', () => {
  target('hub-search')
  renderWithProviders(<><GuideTour userId="u" pillRef={{ current: pill }} /><Link to="/sr">go</Link></>)
  start('hub')
  expect(dialog()).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'go' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useTourStore.getState().route).toBeNull()
})

it('<768 pins the card to the bottom gutter and scrolls the target to the top; reduced motion scrolls instantly', () => {
  stubViewport(390, true)
  target('hub-search')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  expect(dialog()).toHaveStyle({ left: '8px', right: '8px', bottom: '8px' })
  expect(dialog().style.top).toBe('')
  fireEvent.keyDown(dialog(), { key: 'Enter' }) // 알약(화면 하단)이 대상이면 카드는 위로 — 겹치지 않게
  expect(dialog()).toHaveStyle({ left: '8px', right: '8px', top: '8px' })
  expect(dialog().style.bottom).toBe('')
})
