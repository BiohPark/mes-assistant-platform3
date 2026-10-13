import { newId } from '@/lib/ids'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cancelRequest, streamRequest } from '@/api/requests'
import { useSlowRequestBubble } from '@/features/assistant-pill/bubbles'
import { useT } from '@/i18n'

export interface ChatRun { requestId: string; replyId: string; text: string; reasoning?: string; phase?: string; startedAt?: number }
interface Attempt { key: string; threadId: string; requestId?: string; startedAt?: number; text: string; attachmentIds: string[]; path: string; body: unknown; autoStartNotified?: boolean }
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

export function queueFirstRequest(threadId: string, body: { content: string; attachmentIds: string[]; oneShotFileIds: string[] }) {
  const attempt = load(threadId) ?? { key: newId(), threadId, text: body.content, attachmentIds: body.attachmentIds,
    path: `/threads/${encodeURIComponent(threadId)}/requests`, body }
  save(attempt)
}

export function useChat(threadId?: string, onAutoStarted?: () => void) {
  const t = useT()
  const query = useQueryClient()
  const autoStarted = useRef(onAutoStarted)
  autoStarted.current = onAutoStarted
  const [run, setRun] = useState<ChatRun | null>(null)
  useSlowRequestBubble(run) // 도우미 말풍선(U6) — started 뒤 delta 없이 30초면 요청당 1회
  /** 전송 시도가 진행 중(started 이전 대기 포함)인지. run은 started 이후에만 채워진다. */
  const [waitingSince, setWaitingSince] = useState<number | undefined>()
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
                // 재시도는 처음부터 requestId가 있으므로 요청 ID가 아니라 시도별 표시로 알림 중복(재연결 재생)을 막는다
                const notify = data.autoStarted === true && !attempt.autoStartNotified
                if (notify) attempt.autoStartNotified = true
                attempt.requestId = String(data.requestId)
                save(attempt)
                if (notify) autoStarted.current?.()
                setRun({ requestId: attempt.requestId, replyId: String(data.replyMessageId), text: String(data.resumedText ?? ''), reasoning: String(data.resumedReasoning ?? ''),
                  startedAt: typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : attempt.startedAt })
                void query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
              } else if (event === 'phase') {
                setRun((current) => current ? { ...current, phase: String(data.text) } : current)
              } else if (event === 'reasoning') {
                setRun((current) => current ? { ...current, reasoning: (current.reasoning ?? '') + String(data.text), phase: '생각 중' } : current)
              } else if (event === 'delta') {
                setRun((current) => current ? { ...current, text: current.text + String(data.text), phase: '답변 중' } : current)
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
      }
    })()
    active.current = work
    void work.finally(() => { if (active.current === work) active.current = null }).catch(() => undefined)
    return work
  }, [query, t])

  useEffect(() => {
    if (!threadId) return
    const previous = load(threadId)
    if (previous) void consume(previous).catch(() => undefined)
  }, [consume, threadId])

  return {
    run,
    sending,
    waitingSince,
    hasPendingAttempt: () => !!(threadId && load(threadId)),
    /** 보관된(전송하지 못한) 시도의 내용 — 다음 전송이 이것을 그대로 다시 보낸다 */
    pendingAttempt: (): { text: string; attachmentIds: string[] } | null => { const attempt = threadId ? load(threadId) : null; return attempt && { text: attempt.text, attachmentIds: attempt.attachmentIds } },
    send: (content: string, attachmentIds: string[] = [], oneShotFileIds: string[] = []) => {
      if (!threadId) throw new Error(t('chat.noThread'))
      const attempt = load(threadId) ?? { key: newId(), threadId, text: content, attachmentIds,
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
