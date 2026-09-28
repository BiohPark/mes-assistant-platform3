import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { appendMessage, getMessages } from '@/api/tasks'
import { setInput, uploadFile } from '@/api/files'
import { getRequest, type RequestRecord } from '@/api/requests'
import { useActor } from '@/app/hooks'
import { Composer, type PendingAttachment } from './Composer'
import { MessageBubble } from './MessageBubble'
import { SaveAsOutputDialog } from './SaveAsOutputDialog'
import { RequestInfoDialog } from './RequestInfoDialog'
import { RetryFilesDialog } from './RetryFilesDialog'
import { useChat } from './useChat'
import { toast } from 'sonner'

export function ChatView({ task, assistant }: { task: Task; assistant?: Assistant }) {
  const actor = useActor()
  const query = useQueryClient()
  const [sending, setSending] = useState(false)
  const [saveTarget, setSaveTarget] = useState<Message | null>(null)
  const [infoId, setInfoId] = useState<string | null>(null)
  const [retryChoice, setRetryChoice] = useState<{ record: RequestRecord; mode: 'exclude' | 'inline' } | null>(null)
  const chat = useChat(task.threadId)
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: () => getMessages(task.threadId!), enabled: !!task.threadId,
    refetchInterval: (query) => (query.state.data as Message[] | undefined)?.some((item) => item.status === 'streaming') ? 15_000 : false })
  const remoteStreaming = messages.data?.some((item) => item.status === 'streaming' && item.requestId !== chat.run?.requestId) ?? false
  async function send(text: string, attachments: PendingAttachment[], discussion: boolean) {
    if ((!text.trim() && !attachments.length) || !task.threadId || sending) return
    const content = text.trim()
    setSending(true)
    try {
      const uploaded = []
      for (const attachment of attachments) {
        const file = await uploadFile(actor, { taskId: task.id }, attachment.file)
        uploaded.push(file.id)
        if (discussion && !attachment.once) await setInput(actor, task.id, file.id, 'reference')
      }
      if (discussion) await appendMessage(actor, task.threadId, 'user', content, uploaded, 'done', 'discussion')
      else await chat.send(content, uploaded, uploaded.filter((_id, index) => attachments[index]?.once))
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
    } finally { setSending(false) }
  }
  async function retry(requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) {
    setSending(true)
    try { await chat.retry(requestId, options) } catch (error) { toast.error(error instanceof Error ? error.message : '재시도 실패') }
    finally { setSending(false); setRetryChoice(null) }
  }
  async function chooseRetry(requestId: string, mode: 'exclude' | 'inline') {
    try { setRetryChoice({ record: await getRequest(requestId), mode }) }
    catch { toast.error('요청 기록을 불러오지 못했습니다.') }
  }
  return <><div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {messages.data?.length ? messages.data.map((item) => <MessageBubble key={item.id} message={chat.run?.replyId === item.id ? { ...item, content: chat.run.text || item.content } : item}
      onSaveAsOutput={item.role === 'assistant' && assistant && item.status === 'done' ? () => setSaveTarget(item) : undefined}
      onRequestInfo={item.requestId ? () => setInfoId(item.requestId!) : undefined}
      onRetry={item.requestId && item.status === 'error' ? () => { void retry(item.requestId!) } : undefined}
      onRetryWithoutFiles={item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'exclude') } : undefined}
      onRetryAsText={item.requestId && item.status === 'error' ? () => { void chooseRetry(item.requestId!, 'inline') } : undefined} />) : <div className="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">대화를 시작하세요.</div>}
    {chat.run?.phase && <p className="text-xs text-muted-foreground">{chat.run.phase}</p>}
  </div>{task.status !== 'done' && <Composer disabled={sending && !chat.run} streaming={!!chat.run || remoteStreaming} allowAttachments allowPin allowDiscussion
    onSend={send} onStop={() => { void chat.stop(chat.run?.requestId ?? messages.data?.find((item) => item.status === 'streaming')?.requestId) }} />}
  {saveTarget && assistant && <SaveAsOutputDialog key={saveTarget.id} message={saveTarget} task={task} assistant={assistant} onClose={() => setSaveTarget(null)} />}</div>
  {infoId && <RequestInfoDialog requestId={infoId} onClose={() => setInfoId(null)} />}
  {retryChoice && <RetryFilesDialog record={retryChoice.record} mode={retryChoice.mode} onClose={() => setRetryChoice(null)}
    onSubmit={(ids) => retry(retryChoice!.record.id, retryChoice!.mode === 'exclude' ? { excludeFileIds: ids } : { forceInlineFileIds: ids })} />}</>
}
