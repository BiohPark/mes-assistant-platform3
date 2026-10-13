import { expect, it } from 'vitest'
import { srElapsedDays } from './srQueue.js'

it('elapsedDays from submittedAt floors full days and never uses the last update', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  expect(srElapsedDays('2026-10-10T12:00:01Z', now)).toBe(2)
  expect(srElapsedDays('2026-10-10T12:00:00Z', now)).toBe(3)
  expect(srElapsedDays(undefined, now)).toBe(0)
  expect(srElapsedDays('2026-10-14T00:00:00Z', now)).toBe(0)
})
