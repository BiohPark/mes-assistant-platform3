import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { AssistantStatus, Priority, SrStatus, TaskStatus } from '@mes/domain'
import { ASSISTANT_STATUS_KEY, PRIORITY_CLASS, PRIORITY_KEY, SR_STATUS_KEY, TASK_STATUS_KEY } from '@/lib/labels'

const NEUTRAL = 'bg-tone-neutral-bg text-tone-neutral-fg'
const INFO = 'bg-tone-info-bg text-tone-info-fg'
const WARNING = 'bg-tone-warning-bg text-tone-warning-fg'
const SUCCESS = 'bg-tone-success-bg text-tone-success-fg'
const VIOLET = 'bg-tone-violet-bg text-tone-violet-fg'
const DANGER = 'bg-tone-danger-bg text-tone-danger-fg'

const TASK_STATUS_CLASS: Record<TaskStatus, string> = { todo: NEUTRAL, in_progress: INFO, on_hold: WARNING, done: SUCCESS }
const ASSISTANT_STATUS_CLASS: Record<AssistantStatus, string> = { open: SUCCESS, developing: WARNING, testing: INFO, retired: NEUTRAL }
const SR_STATUS_CLASS: Record<SrStatus, string> = {
  draft: NEUTRAL,
  submitted: VIOLET,
  reviewing: WARNING,
  in_progress: INFO,
  responded: 'bg-tone-teal-bg text-tone-teal-fg',
  done: SUCCESS,
  rejected: DANGER,
}

const base = 'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap'

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useT()
  return <span className={cn(base, TASK_STATUS_CLASS[status], className)}>{t(TASK_STATUS_KEY[status])}</span>
}

export function AssistantStatusBadge({ status, className }: { status: AssistantStatus; className?: string }) {
  const t = useT()
  return <span className={cn(base, ASSISTANT_STATUS_CLASS[status], className)}>{t(ASSISTANT_STATUS_KEY[status])}</span>
}

export function SrStatusBadge({ status, className }: { status: SrStatus; className?: string }) {
  const t = useT()
  return <span className={cn(base, SR_STATUS_CLASS[status], className)}>{t(SR_STATUS_KEY[status])}</span>
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const t = useT()
  return <span className={cn(base, PRIORITY_CLASS[priority], className)}>{t(PRIORITY_KEY[priority])}</span>
}
