import type { Message } from '@mes/domain'
import { MessagesSquare } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserMap } from '@/app/hooks'
import { formatDateTime } from '@/lib/dates'

export function MessageBubble({ message, onSaveAsOutput }: { message: Message; onSaveAsOutput?: () => void }) {
  const user = useUserMap().get(message.authorId ?? '')
  const assistant = message.role === 'assistant'
  return <div className={`flex gap-2.5 ${assistant ? '' : 'flex-row-reverse'}`}>{!assistant && <UserAvatar user={user} size="sm" className="mt-1" />}<div className={`flex max-w-[85%] min-w-0 flex-col gap-1 ${assistant ? 'items-start' : 'items-end'}`}>
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{assistant ? 'assistant' : user?.name ?? '사용자'}</span><span>{formatDateTime(message.createdAt)}</span>{!assistant && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"><MessagesSquare className="size-2.5" />팀 의견 · AI 미전송</span>}</div>
    <div className={`rounded-2xl px-3.5 py-2.5 ${assistant ? 'border bg-card' : 'rounded-tr-sm border border-dashed border-amber-300 bg-amber-50/60'}`}><Markdown content={message.content} /></div>
    {onSaveAsOutput && <button type="button" className="text-xs underline" onClick={onSaveAsOutput}>산출물로 저장</button>}
  </div></div>
}
