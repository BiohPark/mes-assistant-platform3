import type { Task } from '@mes/domain'
import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { isTaskStalled, useServerClockOffset } from './progress'

export function StalledBadge({ task, className }: { task: Task; className?: string }) {
  const t = useT()
  const offset = useServerClockOffset(task.status === 'in_progress')
  if (offset === undefined || !isTaskStalled(task, Date.now() + offset)) return null
  return <Badge tone="warning" data-task-stalled title={t('task.progress.stalledHint')} className={className}>
    <Clock aria-hidden className="size-3 shrink-0" />{t('task.progress.stalled')}
  </Badge>
}
