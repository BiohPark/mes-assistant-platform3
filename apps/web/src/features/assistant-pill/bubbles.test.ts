import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { TabActiveContext } from '@/app/tabActive'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BudgetLevel } from '@mes/domain'
import { BELL_SOURCES, BUBBLE_SOURCES, SLOW_REQUEST_MS, resetBubbles, useBubbleStore, useBudgetBubble, useSlowRequestBubble } from './bubbles'

/** useEvents.ts가 구독하는 서버 SSE 이름 — 벨은 이 가운데 notification.created만 쓴다 */
const SSE_EVENTS = ['task.created', 'task.updated', 'message.appended', 'request.updated', 'file.updated', 'input.updated',
  'context.updated', 'sr.updated', 'presence.typing', 'notification.created', 'resync']

beforeEach(() => resetBubbles())
afterEach(() => vi.useRealTimers())

const sources = () => [useBubbleStore.getState().current?.source, useBubbleStore.getState().queued?.source]

it('bubble sources are disjoint from notification (bell) sources and from every server event name', () => {
  expect(BELL_SOURCES).toEqual(['notification.created'])
  for (const source of BUBBLE_SOURCES) {
    expect(BELL_SOURCES).not.toContain(source)
    expect(SSE_EVENTS).not.toContain(source)
  }
  expect(BUBBLE_SOURCES).toEqual(['budget.warn', 'budget.over', 'request.slow', 'reply.done', 'reply.failed', 'reply.cancelled', 'share.in', 'share.out', 'share.none', 'guide.done'])
})

it('keeps one current bubble and one queued — a newer push replaces the queued one, dismiss promotes it', () => {
  const { push, dismiss } = useBubbleStore.getState()
  push({ source: 'budget.warn' })
  expect(sources()).toEqual(['budget.warn', undefined])
  push({ source: 'request.slow', requestId: 'r1' })
  push({ source: 'budget.over' })
  expect(sources()).toEqual(['budget.warn', 'budget.over'])
  dismiss()
  expect(sources()).toEqual(['budget.over', undefined])
  dismiss()
  expect(sources()).toEqual([undefined, undefined])
})

it('warn fires once per level rise — not on repeats, falls, or when returning to a conversation already seen at that level', () => {
  const onOpen = vi.fn()
  const { rerender } = renderHook(({ key, level }) => useBudgetBubble(key, level, onOpen), { initialProps: { key: 't1', level: 'ok' as BudgetLevel } })
  expect(useBubbleStore.getState().current).toBeNull()
  rerender({ key: 't1', level: 'warn' })
  expect(sources()).toEqual(['budget.warn', undefined])
  rerender({ key: 't1', level: 'warn' })
  expect(sources()).toEqual(['budget.warn', undefined])
  rerender({ key: 't1', level: 'over' })
  expect(sources()).toEqual(['budget.warn', 'budget.over'])
  act(() => useBubbleStore.getState().dismiss())
  act(() => useBubbleStore.getState().dismiss())
  rerender({ key: 't1', level: 'warn' }) // 내려감 — 없음
  rerender({ key: 't1', level: 'ok' })
  expect(sources()).toEqual([undefined, undefined])
  rerender({ key: 't1', level: 'warn' }) // 다시 올라감 — 1회
  expect(sources()).toEqual(['budget.warn', undefined])
  act(() => useBubbleStore.getState().dismiss())
  rerender({ key: 't2', level: 'warn' }) // 다른 대화의 첫 warn — 1회
  expect(sources()).toEqual(['budget.warn', undefined])
  act(() => useBubbleStore.getState().dismiss())
  rerender({ key: 't1', level: 'warn' }) // 돌아온 대화는 이미 warn으로 봤다 — 없음
  expect(sources()).toEqual([undefined, undefined])
  rerender({ key: 't3', level: 'over' }) // ok→over 직행도 한 번
  expect(sources()).toEqual(['budget.over', undefined])
  useBubbleStore.getState().current?.onOpen?.()
  expect(onOpen).toHaveBeenCalledTimes(1)
})

it('skips recording while the estimate is loading, so returning to a warn conversation does not repeat the bubble', () => {
  const { rerender } = renderHook(({ key, level }) => useBudgetBubble(key, level, () => {}), { initialProps: { key: 't1', level: undefined as BudgetLevel | undefined } })
  rerender({ key: 't1', level: 'warn' })
  expect(sources()).toEqual(['budget.warn', undefined])
  act(() => useBubbleStore.getState().dismiss())
  rerender({ key: 't2', level: undefined })
  rerender({ key: 't2', level: 'ok' })
  rerender({ key: 't1', level: undefined }) // 돌아옴 — 추정 로딩 중
  rerender({ key: 't1', level: 'warn' })
  expect(sources()).toEqual([undefined, undefined])
})

