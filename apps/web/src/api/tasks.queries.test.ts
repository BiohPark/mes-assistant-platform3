import { expect, it } from 'vitest'
import type { TaskSummary } from '@mes/domain'
import { uniqueTasks, taskKeys, taskPages } from './tasks.queries'

it('keeps the newest first-page row when an activity cursor repeats an id', () => {
  const newest = { id: 'a', title: 'newest' } as TaskSummary
  expect(uniqueTasks([{ items: [newest] }, { items: [{ ...newest, title: 'older' }, { id: 'b' } as TaskSummary] }])).toEqual([newest, { id: 'b' }])
})
it('separates users, filters and finite/infinite query shapes under the invalidation prefix', () => {
  expect(taskKeys.page('u', {})).not.toEqual(taskKeys.page('v', {}))
  expect(taskKeys.page('u', {})).not.toEqual(taskKeys.board('u', {}))
  expect(taskPages('u', {}).queryKey).not.toEqual(taskKeys.page('u', {}))
  expect(taskPages('u', {}).queryKey[0]).toBe('tasks')
})
