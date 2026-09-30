import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { eligibleMessages, type Message } from '@mes/domain'
import { toast } from 'sonner'
import { getMessages, getTask } from '@/api/tasks'
import { draftConversationSummary, selectConversation, type LoadedConversationInput } from '@/api/conversationInputs'
import type { ConversationCandidate } from '@/api/files'
import { formatSize } from '@/api/files'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function ConversationPickerDialog({ taskId, candidate, current, onClose }: { taskId: string; candidate: ConversationCandidate;
  current?: LoadedConversationInput; onClose: () => void }) {
  const source = useQuery({ queryKey: ['task', candidate.taskId], queryFn: () => getTask(candidate.taskId) })
  const history = useQuery({ queryKey: ['messages', source.data?.threadId], queryFn: () => getMessages(source.data!.threadId!), enabled: !!source.data?.threadId })
  const messages = eligibleMessages(history.data ?? [])
  const [mode, setMode] = useState<'full' | 'messages' | 'summary'>(current?.snapshot.mode ?? 'full')
  const [picked, setPicked] = useState<string[] | null>(current?.snapshot.mode === 'messages' ? current.snapshot.messageIds : null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [weight, setWeight] = useState<'main' | 'reference'>(current?.input.weight ?? 'reference')
  const [summary, setSummary] = useState(current?.snapshot.summaryText ?? '')
  const [summarySource, setSummarySource] = useState<'ai' | 'rule'>(current?.snapshot.summarySource ?? 'rule')
  const [summaryModel, setSummaryModel] = useState(current?.snapshot.summaryModel)
  const [draftMessageIds, setDraftMessageIds] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = picked ?? messages.map((item) => item.id)
  const chosen = messages.filter((item) => selected.includes(item.id))
  const size = mode === 'summary' ? new TextEncoder().encode(summary).length : (mode === 'full' ? messages : chosen).reduce((total, item) => total + new TextEncoder().encode(item.content).length, 0)

  function toggle(index: number, shift: boolean) {
    const next = new Set(selected)
    const target = messages[index]!
    const checked = !next.has(target.id)
    const from = shift && anchor !== null ? Math.min(anchor, index) : index
    const to = shift && anchor !== null ? Math.max(anchor, index) : index
    for (let cursor = from; cursor <= to; cursor++) {
      if (checked) next.add(messages[cursor]!.id)
      else next.delete(messages[cursor]!.id)
    }
    setPicked([...next])
    setAnchor(index)
  }
  async function draft() {
    setBusy(true)
    try {
      const messageIds = chosen.map((item) => item.id)
      const result = await draftConversationSummary(taskId, candidate.taskId, messageIds)
      setSummary(result.text)
      setSummarySource(result.source)
      setSummaryModel(result.model)
      setDraftMessageIds(messageIds)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function apply() {
    setBusy(true)
    try {
      await selectConversation(taskId, candidate.taskId, { mode, weight,
        ...(mode === 'messages' && { messageIds: chosen.map((item) => item.id) }),
        ...(mode === 'summary' && { summary: { text: summary, source: summarySource, ...(summaryModel && { model: summaryModel }), messageIds: draftMessageIds ?? chosen.map((item) => item.id) } }) })
      onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{candidate.code} · {candidate.title}</DialogTitle><DialogDescription>선택한 시점의 메시지를 고정합니다. 이 대화가 쓴 파일과 다른 참조 대화는 포함하지 않습니다.</DialogDescription></DialogHeader>
    <div role="tablist" aria-label="참조 대화 모드" className="flex gap-1 rounded bg-muted p-1">{([['full', '전체 원문'], ['messages', '메시지 선택'], ['summary', '요약']] as const).map(([value, label]) =>
      <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`flex-1 rounded px-2 py-1 ${mode === value ? 'bg-background font-medium shadow-sm' : ''}`}>{label}</button>)}</div>
    {history.isError && <div role="alert">원본 메시지를 불러오지 못했습니다.</div>}
    {mode === 'full' && <><p className="text-xs text-muted-foreground">완료된 사용자·assistant 메시지 {messages.length}개를 그대로 보냅니다. 팀 의견과 실패한 답변은 제외합니다.</p><Preview messages={messages} /></>}
    {mode === 'messages' && <div className="space-y-2"><div className="flex items-center gap-2 text-xs"><span>{chosen.length}/{messages.length}개 · Shift+클릭으로 범위 선택</span>
      <button type="button" className="ml-auto underline" onClick={() => setPicked(messages.map((item) => item.id))}>전체</button><button type="button" className="underline" onClick={() => setPicked([])}>해제</button></div>
      <ul className="max-h-72 overflow-y-auto rounded border p-2">{messages.map((item, index) => <li key={item.id} className="flex gap-2 border-b py-1 last:border-0">
        <input type="checkbox" aria-label={`${index + 1}번째 메시지 선택`} checked={selected.includes(item.id)} onClick={(event) => { event.preventDefault(); toggle(index, event.shiftKey) }} readOnly />
        <MessageLine message={item} /></li>)}</ul></div>}
    {mode === 'summary' && <div className="space-y-2"><p className="text-xs text-muted-foreground">{chosen.length}개 메시지를 선택했습니다. 범위는 메시지 선택에서 바꿀 수 있습니다. 초안을 확인·수정한 뒤 적용하세요.</p>
      <Button type="button" variant="outline" size="sm" disabled={busy || !chosen.length} onClick={() => void draft()}>{summary ? '다시 요약' : '요약 만들기'}</Button>
      <textarea aria-label="참조 대화 요약" rows={8} className="w-full rounded border p-2 text-sm" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="요약을 만들거나 직접 작성하세요" /></div>}
    <DialogFooter className="items-center sm:justify-between"><div className="flex items-center gap-3 text-xs"><label><input type="checkbox" checked={weight === 'main'} onChange={(event) => setWeight(event.target.checked ? 'main' : 'reference')} /> ★ 주 입력</label><span>전달 크기 약 {formatSize(size)}</span></div>
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="button" disabled={busy || history.isPending || (mode === 'messages' && !chosen.length) || (mode === 'summary' && !summary.trim())} onClick={() => void apply()}>적용</Button></div></DialogFooter>
  </DialogContent></Dialog>
}

function MessageLine({ message }: { message: Message }) { return <div className="min-w-0 text-xs"><span className="font-medium">{message.role === 'user' ? '사용자' : 'assistant'}</span><span className="ml-2 text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</span><p className="line-clamp-2 whitespace-pre-wrap">{message.content}</p></div> }
function Preview({ messages }: { messages: Message[] }) { return <ul className="max-h-64 space-y-2 overflow-y-auto rounded border p-2">{messages.map((item) => <li key={item.id}><MessageLine message={item} /></li>)}</ul> }
