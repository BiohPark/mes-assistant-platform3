import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Message } from '@mes/domain'
import { useQueries } from '@tanstack/react-query'
import { Copy, MoreHorizontal, RotateCcw, MessagesSquare, Paperclip } from 'lucide-react'
import type { FileMeta } from '@/api/files'
import { FilePreviewDialog } from '@/features/task/FilePreviewDialog'
import { HttpError } from '@/app/auth'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { UserAvatar } from '@/components/UserAvatar'
import { remarkSrCodes, SR_CODE_HREF, SrCodeLink } from '@/components/SrCodeLink'
import { Badge } from '@/components/ui/badge'
import { useUserMap } from '@/app/hooks'
import { useDates } from '@/lib/dates'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function MessageBubble({ message, onSaveAsOutput, onRetry, onRetryWithoutFiles, onRetryAsText, onRequestInfo, onAskAgain, askAgainDisabled = false, intake = false, assistantName, progress, searchMatch = false }: {
  searchMatch?: boolean; progress?: { phase: string; elapsed: number; detail?: string };
  onAskAgain?: () => void; askAgainDisabled?: boolean; intake?: boolean; assistantName?: string; message: Message; onSaveAsOutput?: () => void; onRetry?: () => void; onRetryWithoutFiles?: () => void; onRetryAsText?: () => void; onRequestInfo?: () => void
}) {
  const t = useT()
  const [preview, setPreview] = useState<FileMeta | null>(null)
  const previewOpener = useRef<HTMLButtonElement | null>(null)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  // Only a user gesture overrides the automatic streaming disclosure state.
  const [reasoningChoice, setReasoningChoice] = useState<boolean>()
  const reasoning = message.reasoning
  const hasContent = !!message.content.trim()
  const reasoningOpen = reasoningChoice ?? (message.status === 'streaming' && !hasContent)
  const reasoningScroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reasoningOpen && reasoningScroll.current) reasoningScroll.current.scrollTop = reasoningScroll.current.scrollHeight
  }, [message.reasoning, reasoningOpen])
  const menuAsk = useRef(false)
  useEffect(() => {
    if (!preview) {
      previewOpener.current?.focus()
      previewOpener.current = null
    }
  }, [preview])
  const { formatDateTime } = useDates()
  const user = useUserMap(!intake).get(message.authorId ?? '')
  const assistant = message.role === 'assistant'
  const tone = assistant ? 'card' : !intake && message.kind === 'discussion' ? 'warning' : 'primary'
  const attachments = useQueries({ queries: message.attachmentIds.map((id) => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new HttpError(response.status)
    return response.json() as Promise<FileMeta>
  }, retry: false })) })
  const attachmentFallback = (error: unknown) => {
    const status = error instanceof HttpError ? error.status : undefined
    return status === 404 || status === 410 ? t('chat.deletedFile') : status === 403 ? t('chat.attachmentForbidden') : t('chat.attachmentUnavailable')
  }
  async function copy() {
    if (await copyText(message.content)) toast.success(t('chat.copiedMessage'))
    else toast.error(t('chat.copyMessageFailed'))
  }
  const actionClass = 'inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
  return <><div data-message-id={message.id} data-search-match={searchMatch || undefined} tabIndex={-1} className={`group/message flex gap-2.5 rounded-md data-[search-match=true]:ring-2 data-[search-match=true]:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${assistant ? '' : 'flex-row-reverse'}`}>{!assistant && <UserAvatar user={user} size="sm" className="mt-1" />}<div className={`flex min-w-0 flex-col gap-1 ${assistant ? 'max-w-full items-start sm:max-w-[92%]' : 'max-w-[90%] items-end sm:max-w-[80%]'}`}>
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">{assistant ? assistantName ?? t('chat.agent') : user?.name ?? t(intake ? 'sr.requester' : 'chat.user')}</span><span>{formatDateTime(message.createdAt)}</span>{assistant && (progress || message.status === 'streaming') && <>
      <span role="status">{progress?.phase ?? t(hasContent ? 'chat.answering' : message.reasoning ? 'chat.thinking' : 'chat.waiting')}</span>
      {progress && <><span aria-hidden>·</span><span role="timer" aria-live="off">{t('chat.elapsed', { seconds: progress.elapsed })}</span></>}
      {progress?.detail && <span>{progress.detail}</span>}
    </>}{!assistant && !intake && message.kind === 'discussion' && <Badge tone="warning" className="gap-0.5 px-1.5"><MessagesSquare className="size-2.5" />{t('chat.discussionBadge')}</Badge>}</div>
    {assistant && reasoning && <details open={reasoningOpen} className="w-full rounded-lg border bg-muted text-foreground">
      <summary aria-expanded={reasoningOpen} onClick={(event) => { event.preventDefault(); setReasoningChoice(!reasoningOpen) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setReasoningChoice(!reasoningOpen) }
        }} className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('chat.reasoning')}</summary>
      <div ref={reasoningScroll} aria-live="off" className="max-h-64 overflow-y-auto scroll-auto whitespace-pre-wrap break-words px-3 pb-3 text-sm">{reasoning}</div>
    </details>}
    {(!assistant || hasContent) && <div className={`rounded-2xl px-3.5 py-2.5 ${tone === 'card' ? 'border bg-card' : tone === 'warning' ? 'rounded-tr-sm border border-dashed border-tone-warning-fg/40 bg-tone-warning-bg' : 'rounded-tr-sm bg-primary text-primary-foreground'}`}><div className="md-body" data-tone={tone}><ReactMarkdown remarkPlugins={[remarkGfm, remarkSrCodes]} components={{
        a: ({ href, title, children }) => href?.startsWith(SR_CODE_HREF) ? <SrCodeLink code={href.slice(SR_CODE_HREF.length)}>{children}</SrCodeLink> : <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      }}>{message.content}</ReactMarkdown></div></div>}
    {!assistant && attachments.length > 0 && <div className="flex flex-wrap justify-end gap-1 text-xs">{attachments.map((attachment, index) => <span key={message.attachmentIds[index]} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5"><Paperclip className="size-3" />{intake ? <a href={`/api/files/${encodeURIComponent(message.attachmentIds[index]!)}/content`} className="underline">{attachment.data?.name ?? t('sr.attachment', { number: index + 1 })}</a> : attachment.data ? <button type="button" className="hover:underline" onClick={(event) => { previewOpener.current = event.currentTarget; setPreview(attachment.data) }}>{attachment.data.name}</button> : (attachment.isError ? attachmentFallback(attachment.error) : t('chat.checkingFile'))}</span>)}</div>}
    <div className="flex items-center gap-1 text-foreground">
      <div role="group" aria-label={t('chat.messageActions')} className="hidden md:flex md:opacity-0 md:group-hover/message:opacity-100 md:group-focus-within/message:opacity-100 motion-safe:transition-opacity">
        <button type="button" className={actionClass} onClick={() => void copy()}><Copy aria-hidden="true" className="size-3.5" />{t('chat.copyMessage')}</button>
        {!assistant && onAskAgain && <button type="button" className={actionClass} disabled={askAgainDisabled} title={t('chat.askAgainHint')} onClick={onAskAgain}><RotateCcw aria-hidden="true" className="size-3.5" />{t('chat.askAgain')}</button>}
      </div>
      <DropdownMenu><DropdownMenuTrigger asChild><button ref={menuTrigger} type="button" aria-label={t('chat.messageMenu')} className="inline-flex size-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"><span className="flex size-8 items-center justify-center rounded-md border bg-card text-card-foreground"><MoreHorizontal aria-hidden="true" className="size-4" /></span></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="motion-reduce:animate-none! motion-reduce:transition-none!"
          onCloseAutoFocus={(event) => {
            if (!menuAsk.current) return
            event.preventDefault()
            menuAsk.current = false
            menuTrigger.current?.focus()
            onAskAgain?.()
          }}>
          <DropdownMenuItem className="min-h-11" onSelect={() => void copy()}><Copy aria-hidden="true" />{t('chat.copyMessage')}</DropdownMenuItem>
          {!assistant && onAskAgain && <DropdownMenuItem className="min-h-11" disabled={askAgainDisabled} onSelect={() => { menuAsk.current = true }}><RotateCcw aria-hidden="true" />{t('chat.askAgain')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {onSaveAsOutput && <button type="button" className="text-xs underline" onClick={onSaveAsOutput}>{t('chat.saveAsOutput')}</button>}
    {assistant && message.error && <span role="alert" className="text-xs text-destructive">{message.error}</span>}
    {assistant && <div className="flex flex-wrap gap-2 text-xs">
      {onRequestInfo && <button type="button" className="underline" onClick={onRequestInfo}>{t('chat.requestInfo')}</button>}
      {message.status === 'error' && onRetry && <button type="button" className="underline" onClick={onRetry}>{t('common.retry')}</button>}
      {message.status === 'error' && onRetryWithoutFiles && <button type="button" className="underline" onClick={onRetryWithoutFiles}>{t('chat.retryWithoutFiles')}</button>}
      {message.status === 'error' && onRetryAsText && <button type="button" className="underline" onClick={onRetryAsText}>{t('chat.retryAsText')}</button>}
    </div>}
  </div></div>{preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}</>
}

function CodeBlock({ children }: { children: ReactNode }) {
  const t = useT()
  const block = useRef<HTMLPreElement>(null)
  async function copyCode() {
    if (await copyText(block.current?.textContent ?? '')) toast.success(t('chat.copiedCode'))
    else toast.error(t('chat.copyMessageFailed'))
  }
  return <div className="relative min-w-0"><button type="button" onClick={() => void copyCode()}
    className="flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Copy aria-hidden="true" className="size-3.5" />{t('chat.copyCode')}</button>
    <pre ref={block}>{children}</pre></div>
}
