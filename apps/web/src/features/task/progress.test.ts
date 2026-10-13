import { expect, it } from 'vitest'
import { clockOffset, isTaskStalled, STALE_AFTER_MS } from './progress'

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

it('measures the server clock offset from the Date header and corrects a fast browser clock', () => {
  const server = Date.parse('2026-10-13T00:00:00Z')
  const browser = server + 2 * 60 * 60 * 1000 // 브라우저 시계가 2시간 빠르다
  const offset = clockOffset(new Date(server).toUTCString(), browser - 100, browser + 100)
  expect(offset).toBe(server - browser)
  const task = { status: 'in_progress' as const, lastActivityAt: new Date(server - STALE_AFTER_MS + 60 * 60 * 1000).toISOString() } // 서버 기준 6일 23시간
  expect(isTaskStalled(task, browser)).toBe(true)
  expect(isTaskStalled(task, browser + offset)).toBe(false)
  for (const header of [null, '', 'not a date']) expect(clockOffset(header, browser, browser)).toBe(0)
})
