import type { TaskSummary } from '@mes/domain'

export const GROUPINGS = ['due', 'status', 'assistant', 'sr'] as const
export type WorkGrouping = typeof GROUPINGS[number]
export const DUE_BUCKETS = ['overdue', 'today', 'week', 'later', 'none'] as const
export function dueBucket(dueDate?: string, now = new Date()): typeof DUE_BUCKETS[number] {
  if (!dueDate) return 'none'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const date = new Date(`${dueDate.slice(0, 10)}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return 'none'
  if (date < today) return 'overdue'
  if (+date === +today) return 'today'
  const sunday = new Date(today)
  sunday.setDate(today.getDate() + (7 - (today.getDay() || 7)))
  return date <= sunday ? 'week' : 'later'
}
export function groupWork(tasks: TaskSummary[], by: WorkGrouping, now = new Date()) {
  const groups = new Map<string, TaskSummary[]>()
  if (by === 'due') for (const key of DUE_BUCKETS) groups.set(key, [])
  for (const task of tasks) {
    const keys = by === 'due' ? [dueBucket(task.dueDate, now)] : by === 'status' ? [task.status] : by === 'assistant' ? [task.assistantId] : task.linkedSrCodes?.length ? [...new Set(task.linkedSrCodes)] : ['none']
    for (const key of keys) {
      const group = groups.get(key)
      if (group) group.push(task)
      else groups.set(key, [task])
    }
  }
  return [...groups].map(([key, items]) => ({ key, items }))
}
