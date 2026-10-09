import { useT, type TranslationKey } from '@/i18n'
import { ArrowRightLeft, ArrowUpDown, Bot, CircleAlert, CircleCheck, CirclePlus, CircleX, ClipboardPlus, Cpu, FileInput, FileMinus, History, ListChecks, MessageSquareX, MessageSquarePlus, MessagesSquare, Pause, Pencil, Play, RefreshCw, RotateCcw, Send, Settings2, Share2, Sparkles, Square, SquareCheck, Star, StickyNote, Tag, Upload, X, type LucideIcon } from 'lucide-react'
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

// The API also records request lifecycle events outside the domain's ActivityType.
type PanelActivityType = ActivityLog['type'] | `request.${'started' | 'completed' | 'cancelled' | 'failed'}`

const ACTIVITY_LABEL_KEY = {
  ...ACTIVITY_KEY,
  'request.started': 'task.activity.request.started',
  'request.completed': 'task.activity.request.completed',
  'request.cancelled': 'task.activity.request.cancelled',
  'request.failed': 'task.activity.request.failed',
} as const satisfies Record<PanelActivityType, TranslationKey>

const HIGHLIGHT: Partial<Record<ActivityLog['type'], string>> = {
  'task.reopened': 'text-tone-warning-fg',
  'task.hold': 'text-tone-warning-fg',
  'task.completed': 'text-tone-success-fg',
  'input.selected': 'text-tone-violet-fg',
  'input.removed': 'text-tone-neutral-fg',
  'tag.added': 'text-tone-info-fg',
  'sr.task_started': 'text-tone-info-fg',
}

const ACTIVITY_ICON: Record<PanelActivityType, LucideIcon> = {
  'task.created': CirclePlus,
  'task.started': Play,
  'task.completed': CircleCheck,
  'task.reopened': RotateCcw,
  'task.hold': Pause,
  'task.status_changed': ArrowRightLeft,
  'checklist.checked': SquareCheck,
  'checklist.unchecked': Square,
  'checklist.reviewed': ListChecks,
  'file.uploaded': Upload,
  'file.tagged_output': Sparkles,
  'input.selected': FileInput,
  'input.removed': FileMinus,
  'context.selected': MessagesSquare,
  'context.removed': MessageSquareX,
  'context.refreshed': RefreshCw,
  'note.added': StickyNote,
  'message.sent': Send,
  'thread.created': MessageSquarePlus,
  'model.changed': Cpu,
  'feedback.given': Star,
  'tag.added': Tag,
  'tag.removed': X,
  'assistant.created': Bot,
  'assistant.updated': Pencil,
  'assistant.status_changed': Settings2,
  'assistant.reordered': ArrowUpDown,
  'sr.created': ClipboardPlus,
  'sr.submitted': Send,
  'sr.status_changed': ArrowRightLeft,
  'sr.task_started': Play,
  'sr.result_shared': Share2,
  'request.started': Play,
  'request.completed': CircleCheck,
  'request.cancelled': CircleX,
  'request.failed': CircleAlert,
}

export function ActivityPanel({ activity }: ActivityPanelProps) {
  const { formatDateTime } = useDates()
  const t = useT()
  const users = useUserMap()
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 text-right text-[11px] text-muted-foreground">{t('task.activity.count', { count: activity.length })}</div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {activity.map((a) => {
          const user = users.get(a.userId)
          const detail = describeActivity(a)
          const Icon = ACTIVITY_ICON[a.type] ?? History
          const labelKey = ACTIVITY_LABEL_KEY[a.type]
          return (
            <li key={a.id} className="flex gap-2 border-l-2 py-1.5 pl-2.5">
              <UserAvatar user={user} size="xs" className="mt-0.5" />
              <div className="min-w-0 flex-1 text-xs leading-snug">
                <span className="font-medium">{user?.name ?? t('task.activity.system')}</span> <Icon aria-hidden="true" focusable="false" className={cn('mr-1 inline size-3 align-text-bottom', HIGHLIGHT[a.type] ?? 'text-muted-foreground')} /><span className={cn(HIGHLIGHT[a.type])}>{t(labelKey ?? 'task.activity.other')}</span>
                {detail && <div className="truncate text-muted-foreground">{detail}</div>}
                <div className="text-xs text-muted-foreground/80">{formatDateTime(a.at)}</div>
              </div>
            </li>
          )
        })}
        {activity.length === 0 && <li className="p-4 text-center text-xs text-muted-foreground">{t('task.activity.empty')}</li>}
      </ol>
    </div>
  )
}
