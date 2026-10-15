import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationCandidate } from '@/api/files'
import { formatSize } from '@/api/files'
import { listConversationInputs, refreshConversationInput, removeConversationInput, setConversationWeight, type LoadedConversationInput } from '@/api/conversationInputs'
import { Badge } from '@/components/ui/badge'
import { useLocale, useT } from '@/i18n'
import { StagedToggle } from './InputToggle'
import { ConversationPickerDialog } from './ConversationPickerDialog'

export function ConversationInputs({ taskId, candidates, disabled, selectedOnly = false }: { taskId: string; candidates: ConversationCandidate[]; disabled: boolean; selectedOnly?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const selected = useQuery({ queryKey: ['conversation-inputs', taskId], queryFn: () => listConversationInputs(taskId) })
  const [target, setTarget] = useState<ConversationCandidate | null>(null)
  const selectedBySource = new Map((selected.data ?? []).map((item) => [item.input.sourceTaskId, item]))
  const available = selectedOnly ? (selected.data ?? []).map((item) => candidates.find((candidate) => candidate.taskId === item.input.sourceTaskId) ?? {
    taskId: item.input.sourceTaskId, code: item.source.code, title: item.source.title, status: '', assistant: item.source.assistant,
    sharedTags: [], messageCount: item.messageCount, bytes: item.bytes, lastActivityAt: '',
  }) : candidates
  async function change(candidate: ConversationCandidate, current: LoadedConversationInput | undefined, weight: 'main' | 'reference' | null) {
    try {
      if (current) {
        if (weight) await setConversationWeight(taskId, candidate.taskId, weight)
        else await removeConversationInput(taskId, candidate.taskId)
      } else if (weight) setTarget(candidate)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  async function refresh(candidate: ConversationCandidate) {
    try { await refreshConversationInput(taskId, candidate.taskId) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="space-y-2" data-testid={selectedOnly ? 'selected-conversations' : 'conversation-candidates'}>
    {selected.isError && <div role="alert">{t('task.inputs.loadFailed')} <button type="button" className="underline" onClick={() => void selected.refetch()}>{t('common.retry')}</button></div>}
    {!available.length && <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{selectedOnly ? t('task.inputs.noneSelected') : t('task.inputs.noneAvailable')}</div>}
    {available.map((candidate) => {
      const current = selectedBySource.get(candidate.taskId)
      return <div key={candidate.taskId} className="rounded-xl border p-2" data-testid={`conversation-${candidate.taskId}`}>
        <div className="flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setTarget(candidate)}>
          <span className="font-mono text-muted-foreground">{candidate.code}</span> · {candidate.title}</button>
          {!selectedOnly && candidate.used && <Badge tone="success" title={t('task.materials.usedTitle')}>{t('task.materials.used')}</Badge>}
          {selectedOnly && current ? <><button type="button" className="rounded-lg border px-2 py-1" disabled={disabled} aria-label={t('task.inputs.adjustLabel', { code: candidate.code })} onClick={() => setTarget(candidate)}>{t('task.inputs.adjust')}</button><StagedToggle weight={current.input.weight} label={candidate.code} disabled={disabled} onChange={(weight) => void change(candidate, current, weight)} /></>
            : <button type="button" className="shrink-0 rounded-lg border px-2 py-1" disabled={disabled || !candidate.messageCount} aria-label={t('task.materials.addConversation', { code: candidate.code })} onClick={() => setTarget(candidate)}>{current ? t('task.materials.added') : t('task.materials.add')}</button>}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span className="rounded-full border px-1.5" style={{ borderColor: candidate.assistant.color }}>{candidate.assistant.name}</span><span>· {candidate.status}</span><span>{t('task.inputs.messages', { count: current?.messageCount ?? candidate.messageCount })}</span><span>· {formatSize(current?.bytes ?? candidate.bytes)}</span>
          {candidate.lastActivityAt && <time dateTime={candidate.lastActivityAt}>{new Date(candidate.lastActivityAt).toLocaleString(locale)}</time>}
          {candidate.sharedTags.map((value) => <span key={value} className="rounded-full bg-muted px-1">{value}</span>)}
          {current?.detached && <span>{t('task.inputs.detached')}</span>}
          {current && <span>· {current.snapshot.mode === 'summary' ? t('task.inputs.modeSummary') : current.snapshot.mode === 'messages' ? t('task.inputs.modeMessages') : t('task.inputs.modeFull')}</span>}
          {selectedOnly && !!current?.newMessages && <button type="button" className="ml-auto underline" disabled={disabled} onClick={() => current.snapshot.mode === 'full' ? void refresh(candidate) : setTarget(candidate)}>{t('task.inputs.newMessages', { count: current.newMessages })}</button>}
        </div>
      </div>
    })}
    {target && <ConversationPickerDialog taskId={taskId} candidate={target} current={selectedBySource.get(target.taskId)} onClose={() => setTarget(null)} />}
  </div>
}
