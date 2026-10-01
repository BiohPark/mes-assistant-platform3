import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

export type LiveEvent = { event: string; data: Record<string, unknown> }
const listeners = new Set<(event: LiveEvent) => void>()
export function subscribeEvent(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

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
  if (event === 'message.appended' || event === 'request.updated') {
    if (threadId) invalidate(['messages', threadId])
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
  if (event === 'notification.created') invalidate(['notifications'])
}

export function useEvents() {
  const query = useQueryClient()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events')
    const names = ['task.created', 'task.updated', 'message.appended', 'request.updated', 'file.updated', 'input.updated',
      'context.updated', 'presence.typing', 'notification.created', 'resync']
    const handlers = names.map((event) => {
      const handler = (message: Event) => {
        const data = JSON.parse((message as MessageEvent<string>).data || '{}') as Record<string, unknown>
        applyEvent(query, event, data)
        for (const listener of listeners) listener({ event, data })
      }
      source.addEventListener(event, handler)
      return [event, handler] as const
    })
    return () => { for (const [event, handler] of handlers) source.removeEventListener(event, handler); source.close() }
  }, [query])
}
