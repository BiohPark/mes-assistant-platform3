import { useQuery } from '@tanstack/react-query'
import type { Task } from '@mes/domain'

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** A display hint only; never changes a conversation's status. */
export function isTaskStalled(task: Pick<Task, 'status' | 'lastActivityAt'>, now = Date.now()): boolean {
  return task.status === 'in_progress' && now - Date.parse(task.lastActivityAt) > STALE_AFTER_MS
}

/** 서버 시각 − 브라우저 시각(ms). 응답 Date 헤더를 요청 왕복의 중간 시점과 비교한다. 헤더가 없거나 잘못되면 0(브라우저 시계). */
export function clockOffset(serverDate: string | null, sentAt: number, receivedAt: number): number {
  const server = serverDate ? Date.parse(serverDate) : Number.NaN
  return Number.isFinite(server) ? server - (sentAt + receivedAt) / 2 : 0
}

async function fetchClockOffset(): Promise<number> {
  const sentAt = Date.now()
  try {
    const response = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' })
    return clockOffset(response.headers.get('date'), sentAt, Date.now())
  } catch { return 0 }
}

/** 정체 판정용 서버 시계 오차. 받기 전에는 undefined — 브라우저 시계로 잘못 표시하지 않도록 판정을 미룬다. */
export function useServerClockOffset(enabled = true): number | undefined {
  return useQuery({ queryKey: ['server-clock'], queryFn: fetchClockOffset, enabled, staleTime: 30 * 60 * 1000 }).data
}
