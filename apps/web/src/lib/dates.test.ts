import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatDateTime, formatRelative } from './dates'

describe('locale dates', () => {
  afterEach(() => vi.useRealTimers())

  it('uses Korean or English for relative dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    expect(formatRelative('2026-10-06T12:00:00Z', 'ko')).toBe('2일 전')
    expect(formatRelative('2026-10-06T12:00:00Z', 'en')).toBe('2 days ago')
    expect(formatRelative('2026-10-10T12:00:00Z', 'en')).toBe('in 2 days')
  })

  it('uses date-fns locale for localized patterns and preserves numeric formats', () => {
    expect(formatDate('2026-10-08', 'PP', 'en')).toBe('Oct 8, 2026')
    expect(formatDate('2026-10-08', 'PP', 'ko')).toBe('2026.10.08')
    expect(formatDate('2026-10-08')).toBe('2026-10-08')
    expect(formatDateTime('2026-10-08T12:30:00')).toBe('10-08 12:30')
  })

  it.each([undefined, '', 'invalid'])('invalid date %s stays a dash', (value) => {
    expect(formatDate(value, 'PP', 'en')).toBe('-')
    expect(formatRelative(value, 'en')).toBe('-')
  })
})
