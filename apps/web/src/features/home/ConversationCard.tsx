import { useT } from '@/i18n'
import { Link } from 'react-router'
import { CalendarClock, FileInput, MoreHorizontal, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TaskStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { AvatarGroup } from '@/components/UserAvatar'
import { useUserMap } from '@/app/hooks'
import { primarySrTag, srTagColor, TASK_STATUSES, type Task, type TaskStatus } from '@mes/domain'
import { daysUntil, useDates } from '@/lib/dates'
import { TASK_STATUS_KEY } from '@/lib/labels'
import { cn } from '@/lib/utils'

const MAX_TAGS = 3

interface ConversationCardProps {
  task: Task
  onTagClick: (tag: string) => void
  /** 완료로 바꾸는 것은 완료 절차(리포트·피드백)가 있어 대화 화면에서만 한다 */
  onStatusChange?: (status: TaskStatus) => void
}

/**
 * 칸반 카드 = 대화 하나. SR 태그가 있으면 좌측에 가는 SR 색 선만 둔다(무지개 방지).
 * stretched-link + z-10 액션 패턴으로 <a> 중첩을 피한다.
 */
export function ConversationCard({ task, onTagClick, onStatusChange }: ConversationCardProps) {
  const { formatRelative } = useDates()
  const t = useT()
  const users = useUserMap()
  const sr = primarySrTag(task.tags)
  const daysLeft = daysUntil(task.dueDate)
  const overdue = task.status !== 'done' && daysLeft !== undefined && daysLeft < 0
  const extraTags = task.tags.length - MAX_TAGS

  return (
    <div
      className={cn('group relative rounded-xl border bg-card p-2.5 shadow-xs transition hover:shadow-md', task.status === 'done' && 'opacity-70')}
      style={{ borderLeftColor: sr ? srTagColor(sr) : undefined, borderLeftWidth: sr ? 3 : undefined }}
    >
      <Link to={`/c/${task.id}`} className="absolute inset-0 rounded-xl" aria-label={t('hub.openConversation', { code: task.code, title: task.title })} />
      <div className="pointer-events-none flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{task.code}</span>
        <TaskStatusBadge status={task.status} className="h-5 px-1.5 text-[11px]" />
        {task.titleSource === 'ai' && <Sparkles className="size-2.5 text-violet-500" aria-label={t('hub.aiTitle')} />}
        <span className="ml-auto">{formatRelative(task.lastActivityAt)}</span>
      </div>
      <div className="pointer-events-none mt-1 line-clamp-2 text-[13px] leading-snug font-medium">{task.title}</div>
      {task.tags.length > 0 && (
        <div className="relative z-10 mt-1.5 flex flex-wrap gap-1">
          {task.tags.slice(0, MAX_TAGS).map((t) => (
            <TagChip key={t} tag={t} size="xs" onClick={onTagClick} />
          ))}
          {extraTags > 0 && <span className="text-[11px] text-muted-foreground">+{extraTags}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="pointer-events-none">
          <AvatarGroup users={[task.ownerId, ...task.assigneeIds.filter((id) => id !== task.ownerId)].map((id) => users.get(id))} max={3} />
        </span>
        {task.inputs.length > 0 && (
          <span className="pointer-events-none inline-flex items-center gap-0.5" title={t('hub.selectedInputs')}>
            <FileInput className="size-3" />
            {task.inputs.length}
          </span>
        )}
        {task.dueDate && task.status !== 'done' && (
          <span className={cn('pointer-events-none inline-flex items-center gap-0.5', overdue && 'font-medium text-red-600')}>
            <CalendarClock className="size-3" />
            {daysLeft !== undefined && (daysLeft < 0 ? t('hub.daysOverdue', { days: -daysLeft }) : daysLeft === 0 ? t('hub.today') : `D-${daysLeft}`)}
          </span>
        )}
        {onStatusChange && task.status !== 'done' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="relative z-10 ml-auto opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t('hub.changeStatus')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">{t('hub.status')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={task.status} onValueChange={(v) => onStatusChange(v as TaskStatus)}>
                {TASK_STATUSES.filter((s) => s !== 'done').map((s) => (
                  <DropdownMenuRadioItem key={s} value={s} className="text-xs">
                    {t(TASK_STATUS_KEY[s])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
