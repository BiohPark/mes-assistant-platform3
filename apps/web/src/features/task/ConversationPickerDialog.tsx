import { useLocale, useT } from '@/i18n'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { eligibleMessages, type Message } from '@mes/domain'
import { toast } from 'sonner'
import { getMessages, getTask } from '@/api/tasks'
import { draftConversationSummary, selectConversation, type LoadedConversationInput } from '@/api/conversationInputs'
import type { ConversationCandidate } from '@/api/files'
import { formatSize } from '@/api/files'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function ConversationPickerDialog({ taskId, candidate, current, initialMode, onClose }: { taskId: string; candidate: ConversationCandidate;
  current?: LoadedConversationInput; initialMode?: 'full' | 'messages' | 'summary'; onClose: () => void }) {
  const t = useT()
  const source = useQuery({ queryKey: ['task', candidate.taskId], queryFn: () => getTask(candidate.taskId) })
  const history = useQuery({ queryKey: ['messages', source.data?.threadId], queryFn: ({ signal }) => getMessages(source.data!.threadId!, signal), enabled: !!source.data?.threadId })
  const messages = eligibleMessages(history.data ?? [])
  const [mode, setMode] = useState<'full' | 'messages' | 'summary'>(initialMode ?? current?.snapshot.mode ?? 'full')
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
    <DialogHeader><DialogTitle>{candidate.code} · {candidate.title}</DialogTitle><DialogDescription>{t('task.picker.description')}</DialogDescription></DialogHeader>
    <div role="tablist" aria-label={t('task.picker.modes')} className="flex gap-1 rounded-xl bg-muted p-1">{([['full', t('task.picker.full')], ['messages', t('task.picker.messages')], ['summary', t('task.picker.summary')]] as const).map(([value, label]) =>
      <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`flex-1 rounded-lg px-2 py-1 ${mode === value ? 'bg-background font-medium shadow-sm' : ''}`}>{label}</button>)}</div>
    {history.isError && <div role="alert">{t('task.picker.historyFailed')}</div>}
    {mode === 'full' && <><p className="text-xs text-muted-foreground">{t('task.picker.fullHelp', { count: messages.length })}</p><Preview messages={messages} /></>}
    {mode === 'messages' && <div className="space-y-2"><div className="flex items-center gap-2 text-xs"><span>{t('task.picker.selection', { chosen: chosen.length, total: messages.length })}</span>
      <button type="button" className="ml-auto underline" onClick={() => setPicked(messages.map((item) => item.id))}>{t('common.all')}</button><button type="button" className="underline" onClick={() => setPicked([])}>{t('task.picker.clear')}</button></div>
      <ul className="max-h-72 overflow-y-auto rounded-xl border p-2">{messages.map((item, index) => <li key={item.id} className="flex gap-2 border-b py-1 last:border-0">
        <Checkbox className="mt-0.5" aria-label={t('task.picker.selectMessage', { number: index + 1 })} checked={selected.includes(item.id)} onClick={(event) => toggle(index, event.shiftKey)} />
        <MessageLine message={item} /></li>)}</ul></div>}
    {mode === 'summary' && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t('task.picker.summaryHelp', { count: chosen.length })}</p>
      <Button type="button" variant="outline" size="sm" disabled={busy || !chosen.length} onClick={() => void draft()}>{summary ? t('task.picker.resummarize') : t('task.picker.makeSummary')}</Button>
      <textarea aria-label={t('task.picker.summaryLabel')} rows={8} className="w-full rounded-lg border p-2 text-sm" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={t('task.picker.summaryPlaceholder')} /></div>}
    <DialogFooter className="items-center sm:justify-between"><div className="flex items-center gap-3 text-xs"><Label className="gap-1.5 text-xs font-normal"><Switch size="sm" checked={weight === 'main'} onCheckedChange={(checked) => setWeight(checked ? 'main' : 'reference')} />{t('task.picker.mainInput')}</Label><span>{t('task.picker.size', { size: formatSize(size) })}</span></div>
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button type="button" disabled={busy || history.isPending || (mode === 'messages' && !chosen.length) || (mode === 'summary' && !summary.trim())} onClick={() => void apply()}>{t('task.picker.apply')}</Button></div></DialogFooter>
  </DialogContent></Dialog>
}

function MessageLine({ message }: { message: Message }) { const locale = useLocale(); const t = useT(); return <div className="min-w-0 text-xs"><span className="font-medium">{message.role === 'user' ? t('task.picker.user') : 'assistant'}</span><span className="ml-2 text-muted-foreground">{new Date(message.createdAt).toLocaleString(locale)}</span><p className="line-clamp-2 whitespace-pre-wrap">{message.content}</p></div> }
function Preview({ messages }: { messages: Message[] }) { return <ul className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-2">{messages.map((item) => <li key={item.id}><MessageLine message={item} /></li>)}</ul> }
