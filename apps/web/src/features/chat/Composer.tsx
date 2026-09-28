import { useRef, useState } from 'react'
import { MessagesSquare, Paperclip, Pin, PinOff, Send, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/** 보낼 첨부 1건. once=true면 이번 메시지에만 쓰고 대화 입력으로 고정하지 않는다 */
export interface PendingAttachment {
  file: File
  once: boolean
}

interface ComposerProps {
  disabled?: boolean
  streaming: boolean
  placeholder?: string
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
}

export function Composer({ disabled, streaming, placeholder, onSend, onStop, suggestions, allowAttachments = false, onTyping, allowDiscussion, allowPin, blockedReason, onDraftChange }: ComposerProps) {
  const [discussion, setDiscussion] = useState(true)
  const [text, setTextState] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const blocked = !discussion && !!blockedReason
  const canSend = !disabled && !blocked && (discussion || !streaming) && (text.trim().length > 0 || pending.length > 0)

  const setText = (v: string) => {
    setTextState(v)
    onDraftChange?.(v)
  }

  async function submit() {
    if (!canSend) return
    const t = text
    const f = pending
    try {
      await onSend(t, f, discussion)
      setText('')
      setPending([])
    } catch (e) {
      toast.error('전송하지 못했습니다.', { description: e instanceof Error ? e.message : String(e) })
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
              className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {pending.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px]">
              <Paperclip className="size-3" />
              {p.file.name}
              {allowPin && (
                <button
                  type="button"
                  className={cn('inline-flex items-center gap-0.5 rounded px-1', p.once ? 'text-muted-foreground' : 'text-primary')}
                  aria-pressed={!p.once}
                  onClick={() => setPending((cur) => cur.map((x, j) => (j === i ? { ...x, once: !x.once } : x)))}
                  title={p.once ? '이번 메시지에만 씁니다. 누르면 대화 입력으로 고정합니다' : '대화 입력(☑ 참고)으로 고정 — 다음 턴에도 AI에 갑니다. 누르면 이번 메시지만'}
                >
                  {p.once ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  {p.once ? '이번 메시지만' : '입력으로 고정'}
                </button>
              )}
              <button type="button" aria-label="첨부 제거" onClick={() => setPending((cur) => cur.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={cn('flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/40', discussion && 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20')}>
        {allowAttachments && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="파일 첨부" onClick={() => inputRef.current?.click()} disabled={disabled}>
            <Paperclip />
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).map((file) => ({ file, once: false }))
            setPending((p) => [...p, ...picked])
            e.target.value = ''
          }}
        />
        <Textarea
          aria-label="팀 의견 입력"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) onTyping?.()
          }}
          placeholder={discussion ? '팀 의견을 남기세요 (AI에게 전송되지 않음)' : (placeholder ?? 'assistant에게 요청하세요. Enter 전송, Shift+Enter 줄바꿈')}
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
            aria-label="팀 의견 (AI 미전송)"
            aria-pressed={discussion}
            title="팀 의견: 스레드에 남지만 assistant에게는 보내지 않음"
            className={cn(discussion && 'text-amber-700')}
            onClick={() => setDiscussion((v) => !v)}
          >
            <MessagesSquare />
          </Button>
        )}
        {streaming && !discussion ? (
          <Button type="button" variant="outline" size="icon-sm" aria-label="중지" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" size="icon-sm" aria-label="전송" onClick={() => void submit()} disabled={!canSend} title={blocked ? blockedReason : undefined}>
            <Send />
          </Button>
        )}
      </div>
    </div>
  )
}
