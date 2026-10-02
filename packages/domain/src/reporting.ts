import { format, startOfWeek, subDays } from 'date-fns'
import { SR_STATUSES, type ActivityLog, type Assistant, type FileAsset, type ServiceRequest, type SrStatus, type Task, type User } from './types.js'

export type Granularity = 'day' | 'week'

const DAY_MS = 86_400_000
const LONG_TASK_DAYS = 10
const STALE_DAYS = 5

function durationDays(start?: string, end?: string, now = new Date()): number | undefined {
  if (!start) return undefined
  const e = end ? new Date(end).getTime() : now.getTime()
  return Math.max(0, (e - new Date(start).getTime()) / DAY_MS)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function avg(list: number[]): number | undefined {
  return list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : undefined
}

export interface TimeBucket {
  key: string
  label: string
  done: number
}

/** 기간 내 일별/주별 완료 업무 수. 빈 버킷도 0으로 채운다. */
export function completionBuckets(tasks: Task[], days: number, granularity: Granularity, now = new Date()): TimeBucket[] {
  const from = subDays(now, days - 1)
  const keyOf = (d: Date) => (granularity === 'day' ? format(d, 'yyyy-MM-dd') : format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  const labelOf = (d: Date) => (granularity === 'day' ? format(d, 'M/d') : `${format(startOfWeek(d, { weekStartsOn: 1 }), 'M/d')}주`)
  const order: string[] = []
  const counts = new Map<string, TimeBucket>()
  for (let i = 0; i < days; i++) {
    const d = subDays(now, days - 1 - i)
    const key = keyOf(d)
    if (!counts.has(key)) {
      order.push(key)
      counts.set(key, { key, label: labelOf(d), done: 0 })
    }
  }
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue
    const d = new Date(t.completedAt)
    if (d < from) continue
    const b = counts.get(keyOf(d))
    if (b) counts.set(b.key, { ...b, done: b.done + 1 })
  }
  return order.map((k) => counts.get(k)!)
}

export interface AssistantStat {
  assistant: Assistant
  total: number
  active: number
  done: number
  avgLeadDays?: number
  maxLeadDays?: number
  avgRating?: number
}

/** 어시스턴트별 업무 수/리드타임/피드백 */
export function assistantStats(tasks: Task[], assistants: Assistant[], now = new Date()): AssistantStat[] {
  return assistants
    .map((assistant): AssistantStat => {
      const mine = tasks.filter((t) => t.assistantId === assistant.id)
      const leads = mine.filter((t) => t.status === 'done').map((t) => durationDays(t.startedAt ?? t.createdAt, t.completedAt, now)).filter((d): d is number => d !== undefined)
      const ratings = mine.map((t) => t.feedback?.rating).filter((r): r is number => typeof r === 'number')
      return {
        assistant,
        total: mine.length,
        active: mine.filter((t) => t.status !== 'done').length,
        done: mine.filter((t) => t.status === 'done').length,
        avgLeadDays: avg(leads),
        maxLeadDays: leads.length ? round1(Math.max(...leads)) : undefined,
        avgRating: avg(ratings),
      }
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => (b.avgLeadDays ?? -1) - (a.avgLeadDays ?? -1))
}

export interface UserActivityStat {
  userId: string
  name: string
  messages: number
  checks: number
  completed: number
  files: number
  total: number
}

export function userActivityStats(activity: ActivityLog[], users: User[], days: number, now = new Date()): UserActivityStat[] {
  const from = subDays(now, days - 1).toISOString()
  const counted = (a: ActivityLog): keyof Pick<UserActivityStat, 'messages' | 'checks' | 'completed' | 'files'> | null => {
    if (a.type === 'message.sent') return 'messages'
    if (a.type === 'checklist.checked') return 'checks'
    if (a.type === 'task.completed') return 'completed'
    if (a.type === 'file.uploaded' || a.type === 'file.tagged_output') return 'files'
    return null
  }
  return users
    .map((u): UserActivityStat => {
      const stat = { userId: u.id, name: u.name, messages: 0, checks: 0, completed: 0, files: 0, total: 0 }
      for (const a of activity) {
        if (a.userId !== u.id || a.at < from) continue
        const k = counted(a)
        if (k) {
          stat[k] += 1
          stat.total += 1
        }
      }
      return stat
    })
    .sort((a, b) => b.total - a.total)
}

export interface FlowEdge {
  fromAssistantId: string
  toAssistantId: string
  count: number
}

/** 자료 흐름: 입력으로 선택된 파일의 출처 대화 어시스턴트 → 선택한 대화의 어시스턴트 쌍별 건수 */
export function inputFlow(tasks: Task[], files: Pick<FileAsset, 'id' | 'originTaskId'>[], sourceTasks: Pick<Task, 'id' | 'assistantId'>[] = tasks): FlowEdge[] {
  const taskById = new Map(sourceTasks.map((t) => [t.id, t]))
  const fileById = new Map(files.map((f) => [f.id, f]))
  const counts = new Map<string, FlowEdge>()
  for (const to of tasks) {
    for (const input of to.inputs) {
      const originId = fileById.get(input.fileId)?.originTaskId
      const from = originId ? taskById.get(originId) : undefined
      if (!from || from.id === to.id) continue
      const key = `${from.assistantId}→${to.assistantId}`
      const cur = counts.get(key) ?? { fromAssistantId: from.assistantId, toAssistantId: to.assistantId, count: 0 }
      counts.set(key, { ...cur, count: cur.count + 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

export interface TagUsage {
  tag: string
  conversations: number
  open: number
  assistantIds: string[]
}

/** 태그별 대화 수 · 진행 중 수 · 거쳐 간 어시스턴트 (많이 쓰인 순) */
export function tagUsage(tasks: Task[]): TagUsage[] {
  const byTag = new Map<string, TagUsage>()
  for (const t of tasks) {
    for (const tag of t.tags) {
      const cur = byTag.get(tag) ?? { tag, conversations: 0, open: 0, assistantIds: [] }
      byTag.set(tag, {
        tag,
        conversations: cur.conversations + 1,
        open: cur.open + (t.status === 'done' ? 0 : 1),
        assistantIds: cur.assistantIds.includes(t.assistantId) ? cur.assistantIds : [...cur.assistantIds, t.assistantId],
      })
    }
  }
  return [...byTag.values()].sort((a, b) => b.conversations - a.conversations || a.tag.localeCompare(b.tag))
}

export function srStatusDistribution(srs: ServiceRequest[]): Array<{ status: SrStatus; count: number }> {
  return SR_STATUSES.filter((s) => s !== 'draft').map((status) => ({ status, count: srs.filter((s) => s.status === status).length }))
}

type ReportActivity = Pick<ActivityLog, 'type' | 'taskId' | 'srId' | 'payload' | 'at'>

/** 접수 → 완료 평균 일수 (완료 상태 변경 로그 기준) */
export function srLeadDays(srs: ServiceRequest[], activity: ReportActivity[]): number | undefined {
  const doneAt = new Map<string, string>()
  for (const a of activity) {
    if (a.type === 'sr.status_changed' && a.srId && a.payload.to === 'done') doneAt.set(a.srId, a.at)
  }
  const leads = srs.filter((s) => s.status === 'done' && s.submittedAt && doneAt.has(s.id)).map((s) => durationDays(s.submittedAt, doneAt.get(s.id))!)
  return avg(leads)
}

export type SignalKind = 'reopen' | 'missing_required' | 'long_task' | 'stale' | 'outdated_input'

export interface InefficiencySignal {
  kind: SignalKind
  taskId: string
  taskCode: string
  taskTitle: string
  detail: string
  at: string
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  reopen: '재오픈',
  missing_required: '중요 체크 미완료로 완료',
  long_task: '장기 진행',
  stale: '방치',
  outdated_input: '이전 버전 입력',
}

/** 비효율 신호: 재오픈, 중요 체크 미완료로 완료, 장기 업무(≥10일), 방치(≥5일 활동 없음), 새 버전이 나왔는데 이전 버전을 입력으로 쓰는 진행 중 대화 */
export function inefficiencySignals(tasks: Task[], activity: ReportActivity[], files: Pick<FileAsset, 'id' | 'name' | 'version' | 'previousId'>[], now = new Date(), lastActivityByTask?: ReadonlyMap<string, string>): InefficiencySignal[] {
  const out: InefficiencySignal[] = []
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const push = (kind: SignalKind, t: Task, detail: string, at: string) => out.push({ kind, taskId: t.id, taskCode: t.code, taskTitle: t.title, detail, at })

  for (const a of activity) {
    const t = a.taskId ? taskById.get(a.taskId) : undefined
    if (!t) continue
    if (a.type === 'task.reopened') push('reopen', t, a.payload.reason ? `다시 열림: ${String(a.payload.reason)}` : '완료 후 다시 열림', a.at)
    if (a.type === 'task.completed' && Number(a.payload.missingRequired ?? 0) > 0) push('missing_required', t, `중요 ${String(a.payload.missingRequired)}건 미체크 상태로 완료${a.payload.reason ? ` — ${String(a.payload.reason)}` : ''}`, a.at)
  }

  const lastActivity = new Map(lastActivityByTask)
  for (const a of activity) {
    if (!a.taskId) continue
    const prev = lastActivity.get(a.taskId)
    if (!prev || a.at > prev) lastActivity.set(a.taskId, a.at)
  }
  for (const t of tasks) {
    if (t.status === 'done') continue
    const running = durationDays(t.startedAt, undefined, now)
    if (running !== undefined && running >= LONG_TASK_DAYS) push('long_task', t, `${Math.floor(running)}일째 진행 중`, t.startedAt!)
    const last = lastActivity.get(t.id) ?? t.createdAt
    const idle = durationDays(last, undefined, now) ?? 0
    if (t.status !== 'on_hold' && idle >= STALE_DAYS) push('stale', t, `${Math.floor(idle)}일간 활동 없음`, last)
  }

  const supersededBy = new Map(files.filter((f) => f.previousId).map((f) => [f.previousId!, f]))
  for (const t of tasks) {
    if (t.status === 'done') continue
    for (const input of t.inputs) {
      const newer = supersededBy.get(input.fileId)
      if (newer) push('outdated_input', t, `${newer.name} v${newer.version - 1} 사용 중 (v${newer.version} 있음)`, input.selectedAt)
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export interface FeedbackDigestRow {
  assistantId: string
  assistantName: string
  count: number
  avgRating: number
  comments: Array<{ rating: number; comment: string; by: string; taskCode: string }>
}

export function feedbackDigest(tasks: Task[], assistants: Assistant[], users: User[]): FeedbackDigestRow[] {
  const userName = new Map(users.map((u) => [u.id, u.name]))
  return assistants
    .map((a): FeedbackDigestRow | null => {
      const rated = tasks.filter((t) => t.assistantId === a.id && t.feedback)
      if (rated.length === 0) return null
      return {
        assistantId: a.id,
        assistantName: a.name,
        count: rated.length,
        avgRating: avg(rated.map((t) => t.feedback!.rating)) ?? 0,
        comments: rated.map((t) => ({ rating: t.feedback!.rating, comment: t.feedback!.comment, by: userName.get(t.feedback!.by) ?? t.feedback!.by, taskCode: t.code })),
      }
    })
    .filter((r): r is FeedbackDigestRow => !!r)
    .sort((a, b) => b.count - a.count)
}

export function feedbackDigestMarkdown(rows: FeedbackDigestRow[]): string {
  return [
    '# assistant 피드백 다이제스트',
    '',
    ...rows.flatMap((r) => [
      `## ${r.assistantName} — ★ ${r.avgRating} (${r.count}건)`,
      ...r.comments.map((c) => `- ★${c.rating} ${c.comment || '(코멘트 없음)'} — ${c.by}, ${c.taskCode}`),
      '',
    ]),
  ].join('\n')
}
