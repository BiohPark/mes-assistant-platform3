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
import type { RequestEstimate } from '@/api/requests'
import { ConversationPickerDialog } from '@/features/task/ConversationPickerDialog'

const delivery = { attached: '첨부', inline: '본문', metadata_only: '이름만', failed: '실패' }
const label = (input: RequestInput) => input.kind === 'file' ? input.name : input.code

export function ContextTray({ task, info }: { task: Task; info?: RequestEstimate }) {
  const actor = useActor()
  const [open, setOpen] = useState<boolean>()
  const [adjust, setAdjust] = useState<{ taskId: string; mode: 'messages' | 'summary' } | null>(null)
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id), enabled: !!adjust })
  const selected = useQuery({ queryKey: ['conversation-inputs', task.id], queryFn: () => listConversationInputs(task.id), enabled: !!adjust })
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
  return <div className="border-t bg-muted/20 px-2.5 py-2" aria-label="이번 요청에 사용할 자료">
    <button type="button" className="flex w-full items-center gap-2 text-left text-xs" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
      <span className="font-medium">이번 요청에 사용 · {inputs.length}</span>
      <span className="ml-auto text-muted-foreground">예상 {formatSize(info.bytes)} / {formatSize(info.limitBytes)}</span>
      <ChevronDown className={cn('size-3.5', expanded && 'rotate-180')} />
    </button>
    <div role="meter" aria-label="요청 크기" aria-valuemin={0} aria-valuemax={info.limitBytes} aria-valuenow={info.bytes}
      className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full', level === 'over' ? 'bg-destructive' : level === 'warn' ? 'bg-amber-500' : 'bg-primary')}
        style={{ width: `${Math.min(100, Math.round(info.bytes / info.limitBytes * 100))}%` }} /></div>
    {expanded && <ul className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">{inputs.map((input) => <li key={input.kind === 'file' ? input.fileId : input.sourceTaskId}
      className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px]">
      <button type="button" disabled={task.status === 'done'} aria-label={`${label(input)} 주 입력 전환`}
        onClick={() => void change(input, input.weight === 'main' ? 'reference' : 'main')}><Star className={cn('size-3', input.weight === 'main' && 'fill-amber-400 text-amber-500')} /></button>
      {input.kind === 'file' ? <FileText className="size-3" /> : <MessagesSquare className="size-3" />}
      <span className="truncate">{label(input)}</span>
      <span className="rounded border px-1">{input.kind === 'file' ? delivery[input.delivery] : input.mode === 'summary' ? '요약' : `${input.messageCount}개`}</span>
      {task.status !== 'done' && <button type="button" aria-label={`${label(input)} 이번 요청에서 빼기`} onClick={() => void change(input, null)}><X className="size-3" /></button>}
    </li>)}</ul>}
    {level === 'over' && <div role="alert" className="mt-2 rounded border border-destructive/40 p-2 text-xs">
      <p className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" /> 요청 크기 한도를 넘어 보낼 수 없습니다.</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {inputs[0] && <Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => void change(inputs[0]!, null)}>입력 해제</Button>}
        {largest && <><Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'messages' })}>메시지 범위 선택</Button>
          <Button size="xs" variant="outline" disabled={task.status === 'done'} onClick={() => setAdjust({ taskId: largest.sourceTaskId, mode: 'summary' })}>요약 만들기</Button></>}
        <Button size="xs" variant="outline" asChild><a href={newConversationUrl}>새 대화로 이어가기</a></Button>
      </div>
    </div>}
    {candidate && !selected.isPending && <ConversationPickerDialog key={`${candidate.taskId}:${adjust?.mode}`} taskId={task.id} candidate={candidate} current={current}
      initialMode={adjust?.mode} onClose={() => setAdjust(null)} />}
  </div>
}
