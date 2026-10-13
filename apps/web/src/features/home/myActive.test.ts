import { expect, it } from 'vitest'
import type { Task } from '@mes/domain'
import { isAiResponding, selectMyActive } from './myActive'

const task = (id: string, over: Partial<Task> = {}) => ({ id, code: id, status: 'in_progress', ownerId: 'me', assigneeIds: [], lastActivityAt: `2026-10-${id.padStart(2, '0')}T00:00:00.000Z`, aiRequest: null, ...over }) as Task

it('keeps only my in-progress conversations, responding ones first, then latest activity, up to the limit', () => {
  const tasks = [
    task('1'),
    task('2', { ownerId: 'other', assigneeIds: ['me'] }),
    task('3', { ownerId: 'other' }),
    task('4', { status: 'done' }),
    task('5', { status: 'on_hold' }),
    task('6', { aiRequest: { status: 'streaming', updatedAt: '2026-10-13T00:00:00.000Z' } }),
    task('7', { aiRequest: { status: 'failed', updatedAt: '2026-10-13T00:00:00.000Z' } }),
    task('8', { aiRequest: { status: 'pending', updatedAt: '2026-10-13T00:00:00.000Z' } }),
  ]
  expect(selectMyActive(tasks, 'me', 10).map((item) => item.id)).toEqual(['8', '6', '7', '2', '1'])
  expect(selectMyActive(tasks, 'me', 2).map((item) => item.id)).toEqual(['8', '6'])
  expect(selectMyActive([], 'me', 10)).toEqual([])
})

it('treats pending and streaming as responding, everything else as not', () => {
  expect(isAiResponding(task('1', { aiRequest: { status: 'pending', updatedAt: '' } }))).toBe(true)
  expect(isAiResponding(task('1', { aiRequest: { status: 'streaming', updatedAt: '' } }))).toBe(true)
  expect(isAiResponding(task('1', { aiRequest: { status: 'interrupted', updatedAt: '' } }))).toBe(false)
  expect(isAiResponding(task('1', { aiRequest: null }))).toBe(false)
  expect(isAiResponding(task('1', { aiRequest: undefined }))).toBe(false)
})
