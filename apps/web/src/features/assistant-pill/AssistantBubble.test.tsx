import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { AssistantBubble } from './AssistantBubble'
import { BUBBLE_TTL_MS, resetBubbles, useBubbleStore } from './bubbles'

beforeEach(() => { resetBubbles(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const push = (bubble: Parameters<ReturnType<typeof useBubbleStore.getState>['push']>[0]) => act(() => useBubbleStore.getState().push(bubble))
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const bubble = () => screen.queryByTestId('assistant-bubble')

it('announces politely, disappears after 8 s and then shows the queued bubble', () => {
  renderWithProviders(<AssistantBubble pillRef={{ current: null }} pos={null} />)
  const region = screen.getByRole('status', { name: 'AI 도우미 말풍선' })
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(bubble()).toBeNull()
  push({ source: 'budget.warn' })
  push({ source: 'budget.over' })
  expect(screen.getByText('요청 크기가 한도의 80%를 넘었어요. 눌러서 입력창의 첨부를 확인하세요')).toBeVisible()
  expect(bubble()).toHaveClass('motion-reduce:animate-none')
  advance(BUBBLE_TTL_MS - 1)
  expect(screen.getByText(/한도의 80%/)).toBeVisible()
  advance(1)
  expect(screen.getByText('요청 크기가 한도를 넘어 전송이 막혀요. 눌러서 첨부를 빼거나 줄이세요')).toBeVisible()
  advance(BUBBLE_TTL_MS)
  expect(bubble()).toBeNull()
})

it('pauses the timer on hover and on focus, resuming with the remaining time', () => {
  renderWithProviders(<AssistantBubble pillRef={{ current: null }} pos={null} />)
  push({ source: 'budget.warn' })
  advance(BUBBLE_TTL_MS - 1000)
  fireEvent.mouseEnter(bubble()!)
  advance(BUBBLE_TTL_MS * 3)
  expect(bubble()).toBeVisible()
  fireEvent.mouseLeave(bubble()!)
  advance(999)
  expect(bubble()).toBeVisible()
  fireEvent.focus(screen.getByRole('button', { name: '말풍선 닫기' }))
  advance(BUBBLE_TTL_MS * 3)
  expect(bubble()).toBeVisible()
  fireEvent.blur(screen.getByRole('button', { name: '말풍선 닫기' }))
  advance(1)
  expect(bubble()).toBeNull()
})

it('click runs the bubble action (size notice) and dismisses; the close button dismisses without the action', () => {
  const onOpen = vi.fn()
  renderWithProviders(<AssistantBubble pillRef={{ current: null }} pos={null} />)
  push({ source: 'budget.warn', onOpen })
  push({ source: 'budget.over', onOpen })
  fireEvent.click(screen.getByRole('button', { name: /한도의 80%/ }))
  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/한도를 넘어/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '말풍선 닫기' }))
  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(bubble()).toBeNull()
})

it('완료 알림 말풍선 — 제목·답 첫 문장과 [바로 가기] 버튼; 누르면 그 대화로 이동하고 닫힌다. 실패·중단은 다른 문구, 발췌 없음', () => {
  function Where() { return <output aria-label="위치">{useLocation().pathname}</output> }
  renderWithProviders(<><AssistantBubble pillRef={{ current: null }} pos={null} /><Where /></>, { route: '/my-work' })
  push({ source: 'reply.done', taskId: 't1', title: '검사 절차', excerpt: '선택된 입력이 없어 진행합니다.' })
  expect(screen.getByText('"검사 절차" 답변이 끝났어요')).toBeVisible()
  expect(screen.getByTestId('bubble-excerpt')).toHaveTextContent('선택된 입력이 없어 진행합니다.')
  fireEvent.click(screen.getByRole('button', { name: '바로 가기' }))
  expect(screen.getByRole('status', { name: '위치' })).toHaveTextContent('/c/t1')
  expect(bubble()).toBeNull()
  push({ source: 'reply.failed', taskId: 't2', title: '실패한 대화' })
  expect(screen.getByText('"실패한 대화" 답변이 실패했어요')).toBeVisible()
  expect(screen.queryByTestId('bubble-excerpt')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '말풍선 닫기' }))
  push({ source: 'reply.cancelled', taskId: 't3', title: '중단' })
  expect(screen.getByText('"중단" 답변이 중단됐어요')).toBeVisible()
  expect(screen.getByRole('button', { name: '바로 가기' })).toBeVisible()
})

it('a slow-request bubble opens the request info dialog for that request', async () => {
  vi.useRealTimers() // findByRole는 실제 타이머로 기다린다
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'r9', threadId: 'h', status: 'running', provider: 'mock', transport: 'inline', model: 'mock', inputs: [], limitBytes: 1000 })))
  renderWithProviders(<AssistantBubble pillRef={{ current: null }} pos={null} />)
  push({ source: 'request.slow', requestId: 'r9' })
  fireEvent.click(screen.getByRole('button', { name: '응답이 30초 넘게 오지 않아요. 눌러서 요청 정보를 확인하세요' }))
  expect(bubble()).toBeNull()
  expect(await screen.findByRole('dialog', { name: '사용한 자료' })).toBeVisible()
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/requests/r9')
})
