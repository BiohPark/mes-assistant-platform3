import { expect, it } from 'vitest'
import { SrUpdatedDataSchema } from './sr.js'

it('sr.updated carries only the SR identifier', () => {
  expect(SrUpdatedDataSchema.parse({ srId: 'sr' })).toEqual({ srId: 'sr' })
  expect(SrUpdatedDataSchema.safeParse({ srId: 'sr', title: 'private' }).success).toBe(false)
  expect(SrUpdatedDataSchema.safeParse({ srId: '' }).success).toBe(false)
})
