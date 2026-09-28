import type { Message } from '@mes/domain'
import { MessagesSquare } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserMap } from '@/app/hooks'
import { formatDateTime } from '@/lib/dates'

export function MessageBubble({ message, onSaveAsOutput, onRetry, onRetryWithoutFiles, onRetryAsText, onRequestInfo }: {
  message: Message; onSaveAsOutput?: () => void; onRetry?: () => void; onRetryWithoutFiles?: () => void; onRetryAsText?: () => void; onRequestInfo?: () => void
}) {
  const user = useUserMap().get(message.authorId ?? '')
  const assistant = message.role === 'assistant'
  return <div className={`flex gap-2.5 ${assistant ? '' : 'flex-row-reverse'}`}>{!assistant && <UserAvatar user={user} size="sm" className="mt-1" />}<div className={`flex max-w-[85%] min-w-0 flex-col gap-1 ${assistant ? 'items-start' : 'items-end'}`}>
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{assistant ? 'assistant' : user?.name ?? '사용자'}</span><span>{formatDateTime(message.createdAt)}</span>{!assistant && message.kind === 'discussion' && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"><MessagesSquare className="size-2.5" />팀 의견 · AI 미전송</span>}</div>
    <div className={`rounded-2xl px-3.5 py-2.5 ${assistant ? 'border bg-card' : message.kind === 'discussion' ? 'rounded-tr-sm border border-dashed border-amber-300 bg-amber-50/60' : 'rounded-tr-sm bg-primary text-primary-foreground'}`}><Markdown content={message.content} /></div>
    {onSaveAsOutput && <button type="button" className="text-xs underline" onClick={onSaveAsOutput}>산출물로 저장</button>}
    {assistant && message.status === 'streaming' && <span className="text-xs text-muted-foreground">응답 중…</span>}
    {assistant && message.error && <span role="alert" className="text-xs text-destructive">{message.error}</span>}
    {assistant && <div className="flex flex-wrap gap-2 text-xs">
      {onRequestInfo && <button type="button" className="underline" onClick={onRequestInfo}>사용한 자료</button>}
      {message.status === 'error' && onRetry && <button type="button" className="underline" onClick={onRetry}>다시 시도</button>}
      {message.status === 'error' && onRetryWithoutFiles && <button type="button" className="underline" onClick={onRetryWithoutFiles}>파일 빼고 다시</button>}
      {message.status === 'error' && onRetryAsText && <button type="button" className="underline" onClick={onRetryAsText}>텍스트로 보내기</button>}
    </div>}
  </div></div>
}
