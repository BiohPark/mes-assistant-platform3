import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { appendMessage, getMessages } from '@/api/tasks'
import { setInput, uploadFile } from '@/api/files'
import { estimateRequest, getRequest, type RequestRecord } from '@/api/requests'
import { subscribeEvent } from '@/app/useEvents'
import { useActor, useCurrentUserId } from '@/app/hooks'
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
import { toast } from 'sonner'
import { useT } from '@/i18n'

export function ChatView({ task, assistant, onOpenMaterials }: { task: Task; assistant?: Assistant; onOpenMaterials?: () => void }) {
  const t = useT()
  const actor = useActor()
  const selfId = useCurrentUserId()
  const query = useQueryClient()
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [questionIndexContainer, setQuestionIndexContainer] = useState<HTMLDivElement | null>(null)
  const [askTarget, setAskTarget] = useState<Message | null>(null)
  const [prefilled, setPrefilled] = useState(false)
  const askOpener = useRef<HTMLElement | null>(null)
  const confirmedAsk = useRef(false)
  const sendLock = useRef(false)
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const lastTyping = useRef(0)
  const composer = useRef<ComposerHandle>(null)
  const [saveTarget, setSaveTarget] = useState<Message | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [retryChoice, setRetryChoice] = useState<{ record: RequestRecord; mode: 'exclude' | 'inline' } | null>(null)
  const chat = useChat(task.threadId)
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: ({ signal }) => getMessages(task.threadId!, signal), enabled: !!task.threadId,
  })
  const remoteRequestId = messages.data?.find((item) => item.status === 'streaming' && item.requestId !== chat.run?.requestId)?.requestId
  const remoteRequest = useQuery({ queryKey: ['request', remoteRequestId], queryFn: () => getRequest(remoteRequestId!), enabled: !!remoteRequestId })
  const remoteStreaming = !!remoteRequestId
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
  async function send(text: string, attachments: PendingAttachment[], discussion: boolean) {
    if ((!text.trim() && !attachments.length) || !task.threadId || sendLock.current || task.status === 'done') return
    sendLock.current = true
    const content = text.trim()
    setSending(true)
    try {
      if (!discussion && chat.hasPendingAttempt()) {
        await chat.send(content)
        return
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
      if (discussion) await appendMessage(actor, task.threadId, 'user', content, uploaded, 'done', 'discussion')
      else await chat.send(content, uploaded, uploaded.filter((_id, index) => attachments[index]?.once))
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
      setPrefilled(false)
    } finally { sendLock.current = false; setSending(false) }
  }
  async function retry(requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) {
    setSending(true)
    try { await chat.retry(requestId, options) } catch (error) { toast.error(error instanceof Error ? error.message : t('chat.retryFailed')) }
    finally { setSending(false); setRetryChoice(null) }
  }
  async function chooseRetry(requestId: string, mode: 'exclude' | 'inline') {
    try { setRetryChoice({ record: await getRequest(requestId), mode }) }
    catch { toast.error(t('chat.requestLoadFailed')) }
  }
  return <><FileDropZone data-testid="chat-dropzone" className="flex min-h-0 flex-1 flex-col" label={t('dropzone.toAttach')} disabled={task.status === 'done'} onFiles={(files) => composer.current?.dropFiles(files)}>
    <div ref={setQuestionIndexContainer} data-testid="chat-question-toolbar" className="shrink-0 border-b px-4 py-2 empty:hidden" />
    <div data-testid="chat-message-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
    <ChatMessages messages={messages.data ?? []} run={chat.run} questionIndexContainer={questionIndexContainer} empty={messages.isSuccess && <div className="mx-auto mt-10 max-w-md space-y-3 text-center text-sm text-muted-foreground"><p>{t('chat.startConversation')}</p><p>{t('chat.emptyHint')}</p>{onOpenMaterials && <Button variant="outline" size="sm" onClick={onOpenMaterials}>{t('chat.openMaterials')}</Button>}</div>}
      actions={(item) => ({
        onAskAgain: item.role === 'user' && item.kind !== 'discussion' ? () => askAgain(item) : undefined,
        askAgainDisabled,
        onSaveAsOutput: item.role === 'assistant' && assistant && item.status === 'done' ? () => setSaveTarget(item) : undefined,
        onRequestInfo: item.requestId ? () => setInfoId(item.requestId!) : undefined,
        onRetry: item.requestId && item.status === 'error' ? () => { void retry(item.requestId!) } : undefined,
        onRetryWithoutFiles: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'exclude') } : undefined,
        onRetryAsText: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'inline') } : undefined,
      })} />
    {remoteStreaming && !chat.run?.phase && <p className="text-xs text-muted-foreground">{remoteRequest.data?.phase || t('chat.responding')}</p>}
  </div>{Object.values(typing).some((item) => item.until > Date.now()) && <p className="px-4 py-1 text-xs text-muted-foreground">{t('chat.typing', { names: Object.values(typing).filter((item) => item.until > Date.now()).map((item) => item.name).join(', ') })}</p>}
  <ContextTray task={task} estimate={estimate} />
  {prefilled && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.askAgainHint')}</p>}
  {pendingAttempt && !sending && !chat.sending && task.status !== 'done' && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.pendingAttemptHint')}</p>}
  {task.status !== 'done' && <Composer ref={composer} disabled={sending && !chat.run} streaming={!!chat.run || remoteStreaming} allowAttachments allowPin allowDiscussion
    blockedReason={estimate.currentData?.overLimit ? t('chat.overLimitBlocked') : undefined} onDraftChange={setDraft} onTyping={notifyTyping}
    placeholder={assistant ? t('chat.composerPlaceholderFor', { assistant: assistant.name }) : undefined}
    onSend={send} onStop={() => { void chat.stop(chat.run?.requestId ?? messages.data?.find((item) => item.status === 'streaming')?.requestId) }} />}
  {saveTarget && assistant && <SaveAsOutputDialog key={saveTarget.id} message={saveTarget} task={task} assistant={assistant} onOpenMaterials={onOpenMaterials} onClose={() => setSaveTarget(null)} />}</FileDropZone>
  <ConfirmDialog open={!!askTarget} onOpenChange={(open) => { if (!open) setAskTarget(null) }} title={t('chat.replaceDraftTitle')}
    description={t('chat.replaceDraftDescription')} confirmLabel={t('chat.replaceDraftConfirm')} destructive={false}
    onConfirm={() => { if (askTarget && !askAgainDisabled) { confirmedAsk.current = true; prefill(askTarget) } }}
    onCloseAutoFocus={(event) => { event.preventDefault(); if (confirmedAsk.current) composer.current?.setText(draft); else askOpener.current?.focus() }} />
  {infoId && <RequestInfoDialog requestId={infoId} onClose={() => setInfoId(null)} />}
  {retryChoice && <RetryFilesDialog record={retryChoice.record} mode={retryChoice.mode} onClose={() => setRetryChoice(null)}
    onSubmit={(ids) => retry(retryChoice!.record.id, retryChoice!.mode === 'exclude' ? { excludeFileIds: ids } : { forceInlineFileIds: ids })} />}</>
}
