import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cancelRequest, streamRequest } from '@/api/requests'

export interface ChatRun { requestId: string; replyId: string; text: string; phase?: string }

export function useChat(threadId?: string) {
  const query = useQueryClient()
  const [run, setRun] = useState<ChatRun | null>(null)

  const consume = useCallback(async (path: string, body: unknown) => {
    let failed: string | undefined
    try {
      await streamRequest(path, body, (event, data) => {
        if (event === 'started') {
          setRun({ requestId: String(data.requestId), replyId: String(data.replyMessageId), text: '' })
          void query.invalidateQueries({ queryKey: ['messages', threadId] })
        } else if (event === 'phase') {
          setRun((current) => current ? { ...current, phase: String(data.text) } : current)
        } else if (event === 'delta') {
          setRun((current) => current ? { ...current, text: current.text + String(data.text) } : current)
        } else if (event === 'failed') failed = String(data.error)
      })
      if (failed) throw new Error(failed)
    } finally {
      setRun(null)
      await query.invalidateQueries({ queryKey: ['messages', threadId] })
      await query.invalidateQueries({ queryKey: ['activity'] })
    }
  }, [query, threadId])

  return {
    run,
    send: (content: string, attachmentIds: string[] = [], oneShotFileIds: string[] = []) => {
      if (!threadId) throw new Error('스레드가 없습니다')
      return consume(`/threads/${encodeURIComponent(threadId)}/requests`, { content, attachmentIds, oneShotFileIds })
    },
    retry: (requestId: string, options: { excludeFileIds?: string[]; forceInlineFileIds?: string[] } = {}) => consume(`/requests/${encodeURIComponent(requestId)}/retry`, options),
    stop: async (requestId?: string) => { const id = requestId ?? run?.requestId; if (id) await cancelRequest(id) },
  }
}
