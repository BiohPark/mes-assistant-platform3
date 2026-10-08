import { useT } from '@/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
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


/** Compact data badges with the full values available on hover and keyboard focus. */
export function IoBadges({ inputs, outputs, compact = false }: { inputs: string[]; outputs: string[]; compact?: boolean }) {
  const t = useT()
  return <div className="flex min-w-0 items-center gap-2 text-xs">
    {([['inputs', inputs], ['outputs', outputs]] as const).map(([kind, values]) => <Tooltip key={kind}>
      <TooltipTrigger asChild><span tabIndex={0} className="inline-flex min-w-0 items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t(kind === 'inputs' ? 'hub.inputs' : 'hub.outputs')}: ${values.join(', ') || t('hub.noIo')}`}>
        <span className="shrink-0 text-muted-foreground">{t(kind === 'inputs' ? 'hub.inputs' : 'hub.outputs')}</span>
        {compact ? <span className="truncate">{values.join(', ') || t('hub.noIo')}</span> : <>
          {values.slice(0, 2).map((value, index) => <Badge key={`${index}-${value}`} tone="neutral" className="max-w-24 truncate">{value}</Badge>)}
          {values.length > 2 && <Badge tone="neutral">+{values.length - 2}</Badge>}
          {!values.length && <span className="text-muted-foreground">{t('hub.noIo')}</span>}
        </>}
      </span></TooltipTrigger>
      <TooltipContent>{values.join(', ') || t('hub.noIo')}</TooltipContent>
    </Tooltip>)}
  </div>
}
