import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, FileText, MessagesSquare, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { budgetLevel, type RequestInput, type Task } from '@mes/domain'
import { setInput, getCandidates, formatSize } from '@/api/files'
import { listConversationInputs, removeConversationInput, setConversationWeight } from '@/api/conversationInputs'
import { useActor } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RequestEstimateState } from './useRequestEstimate'
import { ConversationPickerDialog } from '@/features/task/ConversationPickerDialog'
import { useT } from '@/i18n'

const delivery = { attached: 'chat.deliveryShort.attached', inline: 'chat.deliveryShort.inline', metadata_only: 'chat.deliveryShort.metadata_only', failed: 'chat.deliveryShort.failed' } as const
const label = (input: RequestInput) => input.kind === 'file' ? input.name : input.code

export function ContextTray({ task, estimate }: { task: Task; estimate: RequestEstimateState }) {
  const t = useT()
  const actor = useActor()
  const [open, setOpen] = useState<boolean>()
  const [adjust, setAdjust] = useState<{ taskId: string; mode: 'messages' | 'summary' } | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id), enabled: !!adjust })
  const selected = useQuery({ queryKey: ['conversation-inputs', task.id], queryFn: () => listConversationInputs(task.id), enabled: !!adjust })
  const { data: info, pending, revisionChanged } = estimate
  const inputs = info?.inputs ?? []
  const level = info ? budgetLevel(info.bytes, info.limitBytes) : 'ok'
  const expanded = open ?? true
  if (!info || (!inputs.length && level === 'ok')) return null

  async function change(input: RequestInput, weight: 'main' | 'reference' | null) {
    try {
      if (input.kind === 'file') await setInput(actor, task.id, input.fileId, weight)
      else if (weight) await setConversationWeight(task.id, input.sourceTaskId, weight)
      else await removeConversationInput(task.id, input.sourceTaskId)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const params = new URLSearchParams({ ref: task.id })
  for (const tag of task.tags ?? []) params.append('tag', tag)
  const newConversationUrl = `/new/${task.assistantId}?${params}`
  const largest = inputs.filter((item) => item.kind === 'conversation').sort((a, b) => b.bytes - a.bytes)[0]
  const current = selected.data?.find((item) => item.input.sourceTaskId === adjust?.taskId)
  const candidate = candidates.data?.conversations.find((item) => item.taskId === adjust?.taskId) ?? (current ? {
    taskId: current.source.taskId, code: current.source.code, title: current.source.title, status: '', assistant: current.source.assistant,
    sharedTags: [], messageCount: current.messageCount, bytes: current.bytes, lastActivityAt: '',
  } : undefined)
  return <div className="border-t bg-muted/20 px-2.5 py-2" aria-label={t('chat.trayLabel')} aria-busy={pending}>
    <button type="button" className="flex w-full items-center gap-2 text-left text-xs" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
      <span className="font-medium">{t('chat.trayInputs', { count: inputs.length })}</span>
      <span className="ml-auto text-muted-foreground">{pending ? t('chat.calculating') : t('chat.trayEstimate', { bytes: formatSize(info.bytes), limit: formatSize(info.limitBytes) })}</span>
      <ChevronDown className={cn('size-3.5', expanded && 'rotate-180')} />
    </button>
    <div role="meter" aria-label={t('chat.requestSize')} aria-valuemin={0} aria-valuemax={info.limitBytes} aria-valuenow={info.bytes}
      className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full', level === 'over' ? 'bg-destructive' : level === 'warn' ? 'bg-tone-warning-fg' : 'bg-primary')}
        style={{ width: `${Math.min(100, Math.round(info.bytes / info.limitBytes * 100))}%` }} /></div>
    {expanded && <p className="mt-1 text-xs text-muted-foreground">{t('chat.trayPersistHint')}</p>}
    {expanded && <ul className={cn('mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto', revisionChanged && 'opacity-60')} aria-busy={revisionChanged}>{inputs.map((input) => <li key={input.kind === 'file' ? input.fileId : input.sourceTaskId}
      className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-xs">
      <button type="button" disabled={task.status === 'done'} aria-label={t('chat.toggleMain', { name: label(input) })}
        onClick={() => void change(input, input.weight === 'main' ? 'reference' : 'main')}><Star className={cn('size-3', input.weight === 'main' && 'fill-tone-warning-fg text-tone-warning-fg')} /></button>
      {input.kind === 'file' ? <FileText className="size-3" /> : <MessagesSquare className="size-3" />}
      <span className="truncate">{label(input)}</span>
      <span className="rounded-full border px-1">{input.kind === 'file' ? t(delivery[input.delivery]) : input.mode === 'summary' ? t('chat.summary') : t('chat.messages', { count: input.messageCount })}</span>
      {task.status !== 'done' && <button type="button" aria-label={t('chat.removeFromRequest', { name: label(input) })} onClick={() => void change(input, null)}><X className="size-3" /></button>}
    </li>)}</ul>}
    {level === 'over' && <div role="alert" className="mt-2 rounded-xl border border-destructive/40 p-2 text-xs">
      <p className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" /> {t('chat.overLimitAlert')}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {inputs[0] && <Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => void change(inputs[0]!, null)}>{t('chat.removeInput')}</Button>}
        {largest && <><Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'messages' })}>{t('chat.selectMessageRange')}</Button>
          <Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'summary' })}>{t('chat.makeSummary')}</Button></>}
        <Button size="xs" variant="outline" asChild><a href={newConversationUrl}>{t('chat.continueInNew')}</a></Button>
      </div>
    </div>}
    {candidate && !selected.isPending && <ConversationPickerDialog key={`${candidate.taskId}:${adjust?.mode}`} taskId={task.id} candidate={candidate} current={current}
      initialMode={adjust?.mode} onClose={() => setAdjust(null)} />}
  </div>
}
