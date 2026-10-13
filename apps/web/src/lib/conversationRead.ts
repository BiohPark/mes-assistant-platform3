import { useEffect, useSyncExternalStore } from 'react'
import type { Task } from '@mes/domain'

const eventName = 'mes-conversation-read'
const storageKey = (userId: string, taskId: string) => `mes:last-viewed:${encodeURIComponent(userId)}:${encodeURIComponent(taskId)}`
function read(userId: string, taskId: string): number {
  try { return Number(localStorage.getItem(storageKey(userId, taskId))) || 0 } catch { return 0 }
}
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener)
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener('storage', listener) }
}
export function markConversationViewed(userId: string, taskId: string, at: number) {
  if (!userId || !Number.isFinite(at) || at <= 0 || at <= read(userId, taskId)) return
  try {
    localStorage.setItem(storageKey(userId, taskId), String(at))
    window.dispatchEvent(new Event(eventName))
  } catch { /* Storage can be unavailable in private browsing. */ }
}
export function useConversationViewed(userId: string, taskId: string, lastActivityAt: string) {
  const latest = Date.parse(lastActivityAt) || 0
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible') markConversationViewed(userId, taskId, latest) }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [userId, taskId, latest])
}
/** Use activity already present in task lists, including file/status changes, without fetching messages. */
export function useConversationUnread(task: Task, userId: string) {
  const viewed = useSyncExternalStore(subscribe, () => read(userId, task.id), () => 0)
  return !!userId && Date.parse(task.lastActivityAt) > viewed
}
