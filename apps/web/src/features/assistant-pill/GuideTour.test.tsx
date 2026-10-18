import { act, fireEvent, screen, within } from '@testing-library/react'
import { Link } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { GuideTour } from './GuideTour'
import { useTourStore } from './tour'
import { guideOfferKey, markSectionDone, readTourProgress, requestTutorial } from './tutorial'
import { resetBubbles, useBubbleStore } from './bubbles'
import { resetHistory, useAssistantHistory } from './history'

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
/** 스크롤 그릇 — 3000px 내용, 화면 800px. scrollBy는 기록만 한다 */
function scroller() {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  box.dataset.scroller = ''
  const scrollBy = vi.fn()
  Object.defineProperties(box, { scrollHeight: { value: 3000 }, clientHeight: { value: 800 }, scrollTop: { value: 0, writable: true }, scrollBy: { value: scrollBy } })
  document.body.append(box)
  return { box, scrollBy }
}
const lastLog = () => useAssistantHistory.getState().log.at(-1)
const OriginalResizeObserver = globalThis.ResizeObserver
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
  resetHistory()
  pill = target('pill', box(16, 700, 48, 48), 'button') as HTMLButtonElement
})
afterEach(() => { act(() => useTourStore.getState().close()); document.querySelectorAll('[data-tour], [data-scroller]').forEach(element => element.remove()); vi.clearAllMocks(); vi.unstubAllGlobals(); globalThis.ResizeObserver = OriginalResizeObserver; vi.useRealTimers() })

