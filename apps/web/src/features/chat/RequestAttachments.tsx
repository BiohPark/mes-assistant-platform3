import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { budgetLevel, type RequestInput, type Task } from '@mes/domain'
import { setInput, getCandidates, formatSize } from '@/api/files'
import { listConversationInputs, removeConversationInput, setConversationWeight } from '@/api/conversationInputs'
import { useActor } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RequestEstimateState } from './useRequestEstimate'
import type { AttachmentChip } from './Composer'
import { ConversationPickerDialog } from '@/features/task/ConversationPickerDialog'
import { setSrInput } from '@/features/task/srInputs'
import { useBudgetBubble } from '@/features/assistant-pill/bubbles'
import { useT } from '@/i18n'

const delivery = { attached: 'chat.delivery.attached', inline: 'chat.delivery.inline', metadata_only: 'chat.delivery.metadata_only', failed: 'chat.delivery.failed' } as const
const mode = { full: 'task.inputs.modeFull', messages: 'task.inputs.modeMessages', summary: 'task.inputs.modeSummary' } as const
/** s14-sr-body-once 서버의 SR 본문 첨부(kind 'sr') — 이 브랜치의 RequestInput 유니온에 아직 없어 모양만 읽는다 */
type SrInput = { kind: 'sr'; srId: string; code: string; title: string }

async function run(action: Promise<unknown>) {
  try { await action } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
}

/** 입력창 위 첨부 칩 — 추정(estimate)의 inputs, 즉 전송과 같은 조립 결과에서 만든다(보낸 것 = 본 것). srs는 연결 메타라 칩이 아니다 */
export function useRequestAttachments(task: Task, estimate: RequestEstimateState): AttachmentChip[] {
  const t = useT()
  const actor = useActor()
  const disabled = task.status === 'done'
  const busy = estimate.revisionChanged
  return (estimate.data?.inputs ?? []).map((input: RequestInput | SrInput): AttachmentChip => {
    if (input.kind === 'file') return { key: `file:${input.fileId}`, kind: 'file', label: input.name, title: `${input.name} v${input.version} · ${t(delivery[input.delivery])}`,
      danger: input.delivery === 'failed', main: input.weight === 'main', disabled, busy,
      onToggleMain: () => void run(setInput(actor, task.id, input.fileId, input.weight === 'main' ? 'reference' : 'main')),
      onRemove: () => void run(setInput(actor, task.id, input.fileId, null)) }
    if (input.kind === 'conversation') return { key: `conversation:${input.sourceTaskId}`, kind: 'conversation', label: input.code, title: `${input.title} · ${t(mode[input.mode])}`,
      main: input.weight === 'main', disabled, busy,
      onToggleMain: () => void run(setConversationWeight(task.id, input.sourceTaskId, input.weight === 'main' ? 'reference' : 'main')),
      onRemove: () => void run(removeConversationInput(task.id, input.sourceTaskId)) }
    return { key: `sr:${input.srId}`, kind: 'sr', label: input.code, title: input.title, disabled, busy, onRemove: () => void run(setSrInput(task.id, input.srId, false)) }
  })
}

/** 요청 크기 — 한도 근처(warn)에서만 작게, 넘으면(over) 경고와 조절 동작. 전송 차단은 Composer의 blockedReason이 맡는다 */
export function RequestSizeNotice({ task, estimate }: { task: Task; estimate: RequestEstimateState }) {
  const t = useT()
  const actor = useActor()
  const ref = useRef<HTMLDivElement>(null)
  const [adjust, setAdjust] = useState<{ taskId: string; mode: 'messages' | 'summary' } | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id), enabled: !!adjust })
  const selected = useQuery({ queryKey: ['conversation-inputs', task.id], queryFn: () => listConversationInputs(task.id), enabled: !!adjust })
  const { data: info, pending } = estimate
  const level = info ? budgetLevel(info.bytes, info.limitBytes) : 'ok'
  // 도우미 말풍선(U6) — 레벨이 올라갈 때 1회(추정 로딩 중에는 비교하지 않음), 누르면 이 안내로 포커스
  useBudgetBubble(task.id, info ? level : undefined, () => ref.current?.focus())
  if (!info || level === 'ok') return null
  const over = level === 'over'
  const inputs = info.inputs
  const largest = inputs.filter((item) => item.kind === 'conversation').sort((a, b) => b.bytes - a.bytes)[0]
  const current = selected.data?.find((item) => item.input.sourceTaskId === adjust?.taskId)
  const candidate = candidates.data?.conversations.find((item) => item.taskId === adjust?.taskId) ?? (current ? {
    taskId: current.source.taskId, code: current.source.code, title: current.source.title, status: '', assistant: current.source.assistant,
    sharedTags: [], messageCount: current.messageCount, bytes: current.bytes, lastActivityAt: '',
  } : undefined)
  const params = new URLSearchParams({ ref: task.id })
  for (const tag of task.tags ?? []) params.append('tag', tag)
  const done = task.status === 'done'
  const first = inputs[0]
  function removeFirst() {
    if (!first) return
    if (first.kind === 'file') void run(setInput(actor, task.id, first.fileId, null))
    else if (first.kind === 'conversation') void run(removeConversationInput(task.id, first.sourceTaskId))
    else void run(setSrInput(task.id, (first as SrInput).srId, false))
  }
  return <div ref={ref} tabIndex={-1} role={over ? 'alert' : 'status'} aria-busy={pending} className={cn('mb-1.5 rounded-lg px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', over && 'border border-destructive/40')}>
    <div className="flex flex-wrap items-center gap-2">
      {over && <AlertTriangle className="size-3.5 text-destructive" />}
      <span className={over ? 'text-destructive' : 'text-tone-warning-fg'}>{t(over ? 'chat.overLimitAlert' : 'chat.nearLimit')}</span>
      <div role="meter" aria-label={t('chat.requestSize')} aria-valuemin={0} aria-valuemax={info.limitBytes} aria-valuenow={info.bytes} className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', over ? 'bg-destructive' : 'bg-tone-warning-fg')} style={{ width: `${Math.min(100, Math.round(info.bytes / info.limitBytes * 100))}%` }} />
      </div>
      <span className="text-muted-foreground">{pending ? t('chat.calculating') : t('chat.sizeEstimate', { bytes: formatSize(info.bytes), limit: formatSize(info.limitBytes) })}</span>
    </div>
    {over && <div className="mt-1.5 flex flex-wrap gap-1">
      {first && <Button size="xs" variant="outline" disabled={done} onClick={removeFirst}>{t('chat.removeInput')}</Button>}
      {largest && <><Button size="xs" variant="outline" disabled={done} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'messages' })}>{t('chat.selectMessageRange')}</Button>
        <Button size="xs" variant="outline" disabled={done} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'summary' })}>{t('chat.makeSummary')}</Button></>}
      <Button size="xs" variant="outline" asChild><a href={`/new/${task.assistantId}?${params}`}>{t('chat.continueInNew')}</a></Button>
    </div>}
    {candidate && !selected.isPending && <ConversationPickerDialog key={`${candidate.taskId}:${adjust?.mode}`} taskId={task.id} candidate={candidate} current={current}
      initialMode={adjust?.mode} onClose={() => setAdjust(null)} />}
  </div>
}
