import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationCandidate } from '@/api/files'
import { formatSize } from '@/api/files'
import { listConversationInputs, refreshConversationInput, removeConversationInput, selectConversation, setConversationWeight, type LoadedConversationInput } from '@/api/conversationInputs'
import { InputToggle } from './InputToggle'
import { ConversationPickerDialog } from './ConversationPickerDialog'

export function ConversationInputs({ taskId, candidates, disabled, selectedOnly = false }: { taskId: string; candidates: ConversationCandidate[]; disabled: boolean; selectedOnly?: boolean }) {
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
      } else if (weight) await selectConversation(taskId, candidate.taskId, { mode: 'full', weight })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  async function refresh(candidate: ConversationCandidate) {
    try { await refreshConversationInput(taskId, candidate.taskId) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="space-y-2" data-testid={selectedOnly ? 'selected-conversations' : 'conversation-candidates'}>
    {selected.isError && <div role="alert">참조 대화를 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void selected.refetch()}>다시 시도</button></div>}
    {!available.length && <div className="rounded-xl border border-dashed p-3 text-center text-muted-foreground">{selectedOnly ? '선택한 참조 대화가 없습니다.' : '같은 태그를 가진 다른 대화가 없습니다.'}</div>}
    {available.map((candidate) => {
      const current = selectedBySource.get(candidate.taskId)
      return <div key={candidate.taskId} className="rounded-xl border p-2" data-testid={`conversation-${candidate.taskId}`}>
        <div className="flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setTarget(candidate)}>
          <span className="font-mono text-muted-foreground">{candidate.code}</span> · {candidate.title}</button>
          <button type="button" className="rounded-xl border px-1" disabled={disabled || (!current && !candidate.messageCount)} aria-label={`${candidate.code} 세부 조절`} onClick={() => setTarget(candidate)}>조절</button>
          <InputToggle weight={current?.input.weight} label={candidate.code} disabled={disabled || (!current && !candidate.messageCount)} onChange={(weight) => void change(candidate, current, weight)} /></div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span className="rounded-full border px-1.5" style={{ borderColor: candidate.assistant.color }}>{candidate.assistant.name}</span><span>· {candidate.status}</span><span>· 메시지 {current?.messageCount ?? candidate.messageCount}개</span><span>· {formatSize(current?.bytes ?? candidate.bytes)}</span>
          {candidate.sharedTags.map((value) => <span key={value} className="rounded-full bg-muted px-1">{value}</span>)}
          {current?.detached && <span>태그 해제됨</span>}
          {current && <span>· {current.snapshot.mode === 'summary' ? '요약' : current.snapshot.mode === 'messages' ? '고른 메시지' : '전체 원문'}</span>}
          {!!current?.newMessages && <button type="button" className="ml-auto underline" disabled={disabled} onClick={() => current.snapshot.mode === 'full' ? void refresh(candidate) : setTarget(candidate)}>새 메시지 {current.newMessages} · 갱신</button>}
        </div>
      </div>
    })}
    {target && <ConversationPickerDialog taskId={taskId} candidate={target} current={selectedBySource.get(target.taskId)} onClose={() => setTarget(null)} />}
  </div>
}
