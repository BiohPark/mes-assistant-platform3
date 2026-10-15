import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@/i18n'
import { srStage } from '@mes/domain'
import { useEffect, useRef, useState } from 'react'
import { PenLine, Sparkles, Square } from 'lucide-react'
import { toast } from 'sonner'
import { composeSr, contentSr, draftSr, getSr, refineSr, submitSr, SrApiError, type SrDetail, type SrProposal } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/Markdown'
import { useSrFiles } from './SrAttachments'

type AiKind = 'compose' | 'refine'

/**
 * 접수 전환(draft) · 접수 내용 수정(submitted) · 접수 내용 보기(그 이후, 읽기 전용) — 오른쪽 Sheet.
 * AI 초안·AI 자동작성·AI 다듬기는 제안일 뿐이며 사람이 고친 칸은 덮어쓰지 않고, 적용·제출은 사람이 한다.
 * 자동작성은 접수 대화 전체로 제목·본문을 새로 제안하고, 다듬기는 현재 글의 뜻을 바꾸지 않으며 빠진 점은 추천 목록으로만 보인다.
 */
export function SrConvertSheet({ sr, open, onOpenChange, onSaved }: { sr: SrDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const t = useT()
  const query = useQueryClient()
  // 접수됨(옛 reviewing 포함)까지 수정, 처리 중부터 읽기 전용 — 서버 content() 규칙과 같다
  const mode = sr.status === 'draft' ? 'convert' : srStage(sr.status) === 'submitted' ? 'edit' : 'view'
  const readOnly = mode === 'view'
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [source, setSource] = useState<'ai' | 'manual'>('ai')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState<AiKind | null>(null)
  // 진행 표시 — 서버가 흘려주는 조각을 그대로 쌓는다(제안 확정 전까지만 보인다)
  const [partial, setPartial] = useState('')
  const [proposal, setProposal] = useState<SrProposal | null>(null)
  // AI 제안 실패(권한·근거 없음·한도 초과·연결 끊김)는 시트 안에 남긴다 — 토스트만으로는 놓친다
  const [aiError, setAiError] = useState<string | null>(null)
  const aiAbort = useRef<AbortController | null>(null)
  // 사람이 고친 칸은 늦게 도착한 AI 초안이 덮어쓰지 않는다(데모 manualRef).
  const manualTitle = useRef(false), manualBody = useRef(false)
  const dirty = useRef(false)
  const baseline = useRef(sr.updatedAt)
  const latest = useRef(sr)
  latest.current = sr
  const cancelDraft = useRef<(() => void) | null>(null)
  const [conflict, setConflict] = useState(false)
  // 후보(이 SR의 파일 전체)를 나열하고 선택만 보낸다. 초안은 전부 선택이 기본, 수정·보기는 저장된 선택(attachmentIds)을 복원한다(데모 SrConvertDialog).
  const candidates = sr.candidateAttachmentIds
  const files = useSrFiles(candidates)
  // 열린 Sheet의 SR 상태·버전이 바뀌면 이전 초안 요청을 폐기한다. 초기화는 열기·SR 전환 때만 한다.
  useEffect(() => { cancelDraft.current?.() }, [sr.id, sr.status, sr.updatedAt])
  // 닫히거나 다른 SR로 바뀌면 진행 중인 AI 제안도 끊는다.
  useEffect(() => () => aiAbort.current?.abort(), [open, sr.id])
  useEffect(() => {
    if (!open) return
    const sr = latest.current
    const candidates = sr.candidateAttachmentIds
    dirty.current = false; baseline.current = sr.updatedAt; setConflict(false)
    manualTitle.current = false; manualBody.current = false
    setLoading(false); setProposal(null); setAiError(null); setSelected(sr.status === 'draft' ? candidates : sr.attachmentIds)
    if (sr.status !== 'draft') { setTitle(sr.title); setBody(sr.body); setSource(sr.titleSource === 'manual' ? 'manual' : 'ai'); return }
    setTitle(''); setBody(''); setSource('ai'); setLoading(true)
    let cancelled = false
    const isCurrent = () => !cancelled && latest.current.id === sr.id && latest.current.status === sr.status && latest.current.updatedAt === sr.updatedAt
    cancelDraft.current = () => { cancelled = true; setLoading(false) }
    void draftSr(sr.id).then((draft) => {
      if (!isCurrent()) return
      if (!manualTitle.current) setTitle(draft.title)
      if (!manualBody.current) setBody(draft.body)
    }).catch((error) => { if (isCurrent()) toast.error(String(error)) }).finally(() => { if (isCurrent()) setLoading(false) })
    return () => { cancelled = true; cancelDraft.current = null }
  }, [open, sr.id])
  useEffect(() => {
    if (!open || dirty.current) return
    baseline.current = sr.updatedAt
    if (sr.status === 'draft') { setSelected(sr.candidateAttachmentIds); return }
    setTitle(sr.title); setBody(sr.body); setSource(sr.titleSource === 'manual' ? 'manual' : 'ai'); setSelected(sr.attachmentIds)
  }, [open, sr.id, sr.status, sr.title, sr.body, sr.titleSource, sr.attachmentIds, sr.candidateAttachmentIds, sr.updatedAt])
  /** AI 제안 요청 — 제안만 받아 둔다. 중지(abort)는 안내 없이 돌아오고, 실패(한도 초과·시간 초과 등)는 안내만 한다. */
  async function runAi(kind: AiKind) {
    aiAbort.current?.abort()
    const controller = new AbortController()
    aiAbort.current = controller
    setAiBusy(kind); setPartial(''); setProposal(null); setAiError(null)
    try {
      const onDelta = (text: string) => { if (!controller.signal.aborted) setPartial((prev) => prev + text) }
      const result = kind === 'compose' ? await composeSr(sr.id, onDelta, controller.signal) : await refineSr(sr.id, { title, body }, onDelta, controller.signal)
      if (!controller.signal.aborted) setProposal(result)
    } catch (error) {
      if (!controller.signal.aborted) setAiError(error instanceof Error ? error.message : String(error))
    } finally {
      if (aiAbort.current === controller) { aiAbort.current = null; setAiBusy(null); setPartial('') }
    }
  }
  function applyProposal() {
    if (!proposal) return
    dirty.current = true; manualTitle.current = true; manualBody.current = true
    setTitle(proposal.title); setBody(proposal.body); setSource('ai'); setProposal(null)
  }
  function showConflict() {
    setConflict(true)
    void query.invalidateQueries({ queryKey: ['sr'] })
  }
  async function submit() {
    setBusy(true)
    try {
      const current = await getSr(sr.id)
      if (current.updatedAt !== baseline.current) { showConflict(); return }
      const input = { title, titleSource: source, body, attachmentIds: selected, updatedAt: baseline.current }
      const saved = mode === 'convert' ? await submitSr(sr.id, input) : await contentSr(sr.id, input)
      toast.success(mode === 'convert' ? t('sr.submitted', { code: saved.code }) : t('sr.contentSaved'))
      onOpenChange(false)
      onSaved()
    } catch (error) {
      if (error instanceof SrApiError && error.status === 409) showConflict()
      else toast.error(String(error))
    } finally { setBusy(false) }
  }
  const fileName = (id: string) => files.find((file) => file.id === id)?.name ?? t('sr.attachment', { number: candidates.indexOf(id) + 1 })
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl">
    <SheetHeader><SheetTitle>{t(mode === 'convert' ? 'sr.convert' : mode === 'edit' ? 'sr.editContent' : 'sr.viewContent')}</SheetTitle>
      <SheetDescription>{t(mode === 'convert' ? 'sr.convertDescription' : mode === 'edit' ? 'sr.editDescription' : 'srFlow.readOnlyDescription')}</SheetDescription></SheetHeader>
    {conflict && <p role="alert" className="text-sm text-destructive">{t('sr.contentConflict')}</p>}
    {loading && <p role="status" className="text-xs text-muted-foreground">{t('srFlow.loadingDraft')}</p>}
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2"><Label htmlFor="sr-sheet-title">{t('sr.title')}</Label>
        <span className="text-xs text-muted-foreground">{t(source === 'manual' ? 'srFlow.manualTitle' : 'srFlow.aiTitle')}</span></div>
      <Input id="sr-sheet-title" aria-label={t('sr.title')} value={title} readOnly={readOnly} onChange={(event) => { dirty.current = true; setConflict(false); manualTitle.current = true; setSource('manual'); setTitle(event.target.value) }} />
    </div>
    <Tabs defaultValue="edit" className="gap-2">
      <div className="flex items-center justify-between gap-2"><TabsList><TabsTrigger value="edit">{t('srFlow.edit')}</TabsTrigger><TabsTrigger value="preview">{t('srFlow.preview')}</TabsTrigger></TabsList>
        {!readOnly && <div className="flex items-center gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => void runAi('compose')} disabled={!!aiBusy || loading}><Sparkles data-icon="inline-start" />{t('srFlow.compose')}</Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => void runAi('refine')} disabled={!!aiBusy || loading || (!title.trim() && !body.trim())}><PenLine data-icon="inline-start" />{t('srFlow.refine')}</Button>
        </div>}</div>
      <TabsContent value="edit"><Textarea aria-label={t('sr.body')} value={body} readOnly={readOnly} rows={10} className="text-xs" onChange={(event) => { dirty.current = true; setConflict(false); manualBody.current = true; setBody(event.target.value) }} /></TabsContent>
      <TabsContent value="preview">{body.trim() ? <Markdown content={body} className="rounded-lg border p-3 text-sm" /> : <p className="text-xs text-muted-foreground">{t('srFlow.emptyPreview')}</p>}</TabsContent>
    </Tabs>
    {aiError && <p role="alert" className="text-xs text-destructive">{aiError}</p>}
    {aiBusy && <div role="status" className="space-y-1 rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span>{t(aiBusy === 'compose' ? 'srFlow.composing' : 'srFlow.refining')}{partial && ` ${t('srFlow.aiProgress', { chars: partial.length })}`}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => aiAbort.current?.abort()}><Square data-icon="inline-start" />{t('srFlow.aiStop')}</Button>
      </div>
      {partial && <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-sans">{partial}</pre>}
    </div>}
    {proposal && <section aria-label={t('srFlow.proposal')} className="space-y-2 rounded-lg border border-tone-violet-fg/40 bg-tone-violet-bg p-3 text-sm">
      <h3 className="text-xs font-semibold">{t('srFlow.proposal')}</h3>
      {proposal.source === 'rule' && <p role="alert" className="text-xs text-muted-foreground">{t('srFlow.ruleFallback')}</p>}
      <p className="font-medium">{proposal.title}</p>
      <Markdown content={proposal.body} className="text-xs" />
      {proposal.suggestions.length > 0 && <div className="space-y-1">
        <h4 id="sr-ai-suggestions" className="text-xs font-semibold">{t('srFlow.suggestions')}</h4>
        <ul aria-labelledby="sr-ai-suggestions" className="list-disc pl-4 text-xs">{proposal.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <p className="text-xs text-muted-foreground">{t('srFlow.suggestionsHint')}</p>
      </div>}
      <p className="text-xs text-muted-foreground">{t('srFlow.proposalHint')}</p>
      <div className="flex gap-2"><Button type="button" size="sm" onClick={applyProposal}>{t('srFlow.applyProposal')}</Button><Button type="button" size="sm" variant="outline" onClick={() => setProposal(null)}>{t('srFlow.dismissProposal')}</Button></div>
    </section>}
    <section className="space-y-1.5"><h3 className="text-sm font-medium">{t('sr.attachments')}</h3>
      {candidates.length ? <><p className="text-xs text-muted-foreground">{t('srFlow.attachmentsHint')}</p><ul className="space-y-1">{candidates.map((id) => <li key={id} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
        <Checkbox id={`sr-attachment-${id}`} aria-label={fileName(id)} checked={selected.includes(id)} disabled={readOnly} onCheckedChange={() => { dirty.current = true; setConflict(false); setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]) }} />
        <label htmlFor={`sr-attachment-${id}`} className="min-w-0 flex-1 cursor-pointer truncate">{fileName(id)}</label>
      </li>)}</ul></> : <p className="text-xs text-muted-foreground">{t('srFlow.noAttachments')}</p>}
    </section>
    <SheetFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t(readOnly ? 'common.close' : 'common.cancel')}</Button>
      {!readOnly && <Button onClick={() => void submit()} disabled={busy || loading || !title.trim()}>{t(mode === 'convert' ? 'sr.submit' : 'sr.save')}</Button>}</SheetFooter>
  </SheetContent></Sheet>
}
