import type { Task, TaskSummary } from '@mes/domain'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { useConversationUnread } from '@/lib/conversationRead'
import { isTaskStalled, useServerClockOffset } from '@/features/task/progress'

/** Summary views use only list fields, without material or message lookups. */
export function StalledIndicator({ task, className }: { task: Pick<TaskSummary, 'status' | 'lastActivityAt'>; className?: string }) {
  const t = useT()
  const offset = useServerClockOffset(task.status === 'in_progress')
  if (offset === undefined || !isTaskStalled(task, Date.now() + offset)) return null
  return <Badge tone="warning" data-task-stalled title={t('task.progress.stalledHint')} className={className}><Clock aria-hidden className="size-3 shrink-0" />{t('task.progress.stalled')}</Badge>
}
/** The legacy hook reads only id and lastActivityAt. Keep its shared in-memory
 * fallback and subscriptions when passing the lightweight list projection. */
export function useListUnread(task: Pick<TaskSummary, 'id' | 'lastActivityAt'>, userId: string) {
  return useConversationUnread(task as Task, userId)
}
