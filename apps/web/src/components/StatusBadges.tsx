import { useT } from '@/i18n'
import { Badge, type BadgeTone } from './ui/badge'
import type { AssistantStatus, Priority, SrStatus, TaskStatus } from '@mes/domain'
import { ASSISTANT_STATUS_KEY, PRIORITY_KEY, SR_STATUS_KEY, TASK_STATUS_KEY } from '@/lib/labels'

const TASK_TONE: Record<TaskStatus, BadgeTone> = { todo: 'neutral', in_progress: 'info', on_hold: 'warning', done: 'success' }
const ASSISTANT_TONE: Record<AssistantStatus, BadgeTone> = { open: 'success', developing: 'warning', testing: 'info', retired: 'neutral' }
const PRIORITY_TONE: Record<Priority, BadgeTone> = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger' }
const SR_TONE: Record<SrStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'violet',
  reviewing: 'warning',
  in_progress: 'info',
  responded: 'teal',
  done: 'success',
  rejected: 'danger',
}

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useT()
  return <Badge tone={TASK_TONE[status]} className={className}>{t(TASK_STATUS_KEY[status])}</Badge>
}

export function AssistantStatusBadge({ status, className }: { status: AssistantStatus; className?: string }) {
  const t = useT()
  return <Badge tone={ASSISTANT_TONE[status]} className={className}>{t(ASSISTANT_STATUS_KEY[status])}</Badge>
}

export function SrStatusBadge({ status, className }: { status: SrStatus; className?: string }) {
  const t = useT()
  return <Badge tone={SR_TONE[status]} className={className}>{t(SR_STATUS_KEY[status])}</Badge>
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const t = useT()
  return <Badge tone={PRIORITY_TONE[priority]} className={className}>{t(PRIORITY_KEY[priority])}</Badge>
}
