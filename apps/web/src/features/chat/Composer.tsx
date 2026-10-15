import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { ClipboardList, FileText, MessagesSquare, Paperclip, Send, Square, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { FILE_MAX_PER_REQUEST } from '@mes/contracts'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/admin'
import { useT } from '@/i18n'
import { getDraft, setDraft, type ComposerDraft } from './drafts'

/** 보낼 첨부 1건. 자료함에 남고 이 요청에만 함께 간다(D54 개정). 팀 의견 첨부는 AI에 보내지 않는다 */
export interface PendingAttachment {
  file: File
  uploadedId?: string
  uploadedTaskId?: string
}

/** 입력창 위 첨부 칩 1개 — 자료함에서 첨부한 파일·대화·SR 본문. 직접 올린 파일 칩과 같은 줄·같은 모양으로 보이고 ×로 뺀다 */
export interface AttachmentChip {
  key: string
  kind: 'file' | 'conversation' | 'sr'
  label: string
  /** 툴팁 — 버전·전달 방식·제목 등 칩에 다 못 쓰는 설명 */
  title?: string
  /** onToggleMain이 있으면 ★ 주 입력 전환을 보인다 */
  main?: boolean
  onToggleMain?: () => void
  onRemove?: () => void
  disabled?: boolean
  /** 전달 실패 등 */
  danger?: boolean
  /** 새 추정을 기다리는 중 — 흐리게 */
  busy?: boolean
}
const chipIcon = { file: FileText, conversation: MessagesSquare, sr: ClipboardList }
const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs'

/** 드래그앤드랍 등 바깥에서 파일을 넣는 경로 — 첨부 버튼과 같은 한도를 적용한다 */
export interface ComposerHandle {
  /** 추가됐으면 true, 한도 초과로 거부됐으면 false */
  dropFiles: (files: File[]) => boolean
  /** 텍스트만 바꾸고 입력에 포커스한다. 첨부·팀 의견 모드는 유지한다 */
  setText: (text: string) => void
  /** 첫 요청이 화면 이동 뒤 실패했을 때 보낸 글·첨부를 복원한다. 새 초안은 유지한다 */
  restoreDraft: (draft: Pick<ComposerDraft, 'text' | 'pending'>) => void
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>
  disabled?: boolean
  streaming: boolean
  placeholder?: string
  inputLabel?: string
  maxAttachments?: number
  /** SR 자료함에서 담은 파일도 글 없이 보낼 수 있다 */
  stagedAttachmentCount?: number
  /** discussion=true 이면 팀 의견(AI 미전송) */
  onSend: (text: string, attachments: PendingAttachment[], discussion: boolean) => Promise<void | boolean>
  /** Ask for confirmation before marking the draft as sent; false preserves it without an error. */
  beforeSend?: (discussion: boolean) => Promise<boolean>
  onStop: () => void
  suggestions?: string[]
  allowAttachments?: boolean
  onTyping?: () => void
  /** 팀 의견 토글 노출 여부 (업무 채팅에서만) */
  allowDiscussion?: boolean
  /** 보낼 수 없는 이유 (요청 크기 한도 초과 등). 팀 의견은 막지 않는다 */
  blockedReason?: string
  /** 작성 중인 글 (요청 크기 미리 계산용) */
  onDraftChange?: (text: string) => void
  clearOnSubmit?: boolean
  /** 대화별 초안 보존 키(taskId). 있으면 텍스트·첨부·팀 의견 모드를 메모리에 두고 다시 마운트될 때 복원한다 */
  draftKey?: string
  /** 입력창 왼쪽 아래(첨부 옆)에 놓는 도구 — 업무 채팅의 모델 선택 */
  tools?: ReactNode
  /** 자료함에서 첨부한 것 — 직접 올린 파일 칩 앞에 같은 줄로 보인다 */
  attachments?: AttachmentChip[]
  /** 칩 아래·입력창 위 안내 — 업무 채팅의 요청 크기(한도 근처에서만) */
  notice?: ReactNode
  /** 안쪽(칩·입력창) 폭 — 업무 채팅은 메시지 열과 같은 최대 폭 */
  contentClassName?: string
}

export function Composer({ ref, disabled, streaming, placeholder, inputLabel, maxAttachments, stagedAttachmentCount = 0, onSend, beforeSend, onStop, suggestions, allowAttachments = false, onTyping, allowDiscussion, blockedReason, onDraftChange, clearOnSubmit = false, draftKey, tools, attachments = [], notice, contentClassName }: ComposerProps) {
  const t = useT()
  const [saved] = useState(() => (draftKey ? getDraft(draftKey) : undefined))
  const [discussion, setDiscussionState] = useState(saved?.discussion ?? false)
  const [text, setTextState] = useState(saved?.text ?? '')
  const [pending, setPendingState] = useState<PendingAttachment[]>(saved?.pending ?? [])
  // 초안은 상태 갱신과 같은 틱에 Map에 쓴다. effect로 미루면 같은 배치에서 재마운트될 때 새 인스턴스가 옛 값을 읽어 첨부가 사라진다
  const latest = useRef<ComposerDraft>({ text, pending, discussion })
  const resolve = <T,>(next: T | ((current: T) => T), current: T): T => (typeof next === 'function' ? (next as (current: T) => T)(current) : next)
  // 전송 중인 내용. 초안에는 넣지 않는다 — 응답 중 다른 대화로 갔다 돌아왔을 때 보낸 질문·첨부가 되살아나 중복 요청이 되는 것을 막는다
  const sent = useRef<{ text: string; pending: PendingAttachment[] } | null>(null)
  // 언마운트 뒤(전환 후 늦게 끝난 전송)의 commit은 새 인스턴스가 쓰는 초안을 지우므로 막는다
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const commit = (patch: Partial<ComposerDraft>) => {
    latest.current = { ...latest.current, ...patch }
    if (!draftKey || !mounted.current) return
    const inFlight = sent.current
    setDraft(draftKey, inFlight ? { ...latest.current, text: latest.current.text === inFlight.text ? '' : latest.current.text, pending: latest.current.pending.filter((item) => !inFlight.pending.includes(item)) } : latest.current)
  }
  const setDiscussion = (next: boolean | ((current: boolean) => boolean)) => { const value = resolve(next, latest.current.discussion); commit({ discussion: value }); setDiscussionState(value) }
  const setPending = (next: PendingAttachment[] | ((current: PendingAttachment[]) => PendingAttachment[])) => { const value = resolve(next, latest.current.pending); commit({ pending: value }); setPendingState(value) }
  const writeText = (next: string | ((current: string) => string)) => { const value = resolve(next, latest.current.text); commit({ text: value }); setTextState(value) }
  const [attachmentError, setAttachmentError] = useState('')
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: maxAttachments === undefined }).data
  const attachmentLimit = maxAttachments ?? settings?.fileMaxPerRequest ?? FILE_MAX_PER_REQUEST
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submitting = useRef(false)
  const blocked = !discussion && !!blockedReason
  const canSend = !disabled && !blocked && (discussion || !streaming) && (text.trim().length > 0 || pending.length > 0 || (!discussion && stagedAttachmentCount > 0))

  const setText = (v: string) => {
    writeText(v)
    onDraftChange?.(v)
  }

  function addFiles(files: File[]): boolean {
    const picked = files.map((file) => ({ file }))
    if (pending.length + picked.length + stagedAttachmentCount > attachmentLimit) { setAttachmentError(t('chat.attachmentLimit', { limit: String(attachmentLimit) })); return false }
    setPending((p) => [...p, ...picked])
    setAttachmentError('')
    return true
  }
  useImperativeHandle(ref, () => ({
    restoreDraft: (draft) => {
      writeText(current => current || draft.text)
      onDraftChange?.(latest.current.text)
      setPending(current => [...draft.pending.filter(item => !current.includes(item)), ...current])
    },
    setText: (value) => {
      if (disabled) return
      setText(value)
      textareaRef.current?.focus()
    },
    dropFiles: (files) => {
      if (disabled || !allowAttachments || !addFiles(files)) return false
      toast.success(t('dropzone.attached', { count: files.length }))
      return true
    },
  }))

  async function submit() {
    if (!canSend || submitting.current) return
    submitting.current = true
    const submittedText = text
    const f = pending
    try {
      if (beforeSend && !await beforeSend(discussion)) return
      if (!mounted.current) return
      if (clearOnSubmit) { setText(''); setPending([]) }
      else { sent.current = { text: submittedText, pending: f }; commit({}) }
      const accepted = await onSend(submittedText, f, discussion)
      if (accepted === false) {
        if (clearOnSubmit) { setText(submittedText); setPending(f) }
        else { sent.current = null; commit({}) }
        return
      }
      // 보낸 것만 지운다 — 응답이 화면에서 끝난 뒤 onSend가 풀리기까지 사용자가 다음 메시지(텍스트·첨부)를 준비했을 수 있다
      if (!clearOnSubmit) { sent.current = null; writeText((current) => (current === submittedText ? '' : current)); setPending((current) => current.filter((item) => !f.includes(item))); if (latest.current.text === '') onDraftChange?.('') }
    } catch (e) {
      if (clearOnSubmit) { writeText((current) => current || submittedText); onDraftChange?.(latest.current.text); setPending((current) => [...f.filter((item) => !current.includes(item)), ...current]) }
      else { sent.current = null; commit({}) } // 실패한 초안은 다시 보존 대상
      toast.error(t('chat.sendFailed'), { description: e instanceof Error ? e.message : String(e) })
    } finally { submitting.current = false }
  }

  const chipCount = attachments.length + pending.length
  return (
    <div className="border-t bg-card p-2.5" data-tour="composer"><div className={cn('mx-auto w-full', contentClassName)}>
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
      {chipCount > 0 && (
        <ul aria-label={t('chat.attachments')} data-tour="materials-staged" data-testid="composer-attachments" className="mb-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {attachments.map((chip) => {
            const Icon = chipIcon[chip.kind]
            return <li key={chip.key} title={chip.title} className={cn(chipClass, chip.danger && 'border-destructive/50 text-destructive', chip.busy && 'opacity-60')}>
              {chip.onToggleMain && <button type="button" disabled={chip.disabled} aria-label={t('chat.toggleMain', { name: chip.label })} aria-pressed={!!chip.main} onClick={chip.onToggleMain}>
                <Star className={cn('size-3', chip.main && 'fill-tone-warning-fg text-tone-warning-fg')} />
              </button>}
              <Icon className="size-3 shrink-0" /><span className="truncate">{chip.label}</span>
              {chip.onRemove && <button type="button" disabled={chip.disabled} aria-label={t('task.materials.unstage', { label: chip.label })} onClick={chip.onRemove}><X className="size-3" /></button>}
            </li>
          })}
          {pending.map((p, i) => (
            <li key={`pending-${i}`} className={chipClass}>
              <Paperclip className="size-3 shrink-0" /><span className="truncate">{p.file.name}</span>
              <button type="button" aria-label={t('chat.removeAttachment')} onClick={() => setPending((cur) => cur.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice}
      {attachmentError && <div role="alert" className="mb-1 text-xs text-destructive">{attachmentError}</div>}
      <div className={cn('rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/40', discussion && 'border-tone-warning-fg/40 bg-tone-warning-bg')}>
        <Textarea
          ref={textareaRef}
          aria-label={inputLabel ?? (discussion ? t('chat.composerLabel') : t('chat.requestLabel'))}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) onTyping?.()
          }}
          placeholder={discussion ? t('chat.discussionPlaceholder') : (placeholder ?? t('chat.composerPlaceholder'))}
          rows={1}
          disabled={disabled}
          className="max-h-40 min-h-8 w-full resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {/* 아래 줄: 왼쪽에 첨부·도구(모델), 오른쪽에 팀 의견·전송 */}
        <div className="flex items-center gap-1">
          {allowAttachments && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('chat.attachFile')} data-tour={chipCount ? undefined : 'materials-staged'} onClick={() => inputRef.current?.click()} disabled={disabled}>
              <Paperclip />
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          {tools}
          <span className="flex-1" />
          {allowDiscussion && (
            <Button
              type="button"
              variant={discussion ? 'secondary' : 'ghost'}
              size="icon-sm"
              data-tour="discussion"
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
    </div></div>
  )
}
