import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cancelRequest, streamRequest } from '@/api/requests'

export interface ChatRun { requestId: string; replyId: string; text: string; phase?: string }
interface Attempt { key: string; threadId: string; requestId?: string; text: string; attachmentIds: string[]; path: string; body: unknown }
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
  const attempt = load(threadId) ?? { key: crypto.randomUUID(), threadId, text: body.content, attachmentIds: body.attachmentIds,
    path: `/threads/${encodeURIComponent(threadId)}/requests`, body }
  save(attempt)
}

export function useChat(threadId?: string) {
  const query = useQueryClient()
  const [run, setRun] = useState<ChatRun | null>(null)
  const active = useRef<Promise<void> | null>(null)

  const consume = useCallback((attempt: Attempt): Promise<void> => {
    if (active.current) return active.current
    const work = (async () => {
      let terminal = false
      let failed: string | undefined
      try {
        for (let number = 0; number < 2 && !terminal; number++) {
          try {
            await streamRequest(attempt.path, attempt.body, (event, data) => {
              if (event === 'started') {
                attempt.requestId = String(data.requestId)
                save(attempt)
                setRun({ requestId: attempt.requestId, replyId: String(data.replyMessageId), text: String(data.resumedText ?? '') })
                void query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
              } else if (event === 'phase') {
                setRun((current) => current ? { ...current, phase: String(data.text) } : current)
              } else if (event === 'delta') {
                setRun((current) => current ? { ...current, text: current.text + String(data.text) } : current)
              } else if (event === 'failed') {
                failed = String(data.error)
                terminal = true
              } else if (event === 'completed') terminal = true
            }, attempt.key)
            if (!terminal) throw new Error('스트림 연결이 끊겼습니다')
          } catch (error) {
            if (terminal || number === 1) throw error
          }
        }
        if (failed) throw new Error(failed)
      } finally {
        if (terminal) clear(attempt)
        setRun(null)
        await query.invalidateQueries({ queryKey: ['messages', attempt.threadId] })
        await query.invalidateQueries({ queryKey: ['activity'] })
      }
    })()
    active.current = work
    void work.finally(() => { if (active.current === work) active.current = null }).catch(() => undefined)
    return work
  }, [query])

  useEffect(() => {
    if (!threadId) return
    const previous = load(threadId)
    if (previous) void consume(previous).catch(() => undefined)
  }, [consume, threadId])

  return {
    run,
    hasPendingAttempt: () => !!(threadId && load(threadId)),
    send: (content: string, attachmentIds: string[] = [], oneShotFileIds: string[] = []) => {
      if (!threadId) throw new Error('스레드가 없습니다')
      const attempt = load(threadId) ?? { key: crypto.randomUUID(), threadId, text: content, attachmentIds,
        path: `/threads/${encodeURIComponent(threadId)}/requests`, body: { content, attachmentIds, oneShotFileIds } }
      save(attempt)
      return consume(attempt)
    },
    retry: (requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) => {
      if (!threadId) throw new Error('스레드가 없습니다')
      const attempt = load(threadId) ?? { key: crypto.randomUUID(), threadId, requestId, text: '', attachmentIds: [],
        path: `/requests/${encodeURIComponent(requestId)}/retry`, body: options }
      save(attempt)
      return consume(attempt)
    },
    stop: async (requestId?: string) => { const id = requestId ?? run?.requestId; if (id) await cancelRequest(id) },
  }
}
