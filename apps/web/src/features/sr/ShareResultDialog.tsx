import { useCallback, useMemo, useState } from 'react'
import { useT } from '@/i18n'
import { Chip } from '@/components/Chip'
import { SuggestInput } from '@/components/SuggestInput'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { shareSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { filesForTask } from '@/api/files'

export function ShareResultDialog({ sr, open, onOpenChange, onSaved }: { sr: SrDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const t = useT()
  const options = useMemo(() => sr.conversations.map(item => ({ value: item.id, label: `${item.code} ${item.title}` })), [sr.conversations])
  const conversationSource = useCallback(() => options, [options])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [fileIds, setFileIds] = useState<string[]>([])
  const { data: files = [] } = useQuery({ queryKey: ['files', taskId], queryFn: () => filesForTask(taskId), enabled: !!taskId })
  function selectTask(value: string) { if (value !== taskId) { setTaskId(value); setFileIds([]) } }
  async function share() {
    setBusy(true)
    try { await shareSr(sr.id, { text, taskId: taskId || undefined, fileIds }); onOpenChange(false); onSaved(); setText(''); setFileIds([]) }
    catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>결과 공유</DialogTitle>
    <DialogDescription>요청자에게 보낼 내용입니다. 내부 대화는 공유되지 않습니다.</DialogDescription></DialogHeader>
    <Textarea aria-label="공유 내용" value={text} onChange={(event) => setText(event.target.value)} rows={5} />
    <div role="group" aria-label={t('sr.linkedConversation')} className="space-y-1.5">
      <div className="text-sm">{t('sr.linkedConversation')}</div>
      {options.length > 6 && <SuggestInput mode="single" source={conversationSource} value={options.find(option => option.value === taskId) ?? null}
        onChange={option => selectTask(option?.value ?? '')} aria-label={t('sr.linkedConversation')} />}
      <div className="flex flex-wrap gap-1"><Chip label={t('sr.noConversation')} selected={!taskId} onClick={() => selectTask('')} />
        {options.length <= 6 && options.map(option => <Chip key={option.value} label={option.label} selected={taskId === option.value} onClick={() => selectTask(option.value)} />)}
      </div>
    </div>
    {files.filter((file) => file.isOutput).map((file) => <label key={file.id} className="flex gap-2 text-sm"><input type="checkbox" checked={fileIds.includes(file.id)} onChange={() => setFileIds((ids) => ids.includes(file.id) ? ids.filter((id) => id !== file.id) : [...ids, file.id])} />{file.name}</label>)}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button onClick={share} disabled={busy || (!text.trim() && !fileIds.length)}>공유</Button></DialogFooter>
  </DialogContent></Dialog>
}
