import { lockInputSend, saveInputSelection, inputSelection } from '@/api/inputSelection'
import { getPreviousMaterials, reattachMaterials } from '@/api/previousMaterials'
import { MaterialsPicker } from './MaterialsPicker'
import { useMaterialCandidates } from './useMaterialCandidates'
import { useAnswerDetail } from './useAnswerDetail'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { appendMessage, getMessages, setTaskStatus } from '@/api/tasks'
import { uploadFile } from '@/api/files'
import { estimateRequest, getRequest, isTerminalRequest, type RequestRecord } from '@/api/requests'
import { subscribeEvent } from '@/app/useEvents'
import { useActor, useCurrentUserId } from '@/app/hooks'
import { useWhenVisible } from '@/app/tabActive'
import { ReasonDialog } from '@/components/ReasonDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Composer, type ComposerHandle, type PendingAttachment } from './Composer'
import { FileDropZone } from '@/components/FileDropZone'
import { ChatMessages } from './ChatMessages'
import { ModelPicker } from './ModelPicker'
import { SaveAsOutputDialog } from './SaveAsOutputDialog'
import { RequestInfoDialog } from './RequestInfoDialog'
import { RetryFilesDialog } from './RetryFilesDialog'
import { STATUS_CHECK_MS, useChat } from './useChat'
import { RequestSizeNotice, useRequestAttachments } from './RequestAttachments'
import { useRequestEstimate } from './useRequestEstimate'
import { getDraft } from './drafts'
import { toast } from 'sonner'
import { useConversationViewed } from '@/lib/conversationRead'
import { useT } from '@/i18n'
import { useTaskChatActions } from '@/features/task/chatActions'
import { ChatBrief } from '@/features/task/ChatBrief'

/** 대화 열 최대 폭 — 1440 이하에서는 열 전체, 1920 같은 넓은 화면에서만 가운데로 모은다 */
const CHAT_COLUMN = 'mx-auto w-full max-w-5xl'

