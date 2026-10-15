import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { BudgetLevel } from '@mes/domain'

/**
 * 분류표 — 코드 데이터(U6).
 * 벨(알림 목록)은 서버 notification.created 전부, 말풍선은 클라이언트 상태(budget·slow), 내 요청의 끝(reply.*, replyBubble.ts), 내 태그 변경으로 자료함에 들어오고 빠진 같은 태그 항목(share.*, task/tagShare.ts), 페이지 가이드를 끝까지 본 칭찬(guide.done, GuideTour)뿐이다. 둘은 겹치지 않고, 말풍선은 AI를 호출하지 않는다.
 */
export const BELL_SOURCES = ['notification.created'] as const
export const BUBBLE_SOURCES = ['budget.warn', 'budget.over', 'request.slow', 'reply.done', 'reply.failed', 'reply.cancelled', 'share.in', 'share.out', 'share.none', 'guide.done'] as const
export type BubbleSource = (typeof BUBBLE_SOURCES)[number]
export type ReplySource = Extract<BubbleSource, `reply.${string}`>
export const isReplyBubble = (bubble: Bubble): bubble is Bubble & { source: ReplySource; taskId: string } => bubble.source.startsWith('reply.') && typeof bubble.taskId === 'string'

export const BUBBLE_TTL_MS = 8_000
export const SLOW_REQUEST_MS = 30_000

export interface Bubble {
  id: number
  source: BubbleSource
  /** budget.* — 이 대화에서만 뜻이 있다. 대화를 떠나면 제거된다 */
  key?: string
  /** request.slow — 클릭 시 이 요청의 정보를 연다 */
  requestId?: string
  /** budget.* — 클릭 시 입력창 위 요청 크기 안내로 포커스한다(RequestSizeNotice가 등록) */
  onOpen?: () => void
  /** reply.* — [바로 가기] 대상 대화와 그 제목, 답 첫 문장(done만) */
  taskId?: string
  title?: string
  excerpt?: string
  /** share.* — 들어오거나 빠진 같은 태그 대화·파일 수 */
  counts?: { conversations: number; files: number }
}

interface BubbleState {
  current: Bubble | null
  /** 큐 1개 — 새 말풍선은 대기 중인 것을 대체한다 */
  queued: Bubble | null
  push: (bubble: Omit<Bubble, 'id'>) => void
  dismiss: () => void
  /** 그 대화의 말풍선을 현재·대기에서 지운다 */
  drop: (key: string) => void
}

let nextId = 1
export const useBubbleStore = create<BubbleState>()((set) => ({
  current: null,
  queued: null,
  push: (bubble) => set((state) => state.current ? { queued: { ...bubble, id: nextId++ } } : { current: { ...bubble, id: nextId++ } }),
  dismiss: () => set((state) => ({ current: state.queued, queued: null })),
  drop: (key) => set((state) => {
    const queued = state.queued?.key === key ? null : state.queued
    return state.current?.key === key ? { current: queued, queued: null } : { queued }
  }),
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

/**
 * budgetLevel이 올라갈 때(ok→warn·warn→over·ok→over) 대화당 한 번 말풍선.
 * level이 없으면(추정 로딩 중) 기록·비교를 건너뛴다 — 돌아온 대화에서 'ok'가 끼어들어 같은 warn이 다시 뜨지 않게.
 * 대화를 떠나면(key 변경·언마운트) 그 대화의 말풍선은 제거한다 — 클릭해도 짚을 크기 안내가 없다
 */
export function useBudgetBubble(key: string, level: BudgetLevel | undefined, onOpen: () => void) {
  const open = useRef(onOpen)
  open.current = onOpen
  useEffect(() => {
    if (!level) return
    const previous = seenLevels.get(key) ?? 'ok'
    seenLevels.set(key, level)
    if (RANK[level] > RANK[previous]) useBubbleStore.getState().push({ source: `budget.${level}` as BubbleSource, key, onOpen: () => open.current() })
  }, [key, level])
  useEffect(() => () => useBubbleStore.getState().drop(key), [key])
}

/** 마지막 본문·reasoning delta(없으면 run 시작) 뒤 30초 동안 아무것도 오지 않으면 요청당 한 번 말풍선(S10: reasoning도 생존 신호). delta마다 다시 센다 */
export function useSlowRequestBubble(run: { requestId: string; text: string; reasoning?: string } | null) {
  const requestId = run?.requestId
  const progress = run ? `${run.text}\u0000${run.reasoning ?? ''}` : undefined
  useEffect(() => {
    if (!requestId || slowNotified.has(requestId)) return
    const timer = setTimeout(() => {
      slowNotified.add(requestId)
      useBubbleStore.getState().push({ source: 'request.slow', requestId })
    }, SLOW_REQUEST_MS)
    return () => clearTimeout(timer)
  }, [requestId, progress])
}
