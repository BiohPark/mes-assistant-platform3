import type { Assistant, AssistantStat, FeedbackDigestRow, FlowEdge, Granularity, InefficiencySignal, SrStatus, TagUsage, TimeBucket, User, UserActivityStat } from '@mes/domain'

export interface ReportData {
  days: number
  granularity: Granularity
  kpi: { done: number; avgLead?: number; reopens: number; checkRate?: number; srLead?: number }
  buckets: TimeBucket[]
  assistantStats: AssistantStat[]
  userStats: UserActivityStat[]
  flow: FlowEdge[]
  tags: TagUsage[]
  srDist: Array<{ status: SrStatus; count: number }>
  signals: InefficiencySignal[]
  digest: FeedbackDigestRow[]
  assistants: Assistant[]
  users: User[]
}

export async function getReport(days: number, granularity: Granularity, userId?: string): Promise<ReportData> {
  const params = new URLSearchParams({ days: String(days), granularity })
  if (userId) params.set('userId', userId)
  const response = await fetch(`/api/reports?${params}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`리포트 조회 실패 (HTTP ${response.status})`)
  return response.json() as Promise<ReportData>
}