/** headerTools가 있으면 검색·질문 목차 아이콘은 그 자리(대화 헤더)로 가고, 펼친 검색 줄만 메시지 위 툴바에 남는다 */
export function ChatView({ task, assistant, onOpenMaterials, headerTools }: { task: Task; assistant?: Assistant; onOpenMaterials?: () => void; headerTools?: HTMLElement | null }) {
  const t = useT()
  const { detail } = useAnswerDetail()
  const actor = useActor()
  const selfId = useCurrentUserId()
  const query = useQueryClient()
  const whenVisible = useWhenVisible() // 응답 흐름에서 생기는 알림은 이 대화가 보일 때(숨은 탭이면 미룸)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerOpener = useRef<HTMLElement | null>(null)
  const attachButton = useRef<HTMLButtonElement>(null)
  function openMaterialPicker() { pickerOpener.current = document.activeElement as HTMLElement | null; setPickerOpen(true) }
  const selection = inputSelection(state => state.byTask[task.id])
  const materials = useMaterialCandidates(task.id, false)
  const [sending, setSending] = useState(false)
  const [submissionSince, setSubmissionSince] = useState<number>()
  const [draft, setDraft] = useState(() => getDraft(task.id)?.text ?? '')
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
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
  const conversationPanel = useRef<HTMLDivElement>(null)
  const [saveTarget, setSaveTarget] = useState<Message | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [retryChoice, setRetryChoice] = useState<{ record: RequestRecord; mode: 'exclude' | 'inline' } | null>(null)
  const chat = useChat(task.threadId, holdReleased, (draft, error) => {
    composer.current?.restoreDraft(draft)
    whenVisible(() => toast.error(t('chat.sendFailed'), { description: error instanceof Error ? error.message : String(error) }))
  })
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: ({ signal }) => getMessages(task.threadId!, signal), enabled: !!task.threadId,
  })
  useConversationViewed(selfId, task.id, task.lastActivityAt, conversationPanel)
  const remoteRequestId = messages.data?.find((item) => item.status === 'streaming' && item.requestId !== chat.run?.requestId)?.requestId
  // 다른 창·탭(또는 끊긴 내 스트림)의 요청 — 실시간 이벤트가 늦거나 막혀도 요청 기록을 주기적으로 읽어 끝을 확인한다(창이 다시 보이면 즉시)
  const remoteRequest = useQuery({ queryKey: ['request', remoteRequestId], queryFn: () => getRequest(remoteRequestId!), enabled: !!remoteRequestId,
    refetchInterval: (current) => isTerminalRequest(current.state.data?.status) ? false : STATUS_CHECK_MS })
  const remoteDone = isTerminalRequest(remoteRequest.data?.status)
  useEffect(() => { if (remoteDone && task.threadId) void query.invalidateQueries({ queryKey: ['messages', task.threadId] }) }, [remoteDone, task.threadId, query])
  const remoteStreaming = !!remoteRequestId && !remoteDone
  const remoteReply = messages.data?.find(item => item.status === 'streaming' && item.requestId === remoteRequestId)
  const visibleRun = chat.run ?? (remoteReply && remoteStreaming ? { requestId: remoteRequestId!, replyId: remoteReply.id,
    text: remoteReply.content, reasoning: remoteReply.reasoning ?? '', phase: remoteRequest.data?.phase ?? undefined,
    startedAt: Date.parse(remoteRequest.data?.createdAt ?? remoteReply.createdAt), firstTokenMs: remoteRequest.data?.firstTokenMs, idleMs: remoteRequest.data?.idleMs, maxMs: remoteRequest.data?.maxMs } : null)
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
  const revision = JSON.stringify({ selectionRevision: selection?.revision ?? 0, inputs: task.inputs, modelId: task.modelId, messages: messages.data?.map((item) => [item.id, item.status, item.content.length]) })
  const estimate = useRequestEstimate(task.threadId, draft, revision, !!task.threadId)
  const attachments = useRequestAttachments(task, estimate)
  useEffect(() => {
    const unsubscribe = subscribeEvent(({ event, data }) => {
      if (event === 'sr.updated') void query.invalidateQueries({ queryKey: ['estimate', task.threadId] })
      if (event !== 'presence.typing' || data.threadId !== task.threadId || data.userId === selfId ||
        typeof data.userId !== 'string' || typeof data.name !== 'string' || typeof data.until !== 'string') return
      setTyping((current) => ({ ...current, [data.userId as string]: { name: data.name as string, until: Date.parse(data.until as string) } }))
    })
    const timer = window.setInterval(() => setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value.until > Date.now()))), 1_000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [task.threadId, selfId, query])
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
    whenVisible(() => toast.success(t('task.progress.holdReleased'), { duration: 10_000, action: { label: t('task.header.hold'), onClick: () => {
      void setTaskStatus(actor, task.id, 'on_hold').then(() => { markStatus('on_hold'); refreshProgress() }).catch(error => toast.error(error instanceof Error ? error.message : t('chat.sendFailed')))
    } } }))
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
  async function beforeSend(discussion = false, retrying = false) {
    if (sendLock.current || (!discussion && !retrying && !chat.hasPendingAttempt() && ((inputSelection.getState().byTask[task.id]?.pending ?? 0) > 0 || !estimate.currentData))) return false
    if (task.status !== 'done') return true
    setReopenResendsStored(retrying || (!discussion && chat.hasPendingAttempt()))
    setSending(true)
    try {
      return await new Promise<boolean>(resolve => { reopenDecision.current = resolve; setReopenForSend(true) })
    } finally { setSending(false) }
  }
  async function send(text: string, attachments: PendingAttachment[], discussion: boolean) {
    if ((!text.trim() && !attachments.length) || !task.threadId || sendLock.current || (!discussion && (inputSelection.getState().byTask[task.id]?.pending ?? 0) > 0)) return false
    const unlockInputs = discussion ? () => {} : lockInputSend(task.id)
    if (!unlockInputs) return false
    sendLock.current = true
    const content = text.trim()
    const startedAt = Date.now()
    if (!discussion) setSubmissionSince(startedAt)
    setSending(true)
    try {
      const stored = discussion ? null : chat.pendingAttempt()
      if (stored) {
        // 보관된 시도를 그대로 다시 보낸다(안내와 같음). 그 시도에 없던 글·첨부는 보내지 않았으므로 입력창에 남긴다
        await chat.send(content)
        const same = content === stored.text && attachments.every((item) => item.uploadedId && item.uploadedTaskId === task.id && stored.attachmentIds.includes(item.uploadedId))
        if (same) return
        whenVisible(() => toast.info(t('chat.pendingAttemptDraftKept')))
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
      }
      let signature: string | undefined
      if (!discussion) {
        const preview = await estimateRequest(task.threadId, { draft: content, attachmentIds: uploaded,
          oneShotFileIds: [], ...(detail !== 'brief' ? { detail } : {}) })
        signature = preview.inputSignature
        if (preview.overLimit) throw new Error(t('chat.overLimitError', { bytes: String(preview.bytes), limit: String(preview.limitBytes) }) + (detail === 'full' ? ` ${t('chat.overLimitDetailHint')}` : ''))
      }
      if (discussion) {
        const accepted = await appendMessage(actor, task.threadId, 'user', content, uploaded, 'done', 'discussion') as Message & { autoStarted?: boolean }
        if (accepted.autoStarted) holdReleased()
        refreshProgress()
      } else await chat.send(content, uploaded, [], startedAt, signature)
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
      setPrefilled(false)
    } finally { unlockInputs(); sendLock.current = false; setSending(false); setSubmissionSince(undefined) }
  }
  async function retry(requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) {
    setSending(true)
    try {
      if (!await beforeSend(false, true)) return
      setSending(true)
      await chat.retry(requestId, options)
    } catch (error) { whenVisible(() => toast.error(error instanceof Error ? error.message : t('chat.retryFailed'))) }
    finally { setSending(false); setRetryChoice(null) }
  }
  async function chooseRetry(requestId: string, mode: 'exclude' | 'inline') {
    try { setRetryChoice({ record: await getRequest(requestId), mode }) }
    catch { toast.error(t('chat.requestLoadFailed')) }
  }
  const lastRequest = messages.data?.findLast(item => !!item.requestId)
  const lastRequestId = lastRequest?.requestId
  const previousMaterials = useQuery({ queryKey: ['previous-materials', task.id, lastRequestId], queryFn: () => getPreviousMaterials(task.id), enabled: !!lastRequestId && task.status !== 'done' })
  const selectionBusy = !!selection?.pending
  const reattaching = useRef(false)
  async function reattach() {
    if (reattaching.current || selectionBusy || requestInFlight || pendingAttempt) return
    reattaching.current = true
    try {
      await saveInputSelection(task.id, async () => {
        await reattachMaterials(actor, task.id, await getPreviousMaterials(task.id))
        await previousMaterials.refetch()
      })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { reattaching.current = false }
  }
  const requestInFlight = sending || chat.sending || !!chat.run || remoteStreaming
  const requestIssue = !requestInFlight && (lastRequest?.status === 'error' || !!estimate.currentData?.overLimit || pendingAttempt)
  useEffect(() => {
    const enabled = !!lastRequestId && !sending && !chat.sending && !remoteStreaming
    useTaskChatActions.getState().set(task.id, {
      issue: requestIssue,
      info: lastRequestId ? () => setInfoId(lastRequestId) : undefined,
      exclude: enabled ? () => { void chooseRetry(lastRequestId, 'exclude') } : undefined,
      inline: enabled ? () => { void chooseRetry(lastRequestId, 'inline') } : undefined,
    })
    return () => useTaskChatActions.getState().set(task.id)
  }, [task.id, lastRequestId, requestIssue, sending, chat.sending, remoteStreaming, t])
  const reattachAction = !!previousMaterials.data?.length && <Button type="button" size="sm" variant="outline" disabled={selectionBusy || requestInFlight || pendingAttempt} onClick={() => void reattach()}>{t('task.materials.reattach', { count: previousMaterials.data.length })}</Button>
  return <><FileDropZone data-testid="chat-dropzone" className="flex min-h-0 flex-1 flex-col" label={t('dropzone.toAttach')} disabled={sending || chat.sending} onFiles={(files) => composer.current?.dropFiles(files)}>
    <ChatBrief taskId={task.id} />
    <div ref={setToolbar} data-testid="chat-question-toolbar" className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2 empty:hidden" />
    {/* 넓은 화면에서도 메시지·입력창은 같은 최대 폭(CHAT_COLUMN)의 가운데 열 — 스크롤바는 가장자리에 둔다 */}
    <div ref={conversationPanel} data-testid="chat-message-scroll" className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"><div className={`${CHAT_COLUMN} space-y-4`}>
    <ChatMessages key={task.id} assistantName={assistant?.name} messages={messages.data ?? []} run={visibleRun} waitingSince={chat.waitingSince ?? submissionSince} questionIndexContainer={headerTools ?? toolbar} searchContainer={toolbar} empty={messages.isSuccess ? <div className="mx-auto mt-10 max-w-md space-y-2 text-center text-sm text-muted-foreground"><p>{t('chat.startConversation')}</p><p className="text-xs">{t('chat.emptyHint')}</p></div>
      : messages.isError ? <div role="alert" className="mx-auto mt-10 max-w-md text-center text-sm">{t('chat.historyLoadFailed')} <button type="button" className="underline" onClick={() => void messages.refetch()}>{t('common.retry')}</button></div>
      : !!task.threadId && <p className="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">{t('common.loading')}</p>}
      actions={(item) => ({
        onChoose: !askAgainDisabled ? text => {
          if (!askAgainDisabled && !sendLock.current) composer.current?.setText(draft ? `${draft}\n${text}` : text)
        } : undefined,
        onAskAgain: item.role === 'user' && item.kind !== 'discussion' ? () => askAgain(item) : undefined,
        askAgainDisabled,
        onSaveAsOutput: item.role === 'assistant' && assistant && item.status === 'done' ? () => setSaveTarget(item) : undefined,
        onRequestInfo: item.requestId ? () => setInfoId(item.requestId!) : undefined,
        onRetry: item.requestId && item.status === 'error' ? () => { void retry(item.requestId!) } : undefined,
        onRetryWithoutFiles: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'exclude') } : undefined,
        onRetryAsText: item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'inline') } : undefined,
      })} />
  </div></div>{Object.values(typing).some((item) => item.until > Date.now()) && <p className="px-4 py-1 text-xs text-muted-foreground">{t('chat.typing', { names: Object.values(typing).filter((item) => item.until > Date.now()).map((item) => item.name).join(', ') })}</p>}
  {prefilled && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.askAgainHint')}</p>}
  {pendingAttempt && !sending && !chat.sending && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{t('chat.pendingAttemptHint')}</p>}
  <Composer inputLabels ref={composer} clearOnSubmit disabled={(sending || chat.sending) && !chat.run} streaming={!!chat.run || remoteStreaming} allowAttachments allowDiscussion
    attachments={attachments}
    attachmentControl={<Button ref={attachButton} type="button" variant="ghost" size="sm" data-tour="materials-picker" disabled={sending || chat.sending} onClick={openMaterialPicker}>{t(materials.count ? 'task.materials.attachCandidates' : 'task.materials.addToInput', { count: materials.count })}</Button>}
    emptyMaterials={<div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><button type="button" className="text-left underline" onClick={openMaterialPicker}>{t(materials.count ? 'task.materials.emptyCandidates' : 'task.materials.empty', { count: materials.count })}</button>{reattachAction}</div>}
    notice={<>{selectionBusy || estimate.revisionChanged ? <p aria-live="polite" className="mb-1 text-xs text-muted-foreground">{t(selectionBusy ? 'task.materials.saving' : 'task.materials.updatingEstimate')}</p> : null}<RequestSizeNotice task={task} estimate={estimate} />{!estimate.pending && !estimate.currentData && <Button type="button" size="xs" variant="outline" onClick={() => void query.invalidateQueries({ queryKey: ['estimate', task.threadId] })}>{t('task.materials.retryEstimate')}</Button>}</>} contentClassName={CHAT_COLUMN}
    blockedReason={selectionBusy ? t('task.materials.saving') : pendingAttempt ? undefined : !estimate.currentData ? t(estimate.pending ? 'chat.calculating' : 'task.materials.estimateFailed') : task.status !== 'done' && estimate.currentData?.overLimit ? t('chat.overLimitBlocked') : undefined} onDraftChange={setDraft} onTyping={notifyTyping} draftKey={task.id}
    placeholder={assistant ? t('chat.composerPlaceholderFor', { assistant: assistant.name }) : undefined}
    tools={assistant && <ModelPicker task={task} assistant={assistant} disabled={task.status === 'done'} />}
    beforeSend={discussion => beforeSend(discussion)} onSend={send} startedAt={chat.waitingSince ?? submissionSince ?? visibleRun?.startedAt} onStop={() => { void chat.stop(chat.run?.requestId ?? messages.data?.find((item) => item.status === 'streaming')?.requestId) }} />
  {pickerOpen && <MaterialsPicker task={task} previous={reattachAction} restoreFocus={() => {
    const opener = pickerOpener.current
    if (opener?.isConnected && !opener.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(opener).display !== 'none' && getComputedStyle(opener).visibility !== 'hidden') opener.focus()
    else attachButton.current?.focus()
  }} onClose={() => setPickerOpen(false)} onUpload={files => { if (composer.current?.dropFiles(files)) setPickerOpen(false) }} />}
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
