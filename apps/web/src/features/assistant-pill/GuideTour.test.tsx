import { act, fireEvent, screen, within } from '@testing-library/react'
import { Link } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { GuideTour } from './GuideTour'
import { useTourStore } from './tour'
import { guideOfferKey, markSectionDone, readTourProgress, requestTutorial } from './tutorial'
import { resetBubbles, useBubbleStore } from './bubbles'

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return {} } })
function target(id: string, rect = box(100, 200, 50, 20), tag = 'div') {
  const element = document.createElement(tag)
  element.dataset.tour = id
  element.textContent = id
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ ...rect }) }) // 브라우저처럼 매번 새 객체
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
  resetBubbles()
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

it('S14 코치: 말풍선은 화면 하단 중앙에 고정되고 대상은 제자리에서 딤+펄스로 짚는다. 🧭 n/N, ←/→·Enter·Space·버튼으로 움직이고 [다 봤어요]로 끝내면 진행·done·칭찬 말풍선, 포커스는 알약으로', () => {
  const search = target('hub-search')
  target('hub-cards').style.display = 'none' // 보이지 않는 대상은 단계에서 빠진다
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  start('hub')
  expect(dialog()).toHaveFocus()
  expect(within(dialog()).getByText('1/2')).toBeInTheDocument()
  expect(within(dialog()).getByText('🧭')).toHaveAttribute('aria-hidden', 'true')
  expect(within(dialog()).getByRole('heading', { name: '에이전트 허브' })).toBeInTheDocument()
  expect(screen.getByText(/이름·요약·업무 분류로 에이전트를 찾아요/)).toBeInTheDocument()
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }) // 이미 보이는 대상 — 화면을 옮기지 않는다
  expect(scrollIntoView.mock.contexts[0]).toBe(search)
  expect(spotlight()).toHaveClass('border-primary', 'pointer-events-none', 'animate-tour-pulse', 'motion-reduce:animate-none')
  expect(spotlight()).toHaveStyle({ left: '96px', top: '196px', width: '58px', height: '28px' }) // 대상 rect + 4px 여백
  expect(spotlight()).toHaveAttribute('aria-hidden', 'true')
  expect(dialog()).toHaveClass('fixed', 'inset-x-2', 'mx-auto', 'max-w-md') // 하단 중앙, 좁은 화면은 8px 여백
  expect(dialog()).toHaveStyle({ bottom: '8px' })
  expect(dialog().style.top).toBe('')
  expect(dialog().style.left).toBe('') // 대상을 따라다니지 않는다
  expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
  fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
  expect(within(dialog()).getByText('2/2')).toBeInTheDocument()
  expect(within(dialog()).getByRole('heading', { name: 'AI 도우미' })).toBeInTheDocument()
  expect(spotlight()).toHaveStyle({ left: '12px', top: '696px' })
  expect(dialog()).toHaveStyle({ top: '8px' }) // 대상(알약)이 아래 자리를 가리면 위로
  expect(dialog().style.bottom).toBe('')
  fireEvent.keyDown(dialog(), { key: 'ArrowLeft' })
  expect(within(dialog()).getByText('1/2')).toBeInTheDocument()
  expect(dialog()).toHaveStyle({ bottom: '8px' })
  fireEvent.keyDown(dialog(), { key: ' ' })
  expect(within(dialog()).getByText('2/2')).toBeInTheDocument()
  fireEvent.keyDown(dialog(), { key: 'ArrowRight' }) // 마지막에서 →는 끝내지 않는다
  expect(dialog()).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다 봤어요' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useTourStore.getState().route).toBeNull()
  expect(readTourProgress('u', 'hub')).toEqual(['hub', 'assistant'])
  expect(localStorage.getItem(guideOfferKey('u', 'hub'))).toBe('done')
  expect(useBubbleStore.getState().current?.source).toBe('guide.done')
  expect(pill).toHaveFocus()
})

it('S14 코치: 화면 밖 대상은 가운데로 부드럽게 스크롤하고, 스크롤이 멈춘 뒤에만 말풍선 자리를 다시 정한다(스크롤 중에는 스포트라이트만 따라간다)', () => {
  target('hub-search', box(100, 40, 50, 20))
  const far = box(16, 1200, 48, 48)
  pill.remove()
  pill = target('pill', far, 'button') as HTMLButtonElement
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  expect(dialog()).toHaveStyle({ bottom: '8px' })
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' })
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(pill)
  Object.assign(far, { top: 700, y: 700, bottom: 748 }) // 스크롤 중 — 대상이 아래 자리로 들어왔다
  fireEvent.scroll(document)
  act(() => vi.advanceTimersByTime(16))
  expect(spotlight()).toHaveStyle({ top: '696px' })
  expect(dialog()).toHaveStyle({ bottom: '8px' }) // 아직 스크롤 중 — 말풍선은 그대로
  act(() => vi.advanceTimersByTime(300))
  expect(dialog()).toHaveStyle({ top: '8px' })
})

