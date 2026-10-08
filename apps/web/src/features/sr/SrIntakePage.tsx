import { FILE_MAX_PER_REQUEST } from '@mes/contracts'
import { useT } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link, useSearchParams } from 'react-router'
import { createSr, deleteSr, getSr, getSrIntakeAssistant, listSr, uploadSrFile, type SrDetail } from '@/api/sr'
import { getMessages } from '@/api/tasks'
import { queueFirstRequest, useChat } from '@/features/chat/useChat'
import { ChatMessages } from '@/features/chat/ChatMessages'
import { Composer, type PendingAttachment } from '@/features/chat/Composer'
import { TopBar } from '@/app/TopBar'
import { Bot, Inbox, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/Chip'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { SrStatusBadge } from '@/components/StatusBadges'
import { newId } from '@/lib/ids'
import { SrList } from './SrList'
import { SrLoadError, SrSkeleton } from './SrStates'
import { SrTitleEditor } from './SrTitleEditor'
import { SrConvertSheet } from './SrConvertSheet'
import { SrStatusHistory } from './SrStatusHistory'
import { SharedResults } from './SharedResults'
import { SrAttachments } from './SrAttachments'
import { useMe } from '@/app/auth'

const steps = ['draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done'] as const

export function SrIntakePage() {
  const t = useT()
  const me = useMe()
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
  const [filter, setFilter] = useState<'active' | 'complete'>('active')
  const [busy, setBusy] = useState(false)
  const [convert, setConvert] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const selectedQuery = useQuery({ queryKey: ['sr', selectedId], queryFn: () => getSr(selectedId), enabled: !!selectedId })
  const selected = selectedQuery.data
  const { data: messages = [] } = useQuery({ queryKey: ['messages', selected?.threadId], queryFn: ({ signal }) => getMessages(selected!.threadId, signal), enabled: !!selected?.threadId })
  const chat = useChat(selected?.threadId)
  // 첫 응답이 시작되기 전(생성·업로드·스트림 대기)에도 요청 전환을 막아 후속 입력이 다른 요청으로 새지 않게 한다.
  const locked = busy || chat.sending
  // started 전에는 입력도 닫는다(ChatView와 같은 규칙) — 열려 있으면 대기 중 attempt가 재사용되어 새 입력이 버려진다.
  const awaitingStart = chat.sending && !chat.run
  useEffect(() => { if (messages.length) void client.invalidateQueries({ queryKey: ['sr'] }) }, [client, messages.length, selectedId])
  const refresh = () => { void client.invalidateQueries({ queryKey: ['sr'] }); void client.invalidateQueries({ queryKey: ['messages', selected?.threadId] }) }
  const setSelectedId = (id: string) => { if (locked) return; first.current = null; setConvert(false); setParams(id ? { id } : {}) }
  const newRequest = () => { if (locked) return; first.current = { key: newId() }; setConvert(false); setParams({ new: '1' }) }
  async function send(text: string, attachments: PendingAttachment[]) {
    if (sending.current || (!text.trim() && !attachments.length) || !settings?.srIntakeAssistantId) return
    sending.current = true; setBusy(true)
    try {
      if (selected && chat.hasPendingAttempt()) { await chat.send(text.trim()); return }
      const attempt = first.current ?? { key: newId() }
      if (!selected) first.current = attempt
      const sr = selected ?? attempt.sr ?? await createSr(attempt.key)
      if (!selected) attempt.sr = sr
      const ids: string[] = []
      for (const attachment of attachments) {
        if (!attachment.uploadedId || attachment.uploadedTaskId !== sr.id) {
          attachment.uploadedId = (await uploadSrFile(sr.id, attachment.file)).id
          attachment.uploadedTaskId = sr.id
        }
        ids.push(attachment.uploadedId)
      }
      if (selected) await chat.send(text.trim(), ids)
      else {
        queueFirstRequest(sr.threadId, { content: text.trim(), attachmentIds: ids, oneShotFileIds: [] })
        client.setQueryData(['sr', sr.id], sr)
        setParams({ id: sr.id })
        first.current = null
      }
      refresh()
    } finally { sending.current = false; setBusy(false) }
  }
  const closed = selected?.status === 'done' || selected?.status === 'rejected'
  const canEdit = selected && (selected.requesterId === me.id || me.roles.includes('system_owner'))
  const hasDetail = !!selectedId || isNew
  const visible = rows.filter(sr => filter === 'complete' ? sr.status === 'done' || sr.status === 'rejected' : sr.status !== 'done' && sr.status !== 'rejected')
  // 첫 질문 예시는 SO가 에이전트에 적은 usageExample 줄 단위 — 플랫폼이 지은 예시는 없다.
  const examples = (settings?.usageExample ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const loaded = !!list.data && !!settings
  const failed = list.isError || intake.isError
  const retry = () => { if (list.isError) void list.refetch(); if (intake.isError) void intake.refetch() }
  const empty = <div className="mx-auto max-w-md space-y-2 py-8 text-center"><h2 className="font-semibold">{settings?.name || t('sr.intakeAgent')}</h2><p className="text-sm text-muted-foreground">{settings?.summary || t('sr.intakeSummary')}</p></div>
  return <><TopBar title={t('nav.sr')} /><p className="px-4 pt-3 text-sm text-muted-foreground">{t('sr.intakeDescription')}</p>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[18rem_1fr]">
      <aside className={`${hasDetail ? 'hidden lg:block' : ''} space-y-3 overflow-y-auto`}>
        {failed ? <SrLoadError error={list.error ?? intake.error} retrying={list.isFetching || intake.isFetching} onRetry={retry} /> : !loaded ? <SrSkeleton /> : <>
          {settings.srIntakeAssistantId ? <Button onClick={newRequest} disabled={locked}>{t('sr.newRequest')}</Button> : <p role="status" className="text-sm">{t('sr.noIntake')}{me.roles.includes('system_owner') && <> · <Link to="/settings" className="underline">{t('sr.settingsLink')}</Link></>}</p>}
          {rows.length === 0 ? (settings.srIntakeAssistantId ? <EmptyState icon={Bot} title={settings.name ?? ''} description={settings.summary || undefined}>
            {examples.length > 0 && <ul aria-label={t('sr.exampleQuestions')} className="flex flex-wrap justify-center gap-1">{examples.map(example => <li key={example}><Chip label={example} /></li>)}</ul>}
          </EmptyState> : <EmptyState icon={Inbox} title={t('sr.noRequests')} />) : <>
            <div className="flex gap-2">{(['active', 'complete'] as const).map(value => <Chip key={value} variant="filter" label={t(`sr.${value}`)} selected={filter === value} onClick={() => setFilter(value)} />)}</div>
            {visible.length === 0 ? <EmptyState icon={SearchX} title={t('sr.noMatchingStatus')} action={filter !== 'active' && <Button size="sm" variant="outline" onClick={() => setFilter('active')}>{t('sr.resetFilter')}</Button>} />
              : <SrList rows={visible} selectedId={selectedId} disabled={locked} onSelect={setSelectedId} />}
          </>}
        </>}
      </aside>
      <div className={`${hasDetail ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col gap-4 overflow-y-auto`}>
        {hasDetail && <Button variant="ghost" className="self-start lg:hidden" disabled={locked} onClick={() => setSelectedId('')}>{t('sr.back')}</Button>}
        {selected ? <>
          <header className="space-y-2"><div className="flex flex-wrap items-center gap-2"><SrStatusBadge status={selected.status} /><span>{selected.code || t('status.sr.draft')}</span>
            {canEdit ? <SrTitleEditor key={selected.id} sr={selected} onSaved={refresh} /> : <h1 className="font-semibold">{selected.title}</h1>}
            {canEdit && (selected.status !== 'draft' || messages.some(message => message.role === 'user')) && <Button className="ml-auto" onClick={() => setConvert(true)}>{t(selected.status === 'draft' ? 'sr.convert' : selected.status === 'submitted' ? 'sr.editContent' : 'sr.viewContent')}</Button>}
          </div>
            <div className="flex flex-wrap items-center gap-2"><ol aria-label={t('sr.steps')} className="flex flex-wrap gap-2 text-xs text-muted-foreground">{steps.map((step, index) => <li key={step} aria-current={selected.status === step ? 'step' : undefined} className={selected.status === step ? 'font-semibold text-primary' : ''}>{index > 0 && <span aria-hidden>→ </span>}{t(`status.sr.${step}`)}</li>)}</ol>
              {selected.status !== 'draft' && <Button variant="ghost" size="xs" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>{t('srFlow.statusHistory')}</Button>}</div>
            {historyOpen && <SrStatusHistory history={selected.statusHistory ?? []} />}
          </header>
          <SharedResults results={selected.results} />
          {selected.status !== 'draft' && <section className="space-y-2 rounded-lg border p-3"><h2 className="font-medium">{t('sr.content')}</h2><p className="whitespace-pre-wrap text-sm">{selected.body}</p>{selected.attachmentIds.length > 0 && <SrAttachments ids={selected.attachmentIds} />}</section>}
        </> : selectedQuery.isError ? <p role="alert">{String(selectedQuery.error)}</p> : !isNew && <p className="text-sm text-muted-foreground">{t('sr.selectRequest')}</p>}
        {(selected || isNew) && <>
          <section className="min-h-40 flex-1 space-y-4 overflow-y-auto rounded-lg border p-3" aria-label={t('sr.conversation')}>
            <ChatMessages messages={messages} run={chat.run} empty={empty} actions={message => ({ intake: true, assistantName: settings?.name || t('sr.intakeAgent'), onRetry: message.requestId && message.status === 'error' ? () => { void chat.retry(message.requestId!).catch(error => toast.error(String(error))) } : undefined })} />
          </section>
          {closed ? <p role="status" className="text-sm text-muted-foreground">{t('sr.closed')}</p> : <Composer key={selectedId || 'new'} maxAttachments={settings?.fileMaxPerRequest ?? FILE_MAX_PER_REQUEST} inputLabel={t('sr.message')} placeholder={t('sr.messagePlaceholder')} disabled={busy || awaitingStart || !settings?.srIntakeAssistantId} streaming={!!chat.run} allowAttachments onSend={send} onStop={() => { void chat.stop() }} suggestions={!messages.length && examples.length > 0 ? examples : undefined} />}
          {selected?.status === 'draft' && canEdit && !selected.hasRequests && <Button variant="ghost" className="self-start" onClick={() => setDeleting(true)}>{t('sr.deleteDraft')}</Button>}
        </>}
        {selected && <><SrConvertSheet sr={selected} open={convert} onOpenChange={setConvert} onSaved={refresh} /><ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t('sr.deleteConfirm')} description={t('sr.deleteDescription')} confirmLabel={t('sr.deleteDraft')} onConfirm={async () => { try { await deleteSr(selected.id); setSelectedId(''); refresh() } catch (error) { toast.error(String(error)); throw error } }} /></>}
      </div>
    </div>
  </>
}
