import type { ChecklistItem, ID, ISODate, Task, TaskStatus } from './types.js'

/** 업무 상태 전이. 항상 새 객체를 반환한다. */
export function applyTaskStatus(task: Task, status: TaskStatus, userId: ID, at: ISODate): Task {
  const { completedAt: _c, completedBy: _b, ...rest } = task
  if (status === 'done') {
    return { ...rest, status, startedAt: task.startedAt ?? at, completedAt: at, completedBy: userId }
  }
  if (status === 'in_progress' || status === 'on_hold') {
    return { ...rest, status, startedAt: task.startedAt ?? at }
  }
  return { ...rest, status }
}

export function missingRequiredChecklist(task: Pick<Task, 'checklist'>): ChecklistItem[] {
  return task.checklist.filter((c) => c.required && !c.checked)
}

export function toggleChecklistItem(task: Task, itemId: ID, userId: ID, at: ISODate): Task {
  return {
    ...task,
    checklist: task.checklist.map((c) => {
      if (c.id !== itemId) return c
      if (c.checked) {
        const { checkedBy: _u, checkedAt: _t, ...rest } = c
        return { ...rest, checked: false }
      }
      return { ...c, checked: true, checkedBy: userId, checkedAt: at }
    }),
  }
}

export function checklistProgress(task: Pick<Task, 'checklist'>): { done: number; total: number } {
  return { done: task.checklist.filter((c) => c.checked).length, total: task.checklist.length }
}
