import { useState } from 'react'
import type { Message } from '@mes/domain'
import { useQueries } from '@tanstack/react-query'
import { MessagesSquare, Paperclip } from 'lucide-react'
import type { FileMeta } from '@/api/files'
import { FilePreviewDialog } from '@/features/task/FilePreviewDialog'
import { HttpError } from '@/app/auth'
import { Markdown } from '@/components/Markdown'
import { UserAvatar } from '@/components/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { useUserMap } from '@/app/hooks'
import { useDates } from '@/lib/dates'
import { useT } from '@/i18n'

export function MessageBubble({ message, onSaveAsOutput, onRetry, onRetryWithoutFiles, onRetryAsText, onRequestInfo, intake = false, assistantName }: {
  intake?: boolean; assistantName?: string; message: Message; onSaveAsOutput?: () => void; onRetry?: () => void; onRetryWithoutFiles?: () => void; onRetryAsText?: () => void; onRequestInfo?: () => void
}) {
  const t = useT()
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const { formatDateTime } = useDates()
  const user = useUserMap(!intake).get(message.authorId ?? '')
  const assistant = message.role === 'assistant'
  const attachments = useQueries({ queries: message.attachmentIds.map((id) => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new HttpError(response.status)
    return response.json() as Promise<FileMeta>
  }, retry: false })) })
  const attachmentFallback = (error: unknown) => {
    const status = error instanceof HttpError ? error.status : undefined
    return status === 404 || status === 410 ? t('chat.deletedFile') : status === 403 ? t('chat.attachmentForbidden') : t('chat.attachmentUnavailable')
  }
  return <><div className={`flex gap-2.5 ${assistant ? '' : 'flex-row-reverse'}`}>{!assistant && <UserAvatar user={user} size="sm" className="mt-1" />}<div className={`flex max-w-[85%] min-w-0 flex-col gap-1 ${assistant ? 'items-start' : 'items-end'}`}>
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">{assistant ? assistantName ?? 'assistant' : user?.name ?? t(intake ? 'sr.requester' : 'chat.user')}</span><span>{formatDateTime(message.createdAt)}</span>{!assistant && !intake && message.kind === 'discussion' && <Badge tone="warning" className="gap-0.5 px-1.5"><MessagesSquare className="size-2.5" />{t('chat.discussionBadge')}</Badge>}</div>
    <div className={`rounded-2xl px-3.5 py-2.5 ${assistant ? 'border bg-card' : !intake && message.kind === 'discussion' ? 'rounded-tr-sm border border-dashed border-tone-warning-fg/40 bg-tone-warning-bg' : 'rounded-tr-sm bg-primary text-primary-foreground'}`}><Markdown content={message.content} /></div>
    {!assistant && attachments.length > 0 && <div className="flex flex-wrap justify-end gap-1 text-xs">{attachments.map((attachment, index) => <span key={message.attachmentIds[index]} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5"><Paperclip className="size-3" />{intake ? <a href={`/api/files/${encodeURIComponent(message.attachmentIds[index]!)}/content`} className="underline">{attachment.data?.name ?? t('sr.attachment', { number: index + 1 })}</a> : attachment.data ? <button type="button" className="hover:underline" onClick={() => setPreview(attachment.data)}>{attachment.data.name}</button> : (attachment.isError ? attachmentFallback(attachment.error) : t('chat.checkingFile'))}</span>)}</div>}
    {onSaveAsOutput && <button type="button" className="text-xs underline" onClick={onSaveAsOutput}>{t('chat.saveAsOutput')}</button>}
    {assistant && message.status === 'streaming' && <span className="text-xs text-muted-foreground">{t('chat.responding')}</span>}
    {assistant && message.error && <span role="alert" className="text-xs text-destructive">{message.error}</span>}
    {assistant && <div className="flex flex-wrap gap-2 text-xs">
      {onRequestInfo && <button type="button" className="underline" onClick={onRequestInfo}>{t('chat.requestInfo')}</button>}
      {message.status === 'error' && onRetry && <button type="button" className="underline" onClick={onRetry}>{t('common.retry')}</button>}
      {message.status === 'error' && onRetryWithoutFiles && <button type="button" className="underline" onClick={onRetryWithoutFiles}>{t('chat.retryWithoutFiles')}</button>}
      {message.status === 'error' && onRetryAsText && <button type="button" className="underline" onClick={onRetryAsText}>{t('chat.retryAsText')}</button>}
    </div>}
  </div></div>{preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}</>
}
