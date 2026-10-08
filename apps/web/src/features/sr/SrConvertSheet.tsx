import { useT } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { contentSr, draftSr, refineSr, submitSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/Markdown'
import { useSrFiles } from './SrAttachments'

/**
 * 접수 전환(draft) · 접수 내용 수정(submitted) · 접수 내용 보기(그 이후, 읽기 전용) — 오른쪽 Sheet.
 * AI 초안·AI 다듬기는 제안일 뿐이며 사람이 고친 칸은 덮어쓰지 않고, 적용·제출은 사람이 한다.
 */
export function SrConvertSheet({ sr, open, onOpenChange, onSaved }: { sr: SrDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const t = useT()
  const mode = sr.status === 'draft' ? 'convert' : sr.status === 'submitted' ? 'edit' : 'view'
  const readOnly = mode === 'view'
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [source, setSource] = useState<'ai' | 'manual'>('ai')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refining, setRefining] = useState(false)
  const [proposal, setProposal] = useState<{ title: string; body: string } | null>(null)
  // 사람이 고친 칸은 늦게 도착한 AI 초안이 덮어쓰지 않는다(데모 manualRef).
  const manualTitle = useRef(false), manualBody = useRef(false)
  // 후보(이 SR의 파일 전체)를 나열하고 선택만 보낸다. 초안은 전부 선택이 기본, 수정·보기는 저장된 선택(attachmentIds)을 복원한다(데모 SrConvertDialog).
  const candidates = sr.candidateAttachmentIds
  const files = useSrFiles(candidates)
  useEffect(() => {
    if (!open) return
    manualTitle.current = false; manualBody.current = false
    setProposal(null); setSelected(sr.status === 'draft' ? candidates : sr.attachmentIds)
    if (sr.status !== 'draft') { setTitle(sr.title); setBody(sr.body); setSource(sr.titleSource === 'manual' ? 'manual' : 'ai'); return }
    setTitle(''); setBody(''); setSource('ai'); setLoading(true)
    let cancelled = false
    void draftSr(sr.id).then((draft) => {
      if (cancelled) return
      if (!manualTitle.current) setTitle(draft.title)
      if (!manualBody.current) setBody(draft.body)
    }).catch((error) => { if (!cancelled) toast.error(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, sr.id, sr.status, sr.title, sr.body, sr.titleSource, sr.attachmentIds, candidates])
  async function refine() {
    setRefining(true)
    try { setProposal(await refineSr(sr.id, { title, body })) }
    catch (error) { toast.error(String(error)) }
    finally { setRefining(false) }
  }
  function applyProposal() {
    if (!proposal) return
    manualTitle.current = true; manualBody.current = true
    setTitle(proposal.title); setBody(proposal.body); setSource('ai'); setProposal(null)
  }
  async function submit() {
    setBusy(true)
    try {
      const input = { title, titleSource: source, body, attachmentIds: selected }
      const saved = mode === 'convert' ? await submitSr(sr.id, input) : await contentSr(sr.id, input)
      toast.success(mode === 'convert' ? t('sr.submitted', { code: saved.code }) : t('sr.contentSaved'))
      onOpenChange(false)
      onSaved()
    } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
  }
  const fileName = (id: string) => files.find((file) => file.id === id)?.name ?? t('sr.attachment', { number: candidates.indexOf(id) + 1 })
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl">
    <SheetHeader><SheetTitle>{t(mode === 'convert' ? 'sr.convert' : mode === 'edit' ? 'sr.editContent' : 'sr.viewContent')}</SheetTitle>
      <SheetDescription>{t(mode === 'convert' ? 'sr.convertDescription' : mode === 'edit' ? 'sr.editDescription' : 'srFlow.readOnlyDescription')}</SheetDescription></SheetHeader>
    {loading && <p role="status" className="text-xs text-muted-foreground">{t('srFlow.loadingDraft')}</p>}
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2"><Label htmlFor="sr-sheet-title">{t('sr.title')}</Label>
        <span className="text-xs text-muted-foreground">{t(source === 'manual' ? 'srFlow.manualTitle' : 'srFlow.aiTitle')}</span></div>
      <Input id="sr-sheet-title" aria-label={t('sr.title')} value={title} readOnly={readOnly} onChange={(event) => { manualTitle.current = true; setSource('manual'); setTitle(event.target.value) }} />
    </div>
    <Tabs defaultValue="edit" className="gap-2">
      <div className="flex items-center justify-between gap-2"><TabsList><TabsTrigger value="edit">{t('srFlow.edit')}</TabsTrigger><TabsTrigger value="preview">{t('srFlow.preview')}</TabsTrigger></TabsList>
        {!readOnly && <Button type="button" size="xs" variant="ghost" onClick={() => void refine()} disabled={refining || loading || (!title.trim() && !body.trim())}><Sparkles data-icon="inline-start" />{t(refining ? 'srFlow.refining' : 'srFlow.refine')}</Button>}</div>
      <TabsContent value="edit"><Textarea aria-label={t('sr.body')} value={body} readOnly={readOnly} rows={10} className="text-xs" onChange={(event) => { manualBody.current = true; setBody(event.target.value) }} /></TabsContent>
      <TabsContent value="preview">{body.trim() ? <Markdown content={body} className="rounded-lg border p-3 text-sm" /> : <p className="text-xs text-muted-foreground">{t('srFlow.emptyPreview')}</p>}</TabsContent>
    </Tabs>
    {proposal && <section aria-label={t('srFlow.proposal')} className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/20">
      <h3 className="text-xs font-semibold">{t('srFlow.proposal')}</h3>
      <p className="font-medium">{proposal.title}</p>
      <Markdown content={proposal.body} className="text-xs" />
      <p className="text-xs text-muted-foreground">{t('srFlow.proposalHint')}</p>
      <div className="flex gap-2"><Button type="button" size="sm" onClick={applyProposal}>{t('srFlow.applyProposal')}</Button><Button type="button" size="sm" variant="outline" onClick={() => setProposal(null)}>{t('srFlow.dismissProposal')}</Button></div>
    </section>}
    <section className="space-y-1.5"><h3 className="text-sm font-medium">{t('sr.attachments')}</h3>
      {candidates.length ? <><p className="text-xs text-muted-foreground">{t('srFlow.attachmentsHint')}</p><ul className="space-y-1">{candidates.map((id) => <li key={id} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
        <Checkbox id={`sr-attachment-${id}`} aria-label={fileName(id)} checked={selected.includes(id)} disabled={readOnly} onCheckedChange={() => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} />
        <label htmlFor={`sr-attachment-${id}`} className="min-w-0 flex-1 cursor-pointer truncate">{fileName(id)}</label>
      </li>)}</ul></> : <p className="text-xs text-muted-foreground">{t('srFlow.noAttachments')}</p>}
    </section>
    <SheetFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t(readOnly ? 'common.close' : 'common.cancel')}</Button>
      {!readOnly && <Button onClick={() => void submit()} disabled={busy || loading || !title.trim()}>{t(mode === 'convert' ? 'sr.submit' : 'sr.save')}</Button>}</SheetFooter>
  </SheetContent></Sheet>
}
