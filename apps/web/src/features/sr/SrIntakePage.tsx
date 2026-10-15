import { FILE_MAX_PER_REQUEST } from '@mes/contracts'
import { SR_STAGE_FLOW, srStage } from '@mes/domain'
import { useT } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link, useSearchParams } from 'react-router'
import { createSr, deleteSr, getSr, getSrIntakeAssistant, listSr, uploadSrFile, type SrDetail } from '@/api/sr'
import { getMessages } from '@/api/tasks'
import { queueFirstRequest, useChat } from '@/features/chat/useChat'
import { ChatMessages } from '@/features/chat/ChatMessages'
import { Composer, type AttachmentChip, type ComposerHandle, type PendingAttachment } from '@/features/chat/Composer'
import { TopBar } from '@/app/TopBar'
import { Bot, Inbox, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/Chip'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { FileDropZone } from '@/components/FileDropZone'
import { HelpTip } from '@/components/HelpTip'
import { SrStatusBadge } from '@/components/StatusBadges'
import { newId } from '@/lib/ids'
import { SrList } from './SrList'
import { SrLoadError, SrSkeleton } from './SrStates'
import { exampleQuestionsFrom } from './srExamples'
import { SrTitleEditor } from './SrTitleEditor'
import { SrConvertSheet } from './SrConvertSheet'
import { SrStatusHistory } from './SrStatusHistory'
import { SharedResults } from './SharedResults'
import { SrAttachments, useSrFiles } from './SrAttachments'
import { AttachToggle } from '@/features/task/AttachToggle'
import { useEvents } from '@/app/useEvents'
import { useMe } from '@/app/auth'

const steps = ['draft', ...SR_STAGE_FLOW] as const

export function SrIntakePage() {
  const t = useT()
  const me = useMe()
  // 요청자 전용 셸은 SSE를 열지 않으므로 접수 화면에서 구독한다.
  useEvents(me.roles.includes('requester') && !me.roles.includes('system_owner'))
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['sr', 'mine'], queryFn: () => listSr('mine') })
  const intake = useQuery({ queryKey: ['sr-intake-assistant'], queryFn: getSrIntakeAssistant })
  const rows = list.data ?? []
  const settings = intake.data
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('id') ?? ''
  const isNew = params.has('new')
  const first = useRef<{ key: string; sr?: SrDetail } | null>(null)
  const sending = useRef(false)
  const composer = useRef<ComposerHandle>(null)
  const [staging, setStaging] = useState<{ srId: string; fileIds: string[] }>({ srId: '', fileIds: [] })
  const stagedIds = staging.srId === selectedId ? staging.fileIds : []
  const sentMaterials = useRef<{ srId: string; fileIds: string[] } | null>(null)
  const [filter, setFilter] = useState<'active' | 'complete'>('active')
  const [busy, setBusy] = useState(false)
  const [convert, setConvert] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const selectedQuery = useQuery({ queryKey: ['sr', selectedId], queryFn: () => getSr(selectedId), enabled: !!selectedId })
  const selected = selectedQuery.data
  const { data: messages = [] } = useQuery({ queryKey: ['messages', selected?.threadId], queryFn: ({ signal }) => getMessages(selected!.threadId, signal), enabled: !!selected?.threadId })
  const chat = useChat(selected?.threadId, undefined, undefined, () => {
    const sent = sentMaterials.current
    if (!sent) return
    sentMaterials.current = null
    setStaging(current => current.srId === sent.srId ? { ...current, fileIds: current.fileIds.filter(id => !sent.fileIds.includes(id)) } : current)
  })
  // 첫 응답이 시작되기 전(생성·업로드·스트림 대기)에도 요청 전환을 막아 후속 입력이 다른 요청으로 새지 않게 한다.
  const locked = busy || chat.sending
  // started 전에는 입력도 닫는다(ChatView와 같은 규칙) — 열려 있으면 대기 중 attempt가 재사용되어 새 입력이 버려진다.
  const awaitingStart = chat.sending && !chat.run
  useEffect(() => { if (messages.length) void client.invalidateQueries({ queryKey: ['sr'] }) }, [client, messages.length, selectedId])
  const refresh = () => { void client.invalidateQueries({ queryKey: ['sr'] }); void client.invalidateQueries({ queryKey: ['messages', selected?.threadId] }) }
  // 접히는 것은 기본 접힘 — 다른 요청으로 바꾸면 상태 이력도 다시 접는다
  const setSelectedId = (id: string) => { if (locked) return; first.current = null; setConvert(false); setHistoryOpen(false); setParams(id ? { id } : {}) }
  const newRequest = () => { if (locked) return; first.current = { key: newId() }; setConvert(false); setHistoryOpen(false); setParams({ new: '1' }) }
  const stagedFiles = new Map(useSrFiles(stagedIds).map(file => [file.id, file]))
  const unstage = (fileId: string) => setStaging(current => ({ ...current, fileIds: current.fileIds.filter(id => id !== fileId) }))
  // SR 자료함에서 첨부한 파일은 입력창 위 칩으로 — 직접 올린 파일 칩과 같은 줄
  const attachments: AttachmentChip[] = stagedIds.map(id => ({ key: id, kind: 'file', label: stagedFiles.get(id)?.name ?? t('chat.checkingFile'), disabled: locked, onRemove: () => unstage(id) }))
  async function send(text: string, attachments: PendingAttachment[]) {
    if (sending.current || (!text.trim() && !attachments.length && !stagedIds.length) || !settings?.srIntakeAssistantId) return
    sending.current = true; setBusy(true)
    try {
      if (selected && chat.hasPendingAttempt()) { await chat.send(text.trim()); return }
      const attempt = first.current ?? { key: newId() }
      if (!selected) first.current = attempt
      const sr = selected ?? attempt.sr ?? await createSr(attempt.key)
      if (!selected) attempt.sr = sr
      const captured = [...stagedIds]
      const ids: string[] = [...captured]
      for (const attachment of attachments) {
        if (!attachment.uploadedId || attachment.uploadedTaskId !== sr.id) {
          attachment.uploadedId = (await uploadSrFile(sr.id, attachment.file)).id
          attachment.uploadedTaskId = sr.id
        }
        ids.push(attachment.uploadedId)
      }
      if (selected) {
        sentMaterials.current = { srId: sr.id, fileIds: captured }
        await chat.send(text.trim(), [...new Set(ids)])
      }
      else {
        queueFirstRequest(sr.threadId, { content: text.trim(), attachmentIds: ids, oneShotFileIds: [] })
        client.setQueryData(['sr', sr.id], sr)
        setParams({ id: sr.id })
        first.current = null
      }
      setStaging(current => current.srId === sr.id ? { ...current, fileIds: current.fileIds.filter(id => !captured.includes(id)) } : current)
      refresh()
    } finally { sending.current = false; setBusy(false) }
  }
  const closed = selected?.status === 'done' || selected?.status === 'rejected'
  const canEdit = selected && (selected.requesterId === me.id || me.roles.includes('system_owner'))
  const hasDetail = !!selectedId || isNew
  const visible = rows.filter(sr => filter === 'complete' ? sr.status === 'done' || sr.status === 'rejected' : sr.status !== 'done' && sr.status !== 'rejected')
  // 첫 질문 예시는 SO가 에이전트 usageExample에 인용한 목록 항목, 없으면 접수 에이전트 모델이 만든 추천 질문 — 플랫폼이 지은 예시는 없다. 카드 칩과 Composer 제안이 같은 결과를 쓴다.
  const examples = exampleQuestionsFrom(settings?.usageExample, settings?.suggestedQuestions)
  const loaded = !!list.data && !!settings
  // 요청이 하나도 없으면 목록 칸 없이 소개 카드·새 요청 대화가 남는 폭을 쓴다
  const intro = loaded && rows.length === 0 && !!settings.srIntakeAssistantId
  const failed = list.isError || intake.isError
  const retry = () => { if (list.isError) void list.refetch(); if (intake.isError) void intake.refetch() }
  const empty = <div className="mx-auto max-w-md space-y-2 py-8 text-center"><h2 className="font-semibold">{settings?.name || t('sr.intakeAgent')}</h2><p className="text-sm text-muted-foreground">{settings?.summary || t('sr.intakeSummary')}</p><p className="text-sm text-muted-foreground">{t('sr.attachmentHint')}</p></div>
  return <><TopBar title={t('nav.sr')} /><p className="px-4 pt-3 text-sm text-muted-foreground">{t('sr.intakeDescription')}</p>
    <div className={`grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 ${intro ? '' : 'lg:grid-cols-[18rem_1fr]'}`}>
      <aside className={`${hasDetail ? intro ? 'hidden' : 'hidden lg:block' : ''} space-y-3 overflow-y-auto`}>
        {failed ? <SrLoadError error={list.error ?? intake.error} retrying={list.isFetching || intake.isFetching} onRetry={retry} /> : !loaded ? <SrSkeleton /> : <>
          {settings.srIntakeAssistantId ? <Button data-tour="sr-new" onClick={newRequest} disabled={locked}>{t('sr.newRequest')}</Button> : <p role="status" className="text-sm">{t('sr.noIntake')}{me.roles.includes('system_owner') && <> · <Link to="/settings" className="underline">{t('sr.settingsLink')}</Link></>}</p>}
          {rows.length === 0 ? (settings.srIntakeAssistantId ? <EmptyState icon={Bot} title={settings.name ?? ''} description={settings.summary || undefined}>
            {examples.length > 0 && <ul aria-label={t('sr.exampleQuestions')} className="flex flex-wrap justify-center gap-1">{examples.map(example => <li key={example}><Chip label={example} /></li>)}</ul>}
          </EmptyState> : <EmptyState icon={Inbox} title={t('sr.noRequests')} />) : <>
            <div className="flex gap-2">{(['active', 'complete'] as const).map(value => <Chip key={value} variant="filter" label={t(`sr.${value}`)} selected={filter === value} onClick={() => setFilter(value)} />)}</div>
            {visible.length === 0 ? <EmptyState icon={SearchX} title={t('sr.noMatchingStatus')} action={filter !== 'active' && <Button size="sm" variant="outline" onClick={() => setFilter('active')}>{t('sr.resetFilter')}</Button>} />
              : <SrList rows={visible} selectedId={selectedId} disabled={locked} onSelect={setSelectedId} />}
          </>}
        </>}
      </aside>
      <div className={`${hasDetail ? 'flex' : intro ? 'hidden' : 'hidden lg:flex'} min-h-0 flex-col gap-4 overflow-y-auto`}>
        {hasDetail && <Button variant="ghost" className="self-start lg:hidden" disabled={locked} onClick={() => setSelectedId('')}>{t('sr.back')}</Button>}
        {selected ? <>
          <header className="space-y-2"><div className="flex flex-wrap items-center gap-2"><SrStatusBadge status={selected.status} /><span>{selected.code || t('status.sr.draft')}</span>
            {canEdit ? <SrTitleEditor key={selected.id} sr={selected} onSaved={refresh} /> : <h1 className="font-semibold">{selected.title}</h1>}
            {canEdit && (selected.status !== 'draft' || messages.some(message => message.role === 'user')) && <Button className="ml-auto" onClick={() => setConvert(true)}>{t(selected.status === 'draft' ? 'sr.convert' : srStage(selected.status) === 'submitted' ? 'sr.editContent' : 'sr.viewContent')}</Button>}
          </div>
            <div className="flex flex-wrap items-center gap-2"><ol aria-label={t('sr.steps')} className="flex flex-wrap gap-2 text-xs text-muted-foreground">{steps.map((step, index) => <li key={step} aria-current={srStage(selected.status) === step ? 'step' : undefined} className={srStage(selected.status) === step ? 'font-semibold text-primary' : ''}>{index > 0 && <span aria-hidden>→ </span>}{t(`status.sr.${step}`)}</li>)}</ol>
              {selected.status !== 'draft' && <Button variant="ghost" size="xs" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>{t('srFlow.statusHistory')}</Button>}</div>
            {historyOpen && <SrStatusHistory history={selected.statusHistory ?? []} />}
          </header>
          <SharedResults results={selected.results} />
          {selected.candidateAttachmentIds.length > 0 && <section data-testid="sr-materials-library" className="space-y-2 rounded-lg border p-2">
            <h2 className="flex items-center gap-1 text-sm font-medium">{t('task.materials.library')} · {selected.candidateAttachmentIds.length}<HelpTip text={t('sr.materialsHelp')} /></h2>
            <SrAttachments ids={selected.candidateAttachmentIds} renderActions={file => {
              const attached = stagedIds.includes(file.id)
              return <AttachToggle attached={attached} label={file.name} disabled={closed || locked || (!attached && stagedIds.length >= (settings?.fileMaxPerRequest ?? FILE_MAX_PER_REQUEST))}
                onToggle={() => attached ? unstage(file.id) : setStaging({ srId: selected.id, fileIds: [...stagedIds, file.id] })} />
            }} />
          </section>}
          {selected.status !== 'draft' && <section className="space-y-2 rounded-lg border p-3"><h2 className="font-medium">{t('sr.content')}</h2><p className="whitespace-pre-wrap text-sm">{selected.body}</p>{selected.attachmentIds.length > 0 && <SrAttachments ids={selected.attachmentIds} />}</section>}
        </> : selectedQuery.isError ? <p role="alert">{String(selectedQuery.error)}</p> : !isNew && !intro && <p className="text-sm text-muted-foreground">{t('sr.selectRequest')}</p>}
        {(selected || isNew) && <FileDropZone data-testid="sr-dropzone" className="flex min-h-0 flex-1 flex-col gap-4" label={t('dropzone.toAttach')} disabled={!settings?.srIntakeAssistantId || closed || locked} onFiles={files => composer.current?.dropFiles(files)}>
          <section className="min-h-72 flex-1 space-y-4 overflow-y-auto rounded-lg border p-3" aria-label={t('sr.conversation')}>
            <ChatMessages messages={messages} run={chat.run} empty={empty} actions={message => ({ intake: true, assistantName: settings?.name || t('sr.intakeAgent'), onRetry: message.requestId && message.status === 'error' ? () => { void chat.retry(message.requestId!).catch(error => toast.error(String(error))) } : undefined })} />
          </section>
          {closed ? <p role="status" className="text-sm text-muted-foreground">{t('sr.closed')}</p> : <Composer ref={composer} key={selectedId || 'new'} attachments={attachments} maxAttachments={settings?.fileMaxPerRequest ?? FILE_MAX_PER_REQUEST} stagedAttachmentCount={stagedIds.length} inputLabel={t('sr.message')} placeholder={t('sr.messagePlaceholder')} disabled={busy || awaitingStart || !settings?.srIntakeAssistantId} streaming={!!chat.run} allowAttachments onSend={send} onStop={() => { void chat.stop() }} suggestions={!messages.length && examples.length > 0 ? examples : undefined} />}
          {selected?.status === 'draft' && canEdit && !selected.hasRequests && <Button variant="ghost" className="self-start" onClick={() => setDeleting(true)}>{t('sr.deleteDraft')}</Button>}
        </FileDropZone>}
        {selected && <><SrConvertSheet sr={selected} open={convert} onOpenChange={setConvert} onSaved={refresh} /><ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t('sr.deleteConfirm')} description={t('sr.deleteDescription')} confirmLabel={t('sr.deleteDraft')} onConfirm={async () => { try { await deleteSr(selected.id); setSelectedId(''); refresh() } catch (error) { toast.error(String(error)); throw error } }} /></>}
      </div>
    </div>
  </>
}
