import { cn } from '@/lib/utils'
import type { AssistantStatus, Priority, SrStatus, TaskStatus } from '@mes/domain'
import { ASSISTANT_STATUS_LABEL, PRIORITY_CLASS, PRIORITY_LABEL, SR_STATUS_LABEL, TASK_STATUS_LABEL } from '@/lib/labels'

const SLATE = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
const BLUE = 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
const AMBER = 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
const EMERALD = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
const VIOLET = 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
const RED = 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'

const TASK_STATUS_CLASS: Record<TaskStatus, string> = { todo: SLATE, in_progress: BLUE, on_hold: AMBER, done: EMERALD }
const ASSISTANT_STATUS_CLASS: Record<AssistantStatus, string> = { open: EMERALD, developing: AMBER, testing: BLUE, retired: SLATE }
const SR_STATUS_CLASS: Record<SrStatus, string> = {
  draft: SLATE,
  submitted: VIOLET,
  reviewing: AMBER,
  in_progress: BLUE,
  responded: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  done: EMERALD,
  rejected: RED,
}

const base = 'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap'

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return <span className={cn(base, TASK_STATUS_CLASS[status], className)}>{TASK_STATUS_LABEL[status]}</span>
}

export function AssistantStatusBadge({ status, className }: { status: AssistantStatus; className?: string }) {
  return <span className={cn(base, ASSISTANT_STATUS_CLASS[status], className)}>{ASSISTANT_STATUS_LABEL[status]}</span>
}

export function SrStatusBadge({ status, className }: { status: SrStatus; className?: string }) {
  return <span className={cn(base, SR_STATUS_CLASS[status], className)}>{SR_STATUS_LABEL[status]}</span>
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return <span className={cn(base, PRIORITY_CLASS[priority], className)}>{PRIORITY_LABEL[priority]}</span>
}
