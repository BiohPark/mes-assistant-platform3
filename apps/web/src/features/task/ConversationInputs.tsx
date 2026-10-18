import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TaskStatus } from '@mes/domain'
import type { ConversationCandidate } from '@/api/files'
import { formatSize } from '@/api/files'
import { listConversationInputs, refreshConversationInput, removeConversationInput, selectConversation } from '@/api/conversationInputs'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAnswerDetail } from '@/features/chat/useAnswerDetail'
import { inputSelection } from '@/api/inputSelection'
import { AttachToggle, UsedMark } from './AttachToggle'
import { ConversationPickerDialog } from './ConversationPickerDialog'

const TASK_STATUSES: readonly string[] = ['todo', 'in_progress', 'on_hold', 'done'] satisfies TaskStatus[]

/**
 * 자료함의 같은 태그 대화 — 파일처럼 [첨부] 한 번에 대화 전체(전체 원문)가 붙고, '첨부됨'을 다시 누르면 뺀다.
 * 범위 좁히기(메시지 선택·요약)는 선택 — 제목을 누르면 고른다. fresh는 방금 태그로 들어온 대화(tagShare)
 */
export function ConversationInputs({ taskId, candidates, disabled, fresh }: { taskId: string; candidates: ConversationCandidate[]; disabled: boolean; fresh?: ReadonlySet<string> }) {
  const saving = inputSelection(state => !!state.byTask[taskId]?.sending || (state.byTask[taskId]?.pending ?? 0) > 0)
  const t = useT()
  const locale = useLocale()
  const { detail } = useAnswerDetail()
  const selected = useQuery({ queryKey: ['conversation-inputs', taskId], queryFn: () => listConversationInputs(taskId) })
  const [target, setTarget] = useState<ConversationCandidate | null>(null)
  const selectedBySource = new Map((selected.data ?? []).map((item) => [item.input.sourceTaskId, item]))
  async function run(action: Promise<unknown>) {
    try { await action } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="space-y-2" data-testid="conversation-candidates">
    {selected.isError && <div role="alert">{t('task.inputs.loadFailed')} <button type="button" className="underline" onClick={() => void selected.refetch()}>{t('common.retry')}</button></div>}
    {!candidates.length && <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{t('task.inputs.noneAvailable')}</div>}
    {candidates.map((candidate) => {
      const current = selectedBySource.get(candidate.taskId)
      const isFresh = !!fresh?.has(candidate.taskId)
      return <div key={candidate.taskId} className={cn('rounded-xl border p-2', isFresh && 'border-tone-info-fg/40 bg-tone-info-bg')} data-testid={`conversation-${candidate.taskId}`} data-fresh={isFresh ? 'true' : undefined}>
        <div className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={t('task.inputs.narrow')} onClick={() => setTarget(candidate)}>
          <span className="font-mono text-muted-foreground">{candidate.code}</span> · {candidate.title}</button>
          {isFresh && <span className="shrink-0 text-[11px] text-tone-info-fg">{t('task.materials.fresh')}</span>}
          {candidate.used && <UsedMark />}
          <AttachToggle inputLabels attached={!!current} label={candidate.code} disabled={disabled || saving || (!current && !candidate.messageCount)}
            onToggle={() => void run(current ? removeConversationInput(taskId, candidate.taskId) : selectConversation(taskId, candidate.taskId, { mode: 'full' }))} /></div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span className="rounded-full border px-1.5" style={{ borderColor: candidate.assistant.color }}>{candidate.assistant.name}</span>
          {TASK_STATUSES.includes(candidate.status) && <span>· {t(`status.task.${candidate.status as TaskStatus}`)}</span>}<span>{t('task.inputs.messages', { count: current?.messageCount ?? candidate.messageCount })}</span><span>· {formatSize(detail === 'full' ? current?.bytesFull ?? candidate.bytesFull ?? current?.bytes ?? candidate.bytes : current?.bytes ?? candidate.bytes)}</span>
          {candidate.lastActivityAt && <time dateTime={candidate.lastActivityAt}>{new Date(candidate.lastActivityAt).toLocaleString(locale)}</time>}
          {candidate.sharedTags.map((value) => <span key={value} className="rounded-full bg-muted px-1">{value}</span>)}
          {current?.detached && <span>{t('task.inputs.detached')}</span>}
          {current && <span>· {current.snapshot.mode === 'summary' ? t('task.inputs.modeSummary') : current.snapshot.mode === 'messages' ? t('task.inputs.modeMessages') : t('task.inputs.modeFull')}</span>}
          {!!current?.newMessages && <button type="button" className="ml-auto underline" disabled={disabled} onClick={() => current.snapshot.mode === 'full' ? void run(refreshConversationInput(taskId, candidate.taskId)) : setTarget(candidate)}>{t('task.inputs.newMessages', { count: current.newMessages })}</button>}
        </div>
      </div>
    })}
    {target && <ConversationPickerDialog taskId={taskId} candidate={target} current={selectedBySource.get(target.taskId)} onClose={() => setTarget(null)} />}
  </div>
}
