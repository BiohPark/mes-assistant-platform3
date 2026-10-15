import { newId } from '@/lib/ids'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cancelRequest, streamRequest } from '@/api/requests'
import { useSlowRequestBubble } from '@/features/assistant-pill/bubbles'
import { rememberMyRequest } from '@/features/assistant-pill/replyBubble'
import { getDraft, setDraft, type ComposerDraft } from './drafts'
import { useT } from '@/i18n'

/** firstTokenMs·idleMs: 서버가 알린 이 요청의 첫 응답·무응답 제한(ms) */
export interface ChatRun { requestId: string; replyId: string; text: string; reasoning?: string; phase?: string; startedAt?: number; firstTokenMs?: number; idleMs?: number }
interface Attempt { key: string; threadId: string; requestId?: string; startedAt?: number; text: string; attachmentIds: string[]; path: string; body: unknown; autoStartNotified?: boolean }
interface FirstDraft { taskId: string; draft: ComposerDraft }
const firstDrafts = new Map<string, FirstDraft>()
const storageKey = (threadId: string) => `mes-chat-attempt:${threadId}`
const load = (threadId: string): Attempt | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(threadId))
    const attempt = raw ? JSON.parse(raw) as Attempt : null
    return attempt?.threadId === threadId && attempt.key && attempt.path ? attempt : null
  } catch { return null }
}
const save = (attempt: Attempt) => sessionStorage.setItem(storageKey(attempt.threadId), JSON.stringify(attempt))
const clear = (attempt: Attempt) => sessionStorage.removeItem(storageKey(attempt.threadId))

export function queueFirstRequest(threadId: string, body: { content: string; attachmentIds: string[]; oneShotFileIds: string[] }, startedAt = Date.now(), restore?: FirstDraft) {
  const attempt = load(threadId) ?? { key: newId(), threadId, startedAt, text: body.content, attachmentIds: body.attachmentIds,
    path: `/threads/${encodeURIComponent(threadId)}/requests`, body }
  save(attempt)
  if (restore) firstDrafts.set(threadId, restore)
  else firstDrafts.delete(threadId)
}

