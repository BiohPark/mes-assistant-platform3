import { useRef, useState } from 'react'
import { MessagesSquare, Paperclip, Pin, PinOff, Send, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FILE_MAX_PER_REQUEST } from '@mes/contracts'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { useT } from '@/i18n'

/** 보낼 첨부 1건. once=true면 이번 메시지에만 쓰고 대화 입력으로 고정하지 않는다 */
export interface PendingAttachment {
  file: File
  once: boolean
  uploadedId?: string
  uploadedTaskId?: string
}

interface ComposerProps {
  disabled?: boolean
  streaming: boolean
  placeholder?: string
  inputLabel?: string
  maxAttachments?: number
  /** discussion=true 이면 팀 의견(AI 미전송) */
  onSend: (text: string, attachments: PendingAttachment[], discussion: boolean) => Promise<void>
  onStop: () => void
  suggestions?: string[]
  allowAttachments?: boolean
  onTyping?: () => void
  /** 팀 의견 토글 노출 여부 (업무 채팅에서만) */
  allowDiscussion?: boolean
  /** 첨부를 대화 입력으로 고정할지 고르는 토글 노출 (업무 채팅에서만) */
  allowPin?: boolean
  /** 보낼 수 없는 이유 (요청 크기 한도 초과 등). 팀 의견은 막지 않는다 */
  blockedReason?: string
  /** 작성 중인 글 (요청 크기 미리 계산용) */
  onDraftChange?: (text: string) => void
  clearOnSubmit?: boolean
}

export function Composer({ disabled, streaming, placeholder, inputLabel, maxAttachments, onSend, onStop, suggestions, allowAttachments = false, onTyping, allowDiscussion, allowPin, blockedReason, onDraftChange, clearOnSubmit = false }: ComposerProps) {
  const t = useT()
  const [discussion, setDiscussion] = useState(false)
  const [text, setTextState] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: maxAttachments === undefined }).data
  const attachmentLimit = maxAttachments ?? settings?.fileMaxPerRequest ?? FILE_MAX_PER_REQUEST
  const inputRef = useRef<HTMLInputElement>(null)
  const blocked = !discussion && !!blockedReason
  const canSend = !disabled && !blocked && (discussion || !streaming) && (text.trim().length > 0 || pending.length > 0)

  const setText = (v: string) => {
    setTextState(v)
    onDraftChange?.(v)
  }

  async function submit() {
    if (!canSend) return
    const submittedText = text
    const f = pending
    if (clearOnSubmit) { setText(''); setPending([]) }
    try {
      await onSend(submittedText, f, discussion)
      if (!clearOnSubmit) { setText(''); setPending([]) }
    } catch (e) {
      if (clearOnSubmit) { setTextState((current) => current || submittedText); setPending((current) => current.length ? current : f) }
      toast.error(t('chat.sendFailed'), { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="border-t bg-card p-2.5">
      {suggestions && suggestions.length > 0 && text === '' && !streaming && (
        <div className="mb-2 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setText(s)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {pending.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-1.5 py-0.5 text-xs">
              <Paperclip className="size-3" />
              {p.file.name}
              {allowPin && (
                <button
                  type="button"
                  className={cn('inline-flex items-center gap-0.5 rounded-lg px-1', p.once ? 'text-muted-foreground' : 'text-primary')}
                  aria-pressed={!p.once}
                  onClick={() => setPending((cur) => cur.map((x, j) => (j === i ? { ...x, once: !x.once } : x)))}
                  title={p.once ? t('chat.attachOnceTitle') : t('chat.attachPinnedTitle')}
                >
                  {p.once ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  {p.once ? t('chat.attachOnce') : t('chat.attachPinned')}
                </button>
              )}
              <button type="button" aria-label={t('chat.removeAttachment')} onClick={() => setPending((cur) => cur.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachmentError && <div role="alert" className="mb-1 text-xs text-destructive">{attachmentError}</div>}
      <div className={cn('flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/40', discussion && 'border-tone-warning-fg/40 bg-tone-warning-bg')}>
        {allowAttachments && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('chat.attachFile')} onClick={() => inputRef.current?.click()} disabled={disabled}>
            <Paperclip />
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).map((file) => ({ file, once: discussion }))
            if (pending.length + picked.length > attachmentLimit) setAttachmentError(t('chat.attachmentLimit', { limit: String(attachmentLimit) }))
            else { setPending((p) => [...p, ...picked]); setAttachmentError('') }
            e.target.value = ''
          }}
        />
        <Textarea
          aria-label={inputLabel ?? (discussion ? t('chat.composerLabel') : t('chat.requestLabel'))}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) onTyping?.()
          }}
          placeholder={discussion ? t('chat.discussionPlaceholder') : (placeholder ?? t('chat.composerPlaceholder'))}
          rows={1}
          disabled={disabled}
          className="max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {allowDiscussion && (
          <Button
            type="button"
            variant={discussion ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={t('chat.discussionToggle')}
            aria-pressed={discussion}
            title={t('chat.discussionToggleTitle')}
            className={cn(discussion && 'text-tone-warning-fg')}
            onClick={() => setDiscussion((v) => !v)}
          >
            <MessagesSquare />
          </Button>
        )}
        {streaming && !discussion ? (
          <Button type="button" variant="outline" size="icon-sm" aria-label={t('chat.stop')} onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" size="icon-sm" aria-label={t('chat.send')} onClick={() => void submit()} disabled={!canSend} title={blocked ? blockedReason : undefined}>
            <Send />
          </Button>
        )}
      </div>
    </div>
  )
}
