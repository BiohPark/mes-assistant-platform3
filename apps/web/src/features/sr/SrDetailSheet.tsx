import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { startSrTask, statusSr, type SrDetail } from '@/api/sr'
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

export function SrDetailSheet({ sr, onSaved }: { sr: SrDetail; onSaved: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const { data: messages = [] } = useQuery({ queryKey: ['messages', sr.threadId], queryFn: ({ signal }) => getMessages(sr.threadId, signal), enabled: !!sr.threadId && !sr.intakeMessages })
  const users = useUserMap()
  const me = useMe()
  const [assistantId, setAssistantId] = useState('')
  const [candidates, setCandidates] = useState<SrDetail['conversations']>([])
  const [shareOpen, setShareOpen] = useState(false)
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
  return <div className="space-y-4 rounded-lg border p-4"><header><h2 className="text-lg font-semibold">{sr.code} {sr.title}</h2>
    <p className="text-sm text-muted-foreground">{t('sr.requesterStatus', { name: sr.requesterName || users.get(sr.requesterId)?.name || t('sr.requester'), status: t(`status.sr.${sr.status}`) })}</p></header>
    <SrStatusBadge status={sr.status} />
    <section><h3 className="font-medium">{t('sr.content')}</h3><p className="whitespace-pre-wrap text-sm">{sr.body}</p></section>
    <section className="space-y-2"><h3 className="font-medium">{t('sr.attachments')}</h3><SrAttachments ids={sr.attachmentIds} /></section>
    <section aria-label={t('sr.conversation')} className="space-y-3"><h3 className="font-medium">{t('sr.conversation')}</h3>{(sr.intakeMessages ?? messages).map(message => <MessageBubble key={message.id} message={message} intake assistantName={t('sr.intakeAgent')} />)}</section>
    <div className="flex gap-2"><select aria-label={t('sr.status')} value={sr.status} onChange={async (event) => { try { await statusSr(sr.id, event.target.value); onSaved() } catch (error) { toast.error(String(error)) } }} className="rounded-lg border p-2 text-sm">
      {(['submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected'] as const).map((status) => <option key={status} value={status}>{t(`status.sr.${status}`)}</option>)}
    </select><Button onClick={() => setShareOpen(true)} disabled={sr.status === 'draft'}>{t('sr.shareResult')}</Button></div>
    {sr.conversations.length > 0 && <div><h3 className="font-medium">{t('sr.linkedTasks')}</h3>{sr.conversations.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block text-sm text-primary underline">{item.code} {item.title} ({t(TASK_STATUS_KEY[item.status as TaskStatus])})</Link>)}</div>}
    <div className="flex flex-wrap gap-2"><AssistantPicker mode="single" source={assistantSource} quickPicks={options}
      value={options.find(option => option.value === assistantId) ?? null} onChange={option => setAssistantId(option?.value ?? '')}
      aria-label={t('sr.linkedAssistant')} className="min-w-48 flex-1" />
      <Button onClick={() => start()} disabled={!assistantId || sr.status === 'draft'}>{t('sr.startTask')}</Button></div>
    {candidates.length > 0 && <div className="rounded-xl border p-3 text-sm"><p>{t('sr.activeCandidates')}</p>
      {candidates.map((item) => <Link key={item.id} to={`/c/${item.id}`} className="block text-primary underline">{t('sr.continueTask', { code: item.code })}</Link>)}
      <Button variant="outline" onClick={() => start(true)}>{t('sr.newTask')}</Button></div>}
    <SharedResults results={sr.results} />
    {me.roles.includes('system_owner') && <SrTitleEditor sr={sr} onSaved={onSaved} />}
    <ShareResultDialog sr={sr} open={shareOpen} onOpenChange={setShareOpen} onSaved={onSaved} />
  </div>
}