export function useChat(threadId?: string, onAutoStarted?: () => void, onFirstFailure?: (draft: ComposerDraft, error: unknown) => void, onStarted?: () => void) {
  const t = useT()
  const query = useQueryClient()
  const autoStarted = useRef(onAutoStarted)
  autoStarted.current = onAutoStarted
  const started = useRef(onStarted)
  started.current = onStarted
  const firstFailure = useRef(onFirstFailure)
  firstFailure.current = onFirstFailure
  const [run, setRun] = useState<ChatRun | null>(null)
  useSlowRequestBubble(run) // 도우미 말풍선(U6) — 마지막 본문·생각 delta 뒤 30초 무진행이면 요청당 1회
  /** 전송 시도가 진행 중(started 이전 대기 포함)인지. run은 started 이후에만 채워진다. */
  const [waitingSince, setWaitingSince] = useState<number | undefined>(() => threadId ? load(threadId)?.startedAt : undefined)
  const [sending, setSending] = useState(false)
  const active = useRef<Promise<void> | null>(null)

  const consume = useCallback((attempt: Attempt): Promise<void> => {
    if (active.current) return active.current
    const work = (async () => {
      let terminal = false
      let failed: string | undefined
      attempt.startedAt ??= Date.now()
      save(attempt)
      setWaitingSince(attempt.startedAt)
      setSending(true)
      try {
        for (let number = 0; number < 2 && !terminal; number++) {
          try {
            await streamRequest(attempt.path, attempt.body, (event, data) => {
              if (event === 'started') {
                started.current?.()
                // 재시도는 처음부터 requestId가 있으므로 요청 ID가 아니라 시도별 표시로 알림 중복(재연결 재생)을 막는다
                const notify = data.autoStarted === true && !attempt.autoStartNotified
                if (notify) attempt.autoStartNotified = true
                attempt.requestId = String(data.requestId)
                save(attempt)
                rememberMyRequest(attempt.requestId) // 다른 창·탭의 도우미가 이 요청의 끝을 알린다(replyBubble)
                if (notify) autoStarted.current?.()
                setRun({ requestId: attempt.requestId, replyId: String(data.replyMessageId), text: String(data.resumedText ?? ''), reasoning: String(data.resumedReasoning ?? ''),
                  startedAt: typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : attempt.startedAt,
                  firstTokenMs: typeof data.firstTokenMs === 'number' ? data.firstTokenMs : undefined, idleMs: typeof data.idleMs === 'number' ? data.idleMs : undefined })
                void query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
              } else if (event === 'phase') {
                setRun((current) => current ? { ...current, phase: String(data.text) } : current)
              } else if (event === 'reasoning') {
                setRun((current) => current ? { ...current, reasoning: (current.reasoning ?? '') + String(data.text), phase: '생각 중' } : current)
              } else if (event === 'delta') {
                setRun((current) => current ? { ...current, text: current.text + String(data.text), phase: '답변 중' } : current)
              } else if (event === 'replace') {
                // OpenWebUI 세션 모드 — 누적 본문·생각이 이어지지 않으면 서버가 전체를 다시 보낸다
                setRun((current) => current ? data.field === 'reasoning' ? { ...current, reasoning: String(data.text), phase: '생각 중' }
                  : { ...current, text: String(data.text), phase: '답변 중' } : current)
              } else if (event === 'failed') {
                failed = String(data.error)
                terminal = true
              } else if (event === 'completed') terminal = true
            }, attempt.key)
            if (!terminal) throw new Error(t('chat.streamDisconnected'))
          } catch (error) {
            if (terminal || number === 1) throw error
          }
        }
        if (failed) throw new Error(failed)
      } finally {
        if (terminal) clear(attempt)
        setRun(null)
        setSending(false)
        setWaitingSince(undefined)
        await query.cancelQueries({ queryKey: ['messages', attempt.threadId] })
        await query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
        await query.invalidateQueries({ queryKey: ['activity'] })
        // 사용 기록(chat_request_input)은 전달 단계에서 쌓인다 — 끝난 뒤 자료함의 사용됨·첨부됨을 다시 읽는다(완료 SSE는 이 목록을 건드리지 않는다)
        for (const key of ['candidates', 'sr-inputs', 'conversation-inputs']) void query.invalidateQueries({ queryKey: [key] })
      }
    })()
    active.current = work
    void work.finally(() => { if (active.current === work) active.current = null }).catch(() => undefined)
    return work
  }, [query, t])

  useEffect(() => {
    if (!threadId) return
    const previous = load(threadId)
    const restore = firstDrafts.get(threadId)
    if (previous) void consume(previous).then(() => {
      if (firstDrafts.get(threadId) === restore) firstDrafts.delete(threadId)
    }).catch(error => {
      if (!restore || firstDrafts.get(threadId) !== restore) return
      firstDrafts.delete(threadId)
      const current = getDraft(restore.taskId)
      const draft: ComposerDraft = {
        text: current?.text || restore.draft.text,
        pending: [...restore.draft.pending.filter(item => !current?.pending.includes(item)), ...(current?.pending ?? [])],
        discussion: current?.discussion ?? restore.draft.discussion,
      }
      setDraft(restore.taskId, draft)
      firstFailure.current?.(draft, error)
    })
  }, [consume, threadId])

  return {
    run,
    sending,
    waitingSince,
    hasPendingAttempt: () => !!(threadId && load(threadId)),
    /** 보관된(전송하지 못한) 시도의 내용 — 다음 전송이 이것을 그대로 다시 보낸다 */
    pendingAttempt: (): { text: string; attachmentIds: string[] } | null => { const attempt = threadId ? load(threadId) : null; return attempt && { text: attempt.text, attachmentIds: attempt.attachmentIds } },
    send: (content: string, attachmentIds: string[] = [], oneShotFileIds: string[] = [], startedAt = Date.now()) => {
      if (!threadId) throw new Error(t('chat.noThread'))
      const attempt = load(threadId) ?? { key: newId(), threadId, startedAt, text: content, attachmentIds,
        path: `/threads/${encodeURIComponent(threadId)}/requests`, body: { content, attachmentIds, oneShotFileIds } }
      save(attempt)
      return consume(attempt)
    },
    retry: (requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) => {
      if (!threadId) throw new Error(t('chat.noThread'))
      const attempt = load(threadId) ?? { key: newId(), threadId, requestId, text: '', attachmentIds: [],
        path: `/requests/${encodeURIComponent(requestId)}/retry`, body: options }
      save(attempt)
      return consume(attempt)
    },
    stop: async (requestId?: string) => { const id = requestId ?? run?.requestId; if (id) await cancelRequest(id) },
  }
}
