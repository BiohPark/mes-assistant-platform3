import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { AssistantPill, clampPos } from './AssistantPill'

vi.mock('@/app/hooks', () => ({ useActor: () => ({ userId: 'u' }) }))

/** min-width 질의를 폭 기준으로 판정 — 기본 jsdom(1024×768)에서 데스크톱 */
function stubViewport(width: number, height = 768) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
}
const pill = () => screen.getByTestId('assistant-pill')
const drag = (dx: number, dy: number) => {
  fireEvent.pointerDown(pill(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
  fireEvent.pointerUp(pill(), { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
  fireEvent.click(pill())
}

beforeEach(() => {
  stubViewport(1280)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ mode: 'mock', model: 'mock' })))
  useUiStore.setState({ assistantOpen: false, pillPos: null })
})
afterEach(() => { act(() => useUiStore.setState({ assistantOpen: false, pillPos: null })); vi.unstubAllGlobals() })

it('6px 넘게 끌면 위치만 바뀌고 열리지 않는다 — 끌기 뒤의 클릭은 토글이 아니다', () => {
  renderWithProviders(<AssistantPill />)
  drag(40, 30)
  expect(useUiStore.getState().assistantOpen).toBe(false)
  expect(useUiStore.getState().pillPos).toEqual({ x: 40, y: 30 })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(pill()).toHaveStyle({ left: '40px', top: '30px' })
  drag(3, 4) // 임계 미만은 끌기가 아니라 클릭
  expect(useUiStore.getState().pillPos).toEqual({ x: 40, y: 30 })
  expect(useUiStore.getState().assistantOpen).toBe(true)
})

it('끌기 중에는 pointer capture 아래 transform만 바뀌고(스토어·left/top 그대로, 가장자리 clamp), 놓을 때 한 번만 저장한다', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  renderWithProviders(<AssistantPill />)
  const setPointerCapture = vi.fn()
  pill().setPointerCapture = setPointerCapture
  let writes = 0
  const unsubscribe = useUiStore.subscribe((state, previous) => { if (state.pillPos !== previous.pillPos) writes++ })
  fireEvent.pointerDown(pill(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
  expect(setPointerCapture).toHaveBeenCalledWith(1)
  fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 120, clientY: 110 })
  fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 140, clientY: 130 })
  expect(pill().style.transform).toBe('') // 프레임 전에는 그리지 않는다
  vi.advanceTimersToNextFrame()
  expect(pill().style.transform).toBe('translate3d(40px, 30px, 0)') // 한 프레임에 마지막 위치만. 원점 = 고정 자리의 rect(jsdom 0,0)
  fireEvent.pointerMove(pill(), { pointerId: 1, clientX: -500, clientY: 130 })
  vi.advanceTimersToNextFrame()
  expect(pill().style.transform).toBe('translate3d(8px, 30px, 0)') // 화면 왼쪽 밖 → MARGIN
  expect(writes).toBe(0)
  expect(useUiStore.getState().pillPos).toBeNull()
  expect(pill().style.left).toBe('16px')
  fireEvent.pointerUp(pill(), { pointerId: 1, clientX: -500, clientY: 130 })
  expect(writes).toBe(1)
  expect(useUiStore.getState().pillPos).toEqual({ x: 8, y: 30 })
  expect(pill().style.transform).toBe('')
  expect(pill()).toHaveStyle({ left: '8px', top: '30px' })
  unsubscribe()
  vi.useRealTimers()
})

it('≥1024에서는 비모달 창이 열리고 첫 요소에 포커스, Esc·재클릭으로 닫히면 포커스가 알약으로 돌아간다', async () => {
  renderWithProviders(<AssistantPill />)
  fireEvent.click(pill())
  const dialog = await screen.findByRole('dialog', { name: '시스템 assistant' })
  expect(dialog).toHaveAttribute('data-testid', 'assistant-window')
  expect(dialog).not.toHaveAttribute('data-slot', 'sheet-content')
  expect(pill()).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '시스템 assistant 닫기' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(pill()).toHaveFocus()
  fireEvent.click(pill())
  await screen.findByRole('dialog', { name: '시스템 assistant' })
  fireEvent.click(pill())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(pill()).toHaveFocus()
  expect(pill()).toHaveAttribute('aria-expanded', 'false')
})

