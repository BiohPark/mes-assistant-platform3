import { expect, it } from 'vitest'
import type { TaskSummary } from '@mes/domain'
import { groupWork, dueBucket } from './groups'

it('groups calendar deadlines into overdue, today, this week, later and none', () => {
  const now = new Date(2026, 9, 15, 23, 59)
  expect(['2026-10-14', '2026-10-15', '2026-10-18', '2026-10-19', undefined].map(date => dueBucket(date, now))).toEqual(['overdue', 'today', 'week', 'later', 'none'])
})
it('includes multi-SR conversations in each SR group using linkedSrCodes only', () => {
  const task = { id: 't', linkedSrCodes: ['SR-1', 'SR-2', 'SR-1'], tags: ['SR-unlinked'] } as TaskSummary
  const groups = groupWork([task], 'sr')
  expect(groups.map(group => group.key)).toEqual(['SR-1', 'SR-2'])
  expect(groups.every(group => group.items[0] === task)).toBe(true)
})
