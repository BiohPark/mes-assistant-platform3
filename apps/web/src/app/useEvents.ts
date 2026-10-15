import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

export type LiveEvent = { event: string; data: Record<string, unknown> }
const listeners = new Set<(event: LiveEvent) => void>()
export function subscribeEvent(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** 구독자에게 전달 — SSE 핸들러와 테스트가 쓴다 */
export function emitEvent(event: LiveEvent) { for (const listener of listeners) listener(event) }

export function applyEvent(query: QueryClient, event: string, data: Record<string, unknown>) {
  if (event === 'resync') { void query.invalidateQueries(); return }
  const taskId = typeof data.taskId === 'string' ? data.taskId : undefined
  const threadId = typeof data.threadId === 'string' ? data.threadId : undefined
  const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
  const invalidate = (key: unknown[]) => { void query.invalidateQueries({ queryKey: key }) }
  if (event === 'task.created' || event === 'task.updated') {
    invalidate(['tasks']); invalidate(['assistant-stats']); invalidate(['tag-suggest']); invalidate(['candidates']); invalidate(['estimate'])
    if (taskId) { invalidate(['task', taskId]); invalidate(['activity', taskId]); invalidate(['notes', taskId]); invalidate(['task-report-preview', taskId]) }
  }
  // 연결 대화의 소유자·담당자 변경과 삭제도 SR 큐에 반영한다. GET에서 현재 권한을 다시 적용한다.
  if (event === 'task.updated') invalidate(['sr'])
  if (event === 'message.appended' || event === 'request.updated') {
    if (threadId) {
      void query.cancelQueries({ queryKey: ['messages', threadId] })
      invalidate(['messages', threadId])
    }
    if (taskId) { invalidate(['activity', taskId]); invalidate(['task', taskId]) }
    if (requestId) invalidate(['request', requestId])
    invalidate(['tasks']); invalidate(['estimate'])
    if (event === 'message.appended') { invalidate(['candidates']); invalidate(['conversation-inputs']) }
  }
  if (event === 'file.updated' || event === 'input.updated') {
    if (taskId) { invalidate(['files', taskId]); invalidate(['candidates', taskId]); invalidate(['task', taskId]); invalidate(['activity', taskId]) }
    invalidate(['tasks']); invalidate(['candidates']); invalidate(['file-versions']); invalidate(['estimate'])
  }
  if (event === 'context.updated') {
    if (taskId) { invalidate(['conversation-inputs', taskId]); invalidate(['candidates', taskId]); invalidate(['task', taskId]); invalidate(['activity', taskId]) }
    invalidate(['estimate'])
  }
  // 요약 카드는 진입 때만 새로 만든다 — 저장이 끝났다는 알림에만 다시 읽는다
  if (event === 'brief.updated' && taskId) invalidate(['chat-brief', taskId])
  if (event === 'sr.updated') invalidate(['sr'])
  if (event === 'notification.created') invalidate(['notifications'])
}

export function useEvents(enabled = true) {
  const query = useQueryClient()
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events')
    const names = ['task.created', 'task.updated', 'message.appended', 'request.updated', 'file.updated', 'input.updated',
      'context.updated', 'brief.updated', 'sr.updated', 'presence.typing', 'notification.created', 'resync']
    const handlers = names.map((event) => {
      const handler = (message: Event) => {
        const data = JSON.parse((message as MessageEvent<string>).data || '{}') as Record<string, unknown>
        applyEvent(query, event, data)
        emitEvent({ event, data })
      }
      source.addEventListener(event, handler)
      return [event, handler] as const
    })
    return () => { for (const [event, handler] of handlers) source.removeEventListener(event, handler); source.close() }
  }, [query, enabled])
}
