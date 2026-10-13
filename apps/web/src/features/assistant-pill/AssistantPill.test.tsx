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
  expect(pill()).toHaveStyle({ right: '16px', bottom: '16px' })
})

it('창 크기가 바뀌면 저장된 위치를 다시 clamp한다', () => {
  renderWithProviders(<AssistantPill />)
  act(() => useUiStore.getState().setPillPos({ x: 1200, y: 700 }))
  stubViewport(800, 600)
  fireEvent(window, new Event('resize'))
  expect(useUiStore.getState().pillPos).toEqual(clampPos({ x: 1200, y: 700 }))
  expect(useUiStore.getState().pillPos).toEqual({ x: 800 - 48 - 8, y: 600 - 48 - 8 })
})

it('<768에서는 우하단 고정이고 끌기·키 이동이 꺼지며 시트로 연다', async () => {
  stubViewport(600)
  useUiStore.getState().setPillPos({ x: 10, y: 10 })
  renderWithProviders(<AssistantPill />)
  expect(pill()).toHaveStyle({ right: '16px', bottom: '16px' })
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
  expect(image).toHaveAttribute('src', '/api/files/img-9/content')
  expect(pill()).toContainElement(image)
})
