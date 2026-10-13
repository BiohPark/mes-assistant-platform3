import type { Task } from '@mes/domain'

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** A display hint only; never changes a conversation's status. */
export function isTaskStalled(task: Pick<Task, 'status' | 'lastActivityAt'>, now = Date.now()): boolean {
  return task.status === 'in_progress' && now - Date.parse(task.lastActivityAt) > STALE_AFTER_MS
}
