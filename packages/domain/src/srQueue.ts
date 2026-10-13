/** 접수 시각부터 지난 온전한 24시간. 상태 변경·재오픈으로 리셋하지 않는다. */
export function srElapsedDays(submittedAt: string | Date | null | undefined, now = Date.now()): number {
  if (!submittedAt) return 0
  const submitted = new Date(submittedAt).getTime()
  return Number.isFinite(submitted) ? Math.max(0, Math.floor((now - submitted) / 86_400_000)) : 0
}
