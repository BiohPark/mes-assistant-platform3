import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task } from '@mes/domain'
import { appendMessage, getMessages } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'

export function ChatView({ task }: { task: Task }) {
  const actor = useActor()
  const query = useQueryClient()
  const [sending, setSending] = useState(false)
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: () => getMessages(task.threadId!), enabled: !!task.threadId })
  async function send(text: string) {
    if (!text.trim() || !task.threadId || sending) return
    const content = text.trim()
    setSending(true)
    try {
      await appendMessage(actor, task.threadId, 'user', content, [], 'done', 'discussion')
      await query.invalidateQueries({ queryKey: ['messages', task.threadId] })
    } finally { setSending(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
    {messages.data?.length ? messages.data.map((item) => <MessageBubble key={item.id} message={item} />) : <div className="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">팀 의견을 남기세요. AI에는 전송되지 않습니다.</div>}
  </div>{task.status !== 'done' && <Composer disabled={sending} streaming={false} allowAttachments={false} onSend={async (text) => send(text)} onStop={() => undefined} />}</div>
}
