import { expect, it } from 'vitest'
import { SrUpdatedDataSchema, TaskSrInputSchema } from './sr.js'

it('sr.updated carries only the SR identifier', () => {
  expect(SrUpdatedDataSchema.parse({ srId: 'sr' })).toEqual({ srId: 'sr' })
  expect(SrUpdatedDataSchema.safeParse({ srId: 'sr', title: 'private' }).success).toBe(false)
  expect(SrUpdatedDataSchema.safeParse({ srId: '' }).success).toBe(false)
})

it('SR staging exposes independent selection and usage flags with nonnegative byte counts', () => {
  const item = { srId: 'sr', code: 'SR-2026-0001', title: '요청', body: '본문', bytes: 6, selected: true, used: true }
  expect(TaskSrInputSchema.parse(item)).toEqual(item)
  expect(TaskSrInputSchema.safeParse({ ...item, bytes: -1 }).success).toBe(false)
  expect(TaskSrInputSchema.safeParse({ ...item, used: undefined }).success).toBe(false)
})
