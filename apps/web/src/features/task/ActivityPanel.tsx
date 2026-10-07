import { useT } from '@/i18n'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserMap } from '@/app/hooks'
import type { ActivityLog } from '@mes/domain'
import { ACTIVITY_KEY } from '@/lib/labels'
import { describeActivity } from '@/lib/activity'
import { useDates } from '@/lib/dates'
import { cn } from '@/lib/utils'

interface ActivityPanelProps {
  activity: ActivityLog[]
}

const HIGHLIGHT: Partial<Record<ActivityLog['type'], string>> = {
  'task.reopened': 'text-amber-600',
  'task.hold': 'text-amber-600',
  'task.completed': 'text-emerald-700',
  'input.selected': 'text-violet-700',
  'input.removed': 'text-slate-500',
  'tag.added': 'text-blue-700',
  'sr.task_started': 'text-blue-700',
}

export function ActivityPanel({ activity }: ActivityPanelProps) {
  const { formatDateTime } = useDates()
  const t = useT()
  const users = useUserMap()
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 text-right text-[11px] text-muted-foreground">{activity.length}건</div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {activity.map((a) => {
          const user = users.get(a.userId)
          const detail = describeActivity(a)
          return (
            <li key={a.id} className="flex gap-2 border-l-2 py-1.5 pl-2.5">
              <UserAvatar user={user} size="xs" className="mt-0.5" />
              <div className="min-w-0 flex-1 text-xs leading-snug">
                <span className="font-medium">{user?.name ?? '시스템'}</span> <span className={cn(HIGHLIGHT[a.type])}>{(ACTIVITY_KEY[a.type] ? t(ACTIVITY_KEY[a.type]) : a.type)}</span>
                {detail && <div className="truncate text-muted-foreground">{detail}</div>}
                <div className="text-xs text-muted-foreground/80">{formatDateTime(a.at)}</div>
              </div>
            </li>
          )
        })}
        {activity.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">이력이 없습니다.</li>}
      </ol>
    </div>
  )
}
