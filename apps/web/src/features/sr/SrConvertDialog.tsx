import { useT } from '@/i18n'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { contentSr, draftSr, submitSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function SrConvertDialog({ sr, open, onOpenChange, onSaved }: { sr: SrDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const t = useT()
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
      toast.success(sr.status === 'draft' ? t('sr.submitted', { code: saved.code }) : t('sr.contentSaved'))
      onOpenChange(false)
      onSaved()
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{sr.status === 'draft' ? t('sr.convert') : t('sr.editContent')}</DialogTitle>
    <DialogDescription>{sr.status === 'draft' ? t('sr.convertDescription') : t('sr.editDescription')}</DialogDescription></DialogHeader>
    <Input aria-label={t('sr.title')} value={title} onChange={(event) => { setTitle(event.target.value); setSource('manual') }} />
    <Textarea aria-label={t('sr.body')} value={body} onChange={(event) => setBody(event.target.value)} rows={8} />
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button onClick={submit} disabled={busy || !title.trim()}>{sr.status === 'draft' ? t('sr.submit') : t('sr.save')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
