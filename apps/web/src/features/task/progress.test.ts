import { expect, it } from 'vitest'
import { isTaskStalled, STALE_AFTER_MS } from './progress'

it('marks only in-progress tasks older than seven days without changing their status', () => {
  const now = Date.parse('2026-10-13T00:00:00Z')
  const at = (age: number) => new Date(now - age).toISOString()
  for (const status of ['todo', 'in_progress', 'on_hold', 'done'] as const) {
    const task = { status, lastActivityAt: at(STALE_AFTER_MS + 1) }
    expect(isTaskStalled(task, now)).toBe(status === 'in_progress')
    expect(task.status).toBe(status)
  }
  for (const lastActivityAt of [at(STALE_AFTER_MS), at(STALE_AFTER_MS - 1), at(-1), 'invalid']) {
    expect(isTaskStalled({ status: 'in_progress', lastActivityAt }, now)).toBe(false)
  }
})
