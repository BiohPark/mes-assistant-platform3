import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { appendMessage, getMessages, setTaskStatus } from '@/api/tasks'
import { setInput, uploadFile } from '@/api/files'
import { estimateRequest, getRequest, type RequestRecord } from '@/api/requests'
import { subscribeEvent } from '@/app/useEvents'
import { useActor, useCurrentUserId } from '@/app/hooks'
import { ReasonDialog } from '@/components/ReasonDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Composer, type ComposerHandle, type PendingAttachment } from './Composer'
import { FileDropZone } from '@/components/FileDropZone'
import { ChatMessages } from './ChatMessages'
import { SaveAsOutputDialog } from './SaveAsOutputDialog'
import { RequestInfoDialog } from './RequestInfoDialog'
import { RetryFilesDialog } from './RetryFilesDialog'
import { useChat } from './useChat'
import { ContextTray } from './ContextTray'
import { useRequestEstimate } from './useRequestEstimate'
import { getDraft } from './drafts'
import { toast } from 'sonner'
import { useConversationViewed } from '@/lib/conversationRead'
import { useT } from '@/i18n'

export function ChatView({ task, assistant, onOpenMaterials }: { task: Task; assistant?: Assistant; onOpenMaterials?: () => void }) {
  const t = useT()
  const actor = useActor()
  const selfId = useCurrentUserId()
  const query = useQueryClient()
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState(() => getDraft(task.id)?.text ?? '')
  const [questionIndexContainer, setQuestionIndexContainer] = useState<HTMLDivElement | null>(null)
  const [askTarget, setAskTarget] = useState<Message | null>(null)
  const [prefilled, setPrefilled] = useState(false)
  const askOpener = useRef<HTMLElement | null>(null)
  const confirmedAsk = useRef(false)
  const sendLock = useRef(false)
  const [reopenForSend, setReopenForSend] = useState(false)
  // 재개 확인 안내는 실제로 보낼 것과 같아야 한다 — 보관된 시도가 있으면 그것을 다시 보낸다
  const [reopenResendsStored, setReopenResendsStored] = useState(false)
  const reopenDecision = useRef<((accepted: boolean) => void) | null>(null)
  useEffect(() => () => { reopenDecision.current?.(false) }, [])
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const lastTyping = useRef(0)
  const composer = useRef<ComposerHandle>(null)
  const [saveTarget, setSaveTarget] = useState<Message | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [retryChoice, setRetryChoice] = useState<{ record: RequestRecord; mode: 'exclude' | 'inline' } | null>(null)
  const chat = useChat(task.threadId, holdReleased)
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: ({ signal }) => getMessages(task.threadId!, signal), enabled: !!task.threadId,
  })
  useConversationViewed(selfId, task.id, task.lastActivityAt)
  const remoteRequestId = messages.data?.find((item) => item.status === 'streaming' && item.requestId !== chat.run?.requestId)?.requestId
  const remoteRequest = useQuery({ queryKey: ['request', remoteRequestId], queryFn: () => getRequest(remoteRequestId!), enabled: !!remoteRequestId })
  const remoteStreaming = !!remoteRequestId
  const remoteReply = messages.data?.find(item => item.status === 'streaming' && item.requestId === remoteRequestId)
  const visibleRun = chat.run ?? (remoteReply && remoteRequestId ? { requestId: remoteRequestId, replyId: remoteReply.id,
    text: remoteReply.content, reasoning: remoteReply.reasoning ?? '', phase: remoteRequest.data?.phase ?? undefined,
    startedAt: Date.parse(remoteRequest.data?.createdAt ?? remoteReply.createdAt) } : null)
  // 보관된 실패 시도가 있으면 다음 전송은 그 시도를 그대로 재전송하므로, 다른 텍스트를 프리필하면 화면과 전송 내용이 어긋난다.
  const pendingAttempt = chat.hasPendingAttempt()
  const askAgainDisabled = task.status === 'done' || !task.threadId || sending || chat.sending || !!chat.run || remoteStreaming || pendingAttempt
  useEffect(() => { if (askAgainDisabled) setAskTarget(null) }, [askAgainDisabled])
  function prefill(message: Message) {
    if (askAgainDisabled || sendLock.current) return
    composer.current?.setText(message.content)
    setPrefilled(true)
  }
  function askAgain(message: Message) {
    if (askAgainDisabled || sendLock.current) return
    if (draft.length) {
      askOpener.current = document.activeElement as HTMLElement | null
      confirmedAsk.current = false
      setAskTarget(message)
    } else prefill(message)
  }
  const revision = JSON.stringify({ inputs: task.inputs, modelId: task.modelId, messages: messages.data?.map((item) => [item.id, item.status, item.content.length]) })
  const estimate = useRequestEstimate(task.threadId, draft, revision, !!task.threadId)
  useEffect(() => {
    const unsubscribe = subscribeEvent(({ event, data }) => {
      if (event !== 'presence.typing' || data.threadId !== task.threadId || data.userId === selfId ||
        typeof data.userId !== 'string' || typeof data.name !== 'string' || typeof data.until !== 'string') return
      setTyping((current) => ({ ...current, [data.userId as string]: { name: data.name as string, until: Date.parse(data.until as string) } }))
    })
    const timer = window.setInterval(() => setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value.until > Date.now()))), 1_000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [task.threadId, selfId])
  function notifyTyping() {
    if (!task.threadId || Date.now() - lastTyping.current < 3_000) return
    lastTyping.current = Date.now()
    void fetch(`/api/threads/${encodeURIComponent(task.threadId)}/typing`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
  }
  function refreshProgress() {
    void query.invalidateQueries({ queryKey: ['task', task.id] })
    void query.invalidateQueries({ queryKey: ['tasks'] })
    void query.invalidateQueries({ queryKey: ['activity', task.id] })
  }
  /** 서버가 확정한 상태를 즉시 반영한다 — 느린 재조회를 기다리지 않고 헤더(보류/재개)가 바로 바뀐다 */
  function markStatus(status: Task['status']) {
    query.setQueryData<Task>(['task', task.id], (current) => current && { ...current, status })
  }
  function holdReleased() {
    markStatus('in_progress')
    refreshProgress()
    // 되돌리기 동작이 있는 알림 — 기본 4초는 읽고 누르기에 짧다
    toast.success(t('task.progress.holdReleased'), { duration: 10_000, action: { label: t('task.header.hold'), onClick: () => {
      void setTaskStatus(actor, task.id, 'on_hold').then(() => { markStatus('on_hold'); refreshProgress() }).catch(error => toast.error(error instanceof Error ? error.message : t('chat.sendFailed')))
    } } })
  }
  async function confirmReopen(reason: string) {
    try {
      await setTaskStatus(actor, task.id, 'in_progress', { reason })
      refreshProgress()
      reopenDecision.current?.(true)
      reopenDecision.current = null
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.sendFailed'))
      return false
    }
  }
  async function beforeSend(discussion = false) {
    if (sendLock.current) return false
    if (task.status !== 'done') return true
    setReopenResendsStored(!discussion && chat.hasPendingAttempt())
    setSending(true)
    try {
      return await new Promise<boolean>(resolve => { reopenDecision.current = resolve; setReopenForSend(true) })
    } finally { setSending(false) }
  }
  async function send(text: string, attachments: PendingAttachment[], discussion: boolean) {
    if ((!text.trim() && !attachments.length) || !task.threadId || sendLock.current) return false
    sendLock.current = true
    const content = text.trim()
    setSending(true)
    try {
      const stored = discussion ? null : chat.pendingAttempt()
      if (stored) {
        // 보관된 시도를 그대로 다시 보낸다(안내와 같음). 그 시도에 없던 글·첨부는 보내지 않았으므로 입력창에 남긴다
        await chat.send(content)
        const same = content === stored.text && attachments.every((item) => item.uploadedId && item.uploadedTaskId === task.id && stored.attachmentIds.includes(item.uploadedId))
        if (same) return
        toast.info(t('chat.pendingAttemptDraftKept'))
        return false
      }
      const uploaded = []
      for (const attachment of attachments) {
        if (!attachment.uploadedId || attachment.uploadedTaskId !== task.id) {
          const file = await uploadFile(actor, { taskId: task.id }, attachment.file)
          attachment.uploadedId = file.id
          attachment.uploadedTaskId = task.id
        }
        uploaded.push(attachment.uploadedId)
        if (discussion && !attachment.once) await setInput(actor, task.id, attachment.uploadedId, 'reference')
      }
      if (!discussion) {
        const preview = await estimateRequest(task.threadId, { draft: content, attachmentIds: uploaded,
          oneShotFileIds: uploaded.filter((_id, index) => attachments[index]?.once) })
        if (preview.overLimit) throw new Error(t('chat.overLimitError', { bytes: String(preview.bytes), limit: String(preview.limitBytes) }))
      }
      if (discussion) {
        const accepted = await appendMessage(actor, task.threadId, 'user', content, uploaded, 'done', 'discussion') as Message & { autoStarted?: boolean }
        if (accepted.autoStarted) holdReleased()
        refreshProgress()
      } else await chat.send(content, uploaded, uploaded.filter((_id, index) => attachments[index]?.once))
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
      setPrefilled(false)
    } finally { sendLock.current = false; setSending(false) }
  }
  async function retry(requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) {
    setSending(true)
    try {
      if (!await beforeSend()) return
      setSending(true)
      await chat.retry(requestId, options)
    } catch (error) { toast.error(error instanceof Error ? error.message : t('chat.retryFailed')) }
    finally { setSending(false); setRetryChoice(null) }
  }
  async function chooseRetry(requestId: string, mode: 'exclude' | 'inline') {
    try { setRetryChoice({ record: await getRequest(requestId), mode }) }
    catch { toast.error(t('chat.requestLoadFailed')) }
  }
  return <><FileDropZone data-testid="chat-dropzone" className="flex min-h-0 flex-1 flex-col" label={t('dropzone.toAttach')} disabled={sending} onFiles={(files) => composer.current?.dropFiles(files)}>
    <div ref={setQuestionIndexContainer} data-testid="chat-question-toolbar" className="shrink-0 border-b px-4 py-2 empty:hidden" />
    <div data-testid="chat-message-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
    <ChatMessages key={task.id} assistantName={assistant?.name} messages={messages.data ?? []} run={visibleRun} waitingSince={chat.waitingSince} questionIndexContainer={questionIndexContainer} empty={messages.isSuccess && <div className="mx-auto mt-10 max-w-md space-y-3 text-center text-sm text-muted-foreground"><p>{t('chat.startConversation')}</p><p>{t('chat.emptyHint')}</p>{onOpenMaterials && <Button variant="outline" size="sm" onClick={onOpenMaterials}>{t('chat.openMaterials')}</Button>}</div>}
      actions={(item) => ({
        onAskAgain: item.role === 'user' && item.kind !== 'discussion' ? () => askAgain(item) : undefined,
        askAgainDisabled,
        onSaveAsOutput: item.role === 'assistant' && assistant && item.status === 'done' ? () => setSaveTarget(item) : undefined,
        onRequestInfo: item.requestId ? () => setInfoId(item.requestId!) : undefined,
        onRetry: item.requestId && item.status === 'error' ? () => { void retry(item.requestId!) } : undefined,
        onRetryWithoutFiles: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'exclude') } : undefined,
        onRetryAsText: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'inline') } : undefined,
      })} />
  </div>{Object.values(typing).some((item) => item.until > Date.now()) && <p className="px-4 py-1 text-xs text-muted-foreground">{t('chat.typing', { names: Object.values(typing).filter((item) => item.until > Date.now()).map((item) => item.name).join(', ') })}</p>}
  <ContextTray task={task} estimate={estimate} />
  {prefilled && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.askAgainHint')}</p>}
  {pendingAttempt && !sending && !chat.sending && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.pendingAttemptHint')}</p>}
  <Composer ref={composer} disabled={sending && !chat.run} streaming={!!chat.run || remoteStreaming} allowAttachments allowPin allowDiscussion
    blockedReason={task.status !== 'done' && estimate.currentData?.overLimit ? t('chat.overLimitBlocked') : undefined} onDraftChange={setDraft} onTyping={notifyTyping} draftKey={task.id}
    placeholder={assistant ? t('chat.composerPlaceholderFor', { assistant: assistant.name }) : undefined}
    beforeSend={beforeSend} onSend={send} onStop={() => { void chat.stop(chat.run?.requestId ?? messages.data?.find((item) => item.status === 'streaming')?.requestId) }} />
  {saveTarget && assistant && <SaveAsOutputDialog key={saveTarget.id} message={saveTarget} task={task} assistant={assistant} onOpenMaterials={onOpenMaterials} onClose={() => setSaveTarget(null)} />}</FileDropZone>
  <ReasonDialog key={String(reopenForSend)} open={reopenForSend} onOpenChange={open => {
    setReopenForSend(open)
    if (!open) { reopenDecision.current?.(false); reopenDecision.current = null }
  }} title={t('chat.reopenTitle')} description={t(reopenResendsStored ? 'chat.reopenStoredDescription' : 'chat.reopenDescription')} confirmLabel={t('task.header.reopenConfirm')} onConfirm={confirmReopen} />
  <ConfirmDialog open={!!askTarget} onOpenChange={(open) => { if (!open) setAskTarget(null) }} title={t('chat.replaceDraftTitle')}
    description={t('chat.replaceDraftDescription')} confirmLabel={t('chat.replaceDraftConfirm')} destructive={false}
    onConfirm={() => { if (askTarget && !askAgainDisabled) { confirmedAsk.current = true; prefill(askTarget) } }}
    onCloseAutoFocus={(event) => { event.preventDefault(); if (confirmedAsk.current) composer.current?.setText(draft); else askOpener.current?.focus() }} />
  {infoId && <RequestInfoDialog requestId={infoId} onClose={() => setInfoId(null)} />}
  {retryChoice && <RetryFilesDialog record={retryChoice.record} mode={retryChoice.mode} onClose={() => setRetryChoice(null)}
    onSubmit={(ids) => retry(retryChoice!.record.id, retryChoice!.mode === 'exclude' ? { excludeFileIds: ids } : { forceInlineFileIds: ids })} />}</>
}