it('화살표 키 10px·Shift 50px로 옮기고 Home으로 원위치, 화면 밖으로는 못 나간다', () => {
  renderWithProviders(<AssistantPill />)
  act(() => useUiStore.getState().setPillPos({ x: 100, y: 100 }))
  fireEvent.keyDown(pill(), { key: 'ArrowRight' })
  expect(useUiStore.getState().pillPos).toEqual({ x: 110, y: 100 })
  fireEvent.keyDown(pill(), { key: 'ArrowDown', shiftKey: true })
  expect(useUiStore.getState().pillPos).toEqual({ x: 110, y: 150 })
  fireEvent.keyDown(pill(), { key: 'ArrowLeft', shiftKey: true })
  fireEvent.keyDown(pill(), { key: 'ArrowLeft', shiftKey: true })
  fireEvent.keyDown(pill(), { key: 'ArrowLeft', shiftKey: true })
  expect(useUiStore.getState().pillPos).toEqual({ x: 8, y: 150 }) // clamp
  fireEvent.keyDown(pill(), { key: 'Home' })
  expect(useUiStore.getState().pillPos).toBeNull()
  expect(pill()).toHaveStyle({ left: '16px', bottom: '16px' }) // 기본 위치 = 사이드바 하단(왼쪽), 우하단 입력창 전송 버튼과 겹치지 않는다
  expect(pill().style.right).toBe('')
})

it('창 크기가 바뀌면 저장된 위치를 다시 clamp한다', () => {
  renderWithProviders(<AssistantPill />)
  act(() => useUiStore.getState().setPillPos({ x: 1200, y: 700 }))
  stubViewport(800, 600)
  fireEvent(window, new Event('resize'))
  expect(useUiStore.getState().pillPos).toEqual(clampPos({ x: 1200, y: 700 }))
  expect(useUiStore.getState().pillPos).toEqual({ x: 800 - 48 - 8, y: 600 - 48 - 8 })
})

it('더 큰 화면에서 저장한 좌표는 처음 마운트할 때(persist 복원 포함) clamp한다 (리뷰 P2)', () => {
  stubViewport(1280, 720)
  useUiStore.setState({ pillPos: { x: 1800, y: 950 } })
  renderWithProviders(<AssistantPill />)
  expect(useUiStore.getState().pillPos).toEqual({ x: 1280 - 48 - 8, y: 720 - 48 - 8 })
  expect(pill()).toHaveStyle({ left: `${1280 - 56}px`, top: `${720 - 56}px` })
})

it('<768에서는 사이드바 열 하단(왼쪽)에 고정 — 우하단 입력창·메뉴를 가리지 않고(CI 390px) — 끌기·키 이동이 꺼지며 시트로 연다', async () => {
  stubViewport(600)
  useUiStore.getState().setPillPos({ x: 10, y: 10 })
  renderWithProviders(<AssistantPill />)
  expect(pill()).toHaveStyle({ left: '4px', bottom: '16px' }) // 사이드바 w-14(56px) 안
  expect(pill().style.right).toBe('')
  expect(pill().style.top).toBe('')
  expect(pill()).not.toHaveAttribute('title')
  fireEvent.keyDown(pill(), { key: 'ArrowRight' })
  expect(useUiStore.getState().pillPos).toEqual({ x: 10, y: 10 })
  drag(40, 40)
  expect(useUiStore.getState().pillPos).toEqual({ x: 10, y: 10 })
  expect(await screen.findByRole('dialog', { name: '시스템 assistant' })).toHaveAttribute('data-slot', 'sheet-content')
})

it('SO가 올린 캐릭터 이미지를 대체 텍스트와 함께 보여 주고, 없으면 기본 아이콘이다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/settings' ? { assistantImageFileId: 'img-9' } : { mode: 'mock', model: 'mock' })))
  renderWithProviders(<AssistantPill />)
  const image = await screen.findByRole('img', { name: 'AI 도우미 캐릭터' })
  expect(image).toHaveAttribute('src', '/api/settings/assistant-image?v=img-9') // 로그인 사용자 전용 조회 경로, 파일 ID로 캐시 구분
  expect(pill()).toContainElement(image)
})