it('renders no card or spotlight while waiting; Escape cancels and returns focus without a delayed tour', () => {
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  act(() => useTourStore.getState().start('conversation', 'u'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(pill).toHaveFocus()
  target('composer')
  target('linked-materials')
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

it('S14-HH 도킹: 말풍선은 대상과 무관하게 도우미 창 자리(알약 바로 옆)에 고정되고 대상은 제자리에서 딤+펄스로 짚는다. 🧭 n/N, ←/→·Enter·Space·버튼으로 움직이고 [다 봤어요]로 끝내면 진행·done·칭찬 말풍선·대화 기록, 포커스는 알약으로', () => {
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
  const docked = { left: '72px', top: '588px', width: '340px' } // 알약(16,700 48×48) 오른쪽 8px, 알약 아래끝(748)에 맞춤(측정 전 높이 160)
  expect(dialog()).toHaveStyle(docked)
  expect(dialog()).not.toHaveClass('inset-x-2')
  expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
  fireEvent.keyDown(dialog(), { key: 'ArrowRight' })
  expect(within(dialog()).getByText('2/2')).toBeInTheDocument()
  expect(within(dialog()).getByRole('heading', { name: 'AI 도우미' })).toBeInTheDocument()
  expect(spotlight()).toHaveStyle({ left: '12px', top: '696px' })
  expect(dialog()).toHaveStyle(docked) // 대상이 바뀌어도 같은 자리
  fireEvent.keyDown(dialog(), { key: 'ArrowLeft' })
  expect(within(dialog()).getByText('1/2')).toBeInTheDocument()
  expect(dialog()).toHaveStyle(docked)
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
  expect(lastLog()).toMatchObject({ who: 'helper', text: 'pill.log.guideDone' }) // 창을 다시 열면 대화 기록에 남아 있다
  expect(pill).toHaveFocus()
})

it('S14-HH 비키기: 화면 밖 대상은 가운데로 부드럽게 스크롤하고, 멈춘 뒤에도 말풍선에 가리면 대상을 한 번 더 스크롤해 비킨다 — 말풍선은 그 자리 그대로', () => {
  target('hub-search', box(100, 40, 50, 20))
  const far = box(100, 1200, 300, 40)
  const { box: list, scrollBy } = scroller()
  list.append(target('hub-cards', far))
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  const docked = { left: '72px', top: '588px' }
  expect(dialog()).toHaveStyle(docked)
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' })
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(list.firstChild)
  Object.assign(far, { top: 700, y: 700, bottom: 740 }) // 스크롤 중 — 대상이 말풍선 자리로 들어왔다
  fireEvent.scroll(document)
  act(() => vi.advanceTimersByTime(16))
  expect(spotlight()).toHaveStyle({ top: '696px' })
  expect(scrollBy).not.toHaveBeenCalled() // 아직 스크롤 중
  act(() => vi.advanceTimersByTime(300))
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 160, behavior: 'smooth' }) // 대상 아래끝 740 → 말풍선 위 8px(580)
  expect(dialog()).toHaveStyle(docked)
  Object.assign(far, { top: 540, y: 540, bottom: 580 })
  fireEvent.scroll(document)
  act(() => vi.advanceTimersByTime(300))
  expect(spotlight()).toHaveStyle({ top: '536px' })
  expect(scrollBy).toHaveBeenCalledOnce() // 한 단계에 한 번만
  expect(dialog()).toHaveStyle(docked)
})

it('S14-HH: reduced motion은 즉시 스크롤한다; fixed·sticky처럼 비킬 수 없는 대상만 말풍선이 같은 쪽에서 세로로 비킨다', () => {
  stubViewport(1280, true)
  const { box: list, scrollBy } = scroller()
  list.append(target('hub-search', box(100, 700, 50, 20)))
  const bar = target('hub-cards', box(0, 640, 1280, 100))
  bar.style.position = 'fixed'
  renderWithProviders(<GuideTour userId="u" pillRef={{ current: pill }} />)
  start('hub')
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  expect(scrollBy).toHaveBeenCalledWith({ top: 140, behavior: 'auto' }) // 720 → 580
  expect(dialog()).toHaveStyle({ left: '72px', top: '588px' })
  scrollIntoView.mockClear()
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(within(dialog()).getByText('2/3')).toBeInTheDocument()
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(dialog()).toHaveStyle({ left: '72px', top: '472px' }) // 대상 위 8px — 가로 자리는 그대로
  fireEvent.keyDown(dialog(), { key: 'Escape' })
  expect(lastLog()).toMatchObject({ who: 'helper', text: 'pill.log.guideStop' })
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

it('opens the materials tab and keeps the spotlight around its target as async panel content changes size', () => {
  // 파일/대화 조회가 끝나면 스크롤·window resize 없이도 패널 높이가 달라진다.
  const resized = new Map<Element, () => void>()
  globalThis.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { resized.set(element, () => this.callback([], this)) }
    unobserve(element: Element) { resized.delete(element) }
    disconnect() { resized.clear() }
  }
  const panelRect = box(700, 100, 300, 400)
  const tabs = target('linked-materials')
  tabs.setAttribute('aria-expanded', 'false')
  const tab = document.createElement('button')
  tab.setAttribute('role', 'tab'); tab.textContent = '자료'
  // 탭을 누르면 패널이 렌더된다 — React처럼 클릭한 그 순간이 아니라 뒤이은 커밋에서
  tab.addEventListener('click', () => { requestAnimationFrame(() => { target('materials-library', panelRect); target('materials-conversations', box(700, 520, 300, 100)) }) })
  tabs.addEventListener('click', () => tab.click())
  target('composer')
  renderWithProviders(<GuideTour userId="materials-user" pillRef={{ current: pill }} />)
  act(() => { useTourStore.getState().start('conversation', 'materials-user'); vi.advanceTimersByTime(1500) }) // 앞 테스트가 'u'의 진행을 남겨도 영향받지 않게
  expect(screen.getByText('1/6')).toBeInTheDocument() // composer · linked-materials · materials-library · materials-conversations · materials-staged · pill
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(within(dialog()).getByRole('heading', { name: '연결 자료' })).toBeInTheDocument()
  expect(within(dialog()).queryByText('연결 자료를 열었어요')).toBeNull() // 앞 단계(탭 목록)는 화면을 바꾸지 않았다
  fireEvent.keyDown(dialog(), { key: 'Enter' })
  expect(document.querySelector('[data-tour="materials-library"]')).toBeNull()
  act(() => { vi.advanceTimersByTime(32) })
  expect(document.querySelector('[data-tour="materials-library"]')).not.toBeNull()
  expect(spotlight()).toHaveStyle({ left: '696px', top: '96px', width: '308px', height: '408px' })
  Object.assign(panelRect, { height: 426, bottom: 526 })
  act(() => {
    resized.get(document.querySelector('[data-tour="materials-library"]')!)?.()
    vi.advanceTimersByTime(32)
  })
  expect(spotlight()).toHaveStyle({ left: '696px', top: '96px', width: '308px', height: '434px' })
  expect(within(dialog()).getByText('연결 자료를 열었어요')).toBeInTheDocument() // 화면을 바꿨으면 말풍선에 알린다
  expect(dialog()).toHaveFocus()
  fireEvent.keyDown(dialog(), { key: 'Enter' }) // 다음 대상은 이미 열린 패널에 있다 — 알림 없음
  expect(within(dialog()).queryByText('연결 자료를 열었어요')).toBeNull()
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
  const tabs = target('linked-materials')
  tabs.setAttribute('aria-expanded', 'false')
  const chatTab = document.createElement('button')
  chatTab.setAttribute('role', 'tab'); chatTab.textContent = '대화'
  // 대화 탭을 누르면 입력창(📎 앵커)이 다시 보인다 — React처럼 다음 커밋에서
  chatTab.addEventListener('click', () => { requestAnimationFrame(() => { target('materials-staged', box(240, 720, 32, 32), 'button') }) })
  const composer = target('composer'); const input = document.createElement('textarea'); composer.append(input); input.addEventListener('focus', () => chatTab.click())
  renderWithProviders(<GuideTour userId="staged-user" pillRef={{ current: pill }} />)
  act(() => { useTourStore.getState().start('conversation', 'staged-user'); vi.advanceTimersByTime(1500) })
  act(() => useTourStore.getState().goToSection(1)) // 자료함 섹션
  for (let step = 0; step < 3; step++) fireEvent.keyDown(dialog(), { key: 'Enter' }) // linked-materials → library → conversations → staged
  expect(within(dialog()).getByText(/이번 질문에 보낼 자료만 칩으로 보여요/)).toBeInTheDocument()
  expect(document.querySelector('[data-tour="materials-staged"]')).toBeNull()
  act(() => { vi.advanceTimersByTime(32) })
  expect(document.querySelector('[data-tour="materials-staged"]')).not.toBeNull()
  expect(within(dialog()).getByText('대화 화면으로 돌아왔어요')).toBeInTheDocument()
  expect(spotlight()).toHaveStyle({ left: '236px', top: '716px', width: '40px', height: '40px' })
})
