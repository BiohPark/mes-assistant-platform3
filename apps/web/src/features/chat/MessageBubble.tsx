import type { Message } from '@mes/domain'
import { MessagesSquare } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserMap } from '@/app/hooks'
import { formatDateTime } from '@/lib/dates'

/** S2에서는 팀 의견만 표시한다. */
export function MessageBubble({ message }: { message: Message }) {
  const user = useUserMap().get(message.authorId ?? '')
  return <div className="flex flex-row-reverse gap-2.5"><UserAvatar user={user} size="sm" className="mt-1" /><div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1">
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{user?.name ?? '사용자'}</span><span>{formatDateTime(message.createdAt)}</span><span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"><MessagesSquare className="size-2.5" />팀 의견 · AI 미전송</span></div>
    <div className="rounded-2xl rounded-tr-sm border border-dashed border-amber-300 bg-amber-50/60 px-3.5 py-2.5"><Markdown content={message.content} /></div>
  </div></div>
}
