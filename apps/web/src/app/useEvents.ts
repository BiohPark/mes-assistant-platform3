import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { patchTaskPhase, resetTaskPages, type TaskListCache } from '@/api/tasks.cache'

export type LiveEvent = { event: string; data: Record<string, unknown> }
const listeners = new Set<(event: LiveEvent) => void>()
export function subscribeEvent(listener: (event: LiveEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** 구독자에게 전달 — SSE 핸들러와 테스트가 쓴다 */
export function emitEvent(event: LiveEvent) { for (const listener of listeners) listener(event) }

const TASK_LIST_THROTTLE_MS = 2_000
type EventState = {
  lastInvalidated?: number
  timer?: ReturnType<typeof setTimeout>
  requestStatuses: Map<string, string>
}
const eventStates = new WeakMap<QueryClient, EventState>()
function eventState(query: QueryClient): EventState {
  let state = eventStates.get(query)
  if (!state) { state = { requestStatuses: new Map() }; eventStates.set(query, state) }
  return state
}
function clearEventState(query: QueryClient) {
  const state = eventStates.get(query)
  if (state?.timer !== undefined) clearTimeout(state.timer)
  eventStates.delete(query)
}
function invalidateTaskList(query: QueryClient) {
  const state = eventState(query)
  const remaining = state.lastInvalidated === undefined ? 0 : TASK_LIST_THROTTLE_MS - (Date.now() - state.lastInvalidated)
  const invalidate = () => {
    state.timer = undefined
    state.lastInvalidated = Date.now()
    resetTaskPages(query)
    void query.invalidateQueries({ queryKey: ['tasks'] })
  }
  if (remaining <= 0) {
    if (state.timer !== undefined) clearTimeout(state.timer)
    invalidate()
  } else if (state.timer === undefined) state.timer = setTimeout(invalidate, remaining)
}
function requestStatusChanged(query: QueryClient, requestId: string | undefined, status: unknown): boolean {
  if (!requestId || typeof status !== 'string') return false
  const statuses = eventState(query).requestStatuses
  const previous = statuses.get(requestId) ?? query.getQueryData<{ status: string }>(['request', requestId])?.status
  statuses.delete(requestId)
  statuses.set(requestId, status)
  // SSE 재생 버퍼와 같은 크기로 제한해 장시간 열린 창에서도 기록이 계속 쌓이지 않게 한다.
  if (statuses.size > 1_000) statuses.delete(statuses.keys().next().value!)
  return previous !== status
}

export function applyEvent(query: QueryClient, event: string, data: Record<string, unknown>) {
  if (event === 'resync') { clearEventState(query); resetTaskPages(query); void query.invalidateQueries(); return }
  const taskId = typeof data.taskId === 'string' ? data.taskId : undefined
  const threadId = typeof data.threadId === 'string' ? data.threadId : undefined
  const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
  const invalidate = (key: unknown[]) => {
    if (key[0] === 'tasks') invalidateTaskList(query)
    else void query.invalidateQueries({ queryKey: key })
  }
  if (event === 'task.created' || event === 'task.updated') {
    invalidate(['tasks']); invalidate(['assistant-stats']); invalidate(['tag-suggest']); invalidate(['candidates']); invalidate(['estimate'])
    if (taskId) { invalidate(['task', taskId]); invalidate(['activity', taskId]); invalidate(['notes', taskId]); invalidate(['task-report-preview', taskId]) }
  }
  // 연결 대화의 소유자·담당자 변경과 삭제도 SR 큐에 반영한다. GET에서 현재 권한을 다시 적용한다.
  if (event === 'task.updated') invalidate(['sr'])
  if (event === 'message.appended' || event === 'request.updated') {
    if (event === 'message.appended' || requestStatusChanged(query, requestId, data.status)) invalidate(['tasks'])
    // 단계만 바뀌면 목록 GET 없이 AI 칩의 tooltip을 갱신한다. 상태와 활동 시각은 GET을 따른다.
    if (event === 'request.updated' && taskId && (data.status === 'pending' || data.status === 'streaming') &&
      (typeof data.phase === 'string' || data.phase === null)) {
      const phase = data.phase ?? undefined
      query.setQueriesData<TaskListCache>({ queryKey: ['tasks'] }, tasks => patchTaskPhase(tasks, taskId, String(data.status), phase))
    }
    if (threadId) {
      void query.cancelQueries({ queryKey: ['messages', threadId] })
      invalidate(['messages', threadId])
    }
    if (taskId) { invalidate(['activity', taskId]); invalidate(['task', taskId]) }
    if (requestId) invalidate(['request', requestId])
    invalidate(['estimate'])
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
    return () => {
      for (const [event, handler] of handlers) source.removeEventListener(event, handler)
      source.close()
      clearEventState(query)
    }
  }, [query, enabled])
}
