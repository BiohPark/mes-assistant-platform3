import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { BudgetLevel } from '@mes/domain'

/**
 * 분류표 — 코드 데이터(U6).
 * 벨(알림 목록)은 서버 notification.created 전부, 말풍선은 클라이언트 상태 두 가지뿐이다. 둘은 겹치지 않고, 말풍선은 AI를 호출하지 않는다.
 */
export const BELL_SOURCES = ['notification.created'] as const
export const BUBBLE_SOURCES = ['budget.warn', 'budget.over', 'request.slow'] as const
export type BubbleSource = (typeof BUBBLE_SOURCES)[number]

export const BUBBLE_TTL_MS = 8_000
export const SLOW_REQUEST_MS = 30_000

export interface Bubble {
  id: number
  source: BubbleSource
  /** request.slow — 클릭 시 이 요청의 정보를 연다 */
  requestId?: string
  /** budget.* — 클릭 시 트레이를 펼친다(ContextTray가 등록) */
  onOpen?: () => void
}

interface BubbleState {
  current: Bubble | null
  /** 큐 1개 — 새 말풍선은 대기 중인 것을 대체한다 */
  queued: Bubble | null
  push: (bubble: Omit<Bubble, 'id'>) => void
  dismiss: () => void
}

let nextId = 1
export const useBubbleStore = create<BubbleState>()((set) => ({
  current: null,
  queued: null,
  push: (bubble) => set((state) => state.current ? { queued: { ...bubble, id: nextId++ } } : { current: { ...bubble, id: nextId++ } }),
  dismiss: () => set((state) => ({ current: state.queued, queued: null })),
}))

const RANK: Record<BudgetLevel, number> = { ok: 0, warn: 1, over: 2 }
/** 대화별로 마지막에 본 레벨 — 돌아온 대화에서 같은 레벨을 다시 알리지 않는다 */
const seenLevels = new Map<string, BudgetLevel>()
const slowNotified = new Set<string>()

/** 테스트용 초기화 */
export function resetBubbles() {
  useBubbleStore.setState({ current: null, queued: null })
  seenLevels.clear()
  slowNotified.clear()
}

/** budgetLevel이 올라갈 때(ok→warn·warn→over·ok→over) 대화당 한 번 말풍선 */
export function useBudgetBubble(key: string, level: BudgetLevel, onOpen: () => void) {
  const open = useRef(onOpen)
  open.current = onOpen
  useEffect(() => {
    const previous = seenLevels.get(key) ?? 'ok'
    seenLevels.set(key, level)
    if (RANK[level] > RANK[previous]) useBubbleStore.getState().push({ source: `budget.${level}` as BubbleSource, onOpen: () => open.current() })
  }, [key, level])
}

/** run 시작 뒤 30초 동안 본문·reasoning delta가 모두 없으면 요청당 한 번 말풍선(S10: reasoning도 생존 신호). delta·종료가 먼저 오면 없다 */
export function useSlowRequestBubble(run: { requestId: string; text: string; reasoning?: string } | null) {
  const requestId = run?.requestId
  const text = run ? `${run.text}\u0000${run.reasoning ?? ''}` : undefined
  const baseline = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!requestId || slowNotified.has(requestId)) return
    baseline.current = text
    const timer = setTimeout(() => {
      if (slowNotified.has(requestId)) return // delta가 먼저 왔다
      slowNotified.add(requestId)
      useBubbleStore.getState().push({ source: 'request.slow', requestId })
    }, SLOW_REQUEST_MS)
    return () => clearTimeout(timer)
  }, [requestId])
  useEffect(() => {
    if (requestId && text !== baseline.current) slowNotified.add(requestId) // delta 도착 — 이 요청은 더 기다리지 않는다
  }, [requestId, text])
}
