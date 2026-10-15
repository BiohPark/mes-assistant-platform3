import { useCallback, useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { startSrTask, statusSr, type SrDetail } from '@/api/sr'
import { isSrClosed, srElapsedDays, srReasonRequired, srStage, type Message, type SrManualStatus } from '@mes/domain'
import { ReasonDialog } from '@/components/ReasonDialog'
import { SrStatusHistory } from './SrStatusHistory'
import { listAssistants } from '@/lib/catalog'
import { AssistantPicker } from '@/components/AssistantPicker'
import { Button } from '@/components/ui/button'
import { SrTitleEditor } from './SrTitleEditor'
import { SharedResults } from './SharedResults'
import { ShareResultDialog } from './ShareResultDialog'
import { useT } from '@/i18n'
import { useUserMap } from '@/app/hooks'
import { TASK_STATUS_KEY } from '@/lib/labels'
import type { TaskStatus } from '@mes/domain'
import { MessageBubble } from '@/features/chat/MessageBubble'
import { getMessages } from '@/api/tasks'
import { SrAttachments } from './SrAttachments'
import { SrStatusBadge } from '@/components/StatusBadges'
import { useMe } from '@/app/auth'
import { useDates } from '@/lib/dates'

export function SrDetailSheet({ sr, onSaved }: { sr: SrDetail; onSaved: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { formatDate } = useDates()
  const contentId = useId()
  const { data: messages = [] } = useQuery({ queryKey: ['messages', sr.threadId], queryFn: ({ signal }) => getMessages(sr.threadId, signal), enabled: !!sr.threadId && !sr.intakeMessages })
  const users = useUserMap()
  const me = useMe()
  const [assistantId, setAssistantId] = useState('')
  const [candidates, setCandidates] = useState<SrDetail['conversations']>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [reasonFor, setReasonFor] = useState<'done' | 'rejected' | null>(null)
  const stage = srStage(sr.status)
  const progressStage = stage === 'responded' ? 'in_progress' : stage
  // 접수됨·처리 중·결과 공유는 자동 전환 전용. 사람은 완료·반려와, 닫힌 SR을 다시 열기만 한다.
  const closed = isSrClosed(sr.status)
  async function changeStatus(status: SrManualStatus, reason?: string) {
    try { await statusSr(sr.id, status, reason); toast.success(t('srFlow.statusChanged', { status: t(`status.sr.${status}`) })); onSaved(); return true }
    catch (error) { toast.error(String(error)); return false }
  }
  const pick = (status: SrManualStatus) => { if (srReasonRequired(status)) setReasonFor(status as 'done' | 'rejected'); else void changeStatus(status) }
  const { data: assistants = [] } = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const options = useMemo(() => assistants.map(item => ({ value: item.id, label: item.name, status: item.status })), [assistants])
  const assistantSource = useCallback(() => options, [options])
  async function start(forceNew = false) {
    if (!assistantId) return
    try {
      const result = await startSrTask(sr.id, assistantId, forceNew)
      if (result.candidates) setCandidates(result.candidates)
      else if (result.id) { setCandidates([]); onSaved(); void navigate(`/c/${result.id}`) }
    } catch (error) { toast.error(String(error)) }
  }
  return <div className="min-w-0 space-y-4 rounded-lg border p-4 [overflow-wrap:anywhere]">
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 break-words text-lg font-semibold">{sr.code} {sr.title}</h2><SrStatusBadge status={sr.status} /></div>
      <p className="break-words text-sm text-muted-foreground">{t('sr.requesterStatus', { name: sr.requesterName || users.get(sr.requesterId)?.name || t('sr.requester'), status: t(`status.sr.${stage}`) })}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t('sr.submittedTime')} <time dateTime={sr.submittedAt}>{formatDate(sr.submittedAt, 'yyyy-MM-dd HH:mm')}</time></span>
        <span>{t('sr.elapsedDays')} {t('sr.elapsedDaysValue', { days: sr.elapsedDays ?? srElapsedDays(sr.submittedAt) })}</span>
      </div>
    </header>
    <div className="flex flex-wrap items-start gap-2">
      <div className="flex min-w-0 basis-full flex-wrap items-start gap-2 sm:basis-auto sm:flex-1"><AssistantPicker mode="single" source={assistantSource} quickPicks={options}
        value={options.find(option => option.value === assistantId) ?? null} onChange={option => setAssistantId(option?.value ?? '')}
        aria-label={t('sr.linkedAssistant')} className="min-w-0 basis-48 flex-1" />
        <Button onClick={() => start()} disabled={!assistantId || sr.status === 'draft'}>{t('sr.startTask')}</Button></div>
      {sr.status !== 'draft' && (closed
        ? <Button variant="outline" onClick={() => pick('in_progress')}>{t('srFlow.reopen')}</Button>
        : <><Button onClick={() => pick('done')}>{t('srFlow.complete')}</Button><Button variant="outline" onClick={() => pick('rejected')}>{t('srFlow.reject')}</Button></>)}
      <Button variant="outline" onClick={() => setShareOpen(true)} disabled={sr.status === 'draft'}>{t('sr.shareResult')}</Button>
    </div>
    {candidates.length > 0 && <div className="space-y-2 rounded-xl border p-3 text-sm"><p>{t('sr.activeCandidates')}</p>
      {candidates.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block break-words text-primary underline">{t('sr.continueTask', { code: item.code })}</Link>)}
      <Button variant="outline" onClick={() => start(true)}>{t('sr.newTask')}</Button></div>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <ol aria-label={t('sr.steps')} className="flex shrink-0 gap-2">{(['submitted', 'in_progress', 'done'] as const).map((step, index) => <li key={step} aria-current={progressStage === step ? 'step' : undefined} className={progressStage === step ? 'font-semibold text-primary' : ''}>{index > 0 && <span aria-hidden>→ </span>}{t(`status.sr.${step}`)}</li>)}</ol>
      <p>{t('srFlow.compactAutoHint')}</p>
    </div>
    <section aria-labelledby={contentId} className="min-w-0 space-y-3 rounded-lg border bg-card p-3">
      <h3 id={contentId} className="font-medium">{t('sr.content')}</h3>
      <p className="whitespace-pre-wrap break-words text-sm">{sr.body}</p>
      <div className="min-w-0 space-y-2"><h4 className="text-xs font-medium text-muted-foreground">{t('sr.attachments')}</h4><SrAttachments ids={sr.attachmentIds} compact /></div>
    </section>
    {sr.conversations.length > 0 && <section className="min-w-0 space-y-1"><h3 className="font-medium">{t('sr.linkedTasks')}</h3>{sr.conversations.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block break-words text-sm text-primary underline">{item.code} {item.title} ({t(TASK_STATUS_KEY[item.status as TaskStatus])})</Link>)}</section>}
    <SharedResults results={sr.results} />
    <IntakeConversation key={sr.id} messages={sr.intakeMessages ?? messages} />
    <section className="space-y-1"><h3 className="font-medium">{t('srFlow.statusHistory')}</h3><SrStatusHistory key={sr.id} history={sr.statusHistory ?? []} compact /></section>
    {me.roles.includes('system_owner') && <SrTitleEditor sr={sr} onSaved={onSaved} />}
    <ShareResultDialog sr={sr} open={shareOpen} onOpenChange={setShareOpen} onSaved={onSaved} />
    {reasonFor && <ReasonDialog open onOpenChange={(open) => { if (!open) setReasonFor(null) }} title={t(reasonFor === 'done' ? 'srFlow.doneReasonTitle' : 'srFlow.rejectedReasonTitle')} description={t('srFlow.reasonDescription')} onConfirm={(reason) => changeStatus(reasonFor, reason)} />}
  </div>
}

function IntakeConversation({ messages }: { messages: Message[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="min-w-0 space-y-3">
    <Button variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{t('sr.viewIntake', { count: messages.length })}</Button>
    <section id={id} aria-label={t('sr.conversation')} hidden={!open} className="min-w-0 space-y-3">
      {open && messages.map(message => <IntakeMessage key={message.id} message={message} />)}
    </section>
  </div>
}

function IntakeMessage({ message }: { message: Message }) {
  const t = useT()
  const { formatDateTime } = useDates()
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  if (message.role !== 'assistant') return <MessageBubble message={message} intake assistantName={t('sr.intakeAgent')} />
  return <div className="min-w-0 space-y-1">
    <div id={id}>
      {expanded ? <MessageBubble message={message} intake assistantName={t('sr.intakeAgent')} /> : <div className="space-y-1 rounded-lg border bg-card p-3">
        <p className="text-xs text-muted-foreground">{t('sr.intakeAgent')} · {formatDateTime(message.createdAt)}</p>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{message.content}</p>
      </div>}
    </div>
    <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'sr.collapse' : 'sr.expand')}</Button>
  </div>
}
