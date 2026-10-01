import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { contentSr, draftSr, submitSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function SrConvertDialog({ sr, open, onOpenChange, onSaved }: { sr: SrDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [source, setSource] = useState<'ai' | 'manual'>('ai')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) {
    if (sr.status !== 'draft') { setTitle(sr.title); setBody(sr.body); setSource(sr.titleSource === 'manual' ? 'manual' : 'ai'); return }
    void draftSr(sr.id).then((draft) => { setTitle(draft.title); setBody(draft.body); setSource('ai') }).catch((error) => toast.error(String(error)))
  } }, [open, sr.id, sr.status, sr.title, sr.body, sr.titleSource])
  async function submit() {
    setBusy(true)
    try {
      const saved = sr.status === 'draft' ? await submitSr(sr.id, { title, titleSource: source, body, attachmentIds: sr.attachmentIds })
        : await contentSr(sr.id, { title, titleSource: source, body, attachmentIds: sr.attachmentIds })
      toast.success(sr.status === 'draft' ? `${saved.code}로 접수되었습니다.` : '접수 내용을 수정했습니다.')
      onOpenChange(false)
      onSaved()
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{sr.status === 'draft' ? '접수로 전환' : '접수 내용 수정'}</DialogTitle>
    <DialogDescription>{sr.status === 'draft' ? '대화에서 만든 초안을 확인하고 제출하세요.' : '검토 시작 전까지 내용을 수정할 수 있습니다.'}</DialogDescription></DialogHeader>
    <Input aria-label="SR 제목" value={title} onChange={(event) => { setTitle(event.target.value); setSource('manual') }} />
    <Textarea aria-label="SR 본문" value={body} onChange={(event) => setBody(event.target.value)} rows={8} />
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button onClick={submit} disabled={busy || !title.trim()}>{sr.status === 'draft' ? '접수 제출' : '저장'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
