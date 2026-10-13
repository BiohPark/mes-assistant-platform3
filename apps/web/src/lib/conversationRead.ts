import { useEffect, useSyncExternalStore, type RefObject } from 'react'
import type { Task } from '@mes/domain'

const eventName = 'mes-conversation-read'
const storageKey = (userId: string, taskId: string) => `mes:last-viewed:${encodeURIComponent(userId)}:${encodeURIComponent(taskId)}`
const memory = new Map<string, number>()
function readStored(key: string): number | undefined {
  try { return Number(localStorage.getItem(key)) || 0 } catch { return undefined }
}
function read(userId: string, taskId: string): number {
  const key = storageKey(userId, taskId)
  return Math.max(readStored(key) ?? 0, memory.get(key) ?? 0)
}
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener)
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener('storage', listener) }
}
export function markConversationViewed(userId: string, taskId: string, at: number) {
  const key = storageKey(userId, taskId)
  const stored = readStored(key)
  if (!userId || !Number.isFinite(at) || at <= 0 || at <= Math.max(stored ?? 0, memory.get(key) ?? 0)) return
  memory.set(key, at)
  try {
    localStorage.setItem(key, String(at))
    if (stored !== undefined) memory.delete(key)
  } catch { /* Storage can be unavailable in private browsing. */ }
  window.dispatchEvent(new Event(eventName))
}
function panelVisible(element: HTMLElement | null): boolean {
  if (!element?.isConnected) return false
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current)
    if (current.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}
export function useConversationViewed(userId: string, taskId: string, lastActivityAt: string, panel: RefObject<HTMLElement | null>) {
  const latest = Date.parse(lastActivityAt) || 0
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible' && panelVisible(panel.current)) markConversationViewed(userId, taskId, latest) }
    mark()
    // Mobile tab classes and responsive breakpoints can hide a still-mounted chat.
    const observer = new MutationObserver(mark)
    for (let element = panel.current; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    }
    document.addEventListener('visibilitychange', mark)
    window.addEventListener('resize', mark)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', mark); window.removeEventListener('resize', mark) }
  }, [userId, taskId, latest, panel])
}
/** Use activity already present in task lists, including file/status changes, without fetching messages. */
export function useConversationUnread(task: Task, userId: string) {
  const viewed = useSyncExternalStore(subscribe, () => read(userId, task.id), () => 0)
  return !!userId && Date.parse(task.lastActivityAt) > viewed
}