it('a budget bubble belongs to its conversation — leaving the conversation (key change or unmount) removes it from current and queue', () => {
  const { rerender, unmount } = renderHook(({ key, level }) => useBudgetBubble(key, level, () => {}), { initialProps: { key: 't1', level: 'warn' as BudgetLevel | undefined } })
  rerender({ key: 't1', level: 'over' })
  expect(sources()).toEqual(['budget.warn', 'budget.over'])
  rerender({ key: 't2', level: 'ok' })
  expect(sources()).toEqual([undefined, undefined])
  useBubbleStore.getState().push({ source: 'request.slow', requestId: 'r1' }) // 대화에 묶이지 않은 말풍선은 남는다
  rerender({ key: 't2', level: 'warn' })
  expect(sources()).toEqual(['request.slow', 'budget.warn'])
  unmount()
  expect(sources()).toEqual(['request.slow', undefined])
})

it('request.slow fires once per request after 30 s without a delta, and never when a delta or the end arrives first', () => {
  vi.useFakeTimers()
  const { rerender } = renderHook(({ run }) => useSlowRequestBubble(run), { initialProps: { run: null as { requestId: string; text: string } | null } })
  rerender({ run: { requestId: 'r1', text: '' } })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS - 1) })
  expect(useBubbleStore.getState().current).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'request.slow', requestId: 'r1' })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS * 2) })
  expect(useBubbleStore.getState().queued).toBeNull() // 요청당 1회
  rerender({ run: null })
  rerender({ run: { requestId: 'r1', text: '' } }) // 재접속 재개 — 같은 요청은 다시 알리지 않는다
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS) })
  expect(useBubbleStore.getState().queued).toBeNull()
  act(() => useBubbleStore.getState().dismiss())

  rerender({ run: { requestId: 'r2', text: '' } })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS / 2) })
  rerender({ run: { requestId: 'r2', text: '답' } }) // delta 도착 — 30초를 다시 센다
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS - 1) })
  expect(useBubbleStore.getState().current).toBeNull()
  act(() => { vi.advanceTimersByTime(1) }) // 마지막 delta 뒤 30초 무진행 — 뜬다
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'request.slow', requestId: 'r2' })
  act(() => useBubbleStore.getState().dismiss())

  rerender({ run: { requestId: 'r3', text: '' } })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS / 2) })
  rerender({ run: null }) // 완료·실패 — 타이머 취소
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS) })
  expect(useBubbleStore.getState().current).toBeNull()
})

it('reasoning streaming counts as progress — no slow bubble while only reasoning arrives', () => {
  vi.useFakeTimers()
  type Run = { requestId: string; text: string; reasoning?: string } | null
  const { rerender } = renderHook(({ run }) => useSlowRequestBubble(run), { initialProps: { run: { requestId: 'r4', text: '', reasoning: '' } as Run } })
  for (let step = 1; step <= 6; step++) { // 10초마다 reasoning delta만 60초 — 진행으로 치므로 뜨지 않는다
    act(() => { vi.advanceTimersByTime(10_000) })
    rerender({ run: { requestId: 'r4', text: '', reasoning: '검토 중'.repeat(step) } })
  }
  expect(useBubbleStore.getState().current).toBeNull()
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS - 1) })
  expect(useBubbleStore.getState().current).toBeNull()
  rerender({ run: null }) // 완료 — 마지막 reasoning 뒤 30초가 차기 전에 끝났으니 영영 없다
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS) })
  expect(useBubbleStore.getState().current).toBeNull()
  rerender({ run: { requestId: 'r5', text: '', reasoning: '이어서' } }) // 재개 시 복원된 reasoning은 기준선 — 그 뒤 아무것도 없으면 뜬다
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS) })
  expect(useBubbleStore.getState().current).toMatchObject({ source: 'request.slow', requestId: 'r5' })
})

it('S15: 숨은 탭에서는 예산·느린 응답 말풍선을 띄우지 않고, 숨으면 그 대화의 말풍선을 거둔다 — 다시 보이면 그때 알린다', () => {
  vi.useFakeTimers()
  let active = true
  const wrapper = ({ children }: { children: ReactNode }) => createElement(TabActiveContext, { value: active }, children)
  const budget = renderHook(({ level }) => useBudgetBubble('t9', level, () => {}), { wrapper, initialProps: { level: 'warn' as BudgetLevel } })
  expect(sources()[0]).toBe('budget.warn')
  active = false
  budget.rerender({ level: 'over' })
  expect(sources()).toEqual([undefined, undefined])
  active = true
  budget.rerender({ level: 'over' })
  expect(sources()[0]).toBe('budget.over')
  budget.unmount()

  active = false
  const slow = renderHook(({ run }) => useSlowRequestBubble(run), { wrapper, initialProps: { run: { requestId: 'r9', text: '' } } })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS + 1) })
  expect(sources()).toEqual([undefined, undefined])
  active = true
  slow.rerender({ run: { requestId: 'r9', text: '' } })
  act(() => { vi.advanceTimersByTime(SLOW_REQUEST_MS + 1) })
  expect(sources()[0]).toBe('request.slow')
})