it('S14 코치: fixed·sticky 대상은 스크롤하지 않는다; reduced motion은 즉시 스크롤하고 바로 자리를 정한다', () => {
  stubViewport(1280, true)
  target('hub-search', box(100, 900, 50, 20))
  pill.style.position = 'fixed'
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  scrollIntoView.mockClear()
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(within(dialog()).getByText('2/2')).toBeInTheDocument()
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(dialog()).toHaveStyle({ top: '8px' })
})

it('S14 코치: 버튼 위의 ←/→도 단계를 옮긴다(목록·버튼을 오가도 키가 같다)', () => {
  target('hub-search')
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  const close = within(dialog()).getByRole('button', { name: '가이드 닫기' })
  fireEvent.keyDown(close, { key: 'ArrowRight' })
  expect(within(dialog()).getByText('2/2')).toBeInTheDocument()
  fireEvent.keyDown(close, { key: 'ArrowLeft' })
  expect(within(dialog()).getByText('1/2')).toBeInTheDocument()
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
  tab.addEventListener('click', () => { requestAnimationFrame(() => { target('materials-library', box(700, 100, 300, 400)); target('materials-conversations', box(700, 520, 300, 100)) }) })
  tabs.append(tab)
  target('composer')
  renderWithProviders(<GuideTour userId="materials-user" pillRef={{ current: pill }} />)
  act(() => { useTourStore.getState().start('conversation', 'materials-user'); vi.advanceTimersByTime(1500) }) // 앞 테스트가 'u'의 진행을 남겨도 영향받지 않게
  expect(screen.getByText('1/6')).toBeInTheDocument() // composer · task-tabs · materials-library · materials-conversations · materials-staged · pill
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(within(dialog()).getByRole('heading', { name: '자료함' })).toBeInTheDocument()
  expect(within(dialog()).queryByText('자료 탭을 열었어요')).toBeNull() // 앞 단계(탭 목록)는 화면을 바꾸지 않았다
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(document.querySelector('[data-tour="materials-library"]')).toBeNull()
  act(() => { vi.advanceTimersByTime(32) })
  expect(document.querySelector('[data-tour="materials-library"]')).not.toBeNull()
  expect(spotlight()).toHaveStyle({ left: '696px', top: '96px', width: '308px', height: '408px' })
  expect(within(dialog()).getByText('자료 탭을 열었어요')).toBeInTheDocument() // 화면을 바꿨으면 말풍선에 알린다
  expect(dialog()).toHaveFocus()
  fireEvent.keyDown(dialog(), { key: 'Enter' }) // 다음 대상은 이미 열린 패널에 있다 — 알림 없음
  expect(within(dialog()).queryByText('자료 탭을 열었어요')).toBeNull()
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

it('S14: 좁은 화면에서 자료 탭이 열린 채 첨부 단계가 오면 대화 탭으로 돌아가 입력창의 첨부 칩 줄·📎을 짚는다', () => {
  const tabs = target('task-tabs')
  tabs.setAttribute('role', 'tablist')
  const chatTab = document.createElement('button')
  chatTab.setAttribute('role', 'tab'); chatTab.textContent = '대화'
  // 대화 탭을 누르면 입력창(📎 앵커)이 다시 보인다 — React처럼 다음 커밋에서
  chatTab.addEventListener('click', () => { requestAnimationFrame(() => { target('materials-staged', box(240, 720, 32, 32), 'button') }) })
  tabs.append(chatTab)
  target('composer')
  renderWithProviders(<GuideTour userId="staged-user" pillRef={{ current: pill }} />)
  act(() => { useTourStore.getState().start('conversation', 'staged-user'); vi.advanceTimersByTime(1500) })
  act(() => useTourStore.getState().goToSection(1)) // 자료함 섹션
  for (let step = 0; step < 3; step++) fireEvent.keyDown(dialog(), { key: 'Enter' }) // task-tabs → library → conversations → staged
  expect(within(dialog()).getByText(/붙인 자료는 입력창 위 칩으로 보여요/)).toBeInTheDocument()
  expect(document.querySelector('[data-tour="materials-staged"]')).toBeNull()
  act(() => { vi.advanceTimersByTime(32) })
  expect(document.querySelector('[data-tour="materials-staged"]')).not.toBeNull()
  expect(within(dialog()).getByText('대화 탭으로 돌아왔어요')).toBeInTheDocument()
  expect(spotlight()).toHaveStyle({ left: '236px', top: '716px', width: '40px', height: '40px' })
})
