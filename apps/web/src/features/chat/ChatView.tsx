import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { appendMessage, getMessages } from '@/api/tasks'
import { setInput, uploadFile } from '@/api/files'
import { useActor } from '@/app/hooks'
import { Composer, type PendingAttachment } from './Composer'
import { MessageBubble } from './MessageBubble'
import { SaveAsOutputDialog } from './SaveAsOutputDialog'

export function ChatView({ task, assistant }: { task: Task; assistant?: Assistant }) {
  const actor = useActor()
  const query = useQueryClient()
  const [sending, setSending] = useState(false)
  const [saveTarget, setSaveTarget] = useState<Message | null>(null)
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: () => getMessages(task.threadId!), enabled: !!task.threadId })
  async function send(text: string, attachments: PendingAttachment[]) {
    if ((!text.trim() && !attachments.length) || !task.threadId || sending) return
    const content = text.trim()
    setSending(true)
    try {
      const uploaded = []
      for (const attachment of attachments) {
        const file = await uploadFile(actor, { taskId: task.id }, attachment.file)
        uploaded.push(file.id)
        if (!attachment.once) await setInput(actor, task.id, file.id, 'reference')
      }
      await appendMessage(actor, task.threadId, 'user', content, uploaded, 'done', 'discussion')
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
    } finally { setSending(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {messages.data?.length ? messages.data.map((item) => <MessageBubble key={item.id} message={item} onSaveAsOutput={item.role === 'assistant' && assistant ? () => setSaveTarget(item) : undefined} />) : <div className="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">팀 의견을 남기세요. AI에는 전송되지 않습니다.</div>}
  </div>{task.status !== 'done' && <Composer disabled={sending} streaming={false} allowAttachments allowPin onSend={async (text, attachments) => send(text, attachments)} onStop={() => undefined} />}
  {saveTarget && assistant && <SaveAsOutputDialog key={saveTarget.id} message={saveTarget} task={task} assistant={assistant} onClose={() => setSaveTarget(null)} />}</div>
}
